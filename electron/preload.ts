import { contextBridge, ipcRenderer } from "electron";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";
/** Tracks the previous scan's listener cleanup so a new scan removes them (v4 H-1). */
let activeScanCleanup: (() => void) | null = null;

/**
 * Surface offered to the renderer under `window.scanAPI`.
 *
 * The streaming contract mirrors the main process: `startScan` returns
 * a promise for the final count, while batches and progress arrive via
 * the callbacks.  Listeners are removed automatically when the scan
 * completes, so the renderer can call `startScan` again without leaks.
 *
 * `cancelScan` asks the main process to abort the active scan.
 */
export interface ScanAPI {
  /** Open a native folder picker. Resolves to the path or `null`. */
  selectFolder(): Promise<string | null>;

  /**
   * Convert an absolute file path into a `media://` URL the renderer can
   * load as an image/video source (contextIsolation blocks file://).
   *
   * Shape: `media://local/<percent-encoded-absolute-path>`. The host is a
   * fixed sentinel so the full path lives in the pathname — URL host
   * parsing no longer lowercases Windows drive letters or splits on
   * sub-directories (review issue #2).
   */
  toMediaUrl(filePath: string): string;

  /**
   * Begin scanning `folderPath`.
   *
   * Two-phase scan (v5 rework): Phase 1 emits placeholder files
   * instantly (size 0, date "unknown") so the gallery renders before
   * any `stat` I/O. Phase 2 stats each file and calls `onMetaBatch`
   * with patches to fill in real size/date progressively.
   *
   * @param onBatch      called with each chunk of ~250 discovered files
   * @param onProgress   optional, called as batches flush
   * @param onDone       optional, called once with the total count
   * @param onError      optional, called if the scan fails on the main side
   * @param onMetaBatch  optional, called with metadata patches (Phase 2)
   * @returns            the final total count
   */
  startScan(
    folderPath: string,
    onBatch: (files: MediaFile[]) => void,
    onProgress?: (progress: ScanProgress) => void,
    onDone?: (total: number) => void,
    onError?: (message: string) => void,
    onMetaBatch?: (patches: MetaPatch[]) => void,
  ): Promise<number>;

  /** Cancel the active scan, if any. Resolves once cancellation is sent. */
  cancelScan(): Promise<boolean>;

  /**
   * Restore a folder from the on-disk dimension cache instantly, without a
   * filesystem walk (v4 rework). Returns cached `MediaFile[]` (possibly
   * empty). Call at startup so reopening a folder is immediate.
   */
  loadCachedFiles(folderPath: string): Promise<MediaFile[]>;

  /** Whether a folder has any cached files (startup restore check). */
  hasCachedFiles(folderPath: string): Promise<boolean>;

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
}

const api: ScanAPI = {
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),

  // Host is a fixed sentinel; the encoded absolute path goes in the
  // pathname so URL host parsing can't mangle Windows paths (#2).
  toMediaUrl: (filePath) => `media://local/${encodeURIComponent(filePath)}`,

  startScan: (folderPath, onBatch, onProgress, onDone, onError, onMetaBatch) => {
    // Clean up any previous scan listeners — without this, rapid
    // re-scans or a worker crash-without-done stack duplicate handlers,
    // causing double processing and a memory leak (v4 review H-1).
    activeScanCleanup?.();

    const batchHandler = (_e: Electron.IpcRendererEvent, batch: MediaFile[]) =>
      onBatch(batch);
    const progressHandler = (
      _e: Electron.IpcRendererEvent,
      progress: ScanProgress,
    ) => onProgress?.(progress);
    const errorHandler = (
      _e: Electron.IpcRendererEvent,
      message: string,
    ) => onError?.(message);
    const metaBatchHandler = (
      _e: Electron.IpcRendererEvent,
      patches: MetaPatch[],
    ) => onMetaBatch?.(patches);

    function cleanup(): void {
      ipcRenderer.removeListener("scan:batch", batchHandler);
      ipcRenderer.removeListener("scan:progress", progressHandler);
      ipcRenderer.removeListener("scan:error", errorHandler);
      ipcRenderer.removeListener("scan:metaBatch", metaBatchHandler);
      ipcRenderer.removeListener("scan:done", doneHandler);
      activeScanCleanup = null;
    }

    const doneHandler = (_e: Electron.IpcRendererEvent, total: number) => {
      cleanup();
      onDone?.(total);
    };

    activeScanCleanup = cleanup;

    ipcRenderer.on("scan:batch", batchHandler);
    ipcRenderer.on("scan:progress", progressHandler);
    ipcRenderer.on("scan:error", errorHandler);
    ipcRenderer.on("scan:metaBatch", metaBatchHandler);
    ipcRenderer.once("scan:done", doneHandler);

    return ipcRenderer.invoke("scan:start", folderPath);
  },

  cancelScan: () => ipcRenderer.invoke("scan:cancel"),

  loadCachedFiles: (folderPath: string) =>
    ipcRenderer.invoke("scan:loadCached", folderPath),
  hasCachedFiles: (folderPath: string) =>
    ipcRenderer.invoke("scan:hasCached", folderPath),
  saveDimensions: (
    entries: { filePath: string; width: number; height: number }[],
  ) => ipcRenderer.invoke("scan:saveDimensions", entries),

  // Context-menu / shell actions.
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
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
};

contextBridge.exposeInMainWorld("scanAPI", api);
