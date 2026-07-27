package cn.ldxp.sourcebrowser.android;

import cn.ldxp.sourcebrowser.android.network.AdaptiveRateLimiter;
import cn.ldxp.sourcebrowser.android.network.ApiException;

import org.junit.Test;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public final class AdaptiveRateLimiterTest {
    @Test public void increasesOn429AndRecoversAfterSuccess() {
        AdaptiveRateLimiter limiter = new AdaptiveRateLimiter(40, 2500, 40, 1000, false);
        limiter.onBackpressure(429);
        assertTrue(limiter.delayMs() >= 1000);
        int pressured = limiter.delayMs();
        limiter.onSuccess();
        assertTrue(limiter.delayMs() < pressured);
        assertTrue(limiter.delayMs() >= 40);
    }

    @Test public void cancellationStopsWaiting() {
        AdaptiveRateLimiter limiter = new AdaptiveRateLimiter(200, 4000, 200, 1500, true);
        try {
            limiter.waitTurn(new AtomicBoolean(true));
            fail("expected cancellation");
        } catch (ApiException expected) {
            assertEquals("查询已取消", expected.getMessage());
        }
    }
}
