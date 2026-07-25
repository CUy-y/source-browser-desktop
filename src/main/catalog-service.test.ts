import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "./auth-service";
import { RemoteRequestError } from "./auth-service";
import { CatalogService } from "./catalog-service";
import type { LocalDataStore } from "./local-data-store";
import { normalizeProduct } from "../shared/products";

const request = { keywords: "k12", goodsType: "", pages: 1, remotePageSize: 20 as const, speedMode: "fast" as const };

const createService = (postJson: ReturnType<typeof vi.fn>, localData?: LocalDataStore) => {
  const auth = {
    getStatus: () => ({ authenticated: true }),
    postJson
  } as unknown as AuthService;
  return new CatalogService(auth, localData);
};

const monitorResult = {
  summary: { scopeKey: "::k12", recordedAt: 1, coverageComplete: true, baselineCreated: true, changedProducts: 0, favoriteChanges: 0, favoriteRefreshTotal: 0, favoriteRefreshLoaded: 0, favoriteRefreshFailed: 0 },
  changes: {}
};

describe("CatalogService", () => {
  it("finishes a search and normalizes its result", async () => {
    const postJson = vi.fn().mockResolvedValue({
      code: 1,
      data: { total: 1, list: [{ id: 1, goods_key: "x", name: "K12", price: 99, status: 1 }] }
    });
    const service = createService(postJson);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("done"));
    const job = service.getProgress(jobId);
    expect(job.result?.[0]).toMatchObject({ id: "1", name: "K12", salePrice: 99 });
    expect(job.totalPagesResolved).toBe(true);
    expect(job.requestedPages).toBe(1);
    expect(job.calibration?.salePrice).toBe(100);
    expect(postJson).toHaveBeenCalledWith(
      "/merchantApi/MyParent/searchGoodsList",
      { current: 1, pageSize: 20, name: "", goods_type: "", keywords: "k12" },
      expect.any(AbortSignal)
    );
  });

  it("deduplicates repeated goods keys returned by pagination", async () => {
    const postJson = vi.fn().mockResolvedValue({
      code: 1,
      data: {
        total: 2,
        list: [
          { id: 1, goods_key: "same", name: "K12", price: 99, status: 1 },
          { id: 2, goods_key: "same", name: "K12 duplicate", price: 99, status: 1 }
        ]
      }
    });
    const service = createService(postJson);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("done"));
    expect(service.getProgress(jobId).result).toHaveLength(1);
  });

  it("fetches two fast-mode pages concurrently and publishes them in page order", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const postJson = vi.fn(async (_endpoint: string, payload: { current: number }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, payload.current === 1 ? 0 : 200));
      inFlight -= 1;
      return {
        code: 1,
        data: { total: 60, list: [{ id: payload.current, goods_key: `page-${payload.current}`, name: `page-${payload.current}`, price: payload.current }] }
      };
    });
    const service = createService(postJson);
    const { jobId } = service.startSearch({ ...request, pages: 3 });
    await vi.runAllTimersAsync();

    expect(service.getProgress(jobId).status).toBe("done");
    expect(maxInFlight).toBe(2);
    expect(service.getProgress(jobId).result?.map((product) => product.productKey)).toEqual(["page-1", "page-2", "page-3"]);
    expect(service.getProgress(jobId)).toMatchObject({ speedMode: "fast", concurrency: 2 });
    vi.useRealTimers();
  });

  it("reports the requested limit separately before total pages are resolved", () => {
    const postJson = vi.fn(() => new Promise(() => undefined));
    const service = createService(postJson);
    const { jobId } = service.startSearch({ ...request, pages: 50 });
    const job = service.getProgress(jobId);
    expect(job.requestedPages).toBe(50);
    expect(job.totalPagesResolved).toBe(false);
    service.cancel(jobId);
  });

  it("does not retry a non-retryable 429 response", async () => {
    const postJson = vi.fn().mockRejectedValue(new RemoteRequestError("请求过于频繁", 429, null, false));
    const service = createService(postJson);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("failed"));
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(service.getProgress(jobId).result).toBeUndefined();
  });

  it("carries a 429 delay into the next job only during the cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const postJson = vi.fn()
      .mockRejectedValueOnce(new RemoteRequestError("请求过于频繁", 429, null, false))
      .mockResolvedValue({ code: 1, data: { total: 0, list: [] } });
    const service = createService(postJson);
    const failed = service.startSearch(request);
    await vi.runAllTimersAsync();
    expect(service.getProgress(failed.jobId).status).toBe("failed");

    const cooled = service.startSearch(request);
    expect(service.getProgress(cooled.jobId).throttleMs).toBe(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(postJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getProgress(cooled.jobId).status).toBe("done");

    await vi.advanceTimersByTimeAsync(30_000);
    const reset = service.startSearch(request);
    expect(service.getProgress(reset.jobId).throttleMs).toBe(40);
    service.cancel(reset.jobId);
    vi.useRealTimers();
  });

  it("retries retryable server failures up to success", async () => {
    vi.useFakeTimers();
    const postJson = vi.fn()
      .mockRejectedValueOnce(new RemoteRequestError("HTTP 500", 500, null, true))
      .mockRejectedValueOnce(new RemoteRequestError("HTTP 502", 502, null, true))
      .mockResolvedValue({ code: 1, data: { total: 0, list: [] } });
    const service = createService(postJson);
    const { jobId } = service.startSearch(request);
    await vi.runAllTimersAsync();

    expect(service.getProgress(jobId).status).toBe("done");
    expect(postJson).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("cancels an active request without publishing partial results", async () => {
    const postJson = vi.fn((_endpoint, _payload, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const service = createService(postJson);
    const { jobId } = service.startSearch(request);
    const cancelled = service.cancel(jobId);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.result).toBeUndefined();
  });

  it("records snapshots only after successful jobs and marks partial coverage", async () => {
    const postJson = vi.fn().mockResolvedValue({ code: 1, data: { total: 100, list: [{ id: 1, goods_key: "x", name: "K12", price: 99, status: 1 }] } });
    const recordSuccessfulSnapshot = vi.fn().mockReturnValue({ ...monitorResult, summary: { ...monitorResult.summary, coverageComplete: false } });
    const localData = { getFavorites: vi.fn(() => []), recordSuccessfulSnapshot } as unknown as LocalDataStore;
    const service = createService(postJson, localData);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("done"));
    expect(service.getProgress(jobId).coverageComplete).toBe(false);
    expect(recordSuccessfulSnapshot).toHaveBeenCalledWith(request, expect.any(Array), false, [], 0);
    expect(localData.getFavorites).toHaveBeenCalledOnce();
  });

  it("does not write a snapshot when a job fails or is cancelled", async () => {
    const recordSuccessfulSnapshot = vi.fn();
    const localData = { getFavorites: vi.fn(() => []), recordSuccessfulSnapshot } as unknown as LocalDataStore;
    const failedService = createService(vi.fn().mockRejectedValue(new RemoteRequestError("HTTP 500", 500, null, false)), localData);
    const failed = failedService.startSearch(request);
    await vi.waitFor(() => expect(failedService.getProgress(failed.jobId).status).toBe("failed"));

    const pendingPost = vi.fn((_endpoint, _payload, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })));
    const cancelledService = createService(pendingPost, localData);
    const cancelled = cancelledService.startSearch(request);
    cancelledService.cancel(cancelled.jobId);
    expect(recordSuccessfulSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes uncovered in-stock favorites after a complete query without adding them to main results", async () => {
    const favoriteProduct = normalizeProduct({ id: 9, goods_key: "favorite", name: "收藏商品", price: 18, cost_price: 12, stock_count: 5, status: 1 }, 0);
    const favorite = { identity: "key:favorite", product: favoriteProduct, note: "", tags: [], createdAt: 1, updatedAt: 1 };
    const postJson = vi.fn(async (_endpoint: string, payload: { keywords: string }) => payload.keywords === "收藏商品"
      ? { code: 1, data: { total: 1, list: [{ id: 9, goods_key: "favorite", name: "收藏商品", price: 16, cost_price: 11, stock_count: 4, status: 1 }] } }
      : { code: 1, data: { total: 1, list: [{ id: 1, goods_key: "main", name: "K12", price: 99, status: 1 }] } });
    const recordSuccessfulSnapshot = vi.fn().mockReturnValue({ ...monitorResult, summary: { ...monitorResult.summary, favoriteRefreshTotal: 1, favoriteRefreshLoaded: 1 } });
    const localData = { getFavorites: vi.fn(() => [favorite]), recordSuccessfulSnapshot } as unknown as LocalDataStore;
    const service = createService(postJson, localData);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("done"));
    expect(service.getProgress(jobId).result?.map((product) => product.productKey)).toEqual(["main"]);
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(recordSuccessfulSnapshot).toHaveBeenCalledWith(request, expect.any(Array), true, [expect.objectContaining({ productKey: "favorite", salePrice: 16 })], 0);
  });

  it("refreshes favorites after a successful partial query but keeps monitoring coverage false", async () => {
    const favoriteProduct = normalizeProduct({ id: 9, goods_key: "favorite", name: "收藏商品", price: 18, cost_price: 12, stock_count: 5, status: 1 }, 0);
    const favorite = { identity: "key:favorite", product: favoriteProduct, note: "", tags: [], createdAt: 1, updatedAt: 1 };
    const postJson = vi.fn(async (_endpoint: string, payload: { keywords: string }) => payload.keywords === "收藏商品"
      ? { code: 1, data: { total: 1, list: [{ id: 9, goods_key: "favorite", name: "收藏商品", price: 15, cost_price: 10, stock_count: 3, status: 1 }] } }
      : { code: 1, data: { total: 100, list: [{ id: 1, goods_key: "main", name: "K12", price: 99, status: 1 }] } });
    const recordSuccessfulSnapshot = vi.fn().mockReturnValue({ ...monitorResult, summary: { ...monitorResult.summary, coverageComplete: false, favoriteRefreshTotal: 1, favoriteRefreshLoaded: 1 } });
    const localData = { getFavorites: vi.fn(() => [favorite]), recordSuccessfulSnapshot } as unknown as LocalDataStore;
    const service = createService(postJson, localData);
    const { jobId } = service.startSearch(request);

    await vi.waitFor(() => expect(service.getProgress(jobId).status).toBe("done"));
    expect(service.getProgress(jobId).coverageComplete).toBe(false);
    expect(recordSuccessfulSnapshot).toHaveBeenCalledWith(request, expect.any(Array), false, [expect.objectContaining({ salePrice: 15 })], 0);
  });

  it("normalizes merchant categories without issuing a write", async () => {
    const postJson = vi.fn().mockResolvedValue({
      code: 1,
      data: { list: [{ id: 8, name: "会员服务" }, { id: "9", name: "软件工具" }, { id: "bad", name: "忽略" }] }
    });
    const service = createService(postJson);

    await expect(service.getGoodsCategories("virtual")).resolves.toEqual([
      { id: 8, name: "会员服务" },
      { id: 9, name: "软件工具" }
    ]);
    expect(postJson).toHaveBeenCalledWith("/merchantApi/MyParent/goodsCategory", { goods_type: "virtual" });
  });

  it("sends the exact official association payload", async () => {
    const postJson = vi.fn().mockResolvedValue({ code: 1, msg: "关联成功" });
    const service = createService(postJson);

    await expect(service.connectGoods({
      goodsId: "599161",
      name: "K12 会员",
      description: "商品说明",
      categoryId: 8,
      addType: 1,
      addRate: 10,
      addPrice: 0,
      price: 462,
      nameSync: true,
      descriptionSync: false
    })).resolves.toEqual({ connected: true, message: "关联成功" });
    expect(postJson).toHaveBeenCalledWith("/merchantApi/MyParent/connectGoods", {
      goods_id: "599161",
      name: "K12 会员",
      description: "商品说明",
      category_id: 8,
      add_type: 1,
      add_rate: 10,
      add_price: 0,
      price: 462,
      name_sync: 1,
      description_sync: 0
    });
  });

  it("sends only the goods ID when cancelling an association", async () => {
    const postJson = vi.fn().mockResolvedValue({ code: 1, msg: "取消成功" });
    const service = createService(postJson);

    await expect(service.disconnectGoods("599161")).resolves.toEqual({ disconnected: true, message: "取消成功" });
    expect(postJson).toHaveBeenCalledWith("/merchantApi/MyParent/disconnectGoods", { goods_id: "599161" });
  });
});
