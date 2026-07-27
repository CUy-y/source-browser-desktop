import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDataStore } from "./local-data-store";
import { normalizePublicProduct, parsePublicSource, PublicCatalogService } from "./public-catalog-service";

const directories: string[] = [];
const createStore = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ldxp-public-catalog-"));
  directories.push(directory);
  return new LocalDataStore(path.join(directory, "library.json"));
};
const response = (data: unknown) => new Response(JSON.stringify({ code: 1, msg: "success", data }), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("PublicCatalogService", () => {
  it("resolves an item URL to its shop and stores the complete public listing", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
      if (url.endsWith("/shopApi/Shop/goodsInfo")) return response({
        goods_key: "hw4xxb", name: "PLUS 纯手搓", price: 8, status: 1, verify: 1, goods_type: "card",
        user: { token: "saki", nickname: "Saki" }, category: { name: "PLUS日抛" }
      });
      if (url.endsWith("/shopApi/Shop/info")) return response({ token: "saki", nickname: "Saki", link: "https://pay.ldxp.cn/shop/saki", goods_type_sort: ["card"], card_count: 1 });
      if (url.endsWith("/shopApi/Shop/goodsList")) return response({ total: 1, list: [{
        goods_key: "hw4xxb", name: "PLUS 纯手搓", price: 8, goods_type: "card", link: "https://pay.ldxp.cn/item/hw4xxb",
        user: { token: "saki", nickname: "Saki" }, category: { name: "PLUS日抛" }, extend: { stock_count: 683 }
      }] });
      throw new Error(`unexpected request ${url} ${JSON.stringify(payload)}`);
    });
    const service = new PublicCatalogService(createStore(), fetcher);
    const result = await service.addSource("https://www.ldxp.cn/item/hw4xxb");

    expect(result.shop).toMatchObject({ token: "saki", name: "Saki", goodsCount: 1 });
    expect(service.search({ keywords: "PLUS", goodsType: "card" })).toEqual([
      expect.objectContaining({ productKey: "hw4xxb", salePrice: 8, costPrice: null, stock: 683, relation: "unknown", dataSource: "public-shop", publicShopToken: "saki" })
    ]);
    expect(service.search({ keywords: "PLUS", goodsType: "article" })).toEqual([]);
    expect(service.search({ keywords: "不存在", goodsType: "card" })).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects non-official or unsupported source URLs", () => {
    expect(() => parsePublicSource("https://evil.example/item/hw4xxb")).toThrow("链动小铺");
    expect(() => parsePublicSource("https://pay.ldxp.cn/order/hw4xxb")).toThrow("/item/商品键");
  });

  it("continues paging when the platform caps responses below the requested page size", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body || "{}")) as { current?: number };
      if (url.endsWith("/shopApi/Shop/info")) return response({
        token: "paged", nickname: "分页店铺", goods_type_sort: [{ goods_type: "card" }], card_count: 3
      });
      if (url.endsWith("/shopApi/Shop/goodsList")) {
        const current = payload.current ?? 1;
        const list = current === 1
          ? [{ goods_key: "one", name: "商品一", price: 1 }, { goods_key: "two", name: "商品二", price: 2 }]
          : [{ goods_key: "three", name: "商品三", price: 3 }];
        return response({ total: 3, list });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const service = new PublicCatalogService(createStore(), fetcher);
    const result = await service.addSource("https://pay.ldxp.cn/shop/paged");

    expect(result.shop?.goodsCount).toBe(3);
    expect(service.search({ keywords: "商品", goodsType: "card" }).map((item) => item.productKey)).toEqual(["one", "two", "three"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("normalizes public products without inventing cost or relation fields", () => {
    expect(normalizePublicProduct({ goods_key: "a", name: "公开商品", price: "9.9", extend: { stock_count: "4" } }, "shop-a", "甲店", 0)).toMatchObject({
      productKey: "a", salePrice: 9.9, costPrice: null, stock: 4, merchantName: "甲店", relation: "unknown", dataSource: "public-shop"
    });
  });
});
