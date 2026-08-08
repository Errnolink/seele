/**
 * Badge — NERV chip (ported from mdrbx/nerv-ui, MIT).
 *
 * Centralizes the chip standard (`tag-chip eva-cut px-1.5 py-0.5 text-[8px]
 * font-bold tracking-wider`) with semantic color variants mapped to Seele
 * nerv-* tokens. Size is sm only (chip size-equality rule — one size for
 * every chip in the app). Optional `removable` × button.
 */
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

export interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  /** Badge variant */
  variant?: "default" | "success" | "warning" | "danger" | "info";
  /** Badge content */
  label: ReactNode;
  /** Size preset — sm only (chip size-equality rule). */
  size?: "sm";
  /** Show remove button */
  removable?: boolean;
  /** Remove handler */
  onRemove?: () => void;
  /** Additional class names */
  className?: string;
}

const variantMap = {
  default: "bg-nerv-orange text-black",
  success: "bg-nerv-green text-black",
  warning: "bg-nerv-amber text-black",
  danger: "border border-nerv-red/40 bg-nerv-red/10 text-nerv-red",
  info: "bg-nerv-cyan text-black",
} as const;

const sizeMap = {
  sm: "px-1.5 py-0.5 text-[8px]",
} as const;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    variant = "default",
    label,
    size = "sm",
    removable = false,
    onRemove,
    className = "",
    ...rest
  },
  ref
) {
  return (
    <span
      ref={ref}
      className={[
        // Chip standard (size-equality rule — keep in this exact order).
        "tag-chip eva-cut",
        sizeMap[size],
        "font-bold tracking-wider",
        variantMap[variant],
        // Flex only when the × button is present (single-child chips stay
        // a plain inline span so refactored chips keep their exact classes).
        removable ? "inline-flex items-center gap-1" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {label}
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className={`
            text-current leading-none
            opacity-60 hover:opacity-100
            transition-opacity duration-100 cursor-pointer
          `}
          style={{ fontFamily: "var(--font-mono)" }}
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
});
