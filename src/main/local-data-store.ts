import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productIdentity } from "../shared/products";
import type {
  FavoriteRecord,
  FavoritePricePoint,
  FavoriteUpdate,
  LocalLibraryState,
  MonitorEvent,
  MonitorRunSummary,
  ProductChangeSummary,
  ProductRecord,
  SearchPreset,
  SearchPresetInput,
  SearchRequest
} from "../shared/types";

type SnapshotProduct = {
  identity: string;
  productKey: string;
  name: string;
  detailUrl: string;
  salePrice: number | null;
  costPrice: number | null;
  stock: number | null;
  status: ProductRecord["status"];
  relation: ProductRecord["relation"];
};

type Snapshot = {
  recordedAt: number;
  coverageComplete: boolean;
  products: Record<string, SnapshotProduct>;
};

type PersistedState = {
  version: 1;
  favorites: Record<string, FavoriteRecord>;
  presets: SearchPreset[];
  monitorEvents: MonitorEvent[];
  scopes: Record<string, Snapshot[]>;
  priceHistory: Record<string, FavoritePricePoint[]>;
};

export type SnapshotResult = {
  summary: MonitorRunSummary;
  changes: Record<string, ProductChangeSummary>;
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
export const PRICE_BUCKET_MS = 30 * 60 * 1000;
const emptyState = (): PersistedState => ({ version: 1, favorites: {}, presets: [], monitorEvents: [], scopes: {}, priceHistory: {} });
const cleanProduct = (product: ProductRecord): ProductRecord => {
  const { change: _change, ...rest } = product;
  return rest;
};
const snapshotProduct = (product: ProductRecord): SnapshotProduct => ({
  identity: productIdentity(product),
  productKey: product.productKey,
  name: product.name,
  detailUrl: product.detailUrl,
  salePrice: product.salePrice,
  costPrice: product.costPrice,
  stock: product.stock,
  status: product.status,
  relation: product.relation
});
const delta = (current: number | null, previous: number | null): number | null => current === null || previous === null ? null : current - previous;
const amount = (value: number): string => Math.abs(value).toFixed(2).replace(/\.00$/, "");

export function snapshotScopeKey(request: Pick<SearchRequest, "keywords" | "goodsType">): string {
  return `${request.goodsType.trim().toLocaleLowerCase()}::${request.keywords.trim().toLocaleLowerCase()}`;
}

export class LocalDataStore {
  private state: PersistedState;

  constructor(private readonly filePath: string) {
    this.state = this.read();
  }

  getState(): LocalLibraryState {
    const historyCutoff = Date.now() - THREE_DAYS_MS;
    return {
      favorites: Object.values(this.state.favorites).sort((left, right) => right.updatedAt - left.updatedAt),
      presets: [...this.state.presets].sort((left, right) => right.updatedAt - left.updatedAt),
      monitorEvents: this.state.monitorEvents.slice(0, 500),
      priceHistory: Object.fromEntries(Object.entries(this.state.priceHistory)
        .map(([identity, points]) => [identity, points.filter((point) => point.recordedAt >= historyCutoff)] as const)
        .filter(([, points]) => points.length > 0))
    };
  }

  getFavorites(): FavoriteRecord[] {
    return this.getState().favorites;
  }

  upsertFavorite(update: FavoriteUpdate): LocalLibraryState {
    const identity = productIdentity(update.product);
    const previous = this.state.favorites[identity];
    const now = Date.now();
    this.state.favorites[identity] = {
      identity,
      product: cleanProduct(update.product),
      note: update.note.trim(),
      tags: [...new Set(update.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 30),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    this.write();
    return this.getState();
  }

  removeFavorite(identity: string): LocalLibraryState {
    delete this.state.favorites[identity];
    this.write();
    return this.getState();
  }

  savePreset(input: SearchPresetInput): LocalLibraryState {
    const now = Date.now();
    const previous = input.id ? this.state.presets.find((preset) => preset.id === input.id) : undefined;
    const preset: SearchPreset = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    this.state.presets = [preset, ...this.state.presets.filter((item) => item.id !== preset.id)].slice(0, 100);
    this.write();
    return this.getState();
  }

  deletePreset(id: string): LocalLibraryState {
    this.state.presets = this.state.presets.filter((preset) => preset.id !== id);
    this.write();
    return this.getState();
  }

  recordSuccessfulSnapshot(
    request: SearchRequest,
    products: ProductRecord[],
    coverageComplete: boolean,
    favoriteSamples: ProductRecord[] = [],
    favoriteRefreshFailed = 0
  ): SnapshotResult {
    const scopeKey = snapshotScopeKey(request);
    const history = this.state.scopes[scopeKey] ?? [];
    const previous = history.find((snapshot) => snapshot.coverageComplete);
    const now = Date.now();
    const currentProducts = Object.fromEntries(products.map((product) => {
      const snapshot = snapshotProduct(product);
      return [snapshot.identity, snapshot];
    }));
    const changes: Record<string, ProductChangeSummary> = {};
    const events: MonitorEvent[] = [];

    if (coverageComplete && previous) {
      for (const current of Object.values(currentProducts)) {
        const before = previous.products[current.identity];
        if (!before) continue;
        const salePriceDelta = delta(current.salePrice, before.salePrice);
        const costPriceDelta = delta(current.costPrice, before.costPrice);
        const stockDelta = delta(current.stock, before.stock);
        const messages: string[] = [];
        const typedMessages: Array<{ type: MonitorEvent["type"]; message: string }> = [];
        if (salePriceDelta) typedMessages.push({ type: "sale-price", message: `售价较上次${salePriceDelta < 0 ? "降低" : "上涨"} ${amount(salePriceDelta)} 元` });
        if (costPriceDelta) typedMessages.push({ type: "cost-price", message: `成本价较上次${costPriceDelta < 0 ? "降低" : "上涨"} ${amount(costPriceDelta)} 元` });
        if (before.stock === 0 && current.stock !== null && current.stock > 0) typedMessages.push({ type: "stock", message: `库存从 0 恢复到 ${current.stock}` });
        else if (current.stock === 0 && before.stock !== 0) typedMessages.push({ type: "stock", message: `库存从 ${before.stock ?? "未知"} 变为 0` });
        else if (stockDelta) typedMessages.push({ type: "stock", message: `库存从 ${before.stock} 变为 ${current.stock}` });
        if (current.status !== before.status) typedMessages.push({ type: "status", message: `状态从 ${before.status} 变为 ${current.status}` });
        if (current.relation !== before.relation) typedMessages.push({ type: "relation", message: `关联状态从 ${before.relation} 变为 ${current.relation}` });
        messages.push(...typedMessages.map((item) => item.message));
        if (!messages.length) continue;
        changes[current.identity] = {
          salePriceDelta,
          costPriceDelta,
          previousStock: before.stock,
          stockDelta,
          restocked: before.stock === 0 && current.stock !== null && current.stock > 0,
          becameOutOfStock: current.stock === 0 && before.stock !== 0,
          statusChanged: current.status !== before.status,
          relationChanged: current.relation !== before.relation,
          messages
        };
        const favorite = Boolean(this.state.favorites[current.identity]);
        for (const typed of typedMessages) events.push(this.event(scopeKey, current, typed.type, typed.message, favorite, now));
      }

      for (const before of Object.values(previous.products)) {
        if (currentProducts[before.identity] || (!this.state.favorites[before.identity] && before.relation !== "connected")) continue;
        const message = "完整拉取中未再出现，可能已下架或不再属于当前货源范围";
        events.push(this.event(scopeKey, before, "removed", message, Boolean(this.state.favorites[before.identity]), now));
      }
    }

    const historyCutoff = now - THREE_DAYS_MS;
    for (const [identity, points] of Object.entries(this.state.priceHistory)) {
      const retained = points.filter((point) => point.recordedAt >= historyCutoff);
      if (retained.length) this.state.priceHistory[identity] = retained;
      else delete this.state.priceHistory[identity];
    }
    {
      const samples = new Map<string, ProductRecord>();
      for (const product of [...products, ...favoriteSamples]) {
        const identity = productIdentity(product);
        if (this.state.favorites[identity] && product.stock !== null && product.stock > 0) samples.set(identity, product);
      }
      for (const [identity, product] of samples) {
        const favorite = this.state.favorites[identity];
        this.state.favorites[identity] = { ...favorite, product: cleanProduct(product), updatedAt: now };
        this.state.priceHistory[identity] = mergePricePoint(this.state.priceHistory[identity] ?? [], {
          recordedAt: now,
          salePrice: product.salePrice,
          costPrice: product.costPrice,
          stock: product.stock
        }).filter((point) => point.recordedAt >= historyCutoff).slice(-500);
      }
    }

    const snapshot: Snapshot = { recordedAt: now, coverageComplete, products: currentProducts };
    const nextHistory = [snapshot, ...history];
    const latestComplete = nextHistory.find((item) => item.coverageComplete);
    const retained = nextHistory.slice(0, 3);
    if (latestComplete && !retained.includes(latestComplete)) retained.push(latestComplete);
    this.state.scopes[scopeKey] = retained;
    const scopeEntries = Object.entries(this.state.scopes).sort((left, right) => (right[1][0]?.recordedAt ?? 0) - (left[1][0]?.recordedAt ?? 0));
    this.state.scopes = Object.fromEntries(scopeEntries.slice(0, 12));
    this.state.monitorEvents = [...events.reverse(), ...this.state.monitorEvents].slice(0, 500);
    this.write();

    return {
      summary: {
        scopeKey,
        recordedAt: now,
        coverageComplete,
        baselineCreated: coverageComplete && !previous,
        changedProducts: Object.keys(changes).length + events.filter((event) => event.type === "removed").length,
        favoriteChanges: events.filter((event) => event.favorite).length,
        favoriteRefreshTotal: favoriteSamples.length + favoriteRefreshFailed,
        favoriteRefreshLoaded: favoriteSamples.length,
        favoriteRefreshFailed
      },
      changes
    };
  }

  private event(scopeKey: string, product: SnapshotProduct, type: MonitorEvent["type"], message: string, favorite: boolean, createdAt: number): MonitorEvent {
    return {
      id: crypto.randomUUID(),
      identity: product.identity,
      productName: product.name,
      productKey: product.productKey,
      detailUrl: product.detailUrl,
      scopeKey,
      type,
      message,
      favorite,
      createdAt
    };
  }

  private read(): PersistedState {
    try {
      if (!fs.existsSync(this.filePath)) return emptyState();
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
      return {
        version: 1,
        favorites: parsed.favorites && typeof parsed.favorites === "object" ? parsed.favorites : {},
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
        monitorEvents: Array.isArray(parsed.monitorEvents) ? parsed.monitorEvents : [],
        scopes: parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {},
        priceHistory: parsed.priceHistory && typeof parsed.priceHistory === "object" ? parsed.priceHistory : {}
      };
    } catch {
      return emptyState();
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
  }
}

export function mergePricePoint(points: FavoritePricePoint[], point: FavoritePricePoint): FavoritePricePoint[] {
  const bucketStart = Math.floor(point.recordedAt / PRICE_BUCKET_MS) * PRICE_BUCKET_MS;
  const existingIndex = points.findIndex((candidate) => candidate.recordedAt === bucketStart);
  const normalized = { ...point, recordedAt: bucketStart };
  if (existingIndex < 0) return [...points, normalized].sort((left, right) => left.recordedAt - right.recordedAt);
  const existing = points[existingIndex];
  const minimum = (left: number | null, right: number | null): number | null => left === null ? right : right === null ? left : Math.min(left, right);
  const merged: FavoritePricePoint = {
    recordedAt: bucketStart,
    salePrice: minimum(existing.salePrice, normalized.salePrice),
    costPrice: minimum(existing.costPrice, normalized.costPrice),
    stock: normalized.stock
  };
  return points.map((candidate, index) => index === existingIndex ? merged : candidate);
}
