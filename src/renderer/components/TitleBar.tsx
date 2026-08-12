import { memo } from "react";

export interface TitleBarProps {
  roots: string[];
}

/**
 * Status bar with NERV styling and custom min/max/close buttons.
 *
 * This is the topmost strip and carries the caption buttons, so it reads
 * as the window titlebar — it is therefore a drag region, and
 * double-clicking it toggles maximize, matching every native titlebar.
 * (Header row 1 below is also draggable.) The buttons opt out via
 * `.no-drag`, or they would drag the window instead of clicking.
 */
export const TitleBar: React.FC<TitleBarProps> = memo(({ roots }) => {
  const rootLabel = roots
    .map((r) => r.split(/[\\/]/).pop() || r)
    .join(" · ");
  return (
    <div
      className="titlebar-drag flex h-8 items-center justify-between bg-nerv-bg border-b border-nerv-purple/30 select-none"
      onDoubleClick={() => window.scanAPI.winMaximize()}
    >
      {/* Left: status indicator — library roots shown as status */}
      <div className="flex items-center gap-2 pl-3">
        <span className="w-1.5 h-1.5 rounded-full bg-nerv-lime shadow-[0_0_6px_#c9e98a]" />
        <span className="font-mono text-[9px] tracking-wider text-nerv-muted truncate max-w-[500px]">
          {roots.length > 0
            ? `LIBRARY: ${rootLabel}`
            : "AWAITING DIRECTORY INPUT"}
        </span>
      </div>

      {/* Right: window controls */}
      <div className="no-drag flex items-center h-full">
        <button
          type="button"
          onClick={() => window.scanAPI.winMinimize()}
          className="flex items-center justify-center w-11 h-full text-nerv-muted hover:bg-nerv-panel hover:text-nerv-text transition-colors"
          aria-label="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => window.scanAPI.winMaximize()}
          className="flex items-center justify-center w-11 h-full text-nerv-muted hover:bg-nerv-panel hover:text-nerv-text transition-colors"
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => window.scanAPI.winClose()}
          className="flex items-center justify-center w-11 h-full text-nerv-muted hover:bg-nerv-red hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </div>
  );
});

export default TitleBar;
