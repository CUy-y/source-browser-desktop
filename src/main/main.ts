import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AuthService } from "./auth-service";
import { CatalogService } from "./catalog-service";
import { LocalDataStore } from "./local-data-store";
import { registerIpc } from "./ipc";
import { createMainWindowOptions } from "./window-options";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, "../preload/index.js");
  const rendererPath = path.join(__dirname, "../../dist-renderer/index.html");
  const window = new BrowserWindow(createMainWindowOptions(preloadPath));
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.once("ready-to-show", () => window.show());
  await window.loadFile(rendererPath);
}

app.whenReady().then(async () => {
  try {
    fs.rmSync(path.join(app.getPath("userData"), "buyer-profile.bin"), { force: true });
  } catch {
    // A legacy encrypted purchase profile is removed on the next launch if Windows still has it locked.
  }
  const auth = new AuthService();
  await auth.initialize();
  const localData = new LocalDataStore(path.join(app.getPath("userData"), "local-library-v1.json"));
  const catalog = new CatalogService(auth, localData);
  registerIpc(auth, catalog, localData, () => mainWindow);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
