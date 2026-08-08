import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { MasonryGrid } from "./components/MasonryGrid";
import { FileUpload } from "./components/FileUpload";
import { FolderBrowser } from "./components/FolderBrowser";
import MediaViewer from "./components/MediaViewer";
import { ContextMenu } from "./components/ContextMenu";
import CommandPalette from "./components/CommandPalette";
import { KeyboardHelp } from "./components/KeyboardHelp";
import AnalyticsModal from "./components/AnalyticsModal";
import BootSequence from "./components/BootSequence";
import MoveDialog from "./components/MoveDialog";
import RenameDialog from "./components/RenameDialog";
import BatchTagDialog from "./components/BatchTagDialog";
import TitleBar from "./components/TitleBar";
import ActivityLog, { type ActivityEntry } from "./components/ActivityLog";
import SessionChangesModal from "./components/SessionChangesModal";
import TrashQueueModal from "./components/TrashQueueModal";
import SettingsModal from "./components/SettingsModal";
import { useToast } from "./components/useToast";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { AppSettings } from "../../electron/settings";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { formatBytes } from "./utils";
import { LARGE_FILE_BYTES } from "./types";
import { useScanState } from "./hooks/useScanState";
import { useTags } from "./hooks/useTags";
import type {
  FolderNode,
  GroupMode,
  MediaFile,
  MediaTypeFilter,
  ScanStats,
  SortDir,
  SortMode,
  ViewMode,
} from "./types";
import type { ScanProgress } from "../scanner/types";
import type { MediaId } from "./types";

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Build a nested folder tree from the flat file list (§10.1).
 * Each node carries a running file count and size sum. Uses the
 * scanner's precomputed `normPath` so we don't re-normalize on every
 * render.
 */
function buildFolderTree(
  files: MediaFile[],
  rootPath: string,
): FolderNode | null {
  if (files.length === 0) return null;
  const normRoot = rootPath.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  const root: FolderNode = {
    path: rootPath,
    name: rootPath.split(/[\\/]/).pop() || rootPath,
    count: 0,
    size: 0,
    children: [],
  };
  // Index children by their normalized path segment stack for dedup.
  const nodeByPath = new Map<string, FolderNode>();
  nodeByPath.set(normRoot, root);

  for (const f of files) {
    // Walk from root down to the file's folder.
    const rel = f.normPath.startsWith(normRoot + "/")
      ? f.normPath.slice(normRoot.length + 1)
      : f.normPath;
    const segs = rel.split("/").filter(Boolean);
    // Drop the file name itself — keep directory segments only.
    segs.pop();
    let cur = root;
    let acc = normRoot;
    for (const seg of segs) {
      acc += "/" + seg;
      let child = nodeByPath.get(acc);
      if (!child) {
        child = {
          path: acc,
          name: seg,
          count: 0,
          size: 0,
          children: [],
        };
        nodeByPath.set(acc, child);
        cur.children.push(child);
      }
      cur = child;
    }
    cur.count += 1;
    cur.size += f.sizeBytes;
    root.count += 1;
    root.size += f.sizeBytes;
  }
  // Aggregate counts up the tree so parent folders show total descendant files.
  const aggregate = (nd: FolderNode): { count: number; size: number } => {
    for (const c of nd.children) {
      const a = aggregate(c);
      nd.count += a.count;
      nd.size += a.size;
    }
    return { count: nd.count, size: nd.size };
  };
  aggregate(root);
  return root;
}

/** Count distinct folders in the tree (for the sidebar header). */
function countFolders(node: FolderNode | null): number {
  if (!node) return 0;
  let n = 0;
  const walk = (nd: FolderNode) => {
    n += 1;
    for (const c of nd.children) walk(c);
  };
  walk(node);
  return n;
}

/**
 * Resolve the absolute path of a dropped File. Electron 33's
 * `webUtils.getPathForFile` (exposed via `window.scanAPI`) is the supported
 * replacement for the deprecated non-standard `File.path`; fall back to
 * `.path` when the bridged call returns an empty string.
 */
function getDroppedPath(file: File): string | null {
  const bridged = window.scanAPI.getPathForFile(file);
  if (bridged) return bridged;
  return (file as File & { path?: string }).path || null;
}

export default function App() {
  const {
    state: scan,
    files,
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
  } = useScanState();

  // ---- tag classification system (v2.5) ----
  const tagSystem = useTags();

  // ---- telemetry toasts (transient confirmations for file actions) ----
  const { addToast } = useToast();

  // ---- settings (performance knobs — issues.md item 6) ----
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  // Load persisted settings on mount. On a true first launch (no file on
  // disk), adopt the OS-level reduced-motion preference as the default
  // and persist it so it survives restarts.
  useEffect(() => {
    void window.scanAPI.getSettings().then((res) => {
      if (
        !res.exists &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setSettings({ ...res.settings, reduceMotion: true });
        void window.scanAPI.setSettings({ reduceMotion: true });
      } else {
        setSettings(res.settings);
      }
    }).catch(() => {
      /* defaults already in state — best-effort */
    });
  }, []);
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    void window.scanAPI.setSettings(patch).catch(() => {
      /* main also clamps — best-effort */
    });
  }, []);

  // ---- core state ----
  const [booted, setBooted] = useState(false);
  const [folder, setFolder] = useState<string | null>(
    () => localStorage.getItem("wiergise:lastFolder"),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("masonry");
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("none");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [gridDensity, setGridDensity] = useState(180);
  // Slider ticks each re-pack the whole masonry grid (O(N) per tick). The
  // deferred value coalesces intermediate positions so the pack recomputes
  // at most once per frame while the label still updates live.
  const packedDensity = useDeferredValue(gridDensity);
  /** Folders hidden from the grid via context menu (subtree match).
   * Persisted to localStorage (same pattern as tags) so hides survive restarts. */
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("wiergise:hiddenFolders");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return new Set(parsed.filter((p) => typeof p === "string"));
      }
    } catch {
      /* corrupt entry — start empty */
    }
    return new Set();
  });
  useEffect(() => {
    localStorage.setItem("wiergise:hiddenFolders", JSON.stringify([...hiddenFolders]));
  }, [hiddenFolders]);
  const toggleHideFolder = useCallback((folderPath: string) => {
    setHiddenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  // ---- selection + favorites ----
  const [selectedIds, setSelectedIds] = useState<Set<MediaId>>(new Set());
  const [favorites, setFavorites] = useState<Set<MediaId>>(new Set());

  // ---- overlays ----
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerFilePathRef = useRef<string | null>(null);
  const [activeInspectFile, setActiveInspectFile] = useState<MediaFile | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    file: MediaFile;
    x: number;
    y: number;
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    folderPath: string;
    x: number;
    y: number;
  } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showSessionLog, setShowSessionLog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  /** Bumped by the R key; forces errored tiles to re-fetch their thumbnail. */
  const [reloadEpoch, setReloadEpoch] = useState(0);

  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

  // ---- refs for stable keyboard handler ----
  const folderRef = useRef(folder);
  const scanStatusRef = useRef(scan.status);
  const searchQueryRef = useRef(searchQuery);
  const selectedFolderRef = useRef(selectedFolder);
  const viewerIndexRef = useRef(viewerIndex);
  const showPaletteRef = useRef(showPalette);
  const showHelpRef = useRef(showHelp);
  const showAnalyticsRef = useRef(showAnalytics);
  const showSettingsRef = useRef(showSettings);
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);
  useEffect(() => {
    scanStatusRef.current = scan.status;
  }, [scan.status]);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  useEffect(() => {
    selectedFolderRef.current = selectedFolder;
  }, [selectedFolder]);
  useEffect(() => {
    viewerIndexRef.current = viewerIndex;
  }, [viewerIndex]);
  useEffect(() => {
    showPaletteRef.current = showPalette;
  }, [showPalette]);
  useEffect(() => {
    showHelpRef.current = showHelp;
  }, [showHelp]);
  useEffect(() => {
    showAnalyticsRef.current = showAnalytics;
  }, [showAnalytics]);

  // ---- instant cache restore on mount ----
  useEffect(() => {
    if (!folder) return;
    void window.scanAPI.loadCachedFiles(folder).then((cached) => {
      if (cached.length > 0) onRestore(cached);
    }).catch(() => {
      /* cache restore is best-effort — scan will fill in */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ---- scan actions ----
  const pickFolder = useCallback(async () => {
    try {
      const picked = await window.scanAPI.selectFolder();
      if (picked) {
        setFolder(picked);
        localStorage.setItem("wiergise:lastFolder", picked);
        setSelectedFolder(null);
        onReset();
        const cached = await window.scanAPI.loadCachedFiles(picked);
        if (cached.length > 0) onRestore(cached);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    }
  }, [onReset, onRestore, onError]);

  const startScan = useCallback(async () => {
    if (!folder) return;
    onStart();
    try {
      await window.scanAPI.startScan(
        folder,
        onBatch,
        (p: ScanProgress) => onProgress(p),
        () => onDone(),
        (message: string) => onError(message),
        (patches) => onMetaBatch(patches),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onError(message);
    }
  }, [folder, onStart, onBatch, onProgress, onDone, onError, onMetaBatch]);

  const cancelScan = useCallback(async () => {
    try {
      await window.scanAPI.cancelScan();
    } catch {
      /* best-effort */
    }
    onCancelled();
  }, [onCancelled]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const items = e.dataTransfer?.items;
      let droppedPath: string | null = null;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === "file") {
            const f = it.getAsFile();
            if (f) {
              const p = getDroppedPath(f);
              if (p) {
                droppedPath = p;
                break;
              }
            }
          }
        }
      }
      if (
        !droppedPath &&
        e.dataTransfer?.files &&
        e.dataTransfer.files.length > 0
      ) {
        const p = getDroppedPath(e.dataTransfer.files[0]);
        if (p) droppedPath = p;
      }
      if (droppedPath) {
        setFolder(droppedPath);
        localStorage.setItem("wiergise:lastFolder", droppedPath);
        setSelectedFolder(null);
        onReset();
        void window.scanAPI.loadCachedFiles(droppedPath).then((cached) => {
          if (cached.length > 0) onRestore(cached);
        }).catch(() => {
          /* best-effort restore */
        });
      }
    },
    [onReset, onRestore],
  );

  // ---- selection ----
  const toggleSelect = useCallback((filePath: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        // toggle
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
      } else if (e.shiftKey) {
        // additive
        next.add(filePath);
      } else {
        // plain click → exclusive select
        next.clear();
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // ---- favorites ----
  const toggleFavorite = useCallback(
    (file: MediaFile) => {
      const adding = !favorites.has(file.filePath);
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(file.filePath)) next.delete(file.filePath);
        else next.add(file.filePath);
        return next;
      });
      addToast({
        message: adding ? "ADDED TO FAVORITES" : "REMOVED FROM FAVORITES",
        variant: adding ? "success" : "info",
      });
    },
    [favorites, addToast],
  );

  // ---- file operations (organize & move) ----

  /** State for the in-app move dialog: null = closed, or the file paths to move. */
  const [moveDialogPaths, setMoveDialogPaths] = useState<string[] | null>(null);
  /** File being renamed (null = dialog closed). */
  const [renameDialogFile, setRenameDialogFile] = useState<MediaFile | null>(null);
  /** True when the batch tag dialog is open. */
  const [showBatchTag, setShowBatchTag] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const activityIdRef = useRef(0);

  // ---- trash queue (ui-upgrade.md Issue 1) ----
  // Staged deletions: nothing touches disk until Delete Forever / Empty
  // Queue commits. Session-only — closing the app silently discards the
  // queue (files were never sent to the OS trash).
  const [trashQueue, setTrashQueue] = useState<Map<string, { file: MediaFile; queuedAt: number }>>(new Map());
  const [showTrashQueue, setShowTrashQueue] = useState(false);

  const logActivity = useCallback(
    (action: ActivityEntry["action"], fileName: string, detail: string, ok: boolean, meta?: { fromPath?: string; toPath?: string }) => {
      setActivityLog((prev) => [
        {
          id: ++activityIdRef.current,
          action,
          fileName,
          detail,
          ok,
          timestamp: Date.now(),
          ...(meta ? { fromPath: meta.fromPath, toPath: meta.toPath } : {}),
        },
        ...prev,
      ].slice(0, 50));
    },
    [],
  );

  /** Open the move dialog for a single file (from context menu). */
  const handleMoveFile = useCallback((file: MediaFile) => {
    setMoveDialogPaths([file.filePath]);
  }, []);

  /** Open the move dialog for all selected files (from batch toolbar). */
  const handleMoveSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setMoveDialogPaths([...selectedIds]);
  }, [selectedIds]);

  /**
   * Keep the viewer on the next file when the one it's showing leaves the
   * active set (trash/move) — only close when it was the last file
   * (ui-upgrade.md Issue 2B). Must run BEFORE onRemoveFiles so the file
   * still exists in derivedFilesRef when we read the next one.
   */
  const advanceViewer = useCallback((removedPaths: Set<string>) => {
    if (viewerIndexRef.current === null || viewerFilePathRef.current === null) return;
    if (!removedPaths.has(viewerFilePathRef.current)) return;
    const arr = derivedFilesRef.current;
    const idx = viewerIndexRef.current;
    const next = arr[idx + 1];
    if (next) {
      viewerFilePathRef.current = next.filePath;
    } else {
      setViewerIndex(null);
      viewerFilePathRef.current = null;
    }
  }, []);

  /** Execute the move once the user picks a destination in the dialog. */
  const handleMoveConfirm = useCallback(async (destDir: string) => {
    const paths = moveDialogPaths;
    setMoveDialogPaths(null);
    if (!paths || paths.length === 0) return;
    const results = await window.scanAPI.moveFiles(paths, destDir);
    const moved = new Set(
      results.filter((r) => r.ok).map((r) => r.filePath),
    );
    if (moved.size > 0) {
      // Auto-advance the viewer if the file it was showing got moved
      // (ui-upgrade.md Issue 2B).
      advanceViewer(moved);
      onRemoveFiles(moved);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of moved) next.delete(p);
        return next;
      });
    }
    const destName = destDir.split(/[\\/]/).pop() || destDir;
    const okCount = results.filter((r) => r.ok).length;
    const newPathByOld = new Map(
      results.filter((r): r is { filePath: string; ok: boolean; newPath: string; error?: string } => Boolean(r.ok && r.newPath))
        .map((r) => [r.filePath, r.newPath]),
    );
    logActivity(
      "move",
      okCount === 1 ? paths[0].split(/[\\/]/).pop() || paths[0] : `${okCount} files`,
      `→ ${destName}`,
      okCount > 0,
      paths.length === 1 && okCount === 1
        ? { fromPath: paths[0], toPath: newPathByOld.get(paths[0]) }
        : undefined,
    );
    addToast({
      message: okCount > 0 ? `MOVED ${okCount === 1 ? "1 FILE" : `${okCount} FILES`} → ${destName.toUpperCase()}` : `MOVE FAILED — ${destName.toUpperCase()}`,
      variant: okCount > 0 ? "success" : "error",
    });
  }, [moveDialogPaths, onRemoveFiles, logActivity, advanceViewer, addToast]);

  /** Move files to a specific known directory (sidebar drop / quick move). */
  const handleMoveToDir = useCallback(async (filePaths: string[], destDir: string) => {
    if (filePaths.length === 0) return;
    const results = await window.scanAPI.moveFiles(filePaths, destDir);
    const moved = new Set(
      results.filter((r) => r.ok).map((r) => r.filePath),
    );
    if (moved.size > 0) {
      advanceViewer(moved);
      onRemoveFiles(moved);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of moved) next.delete(p);
        return next;
      });
    }
    const destName = destDir.split(/[\\/]/).pop() || destDir;
    const okCount = results.filter((r) => r.ok).length;
    logActivity(
      "move",
      okCount === 1 ? filePaths[0].split(/[\\/]/).pop() || filePaths[0] : `${okCount} files`,
      `→ ${destName}`,
      okCount > 0,
    );
    addToast({
      message: okCount > 0 ? `MOVED ${okCount === 1 ? "1 FILE" : `${okCount} FILES`} → ${destName.toUpperCase()}` : `MOVE FAILED — ${destName.toUpperCase()}`,
      variant: okCount > 0 ? "success" : "error",
    });
  }, [onRemoveFiles, logActivity, advanceViewer, addToast]);

  /** Stage files for trash — removes them from the grid, nothing on disk. */
  const queueForTrash = useCallback((filesToQueue: MediaFile[]) => {
    if (filesToQueue.length === 0) return;
    setTrashQueue((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const f of filesToQueue) {
        if (!next.has(f.filePath)) next.set(f.filePath, { file: f, queuedAt: now });
      }
      return next;
    });
    onRemoveFiles(new Set(filesToQueue.map((f) => f.filePath)));
    addToast({
      message: `${filesToQueue.length === 1 ? filesToQueue[0].fileName : `${filesToQueue.length} FILES`} STAGED FOR TRASH`,
      variant: "warning",
    });
  }, [onRemoveFiles, addToast]);

  /** Grid context-menu / card trash button → stage, don't delete. */
  const handleTrashFile = useCallback((file: MediaFile) => {
    queueForTrash([file]);
  }, [queueForTrash]);

  /** Trash all selected files → stage them all. */
  const handleTrashSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const queued = derivedFilesRef.current.filter((f) => selectedIds.has(f.filePath));
    queueForTrash(queued);
    setSelectedIds(new Set());
  }, [selectedIds, queueForTrash]);

  /** Pull a staged file back into the grid — no disk operation ever happened. */
  const restoreFromQueue = useCallback((filePath: string) => {
    const entry = trashQueue.get(filePath);
    if (!entry) return;
    setTrashQueue((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
    onAddFiles([entry.file]);
  }, [trashQueue, onAddFiles]);

  /** Commit a single staged file to the OS trash, now. */
  const deleteFromQueue = useCallback(async (filePath: string) => {
    const entry = trashQueue.get(filePath);
    if (!entry) return;
    const result = await window.scanAPI.trashFile(filePath);
    if (result.ok) {
      setTrashQueue((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
      logActivity("trash", entry.file.fileName, "", true);
    } else {
      // Keep the entry queued so the user can retry.
      logActivity("trash", entry.file.fileName, result.error ?? "failed", false);
    }
  }, [trashQueue, logActivity]);

  /** Commit every staged file to the OS trash (the only batch delete path). */
  const emptyTrashQueue = useCallback(async () => {
    const paths = [...trashQueue.keys()];
    if (paths.length === 0) return;
    const results = await window.scanAPI.trashFiles(paths);
    const ok = new Set(results.filter((r) => r.ok).map((r) => r.filePath));
    setTrashQueue((prev) => {
      const next = new Map(prev);
      for (const p of ok) next.delete(p);
      return next;
    });
    const okCount = ok.size;
    if (okCount > 0) {
      const firstName = [...trashQueue.values()].find((e) => ok.has(e.file.filePath))?.file.fileName;
      logActivity(
        "trash",
        okCount === 1 ? firstName ?? "1 file" : `${okCount} files`,
        "",
        true,
      );
      addToast({
        message: `${okCount === 1 ? firstName ?? "1 FILE" : `${okCount} FILES`} SENT TO TRASH`,
        variant: "success",
      });
    }
  }, [trashQueue, logActivity, addToast]);

  /** Viewer trash button / Delete key: stage + auto-advance. */
  const handleViewerTrash = useCallback((file: MediaFile) => {
    queueForTrash([file]);
    advanceViewer(new Set([file.filePath]));
  }, [queueForTrash, advanceViewer]);

  /** Rename a single file in place. */
  const handleRenameFile = useCallback(async (file: MediaFile, newName: string) => {
    const result = await window.scanAPI.renameFile(file.filePath, newName);
    if (result.ok && result.newPath) {
      // Re-add the renamed file under its new path so it stays in the grid
      // (and the viewer keeps showing it instead of blanking out).
      const renamed: MediaFile = {
        ...file,
        filePath: result.newPath,
        fileName: newName,
        fileNameLower: newName.toLowerCase(),
        normPath: result.newPath.replace(/\\/g, "/").toLowerCase(),
      };
      if (viewerFilePathRef.current === file.filePath) {
        viewerFilePathRef.current = result.newPath;
      }
      onRemoveFiles(new Set([file.filePath]));
      onAddFiles([renamed]);
    }
    logActivity(
      "rename",
      file.fileName,
      `→ ${newName}`,
      result.ok,
      result.ok ? { fromPath: file.filePath, toPath: result.newPath } : undefined,
    );
    addToast({
      message: result.ok ? `RENAMED → ${newName.toUpperCase()}` : `RENAME FAILED — ${result.error ?? "unknown error"}`,
      variant: result.ok ? "success" : "error",
    });
    return result;
  }, [onRemoveFiles, onAddFiles, logActivity, addToast]);

  /**
   * Revert a committed move/rename by running the inverse disk operation
   * (ui-upgrade.md Issue 1.5). Only single-file operations carry paths.
   */
  const revertEntry = useCallback(async (entry: ActivityEntry) => {
    if (!entry.ok || !entry.fromPath || !entry.toPath) return;
    if (entry.action === "move") {
      const origDir = entry.fromPath.replace(/[\\/][^\\/]+$/, "");
      const result = await window.scanAPI.moveFile(entry.toPath, origDir);
      logActivity(
        "move",
        entry.fileName,
        `↩ revert ${result.ok ? "OK" : `FAILED: ${result.error ?? "?"}`}`,
        result.ok,
        result.ok ? { fromPath: entry.toPath, toPath: result.newPath } : undefined,
      );
      return;
    }
    if (entry.action === "rename") {
      const origName = entry.fromPath.split(/[\\/]/).pop() ?? entry.fileName;
      const result = await window.scanAPI.renameFile(entry.toPath, origName);
      logActivity(
        "rename",
        entry.fileName,
        `↩ revert ${result.ok ? "OK" : `FAILED: ${result.error ?? "?"}`}`,
        result.ok,
        result.ok ? { fromPath: entry.toPath, toPath: result.newPath } : undefined,
      );
    }
  }, [logActivity]);

  /** Ctrl+Z: undo the most recent organizing action (viewer). */
  const undoLastAction = useCallback(() => {
    const last = activityLog[0];
    if (
      last &&
      last.ok &&
      last.fromPath &&
      last.toPath &&
      (last.action === "move" || last.action === "rename")
    ) {
      void revertEntry(last);
      return;
    }
    // Nothing committed (or not undoable) — restore the most recent staged
    // trash instead; it's pure app state and always reversible.
    let latest: { filePath: string; queuedAt: number } | null = null;
    for (const [filePath, e] of trashQueue) {
      if (!latest || e.queuedAt > latest.queuedAt) latest = { filePath, queuedAt: e.queuedAt };
    }
    if (latest) restoreFromQueue(latest.filePath);
  }, [activityLog, trashQueue, revertEntry, restoreFromQueue]);

  // ---- viewer handlers ----
  // Ref to the latest derivedFiles so navigation callbacks stay stable
  // without depending on the array identity.
  const derivedFilesRef = useRef<MediaFile[]>([]);

  const openViewer = useCallback((file: MediaFile) => {
    viewerFilePathRef.current = file.filePath;
    const arr = derivedFilesRef.current;
    const idx = arr.findIndex((f) => f.filePath === file.filePath);
    setViewerIndex(idx >= 0 ? idx : 0);
  }, []);

  const navigateViewer = useCallback((direction: "prev" | "next") => {
    setViewerIndex((prev) => {
      if (prev === null) return prev;
      const arr = derivedFilesRef.current;
      const next =
        direction === "prev"
          ? Math.max(0, prev - 1)
          : Math.min(arr.length - 1, prev + 1);
      if (next !== prev && arr[next]) {
        viewerFilePathRef.current = arr[next].filePath;
      }
      return next;
    });
  }, []);

  // ---- MasonryGrid call-site callbacks ----
  // Stable identities so the memoized MasonryView/GridView/ListView and
  // their MediaCard tiles don't re-render on every App state change
  // (audit A1 — inline closures here busted every memoized child).
  const onGridRename = useCallback((f: MediaFile) => {
    setRenameDialogFile(f);
  }, []);
  const onGridContextMenu = useCallback((file: MediaFile, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ file, x: e.clientX, y: e.clientY });
  }, []);
  const onGridInspect = useCallback(
    (file: MediaFile) => {
      setActiveInspectFile(file);
      if (viewMode !== "split") openViewer(file);
    },
    [viewMode, openViewer],
  );
  const onGridCloseInspector = useCallback(() => {
    setActiveInspectFile(null);
  }, []);

  // ---- keyboard shortcuts (§11) ----
  // Refs so the keyboard handler can call latest handlers without deps churn.
  const handleMoveSelectedRef = useRef(handleMoveSelected);
  handleMoveSelectedRef.current = handleMoveSelected;
  const handleTrashSelectedRef = useRef(handleTrashSelected);
  handleTrashSelectedRef.current = handleTrashSelected;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // Ctrl/Cmd+K — command palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((s) => !s);
        return;
      }
      // Ctrl/Cmd+O — select folder
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void pickFolder();
        return;
      }
      // Ctrl/Cmd+Enter — start scan
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (folderRef.current && scanStatusRef.current !== "scanning") {
          void startScan();
        }
        return;
      }
      if (inEditable) return;

      // The viewer has its own key handling for Delete/M/F2/R/etc. — the
      // grid shortcuts below must not double-fire while it's open
      // (ui-upgrade.md Issue 2A).
      if (viewerIndexRef.current !== null) return;

      // ? — toggle keyboard help
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setShowHelp((s) => !s);
        return;
      }
      // Esc — close topmost overlay, then clear selection/folder/search
      if (e.key === "Escape") {
        if (showPaletteRef.current) {
          setShowPalette(false);
          return;
        }
        if (showHelpRef.current) {
          setShowHelp(false);
          return;
        }
        if (showAnalyticsRef.current) {
          setShowAnalytics(false);
          return;
        }
        if (showSettingsRef.current) {
          setShowSettings(false);
          return;
        }
        if (viewerIndexRef.current !== null) return; // viewer handles its own Esc
        if (contextMenuRef.current) {
          setContextMenu(null);
          return;
        }
        if (selectedIdsRef.current.size > 0) {
          clearSelection();
          return;
        }
        if (searchQueryRef.current) {
          setSearchQuery("");
        } else if (selectedFolderRef.current !== null) {
          setSelectedFolder(null);
        }
      }

      // Delete — trash selected files
      if (e.key === "Delete" && !inEditable && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        void handleTrashSelectedRef.current?.();
        return;
      }
      // M — move selected files
      if (e.key.toLowerCase() === "m" && !inEditable && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        handleMoveSelectedRef.current?.();
        return;
      }
      // F2 — rename single selected file
      if (e.key === "F2" && !inEditable && selectedIdsRef.current.size === 1) {
        e.preventDefault();
        const f = derivedFilesRef.current.find((df) =>
          selectedIdsRef.current.has(df.filePath),
        );
        if (f) setRenameDialogFile(f);
        return;
      }
      // R — reload failed thumbnails (errored tiles re-fetch via cache-buster)
      if (e.key.toLowerCase() === "r" && !inEditable && viewerIndexRef.current === null) {
        e.preventDefault();
        setReloadEpoch((n) => n + 1);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickFolder, startScan, clearSelection]);

  // ---- derived data pipeline (§10) ----
  // useTags() returns a fresh object every render, but its fields are
  // referentially stable — destructure so the memo deps stay granular.
  const { activeTags, getFileTags } = tagSystem;
  const { derivedFiles, groups, resultCount } = useMemo(() => {
    const allFiles = files;

    // 1. Folder filter — restrict to selectedFolder subtree (if any).
    let folderFiltered = allFiles;
    if (selectedFolder !== null) {
      const normSel = selectedFolder.replace(/\\/g, "/").toLowerCase();
      const normSelPrefix = normSel.endsWith("/") ? normSel : normSel + "/";
      folderFiltered = allFiles.filter(
        (f) => f.normPath === normSel || f.normPath.startsWith(normSelPrefix),
      );
    }

    // 1b. Hidden-folder filter — exclude files whose path falls under any
    // hidden folder (subtree match, case-insensitive).
    let visibleFiles = folderFiltered;
    if (hiddenFolders.size > 0) {
      const hiddenNorms = [...hiddenFolders].map((h) =>
        h.replace(/\\/g, "/").toLowerCase(),
      );
      visibleFiles = folderFiltered.filter(
        (f) => !hiddenNorms.some((h) => {
          const prefix = h.endsWith("/") ? h : h + "/";
          return f.normPath === h || f.normPath.startsWith(prefix);
        }),
      );
    }

    // 2. Type / favorite / large filter (§10.2 ii)
    let typeFiltered = visibleFiles;
    if (typeFilter === "image") {
      typeFiltered = visibleFiles.filter((f) => f.fileType === "image");
    } else if (typeFilter === "video") {
      typeFiltered = visibleFiles.filter((f) => f.fileType === "video");
    } else if (typeFilter === "favorite") {
      typeFiltered = visibleFiles.filter((f) => favorites.has(f.filePath));
    } else if (typeFilter === "large") {
      typeFiltered = visibleFiles.filter(
        (f) => f.sizeBytes > LARGE_FILE_BYTES,
      );
    }

    // 3. Search filter (case-insensitive on precomputed fileNameLower)
    let searchFiltered = typeFiltered;
    const q = debouncedQuery.trim().toLowerCase();
    if (q) {
      searchFiltered = typeFiltered.filter((f) => f.fileNameLower.includes(q));
    }

    // 3.5. Tag filter (v2.5) — only files that have at least one active tag.
    let tagFiltered = searchFiltered;
    if (activeTags.size > 0) {
      tagFiltered = searchFiltered.filter((f) => {
        const assigned = getFileTags(f.filePath);
        return assigned.some((t) => activeTags.has(t.key));
      });
    }

    const filteredCount = tagFiltered.length;

    // 4. Sort (§10.2 iv). date is default.
    const sign = sortDir === "asc" ? 1 : -1;
    const ordered = [...tagFiltered].sort((a, b) => {
      if (sortMode === "name") {
        return a.fileNameLower < b.fileNameLower
          ? -sign
          : a.fileNameLower > b.fileNameLower
            ? sign
            : 0;
      }
      if (sortMode === "size") {
        return (a.sizeBytes - b.sizeBytes) * sign;
      }
      if (sortMode === "resolution") {
        return (a.width * a.height - b.width * b.height) * sign;
      }
      // date
      const tA = Number.isFinite(a.birthtimeMs) ? a.birthtimeMs : 0;
      const tB = Number.isFinite(b.birthtimeMs) ? b.birthtimeMs : 0;
      return (tA - tB) * sign;
    });

    // 5. Grouping (§10.3)
    if (groupMode === "none") {
      return {
        derivedFiles: ordered,
        groups: [{ label: "", files: ordered }],
        resultCount: filteredCount,
      };
    }
    const bucketMap = new Map<string, MediaFile[]>();
    const bucketOrder: string[] = [];
    for (const f of ordered) {
      let key: string;
      if (groupMode === "date") key = f.dateKey;
      else if (groupMode === "type") key = f.fileType === "image" ? "IMAGE" : "VIDEO";
      else if (groupMode === "folder") key = f.filePath.split(/[\\/]/).slice(-2, -1)[0] || "ROOT";
      else key = `${f.width}x${f.height}`;
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = [];
        bucketMap.set(key, bucket);
        bucketOrder.push(key);
      }
      bucket.push(f);
    }
    const groupedFiles: MediaFile[] = [];
    const outGroups: Array<{ label: string; files: MediaFile[] }> = [];
    for (const key of bucketOrder) {
      const bucket = bucketMap.get(key)!;
      let label = key;
      if (groupMode === "date") {
        label =
          key === "unknown"
            ? "Unknown Date"
            : new Date(bucket[0].birthtimeMs).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              });
      }
      outGroups.push({ label, files: bucket });
      for (const f of bucket) groupedFiles.push(f);
    }
    return {
      derivedFiles: groupedFiles,
      groups: outGroups,
      resultCount: filteredCount,
    };
  }, [files, selectedFolder, hiddenFolders, typeFilter, favorites, debouncedQuery, groupMode, sortMode, sortDir, activeTags, getFileTags]);

  // Keep a live ref of derivedFiles for the viewer navigation handler.
  // (derivedFilesRef itself is declared alongside the handlers above.)
  useEffect(() => {
    derivedFilesRef.current = derivedFiles;
  }, [derivedFiles]);
  const contextMenuRef = useRef(contextMenu);
  useEffect(() => {
    contextMenuRef.current = contextMenu;
  }, [contextMenu]);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // CORR-4: resolve viewerIndex by path when derivedFiles changes.
  useEffect(() => {
    if (viewerIndex === null || viewerFilePathRef.current === null) return;
    const idx = derivedFiles.findIndex(
      (f) => f.filePath === viewerFilePathRef.current,
    );
    if (idx === -1) {
      setViewerIndex(null);
      viewerFilePathRef.current = null;
    } else if (idx !== viewerIndex) {
      setViewerIndex(idx);
    }
  }, [derivedFiles, viewerIndex]);


  // ---- stats (§10.4) ----
  const stats: ScanStats = useMemo(() => {
    let imageCount = 0;
    let videoCount = 0;
    let totalSizeBytes = 0;
    for (const f of files) {
      if (f.fileType === "video") videoCount++;
      else imageCount++;
      totalSizeBytes += f.sizeBytes;
    }
    return { totalFiles: files.length, imageCount, videoCount, totalSizeBytes };
  }, [files]);

  // Defer the folder-tree rebuild while batches stream in during a scan:
  // rebuilding the full hierarchy on every batch (hundreds per scan) was
  // re-deriving everything each time. The deferred value drops intermediate
  // states and keeps the tree one commit behind fast mutations.
  const deferredFiles = useDeferredValue(files);
  const folderTree = useMemo(
    () => buildFolderTree(deferredFiles, folder || ""),
    [deferredFiles, folder],
  );
  const totalFolders = useMemo(() => countFolders(folderTree), [folderTree]);

  const isScanning = scan.status === "scanning";
  const showIdleState = scan.status === "idle" && scan.count === 0;

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "user"}>
      <div
        className={`h-screen w-screen flex flex-col bg-nerv-bg text-nerv-text overflow-hidden relative font-mono select-none ${
        settings.reduceMotion ? "seele-reduce-motion" : ""
      } ${settings.dialogBlur ? "" : "seele-no-blur"}`}
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (
          (e.dataTransfer?.types?.includes("Files") && e.clientX <= 0) ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight
        ) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        setIsDragOver(false);
        handleDrop(e);
      }}
    >
      {!booted && (
        <BootSequence
          durationMs={import.meta.env.DEV ? 0 : 1800}
          onDone={() => setBooted(true)}
        />
      )}
      {/* CRT scanline overlay (v2.5 §2.4) */}
      <div className="crt-overlay" aria-hidden="true" />

      <TitleBar folder={folder} />

      {/* Drag-and-drop overlay — styled NERV drop zone (decorative only;
          the app-root drag handlers above own enter/over/leave/drop). */}
      {isDragOver && (
        <FileUpload
          label="DROP TO SCAN"
          color="orange"
          className="pointer-events-none fixed inset-0 z-50 bg-nerv-bg/90 backdrop-blur-sm [&>div:first-child]:h-full [&>div:first-child]:w-full"
        />
      )}

      {/* Header */}
      <Header
        currentFolder={folder}
        onPickFolder={pickFolder}
        onScan={startScan}
        scanning={isScanning}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        sortDir={sortDir}
        onSortDirChange={setSortDir}
        gridDensity={gridDensity}
        onGridDensityChange={setGridDensity}
        resultCount={resultCount}
        totalCount={scan.count}
        selectedCount={selectedIds.size}
        onOpenHelp={() => setShowHelp(true)}
        onOpenPalette={() => setShowPalette(true)}
        onOpenAnalytics={() => setShowAnalytics(true)}
        onOpenSettings={() => setShowSettings(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
      />

      {/* Status strip (compact, below header) */}
      {(isScanning || scan.status !== "idle") && (
        <div className="no-drag flex items-center gap-3 px-4 h-7 border-b border-nerv-border/40 text-[10px] font-mono flex-shrink-0 z-20 bg-nerv-panel/40">
          {isScanning ? (
            <>
              <span className="text-nerv-amber font-semibold">
                {scan.count.toLocaleString()} files found
              </span>
              <div className="h-px flex-1 max-w-[200px] bg-nerv-panel-2 overflow-hidden">
                <div className="h-full w-1/3 bg-nerv-orange animate-pulse" />
              </div>
              {scan.progress && (
                <span
                  className="text-nerv-muted/70 truncate max-w-[220px]"
                  title={scan.progress.currentDir}
                >
                  {scan.progress.currentDir}
                </span>
              )}
              <button
                type="button"
                className="ml-auto text-nerv-amber hover:text-nerv-red underline no-drag"
                onClick={cancelScan}
              >
                CANCEL
              </button>
            </>
          ) : (
            <span
              className={`font-semibold tracking-wider ${
                scan.status === "done"
                  ? "text-nerv-green"
                  : scan.status === "cancelled"
                    ? "text-nerv-amber"
                    : "text-nerv-red"
              }`}
            >
              {scan.status === "done"
                ? `SCAN COMPLETE · ${scan.count.toLocaleString()} FILES`
                : scan.status === "cancelled"
                  ? `CANCELLED · ${scan.count.toLocaleString()} FILES`
                  : "SCAN FAILED"}
            </span>
          )}
          {scan.status === "done" && (
            <span className="ml-auto text-nerv-muted">
              {stats.imageCount.toLocaleString()} img ·{" "}
              {stats.videoCount.toLocaleString()} vid ·{" "}
              {formatBytes(stats.totalSizeBytes)}
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {scan.status === "error" && scan.error && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-nerv-amber bg-nerv-amber/5 border-b border-nerv-amber/30 px-4 h-7 flex-shrink-0 z-20">
          <span className="font-bold">{scan.error}</span>
          <button
            type="button"
            className="text-nerv-muted hover:text-nerv-amber underline ml-auto"
            onClick={onReset}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0 relative z-10">
        <Sidebar
          open={sidebarOpen}
          tree={folderTree}
          totalFolders={totalFolders}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          hiddenFolders={hiddenFolders}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          stats={stats}
          favoriteCount={favorites.size}
          onDropFiles={handleMoveToDir}
          selectedIds={selectedIds}
          tags={tagSystem.tags}
          activeTags={tagSystem.activeTags}
          tagCounts={tagSystem.tagCounts}
          onAddTag={tagSystem.addTag}
          onRemoveTag={tagSystem.removeTag}
          onToggleActiveTag={tagSystem.toggleActiveTag}
          onFolderContextMenu={(folderPath, x, y) =>
            setFolderContextMenu({ folderPath, x, y })
          }
        />

        {/* Main content */}
        <main className="flex-1 min-w-0 h-full relative overflow-hidden bg-nerv-bg">
          {showIdleState ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-5 p-8 text-center animate-fade-in">
              <svg
                viewBox="0 0 24 24"
                width="64"
                height="64"
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                className="text-nerv-orange/40"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <div className="flex flex-col gap-1.5">
                <p className="text-nerv-amber tracking-widest text-base uppercase font-bold">
                  Select a folder to begin
                </p>
                <p className="text-nerv-muted/60 text-xs max-w-xs">
                  Open a folder, then press{" "}
                  <kbd className="px-1.5 py-0.5 border border-nerv-orange/40 text-nerv-orange text-[10px]">
                    Ctrl
                  </kbd>
                  +
                  <kbd className="px-1.5 py-0.5 border border-nerv-orange/40 text-nerv-orange text-[10px]">
                    Enter
                  </kbd>{" "}
                  to scan.
                </p>
              </div>
              <button
                type="button"
                className="mt-2 px-5 py-2 bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-mono font-bold text-xs uppercase transition-colors duration-150 cursor-pointer shadow-[0_0_12px_rgba(255,152,48,0.3)]"
                onClick={pickFolder}
              >
                Open folder...
              </button>
            </div>
          ) : viewMode === "folders" ? (
            <FolderBrowser
              tree={folderTree}
              currentFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              files={files}
              totalBytes={stats.totalSizeBytes}
              hiddenFolders={hiddenFolders}
              onToggleHideFolder={toggleHideFolder}
              onFolderContextMenu={(folderPath, x, y) =>
                setFolderContextMenu({ folderPath, x, y })
              }
            />
          ) : groups.length === 0 || resultCount === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-3 animate-fade-in">
              <svg
                viewBox="0 0 24 24"
                width="48"
                height="48"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="text-nerv-orange/30"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm text-nerv-muted/70">
                No media files match the current filters.
              </p>
            </div>
          ) : (
            <MasonryGrid
              groups={groups}
              viewMode={viewMode}
              groupMode={groupMode}
              targetColumnWidth={packedDensity}
              selectedIds={selectedIds}
              favorites={favorites}
              onToggleSelect={toggleSelect}
              onOpen={openViewer}
              onMove={handleMoveFile}
              onRename={onGridRename}
              onTrash={handleTrashFile}
              onToggleFavorite={toggleFavorite}
              onContextMenu={onGridContextMenu}
              onInspect={onGridInspect}
              onCloseInspector={onGridCloseInspector}
              activeInspectFile={activeInspectFile}
              reloadEpoch={reloadEpoch}
              overscan={settings.overscan}
              tags={tagSystem.tags}
              fileTagGetter={tagSystem.getFileTags}
              onToggleFileTag={tagSystem.toggleFileTag}
            />
          )}
        </main>
      </div>
      {/* Footer status telemetry bar (v2.5 §1b) */}
      {scan.status !== "idle" && (
        <footer className="flex items-center gap-3 px-4 h-7 border-t border-nerv-border/60 bg-nerv-panel/40 text-[10px] font-mono flex-shrink-0 z-20">
          <span className="text-nerv-text-dim tracking-wider">STATUS</span>
          <span
            className={`font-bold tracking-wider ${
              scan.status === "done"
                ? "text-nerv-green"
                : scan.status === "scanning"
                  ? "text-nerv-orange"
                  : scan.status === "error"
                    ? "text-nerv-red"
                    : "text-nerv-text-dim"
            }`}
          >
            {scan.status === "done"
              ? "\u25CF NOMINAL"
              : scan.status === "scanning"
                ? "\u25CF ACTIVE"
                : scan.status === "error"
                  ? "\u25CF FAULT"
                  : "\u25CF IDLE"}
          </span>
          {stats.totalFiles > 0 && (
            <>
              <span className="text-nerv-border-highlight">{"\u2502"}</span>
              {/* Segmented ratio bar */}
              <div className="eva-segbar flex h-3 w-32">
                {(() => {
                  const img = stats.imageCount;
                  const vid = stats.videoCount;
                  // Enforce a minimum 10% sliver for any non-zero type
                  // so a small-but-present count is always visible.
                  let imgPct = (img / stats.totalFiles) * 100;
                  let vidPct = (vid / stats.totalFiles) * 100;
                  const MIN = 10;
                  if (img > 0 && imgPct < MIN) imgPct = MIN;
                  if (vid > 0 && vidPct < MIN) vidPct = MIN;
                  if (imgPct + vidPct > 100) {
                    // Over-clamped — scale the dominant one down.
                    if (img >= vid) imgPct = 100 - vidPct;
                    else vidPct = 100 - imgPct;
                  }
                  return (
                    <>
                      <div
                        className="bg-nerv-cyan"
                        style={{ width: `${imgPct}%` }}
                        title={`IMG: ${img.toLocaleString()} (${((img / stats.totalFiles) * 100).toFixed(1)}%)`}
                      />
                      {vid > 0 && (
                        <div
                          className="bg-nerv-green"
                          style={{ width: `${vidPct}%` }}
                          title={`VID: ${vid.toLocaleString()} (${((vid / stats.totalFiles) * 100).toFixed(1)}%)`}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              <span className="text-nerv-cyan tabular-nums">
                IMG {stats.imageCount.toLocaleString()}
              </span>
              <span className="text-nerv-green tabular-nums">
                VID {stats.videoCount.toLocaleString()}
              </span>
              <span className="text-nerv-border-highlight">{"\u2502"}</span>
              <span className="text-nerv-text-dim tabular-nums">
                {formatBytes(stats.totalSizeBytes)}
              </span>
            </>
          )}
          {selectedIds.size > 0 && (
            <span className="ml-auto text-nerv-orange tabular-nums font-bold">
              {selectedIds.size} SELECTED
            </span>
          )}
        </footer>
      )}

      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          items={[
            {
              key: "open-viewer",
              label: "Open in Viewer",
              onClick: () => {
                openViewer(contextMenu.file);
                setContextMenu(null);
              },
            },
            {
              key: "open-default",
              label: "Open with Default",
              onClick: () =>
                void window.scanAPI.openPath(contextMenu.file.filePath),
            },
            {
              key: "show-in-folder",
              label: "Show in File Manager",
              onClick: () =>
                void window.scanAPI.showItemInFolder(contextMenu.file.filePath),
            },
            {
              key: "copy-path",
              label: "Copy File Path",
              onClick: () =>
                void window.scanAPI.writeClipboard(contextMenu.file.filePath),
            },
            {
              key: "copy-name",
              label: "Copy File Name",
              onClick: () =>
                void window.scanAPI.writeClipboard(contextMenu.file.fileName),
            },
            { key: "sep-1" },
            {
              key: "move",
              label: "Move to Folder...",
              onClick: () => {
                void handleMoveFile(contextMenu.file);
                setContextMenu(null);
              },
            },
            {
              key: "rename",
              label: "Rename...",
              onClick: () => {
                setRenameDialogFile(contextMenu.file);
                setContextMenu(null);
              },
            },
            { key: "sep-2" },
            {
              key: "trash",
              label: "Move to Trash",
              onClick: () => {
                void handleTrashFile(contextMenu.file);
                setContextMenu(null);
              },
            },
            { key: "sep-3" },
            {
              key: "hide-folder",
              label: "Hide Containing Folder",
              onClick: () => {
                const dir = contextMenu.file.filePath.replace(/[\\/][^\\/]+$/, "");
                if (dir) toggleHideFolder(dir);
                setContextMenu(null);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {folderContextMenu && (
        <ContextMenu
          position={{ x: folderContextMenu.x, y: folderContextMenu.y }}
          items={[
            {
              key: "open-folder",
              label: "Open in Browser",
              onClick: () => {
                setSelectedFolder(folderContextMenu.folderPath);
                setViewMode("folders");
                setFolderContextMenu(null);
              },
            },
            { key: "sep-1" },
            {
              key: "reveal-folder",
              label: "Reveal in File Manager",
              onClick: () => {
                void window.scanAPI.showItemInFolder(folderContextMenu.folderPath);
                setFolderContextMenu(null);
              },
            },
            {
              key: "copy-folder-path",
              label: "Copy Folder Path",
              onClick: () => {
                void window.scanAPI.writeClipboard(folderContextMenu.folderPath);
                setFolderContextMenu(null);
              },
            },
            { key: "sep-2" },
            {
              key: "toggle-hide",
              label: hiddenFolders.has(folderContextMenu.folderPath)
                ? "Unhide Folder"
                : "Hide Folder",
              onClick: () => {
                toggleHideFolder(folderContextMenu.folderPath);
                setFolderContextMenu(null);
              },
            },
          ]}
          onClose={() => setFolderContextMenu(null)}
        />
      )}

      {/* Floating batch action toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-stretch shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
          {/* Counter badge */}
          <div className="eva-ticket flex items-center gap-2 px-4 bg-nerv-orange/15 border border-nerv-orange">
            <span className="text-nerv-orange font-bold text-sm tabular-nums">
              {String(selectedIds.size).padStart(3, "0")}
            </span>
            <span className="text-[9px] font-mono tracking-widest uppercase text-nerv-amber">
              Selected
            </span>
          </div>

          {/* Actions */}
          <button
            type="button"
            className="eva-ticket px-3 flex items-center gap-1.5 bg-nerv-panel border border-l-0 border-nerv-border hover:border-nerv-amber/60 hover:bg-nerv-amber/5 transition-colors group"
            onClick={() => {
              // Single state update for the whole selection — the previous
              // per-file toggleFavorite loop fired N setState calls, each
              // re-rendering the entire grid.
              const picked = derivedFiles
                .filter((f) => selectedIds.has(f.filePath))
                .map((f) => f.filePath);
              setFavorites((prev) => {
                const next = new Set(prev);
                for (const p of picked) {
                  if (next.has(p)) next.delete(p);
                  else next.add(p);
                }
                return next;
              });
            }}
          >
            <span className="text-nerv-amber text-xs">★</span>
            <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-nerv-text group-hover:text-nerv-amber">
              Fav
            </span>
          </button>
          <button
            type="button"
            className="eva-ticket px-3 flex items-center gap-1.5 bg-nerv-panel border border-l-0 border-nerv-border hover:border-nerv-cyan/60 hover:bg-nerv-cyan/5 transition-colors group"
            onClick={() => setShowBatchTag(true)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-cyan">
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
              <circle cx="7" cy="7" r="1.4" fill="currentColor" />
            </svg>
            <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-nerv-text group-hover:text-nerv-cyan">
              Tag
            </span>
          </button>

          <button
            type="button"
            className="eva-ticket px-3 flex items-center gap-1.5 bg-nerv-panel border border-l-0 border-nerv-border hover:border-nerv-lime/60 hover:bg-nerv-lime/5 transition-colors group"
            onClick={() => void handleMoveSelected()}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-lime">
              <path d="M2 8h9M7 4l4 4-4 4M14 3v10" />
            </svg>
            <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-nerv-text group-hover:text-nerv-lime">
              Move
            </span>
          </button>

          <button
            type="button"
            className="eva-ticket px-3 flex items-center gap-1.5 bg-nerv-panel border border-l-0 border-nerv-border hover:border-nerv-red/60 hover:bg-nerv-red/5 transition-colors group"
            onClick={() => void handleTrashSelected()}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-red">
              <path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9" />
            </svg>
            <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-nerv-text group-hover:text-nerv-red">
              Trash
            </span>
          </button>

          <button
            type="button"
            className="eva-ticket px-3 flex items-center bg-nerv-panel border border-l-0 border-nerv-border hover:border-nerv-muted hover:bg-nerv-panel-2 transition-colors group"
            onClick={clearSelection}
          >
            <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-nerv-muted group-hover:text-nerv-text">
              ✕
            </span>
          </button>
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {viewerIndex !== null && derivedFiles[viewerIndex] && (
          <MediaViewer
            file={derivedFiles[viewerIndex]}
            files={derivedFiles}
            index={viewerIndex}
            onClose={() => {
              setViewerIndex(null);
              viewerFilePathRef.current = null;
            }}
            onNavigate={navigateViewer}
            onNavigateTo={(i) => {
            if (derivedFiles[i]) {
              viewerFilePathRef.current = derivedFiles[i].filePath;
              setViewerIndex(i);
            }
          }}
          onMove={handleMoveFile}
          onRename={(f) => setRenameDialogFile(f)}
          onTrash={handleViewerTrash}
          onToggleFavorite={toggleFavorite}
          isFavorite={viewerFilePathRef.current !== null && favorites.has(viewerFilePathRef.current)}
          onUndo={undoLastAction}
          queuedCount={trashQueue.size}
          modalOpen={moveDialogPaths !== null || renameDialogFile !== null || showTrashQueue}
          tags={tagSystem.tags}
          fileTags={
            viewerFilePathRef.current
              ? tagSystem.getFileTags(viewerFilePathRef.current)
              : undefined
          }
          onToggleFileTag={tagSystem.toggleFileTag}
        />
        )}
      </AnimatePresence>

      {moveDialogPaths && folderTree && (
        <MoveDialog
          tree={folderTree}
          count={moveDialogPaths.length}
          onClose={() => setMoveDialogPaths(null)}
          onConfirm={handleMoveConfirm}
        />
      )}
      {renameDialogFile && (
        <RenameDialog
          file={renameDialogFile}
          onClose={() => setRenameDialogFile(null)}
          onConfirm={(file, newName) => {
            setRenameDialogFile(null);
            void handleRenameFile(file, newName);
          }}
        />
      )}
      {showBatchTag && selectedIds.size > 0 && (
        <BatchTagDialog
          tags={tagSystem.tags}
          filePaths={[...selectedIds]}
          getFileTags={tagSystem.getFileTags}
          onBatchToggle={tagSystem.batchAssign}
          onClose={() => setShowBatchTag(false)}
        />
      )}

      <ActivityLog
        entries={activityLog}
        onClear={() => setActivityLog([])}
      />

      {/* Session log badge button — opens full audit trail modal */}
      {activityLog.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSessionLog(true)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-1.5 bg-nerv-panel border border-nerv-orange/40 text-nerv-orange text-[10px] font-mono font-bold tracking-wider hover:bg-nerv-orange/10 hover:shadow-[0_0_12px_rgba(255,152,48,0.3)] transition-[background-color,color,box-shadow]"
        >
          <span className="w-1.5 h-1.5 bg-nerv-orange animate-pulse-soft" />
          SESSION LOG
          <span className="tag-chip bg-nerv-orange/20 px-1.5 py-0.5 text-[9px]">
            {activityLog.length}
          </span>
        </button>
      )}

      {/* Overlays */}
      <AnimatePresence>{showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}</AnimatePresence>
      <AnimatePresence>
        {showPalette && (
          <CommandPalette
            files={derivedFiles}
            onClose={() => setShowPalette(false)}
            onSelect={(f) => {
              setShowPalette(false);
              openViewer(f);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAnalytics && (
          <AnalyticsModal
            files={files}
            onClose={() => setShowAnalytics(false)}
            onOpenMedia={(f) => {
              setShowAnalytics(false);
              openViewer(f);
            }}
          />
        )}
      </AnimatePresence>

      {/* Session Audit Trail Modal — v2.5 §Module 7 */}
      <SessionChangesModal
        open={showSessionLog}
        entries={activityLog}
        onClose={() => setShowSessionLog(false)}
        onClear={() => {
          setActivityLog([]);
          setShowSessionLog(false);
        }}
        onRevert={revertEntry}
      />

      {/* Trash Queue badge + modal (ui-upgrade.md Issue 1) */}
      {trashQueue.size > 0 && (
        <button
          type="button"
          onClick={() => setShowTrashQueue(true)}
          className="fixed bottom-6 left-6 z-40 flex items-center gap-2 px-4 py-1.5 bg-nerv-panel border border-nerv-red/40 text-nerv-red text-[10px] font-mono font-bold tracking-wider hover:bg-nerv-red/10 hover:shadow-[0_0_12px_rgba(255,77,48,0.3)] transition-[background-color,color,box-shadow]"
        >
          <span className="w-1.5 h-1.5 bg-nerv-red animate-pulse-soft" />
          TRASH QUEUE
          <span className="tag-chip bg-nerv-red/20 px-1.5 py-0.5 text-[9px]">
            {trashQueue.size}
          </span>
        </button>
      )}
      <TrashQueueModal
        open={showTrashQueue}
        entries={[...trashQueue.values()]}
        onClose={() => setShowTrashQueue(false)}
        onRestore={restoreFromQueue}
        onDelete={(filePath) => void deleteFromQueue(filePath)}
        onEmptyAll={() => void emptyTrashQueue()}
      />

      {/* Settings — performance & accessibility knobs (issues.md item 6) */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal
            settings={settings}
            onChange={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
