package cn.ldxp.sourcebrowser.android.network;

import java.util.concurrent.atomic.AtomicBoolean;

public final class AdaptiveRateLimiter {
    private final int baseDelayMs;
    private final int maxDelayMs;
    private final int minimum429Ms;
    private int delayMs;
    private long nextRequestAt;

    public AdaptiveRateLimiter(int baseDelayMs, int maxDelayMs, int initialDelayMs, int minimum429Ms, boolean delayFirst) {
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.minimum429Ms = minimum429Ms;
        delayMs = Math.max(baseDelayMs, Math.min(maxDelayMs, initialDelayMs));
        if (delayFirst) nextRequestAt = System.currentTimeMillis() + delayMs;
    }

    public int delayMs() {
        synchronized (this) { return delayMs; }
    }

    public void waitTurn(AtomicBoolean cancelled) throws ApiException {
        long wait;
        synchronized (this) {
            long now = System.currentTimeMillis();
            long scheduled = Math.max(now, nextRequestAt);
            nextRequestAt = scheduled + delayMs;
            wait = scheduled - now;
        }
        while (wait > 0) {
            if (cancelled.get()) throw new ApiException("查询已取消", 0, 0, false);
            long slice = Math.min(100, wait);
            try { Thread.sleep(slice); } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new ApiException("查询已取消", 0, 0, false);
            }
            wait -= slice;
        }
    }

    public synchronized void onSuccess() {
        if (delayMs > baseDelayMs) delayMs = Math.max(baseDelayMs, (int) Math.ceil(delayMs * 0.8));
    }

    public synchronized void onBackpressure(int status) {
        int minimum = status == 429 ? minimum429Ms : baseDelayMs;
        delayMs = Math.min(maxDelayMs, Math.max(minimum, (int) Math.ceil(delayMs * 1.7)));
    }

    public synchronized void onNetworkError() {
        delayMs = Math.min(maxDelayMs, (int) Math.ceil(delayMs * 1.35));
    }
}
