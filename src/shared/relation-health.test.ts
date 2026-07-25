import { describe, expect, it } from "vitest";
import type { ProductRecord } from "./types";
import { evaluateRelationHealth, isValidRelationLink } from "./relation-health";

const product: ProductRecord = {
  id: "1", productKey: "a", name: "商品", imageUrl: "", merchantName: "商家", categoryName: "分类", goodsType: "card", description: "",
  salePrice: 10, costPrice: 9, agentPriceLimit: 12, stock: 2, sales: 1, status: "abnormal", statusLabel: "异常", relation: "connected",
  relationDetails: { price: 10, addType: 1, addRate: 10, addPrice: 0, nameSync: false, descriptionSync: true, link: "https://evil.example/item/a" },
  detailUrl: "https://pay.ldxp.cn/item/a", sourceIndex: 0, sourceFields: { rawStatus: 0, verify: 1, hasChild: true },
  change: { salePriceDelta: null, costPriceDelta: 2, previousStock: 2, stockDelta: 0, restocked: false, becameOutOfStock: false, statusChanged: true, relationChanged: false, messages: [] }
};

describe("relation health", () => {
  it("flags source errors, rising costs, low relation prices, disabled sync and bad links", () => {
    const report = evaluateRelationHealth(product);
    expect(report.score).toBeLessThan(50);
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "source-status", severity: "danger" }),
      expect.objectContaining({ key: "price-limit", severity: "danger" }),
      expect.objectContaining({ key: "cost-change", severity: "warning" }),
      expect.objectContaining({ key: "name-sync", severity: "warning" }),
      expect.objectContaining({ key: "relation-link", severity: "danger" })
    ]));
  });

  it("accepts only official item links", () => {
    expect(isValidRelationLink("https://pay.ldxp.cn/item/a")).toBe(true);
    expect(isValidRelationLink("https://www.ldxp.cn/item/a")).toBe(true);
    expect(isValidRelationLink("https://pay.ldxp.cn.evil.example/item/a")).toBe(false);
  });
});
