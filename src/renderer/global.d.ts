import type { SourceBrowserApi } from "../shared/types";

declare global {
  interface Window {
    sourceBrowser: SourceBrowserApi;
  }
}

export {};
