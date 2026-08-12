import { useCallback, useMemo, useReducer } from "react";
import type { MediaFile, MetaPatch, ScanProgress } from "../../scanner/types";

/**
 * Scan lifecycle per library root, owned by a reducer so file
 * accumulation, status, error, and cancellation all transition
 * atomically (review issue #1 — mutating a ref + bumping a version
 * counter was fragile and could leave stale data in components that
 * didn't subscribe to the version).
 *
 * Each root accumulates batches as a list-of-lists (`MediaFile[][]`) and
 * the flat merged view is memoized in the hook. Appending a batch is
 * O(batch size) rather than O(running total) — the previous
 * `state.files.concat(batch)` rebuilt the whole array every batch, i.e.
 * O(n²) over a scan (v3 #1). Roots scan independently and concurrently;
 * the merged `files` list is the union across all roots.
 */

export type ScanStatus = "idle" | "scanning" | "done" | "error" | "cancelled";

export interface RootScanState {
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

export interface MultiScanState {
  /** Root path (as passed to the scanner) → its scan state. */
  roots: Record<string, RootScanState>;
}

type ScanAction =
  | { type: "reset"; root: string | null }
  | { type: "start"; root: string }
  | { type: "batch"; root: string; files: MediaFile[] }
  | { type: "progress"; root: string; progress: ScanProgress }
  | { type: "done"; root: string }
  | { type: "error"; root: string; message: string }
  | { type: "cancelled"; root: string }
  | { type: "restore"; root: string; files: MediaFile[] }
  | { type: "metaBatch"; root: string; patches: MetaPatch[] }
  | { type: "removeFiles"; filePaths: Set<string> }
  | { type: "addFiles"; root: string; files: MediaFile[] };

const emptyRoot: RootScanState = {
  batches: [],
  count: 0,
  status: "idle",
  progress: null,
  error: null,
};

function scanReducer(state: MultiScanState, action: ScanAction): MultiScanState {
  switch (action.type) {
    case "reset": {
      if (action.root === null) return { roots: {} };
      const next = { ...state.roots };
      delete next[action.root];
      return { roots: next };
    }
    case "start":
      return {
        roots: {
          ...state.roots,
          [action.root]: { ...emptyRoot, status: "scanning" },
        },
      };
    case "restore": {
      // Instant restore from on-disk cache (v4 rework). Files appear at
      // once without a filesystem walk; status is "done" so the grid
      // renders immediately. A real rescan refreshes them.
      const restored = action.files;
      return {
        roots: {
          ...state.roots,
          [action.root]: {
            batches: restored.length > 0 ? [restored] : [],
            count: restored.length,
            status: "done",
            progress: null,
            error: null,
          },
        },
      };
    }
    case "batch": {
      const cur = state.roots[action.root];
      if (!cur || cur.status !== "scanning") return state;
      // O(batch) append — no cumulative copy of all prior files. The flat
      // view is rebuilt lazily (and memoized) in the hook (v3 review #1).
      return {
        roots: {
          ...state.roots,
          [action.root]: {
            ...cur,
            batches: [...cur.batches, action.files],
            count: cur.count + action.files.length,
          },
        },
      };
    }
    case "metaBatch": {
      const cur = state.roots[action.root];
      if (!cur || cur.status !== "scanning") return state;
      // Phase-2 metadata patches arrive mid-scan and patch existing
      // placeholder files in place. O(patches + batches) — build a
      // lookup Map, then for each batch rewrite it only if any file in
      // it matches, else reuse the same array reference (no copy).
      const byPath = new Map<string, MetaPatch>();
      for (const patch of action.patches) byPath.set(patch.filePath, patch);
      if (byPath.size === 0) return state;
      let changed = false;
      const nextBatches = cur.batches.map((batch) => {
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
        roots: {
          ...state.roots,
          [action.root]: { ...cur, batches: nextBatches },
        },
      };
    }
    case "progress": {
      const cur = state.roots[action.root];
      return cur && cur.status === "scanning"
        ? {
            roots: {
              ...state.roots,
              [action.root]: { ...cur, progress: action.progress },
            },
          }
        : state;
    }
    case "done": {
      const cur = state.roots[action.root];
      if (!cur || cur.status !== "scanning") return state;
      return {
        roots: {
          ...state.roots,
          [action.root]: { ...cur, status: "done", progress: null },
        },
      };
    }
    case "error": {
      const cur = state.roots[action.root];
      if (!cur) return state;
      return {
        roots: {
          ...state.roots,
          [action.root]: {
            ...cur,
            status: "error",
            error: action.message,
            progress: null,
          },
        },
      };
    }
    case "cancelled": {
      const cur = state.roots[action.root];
      if (!cur) return state;
      return {
        roots: {
          ...state.roots,
          [action.root]: { ...cur, status: "cancelled", progress: null },
        },
      };
    }
    case "removeFiles": {
      // After a move/trash, purge the affected files from every root's
      // batches. Each batch array is filtered in place; empty batches
      // are dropped.
      const remove = action.filePaths;
      let changed = false;
      const nextRoots: Record<string, RootScanState> = {};
      for (const [root, cur] of Object.entries(state.roots)) {
        const nextBatches: MediaFile[][] = [];
        let rootRemoved = 0;
        for (const batch of cur.batches) {
          const filtered = batch.filter((f) => {
            if (remove.has(f.filePath)) {
              rootRemoved++;
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
        if (rootRemoved > 0) {
          nextRoots[root] = {
            ...cur,
            batches: nextBatches,
            count: Math.max(0, cur.count - rootRemoved),
          };
        } else {
          nextRoots[root] = cur;
        }
      }
      if (!changed) return state;
      return { roots: nextRoots };
    }
    case "addFiles": {
      // Re-add files after a trash-queue restore or rename (no rescan —
      // the file was never removed from disk, only from local state).
      if (action.files.length === 0) return state;
      const cur = state.roots[action.root] ?? emptyRoot;
      return {
        roots: {
          ...state.roots,
          [action.root]: {
            ...cur,
            batches: [...cur.batches, action.files],
            count: cur.count + action.files.length,
          },
        },
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export interface UseScanStateReturn {
  /** Per-root scan states, keyed by root path. */
  rootStates: Record<string, RootScanState>;
  /**
   * Lazily-flattened, memoized view of all files across every root.
   * Recomputes only when the underlying batches change; referentially
   * stable between renders that don't touch them (v3 review #1).
   */
  files: MediaFile[];
  /** Total file count across all roots. */
  totalCount: number;
  /** True while any root is scanning. */
  isScanning: boolean;
  /** Aggregate status: "scanning" if any root scans, else "error" if any
   *  root failed, else "done" if any root has data, else "idle". */
  status: ScanStatus;
  /** The first error message across roots, or null. */
  error: string | null;
  /** Progress of the first scanning root (for the status strip). */
  progress: ScanProgress | null;
  /** Mark a fresh scan start for one root: clears its files, sets scanning. */
  onStart: (root: string) => void;
  /** Reset one root (or all, when omitted) back to idle. */
  onReset: (root?: string) => void;
  /** Accumulate one streamed batch for a root. */
  onBatch: (root: string, files: MediaFile[]) => void;
  /** Update the live progress snapshot for a root. */
  onProgress: (root: string, progress: ScanProgress) => void;
  /** Mark a root's scan complete. */
  onDone: (root: string) => void;
  /** Record a fatal scan error for a root. */
  onError: (root: string, message: string) => void;
  /** Mark a root's scan cancelled (partial files retained). */
  onCancelled: (root: string) => void;
  /** Instantly restore a root from the on-disk cache (v4 rework). */
  onRestore: (root: string, files: MediaFile[]) => void;
  /** Apply phase-2 metadata patches for a root's placeholder files. */
  onMetaBatch: (root: string, patches: MetaPatch[]) => void;
  /** Remove files from local state after move/trash operations. */
  onRemoveFiles: (filePaths: Set<string>) => void;
  /** Re-add files to a root's local state (trash-queue restore / rename). */
  onAddFiles: (root: string, files: MediaFile[]) => void;
}

/**
 * Reducer-backed per-root scan state. Replaces the single `filesRef` +
 * `filesVersion` counter pair (review issue #1) and adds error/cancel
 * states (#16, #3) plus one scan state per library root.
 */
export function useScanState(): UseScanStateReturn {
  const [state, dispatch] = useReducer(scanReducer, { roots: {} });

  // Flatten once per batch mutation. The reducer always returns a fresh
  // `roots` object reference whenever any accumulated data changes, so
  // the memo recomputes exactly when files are added/removed.
  const files = useMemo(
    () =>
      Object.values(state.roots)
        .flatMap((r) => r.batches)
        .flat(),
    [state.roots],
  );

  const rootStates = state.roots;

  const totalCount = useMemo(
    () => Object.values(rootStates).reduce((n, r) => n + r.count, 0),
    [rootStates],
  );

  const isScanning = useMemo(
    () => Object.values(rootStates).some((r) => r.status === "scanning"),
    [rootStates],
  );

  const status: ScanStatus = useMemo(() => {
    const statuses = Object.values(rootStates).map((r) => r.status);
    if (statuses.some((s) => s === "scanning")) return "scanning";
    if (statuses.some((s) => s === "error")) return "error";
    if (statuses.some((s) => s === "done")) return "done";
    return "idle";
  }, [rootStates]);

  const error = useMemo(() => {
    for (const r of Object.values(rootStates)) {
      if (r.status === "error" && r.error) return r.error;
    }
    return null;
  }, [rootStates]);

  const progress = useMemo(() => {
    for (const r of Object.values(rootStates)) {
      if (r.status === "scanning" && r.progress) return r.progress;
    }
    return null;
  }, [rootStates]);

  const onStart = useCallback((root: string) => dispatch({ type: "start", root }), []);
  const onReset = useCallback((root?: string) => dispatch({ type: "reset", root: root ?? null }), []);
  const onBatch = useCallback(
    (root: string, files: MediaFile[]) => dispatch({ type: "batch", root, files }),
    [],
  );
  const onProgress = useCallback(
    (root: string, progress: ScanProgress) => dispatch({ type: "progress", root, progress }),
    [],
  );
  const onDone = useCallback((root: string) => dispatch({ type: "done", root }), []);
  const onError = useCallback(
    (root: string, message: string) => dispatch({ type: "error", root, message }),
    [],
  );
  const onCancelled = useCallback((root: string) => dispatch({ type: "cancelled", root }), []);
  const onRestore = useCallback(
    (root: string, files: MediaFile[]) => dispatch({ type: "restore", root, files }),
    [],
  );
  const onMetaBatch = useCallback(
    (root: string, patches: MetaPatch[]) => dispatch({ type: "metaBatch", root, patches }),
    [],
  );
  const onRemoveFiles = useCallback(
    (filePaths: Set<string>) => dispatch({ type: "removeFiles", filePaths }),
    [],
  );
  const onAddFiles = useCallback(
    (root: string, files: MediaFile[]) => dispatch({ type: "addFiles", root, files }),
    [],
  );

  return {
    rootStates,
    files,
    totalCount,
    isScanning,
    status,
    error,
    progress,
    onStart,
    onReset,
    onBatch,
    onProgress,
    onDone,
    onError,
    onCancelled,
    onRestore,
    onMetaBatch,
    onRemoveFiles,
    onAddFiles,
  };
}
