import crypto from "node:crypto";
import { buildFieldCalibration, normalizeProduct } from "../shared/products";
import { searchRequestSchema } from "../shared/schemas";
import type { ConnectGoodsRequest, GoodsCategoryOption, ProductRecord, SearchJobProgress, SearchRequest } from "../shared/types";
import { PLATFORM_BASE_URL, SEARCH_JOB_TTL_MS, SEARCH_RETRY_COUNT } from "./constants";
import { AuthRequiredError, AuthService, RemoteRequestError } from "./auth-service";
import { AdaptiveRateLimiter } from "./adaptive-rate-limiter";
import { SEARCH_BACKPRESSURE_COOLDOWN_MS, SEARCH_SPEED_PROFILES } from "./search-speed";
import type { LocalDataStore } from "./local-data-store";

type InternalJob = SearchJobProgress & {
  request: SearchRequest;
  controller: AbortController;
  limiter: AdaptiveRateLimiter;
  updatedAt: number;
};

type PageData = { total: number; list: unknown[] };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException("查询已取消", "AbortError"));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
});

export class CatalogService {
  private readonly jobs = new Map<string, InternalJob>();
  private activeJobId: string | null = null;
  private backpressureUntil = 0;
  private backpressureDelayMs = 0;

  constructor(private readonly auth: AuthService, private readonly localData?: LocalDataStore) {}

  startSearch(input: unknown): { jobId: string } {
    const request = searchRequestSchema.parse(input) as SearchRequest;
    if (!this.auth.getStatus().authenticated) throw new AuthRequiredError("请先登录链动小铺商家账号");
    if (this.activeJobId && this.jobs.get(this.activeJobId)?.status === "running") {
      throw new Error("已有查询正在运行，请等待完成或先停止当前查询");
    }
    this.pruneJobs();
    const id = crypto.randomUUID();
    const speedProfile = SEARCH_SPEED_PROFILES[request.speedMode];
    const cooldownActive = Date.now() < this.backpressureUntil;
    const initialDelayMs = cooldownActive
      ? Math.min(speedProfile.maxDelayMs, Math.max(speedProfile.baseDelayMs, this.backpressureDelayMs))
      : speedProfile.baseDelayMs;
    const limiter = new AdaptiveRateLimiter(
      speedProfile.baseDelayMs,
      speedProfile.maxDelayMs,
      initialDelayMs,
      speedProfile.min429DelayMs,
      cooldownActive
    );
    const job: InternalJob = {
      id,
      status: "running",
      currentPage: 0,
      loadedPages: 0,
      totalPages: request.pages,
      requestedPages: request.pages,
      totalPagesResolved: false,
      remoteTotalPages: request.pages,
      coverageComplete: false,
      favoriteRefreshCurrent: 0,
      favoriteRefreshTotal: 0,
      speedMode: request.speedMode,
      concurrency: speedProfile.concurrency,
      throttleMs: limiter.delayMs,
      loaded: 0,
      total: 0,
      request,
      controller: new AbortController(),
      limiter,
      updatedAt: Date.now()
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    void this.run(job);
    return { jobId: id };
  }

  getProgress(jobId: string): SearchJobProgress {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("查询任务不存在或已过期");
    return this.toPublicJob(job);
  }

  cancel(jobId: string): SearchJobProgress {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("查询任务不存在或已过期");
    if (job.status === "running") {
      job.controller.abort();
      job.status = "cancelled";
      job.error = "查询已取消，结果未更新";
      job.updatedAt = Date.now();
    }
    return this.toPublicJob(job);
  }

  async getGoodsCategories(goodsType: string): Promise<GoodsCategoryOption[]> {
    const response = await this.auth.postJson("/merchantApi/MyParent/goodsCategory", { goods_type: goodsType });
    if (Number(response.code) !== 1) throw new RemoteRequestError(response.msg || "获取商品分类失败", 200, Number(response.code) || null, false);
    const values = Array.isArray(response.data)
      ? response.data
      : isRecord(response.data) && Array.isArray(response.data.list)
        ? response.data.list
        : [];
    return values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = Number(value.id);
      const name = String(value.name || "").trim();
      return Number.isInteger(id) && id >= 0 && name ? [{ id, name }] : [];
    });
  }

  async connectGoods(request: ConnectGoodsRequest): Promise<{ connected: boolean; message: string }> {
    const response = await this.auth.postJson("/merchantApi/MyParent/connectGoods", {
      goods_id: request.goodsId,
      name: request.name,
      description: request.description,
      category_id: request.categoryId,
      add_type: request.addType,
      add_rate: request.addRate,
      add_price: request.addPrice,
      price: request.price,
      name_sync: request.nameSync ? 1 : 0,
      description_sync: request.descriptionSync ? 1 : 0
    });
    if (Number(response.code) !== 1) throw new RemoteRequestError(response.msg || "商品关联失败", 200, Number(response.code) || null, false);
    return { connected: true, message: response.msg || "商品关联成功" };
  }

  async disconnectGoods(goodsId: string): Promise<{ disconnected: boolean; message: string }> {
    const response = await this.auth.postJson("/merchantApi/MyParent/disconnectGoods", { goods_id: goodsId });
    if (Number(response.code) !== 1) throw new RemoteRequestError(response.msg || "取消关联失败", 200, Number(response.code) || null, false);
    return { disconnected: true, message: response.msg || "已取消商品关联" };
  }

  private async run(job: InternalJob): Promise<void> {
    const collected: ProductRecord[] = [];
    const seen = new Set<string>();
    const consumePage = (page: number, pageData: PageData): boolean => {
      const pageOffset = (page - 1) * job.request.remotePageSize;
      for (const [index, item] of pageData.list.entries()) {
        const product = normalizeProduct(item, pageOffset + index, PLATFORM_BASE_URL);
        const stableKey = product.productKey
          ? `key:${product.productKey}`
          : !product.id.startsWith("row-")
            ? `id:${product.id}`
            : null;
        if (stableKey && seen.has(stableKey)) continue;
        if (stableKey) seen.add(stableKey);
        collected.push(product);
      }
      job.loaded = collected.length;
      job.loadedPages = page;
      job.currentPage = page;
      job.updatedAt = Date.now();
      return pageData.list.length === 0 || collected.length >= job.total || page >= job.totalPages;
    };
    try {
      job.currentPage = 1;
      job.updatedAt = Date.now();
      const firstPage = await this.fetchPage(job, 1);
      job.total = firstPage.total;
      const remoteTotalPages = Math.max(1, Math.ceil(firstPage.total / job.request.remotePageSize));
      job.remoteTotalPages = remoteTotalPages;
      job.totalPages = Math.min(job.request.pages, remoteTotalPages);
      job.totalPagesResolved = true;
      let finished = consumePage(1, firstPage);

      for (let batchStart = 2; !finished && batchStart <= job.totalPages; batchStart += job.concurrency) {
        if (job.controller.signal.aborted) throw new DOMException("查询已取消", "AbortError");
        const pages = Array.from(
          { length: Math.min(job.concurrency, job.totalPages - batchStart + 1) },
          (_, index) => batchStart + index
        );
        job.currentPage = pages[pages.length - 1];
        job.updatedAt = Date.now();
        const settled = await Promise.allSettled(pages.map((page) => this.fetchPage(job, page)));
        const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw failed.reason;
        const completed = settled as PromiseFulfilledResult<PageData>[];
        for (const [index, result] of completed.entries()) {
          finished = consumePage(pages[index], result.value);
          if (finished) break;
        }
      }

      if (job.controller.signal.aborted) throw new DOMException("查询已取消", "AbortError");
      job.coverageComplete = job.loadedPages >= remoteTotalPages;
      const favoriteSamples: ProductRecord[] = [];
      let favoriteRefreshFailed = 0;
      if (this.localData) {
        const collectedIdentities = new Set(collected.map((product) => product.productKey ? `key:${product.productKey}` : `id:${product.id}`));
        const favorites = this.localData.getFavorites().filter((favorite) => !collectedIdentities.has(favorite.identity) && favorite.product.stock !== null && favorite.product.stock > 0);
        job.favoriteRefreshTotal = favorites.length;
        for (const favorite of favorites) {
          if (job.controller.signal.aborted) throw new DOMException("查询已取消", "AbortError");
          try {
            const refreshed = await this.fetchFavorite(job, favorite.product);
            if (refreshed) favoriteSamples.push(refreshed);
            else favoriteRefreshFailed += 1;
          } catch (error) {
            if (error instanceof AuthRequiredError) throw error;
            favoriteRefreshFailed += 1;
            if (error instanceof RemoteRequestError && error.status === 429) {
              job.limiter.onBackpressure(429);
              this.backpressureUntil = Date.now() + SEARCH_BACKPRESSURE_COOLDOWN_MS;
              this.backpressureDelayMs = job.limiter.delayMs;
              const remaining = favorites.length - job.favoriteRefreshCurrent - 1;
              favoriteRefreshFailed += remaining;
              job.favoriteRefreshCurrent += remaining;
              break;
            }
          } finally {
            job.favoriteRefreshCurrent += 1;
            job.updatedAt = Date.now();
          }
        }
      }
      job.status = "done";
      if (this.localData) {
        const monitor = this.localData.recordSuccessfulSnapshot(job.request, collected, job.coverageComplete, favoriteSamples, favoriteRefreshFailed);
        job.monitor = monitor.summary;
        job.result = collected.map((product) => {
          const change = monitor.changes[product.productKey ? `key:${product.productKey}` : `id:${product.id}`];
          return change ? { ...product, change } : product;
        });
      } else {
        job.result = collected;
      }
      job.calibration = buildFieldCalibration(collected);
      job.updatedAt = Date.now();
    } catch (error) {
      if (job.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        job.status = "cancelled";
        job.error = "查询已取消，结果未更新";
      } else {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "查询失败";
      }
      job.updatedAt = Date.now();
    } finally {
      if (this.activeJobId === job.id) this.activeJobId = null;
    }
  }

  private async fetchPage(job: InternalJob, page: number): Promise<PageData> {
    const { request } = job;
    const { signal } = job.controller;
    let lastError: unknown;
    for (let attempt = 0; attempt <= SEARCH_RETRY_COUNT; attempt += 1) {
      try {
        await job.limiter.wait(signal);
        job.throttleMs = job.limiter.delayMs;
        job.updatedAt = Date.now();
        const response = await this.auth.postJson("/merchantApi/MyParent/searchGoodsList", {
          current: page,
          pageSize: request.remotePageSize,
          name: "",
          goods_type: request.goodsType,
          keywords: request.keywords
        }, signal);
        if (Number(response.code) !== 1) {
          throw new RemoteRequestError(response.msg || `远端第 ${page} 页返回失败`, 200, Number(response.code) || null, false);
        }
        if (!isRecord(response.data)) throw new RemoteRequestError("远端商品数据格式不正确", 200, 1, false);
        const list = Array.isArray(response.data.list) ? response.data.list : [];
        const totalValue = Number(response.data.total ?? list.length);
        job.limiter.onSuccess();
        job.throttleMs = job.limiter.delayMs;
        return { total: Number.isFinite(totalValue) ? Math.max(0, totalValue) : list.length, list };
      } catch (error) {
        lastError = error;
        if (signal.aborted || error instanceof AuthRequiredError) throw error;
        if (error instanceof RemoteRequestError) {
          if (error.status === 0) job.limiter.onNetworkError();
          else if (error.status === 429 || error.status >= 500) job.limiter.onBackpressure(error.status);
          job.throttleMs = job.limiter.delayMs;
          job.updatedAt = Date.now();
          if (error.status === 429) {
            this.backpressureUntil = Date.now() + SEARCH_BACKPRESSURE_COOLDOWN_MS;
            this.backpressureDelayMs = job.limiter.delayMs;
            throw new RemoteRequestError(`${error.message}。已自动提高请求间隔，请稍后重试`, 429, error.apiCode, false);
          }
        }
        const retryable = error instanceof RemoteRequestError && error.retryable;
        if (!retryable || attempt >= SEARCH_RETRY_COUNT) throw error;
        await abortableDelay(400 * (attempt + 1) + Math.floor(Math.random() * 150), signal);
      }
    }
    throw lastError;
  }

  private async fetchFavorite(job: InternalJob, favorite: ProductRecord): Promise<ProductRecord | null> {
    await job.limiter.wait(job.controller.signal);
    const response = await this.auth.postJson("/merchantApi/MyParent/searchGoodsList", {
      current: 1,
      pageSize: 20,
      name: "",
      goods_type: favorite.goodsType,
      keywords: favorite.name
    }, job.controller.signal);
    if (Number(response.code) !== 1) {
      throw new RemoteRequestError(response.msg || `刷新收藏商品失败：${favorite.name}`, 200, Number(response.code) || null, false);
    }
    if (!isRecord(response.data)) return null;
    const list = Array.isArray(response.data.list) ? response.data.list : [];
    const normalized = list.map((item, index) => normalizeProduct(item, index, PLATFORM_BASE_URL));
    return normalized.find((product) => product.productKey && product.productKey === favorite.productKey)
      ?? normalized.find((product) => !product.id.startsWith("row-") && product.id === favorite.id)
      ?? null;
  }

  private pruneJobs(): void {
    const cutoff = Date.now() - SEARCH_JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.status !== "running" && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }

  private toPublicJob(job: InternalJob): SearchJobProgress {
    return {
      id: job.id,
      status: job.status,
      currentPage: job.currentPage,
      loadedPages: job.loadedPages,
      totalPages: job.totalPages,
      requestedPages: job.requestedPages,
      totalPagesResolved: job.totalPagesResolved,
      remoteTotalPages: job.remoteTotalPages,
      coverageComplete: job.coverageComplete,
      favoriteRefreshCurrent: job.favoriteRefreshCurrent,
      favoriteRefreshTotal: job.favoriteRefreshTotal,
      speedMode: job.speedMode,
      concurrency: job.concurrency,
      throttleMs: job.throttleMs,
      loaded: job.loaded,
      total: job.total,
      error: job.error,
      result: job.result,
      calibration: job.calibration,
      monitor: job.monitor
    };
  }
}
