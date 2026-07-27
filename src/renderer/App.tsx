import { useEffect, useMemo, useRef, useState } from "react";
import { applyFilters, buildFieldCalibration, paginate, productIdentity } from "../shared/products";
import { evaluateRelationHealth } from "../shared/relation-health";
import { normalizeRequestedPagesOnBlur, parseRequestedPages } from "../shared/search-input";
import type { AuthStatus, ConnectGoodsRequest, FavoriteRecord, FieldCalibration, GoodsCategoryOption, LocalFilters, LocalLibraryState, ProductRecord, RelationPriceMode, SearchPreset, SearchJobProgress, SearchRequest, SearchScope } from "../shared/types";
import { PriceHistoryChart } from "./PriceHistoryChart";

type FormState = LocalFilters & Omit<SearchRequest, "pages" | "searchScope"> & {
  searchScope: SearchScope;
  pagesInput: string;
  localPageSize: 10 | 20 | 50 | 100;
};

type ConnectFormState = Omit<ConnectGoodsRequest, "goodsId" | "price">;

const SETTINGS_KEY = "ldxp-source-browser-settings-v1";
const emptyLibrary: LocalLibraryState = { favorites: [], presets: [], monitorEvents: [], priceHistory: {}, publicShops: [] };

const defaults: FormState = {
  keywords: "",
  searchScope: "source",
  goodsType: "",
  pagesInput: "50",
  remotePageSize: 50,
  speedMode: "fast",
  minSalePrice: null,
  maxSalePrice: null,
  stockState: "in-stock",
  status: "normal",
  relationState: "all",
  categoryKeyword: "",
  merchantName: "",
  blockedKeywords: "",
  sortMode: "default",
  localPageSize: 10
};

const loadSettings = (): FormState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<FormState> & { pages?: unknown };
    const savedPages = parsed.pagesInput ?? parsed.pages;
    const pagesInput = savedPages === undefined ? defaults.pagesInput : String(savedPages);
    return { ...defaults, ...parsed, pagesInput, keywords: "" };
  } catch {
    return defaults;
  }
};

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error || "操作失败");
  return error.message.replace(/^Error invoking remote method '[^']+':\s*/, "");
};

const money = (value: number | null): string => value === null
  ? "—"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

const integer = (value: number | null): string => value === null ? "—" : String(value);
const dateTime = (value: number): string => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);

const mergeSearchResults = (sourceProducts: ProductRecord[], publicProducts: ProductRecord[]): ProductRecord[] => {
  const seen = new Set<string>();
  return [...sourceProducts, ...publicProducts].flatMap((product, sourceIndex) => {
    const identity = productIdentity(product);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ ...product, sourceIndex }];
  });
};

function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const relationPrice = (product: ProductRecord, form: ConnectFormState): number => {
  const cost = product.costPrice ?? 0;
  if (form.addType === 3) return product.salePrice ?? cost;
  if (form.addType === 2) return Math.ceil((cost + form.addPrice) * 100) / 100;
  return Math.ceil(cost * (1 + form.addRate / 100) * 100) / 100;
};

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

function LoginScreen({ status, onLogin, busy, message }: {
  status: AuthStatus | null;
  onLogin: () => void;
  busy: boolean;
  message: string;
}) {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">货</div>
        <p className="eyebrow">LOCAL · MERCHANT TOOL</p>
        <h1>链动货源查询</h1>
        <p className="login-copy">在本机管理链动小铺货源，支持查询筛选、详情查看和商品关联。账号认证始终在官方页面完成。</p>
        <div className="security-note">
          <span>✓</span>
          <p>登录将在链动小铺官方页面中完成。登录态只保存在这台电脑，并由 Windows 加密保护。</p>
        </div>
        {status?.message && <p className="warning-text">{status.message}</p>}
        {message && <p className="error-banner">{message}</p>}
        <button className="primary login-button" type="button" onClick={onLogin} disabled={busy}>
          {busy ? "等待官方登录完成…" : "打开链动小铺官方登录"}
        </button>
        <button className="link-button" type="button" onClick={() => window.sourceBrowser.system.openExternal("https://pay.ldxp.cn/merchant/register")}>
          还没有商家账号？前往注册
        </button>
      </section>
    </main>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [form, setForm] = useState<FormState>(loadSettings);
  const [activeFilters, setActiveFilters] = useState<LocalFilters>(loadSettings);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [progress, setProgress] = useState<SearchJobProgress | null>(null);
  const [calibration, setCalibration] = useState<FieldCalibration | null>(null);
  const [currentJobId, setCurrentJobId] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [library, setLibrary] = useState<LocalLibraryState>(emptyLibrary);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favoriteFilter, setFavoriteFilter] = useState("");
  const [favoriteEditor, setFavoriteEditor] = useState<FavoriteRecord | null>(null);
  const [favoriteNote, setFavoriteNote] = useState("");
  const [favoriteTags, setFavoriteTags] = useState("");
  const [historyFavorite, setHistoryFavorite] = useState<FavoriteRecord | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [publicShopsOpen, setPublicShopsOpen] = useState(false);
  const [publicSourceInput, setPublicSourceInput] = useState("");
  const [publicBusy, setPublicBusy] = useState("");
  const [healthProduct, setHealthProduct] = useState<ProductRecord | null>(null);
  const [healthLinkCheck, setHealthLinkCheck] = useState<{ loading: boolean; valid: boolean | null; status: number | null }>({ loading: false, valid: null, status: null });
  const [connectProduct, setConnectProduct] = useState<ProductRecord | null>(null);
  const [connectForm, setConnectForm] = useState<ConnectFormState | null>(null);
  const [connectCategories, setConnectCategories] = useState<GoodsCategoryOption[]>([]);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectSubmitting, setConnectSubmitting] = useState(false);
  const [relationActionId, setRelationActionId] = useState("");
  const pollTimer = useRef<number | null>(null);
  const pendingPublicProducts = useRef<ProductRecord[]>([]);
  const pendingSearchScope = useRef<SearchScope>("source");

  useEffect(() => {
    void window.sourceBrowser.auth.getStatus().then(setAuth).catch((error) => setMessage(errorMessage(error)));
    void window.sourceBrowser.local.getState().then(setLibrary).catch((error) => setMessage(errorMessage(error)));
    return () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    const safeSettings = { ...form, keywords: "" };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeSettings));
  }, [form]);

  useEffect(() => {
    if (!loginPending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      void window.sourceBrowser.auth.getStatus().then((next) => {
        setAuth(next);
        if (next.authenticated || Date.now() - startedAt > 10 * 60 * 1000) {
          setLoginPending(false);
          window.clearInterval(timer);
        }
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loginPending]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const knownTypes = useMemo(() => {
    const values = new Set(products.map((product) => product.goodsType).filter(Boolean));
    if (form.goodsType) values.add(form.goodsType);
    return [...values].sort();
  }, [products, form.goodsType]);

  const filteredProducts = useMemo(() => applyFilters(products, activeFilters), [products, activeFilters]);
  const favoriteMap = useMemo(() => new Map(library.favorites.map((favorite) => [favorite.identity, favorite])), [library.favorites]);
  const visibleFavorites = useMemo(() => {
    const needle = favoriteFilter.trim().toLocaleLowerCase();
    if (!needle) return library.favorites;
    return library.favorites.filter((favorite) => `${favorite.product.name}\n${favorite.product.merchantName}\n${favorite.note}\n${favorite.tags.join(" ")}`.toLocaleLowerCase().includes(needle));
  }, [library.favorites, favoriteFilter]);
  const pagination = useMemo(
    () => paginate(filteredProducts, page, form.localPageSize),
    [filteredProducts, page, form.localPageSize]
  );

  useEffect(() => {
    if (pagination.page !== page) setPage(pagination.page);
  }, [pagination.page, page]);

  const pollJob = async (jobId: string): Promise<void> => {
    try {
      const next = await window.sourceBrowser.catalog.getProgress(jobId);
      setProgress(next);
      if (next.status === "running") {
        pollTimer.current = window.setTimeout(() => void pollJob(jobId), 500);
        return;
      }
      setCurrentJobId("");
      if (next.status === "done") {
        const sourceProducts = next.result || [];
        const combined = pendingSearchScope.current === "all"
          ? mergeSearchResults(sourceProducts, pendingPublicProducts.current)
          : sourceProducts;
        setProducts(combined);
        setCalibration(next.calibration || buildFieldCalibration(sourceProducts));
        setLibrary(await window.sourceBrowser.local.getState());
        setPage(1);
        const refreshNote = next.monitor?.favoriteRefreshTotal
          ? `；收藏刷新 ${next.monitor.favoriteRefreshLoaded}/${next.monitor.favoriteRefreshTotal}${next.monitor.favoriteRefreshFailed ? `，失败 ${next.monitor.favoriteRefreshFailed}` : ""}`
          : "";
        if (!next.coverageComplete) {
          setMessage(`本次成功拉取 ${next.loadedPages} 页，但平台共有 ${next.remoteTotalPages} 页；为避免误报，已跳过价格变化和下架监控${refreshNote}${pendingSearchScope.current === "all" ? `；合并公开商品 ${pendingPublicProducts.current.length} 条` : ""}`);
        } else if (next.monitor?.baselineCreated) {
          setMessage(`完整拉取成功，已建立本查询方案的监控基线${refreshNote}${pendingSearchScope.current === "all" ? `；合并公开商品 ${pendingPublicProducts.current.length} 条` : ""}`);
        } else if (next.monitor?.changedProducts) {
          setMessage(`完整拉取成功，发现 ${next.monitor.changedProducts} 个商品发生变化${refreshNote}${pendingSearchScope.current === "all" ? `；合并公开商品 ${pendingPublicProducts.current.length} 条` : ""}`);
        } else {
          setMessage(`完整拉取成功，未发现商品价格、库存或状态变化${refreshNote}${pendingSearchScope.current === "all" ? `；合并公开商品 ${pendingPublicProducts.current.length} 条` : ""}`);
        }
      } else {
        setMessage(next.error || "查询未完成");
      }
    } catch (error) {
      setCurrentJobId("");
      setMessage(errorMessage(error));
      const nextAuth = await window.sourceBrowser.auth.getStatus().catch(() => null);
      if (nextAuth) setAuth(nextAuth);
    }
  };

  const handleLogin = async () => {
    setMessage("");
    try {
      await window.sourceBrowser.auth.openOfficialLogin();
      setLoginPending(true);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const startSearch = async () => {
    const keywords = form.keywords.trim();
    if (!keywords) return setMessage("请输入关键词");
    let requestedPages = 1;
    if (form.searchScope !== "public") {
      try {
        requestedPages = parseRequestedPages(form.pagesInput);
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : "拉取页数不正确");
      }
    }
    if (form.minSalePrice !== null && form.maxSalePrice !== null && form.minSalePrice > form.maxSalePrice) {
      return setMessage("售价下限不能高于售价上限");
    }
    setMessage("");
    setActiveFilters(form);
    setPage(1);
    try {
      const publicProducts = form.searchScope === "source"
        ? []
        : await window.sourceBrowser.publicCatalog.search({ keywords, goodsType: form.goodsType });
      pendingPublicProducts.current = publicProducts;
      pendingSearchScope.current = form.searchScope;
      if (form.searchScope === "public") {
        setProducts(publicProducts);
        setCalibration(null);
        setProgress(null);
        setMessage(publicProducts.length
          ? `已从 ${library.publicShops.length} 个本地公开店铺中找到 ${publicProducts.length} 个商品`
          : library.publicShops.length ? "公开店铺库中没有匹配商品，可刷新店铺后重试" : "公开店铺库为空，请先添加商品或店铺链接");
        return;
      }
      const started = await window.sourceBrowser.catalog.startSearch({
        keywords,
        goodsType: form.goodsType,
        pages: requestedPages,
        remotePageSize: form.remotePageSize,
        speedMode: form.speedMode,
        searchScope: "source"
      });
      setCurrentJobId(started.jobId);
      setProgress({
        id: started.jobId,
        status: "running",
        currentPage: 0,
        loadedPages: 0,
        totalPages: requestedPages,
        requestedPages,
        totalPagesResolved: false,
        remoteTotalPages: requestedPages,
        coverageComplete: false,
        favoriteRefreshCurrent: 0,
        favoriteRefreshTotal: 0,
        speedMode: form.speedMode,
        concurrency: form.speedMode === "fast" ? 2 : 1,
        throttleMs: form.speedMode === "fast" ? 40 : form.speedMode === "standard" ? 90 : 200,
        loaded: 0,
        total: 0
      });
      await pollJob(started.jobId);
    } catch (error) {
      setCurrentJobId("");
      setMessage(errorMessage(error));
      const nextAuth = await window.sourceBrowser.auth.getStatus().catch(() => null);
      if (nextAuth) setAuth(nextAuth);
    }
  };

  const applyCurrentFilters = () => {
    if (form.minSalePrice !== null && form.maxSalePrice !== null && form.minSalePrice > form.maxSalePrice) {
      setMessage("售价下限不能高于售价上限");
      return;
    }
    setMessage("");
    setActiveFilters(form);
    setPage(1);
  };

  const resetFilters = () => {
    const reset = { ...defaults, keywords: form.keywords, goodsType: form.goodsType };
    setForm(reset);
    setActiveFilters(reset);
    setPage(1);
    setMessage("");
  };

  const cancelSearch = async () => {
    if (!currentJobId) return;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    const next = await window.sourceBrowser.catalog.cancel(currentJobId);
    setProgress(next);
    setCurrentJobId("");
    pendingPublicProducts.current = [];
    setMessage(next.error || "查询已取消");
  };

  const logout = async () => {
    if (currentJobId) await cancelSearch();
    setAuth(await window.sourceBrowser.auth.logout());
    setProducts([]);
    setProgress(null);
    setCalibration(null);
  };

  const toggleFavorite = async (product: ProductRecord) => {
    const identity = productIdentity(product);
    const existing = favoriteMap.get(identity);
    try {
      if (existing) {
        setFavoriteEditor(existing);
        setFavoriteNote(existing.note);
        setFavoriteTags(existing.tags.join("，"));
        setFavoritesOpen(true);
      } else {
        setLibrary(await window.sourceBrowser.local.upsertFavorite({ product, note: "", tags: [] }));
        setMessage(`已收藏“${product.name}”`);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const editFavorite = (favorite: FavoriteRecord) => {
    setFavoriteEditor(favorite);
    setFavoriteNote(favorite.note);
    setFavoriteTags(favorite.tags.join("，"));
  };

  const saveFavorite = async () => {
    if (!favoriteEditor) return;
    try {
      setLibrary(await window.sourceBrowser.local.upsertFavorite({
        product: favoriteEditor.product,
        note: favoriteNote,
        tags: favoriteTags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean)
      }));
      setFavoriteEditor(null);
      setMessage("收藏备注与标签已保存");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const removeFavorite = async (favorite: FavoriteRecord) => {
    if (!window.confirm(`确定取消收藏“${favorite.product.name}”？最近三天历史记录将在过期前保留。`)) return;
    setLibrary(await window.sourceBrowser.local.removeFavorite(favorite.identity));
    if (favoriteEditor?.identity === favorite.identity) setFavoriteEditor(null);
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return setMessage("请先填写查询方案名称");
    let pages = 1;
    try {
      if (form.searchScope !== "public") pages = parseRequestedPages(form.pagesInput);
    } catch (error) {
      return setMessage(errorMessage(error));
    }
    try {
      setLibrary(await window.sourceBrowser.local.savePreset({
        name,
        search: { keywords: form.keywords.trim(), goodsType: form.goodsType, pages, remotePageSize: form.remotePageSize, speedMode: form.speedMode, searchScope: form.searchScope },
        filters: {
          minSalePrice: form.minSalePrice,
          maxSalePrice: form.maxSalePrice,
          stockState: form.stockState,
          status: form.status,
          relationState: form.relationState,
          categoryKeyword: form.categoryKeyword,
          merchantName: form.merchantName,
          blockedKeywords: form.blockedKeywords,
          sortMode: form.sortMode
        },
        localPageSize: form.localPageSize
      }));
      setPresetName("");
      setMessage(`查询方案“${name}”已保存`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const applyPreset = (preset: SearchPreset) => {
    const next: FormState = {
      ...defaults,
      ...preset.filters,
      ...preset.search,
      pagesInput: String(preset.search.pages),
      localPageSize: preset.localPageSize
    };
    setForm(next);
    setActiveFilters(preset.filters);
    setPage(1);
    setPresetsOpen(false);
    setMessage(`已载入查询方案“${preset.name}”`);
  };

  const deletePreset = async (preset: SearchPreset) => {
    if (!window.confirm(`确定删除查询方案“${preset.name}”？`)) return;
    setLibrary(await window.sourceBrowser.local.deletePreset(preset.id));
  };

  const exportCurrent = async () => {
    if (!filteredProducts.length) return setMessage("当前没有可导出的筛选结果");
    try {
      const result = await window.sourceBrowser.catalog.exportCsv(filteredProducts);
      if (result.exported) setMessage(`已导出 ${filteredProducts.length} 条结果${result.filePath ? `：${result.filePath}` : ""}`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const addPublicSource = async () => {
    const url = publicSourceInput.trim();
    if (!url || publicBusy) return setMessage("请粘贴链动小铺商品或店铺链接");
    setPublicBusy("add");
    try {
      const result = await window.sourceBrowser.publicCatalog.addSource(url);
      setLibrary(result.state);
      setPublicSourceInput("");
      setMessage(result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPublicBusy("");
    }
  };

  const refreshPublicShop = async (token: string) => {
    if (publicBusy) return;
    setPublicBusy(token);
    try {
      const result = await window.sourceBrowser.publicCatalog.refreshShop(token);
      setLibrary(result.state);
      setMessage(result.message);
    } catch (error) {
      setLibrary(await window.sourceBrowser.local.getState());
      setMessage(errorMessage(error));
    } finally {
      setPublicBusy("");
    }
  };

  const refreshAllPublicShops = async () => {
    if (publicBusy || !library.publicShops.length) return;
    setPublicBusy("all");
    try {
      const result = await window.sourceBrowser.publicCatalog.refreshAll();
      setLibrary(result.state);
      setMessage(result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPublicBusy("");
    }
  };

  const removePublicShop = async (token: string, name: string) => {
    if (publicBusy || !window.confirm(`确定从本机公开店铺库移除“${name}”？不会修改链动小铺数据。`)) return;
    const result = await window.sourceBrowser.publicCatalog.removeShop(token);
    setLibrary(result.state);
    setMessage(result.message);
  };

  const importPublicShops = async () => {
    if (publicBusy) return;
    setPublicBusy("import");
    try {
      const result = await window.sourceBrowser.publicCatalog.importShops();
      setLibrary(result.state);
      setMessage(result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPublicBusy("");
    }
  };

  const exportPublicShops = async () => {
    if (publicBusy || !library.publicShops.length) return;
    setPublicBusy("export");
    try {
      const result = await window.sourceBrowser.publicCatalog.exportShops();
      if (result.exported) setMessage(`公开店铺列表已导出${result.filePath ? `：${result.filePath}` : ""}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPublicBusy("");
    }
  };

  const openRelationHealth = async (product: ProductRecord) => {
    setHealthProduct(product);
    const link = product.relationDetails.link;
    if (!link) return setHealthLinkCheck({ loading: false, valid: null, status: null });
    setHealthLinkCheck({ loading: true, valid: null, status: null });
    try {
      const result = await window.sourceBrowser.system.checkOfficialLink(link);
      setHealthLinkCheck({ loading: false, valid: result.valid, status: result.status });
    } catch {
      setHealthLinkCheck({ loading: false, valid: false, status: null });
    }
  };

  const openConnectGoods = async (product: ProductRecord) => {
    if (product.dataSource === "public-shop") return setMessage("公开零售商品不属于货源广场，无法直接关联");
    if (!product.goodsType || product.id.startsWith("row-")) return setMessage("该商品缺少可用的类型或商品 ID，无法关联");
    const cost = product.costPrice ?? 0;
    const hasLimit = product.agentPriceLimit !== null && product.agentPriceLimit > 0 && cost > 0;
    const addRate = hasLimit ? Math.max(0, ((product.agentPriceLimit! - cost) / cost) * 100) : 10;
    setConnectProduct(product);
    setConnectForm({
      name: product.name,
      description: product.description,
      categoryId: 0,
      addType: 1,
      addRate,
      addPrice: 0,
      nameSync: true,
      descriptionSync: true
    });
    setConnectCategories([]);
    setConnectLoading(true);
    setMessage("");
    try {
      setConnectCategories(await window.sourceBrowser.catalog.getGoodsCategories(product.goodsType));
    } catch (error) {
      setMessage(errorMessage(error));
      setConnectProduct(null);
      setConnectForm(null);
    } finally {
      setConnectLoading(false);
    }
  };

  const submitConnectGoods = async () => {
    if (!connectProduct || !connectForm || connectSubmitting) return;
    const price = relationPrice(connectProduct, connectForm);
    if (!window.confirm(`确认将“${connectProduct.name}”关联到你的店铺？\n预计售价：¥${price}`)) return;
    setConnectSubmitting(true);
    try {
      const result = await window.sourceBrowser.catalog.connectGoods({
        goodsId: connectProduct.id,
        ...connectForm,
        price
      });
      setProducts((current) => current.map((product) => product.id === connectProduct.id
        ? { ...product, relation: "connected", relationDetails: { price, addType: connectForm.addType, addRate: connectForm.addRate, addPrice: connectForm.addPrice, nameSync: connectForm.nameSync, descriptionSync: connectForm.descriptionSync, link: "" }, sourceFields: { ...product.sourceFields, hasChild: true } }
        : product));
      setConnectProduct(null);
      setConnectForm(null);
      setMessage(result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setConnectSubmitting(false);
    }
  };

  const disconnectGoods = async (product: ProductRecord) => {
    if (relationActionId) return;
    if (!window.confirm(`确定取消“${product.name}”的商品关联？这会修改你的商户商品。`)) return;
    setRelationActionId(product.id);
    try {
      const result = await window.sourceBrowser.catalog.disconnectGoods(product.id);
      setProducts((current) => current.map((item) => item.id === product.id
        ? { ...item, relation: "unconnected", relationDetails: { price: null, addType: null, addRate: null, addPrice: null, nameSync: null, descriptionSync: null, link: "" }, sourceFields: { ...item.sourceFields, hasChild: false } }
        : item));
      setMessage(result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setRelationActionId("");
    }
  };

  if (!auth?.authenticated) {
    return <LoginScreen status={auth} onLogin={() => void handleLogin()} busy={loginPending} message={message} />;
  }

  const progressPercent = progress?.totalPagesResolved && progress.totalPages
    ? Math.min(100, Math.round((progress.loadedPages / progress.totalPages) * 100))
    : 7;
  const calibrationWarning = calibration
    ? Math.min(calibration.salePrice, calibration.costPrice, calibration.stock, calibration.merchant, calibration.category) < 70
    : false;
  const healthReport = healthProduct ? evaluateRelationHealth(healthProduct) : null;
  const sourceResultCount = products.filter((product) => product.dataSource !== "public-shop").length;
  const publicResultCount = products.length - sourceResultCount;

  return (
    <main className="app-shell">
      <div className="rainbow-line" />
      <header className="topbar">
        <div className="brand-row">
          <div className="mini-mark">货</div>
          <div><h1>链动货源查询</h1><p>商户工具 · 本机运行</p></div>
        </div>
        <div className="account-row">
          <span className="online-dot" />
          <span>{auth.displayName || auth.username}</span>
          <button className="text-button" type="button" onClick={() => void logout()}>退出登录</button>
        </div>
      </header>

      {auth.message && <div className="warning-banner">{auth.message}</div>}

      <section className="filter-card">
        <div className="filter-grid">
          <Field label="查询范围">
            <select value={form.searchScope} onChange={(event) => {
              const searchScope = event.target.value as SearchScope;
              setForm((current) => ({ ...current, searchScope, relationState: searchScope === "public" ? "all" : current.relationState }));
            }}>
              <option value="source">货源广场</option>
              <option value="public">公开店铺</option>
              <option value="all">全部数据</option>
            </select>
          </Field>
          <Field label="关键词" className="keyword-field">
            <input value={form.keywords} maxLength={100} placeholder="例如：k12" onChange={(event) => update("keywords", event.target.value)} onKeyDown={(event) => event.key === "Enter" && void startSearch()} />
          </Field>
          <Field label="商品类型">
            <select value={form.goodsType} onChange={(event) => update("goodsType", event.target.value)}>
              <option value="">全部</option>
              <option value="card">卡密</option>
              {knownTypes.filter((type) => type !== "card").map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </Field>
          <Field label="拉取页数">
            <input
              type="text"
              inputMode="numeric"
              value={form.pagesInput}
              disabled={form.searchScope === "public"}
              placeholder="1–100"
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{0,3}$/.test(value)) update("pagesInput", value);
              }}
              onBlur={() => {
                update("pagesInput", normalizeRequestedPagesOnBlur(form.pagesInput));
              }}
            />
          </Field>
          <Field label="售价最低">
            <input type="number" min={0} step="0.01" value={form.minSalePrice ?? ""} placeholder="不限" onChange={(event) => update("minSalePrice", toNumberOrNull(event.target.value))} />
          </Field>
          <Field label="售价最高">
            <input type="number" min={0} step="0.01" value={form.maxSalePrice ?? ""} placeholder="不限" onChange={(event) => update("maxSalePrice", toNumberOrNull(event.target.value))} />
          </Field>
          <Field label="库存">
            <select value={form.stockState} onChange={(event) => update("stockState", event.target.value as FormState["stockState"])}>
              <option value="in-stock">仅有库存</option><option value="out-of-stock">仅缺货</option><option value="all">全部</option>
            </select>
          </Field>
          <Field label="状态">
            <select value={form.status} onChange={(event) => update("status", event.target.value as FormState["status"])}>
              <option value="normal">正常</option><option value="abnormal">异常</option><option value="all">全部</option>
            </select>
          </Field>
          <Field label="关联状态">
            <select disabled={form.searchScope === "public"} value={form.relationState} onChange={(event) => update("relationState", event.target.value as FormState["relationState"])}>
              <option value="all">全部</option><option value="connected">已关联</option><option value="unconnected">未关联</option>
            </select>
          </Field>
          <Field label="分类关键词">
            <input value={form.categoryKeyword} placeholder="分类包含" onChange={(event) => update("categoryKeyword", event.target.value)} />
          </Field>
          <Field label="商家名称">
            <input value={form.merchantName} placeholder="商家包含" onChange={(event) => update("merchantName", event.target.value)} />
          </Field>
          <Field label="排序">
            <select value={form.sortMode} onChange={(event) => update("sortMode", event.target.value as FormState["sortMode"])}>
              <option value="default">默认</option><option value="sale-asc">售价低到高</option><option value="sale-desc">售价高到低</option>
            </select>
          </Field>
          <Field label="每页显示">
            <select value={form.localPageSize} onChange={(event) => { update("localPageSize", Number(event.target.value) as FormState["localPageSize"]); setPage(1); }}>
              <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </Field>
          <Field label="屏蔽词" className="block-field">
            <input value={form.blockedKeywords} placeholder="free, 镜像, 中转（逗号或换行分隔）" onChange={(event) => update("blockedKeywords", event.target.value)} />
          </Field>
          <Field label="远端每页">
            <select disabled={form.searchScope === "public"} value={form.remotePageSize} onChange={(event) => update("remotePageSize", Number(event.target.value) as FormState["remotePageSize"])}>
              <option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option>
            </select>
          </Field>
          <Field label="拉取速度">
            <select disabled={form.searchScope === "public"} value={form.speedMode} onChange={(event) => update("speedMode", event.target.value as FormState["speedMode"])}>
              <option value="fast">快速（双页并发）</option><option value="standard">标准</option><option value="stable">稳定</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="actions-row">
        <div className="action-buttons">
          <button className="primary" type="button" disabled={Boolean(currentJobId)} onClick={() => void startSearch()}>{currentJobId ? "拉取中…" : "开始查询"}</button>
          <button className="secondary" type="button" disabled={Boolean(currentJobId)} onClick={applyCurrentFilters}>筛选当前数据</button>
          <button className="ghost" type="button" disabled={Boolean(currentJobId)} onClick={resetFilters}>重置</button>
          <button className="utility-button" type="button" onClick={() => setFavoritesOpen(true)}>收藏栏 {library.favorites.length}</button>
          <button className="utility-button" type="button" onClick={() => setPresetsOpen(true)}>查询方案 {library.presets.length}</button>
          <button className="utility-button" type="button" onClick={() => setPublicShopsOpen(true)}>公开店铺 {library.publicShops.length}</button>
          <button className="utility-button" type="button" disabled={!filteredProducts.length} onClick={() => void exportCurrent()}>导出当前结果</button>
          <button className="utility-button" type="button" onClick={() => setMonitorOpen(true)}>变化记录 {library.monitorEvents.length}</button>
          {currentJobId && <button className="danger" type="button" onClick={() => void cancelSearch()}>停止查询</button>}
        </div>
        <span className="filtered-pill"><i /> 已筛选当前数据</span>
      </section>

      {message && <div className="error-banner content-error">{message}</div>}

      {progress && progress.status === "running" && (
        <section className="progress-card">
          <div>
            <strong>{progress.totalPagesResolved
              ? `正在拉取第 ${Math.max(1, progress.currentPage)} / ${progress.totalPages} 页`
              : `正在确认平台总页数（最多拉取 ${progress.requestedPages} 页）`}</strong>
            <span>已加载 {progress.loaded} / {progress.total || "?"} 条 · {progress.speedMode === "fast" ? "快速" : progress.speedMode === "standard" ? "标准" : "稳定"}档 · {progress.concurrency} 并发 · 请求间隔约 {progress.throttleMs}ms</span>
            {progress.favoriteRefreshTotal > 0 && <span>正在刷新收藏商品 {Math.min(progress.favoriteRefreshCurrent, progress.favoriteRefreshTotal)} / {progress.favoriteRefreshTotal}</span>}
          </div>
          <div className="progress-track"><div style={{ width: `${progressPercent}%` }} /></div>
        </section>
      )}

      <section className="summary-row">
        <div className="summary-group">
          <span className="summary-pill">已查询 {products.length} 条，筛选后 {filteredProducts.length} 条{publicResultCount > 0 ? ` · 货源 ${sourceResultCount} / 公开 ${publicResultCount}` : ""}</span>
          {calibration && calibration.total > 0 && (
            <span className={`calibration-pill ${calibrationWarning ? "calibration-warning" : ""}`} title="基于本次真实返回结果自动计算，不保存原始响应">
              字段覆盖：售价 {calibration.salePrice}% · 成本 {calibration.costPrice}% · 库存 {calibration.stock}% · 店铺 {calibration.merchant}% · 分类 {calibration.category}%
            </span>
          )}
        </div>
        <div className="pager">
          <button type="button" onClick={() => setPage(1)} disabled={pagination.page <= 1}>首页</button>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={pagination.page <= 1}>上一页</button>
          <span>{pagination.page} / {pagination.totalPages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))} disabled={pagination.page >= pagination.totalPages}>下一页</button>
          <button type="button" onClick={() => setPage(pagination.totalPages)} disabled={pagination.page >= pagination.totalPages}>末页</button>
        </div>
      </section>

      <section className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>图片</th><th className="product-column">商品</th><th>店铺</th><th>分类</th><th>售价</th><th>成本价</th><th>库存</th><th>销量</th><th>状态</th><th>关联</th><th>操作</th></tr></thead>
            <tbody>
              {pagination.rows.length === 0 ? (
                <tr><td className="empty" colSpan={11}>{products.length ? "当前筛选条件没有匹配商品" : "输入关键词后开始拉取货源"}</td></tr>
              ) : pagination.rows.map((product) => (
                <tr key={`${product.id}-${product.sourceIndex}`}>
                  <td>{product.imageUrl ? <img className="thumb" src={product.imageUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span className="no-image">无图</span>}</td>
                  <td>
                    {product.detailUrl ? (
                      <button
                        className="product-title-link product-name"
                        type="button"
                        title={`打开商品：${product.name}`}
                        onClick={() => void window.sourceBrowser.system.openExternal(product.detailUrl)}
                      >{product.name}</button>
                    ) : <strong className="product-name" title={product.name}>{product.name}</strong>}
                    <span className="product-id">ID: {product.id}</span>
                    <span className={`source-label ${product.dataSource === "public-shop" ? "source-public" : "source-square"}`}>{product.dataSource === "public-shop" ? "公开零售" : "货源广场"}</span>
                    {product.change?.messages.map((change) => <span className="change-label" key={change}>{change}</span>)}
                  </td>
                  <td>{product.merchantName || "—"}</td><td>{product.categoryName || "—"}</td>
                  <td className="sale-price">{money(product.salePrice)}</td><td className="cost-price">{money(product.costPrice)}</td>
                  <td className={product.stock && product.stock > 0 ? "stock-ok" : ""}>{integer(product.stock)}</td><td>{integer(product.sales)}</td>
                  <td><span className={`badge status-${product.status}`}>{product.statusLabel}</span></td>
                  <td><span className={`badge ${product.dataSource === "public-shop" ? "relation-unavailable" : `relation-${product.relation}`}`}>{product.dataSource === "public-shop" ? "不可关联" : product.relation === "connected" ? "已关联" : product.relation === "unconnected" ? "未关联" : "未知"}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className={`favorite-button ${favoriteMap.has(productIdentity(product)) ? "is-favorite" : ""}`} type="button" onClick={() => void toggleFavorite(product)}>{favoriteMap.has(productIdentity(product)) ? "★ 已收藏" : "☆ 收藏"}</button>
                      {product.dataSource !== "public-shop" && product.relation === "unconnected" && !product.id.startsWith("row-") ? (
                        <button className="relation-action relation-connect-action" type="button" disabled={Boolean(relationActionId)} onClick={() => void openConnectGoods(product)}>立即关联</button>
                      ) : product.dataSource !== "public-shop" && product.relation === "connected" && !product.id.startsWith("row-") ? (
                        <button className="relation-action relation-disconnect-action" type="button" disabled={Boolean(relationActionId)} onClick={() => void disconnectGoods(product)}>{relationActionId === product.id ? "取消中…" : "取消关联"}</button>
                      ) : null}
                      {product.dataSource !== "public-shop" && product.relation === "connected" && <button className="health-button" type="button" onClick={() => void openRelationHealth(product)}>关联体检</button>}
                      {product.detailUrl ? <button className="detail-button" type="button" onClick={() => void window.sourceBrowser.system.openExternal(product.detailUrl)}>详情</button> : "—"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {connectProduct && connectForm && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card relation-modal" role="dialog" aria-modal="true" aria-labelledby="relation-title">
            <header className="modal-header">
              <div><p>商户商品操作</p><h2 id="relation-title">商品关联</h2></div>
              <button type="button" aria-label="关闭" disabled={connectSubmitting} onClick={() => { setConnectProduct(null); setConnectForm(null); }}>×</button>
            </header>
            <div className="modal-body">
              <div className="modal-product"><strong>{connectProduct.name}</strong><span>成本价 {money(connectProduct.costPrice)}</span></div>
              {connectLoading ? <div className="modal-loading"><span /><p>正在读取你的店铺分类…</p></div> : <>
                <Field label="所属分类">
                  <select value={connectForm.categoryId} onChange={(event) => setConnectForm((current) => current ? { ...current, categoryId: Number(event.target.value) } : current)}>
                    <option value={0}>【继承货源】{connectProduct.categoryName || "原分类"}</option>
                    {connectCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </Field>
                <Field label="商品名称">
                  <input value={connectForm.name} maxLength={500} onChange={(event) => setConnectForm((current) => current ? { ...current, name: event.target.value } : current)} />
                </Field>
                <Field label="商品描述">
                  <textarea value={connectForm.description} rows={4} onChange={(event) => setConnectForm((current) => current ? { ...current, description: event.target.value } : current)} />
                </Field>
                <Field label="加价方式">
                  <select value={connectForm.addType} onChange={(event) => setConnectForm((current) => current ? { ...current, addType: Number(event.target.value) as RelationPriceMode } : current)}>
                    <option value={1}>百分比加价</option><option value={2}>固定金额加价</option><option value={3}>与货源零售价一致</option>
                  </select>
                </Field>
                {connectForm.addType === 1 && <Field label="加价百分比">
                  <input type="number" min={0} step="0.001" value={connectForm.addRate} onChange={(event) => setConnectForm((current) => current ? { ...current, addRate: Math.max(0, Number(event.target.value) || 0) } : current)} />
                </Field>}
                {connectForm.addType === 2 && <Field label="固定加价金额">
                  <input type="number" min={0} step="0.01" value={connectForm.addPrice} onChange={(event) => setConnectForm((current) => current ? { ...current, addPrice: Math.max(0, Number(event.target.value) || 0) } : current)} />
                </Field>}
                <div className="relation-price-preview"><span>预计店铺售价</span><strong>{money(relationPrice(connectProduct, connectForm))}</strong></div>
                <label className="relation-check"><input type="checkbox" checked={connectForm.nameSync} onChange={(event) => setConnectForm((current) => current ? { ...current, nameSync: event.target.checked } : current)} />货源名称变化时同步</label>
                <label className="relation-check"><input type="checkbox" checked={connectForm.descriptionSync} onChange={(event) => setConnectForm((current) => current ? { ...current, descriptionSync: event.target.checked } : current)} />货源描述变化时同步</label>
                <div className="modal-warning">确认关联会在你的链动小铺商户中创建对应商品；售价过低可能被平台拦截下单。</div>
                <div className="relation-modal-actions">
                  <button className="ghost" type="button" disabled={connectSubmitting} onClick={() => { setConnectProduct(null); setConnectForm(null); }}>取消</button>
                  <button className="primary" type="button" disabled={connectSubmitting || !connectForm.name.trim()} onClick={() => void submitConnectGoods()}>{connectSubmitting ? "正在关联…" : "确认关联"}</button>
                </div>
              </>}
            </div>
          </section>
        </div>
      )}
      {publicShopsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card library-modal public-shop-modal" role="dialog" aria-modal="true" aria-labelledby="public-shops-title">
            <header className="modal-header">
              <div><p>PUBLIC SHOPS</p><h2 id="public-shops-title">公开店铺库 · {library.publicShops.length}</h2></div>
              <button type="button" aria-label="关闭" disabled={Boolean(publicBusy)} onClick={() => setPublicShopsOpen(false)}>×</button>
            </header>
            <div className="modal-body">
              <p className="monitor-rule">粘贴链动小铺商品或店铺链接。商品链接会先反查所属店铺，再把该店公开商品保存到本机。公开零售商品不包含货源成本和关联能力。</p>
              <div className="public-source-create">
                <input
                  value={publicSourceInput}
                  placeholder="https://www.ldxp.cn/item/... 或 https://pay.ldxp.cn/shop/..."
                  onChange={(event) => setPublicSourceInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void addPublicSource()}
                />
                <button className="primary" type="button" disabled={Boolean(publicBusy) || !publicSourceInput.trim()} onClick={() => void addPublicSource()}>{publicBusy === "add" ? "正在收录…" : "收录整店"}</button>
              </div>
              <div className="public-shop-toolbar">
                <button className="secondary" type="button" disabled={Boolean(publicBusy) || !library.publicShops.length} onClick={() => void refreshAllPublicShops()}>{publicBusy === "all" ? "正在刷新…" : "刷新全部"}</button>
                <button className="ghost" type="button" disabled={Boolean(publicBusy)} onClick={() => void importPublicShops()}>{publicBusy === "import" ? "正在导入…" : "导入店铺列表"}</button>
                <button className="ghost" type="button" disabled={Boolean(publicBusy) || !library.publicShops.length} onClick={() => void exportPublicShops()}>导出店铺列表</button>
              </div>
              <div className="public-shop-list">
                {library.publicShops.length === 0 ? <div className="chart-empty">尚未收录公开店铺。可以先粘贴一个商品链接。</div> : library.publicShops.map((shop) => <article className="public-shop-card" key={shop.token}>
                  <div><strong>{shop.name}</strong><span>{shop.url}</span><small>{shop.goodsCount} 个公开商品 · 更新于 {dateTime(shop.updatedAt)}</small>{shop.lastError && <small className="shop-error">上次刷新：{shop.lastError}</small>}</div>
                  <div className="favorite-actions">
                    <button type="button" disabled={Boolean(publicBusy)} onClick={() => void refreshPublicShop(shop.token)}>{publicBusy === shop.token ? "刷新中…" : "刷新"}</button>
                    <button type="button" onClick={() => void window.sourceBrowser.system.openExternal(shop.url)}>打开店铺</button>
                    <button className="danger-text" type="button" disabled={Boolean(publicBusy)} onClick={() => void removePublicShop(shop.token, shop.name)}>移除</button>
                  </div>
                </article>)}
              </div>
            </div>
          </section>
        </div>
      )}
      {favoritesOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card library-modal" role="dialog" aria-modal="true" aria-labelledby="favorites-title">
            <header className="modal-header">
              <div><p>LOCAL LIBRARY</p><h2 id="favorites-title">收藏栏 · {library.favorites.length}</h2></div>
              <button type="button" aria-label="关闭" onClick={() => { setFavoritesOpen(false); setFavoriteEditor(null); }}>×</button>
            </header>
            <div className="modal-body">
              <input className="library-search" value={favoriteFilter} placeholder="搜索商品、商家、备注或标签" onChange={(event) => setFavoriteFilter(event.target.value)} />
              {favoriteEditor && <section className="favorite-editor">
                <strong>编辑：{favoriteEditor.product.name}</strong>
                <Field label="备注"><textarea rows={3} maxLength={5000} value={favoriteNote} onChange={(event) => setFavoriteNote(event.target.value)} placeholder="记录供货质量、售后说明或后续计划" /></Field>
                <Field label="自定义标签"><input value={favoriteTags} onChange={(event) => setFavoriteTags(event.target.value)} placeholder="稳定、低价、待验证（逗号分隔）" /></Field>
                <div className="modal-actions"><button className="ghost" type="button" onClick={() => setFavoriteEditor(null)}>取消</button><button className="primary" type="button" onClick={() => void saveFavorite()}>保存备注与标签</button></div>
              </section>}
              <div className="favorite-list">
                {visibleFavorites.length === 0 ? <div className="chart-empty">还没有匹配的收藏商品。</div> : visibleFavorites.map((favorite) => {
                  const points = library.priceHistory[favorite.identity] ?? [];
                  return <article className="favorite-card" key={favorite.identity}>
                    <div className="favorite-card-main"><strong>{favorite.product.name}</strong><span>{favorite.product.merchantName || "—"} · 售价 {money(favorite.product.salePrice)} · 成本 {money(favorite.product.costPrice)} · 库存 {integer(favorite.product.stock)}</span></div>
                    {favorite.tags.length > 0 && <div className="tag-row">{favorite.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                    {favorite.note && <p>{favorite.note}</p>}
                    <small>最近更新 {dateTime(favorite.updatedAt)} · 三天历史 {points.length} 个时间点</small>
                    <div className="favorite-actions">
                      <button type="button" onClick={() => editFavorite(favorite)}>备注/标签</button>
                      <button type="button" onClick={() => setHistoryFavorite(favorite)}>历史曲线</button>
                      {favorite.product.detailUrl && <button type="button" onClick={() => void window.sourceBrowser.system.openExternal(favorite.product.detailUrl)}>详情</button>}
                      <button className="danger-text" type="button" onClick={() => void removeFavorite(favorite)}>取消收藏</button>
                    </div>
                  </article>;
                })}
              </div>
            </div>
          </section>
        </div>
      )}
      {historyFavorite && (
        <div className="modal-backdrop history-backdrop" role="presentation">
          <section className="modal-card chart-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <header className="modal-header"><div><p>3-DAY HISTORY</p><h2 id="history-title">{historyFavorite.product.name}</h2></div><button type="button" aria-label="关闭" onClick={() => setHistoryFavorite(null)}>×</button></header>
            <div className="modal-body">
              <PriceHistoryChart points={library.priceHistory[historyFavorite.identity] ?? []} />
              <p className="history-note">每次完整成功拉取都会刷新收藏商品；本次查询未覆盖到的有货收藏会额外顺序查询一次。同一 30 分钟内重复记录按最低售价和最低成本合并，仅保留最近 3 天。</p>
            </div>
          </section>
        </div>
      )}
      {presetsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card library-modal" role="dialog" aria-modal="true" aria-labelledby="presets-title">
            <header className="modal-header"><div><p>SEARCH PRESETS</p><h2 id="presets-title">查询方案</h2></div><button type="button" aria-label="关闭" onClick={() => setPresetsOpen(false)}>×</button></header>
            <div className="modal-body">
              <div className="preset-create"><input value={presetName} maxLength={100} placeholder="为当前关键词、筛选和页数命名" onChange={(event) => setPresetName(event.target.value)} /><button className="primary" type="button" onClick={() => void savePreset()}>保存当前方案</button></div>
              <div className="preset-list">{library.presets.length === 0 ? <div className="chart-empty">尚未保存查询方案。</div> : library.presets.map((preset) => <article className="preset-card" key={preset.id}>
                <div><strong>{preset.name}</strong><span>关键词：{preset.search.keywords || "—"} · 最多 {preset.search.pages} 页 · {preset.filters.sortMode === "sale-asc" ? "售价升序" : preset.filters.sortMode === "sale-desc" ? "售价降序" : "默认排序"}</span><small>更新于 {dateTime(preset.updatedAt)}</small></div>
                <div><button className="primary" type="button" onClick={() => applyPreset(preset)}>载入</button><button className="ghost" type="button" onClick={() => void deletePreset(preset)}>删除</button></div>
              </article>)}</div>
            </div>
          </section>
        </div>
      )}
      {monitorOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card library-modal" role="dialog" aria-modal="true" aria-labelledby="monitor-title">
            <header className="modal-header"><div><p>MONITOR</p><h2 id="monitor-title">价格与库存变化</h2></div><button type="button" aria-label="关闭" onClick={() => setMonitorOpen(false)}>×</button></header>
            <div className="modal-body">
              <div className="monitor-rule">只有覆盖平台全部页数且完整成功的查询才会生成变化记录；失败、取消或只拉取部分页数不会产生下架判断。</div>
              <div className="monitor-list">{library.monitorEvents.length === 0 ? <div className="chart-empty">暂无变化记录。第一次完整查询会建立基线。</div> : library.monitorEvents.map((event) => <article className={`monitor-event event-${event.type}`} key={event.id}>
                <div><strong>{event.productName}</strong><span>{event.message}</span></div><small>{dateTime(event.createdAt)}</small>
                {event.detailUrl && <button type="button" onClick={() => void window.sourceBrowser.system.openExternal(event.detailUrl)}>详情</button>}
              </article>)}</div>
            </div>
          </section>
        </div>
      )}
      {healthProduct && healthReport && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card health-modal" role="dialog" aria-modal="true" aria-labelledby="health-title">
            <header className="modal-header"><div><p>RELATION HEALTH</p><h2 id="health-title">关联体检 · {healthReport.score} 分</h2></div><button type="button" aria-label="关闭" onClick={() => setHealthProduct(null)}>×</button></header>
            <div className="modal-body">
              <div className="modal-product"><strong>{healthProduct.name}</strong><span>关联售价 {money(healthProduct.relationDetails.price)}</span></div>
              <div className="health-grid">{healthReport.items.map((item) => <article className={`health-item health-${item.severity}`} key={item.key}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
              <article className={`health-item ${healthLinkCheck.valid === false ? "health-danger" : healthLinkCheck.valid ? "health-ok" : "health-info"}`}><span>关联链接在线访问</span><strong>{healthLinkCheck.loading ? "正在检查…" : healthLinkCheck.valid === null ? "没有可检查链接" : healthLinkCheck.valid ? `可访问（HTTP ${healthLinkCheck.status}）` : `无法访问${healthLinkCheck.status ? `（HTTP ${healthLinkCheck.status}）` : ""}`}</strong></article>
              <div className="monitor-rule">体检仅使用本次成功拉取的官方字段和最近一次完整基线，不会自动修改售价、同步设置或商品内容。</div>
              {healthProduct.relationDetails.link && <button className="secondary" type="button" onClick={() => void window.sourceBrowser.system.openExternal(healthProduct.relationDetails.link)}>打开关联商品</button>}
            </div>
          </section>
        </div>
      )}
      <footer>本机运行 · 支持货源查询、详情查看和商品关联</footer>
    </main>
  );
}
