import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface StoredCredential {
  token: string;
  username: string;
  displayName: string;
  expiresAt: number | null;
}

export class CredentialStore {
  private readonly filePath: string;

  constructor(filePath = path.join(app.getPath("userData"), "auth.bin")) {
    this.filePath = filePath;
  }

  isPersistent(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  load(): StoredCredential | null {
    if (!this.isPersistent() || !fs.existsSync(this.filePath)) return null;
    try {
      const encrypted = fs.readFileSync(this.filePath);
      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as Partial<StoredCredential>;
      if (!parsed.token || !parsed.username || !parsed.displayName) return null;
      if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
        this.clear();
        return null;
      }
      return {
        token: parsed.token,
        username: parsed.username,
        displayName: parsed.displayName,
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null
      };
    } catch {
      this.clear();
      return null;
    }
  }

  save(credential: StoredCredential): boolean {
    if (!this.isPersistent()) return false;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(credential));
    fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
    return true;
  }

  clear(): void {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // A locked credential file is ignored; the in-memory token is still cleared.
    }
  }
}
