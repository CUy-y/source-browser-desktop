package cn.ldxp.sourcebrowser.android.publicdata;

import android.os.Handler;
import android.os.Looper;

import cn.ldxp.sourcebrowser.android.model.ProductRecord;
import cn.ldxp.sourcebrowser.android.model.PublicShopSnapshot;
import cn.ldxp.sourcebrowser.android.network.ApiClient;
import cn.ldxp.sourcebrowser.android.network.ApiEnvelope;
import cn.ldxp.sourcebrowser.android.network.ApiException;
import cn.ldxp.sourcebrowser.android.util.ProductUtils;
import cn.ldxp.sourcebrowser.android.util.UrlPolicy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class PublicCatalogRepository {
    public interface Listener {
        void onSuccess(String message, List<PublicShopSnapshot> shops);
        void onError(String message, List<PublicShopSnapshot> shops);
    }

    private static final List<String> SUPPORTED_TYPES = Arrays.asList("card", "article", "resource", "equity");
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 100;
    private static final int REQUEST_GAP_MS = 250;
    private final ApiClient api;
    private final PublicCatalogStore store;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile AtomicBoolean active;

    public PublicCatalogRepository(ApiClient api, PublicCatalogStore store) {
        this.api = api;
        this.store = store;
    }

    public List<PublicShopSnapshot> getShops() {
        return store.getShops();
    }

    public void reload() {
        store.reload();
    }

    public List<ProductRecord> search(String keywords, String goodsType) {
        store.reload();
        String needle = keywords == null ? "" : keywords.trim().toLowerCase(Locale.ROOT);
        Set<String> seen = new HashSet<>();
        List<ProductRecord> result = new ArrayList<>();
        for (PublicShopSnapshot shop : store.getShops()) {
            for (ProductRecord product : shop.products) {
                if (goodsType != null && !goodsType.isEmpty() && !goodsType.equals(product.goodsType)) continue;
                String haystack = (product.name + "\n" + product.categoryName + "\n" + product.merchantName + "\n" + product.productKey).toLowerCase(Locale.ROOT);
                if (!needle.isEmpty() && !haystack.contains(needle)) continue;
                if (!seen.add(product.identity())) continue;
                product.sourceIndex = result.size();
                result.add(product);
            }
        }
        return result;
    }

    public boolean isBusy() {
        return active != null && !active.get();
    }

    public void addSource(String url, Listener listener) {
        execute(listener, cancelled -> {
            String[] source = UrlPolicy.parsePublicSource(url);
            String token = source[1];
            JSONObject seed = null;
            if (source[0].equals("item")) {
                seed = requestData("/shopApi/Shop/goodsInfo", new JSONObject().put("goods_key", source[1]).put("trade_no", ""), cancelled);
                JSONObject user = seed.optJSONObject("user");
                token = user == null ? "" : user.optString("token", "").trim();
                if (token.isEmpty()) throw new ApiException("商品详情没有返回所属店铺，无法收录整店", 200, 0, false);
            }
            PublicShopSnapshot shop = refreshInternal(token, seed, cancelled);
            return "已收录“" + shop.name + "”，共 " + shop.products.size() + " 个公开商品";
        });
    }

    public void refreshShop(String token, Listener listener) {
        execute(listener, cancelled -> {
            try {
                PublicShopSnapshot shop = refreshInternal(token, null, cancelled);
                return "已刷新“" + shop.name + "”，共 " + shop.products.size() + " 个公开商品";
            } catch (Exception error) {
                store.markError(token, error.getMessage());
                throw error;
            }
        });
    }

    public void refreshAll(Listener listener) {
        execute(listener, cancelled -> {
            int success = 0;
            int failed = 0;
            for (PublicShopSnapshot shop : store.getShops()) {
                if (cancelled.get()) throw new ApiException("操作已取消", 0, 0, false);
                try {
                    refreshInternal(shop.token, null, cancelled);
                    success++;
                } catch (Exception error) {
                    failed++;
                    store.markError(shop.token, error.getMessage());
                }
                sleep(REQUEST_GAP_MS, cancelled);
            }
            return "公开店铺刷新完成：成功 " + success + "，失败 " + failed;
        });
    }

    public void remove(String token, Listener listener) {
        execute(listener, cancelled -> {
            store.remove(token);
            return "已从本机公开店铺库移除";
        });
    }

    public void shutdown() {
        if (active != null) active.set(true);
        executor.shutdownNow();
    }

    private void execute(Listener listener, Work work) {
        if (isBusy()) {
            listener.onError("已有公开店铺任务正在运行", store.getShops());
            return;
        }
        AtomicBoolean cancelled = new AtomicBoolean(false);
        active = cancelled;
        executor.submit(() -> {
            try {
                String message = work.run(cancelled);
                main.post(() -> listener.onSuccess(message, store.getShops()));
            } catch (Exception error) {
                String message = error.getMessage() == null ? "公开店铺操作失败" : error.getMessage();
                main.post(() -> listener.onError(message, store.getShops()));
            } finally {
                if (active == cancelled) active = null;
            }
        });
    }

    private PublicShopSnapshot refreshInternal(String token, JSONObject seed, AtomicBoolean cancelled) throws Exception {
        JSONObject info = requestData("/shopApi/Shop/info", new JSONObject().put("token", token).put("category_key", ""), cancelled);
        String name = text(info.opt("nickname"));
        if (name.isEmpty()) name = text(info.opt("name"));
        if (name.isEmpty()) name = token;
        List<String> types = declaredTypes(info.opt("goods_type_sort"));
        if (types.isEmpty()) types.addAll(SUPPORTED_TYPES);
        List<ProductRecord> products = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String type : types) {
            if (info.has(type + "_count") && info.optInt(type + "_count", -1) == 0) continue;
            int typeLoaded = 0;
            for (int page = 1; page <= MAX_PAGES; page++) {
                JSONObject payload = new JSONObject()
                    .put("token", token)
                    .put("keywords", "")
                    .put("category_id", 0)
                    .put("goods_type", type)
                    .put("current", page)
                    .put("pageSize", PAGE_SIZE);
                JSONObject data = requestData("/shopApi/Shop/goodsList", payload, cancelled);
                JSONArray list = data.optJSONArray("list");
                if (list == null) list = new JSONArray();
                typeLoaded += list.length();
                for (int index = 0; index < list.length(); index++) {
                    JSONObject raw = list.optJSONObject(index);
                    if (raw == null) continue;
                    ProductRecord product = ProductUtils.normalizePublic(raw, token, name, products.size(), type);
                    if (!product.productKey.isEmpty() && seen.add(product.identity())) products.add(product);
                }
                int total = data.has("total") ? data.optInt("total", -1) : -1;
                if (list.length() == 0 || (total >= 0 ? typeLoaded >= total : list.length() < PAGE_SIZE)) break;
                sleep(REQUEST_GAP_MS, cancelled);
            }
            sleep(REQUEST_GAP_MS, cancelled);
        }
        if (seed != null) {
            ProductRecord product = ProductUtils.normalizePublic(seed, token, name, products.size(), "");
            if (!product.productKey.isEmpty() && seen.add(product.identity())) products.add(product);
        }
        PublicShopSnapshot previous = store.find(token);
        PublicShopSnapshot shop = new PublicShopSnapshot();
        shop.token = token;
        shop.name = name;
        String link = text(info.opt("link"));
        shop.url = link.startsWith("https://") ? link : ApiClient.BASE_URL + "/shop/" + token;
        shop.createdAt = previous == null ? System.currentTimeMillis() : previous.createdAt;
        shop.updatedAt = System.currentTimeMillis();
        shop.lastError = "";
        shop.products.addAll(ProductUtils.deduplicate(products));
        store.upsert(shop);
        return shop;
    }

    private JSONObject requestData(String endpoint, JSONObject payload, AtomicBoolean cancelled) throws ApiException {
        ApiException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                ApiEnvelope response = api.postPublic(endpoint, payload, cancelled);
                if (response.code != 1 || !(response.data instanceof JSONObject)) {
                    throw new ApiException(response.message.isEmpty() ? "公开接口返回失败" : response.message, 200, response.code, false);
                }
                return (JSONObject) response.data;
            } catch (ApiException error) {
                last = error;
                if (error.status == 429 || !error.retryable || attempt >= 2) throw error;
                sleep(400L * (attempt + 1), cancelled);
            }
        }
        throw last == null ? new ApiException("公开接口请求失败", 0, 0, false) : last;
    }

    private static List<String> declaredTypes(Object value) {
        Set<String> result = new LinkedHashSet<>();
        if (value instanceof JSONArray) {
            JSONArray list = (JSONArray) value;
            for (int index = 0; index < list.length(); index++) {
                Object item = list.opt(index);
                String type = item instanceof JSONObject
                    ? text(((JSONObject) item).opt("goods_type"), ((JSONObject) item).opt("type"), ((JSONObject) item).opt("key"))
                    : text(item);
                if (SUPPORTED_TYPES.contains(type)) result.add(type);
            }
        } else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            for (String type : SUPPORTED_TYPES) if (object.has(type)) result.add(type);
        } else {
            for (String type : text(value).split("[,，\\s]+")) if (SUPPORTED_TYPES.contains(type)) result.add(type);
        }
        return new ArrayList<>(result);
    }

    private static String text(Object... values) {
        for (Object value : values) {
            if (value == null || value == JSONObject.NULL) continue;
            if (value instanceof String || value instanceof Number) {
                String text = String.valueOf(value).trim();
                if (!text.isEmpty()) return text;
            }
        }
        return "";
    }

    private static void sleep(long millis, AtomicBoolean cancelled) throws ApiException {
        long remaining = millis;
        while (remaining > 0) {
            if (cancelled.get()) throw new ApiException("操作已取消", 0, 0, false);
            long slice = Math.min(100, remaining);
            try { Thread.sleep(slice); } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new ApiException("操作已取消", 0, 0, false);
            }
            remaining -= slice;
        }
    }

    private interface Work { String run(AtomicBoolean cancelled) throws Exception; }
}
