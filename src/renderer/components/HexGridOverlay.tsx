import React, { memo } from "react";

export interface HexGridOverlayProps {
  className?: string;
}

/**
 * Purely decorative SVG grid overlay. Memoized so it never re-renders on
 * parent state changes — its output is static (review issue #12).
 */
export const HexGridOverlay: React.FC<HexGridOverlayProps> = memo(
  ({ className = "" }) => {
    return (
      <div
        className={`fixed inset-0 pointer-events-none z-0 ${className}`}
        style={{
          backgroundImage:
            "linear-gradient(rgba(255, 85, 0, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 85, 0, 0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
    );
  },
);

HexGridOverlay.displayName = "HexGridOverlay";

export default HexGridOverlay;
