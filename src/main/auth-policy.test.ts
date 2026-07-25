import { describe, expect, it } from "vitest";
import { shouldInvalidateCredential } from "./auth-policy";

describe("credential invalidation policy", () => {
  it("keeps credentials for offline and server failures", () => {
    expect(shouldInvalidateCredential({ status: 0, apiCode: null })).toBe(false);
    expect(shouldInvalidateCredential({ status: 500, apiCode: 1 })).toBe(false);
    expect(shouldInvalidateCredential(new Error("offline"))).toBe(false);
  });

  it("invalidates credentials only for explicit authentication failures", () => {
    expect(shouldInvalidateCredential({ status: 401 })).toBe(true);
    expect(shouldInvalidateCredential({ apiCode: 403 })).toBe(true);
    expect(shouldInvalidateCredential({ name: "AuthRequiredError" })).toBe(true);
  });
});
