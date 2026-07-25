import { BrowserWindow, dialog, ipcMain, net, shell } from "electron";
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
  searchPresetInputSchema
} from "../shared/schemas";
import { AuthService } from "./auth-service";
import { CatalogService } from "./catalog-service";
import { LocalDataStore } from "./local-data-store";
import { productsToCsv } from "./csv-export";

export function registerIpc(auth: AuthService, catalog: CatalogService, localData: LocalDataStore, getMainWindow: () => BrowserWindow | null): void {
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
    const options = {
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
