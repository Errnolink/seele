import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE_MECHANICAL } from "../motion";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Zoom multiplier per wheel notch / +/- button. */
export const ZOOM_STEP = 1.4;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

interface PanOffset {
  x: number;
  y: number;
}

/**
 * Zoom / pan / two-tier-loading state for the viewer's media stage.
 *
 * - Wheel zoom via a native non-passive listener (React's onWheel is passive
 *   by default, so preventDefault would not work — v4 review M-7).
 * - Drag-to-pan while zoomed (image only).
 * - Double-click toggles 2× zoom.
 * - Zoom/pan reset whenever the displayed file changes.
 *
 * All motion is pure transform (scale/translate) on the compositor; nothing
 * here touches layout.
 */
export function useViewerStage(isVideo: boolean, filePath: string) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [fullResLoaded, setFullResLoaded] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const mediaContainerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Reset zoom/pan on file change (layout effect so the new file never
  // paints at the previous file's zoom).
  useLayoutEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [filePath]);

  // Wheel zoom — native non-passive listener so preventDefault works.
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

  /** Multiply zoom by `factor` (clamped); landing exactly at 1× resets pan. */
  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  /** Fit to screen — zoom 1, centered. */
  const fit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

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

  const cursorClass = isVideo
    ? ""
    : zoom > 1
      ? isPanning
        ? "cursor-grabbing"
        : "cursor-grab"
      : "cursor-zoom-in";

  // Per-value transitions: pan/zoom stays snappy (600/45 ≈ 0.2s), the
  // opening scale pop and layer fades use quick tweens, and everything
  // goes zero-duration during an active drag so the image tracks the
  // cursor 1:1.
  const imageTransition = isPanning
    ? { duration: 0 }
    : {
        x: { type: "spring", stiffness: 600, damping: 45 },
        y: { type: "spring", stiffness: 600, damping: 45 },
        scale: { type: "spring", stiffness: 600, damping: 45 },
        opacity: { duration: 0.2, ease: EASE_MECHANICAL },
      };

  return {
    zoom,
    pan,
    isPanning,
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
  };
}
