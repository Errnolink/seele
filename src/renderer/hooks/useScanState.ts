import { useCallback, useMemo, useReducer, useRef } from "react";
import type { MediaFile, MetaPatch, ScanProgress } from "../../scanner/types";

/**
 * Scan lifecycle owned by a reducer so file accumulation, status, error,
 * and cancellation all transition atomically (review issue #1 — mutating
 * a ref + bumping a version counter was fragile and could leave stale
 * data in components that didn't subscribe to the version).
 *
 * Batches are accumulated as a list-of-lists (`MediaFile[][]`) and the
 * flat view is memoized in the hook. Appending a batch is O(batch size)
 * rather than O(running total) — the previous `state.files.concat(batch)`
 * rebuilt the whole array every batch, i.e. O(n²) over a scan (v3 #1).
 */

export type ScanStatus = "idle" | "scanning" | "done" | "error" | "cancelled";

export interface ScanState {
  /** Append-only accumulated batches. Appending is O(batch), not O(total). */
  batches: MediaFile[][];
  /** Running total across all batches — cheap, avoids flattening for `.length`. */
  count: number;
  status: ScanStatus;
  /** Last reported progress snapshot, or null before/done. */
  progress: ScanProgress | null;
  /** Human-readable error message when `status === "error"`. */
  error: string | null;
}

type ScanAction =
  | { type: "reset"; folder: string | null }
  | { type: "start" }
  | { type: "batch"; files: MediaFile[] }
  | { type: "progress"; progress: ScanProgress }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "restore"; files: MediaFile[] }
  | { type: "metaBatch"; patches: MetaPatch[] }
  | { type: "removeFiles"; filePaths: Set<string> }
  | { type: "addFiles"; files: MediaFile[] };

const initialState: ScanState = {
  batches: [],
  count: 0,
  status: "idle",
  progress: null,
  error: null,
};

function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "reset":
      return { ...initialState };
    case "start":
      return { ...initialState, status: "scanning" };
    case "restore": {
      // Instant restore from on-disk cache (v4 rework). Files appear at
      // once without a filesystem walk; status is "done" so the grid
      // renders immediately. A real rescan refreshes them.
      const restored = action.files;
      return {
        ...initialState,
        batches: restored.length > 0 ? [restored] : [],
        count: restored.length,
        status: "done",
      };
    }
    case "batch": {
      if (state.status !== "scanning") return state;
      // O(batch) append — no cumulative copy of all prior files. The flat
      // view is rebuilt lazily (and memoized) in the hook (v3 review #1).
      return {
        ...state,
        batches: [...state.batches, action.files],
        count: state.count + action.files.length,
      };
    }
    case "metaBatch": {
      if (state.status !== "scanning") return state;
      // Phase-2 metadata patches arrive mid-scan and patch existing
      // placeholder files in place. O(patches + batches) — build a
      // lookup Map, then for each batch rewrite it only if any file in
      // it matches, else reuse the same array reference (no copy).
      const byPath = new Map<string, MetaPatch>();
      for (const patch of action.patches) byPath.set(patch.filePath, patch);
      if (byPath.size === 0) return state;
      let changed = false;
      const nextBatches = state.batches.map((batch) => {
        let rewrote = false;
        const patched = batch.map((file) => {
          const patch = byPath.get(file.filePath);
          if (!patch) return file;
          rewrote = true;
          return {
            ...file,
            sizeBytes: patch.sizeBytes,
            birthtimeMs: patch.birthtimeMs,
            birthtime: patch.birthtime,
            dateKey: patch.dateKey,
            // Dimensions may be absent (video or unreadable header); only
            // overwrite when the probe produced a real value.
            width: patch.width ?? file.width,
            height: patch.height ?? file.height,
          };
        });
        if (!rewrote) return batch;
        changed = true;
        return patched;
      });
      if (!changed) return state;
      return {
        ...state,
        batches: nextBatches,
      };
    }
    case "progress":
      return state.status === "scanning"
        ? { ...state, progress: action.progress }
        : state;
    case "done":
      return { ...state, status: "done", progress: null };
    case "error":
      return { ...state, status: "error", error: action.message, progress: null };
    case "removeFiles": {
      // After a move/trash, purge the affected files from every batch.
      // Each batch array is filtered in place; empty batches are dropped.
      const remove = action.filePaths;
      let changed = false;
      const nextBatches: MediaFile[][] = [];
      let actualRemoved = 0;
      for (const batch of state.batches) {
        const filtered = batch.filter((f) => {
          if (remove.has(f.filePath)) {
            actualRemoved++;
            return false;
          }
          return true;
        });
        if (filtered.length !== batch.length) {
          changed = true;
          if (filtered.length > 0) nextBatches.push(filtered);
        } else {
          nextBatches.push(batch);
        }
      }
      if (!changed) return state;
      return {
        ...state,
        batches: nextBatches,
        count: Math.max(0, state.count - actualRemoved),
      };
    }
    case "cancelled":
      return { ...state, status: "cancelled", progress: null };
    case "addFiles": {
      // Re-add files after a trash-queue restore or rename (no rescan —
      // the file was never removed from disk, only from local state).
      if (action.files.length === 0) return state;
      return {
        ...state,
        batches: [...state.batches, action.files],
        count: state.count + action.files.length,
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export interface UseScanStateReturn {
  state: ScanState;
  /**
   * Lazily-flattened, memoized view of all accumulated files. Recomputes
   * only when `filesVersion` changes; referentially stable between
   * renders that don't touch the batches (v3 review #1).
   */
  files: MediaFile[];
  /** Mark a fresh scan start: clears files, sets status to scanning. */
  onStart: () => void;
  /** Reset everything to idle (e.g. when picking a new folder). */
  onReset: () => void;
  /** Accumulate one streamed batch of files. */
  onBatch: (files: MediaFile[]) => void;
  /** Update the live progress snapshot. */
  onProgress: (progress: ScanProgress) => void;
  /** Mark the scan complete. */
  onDone: () => void;
  /** Record a fatal scan error. */
  onError: (message: string) => void;
  /** Mark the scan cancelled (partial files retained). */
  onCancelled: () => void;
  /** Instantly restore files from the on-disk cache (v4 rework). */
  onRestore: (files: MediaFile[]) => void;
  /** Apply phase-2 metadata patches to placeholder files in place. */
  onMetaBatch: (patches: MetaPatch[]) => void;
  /** Remove files from local state after move/trash operations. */
  onRemoveFiles: (filePaths: Set<string>) => void;
  /** Re-add files to local state (trash-queue restore / rename). */
  onAddFiles: (files: MediaFile[]) => void;
}

/**
 * Reducer-backed scan state. Replaces the `filesRef` + `filesVersion`
 * counter pair (review issue #1) and adds error/cancel states (#16, #3).
 */
export function useScanState(): UseScanStateReturn {
  const [state, dispatch] = useReducer(scanReducer, initialState);

  // Flatten once per batch mutation. The reducer always returns a fresh
  // `batches` array reference whenever the accumulated data changes, so
  // the memo recomputes exactly when files are added/removed — no need to
  // also key on the `filesVersion` counter.
  const files = useMemo(
    () => state.batches.flat(),
    [state.batches],
  );

  const onStart = useCallback(() => dispatch({ type: "start" }), []);
  const onReset = useCallback(() => dispatch({ type: "reset", folder: null }), []);

  // Buffer incoming batches and flush as a single combined batch every
  // ~150ms. During a fast scan the worker sends 100+ batches in seconds;
  // dispatching each one immediately triggers 100+ React re-renders, each
  // recomputing the masonry layout over a progressively larger array —
  // freezing the UI on large libraries (v5 rework).
  const batchBufferRef = useRef<MediaFile[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PERF-3: Buffer and throttle metaBatch patches (same 150ms coalescing).
  const metaBufferRef = useRef<MetaPatch[]>([]);
  const metaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushBatches = useCallback(() => {
    flushTimerRef.current = null;
    const buffered = batchBufferRef.current;
    if (buffered.length === 0) return;
    batchBufferRef.current = [];
    dispatch({ type: "batch", files: buffered });
  }, []);
  const onBatch = useCallback(
    (files: MediaFile[]) => {
      batchBufferRef.current.push(...files);
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flushBatches, 150);
    },
    [flushBatches],
  );
  // Flush any pending batches when scan completes so the final state
  // is immediately consistent.
  const onDone = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const buffered = batchBufferRef.current;
    batchBufferRef.current = [];
    if (buffered.length > 0) dispatch({ type: "batch", files: buffered });
    // PERF-3: flush any pending meta patches before marking done.
    if (metaFlushTimerRef.current) {
      clearTimeout(metaFlushTimerRef.current);
      metaFlushTimerRef.current = null;
    }
    const metaBuffered = metaBufferRef.current;
    metaBufferRef.current = [];
    if (metaBuffered.length > 0) dispatch({ type: "metaBatch", patches: metaBuffered });
    dispatch({ type: "done" });
  }, []);

  const onProgress = useCallback((progress: ScanProgress) => {
    // Progress messages arrive faster than the UI can paint. Coalesce
    // last-write-wins on the same 150ms cadence as batches — intermediate
    // snapshots are dropped instead of forcing a reducer pass + re-render
    // for every message (a fast scan emits dozens per second).
    progressRef.current = progress;
    if (progressTimerRef.current) return;
    progressTimerRef.current = setTimeout(() => {
      progressTimerRef.current = null;
      const latest = progressRef.current;
      progressRef.current = null;
      if (latest) dispatch({ type: "progress", progress: latest });
    }, 150);
  }, []);
  const progressRef = useRef<ScanProgress | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onError = useCallback(
    (message: string) => dispatch({ type: "error", message }),
    [],
  );
  const onCancelled = useCallback(() => dispatch({ type: "cancelled" }), []);
  const onRestore = useCallback(
    (files: MediaFile[]) => dispatch({ type: "restore", files }),
    [],
  );
  const flushMeta = useCallback(() => {
    metaFlushTimerRef.current = null;
    const buffered = metaBufferRef.current;
    if (buffered.length === 0) return;
    metaBufferRef.current = [];
    dispatch({ type: "metaBatch", patches: buffered });
  }, []);
  const onMetaBatch = useCallback(
    (patches: MetaPatch[]) => {
      metaBufferRef.current.push(...patches);
      if (metaFlushTimerRef.current) return;
      metaFlushTimerRef.current = setTimeout(flushMeta, 150);
    },
    [flushMeta],
  );
  const onRemoveFiles = useCallback(
    (filePaths: Set<string>) => dispatch({ type: "removeFiles", filePaths }),
    [],
  );
  const onAddFiles = useCallback(
    (files: MediaFile[]) => dispatch({ type: "addFiles", files }),
    [],
  );

  return { state, files, onStart, onReset, onBatch, onProgress, onDone, onError, onCancelled, onRestore, onMetaBatch, onRemoveFiles, onAddFiles };
}
