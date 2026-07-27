import { describe, expect, it } from "vitest";
import { applyFilters, buildFieldCalibration, normalizeProduct, paginate, parseBlockedKeywords } from "./products";
import type { LocalFilters, ProductRecord } from "./types";

const filters: LocalFilters = {
  minSalePrice: null,
  maxSalePrice: null,
  stockState: "all",
  status: "all",
  relationState: "all",
  categoryKeyword: "",
  merchantName: "",
  blockedKeywords: "",
  sortMode: "default"
};

const product = (overrides: Partial<ProductRecord>): ProductRecord => ({
  id: "1",
  productKey: "abc",
  name: "商品",
  imageUrl: "",
  merchantName: "商家",
  categoryName: "分类",
  goodsType: "card",
  description: "",
  salePrice: 10,
  costPrice: 8,
  agentPriceLimit: null,
  stock: 1,
  sales: 2,
  status: "normal",
  statusLabel: "正常",
  relation: "unconnected",
  relationDetails: { price: null, addType: null, addRate: null, addPrice: null, nameSync: null, descriptionSync: null, link: "" },
  detailUrl: "https://pay.ldxp.cn/item/abc",
  sourceIndex: 0,
  sourceFields: { rawStatus: 1, verify: 1, hasChild: false },
  ...overrides
});

describe("normalizeProduct", () => {
  it("normalizes known source-square fields without leaking the complete raw object", () => {
    const result = normalizeProduct({
      id: 599161,
      goods_key: "k12-key",
      name: "K12 会员",
      price: "488.00",
      cost_price: 420,
      stock_count: "23",
      sales_count: 7,
      status: 1,
      verify: 1,
      category: { name: "Claude" },
      user: { nickname: "老马AI" },
      child: null,
      secret: "must-not-be-copied"
    }, 0);

    expect(result).toMatchObject({
      id: "599161",
      productKey: "k12-key",
      name: "K12 会员",
      merchantName: "老马AI",
      categoryName: "Claude",
      salePrice: 488,
      costPrice: 420,
      stock: 23,
      sales: 7,
      status: "normal",
      relation: "unconnected",
      detailUrl: "https://pay.ldxp.cn/item/k12-key"
    });
    expect(result.sourceFields).not.toHaveProperty("secret");
  });

  it("uses null for missing or invalid numeric values", () => {
    const result = normalizeProduct({ id: 2, name: "空字段", price: "not-a-number" }, 1);
    expect(result.salePrice).toBeNull();
    expect(result.costPrice).toBeNull();
    expect(result.stock).toBeNull();
    expect(result.status).toBe("unknown");
  });

  it("calibrates the official child field into the association state", () => {
    expect(normalizeProduct({ id: 1, goods_key: "a", child: { id: 88 } }, 0).relation).toBe("connected");
    expect(normalizeProduct({ id: 2, goods_key: "b", child: null }, 1).relation).toBe("unconnected");
  });
});

describe("filtering and sorting", () => {
  const rows = [
    product({ id: "a", name: "K12 中转", merchantName: "甲店", categoryName: "AI", salePrice: 30, stock: 3, sourceIndex: 0 }),
    product({ id: "b", name: "Claude 正品", merchantName: "乙店", categoryName: "会员", salePrice: 10, stock: 0, relation: "connected", sourceIndex: 1 }),
    product({ id: "c", name: "GPT 正品", merchantName: "甲店", categoryName: "AI", salePrice: 10, stock: 8, sourceIndex: 2 }),
    product({ id: "d", name: "未知价", salePrice: null, stock: 1, status: "abnormal", sourceIndex: 3 })
  ];

  it("splits Chinese commas, ASCII commas and newlines", () => {
    expect(parseBlockedKeywords("free, 镜像，K12\n中转")).toEqual(["free", "镜像", "k12", "中转"]);
  });

  it("filters by sale-price bounds and blocked text across product, category and merchant", () => {
    const result = applyFilters(rows, {
      ...filters,
      minSalePrice: 5,
      maxSalePrice: 30,
      blockedKeywords: "中转,乙店"
    });
    expect(result.map((item) => item.id)).toEqual(["c"]);
  });

  it("supports stock, status, category and merchant filters", () => {
    expect(applyFilters(rows, { ...filters, stockState: "in-stock", status: "normal", categoryKeyword: "ai", merchantName: "甲" }).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("filters by relation state", () => {
    expect(applyFilters(rows, { ...filters, relationState: "connected" }).map((item) => item.id)).toEqual(["b"]);
    expect(applyFilters(rows, { ...filters, relationState: "unconnected" }).map((item) => item.id)).toEqual(["a", "c", "d"]);
    expect(applyFilters([...rows, product({ id: "public", dataSource: "public-shop", relation: "unknown" })], { ...filters, relationState: "unconnected" }).map((item) => item.id)).not.toContain("public");
  });

  it("sorts by sale price stably and places missing prices last", () => {
    expect(applyFilters(rows, { ...filters, sortMode: "sale-asc" }).map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
    expect(applyFilters(rows, { ...filters, sortMode: "sale-desc" }).map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("field calibration", () => {
  it("reports field coverage from the current real result shape", () => {
    const calibration = buildFieldCalibration([
      product({ id: "1", merchantName: "甲", categoryName: "AI", salePrice: 10, costPrice: 8, stock: 1, sales: null }),
      product({ id: "row-2", merchantName: "", categoryName: "AI", salePrice: null, costPrice: 9, stock: 0, sales: null, status: "unknown" })
    ]);
    expect(calibration).toMatchObject({
      total: 2,
      id: 50,
      merchant: 50,
      category: 100,
      salePrice: 50,
      costPrice: 100,
      stock: 100,
      sales: 0,
      status: 50
    });
  });
});

describe("paginate", () => {
  it("clamps invalid pages and reports at least one page", () => {
    expect(paginate([], 8, 10)).toEqual({ rows: [], page: 1, totalPages: 1 });
    expect(paginate([1, 2, 3, 4, 5], 5, 2)).toEqual({ rows: [5], page: 3, totalPages: 3 });
  });
});
