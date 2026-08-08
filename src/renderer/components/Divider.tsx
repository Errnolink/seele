/**
 * Divider — NERV section separator (ported from mdrbx/nerv-ui, MIT).
 *
 * Labeled horizontal/vertical rule: centered `[ LABEL ]` text on a colored
 * line (orange/green/cyan, solid/dashed/dotted). Used as inspector section
 * separators and modal section heads.
 */
import { forwardRef, type HTMLAttributes } from "react";

export interface DividerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "color"> {
  /** Optional centered label text */
  label?: string;
  /** Color theme */
  color?: "orange" | "green" | "cyan";
  /** Line style variant */
  variant?: "solid" | "dashed" | "dotted";
  /** Divider orientation */
  orientation?: "horizontal" | "vertical";
}

const colorMap = {
  orange: {
    line: "border-nerv-orange",
    text: "text-nerv-orange",
  },
  green: {
    line: "border-nerv-green",
    text: "text-nerv-green",
  },
  cyan: {
    line: "border-nerv-cyan",
    text: "text-nerv-cyan",
  },
} as const;

const variantMap = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
} as const;

export const Divider = forwardRef<HTMLDivElement, DividerProps>(
  function Divider(
    {
      label,
      color = "orange",
      variant = "solid",
      orientation = "horizontal",
      className = "",
      ...rest
    },
    ref
  ) {
    const c = colorMap[color];
    const lineStyle = variantMap[variant];
    const isVertical = orientation === "vertical";

    if (isVertical) {
      return (
        <div
          ref={ref}
          role="separator"
          aria-orientation="vertical"
          className={`
            inline-block self-stretch
            border-l ${lineStyle} ${c.line} opacity-50
            ${className}
          `}
          style={{ minHeight: "1em" }}
          {...rest}
        />
      );
    }

    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation="horizontal"
        className={`flex items-center w-full ${className}`}
        {...rest}
      >
        {label ? (
          <>
            {/* Left line */}
            <div
              className={`flex-1 border-t ${lineStyle} ${c.line} opacity-50`}
            />

            {/* Centered label */}
            <span
              className={`
                px-3 text-[10px] uppercase tracking-[0.2em] font-bold
                ${c.text} whitespace-nowrap select-none
              `}
              style={{ fontFamily: "var(--font-display)" }}
            >
              [ {label} ]
            </span>

            {/* Right line */}
            <div
              className={`flex-1 border-t ${lineStyle} ${c.line} opacity-50`}
            />
          </>
        ) : (
          <div
            className={`flex-1 border-t ${lineStyle} ${c.line} opacity-50`}
          />
        )}
      </div>
    );
  }
);
