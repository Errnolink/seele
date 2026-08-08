import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  utilityProcess,
  shell,
  clipboard,
} from "electron";
import sharp, { type Metadata } from "sharp";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import * as mediaCache from "./mediaCache";
import * as settingsStore from "./settings";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";
import { FILE_TYPE_BY_EXT } from "../src/scanner/extensions";
import { isAnimatedGif, isHeicContent } from "../src/scanner/sniff";

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
    frame: false,
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

// ── Window controls (custom titlebar) ──────────────────────────────
ipcMain.on("win:minimize", () => mainWindow?.minimize());
ipcMain.on("win:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("win:close", () => mainWindow?.close());

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

/** Narrow and return a string field from a worker message. */
function messageStringField(msg: unknown, field: string): string | undefined {
  if (msg && typeof msg === "object" && field in msg) {
    const v = (msg as Record<string, unknown>)[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Two-tier thumbnail cache: in-memory LRU (hot) + on-disk JPEGs (cold).
 *  The disk tier lives under app.getPath("cache") so the OS can reclaim it,
 *  but OS cleanup (Windows Storage Sense / Disk Cleanup) is opt-in and
 *  unreliable — the app enforces its own oldest-first eviction on the disk
 *  tier instead (pruneThumbCache). Surviving across restarts means
 *  ffmpeg/sharp never re-extract a thumbnail that's already on disk.
 *  Keyed on a content-derived hash of the cache key string. */
const thumbCache = new Map<string, Uint8Array>();
const THUMB_CACHE_MAX = 150;
/** Disk-tier budget: cap both the file count and the total bytes so a large
 *  library cannot grow the cold cache without bound. */
const THUMB_DISK_MAX_FILES = 5000;
const THUMB_DISK_MAX_BYTES = 512 * 1024 * 1024;
/** Don't scan the whole cache dir more often than this — a prune pass on
 *  every store would thrash the disk on cold-cache bursts. */
const THUMB_PRUNE_MIN_INTERVAL_MS = 60_000;
let lastThumbPruneAt = 0;

/** Resolve the on-disk cache directory. Lazily created on first use.
 *  On Windows this targets %LOCALAPPDATA%/<app>/Cache — the same folder
 *  Windows Storage Sense / Disk Cleanup reclaims, but the app also prunes
 *  it itself (pruneThumbCache). On macOS/Linux, userData/thumbs. */
let thumbDir = "";
function getThumbDir(): string {
  if (!thumbDir) {
    let base: string;
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
      base = path.join(process.env.LOCALAPPDATA, "seele", "Cache");
    } else {
      base = path.join(app.getPath("userData"), "thumbs");
    }
    try {
      thumbDir = path.join(base, "thumbs");
      fs.mkdirSync(thumbDir, { recursive: true });
    } catch {
      thumbDir = path.join(tmpdir(), "seele-thumbs");
      fs.mkdirSync(thumbDir, { recursive: true });
    }
  }
  return thumbDir;
}

/** Sniff Content-Type from the first bytes of a cached thumbnail.
 *  JPEG/PNG/WEBP/GIF all have reliable magic bytes; default to JPEG for
 *  anything unrecognizable (the historical fallback). */
function sniffThumbType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "image/jpeg";
}

/** Map a cache key to a stable, filesystem-safe filename. SHA-1 keeps it
 *  short and collision-free; the leading prefix sharding prevents any
 *  single directory from holding 50k flat entries (faster fs ops). The
 *  extension is omitted — cached bytes may be JPEG or PNG depending on
 *  the source's alpha channel, so we sniff on read instead. */
function thumbDiskPath(cacheKey: string): string {
  const hash = createHash("sha1").update(cacheKey).digest("hex");
  return path.join(getThumbDir(), hash.slice(0, 2), hash);
}

/** Enforce the disk-tier budget: walk the shard dirs, then evict oldest
 *  files (by mtime) until both the file-count and byte caps are satisfied.
 *  Throttled to once a minute and best-effort — a slow disk or a full
 *  backlog must never block thumbnail serving. */
async function pruneThumbCache(): Promise<void> {
  const now = Date.now();
  if (now - lastThumbPruneAt < THUMB_PRUNE_MIN_INTERVAL_MS) return;
  lastThumbPruneAt = now;
  try {
    const root = getThumbDir();
    const entries: Array<{ p: string; size: number; mtime: number }> = [];
    for (const shard of await fs.promises.readdir(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue;
      const shardPath = path.join(root, shard.name);
      for (const f of await fs.promises.readdir(shardPath, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const st = await fs.promises.stat(path.join(shardPath, f.name)).catch(() => null);
        if (st) entries.push({ p: path.join(shardPath, f.name), size: st.size, mtime: st.mtimeMs });
      }
    }
    let totalBytes = entries.reduce((s, e) => s + e.size, 0);
    if (entries.length <= THUMB_DISK_MAX_FILES && totalBytes <= THUMB_DISK_MAX_BYTES) return;
    entries.sort((a, b) => a.mtime - b.mtime);
    let evicted = 0;
    for (const e of entries) {
      if (entries.length - evicted <= THUMB_DISK_MAX_FILES && totalBytes <= THUMB_DISK_MAX_BYTES) break;
      await fs.promises.unlink(e.p).catch(() => {});
      totalBytes -= e.size;
      evicted++;
    }
    if (evicted > 0 && !app.isPackaged) {
      console.debug(`[media] thumb disk prune: evicted ${evicted} files`);
    }
  } catch { /* best-effort */ }
}

/** Store a thumbnail in both tiers (RAM LRU + disk) and run eviction.
 *  The disk write is async + best-effort — a failure just means the next
 *  request re-extracts; it never blocks serving the response or the main
 *  process event loop (sync writes here froze scrolling on cold caches). */
function storeThumb(cacheKey: string, bytes: Uint8Array): void {
  thumbCache.set(cacheKey, bytes);
  if (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) thumbCache.delete(oldest);
  }
  const p = thumbDiskPath(cacheKey);
  fs.promises
    .mkdir(path.dirname(p), { recursive: true })
    .then(() => fs.promises.writeFile(p, bytes))
    .catch((e) => {
      if (!app.isPackaged) console.debug("[media] thumb disk write failed:", e);
    });
  void pruneThumbCache();
}

/** Look up a thumbnail across both tiers. On a RAM miss, checks disk and
 *  backfills the RAM LRU so subsequent hits are fast. Returns null if
 *  absent from both. Async — the disk read never blocks the event loop. */
async function lookupThumb(cacheKey: string): Promise<Uint8Array | null> {
  const ramHit = thumbCache.get(cacheKey);
  if (ramHit) {
    thumbCache.delete(cacheKey);
    thumbCache.set(cacheKey, ramHit); // LRU bump.
    return ramHit;
  }
  try {
    const buf = await fs.promises.readFile(thumbDiskPath(cacheKey));
    const diskHit = new Uint8Array(buf);
    // Backfill RAM without re-evicting just for a disk promotion — only
    // store if there's room; otherwise the disk copy still serves us.
    if (thumbCache.size < THUMB_CACHE_MAX) thumbCache.set(cacheKey, diskHit);
    return diskHit;
  } catch {
    return null;
  }
}

/** Limit concurrent sharp operations. Without this, a grid of 50
 * visible tiles fires 50 parallel libvips decodes — each allocates its
 * own thread pool + intermediate buffers, spiking CPU to 100% and RAM
 * by hundreds of MB. A semaphore of 4 keeps decode latency low while
 * bounding resource use. */
const sharpQueue: (() => void)[] = [];
let sharpActive = 0;
/** Concurrent sharp decodes — fed by the settings decodeConcurrency knob
 *  (default 4), not a hardcoded constant (issues.md item 5). */
let sharpConcurrency = 4;
function withSharpLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      sharpActive++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          sharpActive--;
          const next = sharpQueue.shift();
          if (next) next();
        });
    };
    if (sharpActive < sharpConcurrency) run();
    else sharpQueue.push(run);
  });
}

// sharp decodes off the main thread via libvips worker threads — no
// event-loop blocking, ~5MB peak per decode vs nativeImage's full-res
// bitmap.

/** Concurrency limit for ffmpeg frame extraction. ffmpeg spawns its own
 * threads + decodes; unbounded parallel extraction on a grid of 50
 * videos would swamp CPU. 2 keeps first-paint latency low. */
const ffmpegQueue: (() => void)[] = [];
let ffmpegActive = 0;
/** Concurrency limit for ffmpeg frame extraction — half the settings
 *  decodeConcurrency value (default 2), matching the old constant. */
let ffmpegConcurrency = 2;
function withFfmpegLimit<T>(fn: () => Promise<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const run = () => {
    ffmpegActive++;
    fn().then(resolve, reject).finally(() => {
      ffmpegActive--;
      const next = ffmpegQueue.shift();
      if (next) next();
    });
  };
  if (ffmpegActive < ffmpegConcurrency) run();
  else ffmpegQueue.push(run);
  return promise;
}

/** Sync the sharp/ffmpeg semaphore sizes with the persisted settings.
 *  Called at startup and on every settings change (issues.md item 5). */
function applyConcurrencySettings(settings: settingsStore.AppSettings): void {
  sharpConcurrency = Math.max(1, Math.min(6, settings.decodeConcurrency));
  ffmpegConcurrency = Math.max(1, Math.round(sharpConcurrency / 2));
}
/** Locate ffmpeg on the system PATH. Cached after first lookup.
 *  `where` is Windows-only; macOS/Linux use `which`. */
let ffmpegPath: string | null | undefined;
async function findFfmpeg(): Promise<string | null> {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const cmd = process.platform === "win32" ? "where" : "which";
  const proc = execFile(cmd, ["ffmpeg"], { timeout: 3000 }, (err, stdout) => {
    if (err || !stdout.trim()) { ffmpegPath = null; return resolve(null); }
    ffmpegPath = stdout.trim().split(/\r?\n/)[0];
    resolve(ffmpegPath);
  });
  proc.on("error", () => { ffmpegPath = null; resolve(null); });
  return promise;
}

/** Extract a single frame at ~1s from any ffmpeg-decodable input and
 *  scale it to width `w`. Runs inside the ffmpeg concurrency gate with an
 *  8s timeout; tmp file is always cleaned up. Returns a JPEG Buffer or
 *  null on failure.
 *  HEIC stills are tiled HEVC grids — ffmpeg rejects both `-ss` and `-vf
 *  scale` on them ("simple and complex filtering cannot be used
 *  together"), so pass `{ heic: true }` to extract the full-res frame
 *  unscaled and let the caller downscale with sharp. */
async function extractFrameWithFfmpeg(
  input: string,
  w: number,
  opts: { heic?: boolean } = {},
): Promise<Buffer | null> {
  const ff = await findFfmpeg();
  if (!ff) return null;
  const tmpFile = path.join(tmpdir(), `seele-thumb-${randomBytes(6).toString("hex")}.jpg`);
  try {
    // Extract frame inside the concurrency gate so a grid of 50 videos
    // doesn't spawn 50 ffmpeg processes at once.
    await withFfmpegLimit(async () => {
      // Videos: extract at ~1s to skip title cards. Sub-second clips
      // (reaction GIFs-as-MP4) have no frame at 1s — ffmpeg errors
      // "No filtered frames" / encoder init failure, which would drop the
      // tile. Retry once from the first frame for those. HEIC is
      // extracted unscaled; a seek is invalid on tiled HEVC grids.
      const run = (seek: boolean) =>
        new Promise<void>((resolve, reject) => {
          const args = opts.heic
            ? ["-i", input, "-frames:v", "1", "-q:v", "3", "-update", "1", "-y", tmpFile]
            : [...(seek ? ["-ss", "1"] : []), "-i", input, "-frames:v", "1",
               "-vf", `scale=${w}:-2`, "-q:v", "3", "-update", "1", "-y", tmpFile];
          const proc = execFile(
            ff,
            args,
            { timeout: 8000, windowsHide: true },
            (err) => { if (err) reject(err); else resolve(); },
          );
          proc.on("error", reject);
        });
      try {
        await run(!opts.heic);
      } catch (seekErr) {
        if (opts.heic) throw seekErr;
        await run(false);
      }
    });
    return await fs.promises.readFile(tmpFile);
  } catch (e) {
    if (!app.isPackaged) console.debug("[media] ffmpeg frame extraction failed:", e);
    return null;
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

/** Wrap thumbnail bytes in a cacheable Response. */
function thumbResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
  });
}

/** Memoized source-header sniff (animated-GIF / HEIC routing).
 *  Keyed on size+mtime so edits invalidate. Without this, every thumbnail
 *  request — including two-tier cache hits — re-opens and re-reads the
 *  source file header (audit A2). */
const HEADER_SNIFF_MAX = 500;
const headerSniffCache = new Map<
  string,
  { isAnimatedGif: boolean; isHeic: boolean }
>();

async function sniffHeader(
  requested: string,
): Promise<{ isAnimatedGif: boolean; isHeic: boolean } | null> {
  try {
    const stat = await fs.promises.stat(requested);
    const key = `${requested}:${stat.size}:${stat.mtimeMs}`;
    const hit = headerSniffCache.get(key);
    if (hit) {
      headerSniffCache.delete(key);
      headerSniffCache.set(key, hit); // LRU bump.
      return hit;
    }
    const fh = await fs.promises.open(requested, "r");
    let result: { isAnimatedGif: boolean; isHeic: boolean };
    try {
      const buf = Buffer.alloc(1024);
      const { bytesRead } = await fh.read(buf, 0, 1024, 0);
      const header = new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      result = {
        isAnimatedGif: isAnimatedGif(header),
        isHeic: isHeicContent(header),
      };
    } finally {
      await fh.close().catch(() => {});
    }
    headerSniffCache.set(key, result);
    if (headerSniffCache.size > HEADER_SNIFF_MAX) {
      const oldest = headerSniffCache.keys().next().value;
      if (oldest !== undefined) headerSniffCache.delete(oldest);
    }
    return result;
  } catch {
    return null;
  }
}

/** Extract a single frame from a video at ~1s and resize it. Cached in
 *  the two-tier thumbnail cache (RAM LRU + disk). Returns a JPEG Response
 *  or null if ffmpeg fails. */
async function serveVideoThumb(
  requested: string,
  w: number,
): Promise<Response | null> {
  const cacheKey = `${requested}?w=${w}&vid=1`;
  const cached = await lookupThumb(cacheKey);
  if (cached) {
    return thumbResponse(cached, sniffThumbType(cached));
  }
  const buf = await extractFrameWithFfmpeg(requested, w);
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  storeThumb(cacheKey, bytes);
  return thumbResponse(bytes, "image/jpeg");
}


/** Downscale `requested` to width `w` and return a Response, or null to
 *  signal the caller to fall back to the raw stream. Images with an alpha
 *  channel (transparent PNG/GIF/WebP) are output as PNG to preserve
 *  transparency; everything else becomes JPEG (smaller, faster). Results
 *  are cached in the two-tier thumbnail cache (RAM LRU + disk). Replaced
 *  the old nativeImage path (sync, full-res bitmap decode on the main
 *  thread → froze the UI on large images). */
async function serveResized(
  requested: string,
  w: number,
): Promise<Response | null> {
  // Memoized header sniff drives the animated-GIF decision and the
  // HEIC-inside-catch fallback without re-opening the source file on
  // every request (audit A2). Best-effort: on error we skip sniffing.
  const sniff = await sniffHeader(requested);
  const isAnimGif = sniff?.isAnimatedGif ?? false;

  // Animated GIFs: serve a resized animated GIF (sharp with `animated`)
  // so grid tiles animate too, not just the fullscreen viewer. They use
  // their own cache key and MUST NOT consult the plain `?w=` tier first —
  // that tier can hold a stale static first-frame (written before animated
  // thumbs existed, or by the static fallback below) which would otherwise
  // shadow the animated version forever. If the animated render fails,
  // fall through to the static first-frame path.
  if (isAnimGif) {
    const animKey = `${requested}?w=${w}&gifanim=1`;
    const animCached = await lookupThumb(animKey);
    if (animCached) {
      return thumbResponse(animCached, "image/gif");
    }
    try {
      const bytes = await withSharpLimit(() =>
        sharp(requested, { animated: true, pages: -1 })
          .resize({ width: w, withoutEnlargement: true })
          .gif()
          .toBuffer(),
      );
      const out = new Uint8Array(bytes);
      storeThumb(animKey, out);
      return thumbResponse(out, "image/gif");
    } catch (e) {
      if (!app.isPackaged) console.debug("[media] animated gif resized failed:", e);
    }
  }

  const cacheKey = `${requested}?w=${w}`;
  const cached = await lookupThumb(cacheKey);
  if (cached) {
    return thumbResponse(cached, sniffThumbType(cached));
  }
  try {
    // Skip huge raws to bound memory/time — serve them as a stream.
    const stat = await fs.promises.stat(requested);
    if (stat.size > 64 * 1024 * 1024) return null;
    // sharp's streaming decoder never holds the full-res bitmap in JS
    // heap; libvips downsamples on the fly via a pixel pipe.
    // Probe alpha: transparent PNG/GIF/WebP must stay PNG (JPEG has no
    // alpha channel and would flatten transparency to black). Everything
    // else becomes JPEG (smaller, faster, mozbetter compression).
    const meta = await withSharpLimit(() => sharp(requested).metadata());
    const hasAlpha = meta.hasAlpha ?? false;
    const bytes = await withSharpLimit(() => {
      const pipe = sharp(requested, { sequentialRead: true })
        .rotate() // honor EXIF orientation
        .resize({ width: w, withoutEnlargement: true });
      return hasAlpha
        ? pipe.png({ quality: 80, compressionLevel: 6, palette: false }).toBuffer()
        : pipe.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    });
    const out = new Uint8Array(bytes);
    storeThumb(cacheKey, out);
    return thumbResponse(out, hasAlpha ? "image/png" : "image/jpeg");
  } catch (e) {
    // Unsupported format / corrupt file → fall back to raw stream.
    if (!app.isPackaged) console.debug("[media] resize failed:", e);
    // HEIC/HEIF content (by magic, not extension — a .jpg file can carry
    // HEIC bytes) may fail sharp/libheif; retry via ffmpeg frame extract.
    if (sniff?.isHeic) {
      // HEIC stills are tiled HEVC grids: ffmpeg rejects -ss/-vf scale,
      // so extract the full-res frame and downscale with sharp.
      const buf = await extractFrameWithFfmpeg(requested, w, { heic: true });
      if (buf) {
        const bytes = await withSharpLimit(() =>
          sharp(buf)
            .rotate()
            .resize({ width: w, withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer(),
        );
        const out = new Uint8Array(bytes);
        storeThumb(`${requested}?w=${w}&heic=1`, out);
        return thumbResponse(out, "image/jpeg");
      }
    }
    return null;
  }
}

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
    let rawPath: string;
    try {
      rawPath = decodeURIComponent(url.pathname);
    } catch {
      // Malformed percent-encoding — reject instead of throwing inside the
      // protocol handler.
      return new Response("Bad Request", { status: 400 });
    }
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
      if (Number.isFinite(w) && w > 0 && w <= 2560) {
        // Route videos to ffmpeg frame extraction, images to sharp resize.
        const ext = path.extname(requested).toLowerCase();
        const isVideo = FILE_TYPE_BY_EXT[ext] === "video";
        const resized = isVideo
          ? await serveVideoThumb(requested, w)
          : await serveResized(requested, w);
        if (resized) return resized;
      }
    }

    return net.fetch(pathToFileUrl(requested));
  });

  createWindow();
  // Size the decode semaphores from the persisted settings before the
  // first thumbnail request arrives (issues.md item 5).
  applyConcurrencySettings(settingsStore.getSettings());
  // Bring the disk tier back under budget at startup — the cheapest moment
  // to pay the walk cost, and it catches whatever grew since last launch.
  void pruneThumbCache();
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
  settingsStore.flush();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  mediaCache.flush();
  settingsStore.flush();
});

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
    // libuv's default threadpool is 4 threads; our Phase 2 async pool
    // dispatches 16 concurrent fs ops, but without a larger threadpool
    // the OS only services 4 at a time — bottlenecking disk I/O for
    // large libraries (30k+ files). 16 threads matches the scanner's
    // concurrency, so stat+probe actually parallelizes.
    env: { ...process.env, UV_THREADPOOL_SIZE: "16" },
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
              // Persist measured dimensions so the next startup restores
              // correct masonry aspect ratios without re-probing.
              width: patch.width ?? collected[idx].width,
              height: patch.height ?? collected[idx].height,
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
 *
 * Files removed outside the app (via Explorer, `del`, etc.) would leave
 * stale entries whose thumbnails 404 → "UNREADABLE". We stat each cached
 * path and prune the missing ones from both the returned list and the
 * on-disk cache so the gallery never shows dead entries from a prior
 * session.
 */
ipcMain.handle("scan:loadCached", async (_e, folderPath: string) => {
  if (typeof folderPath !== "string" || folderPath.length === 0) return [];
  // Whitelist the root so cached thumbnails can load via media://.
  allowedRoots.clear();
  allowedRoots.add(normalizeRoot(folderPath));
  const cached = mediaCache.loadCachedFiles(folderPath);
  if (cached.length === 0) return cached;
  // Batch-check existence. fs.promises.access is cheap per call; for a
  // 50k-entry library this is ~50k stats, but they run concurrently and
  // each is sub-millisecond on a local SSD. The alternative — serving a
  // 404 and letting the tile error out — is strictly worse UX.
  const checks = await Promise.all(
    cached.map(async (f) => {
      try {
        await fs.promises.access(f.filePath, fs.constants.R_OK);
        return null;
      } catch {
        return f.filePath;
      }
    }),
  );
  const missing = checks.filter((p): p is string => p !== null);
  if (missing.length > 0) {
    mediaCache.removeFiles(missing);
    return cached.filter((f) => !missing.includes(f.filePath));
  }
  return cached;
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

/* ------------------------------------------------------------------ *
 *  Settings (performance knobs — issues.md item 6).
 *  `settings:get` returns the persisted settings plus whether the file
 *  existed (first launch), so the renderer can adopt the OS-level
 *  prefers-reduced-motion default. `settings:set` persists a partial
 *  patch and re-sizes the decode semaphores live.
 * ------------------------------------------------------------------ */

ipcMain.handle("settings:get", () => settingsStore.loadSettings());

ipcMain.handle("settings:set", (_e, patch: unknown) => {
  if (!patch || typeof patch !== "object") return settingsStore.getSettings();
  const p = patch as Partial<settingsStore.AppSettings>;
  const updated = settingsStore.updateSettings({
    reduceMotion: p.reduceMotion,
    dialogBlur: p.dialogBlur,
    decodeConcurrency: p.decodeConcurrency,
    overscan: p.overscan,
  });
  applyConcurrencySettings(updated);
  return updated;
});

/** Inspector insights: content hash, dominant colors, and EXIF camera info. */
interface FileInsights {
  hash: string;
  colors: Array<{ r: number; g: number; b: number; hex: string }>;
  camera: { make?: string; model?: string; lens?: string; fNumber?: number; iso?: number; exposure?: string };
}

/** Parse a raw EXIF Buffer (from sharp metadata) into camera fields. */
function parseExif(buf: Buffer | undefined): FileInsights["camera"] {
  const cam: FileInsights["camera"] = {};
  if (!buf || buf.length < 14) return cam;
  // EXIF text tags are ASCII-null-terminated; extract by tag marker scan.
  const ascii = (start: number, len: number): string =>
    buf.toString("latin1", start, start + len).replace(/\0.*$/, "").trim();
  // Scan for known tag labels in the TIFF/EXIF ASCII entries.
  const find = (label: string): string | undefined => {
    const idx = buf.indexOf(label, 12, "latin1");
    if (idx === -1) return undefined;
    // The ASCII value follows the 12-byte IFD entry (tag 2 bytes + type 2 + count 4 + value/offset 4).
    // For long ASCII values the last 4 bytes are an offset; for short ones inline. Scan forward for printable text.
    for (let p = idx + label.length; p < Math.min(idx + 256, buf.length - 4); p++) {
      if (buf[p] >= 0x20 && buf[p] < 0x7f) return ascii(p, 64);
    }
    return undefined;
  };
  cam.make = find("Make");
  cam.model = find("Model");
  cam.lens = find("LensModel") ?? find("Lens");
  // Numeric tags: search for the rational values is complex; do best-effort regex on latin1 dump.
  const dump = buf.toString("latin1");
  const grabNum = (re: RegExp): number | undefined => {
    const m = dump.match(re);
    return m ? Number(m[1]) : undefined;
  };
  cam.fNumber = grabNum(/FNumber[^\d]{0,8}(\d+(?:\.\d+)?)/);
  cam.iso = grabNum(/ISO[^\d]{0,8}(\d{2,6})/);
  const expMatch = dump.match(/ExposureTime[^\d]{0,8}(\d+)\/(\d+)/);
  cam.exposure = expMatch ? `${expMatch[1]}/${expMatch[2]}` : undefined;
  return cam;
}

/** Read (or build) a decodeable image buffer for color/EXIF analysis.
 *  Images: the raw file. Videos: a single ffmpeg-extracted frame.
 *  Returns null when no decoder is available. */
async function decodeBufferForInsights(
  filePath: string,
): Promise<{ buf: Buffer; meta: Metadata } | null> {
  const isVideo = /\.(mp4|mov|avi|mkv|webm|m4v|wmv|flv|mpg|mpeg|3gp)$/i.test(filePath);
  if (!isVideo) {
    try {
      // Async read — never block the event loop on a multi-GB original.
      const buf = await fs.promises.readFile(filePath);
      // Downscale before computing stats: the 4 sharp .stats() calls in the
      // insights handler each decode the full-res buffer, pegging CPU and
      // ballooning RAM on multi-MP originals. A 320px JPEG carries the same
      // perceptual palette for dominant/quadrant swatches.
      const preview = await withSharpLimit(() =>
        sharp(buf).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
      );
      // Metadata must describe the preview, not the original — quadrant
      // extraction below is done against the preview buffer.
      const meta = await sharp(preview).metadata();
      return { buf: preview, meta };
    } catch {
      // HEIC/HEIF may fail sharp/libheif — retry via ffmpeg frame extract.
      const fh = await fs.promises.open(filePath, "r");
      try {
        const header = Buffer.alloc(1024);
        const { bytesRead } = await fh.read(header, 0, 1024, 0);
        if (isHeicContent(new Uint8Array(header.buffer, header.byteOffset, bytesRead))) {
          const buf = await extractFrameWithFfmpeg(filePath, 320, { heic: true });
          if (buf) {
            const preview = await withSharpLimit(() =>
              sharp(buf)
                .resize({ width: 320, withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer(),
            );
            const meta = await sharp(preview).metadata();
            return { buf: preview, meta };
          }
        }
      } catch {
        // fall through
      } finally {
        await fh.close().catch(() => {});
      }
      return null;
    }
  }
  // Video: extract one frame at ~1s into a JPEG buffer.
  const buf = await extractFrameWithFfmpeg(filePath, 320);
  if (!buf) return null;
  try {
    const meta = await sharp(buf).metadata();
    return { buf, meta };
  } catch {
    return null;
  }
}

/** Median-cut quantization: repeatedly split the largest-range bucket until `target`
 *  buckets remain; each bucket's mean becomes a palette color. Buckets are returned
 *  sorted by population (most prominent first). */
function medianCutPalette(
  pixels: Uint8Array,
  count: number,
  target: number,
): Array<{ r: number; g: number; b: number }> {
  const buckets: number[][] = [Array.from({ length: count }, (_, i) => i)];
  while (buckets.length < target) {
    let bestB = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let b = 0; b < buckets.length; b++) {
      const arr = buckets[b];
      if (arr.length < 2) continue;
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (const i of arr) {
        const r = pixels[i * 3], g = pixels[i * 3 + 1], bl = pixels[i * 3 + 2];
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (g < minG) minG = g; if (g > maxG) maxG = g;
        if (bl < minB) minB = bl; if (bl > maxB) maxB = bl;
      }
      const rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
      let range = rangeR, channel = 0;
      if (rangeG > range) { range = rangeG; channel = 1; }
      if (rangeB > range) { range = rangeB; channel = 2; }
      if (range > bestRange) { bestRange = range; bestB = b; bestChannel = channel; }
    }
    if (bestB === -1) break;
    const arr = buckets[bestB];
    arr.sort((a, b2) => pixels[a * 3 + bestChannel] - pixels[b2 * 3 + bestChannel]);
    const mid = arr.length >> 1;
    buckets.splice(bestB, 1, arr.slice(0, mid), arr.slice(mid));
  }
  return buckets
    .sort((a, b2) => b2.length - a.length)
    .map((arr) => {
      let r = 0, g = 0, b = 0;
      for (const i of arr) { r += pixels[i * 3]; g += pixels[i * 3 + 1]; b += pixels[i * 3 + 2]; }
      const n = arr.length || 1;
      return { r: r / n, g: g / n, b: b / n };
    });
}

ipcMain.handle("file:insights", async (_e, filePath: string): Promise<FileInsights | null> => {
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  if (!isUnderAllowedRoot(path.resolve(filePath))) return null;
  try {
    // Partial hash: first 64KB + last 64KB + size. Full-file read of a 2GB
    // video blocks the event loop and spikes RAM for no perceptual gain.
    const stat = fs.statSync(filePath);
    const CHUNK = 64 * 1024;
    const hasher = createHash("sha1");
    const fd = fs.openSync(filePath, "r");
    try {
      if (stat.size <= CHUNK * 2) {
        hasher.update(fs.readFileSync(filePath));
      } else {
        const head = Buffer.alloc(CHUNK);
        const tail = Buffer.alloc(CHUNK);
        fs.readSync(fd, head, 0, CHUNK, 0);
        fs.readSync(fd, tail, 0, CHUNK, stat.size - CHUNK);
        hasher.update(head);
        hasher.update(tail);
        hasher.update(Buffer.from(`@${stat.size}`));
      }
    } finally {
      fs.closeSync(fd);
    }
    const hash = hasher.digest("hex").slice(0, 16);

    const colors: FileInsights["colors"] = [];
    const cam: FileInsights["camera"] = {};
    const decoded = await decodeBufferForInsights(filePath);
    if (decoded) {
      const { buf, meta } = decoded;
      const toHex = (r: number, g: number, b: number) =>
        `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
      // Median-cut palette over a tiny preview. sharp's stats().dominant is a
      // histogram-weighted mean — on a light photo every region averages out to
      // the same pale cream, so a real spectrum needs quantization. 48x48 raw
      // pixels (from the 320px preview buffer) carry plenty of hue detail.
      try {
        const raw = await withSharpLimit(() =>
          sharp(buf)
            .resize({ width: 48, height: 48, fit: "inside" })
            .removeAlpha()
            .flatten({ background: "#000000" })
            .raw()
            .toBuffer({ resolveWithObject: true }),
        );
        const pal = medianCutPalette(raw.data, raw.info.width * raw.info.height, 6);
        for (const c of pal) {
          const rr = Math.round(c.r), gg = Math.round(c.g), bb = Math.round(c.b);
          colors.push({ r: rr, g: gg, b: bb, hex: toHex(rr, gg, bb) });
        }
      } catch {
        // Fallback: whole-image dominant swatch.
        try {
          const d = (await sharp(buf).stats()).dominant;
          colors.push({ r: d.r, g: d.g, b: d.b, hex: toHex(d.r, d.g, d.b) });
        } catch { /* best-effort */ }
      }
      Object.assign(cam, parseExif(meta.exif));
    }
    return { hash, colors, camera: cam };
  } catch {
    return null;
  }
});

/* ------------------------------------------------------------------ *
 *  File operations (organize & move) — the core purpose.
 *  Every path is gated through isUnderAllowedRoot so the renderer can
 *  never touch files outside the scanned folder.
 * ------------------------------------------------------------------ */

/** Result of a single file move/rename. */
interface FileOpResult {
  filePath: string;
  ok: boolean;
  newPath?: string;
  error?: string;
}

/**
 * Move one file to a destination directory. The destination must be
 * under the allowed root. If a file with the same name exists, a numeric
 * suffix ` (1)`, ` (2)`, … is appended before the extension.
 */
ipcMain.handle(
  "file:move",
  async (_e, filePath: string, destDir: string): Promise<FileOpResult> => {
    const src = path.resolve(filePath);
    const dest = path.resolve(destDir);
    if (!isUnderAllowedRoot(src) || !isUnderAllowedRoot(dest)) {
      return { filePath, ok: false, error: "forbidden" };
    }
    try {
      await fs.promises.mkdir(dest, { recursive: true });
      const name = path.basename(src);
      const newPath = await uniquePath(dest, name);
      await fs.promises.rename(src, newPath);
      return { filePath, ok: true, newPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { filePath, ok: false, error: msg };
    }
  },
);

/**
 * Move many files to the same destination directory. Returns per-file
 * results so the renderer can patch its local state incrementally.
 */
ipcMain.handle(
  "file:moveBatch",
  async (_e, filePaths: string[], destDir: string): Promise<FileOpResult[]> => {
    const dest = path.resolve(destDir);
    if (!isUnderAllowedRoot(dest)) {
      return filePaths.map((filePath) => ({ filePath, ok: false, error: "forbidden" }));
    }
    try {
      await fs.promises.mkdir(dest, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return filePaths.map((filePath) => ({ filePath, ok: false, error: msg }));
    }
    const results: FileOpResult[] = [];
    for (const fp of filePaths) {
      const src = path.resolve(fp);
      if (!isUnderAllowedRoot(src)) {
        results.push({ filePath: fp, ok: false, error: "forbidden" });
        continue;
      }
      try {
        const name = path.basename(src);
        const newPath = await uniquePath(dest, name);
        await fs.promises.rename(src, newPath);
        results.push({ filePath: fp, ok: true, newPath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ filePath: fp, ok: false, error: msg });
      }
    }
    return results;
  },
);

/**
 * Send a file to the OS trash (safe, reversible). Falls back to
 * `fs.unlink` only if `shell.trashItem` is unavailable.
 */
ipcMain.handle(
  "file:trash",
  async (_e, filePath: string): Promise<FileOpResult> => {
    const src = path.resolve(filePath);
    if (!isUnderAllowedRoot(src)) {
      return { filePath, ok: false, error: "forbidden" };
    }
    try {
      await shell.trashItem(src);
      return { filePath, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { filePath, ok: false, error: msg };
    }
  },
);

/** Trash many files at once. */
ipcMain.handle(
  "file:trashBatch",
  async (_e, filePaths: string[]): Promise<FileOpResult[]> => {
    const results: FileOpResult[] = [];
    for (const fp of filePaths) {
      const src = path.resolve(fp);
      if (!isUnderAllowedRoot(src)) {
        results.push({ filePath: fp, ok: false, error: "forbidden" });
        continue;
      }
      try {
        await shell.trashItem(src);
        results.push({ filePath: fp, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ filePath: fp, ok: false, error: msg });
      }
    }
    return results;
  },
);

/**
 * Rename a file in place (same directory, new name).
 */
ipcMain.handle(
  "file:rename",
  async (_e, filePath: string, newName: string): Promise<FileOpResult> => {
    const src = path.resolve(filePath);
    if (!isUnderAllowedRoot(src) || typeof newName !== "string" || newName.length === 0) {
      return { filePath, ok: false, error: "forbidden" };
    }
    // Reject path separators in the new name — it must be a bare filename.
    if (/[\\/]/.test(newName)) {
      return { filePath, ok: false, error: "name must not contain path separators" };
    }
    try {
      const dir = path.dirname(src);
      const newPath = await uniquePath(dir, newName);
      await fs.promises.rename(src, newPath);
      return { filePath, ok: true, newPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { filePath, ok: false, error: msg };
    }
  },
);

/**
 * Create a new folder (intermediates as needed) under the allowed root.
 */
ipcMain.handle(
  "folder:create",
 async (_e, dirPath: string): Promise<{ ok: boolean; error?: string }> => {
    const dir = path.resolve(dirPath);
    if (!isUnderAllowedRoot(dir)) return { ok: false, error: "forbidden" };
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  },
);

/**
 * Open a native folder picker scoped to the allowed root so the user
 * can choose a move destination. Returns the chosen path or null.
 */
ipcMain.handle(
  "dialog:pickMoveTarget",
  async (_e, defaultPath?: string): Promise<string | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: defaultPath && isUnderAllowedRoot(path.resolve(defaultPath))
        ? defaultPath
        : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];
    // Allow picking inside or creating under the root, but warn if outside.
    return picked;
  },
);

/**
 * Resolve a non-colliding path in `dir` for the given `name`. If
 * `name.ext` exists, tries `name (1).ext`, `name (2).ext`, etc.
 */
async function uniquePath(dir: string, name: string): Promise<string> {
  const candidate = path.join(dir, name);
  try {
    await fs.promises.access(candidate);
    // Exists — find a suffix.
  } catch {
    return candidate; // Doesn't exist — use as-is.
  }
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 1; i < 10000; i++) {
    const suffixed = path.join(dir, `${base} (${i})${ext}`);
    try {
      await fs.promises.access(suffixed);
    } catch {
      return suffixed;
    }
  }
  // Fallback — append a timestamp.
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}
