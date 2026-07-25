import { BrowserWindow, session, shell, type Session } from "electron";
import type { AuthStatus } from "../shared/types";
import { AUTH_PARTITION, MERCHANT_LOGIN_URL, MERCHANT_ORIGIN, PLATFORM_BASE_URL } from "./constants";
import { CredentialStore, type StoredCredential } from "./credential-store";
import { shouldInvalidateCredential } from "./auth-policy";

type ApiEnvelope = {
  code?: number;
  msg?: string;
  data?: unknown;
};

type ExtractedToken = { token: string; expiresAt: number | null };

export class RemoteRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly apiCode: number | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "RemoteRequestError";
  }
}

export class AuthRequiredError extends RemoteRequestError {
  constructor(message = "登录已失效，请重新登录") {
    super(message, 401, 401, false);
    this.name = "AuthRequiredError";
  }
}

const isEnvelope = (value: unknown): value is ApiEnvelope => Boolean(value) && typeof value === "object";

export class AuthService {
  private readonly platformSession: Session;
  private readonly credentials: CredentialStore;
  private current: StoredCredential | null = null;
  private loginWindow: BrowserWindow | null = null;
  private captureInFlight = false;
  private captureTimer: NodeJS.Timeout | null = null;
  private captureInterval: NodeJS.Timeout | null = null;
  private connectionMessage: string | undefined;

  constructor(credentials = new CredentialStore()) {
    this.credentials = credentials;
    this.platformSession = session.fromPartition(AUTH_PARTITION, { cache: true });
  }

  async initialize(): Promise<void> {
    const stored = this.credentials.load();
    if (!stored) return;
    this.current = stored;
    try {
      const profile = await this.validateToken(stored.token);
      this.current = { ...stored, ...profile };
      this.connectionMessage = undefined;
    } catch (error) {
      if (shouldInvalidateCredential(error)) {
        await this.clearAuthentication();
      } else {
        this.connectionMessage = "暂时无法连接链动小铺，已保留本机登录态";
      }
    }
  }

  getStatus(): AuthStatus {
    if (!this.current) {
      return {
        authenticated: false,
        persistent: this.credentials.isPersistent(),
        message: this.credentials.isPersistent() ? undefined : "系统加密服务不可用，本次登录不会在重启后保留"
      };
    }
    return {
      authenticated: true,
      username: this.current.username,
      displayName: this.current.displayName,
      persistent: this.credentials.isPersistent(),
      message: this.connectionMessage
    };
  }

  async openOfficialLogin(parent?: BrowserWindow): Promise<{ opened: boolean }> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus();
      return { opened: true };
    }

    const loginWindow = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 900,
      minHeight: 640,
      parent,
      modal: false,
      title: "链动小铺官方登录",
      show: false,
      webPreferences: {
        partition: AUTH_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    });
    this.loginWindow = loginWindow;

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    loginWindow.webContents.on("will-navigate", (event, url) => {
      try {
        const target = new URL(url);
        if (target.origin !== MERCHANT_ORIGIN) {
          event.preventDefault();
          if (target.protocol === "https:") void shell.openExternal(target.toString());
        }
      } catch {
        event.preventDefault();
      }
    });

    const queueCapture = () => {
      if (this.captureTimer) clearTimeout(this.captureTimer);
      this.captureTimer = setTimeout(() => void this.tryCaptureLogin(), 350);
    };
    loginWindow.webContents.on("dom-ready", queueCapture);
    loginWindow.webContents.on("did-navigate", queueCapture);
    loginWindow.webContents.on("did-navigate-in-page", queueCapture);
    this.captureInterval = setInterval(queueCapture, 1500);
    loginWindow.on("closed", () => {
      if (this.captureTimer) clearTimeout(this.captureTimer);
      if (this.captureInterval) clearInterval(this.captureInterval);
      this.captureTimer = null;
      this.captureInterval = null;
      this.loginWindow = null;
    });
    loginWindow.once("ready-to-show", () => loginWindow.show());
    await loginWindow.loadURL(MERCHANT_LOGIN_URL);
    return { opened: true };
  }

  async logout(): Promise<AuthStatus> {
    await this.clearAuthentication();
    return this.getStatus();
  }

  async postJson(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ApiEnvelope> {
    if (!this.current?.token) throw new AuthRequiredError("请先登录链动小铺商家账号");
    return this.postWithToken(endpoint, payload, this.current.token, signal);
  }

  private async tryCaptureLogin(): Promise<void> {
    const loginWindow = this.loginWindow;
    if (!loginWindow || loginWindow.isDestroyed() || this.captureInFlight) return;
    const currentUrl = loginWindow.webContents.getURL();
    if (!currentUrl.startsWith(MERCHANT_ORIGIN)) return;

    this.captureInFlight = true;
    try {
      const extracted = await loginWindow.webContents.executeJavaScript(`(() => {
        try {
          const raw = localStorage.getItem("auth-token");
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const token = typeof parsed === "string" ? parsed : parsed && parsed.value;
          const expiresAt = parsed && typeof parsed.expiry === "number" ? parsed.expiry : null;
          return typeof token === "string" && token ? { token, expiresAt } : null;
        } catch { return null; }
      })()`, true) as ExtractedToken | null;
      if (!extracted?.token) return;

      const profile = await this.validateToken(extracted.token);
      const credential: StoredCredential = {
        token: extracted.token,
        expiresAt: extracted.expiresAt,
        ...profile
      };
      this.current = credential;
      this.credentials.save(credential);
      this.connectionMessage = undefined;
      if (!loginWindow.isDestroyed()) loginWindow.close();
    } catch {
      // The login page may not have completed authentication yet.
    } finally {
      this.captureInFlight = false;
    }
  }

  private async validateToken(token: string): Promise<Pick<StoredCredential, "username" | "displayName">> {
    const response = await this.postWithToken("/merchantApi/user/userinfo", {}, token);
    if (Number(response.code) !== 1 || !response.data || typeof response.data !== "object") {
      throw new AuthRequiredError(response.msg || "无法验证登录状态");
    }
    const profile = response.data as Record<string, unknown>;
    const username = String(profile.username || profile.mobile || profile.id || "merchant");
    const displayName = String(profile.nickname || profile.username || profile.mobile || "链动商家");
    return { username, displayName };
  }

  private async postWithToken(endpoint: string, payload: unknown, token: string, signal?: AbortSignal): Promise<ApiEnvelope> {
    let response: Response;
    try {
      response = await this.platformSession.fetch(`${PLATFORM_BASE_URL}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "Content-Type": "application/json",
          Origin: PLATFORM_BASE_URL,
          Referer: `${PLATFORM_BASE_URL}/merchant/my_parent/source_square`,
          "Merchant-Token": token,
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload ?? {}),
        signal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      this.connectionMessage = "网络不可用，登录态仍保留在本机";
      throw new RemoteRequestError(error instanceof Error ? error.message : "网络请求失败", 0, null, true);
    }

    const rawText = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new RemoteRequestError(`远端返回了非 JSON 内容（HTTP ${response.status}）`, response.status, null, response.status >= 500);
    }
    if (!isEnvelope(parsed)) {
      throw new RemoteRequestError("远端响应格式不正确", response.status, null, false);
    }
    const apiCode = typeof parsed.code === "number" ? parsed.code : null;
    if (response.status === 401 || response.status === 403 || apiCode === 401 || apiCode === 403) {
      await this.clearAuthentication();
      throw new AuthRequiredError(parsed.msg || "登录已失效，请重新登录");
    }
    if (!response.ok) {
      const retryable = response.status >= 500;
      if (retryable) this.connectionMessage = "链动小铺暂时不可用，登录态仍保留在本机";
      throw new RemoteRequestError(parsed.msg || `远端 HTTP ${response.status}`, response.status, apiCode, retryable);
    }
    this.connectionMessage = undefined;
    return parsed;
  }

  private async clearAuthentication(): Promise<void> {
    this.current = null;
    this.connectionMessage = undefined;
    this.credentials.clear();
    await this.platformSession.clearStorageData({
      origin: MERCHANT_ORIGIN,
      storages: ["cookies", "localstorage"]
    });
  }
}
