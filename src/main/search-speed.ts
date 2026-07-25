import type { SearchSpeedMode } from "../shared/types";

export type SearchSpeedProfile = {
  baseDelayMs: number;
  maxDelayMs: number;
  min429DelayMs: number;
  concurrency: 1 | 2;
};

export const SEARCH_SPEED_PROFILES: Record<SearchSpeedMode, SearchSpeedProfile> = {
  stable: { baseDelayMs: 200, maxDelayMs: 4000, min429DelayMs: 1500, concurrency: 1 },
  standard: { baseDelayMs: 90, maxDelayMs: 3000, min429DelayMs: 1200, concurrency: 1 },
  fast: { baseDelayMs: 40, maxDelayMs: 2500, min429DelayMs: 1000, concurrency: 2 }
};

export const SEARCH_BACKPRESSURE_COOLDOWN_MS = 30_000;
