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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GroupMode, MediaFile, ViewMode } from "../types";
import { formatBytes, formatDate } from "../utils";

// ── Layout constants ─────────────────────────────────────────────────
/** Header bar height (group label row) in px. */
const HEADER_HEIGHT = 32;
/** Tile gap in px. */
const GAP = 10;
/** Scroll padding in px. */
const PADDING = 16;
/** Overscan band (px above + below the viewport) mounted for smooth scroll. */
const OVERSCAN = 600;
/** Width reserved for the inspector in split mode (px). */
const SPLIT_INSPECTOR_W = 320;
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
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  activeInspectFile: MediaFile | null;
}

/** Build a media URL for a tile, requesting a sharp thumbnail for images. */
function tileUrl(file: MediaFile, tileWidth: number): string {
  const base = window.scanAPI.toMediaUrl(file.filePath);
  if (file.fileType === "video") return base;
  const w = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(tileWidth * 1.5)));
  return `${base}?w=${w}`;
}

// ── MediaCard (memoized grid/masonry tile) ──────────────────────────

interface MediaCardProps {
  file: MediaFile;
  /** Natural aspect ratio (width/height) for masonry; 1 for grid. */
  aspectRatio: number;
  selected: boolean;
  favorite: boolean;
  tileWidth: number;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
}

/** Memoized grid tile. Parent passes stable callbacks so the card only
 * re-renders when `file`, `selected`, or `favorite` change. */
const MediaCard = memo(function MediaCard({
  file,
  aspectRatio,
  selected,
  favorite,
  tileWidth,
  onToggleSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
  onInspect,
}: MediaCardProps) {
  const [loaded, setLoaded] = useState(false);
  const isVideo = file.fileType === "video";
  const url = useMemo(
    () => tileUrl(file, tileWidth),
    [file, tileWidth],
  );

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
      className={[
        "group relative rounded border overflow-hidden transition-all duration-200 cursor-pointer bg-nerv-panel select-none",
        selected
          ? "border-nerv-orange ring-2 ring-nerv-orange/50 shadow-[0_0_15px_rgba(255,85,0,0.3)]"
          : "border-nerv-border hover:border-nerv-orange/70 hover:shadow-lg",
      ].join(" ")}
      style={{ aspectRatio: String(aspectRatio) }}
      title={file.fileName}
    >
      {/* Shimmer skeleton until the image decodes. */}
      {!loaded && (
        <div className="shimmer absolute inset-0" aria-hidden="true" />
      )}

      <img
        src={url}
        alt={file.fileName}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={[
          "w-full h-full object-cover transition-all duration-300 group-hover:scale-105",
          loaded ? "opacity-100" : "opacity-0",
        ].join(" ")}
        draggable={false}
      />

      {/* Top action overlay (revealed on hover). */}
      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
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
            "pointer-events-auto w-6 h-6 rounded-full flex items-center justify-center text-[13px] leading-none transition-colors",
            favorite
              ? "bg-nerv-amber/90 text-nerv-bg"
              : "bg-black/40 text-white/80 hover:text-nerv-amber",
          ].join(" ")}
        >
          {"\u2605"}
        </button>
      </div>

      {/* Type badge (bottom-right). */}
      <div className="absolute bottom-1.5 right-1.5 pointer-events-none">
        {isVideo ? (
          <span className="px-1.5 py-0.5 rounded bg-nerv-green/20 border border-nerv-green/50 text-nerv-green text-[9px] font-mono font-bold tracking-wider">
            VID
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded bg-nerv-cyan/20 border border-nerv-cyan/50 text-nerv-cyan text-[9px] font-mono font-bold tracking-wider">
            IMG
          </span>
        )}
      </div>

      {/* Center play circle for videos. */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-9 h-9 rounded-full bg-nerv-green/30 border border-nerv-green/70 flex items-center justify-center backdrop-blur-sm">
            <svg
              className="w-4 h-4 text-nerv-green"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Bottom info gradient (revealed on hover). */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
        <p className="text-white text-[11px] font-bold truncate font-mono">
          {file.fileName}
        </p>
        <p className="text-nerv-amber text-[10px] font-mono">
          {file.width > 0 && file.height > 0
            ? `${file.width}x${file.height}`
            : "\u2014"}
          {" \u00b7 "}
          {formatBytes(file.sizeBytes)}
        </p>
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

/** One masonry section = optional group header + its packed tiles. */
interface Section {
  label?: string;
  count: number;
  tiles: PlacedTile[];
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
  onToggleFavorite,
  onContextMenu,
  onInspect,
  activeInspectFile,
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
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      setScrollTop(el.scrollTop);
    });
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

  // Effective container width for column math (split reserves the inspector).
  const effectiveWidth = useMemo(() => {
    const base = containerWidth - PADDING * 2;
    if (viewMode === "split") return Math.max(0, base - SPLIT_INSPECTOR_W);
    return Math.max(0, base);
  }, [containerWidth, viewMode]);


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
      const tiles: PlacedTile[] = [];
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
        tiles.push({
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
        tiles,
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

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="w-full h-full overflow-y-auto overflow-x-hidden bg-nerv-bg p-4"
    >
      {viewMode === "list" ? (
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
          split={viewMode === "split"}
          activeInspectFile={activeInspectFile}
          onOpenInspect={onOpen}
        />
      )}
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
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  split: boolean;
  activeInspectFile: MediaFile | null;
  onOpenInspect: (file: MediaFile) => void;
}

const MasonryView = memo(function MasonryView({
  sections,
  totalHeight,
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
  split,
  activeInspectFile,
  onOpenInspect,
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

  // Visible tiles.
  const visibleTiles = useMemo(() => {
    const out: Array<{ tile: PlacedTile; y: number }> = [];
    for (const s of sections) {
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      for (const tile of s.tiles) {
        const absY = s.offsetY + headerOffset + tile.y - headerOffset;
        if (absY + tile.height >= top && absY <= bottom) {
          out.push({ tile, y: absY });
        }
      }
    }
    return out;
  }, [sections, top, bottom, showGroups]);

  const inspector = split ? (
    <InspectorCard file={activeInspectFile} onOpen={onOpenInspect} />
  ) : null;

  return (
    <div className={split ? "flex gap-4" : "block"}>
      <div
        className="relative w-full"
        style={{ height: `${totalHeight}px` }}
      >
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
              onInspect={onInspect}
            />
          </div>
        ))}
      </div>
      {inspector}
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
  onInspect,
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
      for (let r = 0; r < section.rows; r++) {
        const rowY = rowsStartY + r * (GRID_TILE_H + GAP);
        if (rowY + GRID_TILE_H >= top && rowY <= bottom) {
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
    }
    return { headers, rows };
  }, [sections, allFiles, top, bottom, showGroups]);

  return (
    <div className="relative w-full">
      {visible.headers.map((h) => (
        <div key={`hdr-${h.label}`} style={{ height: HEADER_HEIGHT + GAP }}>
          <GroupLabel label={h.label} count={h.count} />
        </div>
      ))}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${sections[0]?.cols ?? 1}, minmax(0, 1fr))`,
        }}
      >
        {visible.rows.map(({ section, rowIdx, files }) => (
          <FragmentRow
            key={`${section.label}-${rowIdx}`}
            files={files}
            selectedIds={selectedIds}
            favorites={favorites}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onContextMenu={onContextMenu}
            onInspect={onInspect}
            colWidth={section.colWidth}
          />
        ))}
      </div>
    </div>
  );
});

/** Renders one grid row's worth of tiles as a fragment of MediaCards. */
const FragmentRow = memo(function FragmentRow({
  files,
  selectedIds,
  favorites,
  onToggleSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
  onInspect,
  colWidth,
}: {
  files: MediaFile[];
  selectedIds: Set<string>;
  favorites: Set<string>;
  onToggleSelect: (filePath: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect: (file: MediaFile) => void;
  colWidth: number;
}) {
  return (
    <>
      {files.map((file) => (
        <MediaCard
          key={file.filePath}
          file={file}
          aspectRatio={1}
          selected={selectedIds.has(file.filePath)}
          favorite={favorites.has(file.filePath)}
          tileWidth={colWidth}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
          onContextMenu={onContextMenu}
          onInspect={onInspect}
        />
      ))}
    </>
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
}: ListViewProps) {
  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + viewportHeight + OVERSCAN;

  const visible = useMemo(() => {
    const headers: Array<{ label: string; count: number }> = [];
    const rows: Array<{ file: MediaFile; y: number }> = [];
    for (const section of sections) {
      const headerOffset = showGroups ? HEADER_HEIGHT + GAP : 0;
      if (showGroups) headers.push({ label: section.label, count: section.count });
      const rowsStartY = section.offsetY + headerOffset;
      for (let r = 0; r < section.count; r++) {
        const rowY = rowsStartY + r * LIST_ROW_H;
        if (rowY + LIST_ROW_H >= top && rowY <= bottom) {
          rows.push({ file: allFiles[section.start + r], y: rowY });
        }
      }
    }
    return { headers, rows };
  }, [sections, allFiles, top, bottom, showGroups]);

  return (
    <div className="flex flex-col gap-3">
      {showGroups &&
        visible.headers.map((h) => (
          <GroupLabel key={`hdr-${h.label}`} label={h.label} count={h.count} />
        ))}
      <div className="border border-nerv-border rounded overflow-hidden">
        <table className="w-full border-collapse text-xs font-mono">
          <thead>
            <tr className="bg-nerv-panel text-nerv-muted text-left">
              <th className="w-8 px-2 py-1.5 font-normal">
                <span className="sr-only">Select</span>
              </th>
              <th className="w-12 px-2 py-1.5 font-normal">Preview</th>
              <th className="px-2 py-1.5 font-normal">File Name</th>
              <th className="px-2 py-1.5 font-normal">Type</th>
              <th className="px-2 py-1.5 font-normal">Dimensions</th>
              <th className="px-2 py-1.5 font-normal">Size</th>
              <th className="px-2 py-1.5 font-normal">Date</th>
              <th className="px-2 py-1.5 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.rows.map(({ file }) => {
              const selected = selectedIds.has(file.filePath);
              const favorite = favorites.has(file.filePath);
              const isVideo = file.fileType === "video";
              return (
                <tr
                  key={file.filePath}
                  onClick={() => onInspect(file)}
                  onDoubleClick={() => onOpen(file)}
                  onContextMenu={(e) => onContextMenu(file, e)}
                  className={[
                    "border-t border-nerv-border transition-colors cursor-pointer align-middle",
                    selected
                      ? "bg-nerv-orange/10"
                      : "hover:bg-nerv-panel-2/80",
                  ].join(" ")}
                  style={{ height: LIST_ROW_H }}
                >
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(file.filePath, e);
                      }}
                      className="accent-nerv-orange w-3.5 h-3.5 cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <img
                      src={tileUrl(file, 40)}
                      alt=""
                      loading="lazy"
                      className="w-10 h-10 object-cover rounded border border-nerv-border"
                      draggable={false}
                    />
                  </td>
                  <td className="px-2 py-1 text-nerv-text truncate max-w-[280px]">
                    {file.fileName}
                  </td>
                  <td className="px-2 py-1">
                    {isVideo ? (
                      <span className="px-1.5 py-0.5 rounded bg-nerv-green/20 border border-nerv-green/50 text-nerv-green text-[10px] font-bold tracking-wider">
                        VID
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-nerv-cyan/20 border border-nerv-cyan/50 text-nerv-cyan text-[10px] font-bold tracking-wider">
                        IMG
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-nerv-muted">
                    {file.width > 0 && file.height > 0
                      ? `${file.width}x${file.height}`
                      : "\u2014"}
                  </td>
                  <td className="px-2 py-1 text-nerv-amber">
                    {formatBytes(file.sizeBytes)}
                  </td>
                  <td className="px-2 py-1 text-nerv-muted">
                    {formatDate(file.birthtimeMs)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        aria-label="Toggle favorite"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(file);
                        }}
                        className={[
                          "w-6 h-6 rounded-full flex items-center justify-center text-[13px] leading-none transition-colors",
                          favorite
                            ? "text-nerv-amber"
                            : "text-nerv-muted hover:text-nerv-amber",
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
                        className="px-2 py-0.5 rounded border border-nerv-orange/50 text-nerv-orange text-[10px] font-bold hover:bg-nerv-orange/10 transition-colors"
                      >
                        OPEN
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ── Split inspector card ────────────────────────────────────────────

interface InspectorCardProps {
  file: MediaFile | null;
  onOpen: (file: MediaFile) => void;
}

const InspectorCard = memo(function InspectorCard({ file, onOpen }: InspectorCardProps) {
  return (
    <div className="w-80 shrink-0 border border-nerv-border rounded bg-nerv-panel p-4 flex flex-col gap-4 font-mono text-xs h-fit sticky top-0">
      <div className="flex items-center justify-between">
        <span className="text-nerv-orange font-bold tracking-wider">
          MEDIA INSPECTOR
        </span>
        {file && (
          <span
            className={[
              "px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border",
              file.fileType === "video"
                ? "bg-nerv-green/20 border-nerv-green/50 text-nerv-green"
                : "bg-nerv-cyan/20 border-nerv-cyan/50 text-nerv-cyan",
            ].join(" ")}
          >
            {file.fileType === "video" ? "VID" : "IMG"}
          </span>
        )}
      </div>

      {file ? (
        <>
          <div className="aspect-video w-full bg-nerv-bg rounded overflow-hidden border border-nerv-border flex items-center justify-center">
            <img
              src={window.scanAPI.toMediaUrl(file.filePath)}
              alt={file.fileName}
              loading="lazy"
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-nerv-text font-bold break-all">
              {file.fileName}
            </span>
            <span className="text-nerv-muted text-[10px] break-all">
              {file.filePath}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Dimensions" value={file.width > 0 && file.height > 0 ? `${file.width}x${file.height}` : "\u2014"} />
            <Stat
              label="File Size"
              value={formatBytes(file.sizeBytes)}
              valueClass="text-nerv-amber"
            />
            <Stat
              label="Megapixels"
              value={
                file.width > 0 && file.height > 0
                  ? `${((file.width * file.height) / 1e6).toFixed(1)} MP`
                  : "\u2014"
              }
            />
            <Stat label="Date" value={formatDate(file.birthtimeMs)} />
          </div>
          <button
            type="button"
            onClick={() => onOpen(file)}
            className="w-full py-2 bg-nerv-orange text-nerv-bg font-bold rounded hover:bg-nerv-orange/90 transition-colors"
          >
            Launch Full Screen Lightbox
          </button>
        </>
      ) : (
        <div className="text-nerv-muted text-center py-8">
          Select a media item to inspect.
        </div>
      )}
    </div>
  );
});

const Stat = memo(function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-nerv-bg p-2.5 rounded border border-nerv-border text-[11px]">
      <div className="text-nerv-muted text-[9px] uppercase tracking-wider">
        {label}
      </div>
      <div className={valueClass ?? "text-nerv-text"}>{value}</div>
    </div>
  );
});
