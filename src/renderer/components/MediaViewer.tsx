import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { MediaFile } from "../../scanner/types";
import type { TagDef } from "../hooks/useTags";
import { dirName, hasCameraData, plateId, type FileInsights } from "../inspectorUtils";
import {
  CameraSection,
  ColorSpectrum,
  FileDetails,
  Hairline,
  HashSection,
  QuickActions,
  TagManager,
} from "./InspectorParts";

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
 *  The main process resizes via sharp (async, off-thread) when `?w=` is
 *  present; without it the raw file is streamed. */
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
  /** Move the current file (context menu / toolbar). */
  onMove?: (file: MediaFile) => void;
  /** Rename the current file. */
  onRename?: (file: MediaFile) => void;
  /** Queue the current file for trash (staged — no disk operation yet). */
  onTrash?: (file: MediaFile) => void;
  /** Toggle favorite state for the current file (F key / star button). */
  onToggleFavorite?: (file: MediaFile) => void;
  /** Whether the current file is favorited (star rendering). */
  isFavorite?: boolean;
  /** Undo the last organizing action (Ctrl+Z). */
  onUndo?: () => void;
  /** Number of files currently staged in the trash queue. */
  queuedCount?: number;
  /** True while a dialog (move/rename) sits on top of the viewer — the
   *  viewer surrenders keyboard control to it. */
  modalOpen?: boolean;
  /** Tag system props (shared TagManager — parity with split view). */
  tags?: TagDef[];
  fileTags?: TagDef[];
  onToggleFileTag?: (filePath: string, tagKey: string) => void;
}

// ─── zoom / pan helpers ──────────────────────────────────────────────
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.4;
/** Right side panel width — wide enough for hash strings + EXIF labels. */
const SIDE_PANEL_W = 264;

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
          "relative h-10 w-10 flex-shrink-0 overflow-hidden border transition-[border-color,box-shadow,opacity] duration-150",
          active
            ? "border-nerv-orange shadow-[0_0_8px_rgba(255,152,48,0.4)] ring-1 ring-nerv-orange/40"
            : "border-nerv-border opacity-60 hover:opacity-100 hover:border-nerv-amber",
        ].join(" ")}
        title={file.fileName}
      >
        <img
          src={thumbUrl}
          alt={file.fileName}
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
          onError={(e) => { e.currentTarget.style.opacity = "0"; }}
        />
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
            <svg className="h-3 w-3 text-nerv-green drop-shadow" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        {active && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-nerv-orange" />
        )}
      </button>
    );
  },
);
FilmstripThumb.displayName = "FilmstripThumb";

// ─── main component ──────────────────────────────────────────────────
/**
 * Fullscreen lightbox overlay for images and videos.
 *
 * - Filmstrip navigation (horizontal scrollable thumbnails)
 * - Full keyboard control with visible hints
 * - Right side panel (shared InspectorParts blocks — parity with split view)
 * - Cleaner composition, less visual noise
 */
export const MediaViewer: React.FC<MediaViewerProps> = memo(
  ({ file, files, index, onClose, onNavigate, onNavigateTo, onMove, onRename, onTrash, onToggleFavorite, isFavorite, onUndo, queuedCount, modalOpen, tags, fileTags, onToggleFileTag }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaContainerRef = useRef<HTMLDivElement>(null);
    const filmstripRef = useRef<HTMLDivElement>(null);

    // ── zoom & pan state ──
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [fullResLoaded, setFullResLoaded] = useState(false);
    const [previewLoaded, setPreviewLoaded] = useState(false);
    // The file this viewer instance opened with — shared-element morphs
    // (layoutId) only apply to it, so ←/→ navigation stays instant.
    const openFilePathRef = useRef(file.filePath);
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

    // ── keyboard control (ui-upgrade.md Issue 2A) ──
    // A native window listener (not React's onKeyDown) so shortcuts work
    // regardless of which element inside the viewer holds focus. Keys are
    // surrendered while a modal dialog (move/rename) sits on top.
    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (modalOpen) return;
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
          case "Delete":
          case "Backspace":
            // queue-trash the current file; parent auto-advances
            e.preventDefault();
            onTrash?.(file);
            break;
          case "f":
          case "F":
            e.preventDefault();
            onToggleFavorite?.(file);
            break;
          case "m":
          case "M":
            e.preventDefault();
            onMove?.(file);
            break;
          case "F2":
            // Shift+F2 renames — plain F2 stays the grid's rename-selected.
            if (e.shiftKey) {
              e.preventDefault();
              onRename?.(file);
            }
            break;
          case "r":
          case "R":
            // Ctrl+R renames (plain R is the global reload-failed-thumbs).
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              onRename?.(file);
            }
            break;
          case "z":
          case "Z":
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              onUndo?.();
            }
            break;
        }
      },
      [modalOpen, hasPrev, hasNext, isVideo, onNavigate, onClose, onTrash, onToggleFavorite, onMove, onRename, onUndo, file],
    );

    useEffect(() => {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

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
    // Two-tier loading: preview at 1920px for instant display, then raw
    // only when zoomed past 1×. 1920px decodes fast (~8MB JPEG vs 250MB
    // raw for an 9000px source) and looks crisp at fit-to-screen.
    const VIEWER_PREVIEW_W = 1920;
    const isGif = /\.gif$/i.test(file.filePath);
    const isHeic = /\.heic?$/i.test(file.filePath);
    const previewUrl = React.useMemo(() => {
      const base = toMediaUrl(file.filePath);
      return isVideo || isGif ? base : `${base}?w=${VIEWER_PREVIEW_W}`;
    }, [file.filePath, isVideo, isGif]);
    const fullResUrl = React.useMemo(
      () => toMediaUrl(file.filePath),
      [file.filePath],
    );
    // Shared-element thumbnail — the same ?w=640 the grid shows, so the
    // opening morph expands the exact frame the user clicked (GIFs stream
    // raw to stay animated).
    const thumbUrl = React.useMemo(
      () => (isGif ? toMediaUrl(file.filePath) : `${toMediaUrl(file.filePath)}?w=640`),
      [file.filePath, isGif],
    );
    // Reset full-res state whenever the file changes (new image).
    useEffect(() => {
      setFullResLoaded(false);
      setPreviewLoaded(false);
    }, [file.filePath]);

    // Preload adjacent images for instant navigation (no flash on next/prev).
    useEffect(() => {
      if (!files || isVideo) return;
      const targets = [currentIndex - 1, currentIndex + 1];
      for (const i of targets) {
        if (i >= 0 && i < files.length) {
          const f = files[i];
          if (f.fileType !== "video") {
            const img = new Image();
            img.src = /\.gif$/i.test(f.filePath)
              ? toMediaUrl(f.filePath)
              : `${toMediaUrl(f.filePath)}?w=${VIEWER_PREVIEW_W}`;
          }
        }
      }
    }, [currentIndex, files, isVideo]);

    // ── file insights (side panel): palette + hash + EXIF camera ──
    // Cached per file path; rapid filmstrip flipping never re-fetches an
    // already-seen file, and a coalescing loop keeps at most one `file:insights`
    // IPC in flight (stale wanted-paths are picked up by the next drain).
    const insightsCacheRef = useRef<Map<string, FileInsights | null>>(new Map());
    const [palette, setPalette] = useState<FileInsights["colors"] | null>(null);
    const [hash, setHash] = useState("");
    const [camera, setCamera] = useState<FileInsights["camera"] | undefined>(undefined);
    const [insightsLoading, setInsightsLoading] = useState(false);
    const wantedPathRef = useRef<string | null>(null);
    const insightsFetchingRef = useRef(false);
    const currentFilePathRef = useRef(file.filePath);

    useEffect(() => {
      currentFilePathRef.current = file.filePath;
      setPalette(null);
      setHash("");
      setCamera(undefined);
      setInsightsLoading(false);
      // Don't spend main-process decodes on a hidden panel.
      if (!showMetadata) {
        wantedPathRef.current = null;
        return;
      }
      const applyInsights = (insights: FileInsights | null) => {
        setPalette(insights && insights.colors.length > 0 ? insights.colors : null);
        setHash(insights?.hash ?? "");
        setCamera(insights?.camera);
      };
      const cached = insightsCacheRef.current.get(file.filePath);
      if (cached !== undefined) {
        applyInsights(cached);
        return;
      }
      wantedPathRef.current = file.filePath;
      if (insightsFetchingRef.current) return; // in-flight drain will pick it up
      insightsFetchingRef.current = true;
      setInsightsLoading(true);
      const drain = () => {
        const path = wantedPathRef.current;
        if (!path) {
          insightsFetchingRef.current = false;
          setInsightsLoading(false);
          return;
        }
        wantedPathRef.current = null;
        window.scanAPI
          .getFileInsights(path)
          .then((insights) => {
            insightsCacheRef.current.set(path, insights);
            if (currentFilePathRef.current === path) {
              applyInsights(insights);
              setInsightsLoading(false);
            }
            drain();
          })
          .catch(() => {
            insightsCacheRef.current.set(path, null);
            drain();
          });
      };
      drain();
    }, [file.filePath, showMetadata]);

    const cursorClass = isVideo
      ? ""
      : zoom > 1
        ? isPanning
          ? "cursor-grabbing"
          : "cursor-grab"
        : "cursor-zoom-in";
    // Per-value transitions: the shared-element morph eases out quickly
    // (spring 360/28 ≈ 0.3s) while pan/zoom stays snappy (600/45 ≈ 0.2s),
    // and everything goes zero-duration during an active drag so the image
    // tracks the cursor 1:1.
    const imageTransition = isPanning
      ? { duration: 0 }
      : {
          layout: { type: "spring", stiffness: 360, damping: 28 },
          x: { type: "spring", stiffness: 600, damping: 45 },
          y: { type: "spring", stiffness: 600, damping: 45 },
          scale: { type: "spring", stiffness: 600, damping: 45 },
          opacity: { duration: 0.25 },
        };

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex flex-col bg-nerv-bg select-none"
        tabIndex={-1}
      >
        {/* scanline overlay */}
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-transparent via-nerv-orange/[0.03] to-transparent animate-scanline" />

        {/* corner ticks */}
        <CornerTicks size={14} />

        {/* ── top bar ── */}
        <div className={`titlebar-drag relative z-20 flex h-12 items-center justify-between border-b border-nerv-orange/20 bg-nerv-panel px-4 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            <span className="eva-title font-display text-sm font-bold uppercase tracking-widest text-nerv-orange">
              File Viewer
            </span>
            {totalCount > 1 && (
              <span className="border border-nerv-cyan/20 bg-nerv-cyan/10 px-2 py-0.5 font-mono text-[10px] text-nerv-cyan">
                {currentIndex + 1} / {totalCount}
              </span>
            )}
          </div>

          <div className="no-drag flex items-center gap-3">
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
              className="border border-nerv-amber/50 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-nerv-amber transition-[background-color,box-shadow] hover:bg-nerv-amber/10 hover:shadow-[0_0_8px_rgba(255,183,0,0.2)]"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── main row: media stage + right side panel ── */}
        <div className="flex flex-1 min-h-0">
          {/* ── media stage (expands into panel's space when hidden) ── */}
          <div
            ref={mediaContainerRef}
            className="relative z-20 flex flex-1 min-w-0 items-center justify-center overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
          {/* prev arrow */}
          {hasPrev && (
            <button
              type="button"
              onClick={() => navigate("prev")}
              className={`absolute left-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-[opacity,border-color,box-shadow] duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,152,48,0.2)] ${controlsVisible ? "opacity-100" : "opacity-0"}`}
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
                src={previewUrl}
                poster={`${toMediaUrl(file.filePath)}?w=1280`}
                controls
                tabIndex={0}
                preload="metadata"
                className="max-h-[78vh] max-w-[82vw] outline-none"
                style={{ border: "1px solid rgba(255,152,48,0.2)" }}
              />
            ) : (
              <div className="relative thumb-checkerboard" style={{ maxWidth: "82vw", maxHeight: "78vh" }}>
                {/* Shared-element projection wrapper — morphs from the
                    clicked tile into the viewer box on open and back on
                    close. Transforms live on the inner img, never here:
                    projection and pan/zoom compose on separate elements,
                    so zooming can't ghost into two images. Disabled once
                    zoomed/navigated away, where close is a clean fade. */}
                <motion.div
                  layoutId={zoom === 1 && file.filePath === openFilePathRef.current ? file.filePath : undefined}
                  className="relative w-fit"
                  transition={{ layout: { type: "spring", stiffness: 360, damping: 28 } }}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                  style={{ willChange: "transform" }}
                >
                  {/* Thumbnail layer — always visible; the morphing content. */}
                  <motion.img
                    key={`thumb-${file.filePath}`}
                    src={thumbUrl}
                    alt={file.fileName}
                    decoding="async"
                    draggable={false}
                    onClick={handleImageClick}
                    onMouseDown={handleMouseDown}
                    className={`max-h-[78vh] max-w-[82vw] ${cursorClass}`}
                    animate={{ scale: zoom, x: pan.x, y: pan.y }}
                    transition={imageTransition}
                    style={{
                      transformOrigin: "center",
                      willChange: zoom > 1 ? "transform" : "auto",
                    }}
                  />
                </motion.div>
                {/* Sharpen sweep — shimmer across the thumbnail while the
                    1920px preview decodes (GIFs stream raw, already crisp). */}
                {!previewLoaded && !isGif && (
                  <div className="shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
                )}
                {/* Preview layer — crisp 1920px render fading over the
                    thumbnail once decoded. */}
                <motion.img
                  key={`prev-${file.filePath}`}
                  src={previewUrl}
                  alt=""
                  decoding="async"
                  draggable={false}
                  onClick={handleImageClick}
                  onMouseDown={handleMouseDown}
                  onLoad={() => setPreviewLoaded(true)}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                  className={`absolute inset-0 max-h-[78vh] max-w-[82vw] ${cursorClass}`}
                  animate={{ scale: zoom, x: pan.x, y: pan.y, opacity: previewLoaded ? 1 : 0 }}
                  transition={imageTransition}
                  style={{
                    transformOrigin: "center",
                    willChange: zoom > 1 ? "transform" : "auto",
                  }}
                />
                {/* Full-resolution detail layer — fades in on top when zoomed.
                    Sits invisible until loaded so the preview underneath stays
                    on screen (no flicker). */}
                {zoom > 1 && !isHeic && (
                  <motion.img
                    key={`full-${file.filePath}`}
                    src={fullResUrl}
                    alt=""
                    decoding="async"
                    draggable={false}
                    onClick={handleImageClick}
                    onMouseDown={handleMouseDown}
                    onLoad={() => setFullResLoaded(true)}
                    exit={{ opacity: 0, transition: { duration: 0.25 } }}
                    className={`absolute inset-0 max-h-[78vh] max-w-[82vw] ${cursorClass}`}
                    animate={{ scale: zoom, x: pan.x, y: pan.y, opacity: fullResLoaded ? 1 : 0 }}
                    transition={imageTransition}
                    style={{
                      transformOrigin: "center",
                      willChange: "transform",
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* next arrow */}
          {hasNext && (
            <button
              type="button"
              onClick={() => navigate("next")}
              className={`absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-[opacity,border-color,box-shadow] duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,152,48,0.2)] ${controlsVisible ? "opacity-100" : "opacity-0"}`}
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
              <Hint keys="Del" label="Queue Trash" />
              <Divider />
              <Hint keys="Esc" label="Close" />
            </div>
          )}
          </div>

          {/* ── right side panel (slide/fade, expands image when hidden) ── */}
          <div
            className={`relative z-20 flex-shrink-0 overflow-hidden border-l border-nerv-orange/20 bg-nerv-panel/90 transition-[width,opacity] duration-200 ease-out no-drag ${
              showMetadata ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            style={{ width: showMetadata ? SIDE_PANEL_W : 0 }}
          >
            {/* Fixed-width content — the wrapper animates, the content never
                reflows (no layout thrash during the slide). */}
            <div
              className="flex h-full flex-col overflow-y-auto"
              style={{ width: SIDE_PANEL_W, scrollbarWidth: "thin" }}
            >
              {/* 1. FILE — name + reveal-in-folder + path + ID/type badges */}
              <section className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-nerv-muted">
                    FILE
                  </span>
                  <span className="flex gap-1">
                    <span className="tag-chip eva-cut bg-nerv-orange px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-black">
                      {plateId(file.filePath)}
                    </span>
                    <span
                      className={`tag-chip eva-cut px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-black ${
                        isVideo ? "bg-nerv-green" : "bg-nerv-cyan"
                      }`}
                    >
                      {isVideo ? "VID" : "IMG"}
                    </span>
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-[11px] font-bold leading-snug text-nerv-orange">
                    {file.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => void window.scanAPI.showItemInFolder(file.filePath)}
                    title="Reveal in folder"
                    aria-label="Reveal in folder"
                    className="shrink-0 text-nerv-muted transition-colors hover:text-nerv-amber"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-nerv-muted">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-nerv-orange/70"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" /><rect x="3" y="9" width="18" height="11" /></svg>
                  <span className="truncate">{dirName(file.filePath)}</span>
                </div>
              </section>
              <Hairline />

              {/* 2. TAGS — shared TagManager (same as split view) */}
              {tags && onToggleFileTag && (
                <>
                  <section className="px-4 py-3">
                    <TagManager
                      tags={tags}
                      fileTags={fileTags ?? []}
                      filePath={file.filePath}
                      onToggleFileTag={onToggleFileTag}
                    />
                  </section>
                  <Hairline />
                </>
              )}

              {/* 3. QUICK ACTIONS — shared 2x2 grid */}
              <section className="px-4 py-3">
                <div className="mb-2 text-[9px] font-mono uppercase tracking-widest text-nerv-muted">
                  QUICK ACTIONS
                </div>
                <QuickActions
                  file={file}
                  isFavorite={isFavorite ?? false}
                  onToggleFavorite={onToggleFavorite}
                  onMove={onMove}
                  onRename={onRename}
                  onTrash={onTrash}
                />
              </section>
              <Hairline />

              {/* 4. FILE DETAILS — merged basic + resolution stats */}
              <section className="px-4 py-3">
                <div className="mb-2 text-[9px] font-mono uppercase tracking-widest text-nerv-muted">
                  FILE DETAILS
                </div>
                <FileDetails file={file} />
              </section>
              <Hairline />

              {/* 5. COLOR SPECTRUM — shared gradient + labeled swatches */}
              <section className="px-4 py-3">
                <ColorSpectrum colors={palette} loading={insightsLoading} />
              </section>

              {/* 6. CAMERA — omitted entirely when no EXIF data */}
              {hasCameraData(camera) && (
                <>
                  <Hairline />
                  <section className="px-4 py-3">
                    <CameraSection camera={camera} />
                  </section>
                </>
              )}

              {/* 7. HASH — value + copy */}
              <Hairline />
              <section className="px-4 py-3">
                <HashSection hash={hash} />
              </section>

              <div className="mt-auto px-4 py-2">
                {queuedCount !== undefined && queuedCount > 0 && (
                  <span className="font-mono text-[8px] font-bold tracking-wider text-nerv-red">
                    {queuedCount} STAGED FOR TRASH
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── filmstrip (windowed, thin dock — full width under image + panel) ── */}
        {totalCount > 1 && (
          <div className="relative z-20 flex-shrink-0 border-t border-nerv-orange/20 bg-nerv-panel/60">
            <div
              ref={filmstripRef}
              className="flex items-center gap-1.5 overflow-x-auto px-3 py-1"
              style={{ scrollbarWidth: "thin" }}
            >
              {(() => {
                const thumbs: React.ReactNode[] = [];
                // Window of ±50 around current index to avoid decoding
                // thousands of full-res images at once.
                const WIN = 50;
                const THUMB_STEP = 40 + 6; // thumb 40px + gap 6px
                const start = Math.max(0, currentIndex - WIN);
                const end = Math.min(totalCount, currentIndex + WIN + 1);

                // Leading spacer to preserve scroll position.
                if (start > 0) {
                  thumbs.push(
                    <div
                      key="spacer-lead"
                      style={{ width: `${start * THUMB_STEP}px`, flexShrink: 0 }}
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
                        width: `${(totalCount - end) * THUMB_STEP}px`,
                        flexShrink: 0,
                      }}
                    />,
                  );
                }

                return thumbs;
              })()}
            </div>
          </div>
        )}
      </motion.div>
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