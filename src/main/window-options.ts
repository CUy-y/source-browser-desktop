import type { BrowserWindowConstructorOptions } from "electron";

export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1500,
    height: 960,
    minWidth: 1060,
    minHeight: 700,
    title: "链动货源查询",
    backgroundColor: "#fffafb",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !process.env.NODE_ENV || process.env.NODE_ENV !== "production"
    }
  };
}
