export type StockState = "all" | "in-stock" | "out-of-stock";
export type ProductStatusFilter = "all" | "normal" | "abnormal";
export type RelationStateFilter = "all" | "connected" | "unconnected";
export type SortMode = "default" | "sale-asc" | "sale-desc";
export type SearchSpeedMode = "stable" | "standard" | "fast";

export interface SearchRequest {
  keywords: string;
  goodsType: string;
  pages: number;
  remotePageSize: 20 | 50 | 100;
  speedMode: SearchSpeedMode;
}

export interface LocalFilters {
  minSalePrice: number | null;
  maxSalePrice: number | null;
  stockState: StockState;
  status: ProductStatusFilter;
  relationState: RelationStateFilter;
  categoryKeyword: string;
  merchantName: string;
  blockedKeywords: string;
  sortMode: SortMode;
}

export interface ProductRecord {
  id: string;
  productKey: string;
  name: string;
  imageUrl: string;
  merchantName: string;
  categoryName: string;
  goodsType: string;
  description: string;
  salePrice: number | null;
  costPrice: number | null;
  agentPriceLimit: number | null;
  stock: number | null;
  sales: number | null;
  status: "normal" | "abnormal" | "unknown";
  statusLabel: string;
  relation: "connected" | "unconnected" | "unknown";
  relationDetails: {
    price: number | null;
    addType: RelationPriceMode | null;
    addRate: number | null;
    addPrice: number | null;
    nameSync: boolean | null;
    descriptionSync: boolean | null;
    link: string;
  };
  detailUrl: string;
  sourceIndex: number;
  change?: ProductChangeSummary;
  sourceFields: {
    rawStatus: string | number | null;
    verify: string | number | null;
    hasChild: boolean;
  };
}

export interface ProductChangeSummary {
  salePriceDelta: number | null;
  costPriceDelta: number | null;
  previousStock: number | null;
  stockDelta: number | null;
  restocked: boolean;
  becameOutOfStock: boolean;
  statusChanged: boolean;
  relationChanged: boolean;
  messages: string[];
}

export interface GoodsCategoryOption {
  id: number;
  name: string;
}

export type RelationPriceMode = 1 | 2 | 3;

export interface ConnectGoodsRequest {
  goodsId: string;
  name: string;
  description: string;
  categoryId: number;
  addType: RelationPriceMode;
  addRate: number;
  addPrice: number;
  price: number;
  nameSync: boolean;
  descriptionSync: boolean;
}

export interface AuthStatus {
  authenticated: boolean;
  displayName?: string;
  username?: string;
  persistent?: boolean;
  message?: string;
}

export interface FavoriteRecord {
  identity: string;
  product: ProductRecord;
  note: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FavoriteUpdate {
  product: ProductRecord;
  note: string;
  tags: string[];
}

export interface FavoritePricePoint {
  recordedAt: number;
  salePrice: number | null;
  costPrice: number | null;
  stock: number | null;
}

export interface SearchPreset {
  id: string;
  name: string;
  search: SearchRequest;
  filters: LocalFilters;
  localPageSize: 10 | 20 | 50 | 100;
  createdAt: number;
  updatedAt: number;
}

export interface SearchPresetInput {
  id?: string;
  name: string;
  search: SearchRequest;
  filters: LocalFilters;
  localPageSize: 10 | 20 | 50 | 100;
}

export type MonitorEventType = "sale-price" | "cost-price" | "stock" | "status" | "relation" | "removed";

export interface MonitorEvent {
  id: string;
  identity: string;
  productName: string;
  productKey: string;
  detailUrl: string;
  scopeKey: string;
  type: MonitorEventType;
  message: string;
  favorite: boolean;
  createdAt: number;
}

export interface MonitorRunSummary {
  scopeKey: string;
  recordedAt: number;
  coverageComplete: boolean;
  baselineCreated: boolean;
  changedProducts: number;
  favoriteChanges: number;
  favoriteRefreshTotal: number;
  favoriteRefreshLoaded: number;
  favoriteRefreshFailed: number;
}

export interface LocalLibraryState {
  favorites: FavoriteRecord[];
  presets: SearchPreset[];
  monitorEvents: MonitorEvent[];
  priceHistory: Record<string, FavoritePricePoint[]>;
}

export type SearchJobStatus = "running" | "done" | "failed" | "cancelled";

export interface FieldCalibration {
  total: number;
  id: number;
  merchant: number;
  category: number;
  salePrice: number;
  costPrice: number;
  stock: number;
  sales: number;
  status: number;
}

export interface SearchJobProgress {
  id: string;
  status: SearchJobStatus;
  currentPage: number;
  loadedPages: number;
  totalPages: number;
  requestedPages: number;
  totalPagesResolved: boolean;
  remoteTotalPages: number;
  coverageComplete: boolean;
  favoriteRefreshCurrent: number;
  favoriteRefreshTotal: number;
  speedMode: SearchSpeedMode;
  concurrency: 1 | 2;
  throttleMs: number;
  loaded: number;
  total: number;
  error?: string;
  result?: ProductRecord[];
  calibration?: FieldCalibration;
  monitor?: MonitorRunSummary;
}

export interface SourceBrowserApi {
  auth: {
    getStatus(): Promise<AuthStatus>;
    openOfficialLogin(): Promise<{ opened: boolean }>;
    logout(): Promise<AuthStatus>;
  };
  catalog: {
    startSearch(request: SearchRequest): Promise<{ jobId: string }>;
    getProgress(jobId: string): Promise<SearchJobProgress>;
    cancel(jobId: string): Promise<SearchJobProgress>;
    getGoodsCategories(goodsType: string): Promise<GoodsCategoryOption[]>;
    connectGoods(request: ConnectGoodsRequest): Promise<{ connected: boolean; message: string }>;
    disconnectGoods(goodsId: string): Promise<{ disconnected: boolean; message: string }>;
    exportCsv(products: ProductRecord[]): Promise<{ exported: boolean; filePath?: string }>;
  };
  local: {
    getState(): Promise<LocalLibraryState>;
    upsertFavorite(update: FavoriteUpdate): Promise<LocalLibraryState>;
    removeFavorite(identity: string): Promise<LocalLibraryState>;
    savePreset(input: SearchPresetInput): Promise<LocalLibraryState>;
    deletePreset(id: string): Promise<LocalLibraryState>;
  };
  system: {
    openExternal(url: string): Promise<{ opened: boolean }>;
    checkOfficialLink(url: string): Promise<{ valid: boolean; status: number | null }>;
  };
}
