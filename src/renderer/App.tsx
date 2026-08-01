import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { MasonryGrid } from "./components/MasonryGrid";
import MediaViewer from "./components/MediaViewer";
import { ContextMenu } from "./components/ContextMenu";
import CommandPalette from "./components/CommandPalette";
import { KeyboardHelp } from "./components/KeyboardHelp";
import AnalyticsModal from "./components/AnalyticsModal";
import BootSequence from "./components/BootSequence";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { formatBytes } from "./utils";
import { useScanState } from "./hooks/useScanState";
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
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

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
  } = useScanState();

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
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ---- scan actions ----
  const pickFolder = useCallback(async () => {
    const picked = await window.scanAPI.selectFolder();
    if (picked) {
      setFolder(picked);
      localStorage.setItem("wiergise:lastFolder", picked);
      setSelectedFolder(null);
      onReset();
      const cached = await window.scanAPI.loadCachedFiles(picked);
      if (cached.length > 0) onRestore(cached);
    }
  }, [onReset, onRestore]);

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
            const p = (f as File & { path?: string })?.path;
            if (p) {
              droppedPath = p;
              break;
            }
          }
        }
      }
      if (
        !droppedPath &&
        e.dataTransfer?.files &&
        e.dataTransfer.files.length > 0
      ) {
        const p = (e.dataTransfer.files[0] as File & { path?: string })?.path;
        if (p) droppedPath = p;
      }
      if (droppedPath) {
        setFolder(droppedPath);
        localStorage.setItem("wiergise:lastFolder", droppedPath);
        setSelectedFolder(null);
        onReset();
        void window.scanAPI.loadCachedFiles(droppedPath).then((cached) => {
          if (cached.length > 0) onRestore(cached);
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
  const toggleFavorite = useCallback((file: MediaFile) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(file.filePath)) next.delete(file.filePath);
      else next.add(file.filePath);
      return next;
    });
  }, []);

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

  // ---- keyboard shortcuts (§11) ----
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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickFolder, startScan, clearSelection]);

  // ---- derived data pipeline (§10) ----
  const { derivedFiles, groups, resultCount } = useMemo(() => {
    const allFiles = files;

    // 1. Folder filter
    let folderFiltered = allFiles;
    if (selectedFolder !== null) {
      const normSel = selectedFolder.replace(/\\/g, "/").toLowerCase();
      const normSelPrefix = normSel.endsWith("/") ? normSel : normSel + "/";
      folderFiltered = allFiles.filter(
        (f) => f.normPath === normSel || f.normPath.startsWith(normSelPrefix),
      );
    }

    // 2. Type / favorite / large filter (§10.2 ii)
    let typeFiltered = folderFiltered;
    if (typeFilter === "image") {
      typeFiltered = folderFiltered.filter((f) => f.fileType === "image");
    } else if (typeFilter === "video") {
      typeFiltered = folderFiltered.filter((f) => f.fileType === "video");
    } else if (typeFilter === "favorite") {
      typeFiltered = folderFiltered.filter((f) => favorites.has(f.filePath));
    } else if (typeFilter === "large") {
      typeFiltered = folderFiltered.filter(
        (f) => f.sizeBytes > LARGE_FILE_BYTES,
      );
    }

    // 3. Search filter (case-insensitive on precomputed fileNameLower)
    let searchFiltered = typeFiltered;
    const q = debouncedQuery.trim().toLowerCase();
    if (q) {
      searchFiltered = typeFiltered.filter((f) => f.fileNameLower.includes(q));
    }

    const filteredCount = searchFiltered.length;

    // 4. Sort (§10.2 iv). date is default.
    const sign = sortDir === "asc" ? 1 : -1;
    const ordered = [...searchFiltered].sort((a, b) => {
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
  }, [files, selectedFolder, typeFilter, typeFilter === "favorite" ? favorites : null, debouncedQuery, groupMode, sortMode, sortDir]);

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

  const folderTree = useMemo(
    () => buildFolderTree(files, folder || ""),
    [files, folder],
  );
  const totalFolders = useMemo(() => countFolders(folderTree), [folderTree]);

  const isScanning = scan.status === "scanning";
  const showIdleState = scan.status === "idle" && scan.count === 0;

  return (
    <div
      className="h-screen w-screen flex flex-col bg-nerv-bg text-nerv-text overflow-hidden relative font-mono select-none"
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

      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg/90 backdrop-blur-sm border-2 border-dashed border-nerv-orange pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <svg
              viewBox="0 0 24 24"
              width="72"
              height="72"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-nerv-orange"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="font-display text-lg uppercase tracking-widest text-nerv-amber font-bold">
              Drop Folder to Scan
            </span>
          </div>
        </div>
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
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
      />

      {/* Status strip (compact, below header) */}
      {(isScanning || scan.status !== "idle") && (
        <div className="no-drag flex items-center gap-3 px-4 h-7 border-b border-nerv-border/40 text-[10px] font-mono flex-shrink-0 z-20 bg-nerv-panel/40 titlebar-drag">
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
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          stats={stats}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0 h-full relative overflow-hidden bg-nerv-bg">
          {showIdleState ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-5 p-8 text-center">
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
                className="mt-2 px-5 py-2 bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-mono font-bold text-xs uppercase transition-all duration-150 cursor-pointer shadow-[0_0_12px_rgba(255,85,0,0.3)]"
                onClick={pickFolder}
              >
                Open folder...
              </button>
            </div>
          ) : groups.length === 0 || resultCount === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-3">
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
              targetColumnWidth={gridDensity}
              selectedIds={selectedIds}
              favorites={favorites}
              onToggleSelect={toggleSelect}
              onOpen={openViewer}
              onToggleFavorite={toggleFavorite}
              onContextMenu={(file, e) => {
                e.preventDefault();
                setContextMenu({ file, x: e.clientX, y: e.clientY });
              }}
              onInspect={(file) => {
                setActiveInspectFile(file);
                if (viewMode !== "split") openViewer(file);
              }}
              activeInspectFile={activeInspectFile}
            />
          )}
        </main>
      </div>

      {/* Floating batch action toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-nerv-panel border border-nerv-orange/60 rounded-lg px-4 py-2 flex items-center gap-4 text-xs font-mono animate-glow-orange">
          <span className="text-nerv-orange font-bold">
            {selectedIds.size} item(s) selected
          </span>
          <span className="w-px h-4 bg-nerv-border" />
          <button
            type="button"
            className="text-nerv-amber hover:text-nerv-orange transition-colors"
            onClick={() => {
              for (const f of derivedFiles) {
                if (selectedIds.has(f.filePath)) toggleFavorite(f);
              }
            }}
          >
            Toggle Favorite
          </button>
          <button
            type="button"
            className="text-nerv-muted hover:text-nerv-red transition-colors"
            onClick={clearSelection}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Lightbox */}
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
        />
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
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Overlays */}
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}
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
    </div>
  );
}
