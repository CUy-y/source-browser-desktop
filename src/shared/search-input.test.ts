import { describe, expect, it } from "vitest";
import { normalizeRequestedPagesOnBlur, parseRequestedPages } from "./search-input";

describe("requested page input", () => {
  it("allows an empty draft while the user deletes and retypes", () => {
    expect(normalizeRequestedPagesOnBlur("")).toBe("");
    expect(() => parseRequestedPages("")).toThrow("拉取页数不能为空");
  });

  it("accepts 50 directly and clamps values only on blur", () => {
    expect(parseRequestedPages("50")).toBe(50);
    expect(normalizeRequestedPagesOnBlur("500")).toBe("100");
    expect(normalizeRequestedPagesOnBlur("0")).toBe("1");
  });
});
