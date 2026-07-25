// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FavoriteRecord, LocalLibraryState, ProductRecord, SourceBrowserApi } from "../shared/types";
import { App } from "./App";

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
});
