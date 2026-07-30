/// <reference types="vite/client" />

import type { ScanAPI } from "../../electron/preload";

declare global {
  interface Window {
    scanAPI: ScanAPI;
  }
}

export {};
