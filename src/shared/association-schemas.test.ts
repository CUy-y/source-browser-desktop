import { describe, expect, it } from "vitest";
import { connectGoodsSchema } from "./schemas";

describe("association schemas", () => {
  it("validates explicit merchant association writes", () => {
    const value = connectGoodsSchema.parse({
      goodsId: "599161",
      name: "K12 会员",
      description: "商品说明",
      categoryId: 0,
      addType: 1,
      addRate: 10,
      addPrice: 0,
      price: 462,
      nameSync: true,
      descriptionSync: true
    });
    expect(value.goodsId).toBe("599161");
    expect(() => connectGoodsSchema.parse({ ...value, goodsId: "row-1" })).toThrow();
    expect(() => connectGoodsSchema.parse({ ...value, addType: 4 })).toThrow();
    expect(() => connectGoodsSchema.parse({ ...value, price: Number.NaN })).toThrow();
  });
});
