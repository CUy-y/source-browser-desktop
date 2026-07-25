const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException("查询已取消", "AbortError"));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
});

export class AdaptiveRateLimiter {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly min429DelayMs: number;
  private currentDelayMs: number;
  private nextRequestAt = 0;

  constructor(baseDelayMs = 350, maxDelayMs = 3000, initialDelayMs = baseDelayMs, min429DelayMs = 1500, delayFirstRequest = false) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.min429DelayMs = min429DelayMs;
    this.currentDelayMs = Math.min(maxDelayMs, Math.max(baseDelayMs, initialDelayMs));
    if (delayFirstRequest) this.nextRequestAt = Date.now() + this.currentDelayMs;
  }

  get delayMs(): number {
    return Math.round(this.currentDelayMs);
  }

  async wait(signal: AbortSignal): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = scheduledAt + this.currentDelayMs;
    const remaining = scheduledAt - now;
    if (remaining > 0) await abortableDelay(remaining, signal);
  }

  onSuccess(): void {
    if (this.currentDelayMs > this.baseDelayMs) {
      this.currentDelayMs = Math.max(this.baseDelayMs, Math.ceil(this.currentDelayMs * 0.8));
    }
  }

  onBackpressure(status: number): void {
    const minimum = status === 429 ? this.min429DelayMs : this.baseDelayMs;
    this.currentDelayMs = Math.min(this.maxDelayMs, Math.max(minimum, Math.ceil(this.currentDelayMs * 1.7)));
  }

  onNetworkError(): void {
    this.currentDelayMs = Math.min(this.maxDelayMs, Math.ceil(this.currentDelayMs * 1.35));
  }
}
