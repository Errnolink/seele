import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { MediaFile } from "../src/scanner/types";

/**
 * On-disk metadata cache for scanned media (v4 rework).
 *
 * Stores the full file list from the last scan of every library root plus
 * any dimensions the renderer has measured (from thumbnail <img>
 * naturalWidth/Height). This lets the app restore all scanned roots
 * instantly at startup — no filesystem walk, no header reads, no
 * thumbnail decoding needed to show the masonry at correct aspect ratios.
 *
 * Structure (single JSON file in userData):
 *   { folders: { [rootPath]: { files: MediaFile[], dims: { [path]: {w,h} } } } }
 *
 * The main process writes files on scan completion and merges dims as
 * the renderer reports them. Atomic writes (tmp + rename) prevent
 * corruption on crash/quit.
 */

interface DimEntry {
  w: number;
  h: number;
}

interface CacheFolder {
  files: MediaFile[];
  dims: Record<string, DimEntry>;
}

interface CacheShape {
  /** Keyed by the root folder path as passed by the caller. */
  folders: Record<string, CacheFolder>;
}

const CACHE_FILENAME = "media-cache.json";

let cachePath = "";
let loaded = false;
let cache: CacheShape = { folders: {} };
let dirty = false;
/** Coalesced flush timer — absorbs bursts of dimension reports. */
let flushTimer: NodeJS.Timeout | null = null;
/** Persistent path→{folder,index} lookup so recordDimensions is O(1) per
 *  entry instead of rebuilding a 50k-entry Map every call (v4 review M-4). */
let fileIndexByPath: Map<string, { folder: string; index: number }> =
  new Map();

/** Lazily resolve the cache file path under userData. */
function ensurePath(): string {
  if (!cachePath) {
    cachePath = path.join(app.getPath("userData"), CACHE_FILENAME);
  }
  return cachePath;
}

/** Rebuild the persistent path→location lookup from all cached folders. */
function rebuildIndex(): void {
  fileIndexByPath = new Map();
  for (const [folder, entry] of Object.entries(cache.folders)) {
    entry.files.forEach((f, i) => {
      fileIndexByPath.set(f.filePath, { folder, index: i });
    });
  }
}

/** Read the cache from disk (once per process). */
function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(ensurePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<CacheShape> & {
      folder?: string;
      files?: MediaFile[];
      dims?: Record<string, DimEntry>;
    };
    if (parsed.folders && typeof parsed.folders === "object") {
      cache = {
        folders: parsed.folders as Record<string, CacheFolder>,
      };
    } else if (typeof parsed.folder === "string" && parsed.folder.length > 0) {
      // Pre-multi-root shape: a single folder. Adopt it as that folder's
      // entry so the first launch after the upgrade keeps its cache.
      cache = {
        folders: {
          [parsed.folder]: {
            files: Array.isArray(parsed.files) ? parsed.files : [],
            dims: parsed.dims ?? {},
          },
        },
      };
    } else {
      cache = { folders: {} };
    }
  } catch (e) {
    // Corrupt or missing cache — start fresh.
    if (process.env.NODE_ENV !== "production") console.debug("[mediaCache] load failed:", e);
    cache = { folders: {} };
  }
  rebuildIndex();
}

/** Atomically write the cache to disk (tmp + rename). Async so the
 * main process event loop isn't blocked by a multi-MB JSON write
 * during scrolling (v4 review H-6). Errors are logged, not swallowed
 * silently (v4 review L-2). */
async function persist(): Promise<void> {
  if (!dirty) return;
  // CORR-2: Clear dirty and snapshot synchronously BEFORE awaiting I/O.
  // Setting dirty=false after the await overwrites a dirty=true set by
  // an update that arrived during the write, silently losing data.
  dirty = false;
  const snapshot = JSON.stringify(cache);
  try {
    const p = ensurePath();
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await fs.promises.writeFile(tmp, snapshot, "utf-8");
    await fs.promises.rename(tmp, p);
  } catch (e) {
    // Restore dirty so the next flush retries.
    dirty = true;
    console.warn("mediaCache persist failed:", e);
  }
}

/**
 * Schedule a deferred flush (coalesced). Multiple dimension-report bursts
 * within the window collapse into a single disk write.
 */
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) void persist();
  }, 2000);
}

/**
 * Store the full file list from a completed scan of `folderPath` (called
 * by main when the worker reports "done"). Dimensions from any prior scan
 * of the same folder are preserved; dims for files no longer present are
 * dropped. Other roots' entries are untouched.
 */
export function recordScanResult(folderPath: string, files: MediaFile[]): void {
  load();
  const prior = cache.folders[folderPath];
  const survivingDims: Record<string, DimEntry> = {};
  const fileSet = new Set(files.map((f) => f.filePath));
  for (const [p, d] of Object.entries(prior?.dims ?? {})) {
    if (fileSet.has(p)) survivingDims[p] = d;
  }
  cache = {
    folders: {
      ...cache.folders,
      [folderPath]: { files, dims: survivingDims },
    },
  };
  rebuildIndex();
  dirty = true;
  scheduleFlush();
}

/** Remove specific file paths from the cache. Used when externally-deleted
 *  files are detected during cache restore — the on-disk list goes stale
 *  between sessions when files are removed outside the app (Explorer, etc.). */
export function removeFiles(filePaths: string[]): void {
  if (filePaths.length === 0) return;
  load();
  const remove = new Set(filePaths);
  let changed = false;
  const nextFolders: Record<string, CacheFolder> = {};
  for (const [folder, entry] of Object.entries(cache.folders)) {
    const before = entry.files.length;
    const files = entry.files.filter((f) => !remove.has(f.filePath));
    let dims = entry.dims;
    for (const p of remove) {
      if (p in dims) {
        if (dims === entry.dims) dims = { ...dims };
        delete dims[p];
      }
    }
    if (files.length !== before || dims !== entry.dims) changed = true;
    nextFolders[folder] = { files, dims };
  }
  if (changed) {
    cache = { folders: nextFolders };
    rebuildIndex();
    dirty = true;
    scheduleFlush();
  }
}

/**
 * Merge measured dimensions from the renderer into the cache (v4 rework).
 * Uses the persistent `fileIndexByPath` map for O(1) lookup instead of
 * rebuilding a 50k-entry Map on every call (v4 review M-4).
 */
export function recordDimensions(
  entries: { filePath: string; width: number; height: number }[],
): void {
  load();
  let changed = false;
  for (const { filePath, width, height } of entries) {
    if (width <= 0 || height <= 0) continue;
    const loc = fileIndexByPath.get(filePath);
    if (!loc) continue;
    const entry = cache.folders[loc.folder];
    if (!entry) continue;
    const prev = entry.dims[filePath];
    if (prev && prev.w === width && prev.h === height) continue;
    entry.dims[filePath] = { w: width, h: height };
    changed = true;
    // Also patch the MediaFile so loadCachedFiles returns up-to-date dims.
    entry.files[loc.index] = { ...entry.files[loc.index], width, height };
  }
  if (changed) {
    dirty = true;
    scheduleFlush();
  }
}

/**
 * Return all cached files for a root as `MediaFile[]`. Used at app start
 * so the gallery appears instantly while a real scan refreshes in the
 * background.
 */
export function loadCachedFiles(folderPath: string): MediaFile[] {
  load();
  return cache.folders[folderPath]?.files ?? [];
}

/** Flush any pending writes on quit. Sync because the app is exiting
 * and async writes may not complete before process termination. */
export function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirty) {
    try {
      const p = ensurePath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache), "utf-8");
      fs.renameSync(tmp, p);
      dirty = false;
    } catch (e) {
      console.warn("mediaCache flush failed:", e);
    }
  }
}
