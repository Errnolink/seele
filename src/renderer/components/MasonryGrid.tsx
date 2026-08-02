/**
 * MasonryGrid — the content presenter (§7.3).
 *
 * Renders the file collection in one of four view modes — masonry, grid,
 * list, split — with per-group headers. The library can hold ~25k files, so
 * every mode virtualizes: only the tiles/rows inside the scroll viewport
 * (plus a 600px overscan band) are mounted. The scroll handler is
 * rAF-throttled and a `ResizeObserver` tracks container size so column math
 * and visible-window computations stay accurate without per-frame re-renders.
 *
 * The virtualization primitives (rAF scroll, ResizeObserver, greedy
 * shortest-column packer, overscan window) are adapted from the proven
 * `VirtualizedGrid` that shipped for the staggered view.
 */
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GroupMode, MediaFile, ViewMode } from "../types";
import { formatBytes, formatDate } from "../utils";
import type { TagDef } from "../hooks/useTags";

// ── Layout constants ─────────────────────────────────────────────────
/** Header bar height (group label row) in px. */
const HEADER_HEIGHT = 32;
/** Tile gap in px. */
const GAP = 10;
/** Scroll padding in px. */
const PADDING = 16;
/** Overscan band (px above + below the viewport) mounted for smooth scroll. */
const OVERSCAN = 600;
/** Fallback aspect ratio (height/width) for files without dimensions. */
const FALLBACK_RATIO = 0.75;
/** Uniform tile height for grid + list virtualization (px). */
const GRID_TILE_H = 160;
/** List row height (px). */
const LIST_ROW_H = 44;
/** Minimum thumbnail width requested from the sharp backend. */
const THUMB_MIN = 128;
/** Maximum thumbnail width requested from the sharp backend. */
const THUMB_MAX = 512;

export interface MasonryGridProps {
  groups: Array<{ label: string; files: MediaFile[] }>;
  viewMode: ViewMode; // 'masonry' | 'grid' | 'list' | 'split'
  groupMode: GroupMode; // 'none' | 'date' | 'type' | 'folder' | 'resolution'
  targetColumnWidth: number; // 130-360
  selectedIds: Set<string>;
  favorites: Set<string>;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  /** Inspector toolbar actions (split view). */
  onMove?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onTrash?: (file: MediaFile) => void;
  onInspect: (file: MediaFile) => void;
  /** Close the inspector panel (× button). */
  onCloseInspector?: () => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  activeInspectFile: MediaFile | null;
  /** Incremented to force re-fetch of failed tile thumbnails. */
  reloadEpoch: number;
  /** Tag system props — v2.5 §Module 6.4 */
  tags?: TagDef[];
  fileTagGetter?: (filePath: string) => TagDef[];
  onToggleFileTag?: (filePath: string, tagKey: string) => void;
}

/** Build a media URL for a tile, requesting a sharp thumbnail for images. */
function tileUrl(file: MediaFile, tileWidth: number): string {
  const base = window.scanAPI.toMediaUrl(file.filePath);
  const w = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(tileWidth * 1.5)));
  // Both images and videos get ?w= — the main process routes video
  // thumbnails through ffmpeg frame extraction.
  return `${base}?w=${w}`;
}

/** Derive a stable EVA-style plate ID (e.g. "EVA-00042") from a file path.
 *  Uses a simple deterministic hash so the same file always gets the same
 *  plate number without needing its array index. */
function plateId(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) - hash + filePath.charCodeAt(i)) | 0;
  }
  return `EVA-${String(Math.abs(hash) % 100000).padStart(5, "0")}`;
}

// ── MediaCard (memoized grid/masonry tile) ──────────────────────────

interface MediaCardProps {
  file: MediaFile;
  /** Natural aspect ratio (width/height) for masonry; 1 for grid. */
  aspectRatio: number;
  selected: boolean;
  favorite: boolean;
  tileWidth: number;
  /** Incremented by the parent to force a re-fetch of errored tiles only.
   *  Loaded tiles keep their cached URL; only tiles in the error state
   *  reset and re-request with a cache-busting query. */
  reloadEpoch: number;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  /** Tags assigned to this file (for always-visible pills). */
  fileTags?: TagDef[];
  /** Report the decoded natural dimensions of the loaded thumbnail. */
  onDimensions?: (filePath: string, width: number, height: number) => void;
}
const MediaCard = memo(function MediaCard({
  file,
  aspectRatio,
  selected,
  favorite,
  tileWidth,
  reloadEpoch,
  onToggleSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
  onInspect,
  fileTags,
  onDimensions,
}: MediaCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isVideo = file.fileType === "video";
  // Formats that may carry an alpha channel (PNG/GIF/WebP/SVG). Triggers
  // a checkerboard backdrop so transparency is visible — invisible for
  // fully-opaque images since the <img> (z-1) covers the ::before (z-0).
  const mayHaveAlpha = !isVideo && /\.(png|gif|webp|svg)$/i.test(file.filePath);
  // Cache-buster only added on retry (epoch > 0 + tile was errored).
  const [retryCount, setRetryCount] = useState(0);
  const baseUrl = useMemo(() => tileUrl(file, tileWidth), [file, tileWidth]);
  const url = retryCount > 0 ? `${baseUrl}&retry=${retryCount}` : baseUrl;

  // When parent bumps reloadEpoch, reset errored tiles so they re-fetch.
  // Loaded tiles are unaffected — no wasteful re-download.
  useEffect(() => {
    if (error) {
      setError(false);
      setLoaded(false);
      setRetryCount((c) => c + 1);
    }
  }, [reloadEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Single click inspects in split; opens the lightbox otherwise.
        onInspect(file);
        void e;
      }}
      onDoubleClick={() => onOpen(file)}
      onContextMenu={(e) => onContextMenu(file, e)}
      draggable
      onDragStart={(e) => {
        // If the dragged tile isn't already selected, exclusive-select it so
        // the sidebar drop handler moves exactly this file (or the existing
        // multi-selection if the tile was already part of it).
        if (!selected) onToggleSelect(file.filePath, e as unknown as React.MouseEvent);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", file.filePath);
      }}
      className={[
        "group relative border overflow-hidden transition-all duration-200 cursor-pointer bg-nerv-panel select-none",
        mayHaveAlpha && "thumb-checkerboard",
        selected
          ? "border-nerv-orange ring-2 ring-nerv-orange/50 shadow-[0_0_15px_rgba(255,152,48,0.3)]"
          : "border-nerv-border hover:border-nerv-orange/70 hover:shadow-lg",
      ].join(" ")}
      style={{ aspectRatio: String(aspectRatio) }}
      title={file.fileName}
    >
      {/* Error fallback — corrupt/unsupported files show a styled badge. */}
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-nerv-panel-2 gap-2">
          {isVideo ? (
            <>
              <svg className="w-8 h-8 text-nerv-green/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="1" />
                <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
              </svg>
              <span className="font-mono text-[8px] tracking-wider text-nerv-muted">NO THUMBNAIL</span>
            </>
          ) : (
            <span className="font-mono text-[9px] font-bold tracking-wider text-nerv-red">UNREADABLE</span>
          )}
        </div>
      ) : (
        <>
          {/* Shimmer skeleton until the image decodes. */}
          {!loaded && (
            <div className="shimmer absolute inset-0" aria-hidden="true" />
          )}

          <img
            src={url}
            alt={file.fileName}
            loading="lazy"
            onLoad={(e) => {
              setLoaded(true);
              // Report the decoded thumbnail's natural size so the main
              // process can persist aspect ratios to the on-disk cache
              // (restores correct masonry proportions next launch).
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                onDimensions?.(file.filePath, img.naturalWidth, img.naturalHeight);
              }
            }}
            onError={() => setError(true)}
            className={[
              "w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0",
            ].join(" ")}
            draggable={false}
          />
        </>
      )}

      {/* Top action overlay (revealed on hover). */}
      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
        <button
          type="button"
          aria-label="Toggle selection"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(file.filePath, e);
          }}
          className={[
            "pointer-events-auto w-5 h-5 flex items-center justify-center border text-[11px] font-bold leading-none transition-colors",
            selected
              ? "bg-nerv-orange border-nerv-orange text-nerv-bg"
              : "bg-black/40 border-white/60 text-white hover:border-nerv-orange",
          ].join(" ")}
        >
          {selected ? "\u2713" : ""}
        </button>
        <button
          type="button"
          aria-label="Toggle favorite"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(file);
          }}
          className={[
            "pointer-events-auto w-6 h-6 flex items-center justify-center text-[13px] leading-none transition-colors",
            favorite
              ? "bg-nerv-amber/90 text-nerv-bg"
              : "bg-black/40 text-white/80 hover:text-nerv-amber",
          ].join(" ")}
        >
          {"\u2605"}
        </button>
      </div>

      {/* Favorite star — always visible when starred (non-hover fallback). */}
      {favorite && (
        <span className="absolute top-1.5 right-1.5 text-nerv-amber text-[13px] leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] pointer-events-none z-10">
          {"\u2605"}
        </span>
      )}

      {/* Hover reticle brackets — targeting reticle aesthetic (v2.5 §5). */}
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">
        <span className="absolute top-0.5 left-0.5 w-2.5 h-2.5 border-t border-l border-nerv-orange/70" />
        <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 border-t border-r border-nerv-orange/70" />
        <span className="absolute bottom-0.5 left-0.5 w-2.5 h-2.5 border-b border-l border-nerv-orange/70" />
        <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 border-b border-r border-nerv-orange/70" />
      </div>

      {/* Video type tint + play icon — always visible. */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 bg-black/40 border border-nerv-green/70 flex items-center justify-center backdrop-blur-sm">
            <svg className="w-4 h-4 text-nerv-green" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Always-visible metadata bar (bottom). */}
      <div className="absolute bottom-0 left-0 right-0 px-2 pt-4 pb-1.5 bg-gradient-to-t from-black/95 via-black/80 to-transparent pointer-events-none">
        <p className="text-white text-[10px] font-bold truncate font-mono leading-tight">
          {file.fileName}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 text-[8px] font-mono tabular-nums">
          <span className="text-nerv-amber">
            {file.width > 0 && file.height > 0 ? `${file.width}x${file.height}` : "\u2014"}
          </span>
          <span className="text-white/40">·</span>
          <span className="text-white/70">{formatBytes(file.sizeBytes)}</span>
          <span className="ml-auto shrink-0">
            {isVideo ? (
              <span className="text-nerv-green">VID</span>
            ) : (
              <span className="text-nerv-cyan">IMG</span>
            )}
          </span>
        </div>
        {fileTags && fileTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {fileTags.slice(0, 3).map((t) => (
              <span
                key={t.key}
                className="px-1 py-px text-[7px] font-mono font-bold tracking-wider border"
                style={{ color: t.color, borderColor: `${t.color}55` }}
              >
                {t.label}
              </span>
            ))}
            {fileTags.length > 3 && (
              <span className="text-[7px] font-mono text-white/50">+{fileTags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Group label header ──────────────────────────────────────────────

interface GroupLabelProps {
  label: string;
  count: number;
}

/** Shared group header: orange bar + uppercase label + item count + divider. */
const GroupLabel = memo(function GroupLabel({ label, count }: GroupLabelProps) {
  return (
    <div className="flex items-center gap-3" style={{ height: HEADER_HEIGHT }}>
      <div
        className="bg-nerv-orange rounded flex-shrink-0"
        style={{ width: 6, height: 16 }}
        aria-hidden="true"
      />
      <span className="font-display text-[11px] uppercase tracking-widest text-nerv-orange font-bold truncate">
        {label}
      </span>
      <span className="text-nerv-muted text-[11px] font-mono whitespace-nowrap">
        ({count} items)
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-nerv-orange/30 to-transparent" />
    </div>
  );
});

// ── MasonryGrid ─────────────────────────────────────────────────────

/** One placed masonry tile (absolute-positioned inside its section). */
interface PlacedTile {
  file: MediaFile;
  /** Absolute index across the flat file stream. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One masonry section = optional group header + its packed tiles.
 *  `colTiles` holds one Y-sorted list per column so the visibility window
 *  can binary-search instead of scanning every tile on each scroll frame. */
interface Section {
  label?: string;
  count: number;
  colTiles: PlacedTile[][];
  height: number;
  offsetY: number;
}

/**
 * Content presenter. Switches between masonry / grid / list / split views,
 * grouping files and virtualizing each mode so 25k files stay responsive.
 */
export const MasonryGrid: React.FC<MasonryGridProps> = ({
  groups,
  viewMode,
  groupMode,
  targetColumnWidth,
  selectedIds,
  favorites,
  onToggleSelect,
  onOpen,
  onMove,
  onRename,
  onTrash,
  onToggleFavorite,
  onContextMenu,
  onInspect,
  onCloseInspector,
  activeInspectFile,
  reloadEpoch,
  tags,
  fileTagGetter,
  onToggleFileTag,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafId = useRef<number | null>(null);

  // ── ResizeObserver + rAF-throttled scroll (proven from VirtualizedGrid) ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setContainerWidth(el.clientWidth);
      setViewportHeight(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 || entry.contentRect.height > 0) {
          if (rafId.current !== null) cancelAnimationFrame(rafId.current);
          rafId.current = requestAnimationFrame(() => {
            rafId.current = null;
            measure();
          });
        }
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [viewMode]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      setScrollTop(el.scrollTop);
    });
  }, []);

  // ── Decoded-dimension reporter (v4 cache wiring) ──
  // MediaCards report naturalWidth/Height on image load; coalesce into a
  // single IPC flush so repeated scrolls don't hammer the main process.
  const dimsRef = useRef(new Map<string, { w: number; h: number }>());
  const dimsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportDimensions = useCallback(
    (filePath: string, width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const prev = dimsRef.current.get(filePath);
      if (prev && prev.w === width && prev.h === height) return;
      dimsRef.current.set(filePath, { w: width, h: height });
      if (dimsTimerRef.current) return;
      dimsTimerRef.current = setTimeout(() => {
        dimsTimerRef.current = null;
        const entries = Array.from(dimsRef.current, ([filePath, d]) => ({
          filePath,
          width: d.w,
          height: d.h,
        }));
        dimsRef.current.clear();
        if (entries.length > 0) void window.scanAPI.saveDimensions(entries);
      }, 1500);
    },
    [],
  );
  // Flush any pending dimensions on unmount so the cache isn't lost.
  useEffect(() => {
    const dims = dimsRef.current;
    return () => {
      if (dimsTimerRef.current) {
        clearTimeout(dimsTimerRef.current);
        dimsTimerRef.current = null;
      }
      const entries = Array.from(dims, ([filePath, d]) => ({
        filePath,
        width: d.w,
        height: d.h,
      }));
      if (entries.length > 0) void window.scanAPI.saveDimensions(entries);
    };
  }, []);

  // Flattened file list + per-group index offsets, memoized so the heavy
  // masonry/grid packers don't recompute on every scroll tick.
  const { allFiles, groupSpans } = useMemo(() => {
    const files: MediaFile[] = [];
    const spans: Array<{ label: string; count: number; start: number }> = [];
    for (const g of groups) {
      spans.push({ label: g.label, count: g.files.length, start: files.length });
      for (const f of g.files) files.push(f);
    }
    return { allFiles: files, groupSpans: spans };
  }, [groups]);

  // Effective container width for column math. In split mode the inspector
  // is a separate <aside> sibling, so the measured width is grid-only.
  const effectiveWidth = useMemo(() => {
    return Math.max(0, containerWidth - PADDING * 2);
  }, [containerWidth]);

  // Show group labels only when grouping is active.
  const showGroups = groupMode !== "none" && groupSpans.length > 0;

  // ── Masonry packing (greedy shortest-column, natural aspect ratio) ──
  const masonry = useMemo(() => {
    if (viewMode !== "masonry" && viewMode !== "split") return null;
    if (!allFiles.length || effectiveWidth === 0) {
      return { sections: [] as Section[], totalHeight: 0 };
    }
    const colW = Math.max(120, targetColumnWidth);
    const cols = Math.max(1, Math.floor(effectiveWidth / colW));
    const columnWidth = Math.max(
      1,
      Math.floor((effectiveWidth - (cols - 1) * GAP) / cols),
    );

    const sections: Section[] = [];
    let cursorY = 0;
    for (const span of groupSpans) {
      const startY = cursorY;
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      const colHeights = new Array(cols).fill(headerOffset) as number[];
      // Per-column tile lists — tiles land in a column in Y order, which
      // lets the visibility window binary-search per column (O(visible)
      // per scroll frame instead of O(all tiles)).
      const colTiles: PlacedTile[][] = Array.from({ length: cols }, () => []);
      for (let i = 0; i < span.count; i++) {
        const idx = span.start + i;
        const file = allFiles[idx];
        let shortest = 0;
        for (let c = 1; c < cols; c++) {
          if (colHeights[c] < colHeights[shortest]) shortest = c;
        }
        const ratio =
          file.width > 0 && file.height > 0
            ? file.height / file.width
            : FALLBACK_RATIO;
        const tileH = Math.round(columnWidth * ratio);
        colTiles[shortest].push({
          file,
          index: idx,
          x: PADDING + shortest * (columnWidth + GAP),
          y: colHeights[shortest],
          width: columnWidth,
          height: tileH,
        });
        colHeights[shortest] += tileH + GAP;
      }
      const height = Math.max(...colHeights, headerOffset);
      sections.push({
        label: span.label,
        count: span.count,
        colTiles,
        height,
        offsetY: startY,
      });
      cursorY = startY + height + GAP * 2;
    }
    return { sections, totalHeight: cursorY };
  }, [viewMode, allFiles, effectiveWidth, targetColumnWidth, groupSpans, showGroups]);

  // ── Grid packing (uniform square tiles, row-range virtualization) ──
  const grid = useMemo(() => {
    if (viewMode !== "grid") return null;
    if (!allFiles.length || effectiveWidth === 0) {
      return { sections: [] as GridSection[], totalHeight: 0 };
    }
    const colW = Math.max(120, targetColumnWidth);
    const cols = Math.max(1, Math.floor(effectiveWidth / colW));
    const colWidth = Math.max(
      1,
      Math.floor((effectiveWidth - (cols - 1) * GAP) / cols),
    );

    const sections: GridSection[] = [];
    let cursorY = 0;
    for (const span of groupSpans) {
      const startY = cursorY;
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      const rows = Math.ceil(span.count / cols);
      const height = headerOffset + rows * (GRID_TILE_H + GAP);
      sections.push({
        label: span.label,
        count: span.count,
        start: span.start,
        cols,
        colWidth,
        rows,
        height,
        offsetY: startY,
      });
      cursorY = startY + height + GAP * 2;
    }
    return { sections, totalHeight: cursorY };
  }, [viewMode, allFiles, effectiveWidth, targetColumnWidth, groupSpans, showGroups]);

  // ── List packing (uniform rows, row-range virtualization) ──────────
  const list = useMemo(() => {
    if (viewMode !== "list") return null;
    if (!allFiles.length) {
      return { sections: [] as ListSection[], totalHeight: 0 };
    }
    const sections: ListSection[] = [];
    let cursorY = 0;
    for (const span of groupSpans) {
      const startY = cursorY;
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      const height = headerOffset + span.count * LIST_ROW_H;
      sections.push({
        label: span.label,
        count: span.count,
        start: span.start,
        height,
        offsetY: startY,
      });
      cursorY = startY + height + GAP * 2;
    }
    return { sections, totalHeight: cursorY };
  }, [viewMode, allFiles, groupSpans, showGroups]);

  // ── Empty state ───────────────────────────────────────────────────
  if (!allFiles.length) {
    return (
      <div className="w-full h-full min-h-[200px] flex items-center justify-center text-nerv-muted font-mono text-xs">
        <p>[ NO MEDIA TARGETS DETECTED ]</p>
      </div>
    );
  }

  const gridContent = viewMode === "list" ? (
    <ListView
      sections={list!.sections}
      allFiles={allFiles}
      scrollTop={scrollTop}
      viewportHeight={viewportHeight}
      showGroups={showGroups}
      selectedIds={selectedIds}
      favorites={favorites}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      onToggleFavorite={onToggleFavorite}
      onContextMenu={onContextMenu}
      onInspect={onInspect}
      reloadEpoch={reloadEpoch}
    />
  ) : viewMode === "grid" ? (
    <GridView
      sections={grid!.sections}
      allFiles={allFiles}
      scrollTop={scrollTop}
      viewportHeight={viewportHeight}
      showGroups={showGroups}
      selectedIds={selectedIds}
      favorites={favorites}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      onToggleFavorite={onToggleFavorite}
      onContextMenu={onContextMenu}
      onInspect={onInspect}
      reloadEpoch={reloadEpoch}
      fileTagGetter={fileTagGetter}
      onDimensions={reportDimensions}
    />
  ) : (
    <MasonryView
      sections={masonry!.sections}
      totalHeight={masonry!.totalHeight}
      scrollTop={scrollTop}
      viewportHeight={viewportHeight}
      showGroups={showGroups}
      selectedIds={selectedIds}
      favorites={favorites}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      onToggleFavorite={onToggleFavorite}
      onContextMenu={onContextMenu}
      onInspect={onInspect}
      reloadEpoch={reloadEpoch}
      fileTagGetter={fileTagGetter}
      onDimensions={reportDimensions}
    />
  );

  // Split view: grid scrolls independently on the left; inspector is a
  // pinned right column with its own scroll and a divider border.
  if (viewMode === "split") {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-nerv-bg p-4"
        >
          {gridContent}
        </div>
        <aside className="w-80 shrink-0 border-l border-nerv-border bg-nerv-panel overflow-y-auto overflow-x-hidden flex flex-col">
          <InspectorCard
            file={activeInspectFile}
            onOpen={onOpen}
            allFiles={allFiles}
            onNavigate={onInspect}
            onClose={onCloseInspector}
            onMove={onMove}
            onRename={onRename}
            onTrash={onTrash}
            tags={tags}
            fileTags={activeInspectFile && fileTagGetter ? fileTagGetter(activeInspectFile.filePath) : undefined}
            onToggleFileTag={onToggleFileTag}
          />
        </aside>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="w-full h-full overflow-y-auto overflow-x-hidden bg-nerv-bg p-4"
    >
      {gridContent}
    </div>
  );
};

export default MasonryGrid;

// ── Masonry / Split view ────────────────────────────────────────────

interface MasonryViewProps {
  sections: Section[];
  totalHeight: number;
  scrollTop: number;
  viewportHeight: number;
  showGroups: boolean;
  selectedIds: Set<string>;
  favorites: Set<string>;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onInspect: (file: MediaFile) => void;
  reloadEpoch: number;
  /** Tag system props — v2.5 */
  fileTagGetter?: (filePath: string) => TagDef[];
  /** Report decoded thumbnail dimensions for the on-disk cache. */
  onDimensions?: (filePath: string, width: number, height: number) => void;
}

const MasonryView = memo(function MasonryView({
  sections,
  totalHeight,
  scrollTop,
  viewportHeight,
  onOpen,
  showGroups,
  selectedIds,
  favorites,
  onToggleSelect,
  onToggleFavorite,
  onContextMenu,
  onInspect,
  reloadEpoch,
  fileTagGetter,
  onDimensions,
}: MasonryViewProps) {
  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + viewportHeight + OVERSCAN;

  // Visible headers.
  const visibleHeaders = useMemo(() => {
    if (!showGroups) return [] as Array<{ label: string; count: number; y: number }>;
    const out: Array<{ label: string; count: number; y: number }> = [];
    for (const s of sections) {
      if (s.offsetY >= top && s.offsetY <= bottom) {
        out.push({ label: s.label!, count: s.count, y: s.offsetY });
      }
    }
    return out;
  }, [sections, top, bottom, showGroups]);

  // Visible tiles — O(visible), not O(all). Each column is Y-sorted at
  // pack time, so we binary-search the first tile overlapping the top of
  // the window and walk forward until the bottom edge passes.
  const visibleTiles = useMemo(() => {
    const out: Array<{ tile: PlacedTile; y: number }> = [];
    for (const s of sections) {
      const sTop = top - s.offsetY;
      const sBottom = bottom - s.offsetY;
      for (const col of s.colTiles) {
        let lo = 0;
        let hi = col.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (col[mid].y + col[mid].height < sTop) lo = mid + 1;
          else hi = mid;
        }
        for (let i = lo; i < col.length; i++) {
          const tile = col[i];
          if (tile.y > sBottom) break;
          out.push({ tile, y: s.offsetY + tile.y });
        }
      }
    }
    return out;
  }, [sections, top, bottom]);

  return (
    <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
      {visibleHeaders.map((h) => (
        <div
          key={`hdr-${h.label}`}
          className="absolute left-0 w-full"
          style={{ top: `${h.y}px`, height: `${HEADER_HEIGHT}px` }}
        >
          <GroupLabel label={h.label} count={h.count} />
        </div>
      ))}
      {visibleTiles.map(({ tile, y }) => (
        <div
          key={tile.file.filePath}
          className="absolute"
          style={{
            left: `${tile.x}px`,
            top: `${y}px`,
            width: `${tile.width}px`,
            height: `${tile.height}px`,
          }}
        >
          <MediaCard
            file={tile.file}
            aspectRatio={tile.width / tile.height}
            selected={selectedIds.has(tile.file.filePath)}
            favorite={favorites.has(tile.file.filePath)}
            tileWidth={tile.width}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onContextMenu={onContextMenu}
            reloadEpoch={reloadEpoch}
            onInspect={onInspect}
            fileTags={fileTagGetter?.(tile.file.filePath)}
            onDimensions={onDimensions}
          />
        </div>
      ))}
    </div>
  );
});

// ── Grid view ───────────────────────────────────────────────────────

interface GridSection {
  label: string;
  count: number;
  start: number;
  cols: number;
  colWidth: number;
  rows: number;
  height: number;
  offsetY: number;
}

interface GridViewProps {
  sections: GridSection[];
  allFiles: MediaFile[];
  scrollTop: number;
  viewportHeight: number;
  showGroups: boolean;
  selectedIds: Set<string>;
  favorites: Set<string>;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  reloadEpoch: number;
  fileTagGetter?: (filePath: string) => TagDef[];
  /** Report decoded thumbnail dimensions for the on-disk cache. */
  onDimensions?: (filePath: string, width: number, height: number) => void;
}

const GridView = memo(function GridView({
  sections,
  allFiles,
  scrollTop,
  viewportHeight,
  showGroups,
  selectedIds,
  favorites,
  onToggleSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
  reloadEpoch,
  fileTagGetter,
  onInspect,
  onDimensions,
}: GridViewProps) {
  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + viewportHeight + OVERSCAN;

  // Visible headers + per-section visible row windows.
  const visible = useMemo(() => {
    const headers: Array<{ label: string; count: number; y: number }> = [];
    const rows: Array<{
      section: GridSection;
      rowIdx: number;
      y: number;
      files: MediaFile[];
    }> = [];
    for (const section of sections) {
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      if (showGroups && section.offsetY >= top && section.offsetY <= bottom) {
        headers.push({
          label: section.label,
          count: section.count,
          y: section.offsetY,
        });
      }
      const rowsStartY = section.offsetY + headerOffset;
      // Rows are uniform height — compute the visible row window directly
      // instead of iterating every row in the section (O(visible rows)).
      const firstRow = Math.max(
        0,
        Math.ceil((top - rowsStartY - GRID_TILE_H) / (GRID_TILE_H + GAP)),
      );
      const lastRow = Math.min(
        section.rows - 1,
        Math.floor((bottom - rowsStartY) / (GRID_TILE_H + GAP)),
      );
      for (let r = firstRow; r <= lastRow; r++) {
        const rowY = rowsStartY + r * (GRID_TILE_H + GAP);
        const startFileIdx = section.start + r * section.cols;
        const endFileIdx = Math.min(
          section.start + section.count,
          startFileIdx + section.cols,
        );
        rows.push({
          section,
          rowIdx: r,
          y: rowY,
          files: allFiles.slice(startFileIdx, endFileIdx),
        });
      }
    }
    return { headers, rows };
  }, [sections, allFiles, top, bottom, showGroups]);

  const totalHeight =
    sections.length > 0
      ? sections[sections.length - 1].offsetY + sections[sections.length - 1].height
      : 0;

  return (
    <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
      {visible.headers.map((h) => (
        <div
          key={`hdr-${h.label}`}
          className="absolute left-0 w-full"
          style={{ top: `${h.y}px`, height: `${HEADER_HEIGHT + GAP}px` }}
        >
          <GroupLabel label={h.label} count={h.count} />
        </div>
      ))}
      {visible.rows.map(({ section, rowIdx, y, files }) => (
        <div
          key={`${section.label}-${rowIdx}`}
          className="absolute flex"
          style={{
            top: `${y}px`,
            left: `${PADDING}px`,
            width: `${(section.colWidth + GAP) * section.cols - GAP}px`,
            gap: `${GAP}px`,
          }}
        >
          {files.map((file) => (
            <div key={file.filePath} style={{ width: `${section.colWidth}px`, height: `${GRID_TILE_H}px` }}>
              <MediaCard
                file={file}
                aspectRatio={1}
                selected={selectedIds.has(file.filePath)}
                favorite={favorites.has(file.filePath)}
                tileWidth={section.colWidth}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
                onToggleFavorite={onToggleFavorite}
                onContextMenu={onContextMenu}
                reloadEpoch={reloadEpoch}
                onInspect={onInspect}
                fileTags={fileTagGetter?.(file.filePath)}
                onDimensions={onDimensions}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});


// ── List view ───────────────────────────────────────────────────────

interface ListSection {
  label: string;
  count: number;
  start: number;
  height: number;
  offsetY: number;
}

interface ListViewProps {
  sections: ListSection[];
  allFiles: MediaFile[];
  scrollTop: number;
  viewportHeight: number;
  showGroups: boolean;
  selectedIds: Set<string>;
  favorites: Set<string>;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  reloadEpoch: number;
}

const ListView = memo(function ListView({
  sections,
  allFiles,
  scrollTop,
  viewportHeight,
  showGroups,
  selectedIds,
  favorites,
  onToggleSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
  onInspect,
  reloadEpoch,
}: ListViewProps) {
  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + viewportHeight + OVERSCAN;

  const visible = useMemo(() => {
    const headers: Array<{ label: string; count: number; y: number }> = [];
    const rows: Array<{ file: MediaFile; y: number }> = [];
    for (const section of sections) {
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      if (showGroups && section.offsetY >= top && section.offsetY <= bottom) {
        headers.push({ label: section.label, count: section.count, y: section.offsetY });
      }
      const rowsStartY = section.offsetY + headerOffset;
      // Uniform rows — arithmetic window instead of scanning all rows.
      const firstRow = Math.max(
        0,
        Math.ceil((top - rowsStartY - LIST_ROW_H) / LIST_ROW_H),
      );
      const lastRow = Math.min(
        section.count - 1,
        Math.floor((bottom - rowsStartY) / LIST_ROW_H),
      );
      for (let r = firstRow; r <= lastRow; r++) {
        const rowY = rowsStartY + r * LIST_ROW_H;
        rows.push({ file: allFiles[section.start + r], y: rowY });
      }
    }
    return { headers, rows };
  }, [sections, allFiles, top, bottom, showGroups]);

  const totalHeight =
    sections.length > 0
      ? sections[sections.length - 1].offsetY + sections[sections.length - 1].height
      : 0;

  return (
    <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
      {/* Sticky-ish column header at the top of the scroll area */}
      <div
        className="absolute left-0 right-0 z-10 flex items-center bg-nerv-panel text-nerv-muted text-[10px] font-mono font-normal border-b border-nerv-border"
        style={{ top: 0, height: `${HEADER_HEIGHT}px`, paddingLeft: `${PADDING}px`, paddingRight: `${PADDING}px` }}
      >
        <span className="w-8" />
        <span className="w-12">PREV</span>
        <span className="w-16">PLATE</span>
        <span className="flex-1">FILE NAME</span>
        <span className="w-12">TYPE</span>
        <span className="w-24">DIMENSIONS</span>
        <span className="w-20">SIZE</span>
        <span className="w-28">DATE</span>
        <span className="w-20 text-right">ACTIONS</span>
      </div>

      {/* Group headers — positioned at each section's offsetY */}
      {visible.headers.map((h) => (
        <div
          key={`hdr-${h.label}`}
          className="absolute left-0 w-full"
          style={{ top: `${h.y}px`, height: `${HEADER_HEIGHT + GAP}px` }}
        >
          <GroupLabel label={h.label} count={h.count} />
        </div>
      ))}

      {/* Visible rows — absolutely positioned so scrolling never jumps */}
      {visible.rows.map(({ file, y }) => {
        const selected = selectedIds.has(file.filePath);
        const favorite = favorites.has(file.filePath);
        const isVideo = file.fileType === "video";
        return (
          <div
            key={file.filePath}
            onClick={() => onInspect(file)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => onContextMenu(file, e)}
            draggable
            onDragStart={(e) => {
              if (!selected) onToggleSelect(file.filePath, e);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", file.filePath);
            }}
            className={[
              "absolute left-0 flex items-center border-t border-nerv-border transition-colors cursor-pointer",
              selected ? "bg-nerv-orange/10" : "hover:bg-nerv-panel-2/80",
            ].join(" ")}
            style={{
              top: `${y}px`,
              height: `${LIST_ROW_H}px`,
              paddingLeft: `${PADDING}px`,
              paddingRight: `${PADDING}px`,
            }}
          >
            <div className="w-8 shrink-0 text-center">
              <input
                type="checkbox"
                checked={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(file.filePath, e);
                }}
                className="accent-nerv-orange w-3.5 h-3.5 cursor-pointer"
              />
            </div>
            <div className="w-12 shrink-0">
              <img
                src={`${tileUrl(file, 40)}${reloadEpoch > 0 ? `&retry=${reloadEpoch}` : ""}`}
                alt=""
                loading="lazy"
                className="w-10 h-10 object-cover border border-nerv-border"
                draggable={false}
              />
            </div>
            <span className="w-16 shrink-0 text-nerv-orange/80 text-[9px] font-mono tracking-wider">
              {plateId(file.filePath)}
            </span>
            <span className="flex-1 min-w-0 text-nerv-text truncate text-xs font-mono">
              {file.fileName}
            </span>
            <span className="w-12 shrink-0 text-center">
              {isVideo ? (
                <span className="tag-chip px-1 py-0.5 bg-nerv-green/20 border border-nerv-green/50 text-nerv-green text-[9px] font-bold">
                  VID
                </span>
              ) : (
                <span className="tag-chip px-1 py-0.5 bg-nerv-cyan/20 border border-nerv-cyan/50 text-nerv-cyan text-[9px] font-bold">
                  IMG
                </span>
              )}
            </span>
            <span className="w-24 shrink-0 text-nerv-muted text-[10px] font-mono tabular-nums">
              {file.width > 0 && file.height > 0 ? `${file.width}x${file.height}` : "\u2014"}
            </span>
            <span className="w-20 shrink-0 text-nerv-amber text-[10px] font-mono tabular-nums">
              {formatBytes(file.sizeBytes)}
            </span>
            <span className="w-28 shrink-0 text-nerv-muted text-[10px] font-mono">
              {formatDate(file.birthtimeMs)}
            </span>
            <span className="w-20 shrink-0 flex items-center justify-end gap-1">
              <button
                type="button"
                aria-label="Toggle favorite"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(file);
                }}
                className={[
                  "w-5 h-5 flex items-center justify-center text-[12px] leading-none transition-colors",
                  favorite ? "text-nerv-amber" : "text-nerv-muted hover:text-nerv-amber",
                ].join(" ")}
              >
                {"\u2605"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(file);
                }}
                className="px-1.5 py-0.5 border border-nerv-orange/50 text-nerv-orange text-[9px] font-bold hover:bg-nerv-orange/10 transition-colors"
              >
                OPEN
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
});

// ── Split inspector card ────────────────────────────────────────────
/** Inline tag manager for the Inspector dock — shows assigned tags as pills
 *  and an expandable grid to toggle all available tags (v2.5 §Module 6.4). */
function InspectorTagManager({
  tags,
  fileTags,
  filePath,
  onToggleFileTag,
}: {
  tags: TagDef[];
  fileTags: TagDef[];
  filePath: string;
  onToggleFileTag: (filePath: string, tagKey: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const assignedKeys = useMemo(() => new Set(fileTags.map((t) => t.key)), [fileTags]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold tracking-[0.2em] text-nerv-muted uppercase">
          Tags
        </span>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="text-[8px] font-mono tracking-wider text-nerv-orange/80 hover:text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 hover:bg-nerv-orange/10"
        >
          {editing ? "DONE" : "EDIT TAGS"}
        </button>
      </div>

      {/* Assigned tag pills */}
      {fileTags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {fileTags.map((tag) => (
            <span
              key={tag.key}
              className="tag-chip px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider"
              style={{
                color: tag.color,
                backgroundColor: tag.bg,
                border: `1px solid ${tag.border}`,
              }}
            >
              {tag.label}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[9px] font-mono text-nerv-muted">No tags assigned</span>
      )}

      {/* Editable tag grid */}
      {editing && (
        <div className="flex flex-wrap gap-1 mt-1 p-2 bg-nerv-bg border border-nerv-border">
          {tags.map((tag) => {
            const assigned = assignedKeys.has(tag.key);
            return (
              <button
                key={tag.key}
                type="button"
                onClick={() => onToggleFileTag(filePath, tag.key)}
                className="tag-chip px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider transition-all"
                style={{
                  color: assigned ? tag.color : "#6a6a65",
                  backgroundColor: assigned ? tag.bg : "transparent",
                  border: `1px solid ${assigned ? tag.border : "#2e2e34"}`,
                }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


interface InspectorCardProps {
  file: MediaFile | null;
  onOpen: (file: MediaFile) => void;
  /** Flat file list for index/total + prev/next navigation. */
  allFiles: MediaFile[];
  /** Select a file for inspection (nav arrows). */
  onNavigate?: (file: MediaFile) => void;
  /** Close the inspector (× button). */
  onClose?: () => void;
  /** Toolbar actions. */
  onMove?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onTrash?: (file: MediaFile) => void;
  /** Tag system props — v2.5 §Module 6.4 */
  tags?: TagDef[];
  fileTags?: TagDef[];
  onToggleFileTag?: (filePath: string, tagKey: string) => void;
}

const InspectorCard = memo(function InspectorCard({
  file,
  onOpen,
  allFiles,
  onNavigate,
  onClose,
  onMove,
  onRename,
  onTrash,
  tags,
  fileTags,
  onToggleFileTag,
}: InspectorCardProps) {
  type Insights = {
    hash: string;
    colors: Array<{ r: number; g: number; b: number; hex: string }>;
    camera: { make?: string; model?: string; lens?: string; fNumber?: number; iso?: number; exposure?: string };
  };
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);

  // Derive position in the flat list for the nav bar (e.g. "3 / 2400").
  const index = file ? allFiles.findIndex((f) => f.filePath === file.filePath) : -1;
  const total = allFiles.length;
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < total - 1;

  const goPrev = () => { if (hasPrev && onNavigate) onNavigate(allFiles[index - 1]); };
  const goNext = () => { if (hasNext && onNavigate) onNavigate(allFiles[index + 1]); };

  // Fetch hash + colors + EXIF when file changes.
  useEffect(() => {
    setInsights(null);
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    void window.scanAPI.getFileInsights(file.filePath).then((data) => {
      if (!cancelled) { setInsights(data); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [file]);

  const hash = insights?.hash ?? "";

  return (
    <div className="w-full flex flex-col font-mono text-xs">
      {/* A. Top navigation bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nerv-border">
        <span className="text-nerv-muted text-[10px] tabular-nums">
          {file && index >= 0 ? `${index + 1} / ${total}` : "\u2014 / \u2014"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={!hasPrev}
            title="Previous"
            aria-label="Previous"
            className="w-6 h-6 flex items-center justify-center text-nerv-text-dim hover:text-nerv-amber disabled:opacity-30 disabled:hover:text-nerv-text-dim transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!hasNext}
            title="Next"
            aria-label="Next"
            className="w-6 h-6 flex items-center justify-center text-nerv-text-dim hover:text-nerv-amber disabled:opacity-30 disabled:hover:text-nerv-text-dim transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close inspector"
              aria-label="Close inspector"
              className="w-6 h-6 flex items-center justify-center text-nerv-text-dim hover:text-nerv-red transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {file ? (
        <div className="flex flex-col gap-3 p-3">
          {/* B. Media preview card */}
          <div className="aspect-video w-full bg-nerv-bg overflow-hidden border border-nerv-border flex items-center justify-center relative">
            <img
              src={window.scanAPI.toMediaUrl(file.filePath)}
              alt={file.fileName}
              loading="lazy"
              className="w-full h-full object-contain"
              draggable={false}
            />
            {/* Overlaid badges (top-left) */}
            <div className="absolute top-1.5 left-1.5 flex gap-1">
              <span className="tag-chip eva-cut bg-nerv-orange text-black text-[8px] font-bold tracking-wider px-1.5 py-0.5">
                {plateId(file.filePath)}
              </span>
              {file.fileType === "video" ? (
                <span className="tag-chip eva-cut bg-nerv-green text-black text-[8px] font-bold tracking-wider px-1.5 py-0.5">VID</span>
              ) : (
                <span className="tag-chip eva-cut bg-nerv-cyan text-black text-[8px] font-bold tracking-wider px-1.5 py-0.5">IMG</span>
              )}
            </div>
          </div>

          {/* C. File title + directory path */}
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-nerv-text font-bold break-all leading-tight">
                {file.fileName}
              </span>
              <button
                type="button"
                onClick={() => onOpen(file)}
                title="Open in lightbox"
                aria-label="Open in lightbox"
                className="shrink-0 text-nerv-muted hover:text-nerv-amber transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
              </button>
            </div>
            <span className="flex items-center gap-1 text-nerv-muted text-[10px]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-nerv-orange/70 shrink-0"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" /><rect x="3" y="9" width="18" height="11" /></svg>
              <span className="truncate">{dirName(file.filePath)}</span>
            </span>
          </div>

          {/* D. Tags section */}
          {tags && onToggleFileTag && (
            <InspectorTagManager
              tags={tags}
              fileTags={fileTags ?? []}
              filePath={file.filePath}
              onToggleFileTag={onToggleFileTag}
            />
          )}

          {/* E. Action toolbar */}
          {(onMove || onRename || onTrash) && (
            <div className="grid grid-cols-3 border border-nerv-border">
              {onMove && (
                <button
                  type="button"
                  onClick={() => onMove(file)}
                  title="Move"
                  className="flex flex-col items-center gap-1 py-2 text-nerv-text-dim hover:text-nerv-lime hover:bg-nerv-lime/5 transition-colors border-r border-nerv-border"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8h12M11 4l4 4-4 4M21 4v16" /></svg>
                  <span className="text-[8px] font-bold tracking-wider">MOVE</span>
                </button>
              )}
              {onRename && (
                <button
                  type="button"
                  onClick={() => onRename(file)}
                  title="Rename"
                  className="flex flex-col items-center gap-1 py-2 text-nerv-text-dim hover:text-nerv-amber hover:bg-nerv-amber/5 transition-colors border-r border-nerv-border"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  <span className="text-[8px] font-bold tracking-wider">RENAME</span>
                </button>
              )}
              {onTrash && (
                <button
                  type="button"
                  onClick={() => onTrash(file)}
                  title="Trash"
                  className="flex flex-col items-center gap-1 py-2 text-nerv-text-dim hover:text-nerv-red hover:bg-nerv-red/5 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
                  <span className="text-[8px] font-bold tracking-wider">TRASH</span>
                </button>
              )}
            </div>
          )}

          {/* F. Metadata key-value list */}
          <div className="flex flex-col">
            <StatRow label="Resolution" value={file.width > 0 && file.height > 0 ? `${file.width}x${file.height}` : "\u2014"} />
            <StatRow label="Size" value={formatBytes(file.sizeBytes)} valueClass="text-nerv-cyan" />
            <StatRow label="Aspect" value={file.width > 0 && file.height > 0 ? aspectRatio(file.width, file.height) : "\u2014"} />
            <StatRow label="Megapixels" value={file.width > 0 && file.height > 0 ? `${((file.width * file.height) / 1e6).toFixed(1)} MP` : "\u2014"} />
            <StatRow label="Created" value={formatDate(file.birthtimeMs)} />
          </div>

          {/* G. Color spectrum — dominant colors + gradient bar */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-bold tracking-[0.2em] text-nerv-muted uppercase">Color Spectrum</span>
            {loading && !insights ? (
              <div className="h-8 bg-nerv-bg border border-nerv-border animate-pulse" />
            ) : insights && insights.colors.length > 0 ? (
              <>
                {/* Gradient spectrum bar built from extracted swatches */}
                <div
                  className="h-6 w-full border border-nerv-border"
                  style={{
                    background: `linear-gradient(90deg, ${insights.colors.map((c) => c.hex).join(", ")})`,
                  }}
                />
                {/* Individual swatch chips */}
                <div className="flex gap-1">
                  {insights.colors.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void window.scanAPI.writeClipboard(c.hex)}
                      title={`Copy ${c.hex}`}
                      className="flex-1 group/swatch flex flex-col items-center gap-0.5"
                    >
                      <span
                        className="w-full h-8 border border-nerv-border group-hover/swatch:border-nerv-amber transition-colors"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="text-[8px] text-nerv-muted group-hover/swatch:text-nerv-amber transition-colors uppercase">{c.hex}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-8 flex items-center justify-center text-[9px] text-nerv-muted border border-nerv-border bg-nerv-bg">
                No color data
              </div>
            )}
          </div>

          {/* H. Camera info (EXIF) */}
          <div className="flex flex-col">
            <span className="text-[9px] font-bold tracking-[0.2em] text-nerv-muted uppercase mb-1">Camera</span>
            <StatRow label="Make" value={insights?.camera.make || "\u2014"} />
            <StatRow label="Model" value={insights?.camera.model || "\u2014"} />
            <StatRow label="Lens" value={insights?.camera.lens || "\u2014"} />
            <StatRow label="Aperture" value={insights?.camera.fNumber ? `f/${insights.camera.fNumber}` : "\u2014"} />
            <StatRow label="ISO" value={insights?.camera.iso != null ? String(insights.camera.iso) : "\u2014"} />
            <StatRow label="Exposure" value={insights?.camera.exposure ? `${insights.camera.exposure}s` : "\u2014"} />
          </div>

          {/* G. Hash section */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold tracking-[0.2em] text-nerv-muted uppercase">Hash</span>
              {hash && (
                <button
                  type="button"
                  onClick={() => void window.scanAPI.writeClipboard(hash)}
                  title="Copy hash"
                  className="flex items-center gap-1 text-[9px] text-nerv-muted hover:text-nerv-amber transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="1" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                  COPY
                </button>
              )}
            </div>
            <div className="bg-nerv-bg border border-nerv-border px-2 py-1.5 text-nerv-text-dim text-[10px] break-all">
              {hash || "\u2014"}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-nerv-muted text-center py-12">
          Select a media item to inspect.
        </div>
      )}
    </div>
  );
});

/** Key-value metadata row — label left (muted), value right (bright). */
const StatRow = memo(function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-nerv-border/40 last:border-b-0">
      <span className="text-nerv-muted text-[10px]">{label}</span>
      <span className={`text-nerv-text text-[10px] truncate ml-2 ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
});

/** Derive the parent directory name from a full path. */
function dirName(filePath: string): string {
  const sep = filePath.includes("/") ? "/" : "\\";
  const parts = filePath.split(sep).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? filePath;
}

/** Format WxH as a simplified aspect ratio (e.g. "3:2", "16:9"). */
function aspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
