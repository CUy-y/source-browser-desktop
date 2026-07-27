import { net } from "electron";
import { productIdentity } from "../shared/products";
import type {
  LocalLibraryState,
  ProductRecord,
  PublicCatalogMutationResult,
  PublicCatalogSearchRequest,
  PublicShopSnapshot,
  PublicShopSummary
} from "../shared/types";
import { PLATFORM_BASE_URL } from "./constants";
import type { LocalDataStore } from "./local-data-store";

type JsonRecord = Record<string, unknown>;
type PublicFetcher = (url: string, init: RequestInit) => Promise<Response>;

const SUPPORTED_GOODS_TYPES = ["card", "article", "resource", "equity"] as const;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const REQUEST_GAP_MS = 250;

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function nestedRecord(value: unknown, key: string): JsonRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] as JsonRecord : {};
}

export function parsePublicSource(rawUrl: string): { kind: "item" | "shop"; value: string } {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || (url.hostname !== "pay.ldxp.cn" && url.hostname !== "www.ldxp.cn")) {
    throw new Error("只支持链动小铺 HTTPS 商品或店铺链接");
  }
  const match = url.pathname.match(/^\/(item|shop)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) throw new Error("链接必须是 /item/商品键 或 /shop/店铺标识");
  return { kind: match[1] as "item" | "shop", value: match[2] };
}

export function normalizePublicProduct(rawValue: unknown, shopToken: string, shopName: string, sourceIndex: number): ProductRecord {
  const raw = isRecord(rawValue) ? rawValue : {};
  const user = nestedRecord(raw, "user");
  const category = nestedRecord(raw, "category");
  const extend = nestedRecord(raw, "extend");
  const productKey = text(raw.goods_key ?? raw.key);
  const rawStatus = raw.status ?? raw.goods_status;
  const numericStatus = numberOrNull(rawStatus);
  const rawVerify = raw.verify ?? raw.audit_status;
  const numericVerify = numberOrNull(rawVerify);
  const status = numericVerify !== null && numericVerify !== 1
    ? "abnormal"
    : numericStatus !== null && numericStatus !== 1
      ? "abnormal"
      : "normal";
  const directLink = text(raw.link ?? raw.url);
  return {
    id: text(raw.id ?? raw.goods_id) || (productKey ? `public-${productKey}` : `public-row-${sourceIndex + 1}`),
    productKey,
    name: text(raw.name ?? raw.goods_name ?? raw.title) || "未命名商品",
    imageUrl: text(raw.image ?? raw.image_url ?? raw.cover),
    merchantName: text(user.nickname ?? user.name) || shopName || shopToken,
    categoryName: text(category.name ?? raw.category_name),
    goodsType: text(raw.goods_type ?? raw.type),
    description: text(raw.description ?? raw.content),
    salePrice: numberOrNull(raw.price ?? raw.real_price ?? raw.sale_price),
    costPrice: null,
    agentPriceLimit: null,
    stock: numberOrNull(extend.stock_count ?? raw.stock_count ?? raw.stock),
    sales: numberOrNull(raw.sales_count ?? raw.sale_count ?? raw.sales),
    status,
    statusLabel: status === "normal" ? "正常" : "异常",
    relation: "unknown",
    relationDetails: { price: null, addType: null, addRate: null, addPrice: null, nameSync: null, descriptionSync: null, link: "" },
    detailUrl: directLink || (productKey ? `${PLATFORM_BASE_URL}/item/${encodeURIComponent(productKey)}` : ""),
    sourceIndex,
    sourceFields: {
      rawStatus: typeof rawStatus === "string" || typeof rawStatus === "number" ? rawStatus : null,
      verify: typeof rawVerify === "string" || typeof rawVerify === "number" ? rawVerify : null,
      hasChild: false
    },
    dataSource: "public-shop",
    publicShopToken: shopToken
  };
}

export class PublicCatalogService {
  constructor(
    private readonly localData: LocalDataStore,
    private readonly fetcher: PublicFetcher = (url, init) => net.fetch(url, init)
  ) {}

  search(request: PublicCatalogSearchRequest): ProductRecord[] {
    const needle = request.keywords.trim().toLocaleLowerCase();
    const seen = new Set<string>();
    return this.localData.getPublicShopSnapshots().flatMap((shop) => shop.products).flatMap((product, sourceIndex) => {
      if (request.goodsType && product.goodsType !== request.goodsType) return [];
      const haystack = `${product.name}\n${product.categoryName}\n${product.merchantName}\n${product.productKey}`.toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) return [];
      const identity = productIdentity(product);
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ ...product, sourceIndex, dataSource: "public-shop" as const }];
    });
  }

  async addSource(rawUrl: string): Promise<PublicCatalogMutationResult> {
    const source = parsePublicSource(rawUrl);
    let token = source.value;
    let seed: JsonRecord | undefined;
    if (source.kind === "item") {
      seed = await this.requestData("/shopApi/Shop/goodsInfo", { goods_key: source.value, trade_no: "" }, `${PLATFORM_BASE_URL}/item/${source.value}`);
      const user = nestedRecord(seed, "user");
      token = text(user.token);
      if (!token) throw new Error("商品详情没有返回所属店铺，无法收录整店");
    }
    const state = await this.refreshShopInternal(token, seed);
    const shop = state.publicShops.find((item) => item.token === token);
    return { state, shop, message: `已收录“${shop?.name || token}”，共 ${shop?.goodsCount ?? 0} 个公开商品` };
  }

  async refreshShop(token: string): Promise<PublicCatalogMutationResult> {
    try {
      const state = await this.refreshShopInternal(token);
      const shop = state.publicShops.find((item) => item.token === token);
      return { state, shop, message: `已刷新“${shop?.name || token}”，共 ${shop?.goodsCount ?? 0} 个公开商品` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "公开店铺刷新失败";
      this.localData.markPublicShopError(token, message);
      throw new Error(message);
    }
  }

  async refreshAll(): Promise<PublicCatalogMutationResult> {
    const shops = this.localData.getPublicShopSnapshots();
    let imported = 0;
    let failed = 0;
    for (const shop of shops) {
      try {
        await this.refreshShopInternal(shop.token);
        imported += 1;
      } catch (error) {
        failed += 1;
        this.localData.markPublicShopError(shop.token, error instanceof Error ? error.message : "刷新失败");
      }
      await delay(REQUEST_GAP_MS);
    }
    const state = this.localData.getState();
    return { state, imported, failed, message: `公开店铺刷新完成：成功 ${imported}，失败 ${failed}` };
  }

  removeShop(token: string): PublicCatalogMutationResult {
    const state = this.localData.removePublicShop(token);
    return { state, message: "已从本机公开店铺库移除" };
  }

  async importSources(urls: string[]): Promise<PublicCatalogMutationResult> {
    let imported = 0;
    let failed = 0;
    const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 500);
    for (const url of unique) {
      try {
        await this.addSource(url);
        imported += 1;
      } catch {
        failed += 1;
      }
      await delay(REQUEST_GAP_MS);
    }
    const state = this.localData.getState();
    return { state, imported, failed, message: `导入完成：成功 ${imported}，失败 ${failed}` };
  }

  exportSources(): Array<{ token: string; name: string; url: string }> {
    return this.localData.getState().publicShops.map(({ token, name, url }) => ({ token, name, url }));
  }

  private async refreshShopInternal(token: string, seed?: JsonRecord): Promise<LocalLibraryState> {
    const info = await this.requestData("/shopApi/Shop/info", { token, category_key: "" }, `${PLATFORM_BASE_URL}/shop/${token}`);
    const shopName = text(info.nickname ?? info.name) || token;
    const rawTypeSort = info.goods_type_sort;
    const declaredTypes = Array.isArray(rawTypeSort)
      ? rawTypeSort.flatMap((value) => isRecord(value) ? [text(value.goods_type ?? value.type ?? value.key)] : [text(value)])
      : typeof rawTypeSort === "string"
        ? rawTypeSort.split(/[,，\s]+/).map(text)
        : isRecord(rawTypeSort)
          ? Object.keys(rawTypeSort)
          : [];
    const supportedTypes = [...new Set(declaredTypes)]
      .filter((value): value is typeof SUPPORTED_GOODS_TYPES[number] => SUPPORTED_GOODS_TYPES.includes(value as typeof SUPPORTED_GOODS_TYPES[number]));
    const goodsTypes = supportedTypes.length ? supportedTypes : [...SUPPORTED_GOODS_TYPES];
    const products: ProductRecord[] = [];
    const seen = new Set<string>();

    for (const goodsType of goodsTypes) {
      const declaredCount = numberOrNull(info[`${goodsType}_count`]);
      if (declaredCount === 0) continue;
      let typeLoaded = 0;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await this.requestData("/shopApi/Shop/goodsList", {
          token,
          keywords: "",
          category_id: 0,
          goods_type: goodsType,
          current: page,
          pageSize: PAGE_SIZE
        }, `${PLATFORM_BASE_URL}/shop/${token}`);
        const list = Array.isArray(data.list) ? data.list : [];
        typeLoaded += list.length;
        for (const raw of list) {
          const normalizedRaw = isRecord(raw) && !text(raw.goods_type ?? raw.type)
            ? { ...raw, goods_type: goodsType }
            : raw;
          const product = normalizePublicProduct(normalizedRaw, token, shopName, products.length);
          const identity = productIdentity(product);
          if (!product.productKey || seen.has(identity)) continue;
          seen.add(identity);
          products.push(product);
        }
        const total = numberOrNull(data.total);
        if (!list.length || (total !== null ? typeLoaded >= total : list.length < PAGE_SIZE)) break;
        await delay(REQUEST_GAP_MS);
      }
      await delay(REQUEST_GAP_MS);
    }

    if (seed) {
      const product = normalizePublicProduct(seed, token, shopName, products.length);
      const identity = productIdentity(product);
      if (product.productKey && !seen.has(identity)) products.push(product);
    }

    const now = Date.now();
    const previous = this.localData.getPublicShopSnapshots().find((shop) => shop.token === token);
    const snapshot: PublicShopSnapshot = {
      token,
      name: shopName,
      url: text(info.link) || `${PLATFORM_BASE_URL}/shop/${encodeURIComponent(token)}`,
      goodsCount: products.length,
      products,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastError: ""
    };
    return this.localData.upsertPublicShop(snapshot);
  }

  private async requestData(endpoint: string, payload: JsonRecord, referer: string): Promise<JsonRecord> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(`${PLATFORM_BASE_URL}${endpoint}`, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Content-Type": "application/json",
            Origin: PLATFORM_BASE_URL,
            Referer: referer,
            "User-Agent": "Mozilla/5.0 source-browser-desktop/1.9"
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000)
        });
        const rawText = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          throw new Error("公开接口返回了验证页或非 JSON 内容，请稍后重试");
        }
        if (!isRecord(parsed)) throw new Error("公开接口响应格式不正确");
        if (response.status === 429) throw new Error("公开接口请求过于频繁，请稍后重试");
        if (!response.ok) throw new Error(text(parsed.msg) || `公开接口 HTTP ${response.status}`);
        if (Number(parsed.code) !== 1) throw new Error(text(parsed.msg) || "公开接口返回失败");
        if (!isRecord(parsed.data)) throw new Error("公开接口没有返回有效数据");
        return parsed.data;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "公开接口请求失败";
        if (message.includes("频繁") || message.includes("验证页") || attempt >= 2) throw error;
        await delay(400 * (attempt + 1));
      }
    }
    throw lastError;
  }
}

export function publicShopSummary(snapshot: PublicShopSnapshot): PublicShopSummary {
  const { products, ...summary } = snapshot;
  return { ...summary, goodsCount: products.length };
}
