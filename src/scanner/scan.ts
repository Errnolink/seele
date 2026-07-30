import { readdirSync, statSync, type Dirent } from "node:fs";
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
  } catch {
    return { files, subDirs };
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      subDirs.push(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;

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
    } catch {
      // unreadable → leave defaults
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
 * The phases are interleaved per-directory: enumerate → flush → stat →
 * patch → recurse. This gives the best perceived performance — the first
 * directory's thumbnails appear almost instantly, and metadata trails by
 * only the stat time of that one directory.
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
  // Runs after enumeration completes. Yields between batches so the
  // renderer can process metadata patches without blocking.
  if (onMetaBatch && !signal?.aborted && pendingStat.length > 0) {
    const STAT_CHUNK = 500;
    for (let i = 0; i < pendingStat.length; i += STAT_CHUNK) {
      if (signal?.aborted) break;
      const chunk = pendingStat.slice(i, i + STAT_CHUNK);
      const patches: MetaPatch[] = [];
      for (const f of chunk) {
        try {
          const st = statSync(f.filePath);
          patches.push({
            filePath: f.filePath,
            sizeBytes: st.size,
            birthtimeMs: st.birthtimeMs,
            birthtime: st.birthtime.toISOString(),
            dateKey: dateKeyFromMs(st.birthtimeMs),
          });
        } catch {
          // unreadable → skip
        }
      }
      if (patches.length > 0) onMetaBatch(patches);
      // Yield so IPC messages drain.
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return count;
}
