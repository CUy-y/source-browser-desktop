// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FavoriteRecord, LocalLibraryState, ProductRecord, SourceBrowserApi } from "../shared/types";
import { App } from "./App";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setNativeValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
};

const product: ProductRecord = {
  id: "1", productKey: "favorite", name: "收藏测试商品", imageUrl: "", merchantName: "测试商家", categoryName: "测试分类", goodsType: "card", description: "",
  salePrice: 10, costPrice: 8, agentPriceLimit: null, stock: 5, sales: 1, status: "normal", statusLabel: "正常", relation: "connected",
  relationDetails: { price: 12, addType: 1, addRate: 50, addPrice: 0, nameSync: true, descriptionSync: true, link: "https://pay.ldxp.cn/item/child" },
  detailUrl: "https://pay.ldxp.cn/item/favorite", sourceIndex: 0, sourceFields: { rawStatus: 1, verify: 1, hasChild: true }
};
const favorite: FavoriteRecord = { identity: "key:favorite", product, note: "稳定供货", tags: ["稳定"], createdAt: 1, updatedAt: Date.now() };
const library: LocalLibraryState = {
  favorites: [favorite],
  presets: [],
  monitorEvents: [],
  publicShops: [],
  priceHistory: { "key:favorite": [
    { recordedAt: Date.now() - 60 * 60 * 1000, salePrice: 11, costPrice: 8, stock: 5 },
    { recordedAt: Date.now(), salePrice: 10, costPrice: 7.5, stock: 4 }
  ] }
};

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("App local efficiency UI", () => {
  it("opens the unlimited favorites library and renders a three-day chart", async () => {
    const api = {
      auth: { getStatus: vi.fn().mockResolvedValue({ authenticated: true, displayName: "测试用户" }), openOfficialLogin: vi.fn(), logout: vi.fn() },
      catalog: { startSearch: vi.fn(), getProgress: vi.fn(), cancel: vi.fn(), getGoodsCategories: vi.fn(), connectGoods: vi.fn(), disconnectGoods: vi.fn(), exportCsv: vi.fn() },
      local: {
        getState: vi.fn().mockResolvedValue(library),
        upsertFavorite: vi.fn().mockResolvedValue(library),
        removeFavorite: vi.fn().mockResolvedValue(library),
        savePreset: vi.fn().mockResolvedValue(library),
        deletePreset: vi.fn().mockResolvedValue(library)
      },
      system: { openExternal: vi.fn(), checkOfficialLink: vi.fn() }
    } as unknown as SourceBrowserApi;
    Object.defineProperty(window, "sourceBrowser", { configurable: true, value: api });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));

    await vi.waitFor(() => expect(container.textContent).toContain("收藏栏 1"));
    const favoritesButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "收藏栏 1");
    await act(async () => favoritesButton?.click());
    expect(container.textContent).toContain("收藏测试商品");
    expect(container.textContent).toContain("稳定供货");

    const historyButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "历史曲线");
    await act(async () => historyButton?.click());
    expect(container.querySelector("svg.history-chart")).not.toBeNull();
    expect(container.textContent).toContain("30 分钟内取最低价");
  });

  it("searches the local public catalog and never exposes association actions", async () => {
    const publicProduct: ProductRecord = {
      ...product,
      id: "public-1",
      productKey: "public-1",
      name: "公开零售测试商品",
      costPrice: null,
      relation: "unknown",
      relationDetails: { price: null, addType: null, addRate: null, addPrice: null, nameSync: null, descriptionSync: null, link: "" },
      dataSource: "public-shop",
      publicShopToken: "shop-a"
    };
    const publicLibrary: LocalLibraryState = {
      ...library,
      favorites: [],
      priceHistory: {},
      publicShops: [{ token: "shop-a", name: "甲店", url: "https://pay.ldxp.cn/shop/shop-a", goodsCount: 1, createdAt: 1, updatedAt: 1, lastError: "" }]
    };
    const api = {
      auth: { getStatus: vi.fn().mockResolvedValue({ authenticated: true, displayName: "测试用户" }), openOfficialLogin: vi.fn(), logout: vi.fn() },
      catalog: { startSearch: vi.fn(), getProgress: vi.fn(), cancel: vi.fn(), getGoodsCategories: vi.fn(), connectGoods: vi.fn(), disconnectGoods: vi.fn(), exportCsv: vi.fn() },
      local: {
        getState: vi.fn().mockResolvedValue(publicLibrary), upsertFavorite: vi.fn(), removeFavorite: vi.fn(), savePreset: vi.fn(), deletePreset: vi.fn()
      },
      publicCatalog: {
        search: vi.fn().mockResolvedValue([publicProduct]), addSource: vi.fn(), refreshShop: vi.fn(), refreshAll: vi.fn(), removeShop: vi.fn(), importShops: vi.fn(), exportShops: vi.fn()
      },
      system: { openExternal: vi.fn(), checkOfficialLink: vi.fn() }
    } as unknown as SourceBrowserApi;
    Object.defineProperty(window, "sourceBrowser", { configurable: true, value: api });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await vi.waitFor(() => expect(container.textContent).toContain("公开店铺 1"));

    const scope = container.querySelector("select") as HTMLSelectElement;
    const keyword = container.querySelector('input[placeholder="例如：k12"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(scope, "public");
      scope.dispatchEvent(new Event("change", { bubbles: true }));
      setNativeValue(keyword, "公开");
      keyword.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "开始查询");
    await act(async () => searchButton?.click());
    await vi.waitFor(() => expect(container.textContent).toContain("公开零售测试商品"));

    expect(container.textContent).toContain("公开零售");
    expect(container.textContent).toContain("不可关联");
    expect(container.textContent).not.toContain("立即关联");
    expect(container.textContent).not.toContain("关联体检");
    expect(api.publicCatalog.search).toHaveBeenCalledWith({ keywords: "公开", goodsType: "" });
  });
});
