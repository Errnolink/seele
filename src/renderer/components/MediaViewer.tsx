import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { OVERLAY_ENTER, OVERLAY_EXIT } from "../motion";
import type { MediaFile } from "../../scanner/types";
import type { TagDef } from "../hooks/useTags";
import type { FileInsights } from "../inspectorUtils";
import { useViewerStage, ZOOM_STEP } from "../hooks/useViewerStage";
import { toMediaUrl } from "../mediaUrls";
import { MonitorOverlay } from "./MonitorOverlay";
import { ViewerTopBar } from "./ViewerTopBar";
import { ViewerSidePanel } from "./ViewerSidePanel";
import { ViewerFilmstrip } from "./ViewerFilmstrip";
import { ViewerFooter } from "./ViewerFooter";

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

/** Corner ticks frame the media stage. */
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

/**
 * Fullscreen lightbox overlay for images and videos.
 *
 * - Filmstrip navigation (horizontal scrollable thumbnails)
 * - Full keyboard control with visible hints
 * - Right side panel (shared InspectorParts blocks — parity with split view)
 * - Cleaner composition, less visual noise
 *
 * Split into: useViewerStage (zoom/pan/two-tier loading), ViewerTopBar,
 * ViewerSidePanel, ViewerFilmstrip, ViewerFooter. This file owns the
 * orchestration — keyboard, insights IPC, URL tiers, navigation.
 */
export const MediaViewer: React.FC<MediaViewerProps> = memo(
  ({ file, files, index, onClose, onNavigate, onNavigateTo, onMove, onRename, onTrash, onToggleFavorite, isFavorite, onUndo, queuedCount, modalOpen, tags, fileTags, onToggleFileTag }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    const isVideo = file.fileType === "video";
    const currentIndex = index ?? 0;
    const totalCount = files?.length ?? 1;
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < totalCount - 1;

    // ── zoom & pan stage (images only) ──
    const {
      zoom,
      pan,
      fullResLoaded,
      previewLoaded,
      setFullResLoaded,
      setPreviewLoaded,
      mediaContainerRef,
      zoomBy,
      fit,
      cursorClass,
      imageTransition,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleImageClick,
    } = useViewerStage(isVideo, file.filePath);

    // ── ui state ──
    const [showMetadata, setShowMetadata] = useState(true);

    // ── auto-focus video for keyboard controls ──
    useEffect(() => {
      if (isVideo) {
        const id = requestAnimationFrame(() => videoRef.current?.focus());
        return () => cancelAnimationFrame(id);
      }
    }, [isVideo, file.filePath]);

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
              zoomBy(ZOOM_STEP);
            }
            break;
          case "-":
          case "_":
            if (!isVideo) {
              e.preventDefault();
              zoomBy(1 / ZOOM_STEP);
            }
            break;
          case "0":
            if (!isVideo) {
              e.preventDefault();
              fit();
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
      [modalOpen, hasPrev, hasNext, isVideo, onNavigate, onClose, onTrash, onToggleFavorite, onMove, onRename, onUndo, file, zoomBy, fit],
    );

    useEffect(() => {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    // Two-tier loading: preview at 1920px for instant display, then raw
    // only when zoomed past 1×. 1920px decodes fast (~8MB JPEG vs 250MB
    // raw for an 9000px source) and looks crisp at fit-to-screen.
    const VIEWER_PREVIEW_W = 1920;
    const isGif = /\.gif$/i.test(file.filePath);
    const isHeic = /\.heic?$/i.test(file.filePath);
    const previewUrl = useMemo(() => {
      const base = toMediaUrl(file.filePath);
      return isVideo || isGif ? base : `${base}?w=${VIEWER_PREVIEW_W}`;
    }, [file.filePath, isVideo, isGif]);
    const fullResUrl = useMemo(
      () => toMediaUrl(file.filePath),
      [file.filePath],
    );
    // Shared-element thumbnail — the same ?w=640 the grid shows, so the
    // opening morph expands the exact frame the user clicked (GIFs stream
    // raw to stay animated).
    const thumbUrl = useMemo(
      () => (isGif ? toMediaUrl(file.filePath) : `${toMediaUrl(file.filePath)}?w=640`),
      [file.filePath, isGif],
    );
    // Reset full-res state whenever the file changes (new image).
    useEffect(() => {
      setFullResLoaded(false);
      setPreviewLoaded(false);
    }, [file.filePath, setFullResLoaded, setPreviewLoaded]);

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

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: OVERLAY_ENTER }}
        exit={{ opacity: 0, transition: OVERLAY_EXIT }}
        className="fixed inset-0 z-50 flex flex-col bg-nerv-bg select-none"
        tabIndex={-1}
      >
        {/* scanline overlay */}
        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-transparent via-nerv-orange/[0.03] to-transparent animate-scanline" />

        <ViewerTopBar
          file={file}
          isVideo={isVideo}
          isFavorite={isFavorite}
          totalCount={totalCount}
          currentIndex={currentIndex}
          zoom={zoom}
          onZoomBy={zoomBy}
          onFit={fit}
          onClose={onClose}
          onToggleFavorite={onToggleFavorite}
          onMove={onMove}
          onRename={onRename}
          onTrash={onTrash}
        />

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
            {/* CRT monitor frame around the stage — subtle, no sweep, no glow */}
            <MonitorOverlay color="cyan" opacity={0.15} />
            {/* corner ticks frame the stage */}
            <CornerTicks size={14} />
            {/* prev arrow */}
            {hasPrev && (
              <button
                type="button"
                onClick={() => navigate("prev")}
                className={`absolute left-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-[opacity,border-color,box-shadow] duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,152,48,0.2)]`}
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
                  {/* Placeholder layer — the ?w=640 thumbnail, absolute over
                      the checkerboard, visible until the 1920px preview
                      decodes and fades in over it (the sharpen). Pure
                      pan/zoom transforms only (no projection, no enter scale). */}
                  <motion.img
                    key={`thumb-${file.filePath}`}
                    src={thumbUrl}
                    alt={file.fileName}
                    decoding="async"
                    draggable={false}
                    onClick={handleImageClick}
                    onMouseDown={handleMouseDown}
                    animate={{ scale: zoom, x: pan.x, y: pan.y }}
                    transition={imageTransition}
                    className={`absolute inset-0 max-h-[78vh] max-w-[82vw] ${cursorClass}`}
                    style={{
                      transformOrigin: "center",
                      willChange: zoom > 1 ? "transform" : "auto",
                    }}
                  />
                  {/* Sharpen sweep — shimmer across the thumbnail while the
                      1920px preview decodes (GIFs stream raw, already crisp). */}
                  {!previewLoaded && !isGif && (
                    <div className="shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
                  )}
                  {/* Preview layer — in-flow sizer (1920px natural box, capped
                      at 82vw/78vh): the crisp image, fading in over the
                      placeholder thumbnail once decoded. */}
                  <motion.img
                    key={`prev-${file.filePath}`}
                    src={previewUrl}
                    alt=""
                    decoding="async"
                    draggable={false}
                    onClick={handleImageClick}
                    onMouseDown={handleMouseDown}
                    onLoad={() => setPreviewLoaded(true)}
                    className={`relative max-h-[78vh] max-w-[82vw] ${cursorClass}`}
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
                      className={`absolute inset-0 z-20 max-h-[78vh] max-w-[82vw] ${cursorClass}`}
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
                className={`absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-nerv-orange/30 bg-nerv-panel/90 text-nerv-orange transition-[opacity,border-color,box-shadow] duration-300 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,152,48,0.2)]`}
                title="Next (→)"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )}
          </div>

          {/* ── right side panel (slide/fade, expands image when hidden) ── */}
          <ViewerSidePanel
            file={file}
            isVideo={isVideo}
            showMetadata={showMetadata}
            palette={palette}
            hash={hash}
            camera={camera}
            insightsLoading={insightsLoading}
            queuedCount={queuedCount}
            tags={tags}
            fileTags={fileTags}
            onToggleFileTag={onToggleFileTag}
          />
        </div>

        {/* ── filmstrip (windowed, thin dock — full width under image + panel) ── */}
        {totalCount > 1 && (
          <ViewerFilmstrip
            files={files!}
            currentIndex={currentIndex}
            onNavigateTo={navigateTo}
          />
        )}

        {/* ── keyboard hints footer (absolute bottom edge) ── */}
        <ViewerFooter isVideo={isVideo} />
      </motion.div>
    );
  },
);

MediaViewer.displayName = "MediaViewer";

export default MediaViewer;
