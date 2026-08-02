import { readdirSync, statSync, open as fsOpen, fstat, read, close, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import { FILE_TYPE_BY_EXT } from "./extensions";
import type { MediaFile, MetaPatch, ScanOptions, ScanProgress } from "./types";

/* ------------------------------------------------------------------ *
 *  Bounded concurrency — shared semaphore, NOT per-call pool.
 *  A per-call pool limits concurrency per directory, but recursion makes
 *  global concurrency explode to limit^depth (EMFILE on deep trees).
 *  The semaphore caps total in-flight directory reads across the entire
 *  walk (v4 review H-5).
 * ------------------------------------------------------------------ */

class Semaphore {
  private readonly queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/* ------------------------------------------------------------------ *
 *  Path / date precomputation helpers
 * ------------------------------------------------------------------ */

/** Lowercased, forward-slash normalized absolute path. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/** `YYYY-MM-DD` in UTC (matching birthtime's `.toISOString()`) or
 * `"unknown"` for an invalid/NaN epoch. Using UTC avoids a mismatch
 * where birthtime is UTC but dateKey was local (v4 review L-3). */
function dateKeyFromMs(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ *
 *  Phase 1: enumerate — readdirSync({withFileTypes}) only, zero stats
 *
 *  Walks the entire tree synchronously in milliseconds. Produces
 *  MediaFile placeholders with size/date metadata left as zero/unknown.
 *  The gallery renders instantly; Phase 2 patches real metadata in.
 * ------------------------------------------------------------------ */

/**
 * Discover all media files under `dir` without statting any of them.
 * Returns placeholders whose `sizeBytes`/`birthtimeMs`/`dateKey` are
 * defaults — the renderer shows them immediately while Phase 2 fills
 * in the real values.
 */
function enumerateDirectory(
  dir: string,
): { files: MediaFile[]; subDirs: string[] } {
  const files: MediaFile[] = [];
  const subDirs: string[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.debug("[scan] readdir failed:", dir, e);
    return { files, subDirs };
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      subDirs.push(path.join(dir, entry.name));
      continue;
    }
    // CORR-3: Symlinks return false for both isDirectory() and isFile()
    // on the Dirent. Stat the target to determine its real type.
    if (entry.isSymbolicLink()) {
      try {
        const stat = statSync(path.join(dir, entry.name));
        if (stat.isDirectory()) {
          subDirs.push(path.join(dir, entry.name));
          continue;
        }
        if (!stat.isFile()) continue;
      } catch (e) {
        // Broken symlink — skip.
        if (process.env.NODE_ENV !== "production") console.debug("[scan] stat failed:", e);
        continue;
      }
    } else if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const type = FILE_TYPE_BY_EXT[ext] ?? null;
    if (!type) continue;

    const fullPath = path.join(dir, entry.name);
    files.push({
      filePath: fullPath,
      fileName: entry.name,
      fileNameLower: entry.name.toLowerCase(),
      birthtime: "",
      fileType: type,
      sizeBytes: 0,
      width: 0,
      height: 0,
      normPath: normalizePath(fullPath),
      birthtimeMs: 0,
      dateKey: "unknown",
    });
  }

  return { files, subDirs };
}

/* ------------------------------------------------------------------ *
 *  Phase 2: stat — fill in size/date for files already discovered.
 *  Runs in the worker, blocks are fine. Called per-batch so the
 *  renderer gets metadata progressively, not all at the end.
 * ------------------------------------------------------------------ */

/** Stat a batch of placeholder files and patch real metadata in place. */
function statBatch(files: MediaFile[]): void {
  for (const f of files) {
    try {
      const stat = statSync(f.filePath);
      f.sizeBytes = stat.size;
      f.birthtimeMs = stat.birthtimeMs;
      f.birthtime = stat.birthtime.toISOString();
      f.dateKey = dateKeyFromMs(stat.birthtimeMs);
    } catch (e) {
      // unreadable → leave defaults
      if (process.env.NODE_ENV !== "production") console.debug("[scan] metadata failed:", f.filePath, e);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

const DEFAULT_CONCURRENCY = 16;

/**
 * Recursively scan `dirPath` and return a flat array of every image and
 * video file found. Two-phase: enumerates instantly, then stats inline.
 * For streaming with progressive UI, prefer {@link scanFolderStream}.
 */
export async function scanFolder(
  dirPath: string,
  options: ScanOptions = {},
): Promise<MediaFile[]> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const sem = new Semaphore(concurrency);
  const all: MediaFile[] = [];

  async function walk(dir: string): Promise<void> {
    await sem.acquire();
    let subDirs: string[] = [];
    try {
      if (options.signal?.aborted) return;
      const { files, subDirs: dirs } = enumerateDirectory(dir);
      subDirs = dirs;
      statBatch(files);
      for (const f of files) all.push(f);
    } finally {
      sem.release();
    }
    if (options.signal?.aborted) return;
    await Promise.all(subDirs.map(walk));
  }

  await walk(dirPath);
  return all;
}

/**
 * Streaming two-phase scan (v5 rework).
 *
 * **Phase 1** walks each directory with `readdirSync({withFileTypes})` —
 * zero `stat` calls, sub-millisecond per directory. Placeholder
 * `MediaFile`s (size 0, date "unknown") are flushed in batches
 * immediately so the gallery renders before any metadata I/O.
 *
 * **Phase 2** stats the same files synchronously right after and emits
 * `MetaPatch[]` via `onMetaBatch` so the renderer can fill in size/date
 * progressively without a second scan.
 *
 * The phases are sequential (CORR-5): Phase 1 fully enumerates the tree
 * and emits placeholders immediately, then Phase 2 stats every discovered
 * file and emits metadata patches. This gives the best perceived
 * performance — thumbnails appear almost instantly with correct aspect
 * ratios once measured, and metadata trails by only the stat time.
 *
 * @returns total number of media files found
 */
export async function scanFolderStream(
  dirPath: string,
  onBatch: (batch: MediaFile[]) => void,
  onProgress?: (progress: ScanProgress) => void,
  options: ScanOptions = {},
  onMetaBatch?: (patches: MetaPatch[]) => void,
): Promise<number> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const sem = new Semaphore(concurrency);
  const BATCH_SIZE = 250;
  const signal = options.signal;

  if (signal?.aborted) return 0;

  let count = 0;
  let buffer: MediaFile[] = [];
  let currentDir = dirPath;
  /** All enumerated files collected for Phase 2 statting. */
  const pendingStat: MediaFile[] = [];

  const flush = (): void => {
    if (buffer.length > 0) {
      onBatch(buffer);
      buffer = [];
    }
  };

  // ── Phase 1: walk the entire tree with readdirSync only ────────
  // Zero stat calls. The semaphore caps total in-flight directory reads
  // across the entire recursive walk, preventing EMFILE on deep trees
  // (v4 review H-5). The walk yields between directories so IPC
  // messages from flush() can drain to the renderer.
  async function enumerate(dir: string): Promise<void> {
    await sem.acquire();
    let subDirs: string[] = [];
    try {
      if (signal?.aborted) return;
      currentDir = dir;

      const result = enumerateDirectory(dir);
      subDirs = result.subDirs;
      for (const f of result.files) {
        buffer.push(f);
        pendingStat.push(f);
        count++;
        if (buffer.length >= BATCH_SIZE) {
          flush();
          onProgress?.({ count, currentDir });
        }
        if (signal?.aborted) return;
      }

      if (signal?.aborted) return;
      // Yield so buffered batches and IPC messages can drain before
      // descending deeper.
      flush();
      await new Promise<void>((r) => setImmediate(r));
    } finally {
      sem.release();
    }

    await Promise.all(subDirs.map(enumerate));
  }

  await enumerate(dirPath);
  flush();
  onProgress?.({ count, currentDir });

  // ── Phase 2: stat every file, emit patches in batches ──────────
  // Runs after enumeration completes. Uses a bounded async pool so that
  // stat + dimension-probe run concurrently instead of sequentially
  // (the old loop did 2 synchronous opens per image, one at a time — a
  // 60k-op serial chain on a 30k-image library). Each file now costs a
  // SINGLE open(): fstat + read-header + close happen on one fd, so disk
  // opens are halved and the pool keeps the OS disk cache warm.
  if (onMetaBatch && !signal?.aborted && pendingStat.length > 0) {
    const probe = options.probeDimensions;
    // Header read size — image-size needs at most ~64KB to identify any
    // format; smaller keeps the read cheap, larger avoids a rare second
    // read for exotic headers (TIFF, some RAW). 64KB covers everything.
    const HEADER_SIZE = 65536;
    const pool = new Semaphore(Math.max(4, concurrency));
    const FLUSH_SIZE = 250;
    const collected: MetaPatch[] = [];

    const flushCollected = (): void => {
      if (collected.length > 0) {
        onMetaBatch(collected.splice(0, collected.length));
      }
    };

    /** Stat + probe a single file with one fd, return its patch or null. */
    const statOne = async (f: MediaFile): Promise<MetaPatch | null> => {
      let fd: number | undefined;
      try {
        fd = await new Promise<number>((res, rej) =>
          fsOpen(f.filePath, "r", (e, fdesc) => (e ? rej(e) : res(fdesc))),
        );
        const st = await new Promise<Stats>((res, rej) =>
          fstat(fd!, (e, s) => (e ? rej(e) : res(s as unknown as Stats))),
        );
        const patch: MetaPatch = {
          filePath: f.filePath,
          sizeBytes: st.size,
          birthtimeMs: st.birthtimeMs,
          birthtime: new Date(st.birthtimeMs).toISOString(),
          dateKey: dateKeyFromMs(st.birthtimeMs),
        };
        // Probe dimensions from the same fd before closing it — one open,
        // not two.
        if (probe && f.fileType === "image") {
          const header = Buffer.allocUnsafe(Math.min(HEADER_SIZE, st.size || HEADER_SIZE));
          await new Promise<void>((res, rej) =>
            read(fd!, header, 0, header.length, 0, (e) => (e ? rej(e) : res())),
          );
          const dims = probe(header);
          if (dims && dims.width > 0 && dims.height > 0) {
            patch.width = dims.width;
            patch.height = dims.height;
          }
        }
        return patch;
      } catch {
        return null;
      } finally {
        if (fd !== undefined) {
          await new Promise<void>((res) => close(fd!, () => res()));
        }
      }
    };

    // Dispatch the whole list through the pool. Patches are pushed as they
    // resolve; flush every FLUSH_SIZE so the renderer gets metadata
    // progressively without waiting for all files to finish.
    const tasks = pendingStat.map(async (f) => {
      if (signal?.aborted) return;
      await pool.acquire();
      try {
        const patch = await statOne(f);
        if (patch) {
          collected.push(patch);
          if (collected.length >= FLUSH_SIZE) flushCollected();
        }
      } finally {
        pool.release();
      }
    });

    await Promise.all(tasks);
    flushCollected();
  }

  return count;
}
