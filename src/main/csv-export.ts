import type { ProductRecord } from "../shared/types";

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function productsToCsv(products: ProductRecord[]): string {
  const header = ["数据来源", "商品ID", "商品键", "商品名称", "商家", "分类", "售价", "成本价", "库存", "销量", "状态", "关联状态", "关联售价", "最低售价限制", "详情链接", "本次变化"];
  const rows = products.map((product) => [
    product.dataSource === "public-shop" ? "公开零售" : "货源广场",
    product.id,
    product.productKey,
    product.name,
    product.merchantName,
    product.categoryName,
    product.salePrice,
    product.costPrice,
    product.stock,
    product.sales,
    product.statusLabel,
    product.dataSource === "public-shop" ? "不可关联" : product.relation === "connected" ? "已关联" : product.relation === "unconnected" ? "未关联" : "未知",
    product.relationDetails.price,
    product.agentPriceLimit,
    product.detailUrl,
    product.change?.messages.join("；") || ""
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
