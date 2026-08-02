import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuItem {
  /** Stable key. */
  key: string;
  /** Label, or omitted to render a divider. */
  label?: string;
  /** Click handler. Omitted on dividers. */
  onClick?: () => void;
  /** Disable the item (shown greyed, not clickable). */
  disabled?: boolean;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
}

export interface ContextMenuProps {
  position: ContextMenuPosition;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * NERV-styled context menu. Renders fixed-position at the given viewport
 * coordinates, closes on outside click / Escape / scroll / blur, and
 * clamps to the viewport so it never overflows the window edge
 * (v3 review #13).
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  items,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape. Mounted once.
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer the first outside-click listener by a tick so the triggering
    // contextmenu/mousedown doesn't immediately dismiss the menu.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", handlePointer);
      window.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp the menu inside the viewport. We render once, then measure.
  const [clamped, setClamped] = useState<ContextMenuPosition>(position);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = position.x;
    let y = position.y;
    if (x + rect.width + pad > window.innerWidth) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height + pad > window.innerHeight) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setClamped({ x, y });
  }, [position]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[180px] bg-nerv-panel border border-nerv-orange/40 shadow-[0_0_20px_rgba(255,152,48,0.25)] py-1 font-mono text-xs select-none"
      style={{ left: `${clamped.x}px`, top: `${clamped.y}px` }}
    >
      {items.map((item) =>
        item.label === undefined ? (
          <div
            key={item.key}
            className="my-1 mx-2 border-t border-nerv-border/60"
          />
        ) : (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 uppercase tracking-wider transition-colors ${
              item.disabled
                ? "text-nerv-muted/40 cursor-not-allowed"
                : "text-nerv-text hover:bg-nerv-orange/15 hover:text-nerv-amber cursor-pointer"
            }`}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center text-nerv-orange">
                {item.icon}
              </span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
};

export default ContextMenu;
