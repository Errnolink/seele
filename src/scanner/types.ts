/**
 * One discovered media file.
 *
 * `birthtime` is serialized to an ISO 8601 string so the value
 * survives the structured-clone IPC boundary into the renderer.
 *
 * `normPath`, `birthtimeMs`, and `dateKey` are precomputed during the
 * scan so the renderer's filter/group pipelines never re-parse the same
 * path or date on every keystroke or batch.
 */
export interface MediaFile {
  /** Absolute path on disk, e.g. `C:\Photos\IMG_0001.jpg`. */
  filePath: string;
  /** Bare file name including extension, e.g. `IMG_0001.jpg`. */
  fileName: string;
  /**
   * Lowercased `fileName`. Precomputed so the renderer's search filter
   * never allocates a fresh `toLowerCase()` string per file per query
   * (v3 review #2).
   */
  fileNameLower: string;
  /** ISO 8601 creation timestamp from `fs.stat().birthtime`. */
  birthtime: string;
  /** Coarse category derived from the file extension. */
  fileType: "image" | "video";
  /** File size in bytes from `fs.stat().size` (v3 review #9). */
  sizeBytes: number;
  /**
   * Natural pixel dimensions read from the file header (v4 rework).
   * `0` when unreadable/non-applicable (e.g. some videos). Powers the
   * staggered masonry grid so each tile keeps its real aspect ratio
   * instead of being cropped to a uniform square.
   */
  width: number;
  /** See {@link width}. */
  height: number;
  /**
   * Lowercased, forward-slash-normalized `filePath`. Precomputed once so
   * folder-prefix filtering and tree building don't re-normalize on every
   * render (review issues #11 and #4).
   */
  normPath: string;
  /**
   * `birthtime` as epoch milliseconds, or `NaN` if unknown. Precomputed
   * so date grouping never calls `new Date()` in the hot render path
   * (review issue #10).
   */
  birthtimeMs: number;
  /**
   * `YYYY-MM-DD` date key derived from `birthtime` (local time), or the
   * literal `"unknown"` when the date is invalid. Used as a stable group
   * key without per-render Date parsing.
   */
  dateKey: string;
}

/** Progress snapshot emitted by the streaming scanner. */
export interface ScanProgress {
  /** Files emitted so far, across all batches. */
  count: number;
  /** Current directory being walked. Useful for a live status line. */
  currentDir: string;
}

/**
 * Metadata update for a file already discovered by Phase 1 enumeration
 * (v5 rework). Phase 2 stats each file and emits patches so the renderer
 * can fill in size/date without a second filesystem walk.
 */
export interface MetaPatch {
  filePath: string;
  sizeBytes: number;
  birthtimeMs: number;
  birthtime: string;
  dateKey: string;
  /**
   * Natural pixel width, or `0` when not probed/unreadable. Picked up by
   * the renderer so masonry tiles adopt their real aspect ratio instead
   * of a uniform fallback (paired with {@link height}).
   */
  width?: number;
  /** See {@link width}. */
  height?: number;
}

/** Options accepted by {@link scanFolder} / {@link scanFolderStream}. */
export interface ScanOptions {
  /**
   * Concurrency limit for descending into subdirectories. Higher values
   * speed up wide trees but increase memory and fd pressure. Default 16.
   */
  concurrency?: number;
  /**
   * Optional abort signal. When already aborted the scan is a no-op;
   * when aborted mid-walk the remaining tree is skipped and the partial
   * result accumulated so far is flushed. Lets the UI cancel a runaway
   * scan over a huge directory (review issue #3).
   */
  signal?: AbortSignal;
  /**
   * Optional header-only dimension probe for image files. Receives a
   * pre-read header `Buffer` (the first bytes of the file) so the caller
   * can merge the stat + header-read into a single `open()` instead of
   * two sequential synchronous opens. The Electron worker passes a thin
   * wrapper around `imageSize(buffer)` so the masonry grid gets real
   * aspect ratios without the scanner depending on any native imaging
   * library. Returns `{width,height}` or `null` when the header can't be
   * parsed. Only invoked for images; videos are skipped.
   */
  probeDimensions?: (header: Buffer) => { width: number; height: number } | null;
}
