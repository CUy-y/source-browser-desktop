import { describe, expect, it } from "vitest";
import type { ProductRecord } from "../shared/types";
import { productsToCsv } from "./csv-export";

describe("productsToCsv", () => {
  it("exports UTF-8 BOM CSV and escapes commas, quotes and changes", () => {
    const product = {
      id: "1", productKey: "a", name: "商品,\"A\"", imageUrl: "", merchantName: "商家", categoryName: "分类", goodsType: "card", description: "",
      salePrice: 10, costPrice: 8, agentPriceLimit: null, stock: 2, sales: 1, status: "normal", statusLabel: "正常", relation: "unconnected",
      relationDetails: { price: null, addType: null, addRate: null, addPrice: null, nameSync: null, descriptionSync: null, link: "" },
      detailUrl: "https://pay.ldxp.cn/item/a", sourceIndex: 0, sourceFields: { rawStatus: 1, verify: 1, hasChild: false },
      change: { salePriceDelta: -2, costPriceDelta: null, previousStock: 1, stockDelta: 1, restocked: false, becameOutOfStock: false, statusChanged: false, relationChanged: false, messages: ["售价较上次降低 2 元"] }
    } satisfies ProductRecord;
    const csv = productsToCsv([product]);
    expect(csv.startsWith("\uFEFF数据来源,商品ID")).toBe(true);
    expect(csv).toContain('"商品,""A"""');
    expect(csv).toContain("售价较上次降低 2 元");
  });
});
