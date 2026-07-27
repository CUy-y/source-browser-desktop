import { contextBridge, ipcRenderer } from "electron";
import type { SourceBrowserApi } from "../shared/types";

const api: SourceBrowserApi = {
  auth: {
    getStatus: () => ipcRenderer.invoke("auth:getStatus"),
    openOfficialLogin: () => ipcRenderer.invoke("auth:openOfficialLogin"),
    logout: () => ipcRenderer.invoke("auth:logout")
  },
  catalog: {
    startSearch: (request) => ipcRenderer.invoke("catalog:startSearch", request),
    getProgress: (jobId) => ipcRenderer.invoke("catalog:getProgress", jobId),
    cancel: (jobId) => ipcRenderer.invoke("catalog:cancel", jobId),
    getGoodsCategories: (goodsType) => ipcRenderer.invoke("catalog:getGoodsCategories", goodsType),
    connectGoods: (request) => ipcRenderer.invoke("catalog:connectGoods", request),
    disconnectGoods: (goodsId) => ipcRenderer.invoke("catalog:disconnectGoods", goodsId),
    exportCsv: (products) => ipcRenderer.invoke("catalog:exportCsv", products)
  },
  local: {
    getState: () => ipcRenderer.invoke("local:getState"),
    upsertFavorite: (update) => ipcRenderer.invoke("local:upsertFavorite", update),
    removeFavorite: (identity) => ipcRenderer.invoke("local:removeFavorite", identity),
    savePreset: (input) => ipcRenderer.invoke("local:savePreset", input),
    deletePreset: (id) => ipcRenderer.invoke("local:deletePreset", id)
  },
  publicCatalog: {
    search: (request) => ipcRenderer.invoke("publicCatalog:search", request),
    addSource: (url) => ipcRenderer.invoke("publicCatalog:addSource", url),
    refreshShop: (token) => ipcRenderer.invoke("publicCatalog:refreshShop", token),
    refreshAll: () => ipcRenderer.invoke("publicCatalog:refreshAll"),
    removeShop: (token) => ipcRenderer.invoke("publicCatalog:removeShop", token),
    importShops: () => ipcRenderer.invoke("publicCatalog:importShops"),
    exportShops: () => ipcRenderer.invoke("publicCatalog:exportShops")
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
    checkOfficialLink: (url) => ipcRenderer.invoke("system:checkOfficialLink", url)
  }
};

contextBridge.exposeInMainWorld("sourceBrowser", Object.freeze(api));
