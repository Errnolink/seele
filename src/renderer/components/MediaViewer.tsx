import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MediaFile } from "../../scanner/types";
import { formatBytes } from "../utils";

/** Build a `media://` URL for the renderer. Mirrors the preload bridge so the
 * viewer works the same way as thumbnails. */
function toMediaUrl(filePath: string): string {
  return typeof window !== "undefined" &&
    window.scanAPI &&
    typeof window.scanAPI.toMediaUrl === "function"
    ? window.scanAPI.toMediaUrl(filePath)
    : `media://local/${encodeURIComponent(filePath)}`;
}

/** Build a downscaled `media://` URL for small thumbnails (filmstrip).
 *  The main process resizes via nativeImage when `?w=` is present. */
function toThumbUrl(filePath: string, width = 112): string {
  return `${toMediaUrl(filePath)}?w=${width}`;
}

export interface MediaViewerProps {
  /** The file to display. */
  file: MediaFile;
  /** Full list of files in the current view, for navigation / counter. */
  files?: MediaFile[];
  /** Index of the current file within `files`. */
  index?: number;
  /** Called when the viewer should close (Escape / backdrop click / close button). */
  onClose: () => void;
  /** Called when the user navigates to the previous or next file. */
  onNavigate?: (direction: "prev" | "next") => void;
  /** Jump directly to an absolute index (filmstrip click). O(1) instead
   * of calling onNavigate N times (v4 review M-2). */
  onNavigateTo?: (index: number) => void;
}

/** Format a date string (ISO or epoch) into a compact, readable form. */
function formatDate(input: string | number | undefined): string {
  if (!input) return "—";
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


// ─── zoom / pan helpers ──────────────────────────────────────────────
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.4;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

interface PanOffset {
  x: number;
  y: number;
}

// ─── filmstrip thumbnail ─────────────────────────────────────────────
interface FilmstripThumbProps {
  file: MediaFile;
  index: number;
  active: boolean;
  onClick: () => void;
}

const FilmstripThumb: React.FC<FilmstripThumbProps> = memo(
  ({ file, active, onClick }) => {
    const thumbUrl = React.useMemo(() => toThumbUrl(file.filePath), [file.filePath]);
    const isVideo = file.fileType === "video";

    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          "relative h-14 w-14 flex-shrink-0 overflow-hidden border transition-all duration-150",
          active
            ? "border-nerv-orange shadow-[0_0_8px_rgba(255,85,0,0.4)] ring-1 ring-nerv-orange/40"
            : "border-nerv-border opacity-60 hover:opacity-100 hover:border-nerv-amber",
        ].join(" ")}
        title={file.fileName}
      >
        {isVideo ? (
          <div className="flex h-full w-full items-center justify-center bg-nerv-panel-2">
            <svg
              className="h-5 w-5 text-nerv-green"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        ) : (
          <img
            src={thumbUrl}
            alt={file.fileName}
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        )}
        {active && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-nerv-orange" />
        )}
      </button>
    );
  },
);
FilmstripThumb.displayName = "FilmstripThumb";

// ─── metadata row ────────────────────────────────────────────────────
function MetaItem({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "amber" | "cyan" | "green";
}) {
  const toneClass =
    tone === "amber"
      ? "text-nerv-amber"
      : tone === "cyan"
        ? "text-nerv-cyan"
        : tone === "green"
          ? "text-nerv-green"
          : "text-nerv-text";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-nerv-muted">
        {label}
      </span>
      <span className={`text-xs font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────
/**
 * Fullscreen lightbox overlay for images and videos.
 *
 * v4 rework:
 * - Filmstrip navigation (horizontal scrollable thumbnails)
 * - Click-to-zoom + drag-to-pan for images
 * - Full keyboard control with visible hints
 * - Rich metadata panel (size, date, path, type)
 * - Cleaner composition, less visual noise
 */
export const MediaViewer: React.FC<MediaViewerProps> = memo(
  ({ file, files, index, onClose, onNavigate, onNavigateTo }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaContainerRef = useRef<HTMLDivElement>(null);
    const filmstripRef = useRef<HTMLDivElement>(null);

    // ── zoom & pan state ──
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

    // ── ui state ──
    const [showHints, setShowHints] = useState(true);
    const [showMetadata, setShowMetadata] = useState(true);
    const [controlsVisible, setControlsVisible] = useState(true);

    const isVideo = file.fileType === "video";
    const currentIndex = index ?? 0;
    const totalCount = files?.length ?? 1;
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < totalCount - 1;

    // ── reset zoom/pan on file change ──
    useLayoutEffect(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }, [file.filePath]);

    // ── auto-focus video for keyboard controls ──
    useEffect(() => {
      if (isVideo) {
        const id = requestAnimationFrame(() => videoRef.current?.focus());
        return () => cancelAnimationFrame(id);
      }
    }, [isVideo, file.filePath]);

    // ── auto-hide hints after 4s ──
    useEffect(() => {
      setShowHints(true);
      const timer = setTimeout(() => setShowHints(false), 4000);
      return () => clearTimeout(timer);
    }, [file.filePath]);

    // ── auto-hide chrome (top bar, nav arrows, hints) on mouse idle (UX-17) ──
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
      const onMove = () => {
        setControlsVisible(true);
        clearTimeout(hideTimerRef.current!);
        hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
      };
      onMove();
      window.addEventListener("mousemove", onMove);
      return () => {
        window.removeEventListener("mousemove", onMove);
        clearTimeout(hideTimerRef.current!);
      };
    }, []);

    // ── scroll filmstrip to active item ──
    useLayoutEffect(() => {
      const strip = filmstripRef.current;
      if (!strip) return;
      const activeChild = strip.children[currentIndex] as HTMLElement | undefined;
      if (activeChild) {
        activeChild.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      }
    }, [currentIndex, files]);

    // ── keyboard navigation ──
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (hasPrev) onNavigate?.("prev");
            break;
          case "ArrowRight":
            e.preventDefault();
            if (hasNext) onNavigate?.("next");
            break;
          case "Escape":
            e.preventDefault();
            onClose();
            break;
          case "+":
          case "=":
            if (!isVideo) {
              e.preventDefault();
              setZoom((z) => clampZoom(z * ZOOM_STEP));
            }
            break;
          case "-":
          case "_":
            if (!isVideo) {
              e.preventDefault();
              setZoom((z) => {
                const next = clampZoom(z / ZOOM_STEP);
                if (next === 1) setPan({ x: 0, y: 0 });
                return next;
              });
            }
            break;
          case "0":
            if (!isVideo) {
              e.preventDefault();
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }
            break;
          case "i":
          case "I":
            e.preventDefault();
            setShowMetadata((s) => !s);
            break;
          case " ":
            // let video element handle space for play/pause
            if (!isVideo) e.preventDefault();
            break;
        }
      },
      [hasPrev, hasNext, isVideo, onNavigate, onClose],
    );

    // ── zoom on wheel ──
    // Must be a native non-passive listener so preventDefault works;
    // React's onWheel is passive by default (v4 review M-7).
    useEffect(() => {
      const el = mediaContainerRef.current;
      if (!el || isVideo) return;
      const handler = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setZoom((z) => {
          const next = clampZoom(z * factor);
          if (next === 1) setPan({ x: 0, y: 0 });
          return next;
        });
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    }, [isVideo]);

    // ── pan handlers (image only, zoomed) ──
    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (isVideo || zoom === 1) return;
        e.preventDefault();
        setIsPanning(true);
        panStart.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      },
      [isVideo, zoom, pan.x, pan.y],
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isPanning || !panStart.current) return;
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPan({
          x: panStart.current.panX + dx,
          y: panStart.current.panY + dy,
        });
      },
      [isPanning],
    );

    const handleMouseUp = useCallback(() => {
      setIsPanning(false);
      panStart.current = null;
    }, []);

    // ── click-to-zoom (image only) ──
    const handleImageClick = useCallback(
      (e: React.MouseEvent) => {
        if (isVideo) return;
        // double-click toggles zoom
        if (e.detail === 2) {
          setZoom((z) => {
            if (z > 1) {
              setPan({ x: 0, y: 0 });
              return 1;
            }
            return 2;
          });
        }
      },
      [isVideo],
    );

    // ── navigate to specific index via filmstrip ──
    // Uses onNavigateTo for O(1) jump; falls back to step-by-step
    // onNavigate only if the parent doesn't provide onNavigateTo
    // (v4 review M-2).
    const navigateTo = useCallback(
      (target: number) => {
        if (onNavigateTo) {
          onNavigateTo(target);
        } else if (target < currentIndex) {
          for (let i = currentIndex; i > target; i--) onNavigate?.("prev");
        } else if (target > currentIndex) {
          for (let i = currentIndex; i < target; i++) onNavigate?.("next");
        }
      },
      [currentIndex, onNavigate, onNavigateTo],
    );

    const navigate = useCallback(
      (dir: "prev" | "next") => onNavigate?.(dir),
      [onNavigate],
    );

    const mediaUrl = React.useMemo(() => toMediaUrl(file.filePath), [file.filePath]);

    const cursorClass = isVideo
      ? ""
      : zoom > 1
        ? isPanning
          ? "cursor-grabbing"
          : "cursor-grab"
        : "cursor-zoom-in";

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-nerv-bg select-none animate-viewer-enter"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {/* scanline overlay */}
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-transparent via-nerv-orange/[0.03] to-transparent animate-scanline" />

        {/* corner ticks */}
        <CornerTicks size={14} />

        {/* ── top bar ── */}
        <div className={`relative z-20 flex items-center justify-between border-b border-nerv-orange/20 bg-nerv-panel px-4 py-2.5 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            <span className="font-display text-sm font-bold uppercase tracking-widest text-nerv-orange">
              File Viewer
            </span>
            {totalCount > 1 && (
              <span className="border border-nerv-cyan/20 bg-nerv-cyan/10 px-2 py-0.5 font-mono text-[10px] text-nerv-cyan">
                {currentIndex + 1} / {totalCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* zoom indicator (images only) */}
            {!isVideo && (
              <span className="font-mono text-[10px] text-nerv-muted">
                {zoom > 1 ? `${zoom.toFixed(1)}×` : "FIT"}
              </span>
            )}
            {/* metadata toggle */}
            <button
              type="button"
              onClick={() => setShowMetadata((s) => !s)}
              className="border border-nerv-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-nerv-muted transition-colors hover:border-nerv-cyan hover:text-nerv-cyan"
            >
              {showMetadata ? "Hide Info" : "Show Info"}
            </button>
            {/* close */}
            <button
              type="button"
              onClick={onClose}
              className="border border-nerv-amber/50 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-nerv-amber transition-all hover:bg-nerv-amber/10 hover:shadow-[0_0_8px_rgba(255,170,0,0.2)]"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── media stage ── */}
        <div
          ref={mediaContainerRef}
          className="relative z-20 flex flex-1 items-center justify-center overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* prev arrow */}
          {hasPrev && (
            <button
              type="button"
              onClick={() => navigate("prev")}
              className={`absolute left-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-all duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,85,0,0.2)] ${controlsVisible ? "opacity-100" : "opacity-0"}`}
              title="Previous (←)"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          {/* media element */}
          <div
            className="relative flex items-center justify-center"
            style={{ minWidth: "280px", minHeight: "280px" }}
          >
            {isVideo ? (
              <video
                ref={videoRef}
                key={file.filePath}
                src={mediaUrl}
                controls
                tabIndex={0}
                className="max-h-[78vh] max-w-[82vw] outline-none"
                style={{ border: "1px solid rgba(255,85,0,0.2)" }}
              />
            ) : (
              <img
                key={file.filePath}
                src={mediaUrl}
                alt={file.fileName}
                decoding="async"
                draggable={false}
                onClick={handleImageClick}
                onMouseDown={handleMouseDown}
                className={`max-h-[78vh] max-w-[82vw] ${cursorClass}`}
                style={{
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  transformOrigin: "center",
                  willChange: zoom > 1 ? "transform" : "auto",
                }}
              />
            )}
          </div>

          {/* next arrow */}
          {hasNext && (
            <button
              type="button"
              onClick={() => navigate("next")}
              className={`absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-all duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,85,0,0.2)] ${controlsVisible ? "opacity-100" : "opacity-0"}`}
              title="Next (→)"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}

          {/* keyboard hints overlay */}
          {showHints && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 border border-nerv-border/60 bg-nerv-panel/90 px-3 py-1.5">
              <Hint keys="←/→" label="Navigate" />
              <Divider />
              {!isVideo && <Hint keys="+/-/0" label="Zoom" />}
              {!isVideo && <Divider />}
              <Hint keys="I" label="Info" />
              <Divider />
              <Hint keys="Esc" label="Close" />
            </div>
          )}
        </div>

        {/* ── metadata panel (collapsible) ── */}
        {showMetadata && (
          <div className="relative z-20 flex items-stretch border-t border-nerv-orange/20 bg-nerv-panel/90">
            <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
              <MetaItem
                label="File"
                value={
                  <span className="font-bold text-nerv-orange">
                    {file.fileName}
                  </span>
                }
              />
              <MetaItem
                label="Type"
                value={isVideo ? "VIDEO" : "IMAGE"}
                tone={isVideo ? "green" : "cyan"}
              />
              <MetaItem
                label="Size"
                value={formatBytes(file.sizeBytes)}
                tone="cyan"
              />
              <MetaItem
                label="Created"
                value={formatDate(file.birthtime)}
                tone="amber"
              />
            </div>
          </div>
        )}

        {/* ── filmstrip (windowed — only render thumbs near current index) ── */}
        {totalCount > 1 && (
          <div className="relative z-20 border-t border-nerv-orange/20 bg-nerv-panel/40">
            <div
              ref={filmstripRef}
              className="flex items-center gap-1.5 overflow-x-auto px-3 py-2"
              style={{ scrollbarWidth: "thin" }}
            >
              {(() => {
                const thumbs: React.ReactNode[] = [];
                // Window of ±50 around current index to avoid decoding
                // thousands of full-res images at once.
                const WIN = 50;
                const start = Math.max(0, currentIndex - WIN);
                const end = Math.min(totalCount, currentIndex + WIN + 1);

                // Leading spacer to preserve scroll position.
                if (start > 0) {
                  thumbs.push(
                    <div
                      key="spacer-lead"
                      style={{ width: `${start * (56 + 6)}px`, flexShrink: 0 }}
                    />,
                  );
                }

                for (let i = start; i < end; i++) {
                  const f = files![i];
                  thumbs.push(
                    <FilmstripThumb
                      key={`${f.filePath}-${i}`}
                      file={f}
                      index={i}
                      active={i === currentIndex}
                      onClick={() => navigateTo(i)}
                    />,
                  );
                }

                // Trailing spacer.
                if (end < totalCount) {
                  thumbs.push(
                    <div
                      key="spacer-trail"
                      style={{
                        width: `${(totalCount - end) * (56 + 6)}px`,
                        flexShrink: 0,
                      }}
                    />
                  );
                }

                return thumbs;
              })()}
            </div>
          </div>
        )}
      </div>
    );
  },
);

MediaViewer.displayName = "MediaViewer";

// ─── small sub-components ────────────────────────────────────────────

function CornerTicks({ size = 14 }: { size?: number }) {
  const base = "absolute z-30 border-nerv-orange/40";
  return (
    <>
      <div className={`${base} left-2 top-2 border-l-2 border-t-2`} style={{ width: size, height: size }} />
      <div className={`${base} right-2 top-2 border-r-2 border-t-2`} style={{ width: size, height: size }} />
      <div className={`${base} bottom-2 left-2 border-b-2 border-l-2`} style={{ width: size, height: size }} />
      <div className={`${base} bottom-2 right-2 border-b-2 border-r-2`} style={{ width: size, height: size }} />
    </>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-nerv-muted">
      <kbd className="border border-nerv-orange/40 px-1.5 py-0.5 text-nerv-orange">
        {keys}
      </kbd>
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-nerv-border/60" />;
}

export default MediaViewer;