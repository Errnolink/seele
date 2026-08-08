/**
 * ViewerFilmstrip — windowed horizontal thumbnail dock under the media stage.
 *
 * Only renders ±50 thumbs around the active index (with leading/trailing
 * spacers) so a 10k-file folder never decodes thousands of thumbnails at
 * once. Scrolls the active thumb into center view on index change.
 */
import React, { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { MediaFile } from "../../scanner/types";
import { toThumbUrl } from "../mediaUrls";

interface FilmstripThumbProps {
  file: MediaFile;
  index: number;
  active: boolean;
  onClick: () => void;
}

const FilmstripThumb: React.FC<FilmstripThumbProps> = memo(
  ({ file, active, onClick }) => {
    const thumbUrl = useMemo(() => toThumbUrl(file.filePath), [file.filePath]);
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

export interface ViewerFilmstripProps {
  files: MediaFile[];
  currentIndex: number;
  onNavigateTo: (index: number) => void;
}

export const ViewerFilmstrip: React.FC<ViewerFilmstripProps> = memo(
  ({ files, currentIndex, onNavigateTo }) => {
    const filmstripRef = useRef<HTMLDivElement>(null);
    const totalCount = files.length;

    // Scroll the active thumb into view on index change.
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
    }, [currentIndex]);

    const thumbs = useMemo(() => {
      const out: React.ReactNode[] = [];
      // Window of ±50 around current index to avoid decoding
      // thousands of full-res images at once.
      const WIN = 50;
      const THUMB_STEP = 40 + 6; // thumb 40px + gap 6px
      const start = Math.max(0, currentIndex - WIN);
      const end = Math.min(totalCount, currentIndex + WIN + 1);

      // Leading spacer to preserve scroll position.
      if (start > 0) {
        out.push(
          <div
            key="spacer-lead"
            style={{ width: `${start * THUMB_STEP}px`, flexShrink: 0 }}
          />,
        );
      }

      for (let i = start; i < end; i++) {
        const f = files[i];
        out.push(
          <FilmstripThumb
            key={`${f.filePath}-${i}`}
            file={f}
            index={i}
            active={i === currentIndex}
            onClick={() => onNavigateTo(i)}
          />,
        );
      }

      // Trailing spacer.
      if (end < totalCount) {
        out.push(
          <div
            key="spacer-trail"
            style={{
              width: `${(totalCount - end) * THUMB_STEP}px`,
              flexShrink: 0,
            }}
          />,
        );
      }

      return out;
    }, [files, currentIndex, totalCount, onNavigateTo]);

    return (
      <div className="relative z-20 flex-shrink-0 border-t border-nerv-orange/20 bg-nerv-panel/60">
        <div
          ref={filmstripRef}
          className="flex items-center gap-1.5 overflow-x-auto px-3 py-1"
          style={{ scrollbarWidth: "thin" }}
        >
          {thumbs}
        </div>
      </div>
    );
  },
);
ViewerFilmstrip.displayName = "ViewerFilmstrip";
