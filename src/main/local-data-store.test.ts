import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductRecord, SearchRequest } from "../shared/types";
import { LocalDataStore, mergePricePoint, PRICE_BUCKET_MS } from "./local-data-store";

const tempDirectories: string[] = [];
const createStore = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ldxp-local-store-"));
  tempDirectories.push(directory);
  return { store: new LocalDataStore(path.join(directory, "library.json")), filePath: path.join(directory, "library.json") };
};

const product = (overrides: Partial<ProductRecord> = {}): ProductRecord => ({
  id: "1",
  productKey: "key-1",
  name: "测试商品",
  imageUrl: "",
  merchantName: "测试商家",
  categoryName: "测试分类",
  goodsType: "card",
  description: "",
  salePrice: 10,
  costPrice: 8,
  agentPriceLimit: 9,
  stock: 5,
  sales: 1,
  status: "normal",
  statusLabel: "正常",
  relation: "connected",
  relationDetails: { price: 12, addType: 1, addRate: 50, addPrice: 0, nameSync: true, descriptionSync: true, link: "https://pay.ldxp.cn/item/child" },
  detailUrl: "https://pay.ldxp.cn/item/key-1",
  sourceIndex: 0,
  sourceFields: { rawStatus: 1, verify: 1, hasChild: true },
  ...overrides
});

const request: SearchRequest = { keywords: "测试", goodsType: "card", pages: 10, remotePageSize: 20, speedMode: "fast" };

afterEach(() => {
  vi.useRealTimers();
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("LocalDataStore", () => {
  it("persists unlimited favorites with notes/tags and multiple search presets", () => {
    const { store, filePath } = createStore();
    store.upsertFavorite({ product: product(), note: "稳定供货", tags: ["稳定", "低价", "稳定"] });
    store.upsertFavorite({ product: product({ id: "2", productKey: "key-2", name: "第二件" }), note: "", tags: [] });
    store.savePreset({ name: "低价方案", search: request, filters: { minSalePrice: 1, maxSalePrice: 20, stockState: "in-stock", status: "normal", relationState: "all", categoryKeyword: "", merchantName: "", blockedKeywords: "镜像", sortMode: "sale-asc" }, localPageSize: 20 });
    store.savePreset({ name: "全部方案", search: { ...request, keywords: "全部" }, filters: { minSalePrice: null, maxSalePrice: null, stockState: "all", status: "all", relationState: "all", categoryKeyword: "", merchantName: "", blockedKeywords: "", sortMode: "default" }, localPageSize: 50 });

    const reloaded = new LocalDataStore(filePath).getState();
    expect(reloaded.favorites).toHaveLength(2);
    expect(reloaded.favorites.find((favorite) => favorite.identity === "key:key-1")).toMatchObject({ note: "稳定供货", tags: ["稳定", "低价"] });
    expect(reloaded.presets.map((preset) => preset.name)).toEqual(["全部方案", "低价方案"]);
  });

  it("compares only two complete snapshots and ignores partial runs for alerts", () => {
    const { store } = createStore();
    const baseline = store.recordSuccessfulSnapshot(request, [product()], true);
    expect(baseline.summary.baselineCreated).toBe(true);

    const partial = store.recordSuccessfulSnapshot(request, [product({ salePrice: 7, stock: 0 })], false);
    expect(partial.summary.changedProducts).toBe(0);

    const changed = store.recordSuccessfulSnapshot(request, [product({ salePrice: 8, costPrice: 9, stock: 0 })], true);
    expect(changed.changes["key:key-1"].messages).toEqual(expect.arrayContaining([
      "售价较上次降低 2 元",
      "成本价较上次上涨 1 元",
      "库存从 5 变为 0"
    ]));
  });

  it("keeps the minimum price inside each 30-minute bucket", () => {
    const start = Date.UTC(2026, 6, 26, 0, 5);
    const first = mergePricePoint([], { recordedAt: start, salePrice: 12, costPrice: 10, stock: 5 });
    const second = mergePricePoint(first, { recordedAt: start + 10 * 60 * 1000, salePrice: 11, costPrice: 11, stock: 4 });
    const third = mergePricePoint(second, { recordedAt: start + PRICE_BUCKET_MS + 1, salePrice: 13, costPrice: 9, stock: 3 });
    expect(second).toEqual([{ recordedAt: Math.floor(start / PRICE_BUCKET_MS) * PRICE_BUCKET_MS, salePrice: 11, costPrice: 10, stock: 4 }]);
    expect(third).toHaveLength(2);
  });

  it("records in-stock favorite prices and removes points older than three days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    const { store } = createStore();
    store.upsertFavorite({ product: product(), note: "", tags: [] });
    store.recordSuccessfulSnapshot(request, [product({ salePrice: 12 })], true);
    expect(store.getState().priceHistory["key:key-1"]).toHaveLength(1);

    vi.setSystemTime(new Date("2026-07-24T00:00:00Z"));
    store.recordSuccessfulSnapshot(request, [product({ salePrice: 9 })], true);
    expect(store.getState().priceHistory["key:key-1"]).toEqual([expect.objectContaining({ salePrice: 9 })]);

    vi.setSystemTime(new Date("2026-07-24T00:40:00Z"));
    store.recordSuccessfulSnapshot(request, [product({ salePrice: 7, stock: 0 })], true);
    expect(store.getState().priceHistory["key:key-1"]).toHaveLength(1);
  });
});
