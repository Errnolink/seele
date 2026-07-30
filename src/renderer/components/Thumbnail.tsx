import React, { memo, useRef, useState } from "react";
import { MediaFile } from "../../scanner/types";
import { formatBytes } from "../utils";

export interface ThumbnailProps {
  file: MediaFile;
  width: number;
  height: number;
  /**
   * Absolute index within the flat files array, for viewer navigation.
   * Passed to the stable onClick handler so the parent doesn't need a
   * per-tile closure (v4 review H-2).
   */
  index: number;
  /**
   * Hover sound callback. Passed from the parent grid rather than fetched
   * via `useSfx()` inside every thumbnail, so we don't run N hook calls
   * per visible row (review issue #28). Defaults to a no-op.
   */
  onHover?: () => void;
  /**
   * Click handler that opens the media viewer (v2 review #3). Receives
   * the tile's absolute index so the parent avoids an O(n) findIndex per
   * click (v3 review #5). Stable reference keeps React.memo effective
   * (v4 review H-2).
   */
  onClick?: (file: MediaFile, index: number) => void;
  /** Right-click handler (v3 review #13). */
  onContextMenu?: (file: MediaFile, e: React.MouseEvent) => void;
  /**
   * Reports the image's real pixel dimensions once the browser decodes
   * enough to know them (v4 rework). Powers the lazy masonry layout —
   * the scan no longer reads headers, so dimensions arrive for free as
   * thumbnails load.
   */
  onDimensions?: (filePath: string, width: number, height: number) => void;
}

/**
 * Memoized thumbnail tile. Skips re-render when `file`, `width`,
 * `height`, and callbacks are unchanged, so scrolling / filtering no
 * longer re-renders every visible tile (review issue #9).
 *
 * The `onClick` handler receives `index` as an argument rather than
 * being wrapped in a per-tile closure — this keeps the prop reference
 * stable so React.memo actually short-circuits (v4 review H-2).
 */
export const Thumbnail: React.FC<ThumbnailProps> = memo(
  ({ file, width, height, index, onHover, onClick, onContextMenu, onDimensions }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);

    const mediaUrl =
      typeof window !== "undefined" &&
      window.scanAPI &&
      typeof window.scanAPI.toMediaUrl === "function"
        ? window.scanAPI.toMediaUrl(file.filePath)
        : file.filePath;

    const handleLoadedData = () => {
      setLoaded(true);
      if (videoRef.current && videoRef.current.currentTime === 0) {
        videoRef.current.currentTime = 0.1;
      }
    };

    const isVideo = file.fileType === "video";

    return (
      <div
        className={`relative flex flex-col bg-nerv-bg overflow-hidden select-none flex-shrink-0 group ring-1 ring-nerv-border/40 hover:ring-2 hover:ring-nerv-orange hover:shadow-[0_0_12px_rgba(255,85,0,0.15)] transition-all duration-150 ${
          errored ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        style={{ width: `${width}px`, height: `${height}px` }}
        onMouseEnter={onHover}
        onClick={onClick && !errored ? () => onClick(file, index) : undefined}
        onContextMenu={
          onContextMenu
            ? (e) => {
                e.preventDefault();
                onContextMenu(file, e);
              }
            : undefined
        }
      >
        {/* Media Container — fills the whole tile */}
        <div className="relative w-full h-full bg-nerv-bg flex items-center justify-center overflow-hidden">
          {/* Loading skeleton (review issue #25) */}
          {!loaded && !errored && (
            <div
              className="absolute inset-0 animate-nerv-shimmer"
              style={{
                background:
                  "linear-gradient(90deg, #1c1d26 25%, rgba(255,85,0,0.08) 50%, #1c1d26 75%)",
                backgroundSize: "200% 100%",
              }}
            />
          )}

          {/* Error fallback (review issue #25) */}
          {errored && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-nerv-muted">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="font-mono text-[9px] uppercase">UNREADABLE</span>
            </div>
          )}

          {!errored && isVideo ? (
            <>
              <video
                ref={videoRef}
                src={mediaUrl}
                preload="metadata"
                muted
                onLoadedData={handleLoadedData}
                onError={() => setErrored(true)}
                className={`w-full h-full object-cover block transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-9 h-9 rounded-full bg-black/60 border border-nerv-green/50 flex items-center justify-center text-nerv-green group-hover:scale-110 transition-transform">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </>
          ) : !errored ? (
            <img
              src={mediaUrl}
              alt={file.fileName}
              loading="lazy"
              onLoad={(e) => {
                setLoaded(true);
                const img = e.currentTarget;
                const nw = img.naturalWidth;
                const nh = img.naturalHeight;
                if (nw > 0 && nh > 0) onDimensions?.(file.filePath, nw, nh);
              }}
              onError={() => setErrored(true)}
              className={`w-full h-full object-cover block transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : null}

          {/* Type chip — semantic color, top-right */}
          {!errored && (
            <div className="absolute top-1.5 right-1.5 bg-black/70 px-1.5 py-0.5 border border-nerv-border/50 pointer-events-none">
              <span
                className={`font-mono text-[9px] tracking-wider uppercase font-bold ${
                  isVideo ? "text-nerv-green" : "text-nerv-cyan"
                }`}
              >
                {isVideo ? "VID" : "IMG"}
              </span>
            </div>
          )}

          {/* Hover metadata overlay — slides up from bottom */}
          <div className="absolute inset-x-0 bottom-0 pointer-events-none opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-2 pt-8 pb-2">
            <div className="flex flex-col gap-0.5 font-mono">
              <span className="truncate text-[10px] text-nerv-text leading-tight" title={file.fileName}>
                {file.fileName}
              </span>
              <span className="text-[9px] text-nerv-cyan font-semibold">
                {formatBytes(file.sizeBytes)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

Thumbnail.displayName = "Thumbnail";

export default Thumbnail;
