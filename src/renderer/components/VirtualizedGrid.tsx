import React, {
  useState,
  useRef,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
import { MediaFile } from "../../scanner/types";
import { Thumbnail } from "./Thumbnail";
import "./VirtualizedGrid.css";

export type GroupHeader = {
  key: string;
  label: string;
  startIndex: number;
};

export interface VirtualizedGridProps {
  files: MediaFile[];
  groupHeaders?: GroupHeader[];
  onThumbnailHover?: () => void;
  onThumbnailClick?: (file: MediaFile, index: number) => void;
  onThumbnailContextMenu?: (file: MediaFile, e: React.MouseEvent) => void;
  /**
   * Reports measured pixel dimensions for a file, fired when its
   * thumbnail <img> finishes decoding. The grid holds these in a live
   * map (rAF-batched) and reflows only when dimensions change.
   */
  onDimensionsMeasured?: (filePath: string, width: number, height: number) => void;
}

/** Fallback aspect ratio for files without known dimensions (videos, errors). */
const FALLBACK_RATIO = 0.75; // portrait-ish, like a phone photo

/** One placed tile within a masonry section. */
interface PlacedTile {
  file: MediaFile;
  /** Absolute index within the flat `files` array (for viewer navigation). */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One section = a group header (optional) + its packed tiles. */
interface Section {
  header?: { key: string; label: string };
  tiles: PlacedTile[];
  /** Total height of this section including header. */
  height: number;
  /** Y offset of this section from the top of the scroll content. */
  offsetY: number;
}

const HEADER_HEIGHT = 32;
const TARGET_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 140;
const GAP = 10;
const PADDING = 16;
const OVERSCAN = 600; // px of tiles to render above/below the viewport

/**
 * Staggered (masonry) media grid.
 *
 * Distributes files across N columns using a greedy shortest-column packer.
 * Each tile keeps its natural aspect ratio (from the scanner's header read),
 * so landscape and portrait photos coexist without cropping or wasted space.
 * Sections are rendered per group; only tiles within the scroll viewport
 * (plus overscan) are mounted.
 */
export const VirtualizedGrid: React.FC<VirtualizedGridProps> = ({
  files,
  groupHeaders,
  onThumbnailHover,
  onThumbnailClick,
  onThumbnailContextMenu,
  onDimensionsMeasured,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafId = useRef<number | null>(null);

  // Live dimension map: filePath → {w,h}. Populated lazily as thumbnails
  // decode. Ref holds the authoritative state; `dimVersion` bumps to
  // trigger memo recompute. rAF-coalesced to absorb bursts of onLoad events
  // (hundreds can fire in a single scroll frame on large libraries).
  const dimsRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const pendingDims = useRef<Map<string, { w: number; h: number }>>(new Map());
  const [dimVersion, setDimVersion] = useState(0);
  const dimsRaf = useRef<number | null>(null);

  // Track container size (rAF-throttled to avoid per-frame re-renders).
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

  // Batch dimension reports across a frame so a burst of onLoad events
  // (e.g. scrolling into a dense band of thumbnails) causes one reflow,
  // not hundreds.
  const handleDimensionsMeasured = useCallback(
    (filePath: string, width: number, height: number) => {
      const current = dimsRef.current.get(filePath);
      if (current && current.w === width && current.h === height) return;
      pendingDims.current.set(filePath, { w: width, h: height });
      if (dimsRaf.current !== null) return;
      dimsRaf.current = requestAnimationFrame(() => {
        dimsRaf.current = null;
        const batch = pendingDims.current;
        pendingDims.current = new Map();
        let changed = false;
        for (const [p, d] of batch) {
          const prev = dimsRef.current.get(p);
          if (!prev || prev.w !== d.w || prev.h !== d.h) {
            dimsRef.current.set(p, d);
            changed = true;
          }
        }
        if (changed) setDimVersion((v) => v + 1);
      });
      onDimensionsMeasured?.(filePath, width, height);
    },
    [onDimensionsMeasured],
  );

  // ── Layout: column count + greedy masonry packing ──────────────
  const { sections, totalHeight } = useMemo(() => {
    if (!files.length || containerWidth === 0) {
      return { sections: [], totalHeight: 0 };
    }

    const availableWidth = containerWidth - PADDING * 2;
    const columnCount = Math.max(
      1,
      Math.floor((availableWidth + GAP) / (TARGET_COLUMN_WIDTH + GAP)),
    );
    const columnWidth = Math.max(
      MIN_COLUMN_WIDTH,
      Math.floor((availableWidth - (columnCount - 1) * GAP) / columnCount),
    );

    // Build a list of groups: [{ header?, files: MediaFile[], startIndex }]
    type Group = {
      header?: { key: string; label: string };
      files: MediaFile[];
      startIndex: number;
    };

    const groups: Group[] = [];
    if (!groupHeaders || groupHeaders.length === 0) {
      groups.push({ files: [...files], startIndex: 0 });
    } else {
      for (let g = 0; g < groupHeaders.length; g++) {
        const h = groupHeaders[g];
        const end =
          g + 1 < groupHeaders.length
            ? groupHeaders[g + 1].startIndex
            : files.length;
        groups.push({
          header: { key: h.key, label: h.label },
          files: files.slice(h.startIndex, end),
          startIndex: h.startIndex,
        });
      }
    }

    // Pack each group independently into its own masonry section.
    const sections: Section[] = [];
    let cursorY = 0;

    for (const group of groups) {
      const sectionStartY = cursorY;
      let bodyStartY = sectionStartY;

      if (group.header) {
        bodyStartY = sectionStartY + HEADER_HEIGHT + GAP;
      }

      const colHeights = new Array(columnCount).fill(bodyStartY);
      const tiles: PlacedTile[] = [];

      for (let i = 0; i < group.files.length; i++) {
        const file = group.files[i];
        // Find the shortest column.
        let shortestCol = 0;
        for (let c = 1; c < columnCount; c++) {
          if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
        }

        const live = dimsRef.current.get(file.filePath);
        const ratio =
          live && live.w > 0 && live.h > 0
            ? live.h / live.w
            : file.width > 0 && file.height > 0
              ? file.height / file.width
              : FALLBACK_RATIO;
        const tileHeight = Math.round(columnWidth * ratio);
        const x = PADDING + shortestCol * (columnWidth + GAP);
        const y = colHeights[shortestCol];

        tiles.push({
          file,
          index: group.startIndex + i,
          x,
          y,
          width: columnWidth,
          height: tileHeight,
        });

        colHeights[shortestCol] = y + tileHeight + GAP;
      }

      const sectionHeight = Math.max(...colHeights, bodyStartY) - sectionStartY;
      const section: Section = {
        header: group.header,
        tiles,
        height: sectionHeight,
        offsetY: sectionStartY,
      };
      sections.push(section);
      cursorY = sectionStartY + sectionHeight + GAP * 2;
    }

    return { sections, totalHeight: cursorY };
  }, [files, groupHeaders, containerWidth, dimVersion]);

  // ── Visible window ─────────────────────────────────────────────
  const visibleTiles = useMemo(() => {
    const top = scrollTop - OVERSCAN;
    const bottom = scrollTop + viewportHeight + OVERSCAN;
    const result: { tile: PlacedTile; absoluteY: number }[] = [];

    for (const section of sections) {
      for (const tile of section.tiles) {
        const absY = section.offsetY + tile.y;
        if (absY + tile.height >= top && absY <= bottom) {
          result.push({ tile, absoluteY: absY });
        }
      }
    }
    return result;
  }, [sections, scrollTop, viewportHeight]);

  // Visible headers.
  const visibleHeaders = useMemo(() => {
    const top = scrollTop - OVERSCAN;
    const bottom = scrollTop + viewportHeight + OVERSCAN;
    const result: { label: string; key: string; absoluteY: number }[] = [];
    for (const section of sections) {
      if (!section.header) continue;
      const absY = section.offsetY;
      if (absY >= top && absY <= bottom) {
        result.push({
          label: section.header.label,
          key: section.header.key,
          absoluteY: absY,
        });
      }
    }
    return result;
  }, [sections, scrollTop, viewportHeight]);

  if (!files || files.length === 0) {
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
      className="virtualized-grid-scroll-container w-full h-full overflow-y-auto overflow-x-hidden bg-nerv-bg"
    >
      <div
        className="relative w-full"
        style={{ height: `${totalHeight}px` }}
      >
        {/* Group headers */}
        {visibleHeaders.map((h) => (
          <div
            key={`header-${h.key}`}
            className="absolute left-0 w-full flex items-center gap-3"
            style={{
              top: `${h.absoluteY}px`,
              height: `${HEADER_HEIGHT}px`,
              paddingLeft: `${PADDING}px`,
              paddingRight: `${PADDING}px`,
              boxSizing: "border-box",
            }}
          >
            <div className="h-3 w-1 bg-nerv-orange flex-shrink-0" />
            <span className="font-display text-[11px] uppercase tracking-widest text-nerv-amber font-bold truncate">
              {h.label}
            </span>
            <div className="flex-1 h-px bg-nerv-border/60" />
          </div>
        ))}

        {/* Masonry tiles */}
        {visibleTiles.map(({ tile, absoluteY }) => (
          <div
            key={tile.file.filePath}
            className="absolute"
            style={{
              left: `${tile.x}px`,
              top: `${absoluteY}px`,
              width: `${tile.width}px`,
              height: `${tile.height}px`,
            }}
          >
            <Thumbnail
              file={tile.file}
              width={tile.width}
              height={tile.height}
              index={tile.index}
              onHover={onThumbnailHover}
              onClick={onThumbnailClick}
              onContextMenu={onThumbnailContextMenu}
              onDimensions={handleDimensionsMeasured}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default VirtualizedGrid;
