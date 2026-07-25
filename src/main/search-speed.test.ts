import { describe, expect, it } from "vitest";
import { SEARCH_SPEED_PROFILES } from "./search-speed";

describe("search speed profiles", () => {
  it("uses the selected stable, standard and fast limits", () => {
    expect(SEARCH_SPEED_PROFILES.stable).toMatchObject({ baseDelayMs: 200, concurrency: 1, min429DelayMs: 1500 });
    expect(SEARCH_SPEED_PROFILES.standard).toMatchObject({ baseDelayMs: 90, concurrency: 1, min429DelayMs: 1200 });
    expect(SEARCH_SPEED_PROFILES.fast).toMatchObject({ baseDelayMs: 40, concurrency: 2, min429DelayMs: 1000 });
  });
});
