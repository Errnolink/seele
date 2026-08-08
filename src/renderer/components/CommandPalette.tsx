import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { OVERLAY_ENTER, OVERLAY_EXIT, PANEL_ENTER, PANEL_EXIT } from "../motion";
import type { MediaFile } from "../types";
import { formatBytes } from "../utils";

export interface CommandPaletteProps {
  files: MediaFile[];
  onClose: () => void;
  onSelect: (f: MediaFile) => void;
}

/** Maximum number of results rendered in the palette list. */
const MAX_RESULTS = 12;

/** Derive the last directory segment of a filePath (Windows or POSIX). */
function folderOf(filePath: string): string {
  if (!filePath) return "";
  // Normalize separators, drop the filename, take the trailing segment.
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  // parts: [..., dir, fileName] → last directory is the second-to-last.
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  files,
  onClose,
  onSelect,
}) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Filter files by case-insensitive substring against fileNameLower.
  const results = useMemo<MediaFile[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files.slice(0, MAX_RESULTS);
    const matched: MediaFile[] = [];
    for (const f of files) {
      if (f.fileNameLower.includes(q)) {
        matched.push(f);
        if (matched.length >= MAX_RESULTS) break;
      }
    }
    return matched;
  }, [files, query]);

  // Autofocus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset active index whenever the results set changes shape.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = rowRefs.current[activeIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const clamp = (i: number) =>
    results.length === 0 ? 0 : Math.max(0, Math.min(results.length - 1, i));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => clamp(i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => clamp(i - 1));
        break;
      case "Enter": {
        e.preventDefault();
        const sel = results[activeIndex];
        if (sel) {
          onSelect(sel);
          onClose();
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: OVERLAY_ENTER }}
      exit={{ opacity: 0, transition: OVERLAY_EXIT }}
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/80 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 1.02 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: PANEL_ENTER }}
        exit={{ opacity: 0, y: 6, scale: 0.99, transition: PANEL_EXIT }}
        className="relative w-full max-w-2xl rounded-lg border border-nerv-orange/60 bg-nerv-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Orange corner brackets — 4 L-shaped divs at the panel corners. */}
        <div className="pointer-events-none absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-nerv-orange" />
        <div className="pointer-events-none absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-nerv-orange" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-nerv-orange" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-nerv-orange" />

        {/* Header strip */}
        <div className="flex items-center justify-between border-b border-nerv-border px-4 py-2">
          <span className="text-[9px] uppercase tracking-[0.25em] phosphor-dim">
            CONTEXT // PALADIN SYSTEM
          </span>
          <span className="tabular-nums text-[9px] uppercase tracking-[0.2em] text-nerv-muted">
            {results.length} results
          </span>
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-nerv-border px-4 py-3">
          <span className="phosphor-orange text-sm font-bold">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="search files..."
            spellCheck={false}
            autoComplete="off"
            className="phosphor-violet min-w-0 flex-1 bg-transparent text-nerv-text outline-none placeholder:text-nerv-muted"
          />
          <kbd className="shrink-0 border border-nerv-border bg-nerv-bg px-1.5 py-0.5 text-[9px] tracking-[0.15em] text-nerv-muted">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <ul className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-[11px] text-nerv-muted">
              NO MATCHING FILES
            </li>
          )}
          {results.map((f, i) => {
            const active = i === activeIndex;
            const thumb = `${window.scanAPI.toMediaUrl(f.filePath)}?w=80`;
            return (
              <li
                key={f.filePath}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  onSelect(f);
                  onClose();
                }}
                className={[
                  "flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-150",
                  active
                    ? "border-l-2 border-nerv-orange bg-nerv-orange/10"
                    : "border-l-2 border-transparent",
                ].join(" ")}
              >
                {/* 40px thumb with I/V micro badge */}
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-nerv-border bg-nerv-bg">
                  <img
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                  <span
                    className={[
                      "absolute bottom-0 right-0 px-0.5 text-[8px] font-bold leading-none",
                      f.fileType === "image"
                        ? "bg-nerv-cyan/20 text-nerv-cyan"
                        : "bg-nerv-green/20 text-nerv-green",
                    ].join(" ")}
                  >
                    {f.fileType === "image" ? "I" : "V"}
                  </span>
                </div>

                {/* filename + folder */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-bold text-nerv-text">
                    {f.fileName}
                  </span>
                  <span className="truncate text-[10px] text-nerv-muted">
                    {folderOf(f.filePath)}
                  </span>
                </div>

                {/* size */}
                <span className="shrink-0 tabular-nums text-[10px] text-nerv-amber">
                  {formatBytes(f.sizeBytes)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-nerv-border px-4 py-2">
          <span className="text-[9px] tracking-[0.1em] text-nerv-muted">
            <span className="text-nerv-amber">{"\u2191\u2193"}</span> navigate
            {" \u00b7 "}
            <span className="text-nerv-amber">{"\u21b5"}</span> open
            {" \u00b7 "}
            <span className="text-nerv-amber">esc</span> close
          </span>
          <span className="tabular-nums text-[9px] uppercase tracking-[0.15em] text-nerv-muted">
            {results.length} results
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default CommandPalette;
