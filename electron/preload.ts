import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";
import type { AppSettings } from "./settings";

/**
 * Surface offered to the renderer under `window.scanAPI`.
 *
 * The streaming contract mirrors the main process: `startScan` returns
 * a promise for the final count, while batches and progress arrive via
 * the callbacks. Every scan event is tagged with the originating folder
 * (main relays `{ folder, ... }` payloads), so concurrent scans of
 * different library roots can run at once — each `startScan` call only
 * forwards events matching its own folder. Listeners are removed when
 * that scan completes or errors, so repeated `startScan` calls never
 * leak handlers (v4 review H-1).
 */
export interface ScanAPI {
  /** Open a native folder picker. Resolves to the path or `null`. */
  selectFolder(): Promise<string | null>;

  /**
   * Resolve the absolute path of a dropped/selected `File` via Electron's
   * `webUtils.getPathForFile` (the supported replacement for the
   * deprecated non-standard `File.path`).
   */
  getPathForFile(file: File): string;

  /**
   * Convert an absolute file path into a `media://` URL the renderer can
   * load as an <img> src. Thumbnails are resized server-side via `?w=`.
   */
  toMediaUrl(filePath: string): string;

  /**
   * Begin scanning `folderPath`. Streams batches/progress/metadata to the
   * given callbacks and resolves with the final file count. Multiple
   * concurrent scans of different folders are supported; each call's
   * events are routed by folder.
   */
  startScan(
    folderPath: string,
    onBatch: (files: MediaFile[]) => void,
    onProgress?: (progress: ScanProgress) => void,
    onDone?: (total: number) => void,
    onError?: (message: string) => void,
    onMetaBatch?: (patches: MetaPatch[]) => void,
  ): Promise<number>;

  /** Cancel the scan of `folderPath`, or every active scan if omitted. */
  cancelScan(folderPath?: string): Promise<boolean>;

  /**
   * Restore a folder from the on-disk dimension cache instantly, without a
   * filesystem walk (v4 rework). Returns cached `MediaFile[]` (possibly
   * empty). Call at startup so reopening a folder is immediate.
   */
  loadCachedFiles(folderPath: string): Promise<MediaFile[]>;

  /**
   * Subscribe to library-root change notifications (the main process
   * watches each root; a debounced filesystem change fires this with the
   * affected root). Returns an unsubscribe function.
   */
  onRootChanged(callback: (root: string) => void): () => void;

  /**
   * Persist measured dimensions for files (v4 rework). The renderer
   * derives these from thumbnail <img> naturalWidth/Height; main writes
   * them to the on-disk cache so the next startup restores the masonry
   * at correct aspect ratios without re-decoding.
   */
  saveDimensions(
    entries: { filePath: string; width: number; height: number }[],
  ): Promise<void>;

  /** Reveal a file in the native file manager (v3 review #13). */
  showItemInFolder(filePath: string): Promise<void>;
  /** Open a file with the OS default application (v3 review #13). */
  openPath(filePath: string): Promise<string>;
  /** Copy text to the system clipboard (v3 review #13). */
  writeClipboard(text: string): Promise<void>;
  /** Hash + dominant colors + EXIF camera info for the inspector panel. */
  getFileInsights(filePath: string): Promise<{
    hash: string;
    colors: Array<{ r: number; g: number; b: number; hex: string }>;
    camera: { make?: string; model?: string; lens?: string; fNumber?: number; iso?: number; exposure?: string };
  } | null>;

  // ── File operations (organize & move) ──

  /** Result of a single file operation. */
  moveFile(filePath: string, destDir: string): Promise<{ filePath: string; ok: boolean; newPath?: string; error?: string }>;
  moveFiles(filePaths: string[], destDir: string): Promise<Array<{ filePath: string; ok: boolean; newPath?: string; error?: string }>>;
  trashFile(filePath: string): Promise<{ filePath: string; ok: boolean; error?: string }>;
  trashFiles(filePaths: string[]): Promise<Array<{ filePath: string; ok: boolean; error?: string }>>;
  renameFile(filePath: string, newName: string): Promise<{ filePath: string; ok: boolean; newPath?: string; error?: string }>;
  createFolder(dirPath: string): Promise<{ ok: boolean; error?: string }>;
  pickMoveTarget(defaultPath?: string): Promise<string | null>;

  // ── Window controls (custom titlebar) ──
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;

  // ── Settings (performance knobs — issues.md item 6) ──
  /** Read the persisted settings. `exists: false` on first launch. */
  getSettings(): Promise<{ settings: AppSettings; exists: boolean }>;
  /** Persist a partial patch; resolves with the merged settings. */
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

const api: ScanAPI = {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Host is a fixed sentinel; the encoded absolute path goes in the
  // pathname so URL host parsing can't mangle Windows paths (#2).
  toMediaUrl: (filePath) => `media://local/${encodeURIComponent(filePath)}`,

  startScan: (folderPath, onBatch, onProgress, onDone, onError, onMetaBatch) => {
    // Route by folder: concurrent scans of different roots each register
    // their own handlers, and only events for THIS folder are forwarded.
    const batchHandler = (
      _e: Electron.IpcRendererEvent,
      payload: { folder: string; files: MediaFile[] },
    ) => {
      if (payload.folder !== folderPath) return;
      onBatch(payload.files);
    };
    const progressHandler = (
      _e: Electron.IpcRendererEvent,
      payload: { folder: string; progress: ScanProgress },
    ) => {
      if (payload.folder !== folderPath) return;
      onProgress?.(payload.progress);
    };
    const metaBatchHandler = (
      _e: Electron.IpcRendererEvent,
      payload: { folder: string; patches: MetaPatch[] },
    ) => {
      if (payload.folder !== folderPath) return;
      onMetaBatch?.(payload.patches);
    };
    const errorHandler = (
      _e: Electron.IpcRendererEvent,
      payload: { folder: string; message: string },
    ) => {
      if (payload.folder !== folderPath) return;
      cleanup();
      onError?.(payload.message);
    };
    const doneHandler = (
      _e: Electron.IpcRendererEvent,
      payload: { folder: string; total: number },
    ) => {
      if (payload.folder !== folderPath) return;
      cleanup();
      onDone?.(payload.total);
    };

    function cleanup(): void {
      ipcRenderer.removeListener("scan:batch", batchHandler);
      ipcRenderer.removeListener("scan:progress", progressHandler);
      ipcRenderer.removeListener("scan:error", errorHandler);
      ipcRenderer.removeListener("scan:metaBatch", metaBatchHandler);
      ipcRenderer.removeListener("scan:done", doneHandler);
    }

    ipcRenderer.on("scan:batch", batchHandler);
    ipcRenderer.on("scan:progress", progressHandler);
    ipcRenderer.on("scan:error", errorHandler);
    ipcRenderer.on("scan:metaBatch", metaBatchHandler);
    ipcRenderer.on("scan:done", doneHandler);

    return ipcRenderer.invoke("scan:start", folderPath);
  },

  cancelScan: (folderPath) => ipcRenderer.invoke("scan:cancel", folderPath),

  loadCachedFiles: (folderPath: string) =>
    ipcRenderer.invoke("scan:loadCached", folderPath),

  onRootChanged: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, root: string) => {
      if (typeof root === "string" && root.length > 0) callback(root);
    };
    ipcRenderer.on("library:rootChanged", handler);
    return () => ipcRenderer.removeListener("library:rootChanged", handler);
  },

  saveDimensions: (
    entries: { filePath: string; width: number; height: number }[],
  ) => ipcRenderer.invoke("scan:saveDimensions", entries),

  // Context-menu / shell actions.
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  getFileInsights: (filePath) => ipcRenderer.invoke("file:insights", filePath),
  openPath: (filePath) => ipcRenderer.invoke("shell:openPath", filePath),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:writeText", text),

  // File operations (organize & move).
  moveFile: (filePath, destDir) => ipcRenderer.invoke("file:move", filePath, destDir),
  moveFiles: (filePaths, destDir) => ipcRenderer.invoke("file:moveBatch", filePaths, destDir),
  trashFile: (filePath) => ipcRenderer.invoke("file:trash", filePath),
  trashFiles: (filePaths) => ipcRenderer.invoke("file:trashBatch", filePaths),
  renameFile: (filePath, newName) => ipcRenderer.invoke("file:rename", filePath, newName),
  createFolder: (dirPath) => ipcRenderer.invoke("folder:create", dirPath),
  pickMoveTarget: (defaultPath) => ipcRenderer.invoke("dialog:pickMoveTarget", defaultPath),

  // Window controls (custom titlebar).
  winMinimize: () => ipcRenderer.send("win:minimize"),
  winMaximize: () => ipcRenderer.send("win:maximize"),
  winClose: () => ipcRenderer.send("win:close"),

  // Settings (performance knobs).
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
};

contextBridge.exposeInMainWorld("scanAPI", api);
