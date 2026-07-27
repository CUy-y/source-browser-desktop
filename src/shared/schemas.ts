import { z } from "zod";

export const searchRequestSchema = z.object({
  keywords: z.string().trim().min(1, "请输入关键词").max(100, "关键词不能超过 100 个字符"),
  goodsType: z.string().trim().max(40).default(""),
  pages: z.number().int().min(1).max(100),
  remotePageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  speedMode: z.enum(["stable", "standard", "fast"]),
  searchScope: z.enum(["source", "public", "all"]).default("source")
}).strict();

export const jobIdSchema = z.string().uuid();
export const goodsTypeSchema = z.string().trim().min(1).max(40);
export const goodsIdSchema = z.string().trim().min(1).max(100).refine((value) => !value.startsWith("row-"), "商品 ID 不可用");

export const connectGoodsSchema = z.object({
  goodsId: goodsIdSchema,
  name: z.string().trim().min(1).max(500),
  description: z.string().max(20_000),
  categoryId: z.number().int().nonnegative(),
  addType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  addRate: z.number().finite().nonnegative().max(100_000),
  addPrice: z.number().finite().nonnegative().max(10_000_000),
  price: z.number().finite().nonnegative().max(10_000_000),
  nameSync: z.boolean(),
  descriptionSync: z.boolean()
}).strict();

export const externalUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && (url.hostname === "pay.ldxp.cn" || url.hostname.endsWith(".ldxp.cn"));
}, "只能打开链动小铺 HTTPS 链接");

const nullableNumber = z.number().finite().nullable();
const productStatusSchema = z.enum(["normal", "abnormal", "unknown"]);
const relationStateSchema = z.enum(["connected", "unconnected", "unknown"]);

export const productRecordSchema = z.object({
  id: z.string().max(100),
  productKey: z.string().max(100),
  name: z.string().max(500),
  imageUrl: z.string().max(4000),
  merchantName: z.string().max(500),
  categoryName: z.string().max(500),
  goodsType: z.string().max(100),
  description: z.string().max(20_000),
  salePrice: nullableNumber,
  costPrice: nullableNumber,
  agentPriceLimit: nullableNumber,
  stock: nullableNumber,
  sales: nullableNumber,
  status: productStatusSchema,
  statusLabel: z.string().max(100),
  relation: relationStateSchema,
  relationDetails: z.object({
    price: nullableNumber,
    addType: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    addRate: nullableNumber,
    addPrice: nullableNumber,
    nameSync: z.boolean().nullable(),
    descriptionSync: z.boolean().nullable(),
    link: z.string().max(4000)
  }).strict(),
  detailUrl: z.string().max(4000),
  sourceIndex: z.number().int().nonnegative(),
  sourceFields: z.object({
    rawStatus: z.union([z.string(), z.number()]).nullable(),
    verify: z.union([z.string(), z.number()]).nullable(),
    hasChild: z.boolean()
  }).strict(),
  dataSource: z.enum(["source-square", "public-shop"]).optional(),
  publicShopToken: z.string().max(100).optional(),
  change: z.object({
    salePriceDelta: nullableNumber,
    costPriceDelta: nullableNumber,
    previousStock: nullableNumber,
    stockDelta: nullableNumber,
    restocked: z.boolean(),
    becameOutOfStock: z.boolean(),
    statusChanged: z.boolean(),
    relationChanged: z.boolean(),
    messages: z.array(z.string().max(500)).max(20)
  }).strict().optional()
}).strict();

const localFiltersSchema = z.object({
  minSalePrice: nullableNumber,
  maxSalePrice: nullableNumber,
  stockState: z.enum(["all", "in-stock", "out-of-stock"]),
  status: z.enum(["all", "normal", "abnormal"]),
  relationState: z.enum(["all", "connected", "unconnected"]),
  categoryKeyword: z.string().max(500),
  merchantName: z.string().max(500),
  blockedKeywords: z.string().max(10_000),
  sortMode: z.enum(["default", "sale-asc", "sale-desc"])
}).strict();

export const favoriteUpdateSchema = z.object({
  product: productRecordSchema,
  note: z.string().max(5000),
  tags: z.array(z.string().trim().min(1).max(50)).max(30)
}).strict();

export const identitySchema = z.string().min(1).max(300);

export const searchPresetInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  search: searchRequestSchema,
  filters: localFiltersSchema,
  localPageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)])
}).strict();

export const presetIdSchema = z.string().uuid();
export const exportProductsSchema = z.array(productRecordSchema).max(20_000);
export const publicSourceUrlSchema = z.string().trim().url().max(4000).refine((value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.hostname !== "pay.ldxp.cn" && url.hostname !== "www.ldxp.cn")) return false;
  return /^\/(?:item|shop)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
}, "请输入链动小铺商品或店铺 HTTPS 链接");
export const publicShopTokenSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "店铺标识不正确");
export const publicCatalogSearchSchema = z.object({
  keywords: z.string().trim().max(100),
  goodsType: z.string().trim().max(40)
}).strict();
