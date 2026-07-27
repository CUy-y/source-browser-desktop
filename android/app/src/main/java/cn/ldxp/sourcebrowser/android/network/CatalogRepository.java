package cn.ldxp.sourcebrowser.android.network;

import android.os.Handler;
import android.os.Looper;

import cn.ldxp.sourcebrowser.android.model.CatalogResult;
import cn.ldxp.sourcebrowser.android.model.ProductRecord;
import cn.ldxp.sourcebrowser.android.model.SearchProgress;
import cn.ldxp.sourcebrowser.android.model.SearchRequest;
import cn.ldxp.sourcebrowser.android.util.ProductUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

public final class CatalogRepository {
    public interface Listener {
        void onProgress(SearchProgress progress);
        void onSuccess(CatalogResult result);
        void onError(String message);
        void onAuthenticationRequired(String message);
    }

    private static final long BACKPRESSURE_COOLDOWN_MS = 30_000;
    private final ApiClient api;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService coordinator = Executors.newSingleThreadExecutor();
    private final ExecutorService pages = Executors.newFixedThreadPool(2);
    private volatile AtomicBoolean activeCancellation;
    private volatile long backpressureUntil;
    private volatile int backpressureDelayMs;

    public CatalogRepository(ApiClient api) {
        this.api = api;
    }

    public synchronized boolean isRunning() {
        return activeCancellation != null && !activeCancellation.get();
    }

    public synchronized void start(SearchRequest request, Listener listener) {
        request.validate();
        if (isRunning()) throw new IllegalStateException("已有查询正在运行");
        AtomicBoolean cancelled = new AtomicBoolean(false);
        activeCancellation = cancelled;
        coordinator.submit(() -> run(request, listener, cancelled));
    }

    public synchronized void cancel() {
        if (activeCancellation != null) activeCancellation.set(true);
    }

    public void shutdown() {
        cancel();
        coordinator.shutdownNow();
        pages.shutdownNow();
    }

    private void run(SearchRequest request, Listener listener, AtomicBoolean cancelled) {
        int[] profile = profile(request.speedMode);
        boolean cooling = System.currentTimeMillis() < backpressureUntil;
        int initial = cooling ? Math.max(profile[0], Math.min(profile[1], backpressureDelayMs)) : profile[0];
        AdaptiveRateLimiter limiter = new AdaptiveRateLimiter(profile[0], profile[1], initial, profile[2], cooling);
        int concurrency = request.speedMode.equals("fast") ? 2 : 1;
        List<ProductRecord> collected = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try {
            PageData first = fetchPage(request, 1, limiter, cancelled);
            int remotePages = Math.max(1, (int) Math.ceil(first.total / (double) request.remotePageSize));
            int totalPages = Math.min(request.pages, remotePages);
            consume(first, 1, request.remotePageSize, collected, seen);
            publishProgress(listener, progress(1, 1, totalPages, remotePages, collected.size(), first.total, limiter.delayMs(), concurrency, true));

            for (int batchStart = 2; batchStart <= totalPages && !cancelled.get();) {
                int batchEnd = Math.min(totalPages, batchStart + concurrency - 1);
                List<Future<PageData>> futures = new ArrayList<>();
                for (int page = batchStart; page <= batchEnd; page++) {
                    int current = page;
                    futures.add(pages.submit(() -> fetchPage(request, current, limiter, cancelled)));
                }
                for (int offset = 0; offset < futures.size(); offset++) {
                    int current = batchStart + offset;
                    PageData data = get(futures.get(offset));
                    consume(data, current, request.remotePageSize, collected, seen);
                    publishProgress(listener, progress(current, current, totalPages, remotePages, collected.size(), first.total, limiter.delayMs(), concurrency, true));
                }
                batchStart = batchEnd + 1;
            }
            if (cancelled.get()) throw new ApiException("查询已取消，结果未更新", 0, 0, false);
            List<ProductRecord> result = new ArrayList<>(collected);
            main.post(() -> listener.onSuccess(new CatalogResult(result, Math.min(totalPages, remotePages), remotePages)));
        } catch (ApiException error) {
            if (error.requiresLogin()) {
                api.tokenStore().clear();
                main.post(() -> listener.onAuthenticationRequired(error.getMessage()));
            } else {
                main.post(() -> listener.onError(error.getMessage()));
            }
        } finally {
            synchronized (this) {
                if (activeCancellation == cancelled) activeCancellation = null;
            }
        }
    }

    private PageData fetchPage(SearchRequest request, int page, AdaptiveRateLimiter limiter, AtomicBoolean cancelled) throws ApiException {
        ApiException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            limiter.waitTurn(cancelled);
            try {
                JSONObject payload = new JSONObject();
                payload.put("current", page);
                payload.put("pageSize", request.remotePageSize);
                payload.put("name", "");
                payload.put("goods_type", request.goodsType);
                payload.put("keywords", request.keywords);
                ApiEnvelope response = api.postAuthenticated("/merchantApi/MyParent/searchGoodsList", payload, cancelled);
                if (response.code != 1 || !(response.data instanceof JSONObject)) {
                    throw new ApiException(response.message.isEmpty() ? "货源接口返回失败" : response.message, 200, response.code, false);
                }
                JSONObject data = (JSONObject) response.data;
                JSONArray list = data.optJSONArray("list");
                limiter.onSuccess();
                return new PageData(Math.max(0, data.optInt("total", 0)), list == null ? new JSONArray() : list);
            } catch (ApiException error) {
                last = error;
                if (error.status == 429) {
                    limiter.onBackpressure(429);
                    backpressureDelayMs = limiter.delayMs();
                    backpressureUntil = System.currentTimeMillis() + BACKPRESSURE_COOLDOWN_MS;
                    throw error;
                }
                if (!error.retryable || attempt >= 2) throw error;
                if (error.status >= 500) limiter.onBackpressure(error.status);
                else limiter.onNetworkError();
                sleep(250L * (attempt + 1), cancelled);
            } catch (Exception error) {
                throw new ApiException(error.getMessage() == null ? "响应解析失败" : error.getMessage(), 0, 0, false);
            }
        }
        throw last == null ? new ApiException("查询失败", 0, 0, false) : last;
    }

    private static void consume(PageData data, int page, int pageSize, List<ProductRecord> target, Set<String> seen) {
        int offset = (page - 1) * pageSize;
        for (int index = 0; index < data.list.length(); index++) {
            JSONObject raw = data.list.optJSONObject(index);
            if (raw == null) continue;
            ProductRecord product = ProductUtils.normalizeSource(raw, offset + index);
            if (seen.add(product.identity())) target.add(product);
        }
    }

    private static PageData get(Future<PageData> future) throws ApiException {
        try {
            return future.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ApiException("查询已取消", 0, 0, false);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof ApiException) throw (ApiException) cause;
            throw new ApiException(cause == null || cause.getMessage() == null ? "查询失败" : cause.getMessage(), 0, 0, false);
        }
    }

    private void publishProgress(Listener listener, SearchProgress progress) {
        main.post(() -> listener.onProgress(progress));
    }

    private static SearchProgress progress(int current, int loadedPages, int totalPages, int remotePages, int loaded, int total, int throttle, int concurrency, boolean resolved) {
        SearchProgress value = new SearchProgress();
        value.currentPage = current;
        value.loadedPages = loadedPages;
        value.totalPages = totalPages;
        value.remoteTotalPages = remotePages;
        value.loaded = loaded;
        value.total = total;
        value.throttleMs = throttle;
        value.concurrency = concurrency;
        value.totalPagesResolved = resolved;
        return value;
    }

    private static int[] profile(String mode) {
        if (mode.equals("stable")) return new int[]{200, 4000, 1500};
        if (mode.equals("standard")) return new int[]{90, 3000, 1200};
        return new int[]{40, 2500, 1000};
    }

    private static void sleep(long millis, AtomicBoolean cancelled) throws ApiException {
        long remaining = millis;
        while (remaining > 0) {
            if (cancelled.get()) throw new ApiException("查询已取消", 0, 0, false);
            long slice = Math.min(100, remaining);
            try { Thread.sleep(slice); } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new ApiException("查询已取消", 0, 0, false);
            }
            remaining -= slice;
        }
    }

    private static final class PageData {
        final int total;
        final JSONArray list;
        PageData(int total, JSONArray list) { this.total = total; this.list = list; }
    }
}
