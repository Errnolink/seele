/**
 * ViewerTopBar — the viewer's title bar: FILE VIEWER label, position counter,
 * favorite/move/rename/trash actions, zoom controls, FIT, close.
 */
import React, { memo } from "react";
import type { MediaFile } from "../../scanner/types";
import { ZOOM_STEP } from "../hooks/useViewerStage";
import { Badge } from "./Badge";

/** Neutral square icon-button base for the viewer top bar; tone applied per button. */
const topBarBtn =
  "flex h-8 w-8 items-center justify-center border transition-[background-color,border-color,box-shadow] duration-150";
const topBarBtnOrange = `${topBarBtn} border-nerv-orange/40 text-nerv-orange hover:border-nerv-orange hover:bg-nerv-orange/10 hover:shadow-[0_0_10px_rgba(255,152,48,0.25)]`;

export interface ViewerTopBarProps {
  file: MediaFile;
  isVideo: boolean;
  isFavorite?: boolean;
  totalCount: number;
  currentIndex: number;
  zoom: number;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onClose: () => void;
  onToggleFavorite?: (file: MediaFile) => void;
  onMove?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onTrash?: (file: MediaFile) => void;
}

export const ViewerTopBar: React.FC<ViewerTopBarProps> = memo(
  ({ file, isVideo, isFavorite, totalCount, currentIndex, zoom, onZoomBy, onFit, onClose, onToggleFavorite, onMove, onRename, onTrash }) => (
    <div className="titlebar-drag relative z-20 flex h-12 items-center justify-between gap-3 border-b border-nerv-orange/20 bg-nerv-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="eva-title font-display text-sm font-bold uppercase tracking-widest text-nerv-orange">
          File Viewer
        </span>
        {totalCount > 1 && (
          <Badge
            variant="info"
            label={`${currentIndex + 1} / ${totalCount}`}
            className="flex h-8 items-center border border-nerv-cyan/20 bg-nerv-cyan/10 px-2 font-mono text-[9px] text-nerv-cyan"
          />
        )}
      </div>

      <div className="no-drag flex items-center gap-3">
        {/* action icons — favorite, move, rename, trash */}
        <div className="flex items-center gap-1.5">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(file)}
              title={isFavorite ? "Unfavorite (F)" : "Favorite (F)"}
              aria-label="Toggle favorite"
              className={`${topBarBtn} border-nerv-amber/40 text-nerv-amber hover:border-nerv-amber hover:bg-nerv-amber/10 hover:shadow-[0_0_10px_rgba(255,183,0,0.25)]`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8}>
                <path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" />
              </svg>
            </button>
          )}
          {onMove && (
            <button
              type="button"
              onClick={() => onMove(file)}
              title="Move (M)"
              aria-label="Move file"
              className={`${topBarBtn} border-nerv-lime/40 text-nerv-lime hover:border-nerv-lime hover:bg-nerv-lime/10 hover:shadow-[0_0_10px_rgba(201,233,138,0.25)]`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )}
          {onRename && (
            <button
              type="button"
              onClick={() => onRename(file)}
              title="Rename (Shift+F2)"
              aria-label="Rename file"
              className={`${topBarBtn} border-nerv-cyan/40 text-nerv-cyan hover:border-nerv-cyan hover:bg-nerv-cyan/10 hover:shadow-[0_0_10px_rgba(32,240,255,0.25)]`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M17 3l4 4L8 20l-5 1 1-5z" />
              </svg>
            </button>
          )}
          {onTrash && (
            <button
              type="button"
              onClick={() => onTrash(file)}
              title="Queue trash (Del)"
              aria-label="Queue trash"
              className={`${topBarBtn} border-nerv-red/40 text-nerv-red hover:border-nerv-red hover:bg-nerv-red/10 hover:shadow-[0_0_10px_rgba(255,80,80,0.25)]`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              </svg>
            </button>
          )}
        </div>

        {/* zoom controls (images only) */}
        {!isVideo && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onZoomBy(1 / ZOOM_STEP)}
              title="Zoom out (−)"
              aria-label="Zoom out"
              className={topBarBtnOrange}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M5 12h14" />
              </svg>
            </button>
            <span className="w-11 text-center font-mono text-[11px] tabular-nums text-nerv-cyan">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onZoomBy(ZOOM_STEP)}
              title="Zoom in (+)"
              aria-label="Zoom in"
              className={topBarBtnOrange}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        )}
        {!isVideo && (
          <button
            type="button"
            onClick={onFit}
            title="Fit to screen (0)"
            className="bg-nerv-orange px-3 py-1 font-mono text-[10px] font-bold tracking-wider text-black transition-[background-color,box-shadow] hover:bg-nerv-orange-hot hover:shadow-[0_0_10px_rgba(255,152,48,0.35)]"
          >
            FIT
          </button>
        )}
        {/* close */}
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close viewer"
          className={topBarBtnOrange}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  ),
);
ViewerTopBar.displayName = "ViewerTopBar";
