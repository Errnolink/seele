import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  nativeImage,
  utilityProcess,
  shell,
  clipboard,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import * as mediaCache from "./mediaCache";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";

/* ------------------------------------------------------------------ *
 *  Window management
 * ------------------------------------------------------------------ */

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    // Custom frameless titlebar (UX-14). On Windows, `titleBarOverlay`
    // reserves a small caption area for native min/max/close buttons
    // overlaying our titlebar, so window controls still work.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0a",
      symbolColor: "#e0530a",
      height: 48,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devUrl = process.env["VITE_DEV_SERVER_URL"];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Privileged scheme: lets the (sandboxed) renderer load local image/video
// thumbnails via `media://local/<encoded-path>` without a file:// origin.
// Must be registered before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * Resolved directories the user has scanned. The `media://` handler only
 * serves files whose real path lives under one of these roots, which
 * blocks path-traversal reads of arbitrary filesystem locations (review
 * issue #6).
 *
 * Entries are added when a scan starts and cleared on a new scan.
 */
const allowedRoots = new Set<string>();

/** Normalize to an absolute, OS-native, case-folded path for set keys.
 * Windows is case-insensitive, so we lowercase there; Linux/macOS are
 * case-sensitive and must NOT be lowercased (v4 review M-6). */
function normalizeRoot(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Check whether `requested` falls under an allowed scan root. */
function isUnderAllowedRoot(requested: string): boolean {
  const requestedNorm =
    process.platform === "win32" ? requested.toLowerCase() : requested;
  return [...allowedRoots].some((root) => {
    const rel = path.relative(root, requestedNorm);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/** Narrow a raw IPC/worker message payload by `type`. */
function messageType(msg: unknown): string | undefined {
  if (msg && typeof msg === "object" && "type" in msg) {
    const t = (msg as { type: unknown }).type;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/** Narrow and return the `files` array from a worker "batch" message. */
function messageFiles(msg: unknown): MediaFile[] {
  if (msg && typeof msg === "object" && "files" in msg) {
    const f = (msg as { files: unknown }).files;
    return Array.isArray(f) ? (f as MediaFile[]) : [];
  }
  return [];
}

/** Narrow and return the `patches` array from a worker "metaBatch" message. */
function messagePatches(msg: unknown): MetaPatch[] {
  if (msg && typeof msg === "object" && "patches" in msg) {
    const p = (msg as { patches: unknown }).patches;
    return Array.isArray(p) ? (p as MetaPatch[]) : [];
  }
  return [];
}

/** Narrow and return the `progress` payload from a worker "progress" message. */
function messageProgress(msg: unknown): ScanProgress | undefined {
  if (msg && typeof msg === "object" && "progress" in msg) {
    const p = (msg as { progress: unknown }).progress;
    if (p && typeof p === "object") return p as ScanProgress;
  }
  return undefined;
}

/** Narrow and return the `total` number from a worker "done" message. */
function messageTotal(msg: unknown): number {
  if (msg && typeof msg === "object" && "total" in msg) {
    const t = (msg as { total: unknown }).total;
    return typeof t === "number" ? t : 0;
  }
  return 0;
}

/** Narrow and return the `folderPath` string from a worker start message. */
function messageStringField(msg: unknown, field: string): string | undefined {
  if (msg && typeof msg === "object" && field in msg) {
    const v = (msg as Record<string, unknown>)[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** PERF-2: LRU cache for downscaled thumbnails so scrolling back doesn't
 * re-decode the source image. Keyed on `${path}?w=${w}`. */
const thumbCache = new Map<string, Uint8Array>();
const THUMB_CACHE_MAX = 500;

app.whenReady().then(() => {
  protocol.handle("media", async (request) => {
    // URL shape: media://local/<percent-encoded-absolute-path>
    // Host is the fixed sentinel "local"; the full path lives in the
    // pathname only, so Windows drive letters and sub-directories are
    // not mangled by URL host parsing (review issue #2).
    const url = new URL(request.url);
    if (url.hostname !== "local") {
      return new Response("Forbidden", { status: 403 });
    }
    // `url.pathname` always carries a leading `/`.
    // treats `/C:\...` as relative to the current drive, which mis-resolves
    // when the CWD is on a different drive — strip the leading slash so the
    // absolute path is honored verbatim (v2 review bug #2). On Linux/macOS
    // the leading slash IS the absolute root and must be preserved (V5 SEC-1).
    const rawPath = decodeURIComponent(url.pathname);
    const raw = process.platform === "win32" ? rawPath.replace(/^\//, "") : rawPath;
    const requested = path.resolve(raw);
    if (!path.isAbsolute(requested)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Path-traversal guard: only serve files under a known scan root
    // (review issue #6). Uses the shared, platform-aware checker so
    // Linux/macOS (case-sensitive) aren't broken (v4 review M-6).
    if (!isUnderAllowedRoot(requested)) {
      return new Response("Forbidden", { status: 403 });
    }

    const targetWidth = url.searchParams.get("w");
    if (targetWidth) {
      const w = parseInt(targetWidth, 10);
      if (Number.isFinite(w) && w > 0 && w <= 512) {
        const cacheKey = `${requested}?w=${w}`;
        const cached = thumbCache.get(cacheKey);
        if (cached) {
          // LRU bump.
          thumbCache.delete(cacheKey);
          thumbCache.set(cacheKey, cached);
          return new Response(cached as unknown as BodyInit, {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
        try {
          // PERF-2: skip downscaling for files > 50 MB to prevent OOM/DoS.
          const stat = await fs.promises.stat(requested);
          if (stat.size > 50 * 1024 * 1024) {
            return net.fetch(pathToFileUrl(requested));
          }
          const buf = await fs.promises.readFile(requested);
          const img = nativeImage.createFromBuffer(buf);
          const resized = img.resize({ width: w, quality: "good" });
          const jpeg = new Uint8Array(resized.toJPEG(75));
          thumbCache.set(cacheKey, jpeg);
          if (thumbCache.size > THUMB_CACHE_MAX) {
            const oldest = thumbCache.keys().next().value;
            if (oldest !== undefined) thumbCache.delete(oldest);
          }
          return new Response(jpeg as unknown as BodyInit, {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch (e) {
          // Resize failed (corrupt image / unsupported format) —
          // fall through to serving the raw file.
          if (!app.isPackaged) console.debug("[media] resize failed:", e);
        }
      }
    }

    return net.fetch(pathToFileUrl(requested));
  });

  createWindow();
});

/** Build a `file://` URL from an absolute native path.
 *
 * Windows absolute paths (e.g. `C:\Users\foo\img.jpg`) need THREE slashes
 * after `file:` — `file:///C:/...` — so the drive letter is part of the
 * path, not parsed as the URL authority. With only two slashes,
 * `file://C:/...` treats `C:` as the host and `net.fetch` fails to
 * resolve it, which is why every thumbnail showed "UNREADABLE"
 * (v2 review bug #1).
 *
 * Unix absolute paths already begin with `/`, so `file://` + `/abs`
 * naturally yields the correct `file:///abs`. */
function pathToFileUrl(p: string): string {
  const norm = process.platform === "win32" ? p.replace(/\\/g, "/") : p;
  return `file:///${norm.replace(/^\/+/, "")}`;
}
app.on("window-all-closed", () => {
  mediaCache.flush();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => mediaCache.flush());

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

/* ------------------------------------------------------------------ *
 *  IPC handlers
 * ------------------------------------------------------------------ */

/**
 * One active scan at a time. `cancelScan` aborts the controller; the
 * utilityProcess worker observes the abort and short-circuits its walk
 * (review issue #3).
 */
let activeScanCancel: (() => void) | null = null;
/** Generation counter so cleanup only clears the active scan's cancel fn (v4 H-3). */
let currentScanId = 0;

/** Open a native folder picker; return the chosen path or `null`. */
ipcMain.handle("dialog:selectFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

/**
 * Start a streaming scan in a `utilityProcess` so heavy directory walking
 * and stat CPU work never block the main process event loop (review
 * issue #18). Results stream back as `scan:batch` / `scan:progress`
 * events and finish with a single `scan:done` carrying the total count.
 *
 * The renderer may cancel at any time via `scan:cancel`.
 */
ipcMain.handle("scan:start", async (event, folderPath: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return 0;

  // Validate the folderPath directly — no need to wrap an already-typed
  // parameter in an object just to narrow it (v2 review #9).
  if (typeof folderPath !== "string" || folderPath.length === 0) return 0;

  // Cancel any still-running scan first.
  activeScanCancel?.();

  // Whitelist the new root BEFORE clearing the old ones, so thumbnails
  // from a previous scan of a different folder don't briefly 403 while
  // the new scan is starting (v2 review #11). We then drop every other
  // root since only one folder is scanned at a time.
  const newRoot = normalizeRoot(folderPath);
  allowedRoots.clear();
  allowedRoots.add(newRoot);

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // Track the final count so the IPC return value matches the contract
  // (v2 review #12). The renderer also receives it via scan:done.
  let total = 0;
  // Accumulate batches so we can persist the full file list to the
  // metadata cache on scan completion (v4 rework) — the renderer never
  // sends files back, so main must keep its own copy.
  const collected: MediaFile[] = [];
  // ARCH-1: O(1) path→index lookup so metaBatch patches update collected
  // in place, preventing unpatched Phase 1 placeholders from being
  // written to the on-disk cache.
  const pathIndex = new Map<string, number>();

  const child = utilityProcess.fork(path.join(__dirname, "scanWorker.js"), [], {
    stdio: "pipe",
  });
  child.stdout?.on("data", (d: Buffer) =>
    console.log(`[scanWorker] ${d.toString().trimEnd()}`),
  );
  child.stderr?.on("data", (d: Buffer) =>
    console.error(`[scanWorker] ${d.toString().trimEnd()}`),
  );

  // Cancellation: the renderer calls `scan:cancel`; we tell the worker.
  // Capture the generation so a late-exiting previous scan can't clear
  // the current scan's cancel function (v4 review H-3).
  const scanId = ++currentScanId;
  activeScanCancel = () => {
    if (child.pid) child.postMessage({ type: "cancel" });
  };

  // Worker → main → renderer streaming events.
  child.on("message", (msg: unknown) => {
    switch (messageType(msg)) {
      case "batch": {
        const files = messageFiles(msg);
        for (const f of files) {
          pathIndex.set(f.filePath, collected.length);
          collected.push(f);
        }
        send("scan:batch", files);
        break;
      }
      case "progress":
        send("scan:progress", messageProgress(msg) as ScanProgress);
        break;
      case "metaBatch": {
        const patches = messagePatches(msg);
        for (const patch of patches) {
          const idx = pathIndex.get(patch.filePath);
          if (idx !== undefined) {
            collected[idx] = {
              ...collected[idx],
              sizeBytes: patch.sizeBytes,
              birthtimeMs: patch.birthtimeMs,
              birthtime: patch.birthtime,
              dateKey: patch.dateKey,
            };
          }
        }
        send("scan:metaBatch", patches);
        break;
      }
      case "done":
        total = messageTotal(msg);
        send("scan:done", total);
        mediaCache.recordScanResult(folderPath, collected);
        break;
      case "error":
        send("scan:error", messageStringField(msg, "message") ?? "scan failed");
        break;
    }
  });
  child.postMessage({ type: "start", folderPath });

  // Wait for the worker to exit, then clean up. Only clear the cancel
  // function if this scan is still the current one — a newer scan may
  // have already replaced it (v4 review H-3).
  await once(child, "exit");
  if (currentScanId === scanId) activeScanCancel = null;

  return total;
});

/** Renderer-initiated scan cancellation (review issue #3). */
ipcMain.handle("scan:cancel", () => {
  activeScanCancel?.();
  return true;
});


/**
 * Restore a previously scanned folder instantly from the on-disk cache,
 * without a filesystem walk. The renderer calls this on startup; the user
 * can still re-scan to pick up added/removed/edited files (v4 rework).
 */
ipcMain.handle("scan:loadCached", (_e, folderPath: string) => {
  if (typeof folderPath !== "string" || folderPath.length === 0) return [];
  // Whitelist the root so cached thumbnails can load via media://.
  allowedRoots.clear();
  allowedRoots.add(normalizeRoot(folderPath));
  return mediaCache.loadCachedFiles(folderPath);
});

/** Whether a folder has any cached files (for the startup restore check). */
ipcMain.handle("scan:hasCached", (_e, folderPath: string) => {
  if (typeof folderPath !== "string" || folderPath.length === 0) return false;
  return mediaCache.hasCachedFiles(folderPath);
});

/**
 * Persist measured dimensions from the renderer (v4 rework). Thumbnails
 * report naturalWidth/Height as they decode; main merges the batch into
 * the on-disk cache so the next startup restores the masonry at correct
 * aspect ratios without re-decoding.
 */
ipcMain.handle(
  "scan:saveDimensions",
  (_e, entries: { filePath: string; width: number; height: number }[]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    mediaCache.recordDimensions(entries);
  },
);

/* ------------------------------------------------------------------ *
 *  Shell handlers (thumbnail right-click context menu — v3 review #13).
 * ------------------------------------------------------------------ */

/** Reveal a file in the native file manager (Explorer/Finder). */
ipcMain.handle("shell:showItemInFolder", (_e, filePath: string) => {
  if (typeof filePath !== "string" || filePath.length === 0) return;
  if (!isUnderAllowedRoot(path.resolve(filePath))) return;
  shell.showItemInFolder(filePath);
});

/** Open a file with the OS default application. */
ipcMain.handle("shell:openPath", async (_e, filePath: string) => {
  if (typeof filePath !== "string" || filePath.length === 0) return "no path";
  if (!isUnderAllowedRoot(path.resolve(filePath)))
    return "forbidden: path not under scanned folder";
  const err = await shell.openPath(filePath);
  return err; // empty string on success, error message otherwise
});

/** Write text to the system clipboard. */
ipcMain.handle("clipboard:writeText", (_e, text: string) => {
  if (typeof text === "string") clipboard.writeText(text);
});
