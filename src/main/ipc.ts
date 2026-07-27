import { BrowserWindow, dialog, ipcMain, net, shell, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import fs from "node:fs";
import {
  connectGoodsSchema,
  externalUrlSchema,
  exportProductsSchema,
  favoriteUpdateSchema,
  goodsIdSchema,
  goodsTypeSchema,
  identitySchema,
  jobIdSchema,
  presetIdSchema,
  publicCatalogSearchSchema,
  publicShopTokenSchema,
  publicSourceUrlSchema,
  searchPresetInputSchema
} from "../shared/schemas";
import { AuthService } from "./auth-service";
import { CatalogService } from "./catalog-service";
import { LocalDataStore } from "./local-data-store";
import { PublicCatalogService } from "./public-catalog-service";
import { productsToCsv } from "./csv-export";

export function registerIpc(auth: AuthService, catalog: CatalogService, publicCatalog: PublicCatalogService, localData: LocalDataStore, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("auth:getStatus", () => auth.getStatus());
  ipcMain.handle("auth:openOfficialLogin", () => auth.openOfficialLogin(getMainWindow() ?? undefined));
  ipcMain.handle("auth:logout", () => auth.logout());

  ipcMain.handle("catalog:startSearch", (_event, request: unknown) => catalog.startSearch(request));
  ipcMain.handle("catalog:getProgress", (_event, jobId: unknown) => catalog.getProgress(jobIdSchema.parse(jobId)));
  ipcMain.handle("catalog:cancel", (_event, jobId: unknown) => catalog.cancel(jobIdSchema.parse(jobId)));
  ipcMain.handle("catalog:getGoodsCategories", (_event, goodsType: unknown) => catalog.getGoodsCategories(goodsTypeSchema.parse(goodsType)));
  ipcMain.handle("catalog:connectGoods", (_event, request: unknown) => catalog.connectGoods(connectGoodsSchema.parse(request)));
  ipcMain.handle("catalog:disconnectGoods", (_event, goodsId: unknown) => catalog.disconnectGoods(goodsIdSchema.parse(goodsId)));
  ipcMain.handle("catalog:exportCsv", async (_event, input: unknown) => {
    const products = exportProductsSchema.parse(input);
    const options: SaveDialogOptions = {
      title: "导出当前筛选结果",
      defaultPath: `链动货源-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV 表格", extensions: ["csv"] }]
    };
    const owner = getMainWindow();
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { exported: false };
    fs.writeFileSync(result.filePath, productsToCsv(products), "utf8");
    return { exported: true, filePath: result.filePath };
  });

  ipcMain.handle("local:getState", () => localData.getState());
  ipcMain.handle("local:upsertFavorite", (_event, input: unknown) => localData.upsertFavorite(favoriteUpdateSchema.parse(input)));
  ipcMain.handle("local:removeFavorite", (_event, identity: unknown) => localData.removeFavorite(identitySchema.parse(identity)));
  ipcMain.handle("local:savePreset", (_event, input: unknown) => localData.savePreset(searchPresetInputSchema.parse(input)));
  ipcMain.handle("local:deletePreset", (_event, id: unknown) => localData.deletePreset(presetIdSchema.parse(id)));

  ipcMain.handle("publicCatalog:search", (_event, request: unknown) => publicCatalog.search(publicCatalogSearchSchema.parse(request)));
  ipcMain.handle("publicCatalog:addSource", (_event, url: unknown) => publicCatalog.addSource(publicSourceUrlSchema.parse(url)));
  ipcMain.handle("publicCatalog:refreshShop", (_event, token: unknown) => publicCatalog.refreshShop(publicShopTokenSchema.parse(token)));
  ipcMain.handle("publicCatalog:refreshAll", () => publicCatalog.refreshAll());
  ipcMain.handle("publicCatalog:removeShop", (_event, token: unknown) => publicCatalog.removeShop(publicShopTokenSchema.parse(token)));
  ipcMain.handle("publicCatalog:importShops", async () => {
    const options: OpenDialogOptions = {
      title: "导入公开店铺列表",
      filters: [{ name: "店铺列表", extensions: ["json", "txt", "csv"] }],
      properties: ["openFile"]
    };
    const owner = getMainWindow();
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { state: localData.getState(), imported: 0, failed: 0, message: "已取消导入" };
    const file = fs.readFileSync(result.filePaths[0], "utf8").slice(0, 2_000_000);
    let urls: string[] = [];
    try {
      const parsed = JSON.parse(file) as unknown;
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { shops?: unknown[] }).shops) ? (parsed as { shops: unknown[] }).shops : [];
      urls = values.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string" ? [(value as { url: string }).url] : []);
    } catch {
      urls = file.match(/https:\/\/(?:pay|www)\.ldxp\.cn\/(?:item|shop)\/[A-Za-z0-9_-]+\/?/g) ?? [];
    }
    const validated = urls.flatMap((url) => {
      const parsed = publicSourceUrlSchema.safeParse(url.trim());
      return parsed.success ? [parsed.data] : [];
    });
    if (!validated.length) {
      return { state: localData.getState(), imported: 0, failed: 0, message: "文件中没有找到有效的链动小铺商品或店铺链接" };
    }
    return publicCatalog.importSources(validated);
  });
  ipcMain.handle("publicCatalog:exportShops", async () => {
    const options: SaveDialogOptions = {
      title: "导出公开店铺列表",
      defaultPath: `链动公开店铺-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON 文件", extensions: ["json"] }]
    };
    const owner = getMainWindow();
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { exported: false };
    fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), shops: publicCatalog.exportSources() }, null, 2), "utf8");
    return { exported: true, filePath: result.filePath };
  });

  ipcMain.handle("system:openExternal", async (_event, rawUrl: unknown) => {
    const url = externalUrlSchema.parse(rawUrl);
    await shell.openExternal(url);
    return { opened: true };
  });
  ipcMain.handle("system:checkOfficialLink", async (_event, rawUrl: unknown) => {
    const url = externalUrlSchema.parse(rawUrl);
    try {
      const response = await net.fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8_000) });
      return { valid: response.status >= 200 && response.status < 400, status: response.status };
    } catch {
      return { valid: false, status: null };
    }
  });
}
