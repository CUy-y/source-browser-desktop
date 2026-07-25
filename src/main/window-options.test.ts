import { describe, expect, it } from "vitest";
import { createMainWindowOptions } from "./window-options";

describe("main window security", () => {
  it("keeps renderer isolation enabled and Node disabled", () => {
    const options = createMainWindowOptions("C:/app/preload.js");
    expect(options.webPreferences).toMatchObject({
      preload: "C:/app/preload.js",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    });
  });
});
