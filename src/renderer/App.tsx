import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VirtualizedGrid, { type GroupHeader } from "./components/VirtualizedGrid";
import FolderTree from "./components/FolderTree";
import SearchBar from "./components/SearchBar";
import GroupControls, { type GroupMode } from "./components/GroupControls";
import SortControls, { type SortMode, type SortDir } from "./components/SortControls";
import HexGridOverlay from "./components/HexGridOverlay";
import BootSequence from "./components/BootSequence";
import MediaViewer from "./components/MediaViewer";
import ContextMenu, { type ContextMenuPosition } from "./components/ContextMenu";
import { useSfx } from "./sfx/useSfx";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { formatBytes } from "./utils";
import KeyboardHelp from "./components/KeyboardHelp";
import { useScanState } from "./hooks/useScanState";
import type { MediaFile, ScanProgress } from "../scanner/types";

/** Minimum delay before re-filtering after the user stops typing (ms). */
const SEARCH_DEBOUNCE_MS = 200;


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
  const [folder, setFolder] = useState<string | null>(
    () => localStorage.getItem("wiergise:lastFolder"),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>("none");
  // Sort dimension/order for the derived list (v3 review #14). "default"
  // preserves the scan/grouping order; the others sort within the whole
  // filtered set (and within each group when grouping is active).
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Media viewer (lightbox) state — v2 review #3.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Thumbnail right-click context menu (v3 review #13).
  const [contextMenu, setContextMenu] = useState<{
    file: MediaFile;
    position: ContextMenuPosition;
  } | null>(null);
  // Drag-and-drop folder feedback overlay (UX-2).
  const [isDragOver, setIsDragOver] = useState(false);
  // Collapsible sidebar (UX-3).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Grid density / thumbnail size control (UX-4).
  const [gridDensity, setGridDensity] = useState(180);
  // Keyboard help panel (UX-9).
  const [showHelp, setShowHelp] = useState(false);

  // Debounce the search query so the heavy filter useMemo doesn't run on
  // every keystroke (review issue #24).
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

  const { playClick, playScan, playHover } = useSfx();

  // Refs for keyboard shortcuts that need current values without
  // re-binding the global listener on every state change (v4 review M-5).
  const folderRef = useRef(folder);
  const scanStatusRef = useRef(scan.status);
  const searchQueryRef = useRef(searchQuery);
  const selectedFolderRef = useRef(selectedFolder);
  const viewerIndexRef = useRef(viewerIndex);
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

  // Instant restore: on mount, if we have a cached folder, load its files
  // from the on-disk dimension cache so the gallery appears immediately
  // without a filesystem walk (v4 rework). The user can rescan to refresh.
  useEffect(() => {
    if (!folder) return;
    void window.scanAPI.loadCachedFiles(folder).then((cached) => {
      if (cached.length > 0) onRestore(cached);
    });
    // Run once on mount; `folder` is from localStorage initializer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Batch measured dimensions and flush to main via IPC on a timer (v4
  // rework). The grid reports naturalWidth/Height per thumbnail as it
  // decodes; we coalesce to avoid thousands of IPC round-trips on large
  // libraries. Main persists these so the next startup restores the
  // masonry at correct aspect ratios without re-decoding.
  const dimBatchRef = useRef<
    Map<string, { width: number; height: number }>
  >(new Map());
  const dimFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDimensions = useCallback(() => {
    dimFlushRef.current = null;
    const batch = dimBatchRef.current;
    if (batch.size === 0) return;
    const entries = Array.from(batch, ([filePath, d]) => ({ filePath, ...d }));
    batch.clear();
    void window.scanAPI.saveDimensions(entries);
  }, []);
  const handleDimensionsMeasured = useCallback(
    (filePath: string, width: number, height: number) => {
      dimBatchRef.current.set(filePath, { width, height });
      if (dimFlushRef.current) return;
      dimFlushRef.current = setTimeout(flushDimensions, 3000);
    },
    [flushDimensions],
  );
  useEffect(() => {
    return () => {
      if (dimFlushRef.current) clearTimeout(dimFlushRef.current);
      flushDimensions();
    };
  }, [flushDimensions]);

  const handleSelectFolder = useCallback(
    (f: string | null) => {
      playClick();
      setSelectedFolder(f);
    },
    [playClick],
  );

  const handleGroupModeChange = useCallback(
    (m: GroupMode) => {
      playClick();
      setGroupMode(m);
    },
    [playClick],
  );

  const handleSortModeChange = useCallback(
    (m: SortMode) => {
      playClick();
      setSortMode(m);
    },
    [playClick],
  );

  const handleSortDirChange = useCallback(
    (d: SortDir) => {
      playClick();
      setSortDir(d);
    },
    [playClick],
  );

  const pickFolder = useCallback(async () => {
    playClick();
    const picked = await window.scanAPI.selectFolder();
    if (picked) {
      setFolder(picked);
      localStorage.setItem("wiergise:lastFolder", picked);
      setSelectedFolder(null);
      onReset();
      // Restore cached files instantly if available.
      const cached = await window.scanAPI.loadCachedFiles(picked);
      if (cached.length > 0) onRestore(cached);
    }
  }, [playClick, onReset, onRestore]);

  // Folder drag-and-drop (v3 review #12). Electron exposes real paths
  // via DataTransferItemList, unlike a sandboxed browser. We accept the
  // first dropped item and treat it like a folder picker result.
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
      // Fallback to files[].path if items isn't populated.
      if (!droppedPath && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const p = (e.dataTransfer.files[0] as File & { path?: string })?.path;
        if (p) droppedPath = p;
      }
      if (droppedPath) {
        playClick();
        setFolder(droppedPath);
        localStorage.setItem("wiergise:lastFolder", droppedPath);
        setSelectedFolder(null);
        onReset();
        void window.scanAPI.loadCachedFiles(droppedPath).then((cached) => {
          if (cached.length > 0) onRestore(cached);
        });
      }
    },
    [playClick, onReset, onRestore],
  );

  const cancelScan = useCallback(async () => {
    playClick();
    try {
      await window.scanAPI.cancelScan();
    } catch {
      // Best-effort; the worker may have already exited.
    }
    // Transition the reducer to "cancelled" immediately so the UI
    // reflects the cancel without waiting for the worker's final
    // message (v2 review #5). Partial files already received are kept.
    onCancelled();
  }, [playClick, onCancelled]);


  const startScan = useCallback(async () => {
    if (!folder) return;
    playScan();
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
  }, [folder, playScan, onStart, onBatch, onProgress, onDone, onError, onMetaBatch]);

  // Keyboard shortcuts (review issue #23).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea unless it's a handled combo.
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

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
      // Ctrl/Cmd+F — focus search input (v4 review M-1: was a no-op).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="Search files..."]',
        );
        input?.focus();
      }
      // ? — toggle keyboard help panel (UX-9).
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setShowHelp((s) => !s);
        return;
      }
      // Escape — clear search, else clear folder selection.
      // Defer to MediaViewer when the viewer is open so Escape doesn't
      // double-fire (close viewer AND clear search) — v3 review #11.
      // Uses refs so the listener doesn't rebind on every keystroke
      // (v4 review M-5).
      if (e.key === "Escape") {
        if (viewerIndexRef.current !== null) return;
        if (searchQueryRef.current) {
          setSearchQuery("");
        } else if (selectedFolderRef.current !== null) {
          setSelectedFolder(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickFolder, startScan]);

  // Derived filter & grouping pipeline.
  // Uses precomputed `normPath` / `birthtimeMs` / `dateKey` from the
  // scanner (review issues #10, #11) and the debounced query.
  const { derivedFiles, groupHeaders, resultCount } = useMemo(() => {
    const allFiles = files;

    // 1. Folder filter — uses precomputed lowercase normPath.
    let folderFiltered = allFiles;
    if (selectedFolder !== null) {
      const normSel = selectedFolder.replace(/\\/g, "/").toLowerCase();
      const normSelPrefix = normSel.endsWith("/") ? normSel : normSel + "/";
      folderFiltered = allFiles.filter(
        (f) => f.normPath === normSel || f.normPath.startsWith(normSelPrefix),
      );
    }

    // 2. Search filter — case-insensitive substring on file name.
    //    Uses the precomputed `fileNameLower` so we don't allocate a
    //    fresh lowercased string per file per query (v3 review #2).
    let searchFiltered = folderFiltered;
    const q = debouncedQuery.trim().toLowerCase();
    if (q) {
      searchFiltered = folderFiltered.filter((f) =>
        f.fileNameLower.includes(q),
      );
    }

    const filteredCount = searchFiltered.length;

    // 3. Sort the filtered set when an explicit sort is active (v3 #14).
    //    "default" preserves scan order. Grouping consumes the result so
    //    the chosen order also applies within each group.
    const sign = sortDir === "asc" ? 1 : -1;
    const ordered =
      sortMode === "default"
        ? searchFiltered
        : [...searchFiltered].sort((a, b) => {
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
            // date
            const tA = Number.isFinite(a.birthtimeMs) ? a.birthtimeMs : 0;
            const tB = Number.isFinite(b.birthtimeMs) ? b.birthtimeMs : 0;
            return (tA - tB) * sign;
          });

    // 4. Grouping.
    if (groupMode === "none") {
      return {
        derivedFiles: ordered,
        groupHeaders: undefined,
        resultCount: filteredCount,
      };
    }

    if (groupMode === "date") {
      // Partition `ordered` by dateKey, preserving the user's sort order
      // within each bucket. When sortMode === "default" the within-group
      // order is scan order.
      const sorted: MediaFile[] = [];
      const buckets = new Map<string, MediaFile[]>();
      const bucketOrder: string[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const f = ordered[i];
        const key = f.dateKey;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
          bucketOrder.push(key);
        }
        bucket.push(f);
      }
      // When no explicit sort is chosen, present date buckets newest-first
      // (the original default). Under an explicit sort the buckets are
      // already in the user's chosen order via `ordered`.
      if (sortMode === "default") {
        bucketOrder.sort((ka, kb) => {
          const ta = Number.isFinite(buckets.get(ka)![0].birthtimeMs)
            ? buckets.get(ka)![0].birthtimeMs
            : 0;
          const tb = Number.isFinite(buckets.get(kb)![0].birthtimeMs)
            ? buckets.get(kb)![0].birthtimeMs
            : 0;
          return tb - ta;
        });
      }
      const headers: GroupHeader[] = [];
      for (let b = 0; b < bucketOrder.length; b++) {
        const key = bucketOrder[b];
        const bucket = buckets.get(key)!;
        const startIndex = sorted.length;
        for (let i = 0; i < bucket.length; i++) sorted.push(bucket[i]);
        const label =
          key === "unknown"
            ? "Unknown Date"
            : new Date(bucket[0].birthtimeMs).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              });
        headers.push({ key, label, startIndex });
      }

      return {
        derivedFiles: sorted,
        groupHeaders: headers,
        resultCount: filteredCount,
      };
    }

    // groupMode === "type" — partition `ordered`, preserving within-group order.
    const images: MediaFile[] = [];
    const videos: MediaFile[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const f = ordered[i];
      if (f.fileType === "image") images.push(f);
      else videos.push(f);
    }
    const sorted = [...images, ...videos];
    const headers: GroupHeader[] = [];
    if (images.length > 0) {
      headers.push({ key: "images", label: "Images", startIndex: 0 });
    }
    if (videos.length > 0) {
      headers.push({ key: "videos", label: "Videos", startIndex: images.length });
    }

    return {
      derivedFiles: sorted,
      groupHeaders: headers,
      resultCount: filteredCount,
    };
  }, [files, debouncedQuery, selectedFolder, groupMode, sortMode, sortDir]);

  // Summary stats for the status bar (UX-8).
  const stats = useMemo(() => {
    let images = 0;
    let videos = 0;
    let totalBytes = 0;
    for (const f of files) {
      if (f.fileType === "video") videos++;
      else images++;
      totalBytes += f.sizeBytes;
    }
    return { images, videos, totalBytes };
  }, [files]);

  // Media viewer (lightbox) handlers — v2 review #3.
  // Index arrives from the grid (absolute tile index), avoiding an O(n)
  // findIndex on every click (v3 review #5).
  const openViewer = useCallback((_file: MediaFile, index: number) => {
    setViewerIndex(index);
  }, []);

  // Right-click on a thumbnail opens the context menu (v3 review #13).
  const handleThumbnailContextMenu = useCallback(
    (file: MediaFile, e: React.MouseEvent) => {
      setContextMenu({ file, position: { x: e.clientX, y: e.clientY } });
    },
    [],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const file = contextMenu.file;
    return [
      {
        key: "open-default",
        label: "Open with default app",
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 5v14l11-7z" /></svg>,
        onClick: () => void window.scanAPI.openPath(file.filePath),
      },
      {
        key: "show-in-folder",
        label: "Show in file manager",
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
        onClick: () => void window.scanAPI.showItemInFolder(file.filePath),
      },
      { key: "div1", label: undefined },
      {
        key: "open-viewer",
        label: "Open in viewer",
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3" /><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /></svg>,
        onClick: () => {
          const idx = derivedFiles.findIndex(
            (f) => f.filePath === file.filePath,
          );
          setViewerIndex(idx >= 0 ? idx : 0);
        },
      },
      { key: "div2", label: undefined },
      {
        key: "copy-path",
        label: "Copy file path",
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
        onClick: () => void window.scanAPI.writeClipboard(file.filePath),
      },
      {
        key: "copy-name",
        label: "Copy file name",
        icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>,
        onClick: () => void window.scanAPI.writeClipboard(file.fileName),
      },
    ];
  }, [contextMenu, derivedFiles]);

  const navigateViewer = useCallback(
    (direction: "prev" | "next") => {
      setViewerIndex((prev) => {
        if (prev === null || derivedFiles.length === 0) return prev;
        // Stop at boundaries — no wrap-around (v3 review #8).
        if (direction === "prev") {
          return prev > 0 ? prev - 1 : prev;
        }
        return prev < derivedFiles.length - 1 ? prev + 1 : prev;
      });
    },
    [derivedFiles.length],
  );

  const navigateViewerTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < derivedFiles.length) setViewerIndex(index);
    },
    [derivedFiles.length],
  );

  const isScanning = scan.status === "scanning";
  const showIdleState = scan.status === "idle" && scan.count === 0;
  const showEmptyState =
    scan.status === "done" && scan.count === 0 && !debouncedQuery;

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden bg-nerv-bg text-nerv-text font-mono relative z-10 box-border"
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
        if (e.dataTransfer?.types?.includes("Files") && e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        setIsDragOver(false);
        handleDrop(e);
      }}
    >
      <HexGridOverlay />
      <BootSequence durationMs={import.meta.env.DEV ? 0 : 600} />

      {/* Drag-and-drop overlay (UX-2) */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg/90 backdrop-blur-sm border-2 border-dashed border-nerv-orange pointer-events-none">
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <svg viewBox="0 0 24 24" width="72" height="72" fill="none" stroke="currentColor" strokeWidth={1.5} className="text-nerv-orange">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="font-display text-lg uppercase tracking-widest text-nerv-amber font-bold">
              Drop Folder to Scan
            </span>
          </div>
        </div>
      )}

      {/* ── Top app bar ─────────────────────────────────────────── */}
      <header className="titlebar-drag relative z-20 flex flex-col flex-shrink-0 border-b border-nerv-border/60 bg-nerv-panel/40 backdrop-blur-sm">
        {/* Row 1 — wordmark + actions + search */}
        <div className="no-drag flex items-center gap-3 px-4 h-12">
          {/* Wordmark */}
          <div className="flex items-center gap-2 flex-shrink-0 pr-3 border-r border-nerv-border/60 h-full">
            <span className="w-2 h-2 bg-nerv-orange animate-blink flex-shrink-0" />
            <span className="font-display text-sm font-bold uppercase tracking-[0.2em] text-nerv-orange">
              Wiergise
            </span>
            <span className="text-[9px] uppercase tracking-widest text-nerv-muted hidden sm:inline">
              media scanner
            </span>
          </div>

          {/* Folder + scan actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              className="px-3 h-8 bg-nerv-panel-2 border border-nerv-border hover:border-nerv-orange text-nerv-text text-xs uppercase transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              onClick={pickFolder}
              title="Select folder (Ctrl+O)"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="max-w-[160px] truncate">{folder ? "Change" : "Open"}</span>
            </button>
            <button
              type="button"
              className="px-4 h-8 bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-bold text-xs uppercase transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(255,85,0,0.25)] flex items-center gap-1.5"
              onClick={startScan}
              disabled={!folder || isScanning}
              title="Start scan (Ctrl+Enter)"
            >
              {isScanning ? (
                <span className="w-3 h-3 border-2 border-nerv-bg/40 border-t-nerv-bg rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {isScanning ? "Scanning" : "Scan"}
            </button>
            {isScanning && (
              <button
                type="button"
                className="px-3 h-8 bg-transparent border border-nerv-amber/60 hover:bg-nerv-amber/10 text-nerv-amber text-xs uppercase transition-all duration-150 cursor-pointer"
                onClick={cancelScan}
                title="Cancel the active scan"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Search — fills the middle */}
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            resultCount={resultCount}
            totalCount={scan.count}
          />

          {/* Filters */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <GroupControls mode={groupMode} onChange={handleGroupModeChange} />
            <SortControls
              mode={sortMode}
              dir={sortDir}
              onModeChange={handleSortModeChange}
              onDirChange={handleSortDirChange}
            />

            {/* Grid density slider (UX-4) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <svg className="w-3 h-3 text-nerv-muted" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              <input
                type="range"
                min={100}
                max={400}
                value={gridDensity}
                onChange={(e) => setGridDensity(Number(e.target.value))}
                className="w-20 h-1 accent-nerv-orange"
                title="Thumbnail size"
              />
              <svg className="w-4 h-4 text-nerv-muted" viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="2" width="20" height="20" rx="1" />
              </svg>
            </div>
          </div>
        </div>

        {/* Row 2 — status strip (folder path + scan status) */}
        <div className="flex items-center gap-3 px-4 h-7 border-t border-nerv-border/40 text-[10px] font-mono">
          {folder ? (
            <span className="text-nerv-muted truncate max-w-[50%]" title={folder}>
              <span className="text-nerv-muted/60">ROOT</span>{" "}
              <span className="text-nerv-text/80">{folder}</span>
            </span>
          ) : (
            <span className="text-nerv-muted/50">No folder selected</span>
          )}

          {/* Progress bar (inline when scanning) */}
          {isScanning && (
            <div className="h-px flex-1 max-w-[200px] bg-nerv-panel-2 overflow-hidden">
              <div className="h-full w-1/3 bg-nerv-orange animate-scanline-bar" />
            </div>
          )}

          {scan.status !== "idle" && (
            <div className="flex items-center gap-2 ml-auto">
              {scan.status === "scanning" ? (
                <>
                  <span className="text-nerv-amber font-semibold">
                    {scan.count.toLocaleString()} files found
                  </span>
                  {scan.progress && (
                    <span className="text-nerv-muted/70 truncate max-w-[220px]" title={scan.progress.currentDir}>
                      {scan.progress.currentDir}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span
                    className={`font-semibold tracking-wider ${
                      scan.status === "done" ? "text-nerv-green" : "text-nerv-amber"
                    }`}
                  >
                    {scan.status === "done"
                      ? `SCAN COMPLETE · ${scan.count.toLocaleString()} FILES`
                      : scan.status === "cancelled"
                        ? `CANCELLED · ${scan.count.toLocaleString()} FILES`
                        : "SCAN FAILED"}
                  </span>
                  {scan.status === "done" && (
                    <>
                      <span className="text-nerv-muted/40">|</span>
                      <span className="text-nerv-cyan text-[10px]">
                        {stats.images.toLocaleString()} images
                      </span>
                      <span className="text-nerv-green text-[10px]">
                        {stats.videos.toLocaleString()} videos
                      </span>
                      <span className="text-nerv-muted text-[10px]">
                        {formatBytes(stats.totalBytes)}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          )}

        {/* Error banner */}
        {scan.status === "error" && scan.error && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-nerv-amber bg-nerv-amber/5 border-t border-nerv-amber/30 px-4 h-7">
            <span className="font-bold">⚠ {scan.error}</span>
            <button
              type="button"
              className="text-nerv-muted hover:text-nerv-amber underline ml-auto"
              onClick={onReset}
            >
              dismiss
            </button>
          </div>
        )}
        </div>
      </header>

      {/* ── Body: sidebar + main ───────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative z-10">
        {/* Sidebar collapse toggle (UX-3) */}
        <button
          type="button"
          onClick={() => setSidebarOpen((s) => !s)}
          className="absolute top-1/2 -translate-y-1/2 z-30 w-5 h-10 bg-nerv-panel border border-nerv-border/60 flex items-center justify-center text-nerv-muted hover:text-nerv-orange hover:border-nerv-orange/50 transition-all cursor-pointer"
          style={{ left: sidebarOpen ? "240px" : "0" }}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d={sidebarOpen ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
          </svg>
        </button>

        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "w-[240px] min-w-[240px]" : "w-0 min-w-0"} h-full flex-shrink-0 border-r border-nerv-border/60 bg-nerv-panel/20 overflow-hidden flex flex-col transition-all duration-200`}>
          <div className="flex items-center justify-between px-3 h-8 border-b border-nerv-border/40 flex-shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-nerv-muted font-bold">
              Navigation
            </span>
            {selectedFolder && (
              <button
                type="button"
                className="text-[9px] uppercase text-nerv-cyan hover:text-nerv-amber"
                onClick={() => setSelectedFolder(null)}
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <FolderTree
              files={files}
              filesVersion={scan.count}
              rootPath={folder || ""}
              selectedFolder={selectedFolder}
              onSelect={handleSelectFolder}
            />
          </div>
        </aside>

        {/* Main grid area — full-bleed, no panel boxing */}
        <main className="flex-1 min-w-0 h-full relative overflow-hidden bg-nerv-bg">
          {showIdleState ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-5 p-8 text-center">
              <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1" className="text-nerv-orange/40">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <div className="flex flex-col gap-1.5">
                <p className="text-nerv-amber tracking-widest text-base uppercase font-bold">
                  Select a folder to begin
                </p>
                <p className="text-nerv-muted/60 text-xs max-w-xs">
                  Open a folder, then press{" "}
                  <kbd className="px-1.5 py-0.5 border border-nerv-orange/40 text-nerv-orange text-[10px]">Ctrl</kbd>
                  +
                  <kbd className="px-1.5 py-0.5 border border-nerv-orange/40 text-nerv-orange text-[10px]">Enter</kbd>{" "}
                  to scan.
                </p>
              </div>
              <button
                type="button"
                className="mt-2 px-5 py-2 bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-mono font-bold text-xs uppercase transition-all duration-150 cursor-pointer shadow-[0_0_12px_rgba(255,85,0,0.3)]"
                onClick={pickFolder}
              >
                Open folder…
              </button>
            </div>
          ) : showEmptyState ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-nerv-muted gap-3">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-nerv-orange/30">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm text-nerv-muted/70">No media files found in this folder.</p>
            </div>
          ) : (
            <VirtualizedGrid
              files={derivedFiles}
              groupHeaders={groupHeaders}
              onThumbnailHover={playHover}
              onThumbnailClick={openViewer}
              onThumbnailContextMenu={handleThumbnailContextMenu}
              onDimensionsMeasured={handleDimensionsMeasured}
              targetColumnWidth={gridDensity}
            />
          )}
        </main>
      </div>

      {/* Fullscreen media viewer */}
      {viewerIndex !== null && derivedFiles[viewerIndex] && (
        <MediaViewer
          file={derivedFiles[viewerIndex]}
          files={derivedFiles}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={navigateViewer}
          onNavigateTo={navigateViewerTo}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Keyboard help panel (UX-9) */}
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
