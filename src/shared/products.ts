import type { FieldCalibration, LocalFilters, ProductRecord, RelationPriceMode } from "./types";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nested = (record: UnknownRecord, path: string[]): unknown => {
  let value: unknown = record;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
};

const pick = (record: UnknownRecord, paths: string[][]): unknown => {
  for (const path of paths) {
    const value = nested(record, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const text = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return fallback;
};

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const image = (record: UnknownRecord): string => {
  const value = pick(record, [
    ["cover"], ["image"], ["image_url"], ["thumb"], ["picture"], ["images", "0"], ["user", "avatar"]
  ]);
  if (Array.isArray(record.images)) return text(record.images[0]);
  return text(value);
};

export function normalizeProduct(rawValue: unknown, sourceIndex: number, baseUrl = "https://pay.ldxp.cn"): ProductRecord {
  const raw = isRecord(rawValue) ? rawValue : {};
  const id = text(pick(raw, [["id"], ["goods_id"], ["product_id"]]), `row-${sourceIndex + 1}`);
  const productKey = text(pick(raw, [["goods_key"], ["key"], ["product_key"]]));
  const rawStatus = pick(raw, [["status"], ["goods_status"]]);
  const verify = pick(raw, [["verify"], ["verified"], ["audit_status"]]);
  const numericStatus = numberOrNull(rawStatus);
  const numericVerify = numberOrNull(verify);
  const status = numericVerify !== null && numericVerify !== 1
    ? "abnormal"
    : numericStatus === 1
      ? "normal"
      : numericStatus === null
        ? "unknown"
        : "abnormal";
  const hasChild = isRecord(raw.child) || raw.is_connect === 1 || raw.connected === true;
  const child = isRecord(raw.child) ? raw.child : {};
  const relation = hasChild
    ? "connected"
    : raw.child === null || raw.is_connect === 0 || raw.connected === false
      ? "unconnected"
      : "unknown";
  const directLink = text(pick(raw, [["link"], ["detail_url"], ["url"]]));
  const childLinkValue = text(child.link);
  const childLink = childLinkValue.startsWith("/") ? `${baseUrl}${childLinkValue}` : childLinkValue;

  return {
    id,
    productKey,
    name: text(pick(raw, [["name"], ["goods_name"], ["title"]]), "未命名商品"),
    imageUrl: image(raw),
    merchantName: text(pick(raw, [
      ["user", "nickname"], ["parent", "nickname"], ["merchant", "name"], ["shop", "name"], ["shop_name"], ["merchant_name"]
    ])),
    categoryName: text(pick(raw, [["category", "name"], ["category_name"], ["goods_category_name"]])),
    goodsType: text(pick(raw, [["goods_type"], ["type"]])),
    description: text(pick(raw, [["description"], ["goods_description"], ["content"]])),
    salePrice: numberOrNull(pick(raw, [["price"], ["sale_price"], ["real_price"], ["child", "price"]])),
    costPrice: numberOrNull(pick(raw, [["cost_price"], ["agent_price"], ["purchase_price"]])),
    agentPriceLimit: numberOrNull(pick(raw, [["agent_price_limit"], ["price_limit"]])),
    stock: numberOrNull(pick(raw, [["stock_count"], ["stock"], ["count"], ["inventory"]])),
    sales: numberOrNull(pick(raw, [["sales_count"], ["sale_count"], ["sold_count"], ["sales"]])),
    status,
    statusLabel: status === "normal" ? "正常" : status === "abnormal" ? "异常" : "未知",
    relation,
    relationDetails: {
      price: numberOrNull(child.price),
      addType: ([1, 2, 3].includes(Number(child.add_type)) ? Number(child.add_type) : null) as RelationPriceMode | null,
      addRate: numberOrNull(child.add_rate),
      addPrice: numberOrNull(child.add_price),
      nameSync: child.name_sync === undefined || child.name_sync === null ? null : Boolean(Number(child.name_sync)),
      descriptionSync: child.description_sync === undefined || child.description_sync === null ? null : Boolean(Number(child.description_sync)),
      link: childLink
    },
    detailUrl: directLink || (productKey ? `${baseUrl}/item/${encodeURIComponent(productKey)}` : ""),
    sourceIndex,
    sourceFields: {
      rawStatus: typeof rawStatus === "string" || typeof rawStatus === "number" ? rawStatus : null,
      verify: typeof verify === "string" || typeof verify === "number" ? verify : null,
      hasChild
    }
  };
}

export function productIdentity(product: Pick<ProductRecord, "productKey" | "id">): string {
  return product.productKey ? `key:${product.productKey}` : `id:${product.id}`;
}

export function parseBlockedKeywords(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function applyFilters(products: ProductRecord[], filters: LocalFilters): ProductRecord[] {
  const blocked = parseBlockedKeywords(filters.blockedKeywords);
  const categoryNeedle = filters.categoryKeyword.trim().toLocaleLowerCase();
  const merchantNeedle = filters.merchantName.trim().toLocaleLowerCase();

  const filtered = products.filter((product) => {
    if (filters.stockState === "in-stock" && !(product.stock !== null && product.stock > 0)) return false;
    if (filters.stockState === "out-of-stock" && product.stock !== 0) return false;
    if (filters.status !== "all" && product.status !== filters.status) return false;
    if (filters.relationState !== "all" && product.relation !== filters.relationState) return false;
    if (categoryNeedle && !product.categoryName.toLocaleLowerCase().includes(categoryNeedle)) return false;
    if (merchantNeedle && !product.merchantName.toLocaleLowerCase().includes(merchantNeedle)) return false;
    if (filters.minSalePrice !== null && (product.salePrice === null || product.salePrice < filters.minSalePrice)) return false;
    if (filters.maxSalePrice !== null && (product.salePrice === null || product.salePrice > filters.maxSalePrice)) return false;

    const haystack = `${product.name}\n${product.categoryName}\n${product.merchantName}`.toLocaleLowerCase();
    if (blocked.some((keyword) => haystack.includes(keyword))) return false;
    return true;
  });

  if (filters.sortMode === "default") return filtered;
  const direction = filters.sortMode === "sale-asc" ? 1 : -1;
  return filtered
    .map((product, stableIndex) => ({ product, stableIndex }))
    .sort((left, right) => {
      const leftPrice = left.product.salePrice;
      const rightPrice = right.product.salePrice;
      if (leftPrice === null && rightPrice === null) return left.stableIndex - right.stableIndex;
      if (leftPrice === null) return 1;
      if (rightPrice === null) return -1;
      const delta = (leftPrice - rightPrice) * direction;
      return delta || left.stableIndex - right.stableIndex;
    })
    .map(({ product }) => product);
}

const percentage = (count: number, total: number): number => total === 0 ? 0 : Math.round((count / total) * 100);

export function buildFieldCalibration(products: ProductRecord[]): FieldCalibration {
  const total = products.length;
  const count = (predicate: (product: ProductRecord) => boolean): number => products.filter(predicate).length;
  return {
    total,
    id: percentage(count((product) => Boolean(product.id) && !product.id.startsWith("row-")), total),
    merchant: percentage(count((product) => Boolean(product.merchantName)), total),
    category: percentage(count((product) => Boolean(product.categoryName)), total),
    salePrice: percentage(count((product) => product.salePrice !== null), total),
    costPrice: percentage(count((product) => product.costPrice !== null), total),
    stock: percentage(count((product) => product.stock !== null), total),
    sales: percentage(count((product) => product.sales !== null), total),
    status: percentage(count((product) => product.status !== "unknown"), total)
  };
}

export function paginate<T>(items: T[], page: number, pageSize: number): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: safePage, totalPages };
}
