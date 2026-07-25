import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveRateLimiter } from "./adaptive-rate-limiter";

describe("AdaptiveRateLimiter", () => {
  afterEach(() => vi.useRealTimers());

  it("increases delay on backpressure and recovers after each success", () => {
    const limiter = new AdaptiveRateLimiter(350, 3000);
    limiter.onBackpressure(429);
    expect(limiter.delayMs).toBe(1500);
    limiter.onSuccess();
    expect(limiter.delayMs).toBe(1200);
  });

  it("waits between requests and can be cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const limiter = new AdaptiveRateLimiter(350, 3000);
    const controller = new AbortController();
    await limiter.wait(controller.signal);
    const waiting = limiter.wait(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reserves separate request start times for concurrent waiters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const limiter = new AdaptiveRateLimiter(80, 2500);
    const controller = new AbortController();
    await limiter.wait(controller.signal);
    const second = limiter.wait(controller.signal);
    const third = limiter.wait(controller.signal);
    let secondDone = false;
    let thirdDone = false;
    void second.then(() => { secondDone = true; });
    void third.then(() => { thirdDone = true; });

    await vi.advanceTimersByTimeAsync(80);
    expect(secondDone).toBe(true);
    expect(thirdDone).toBe(false);
    await vi.advanceTimersByTimeAsync(80);
    expect(thirdDone).toBe(true);
  });

  it("delays the first request when a previous 429 cooldown is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const limiter = new AdaptiveRateLimiter(80, 2500, 1000, 1000, true);
    const waiting = limiter.wait(new AbortController().signal);
    let done = false;
    void waiting.then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
