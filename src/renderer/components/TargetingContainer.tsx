/**
 * TargetingContainer — NERV targeting frame (ported from mdrbx/nerv-ui, MIT).
 *
 * Bracketed modal-panel frame: L-brackets in each corner, a centered label
 * on the top edge, faint color readout top-right, and an optional crosshair
 * grid backdrop. Pure lines — no glow, black-only shading. Wraps children
 * in a scrollable flex column so modal bodies (header/list/footer) lay out
 * and scroll inside the frame.
 */
import { type ReactNode, forwardRef, type HTMLAttributes } from "react";
import { motion, type MotionProps } from "motion/react";
import { PANEL_ENTER } from "../motion";

type FrameHTMLAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  | "children"
  | "className"
  | "color"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragOver"
  | "onAnimationStart"
>;

export interface TargetingContainerProps extends FrameHTMLAttributes {
  children: ReactNode;
  /** Label displayed on the top edge of the frame */
  label?: string;
  /** Show crosshair grid background (off by default) */
  showCrosshairs?: boolean;
  /** Color theme for brackets and grid */
  color?: "orange" | "green" | "cyan" | "red" | "amber" | "lime";
  /** Size of L-brackets in pixels */
  bracketSize?: number;
  /** Optional className */
  className?: string;
  /** Optional motion props — override the default fade (PANEL_ENTER). */
  initial?: MotionProps["initial"];
  animate?: MotionProps["animate"];
  exit?: MotionProps["exit"];
  transition?: MotionProps["transition"];
}

const bracketColors = {
  orange: "#ff9830",
  green: "#50ff50",
  cyan: "#20f0ff",
  red: "#ff3030",
  amber: "#ffb700",
  lime: "#a3e635",
} as const;

export const TargetingContainer = forwardRef<
  HTMLDivElement,
  TargetingContainerProps
>(function TargetingContainer(
  {
    children,
    label,
    showCrosshairs = false,
    color = "orange",
    bracketSize = 18,
    className = "",
    initial,
    animate,
    exit,
    transition,
    style,
    ...rest
  },
  ref
) {
  const c = bracketColors[color];

  return (
    <motion.div
      ref={ref}
      initial={initial ?? { opacity: 0 }}
      animate={animate ?? { opacity: 1, transition: PANEL_ENTER }}
      exit={exit}
      transition={transition}
      className={`relative border bg-black/80 px-3 pb-3 pt-4 ${className}`}
      style={{
        ...style,
        borderColor: `${c}55`,
        boxShadow: `inset 0 0 0 1px ${c}12`,
      }}
      {...rest}
    >
      {/* Crosshair grid backdrop (faint lines, no glow) */}
      {showCrosshairs && (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage: `
              linear-gradient(${c} 0.5px, transparent 0.5px),
              linear-gradient(90deg, ${c} 0.5px, transparent 0.5px)
            `,
            backgroundSize: "28px 28px, 28px 28px",
          }}
        />
      )}

      {/* Horizontal guide rails */}
      <div
        className="absolute left-0 right-0 top-[18px] h-px pointer-events-none"
        style={{ backgroundColor: `${c}55` }}
      />
      <div
        className="absolute left-0 right-0 bottom-[10px] h-px pointer-events-none"
        style={{ backgroundColor: `${c}22` }}
      />

      {/* L-brackets — plain 1px lines, no glow */}
      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          width: bracketSize,
          height: bracketSize,
          borderTop: `1px solid ${c}`,
          borderLeft: `1px solid ${c}`,
        }}
      />
      <div
        className="absolute top-0 right-0 pointer-events-none"
        style={{
          width: bracketSize,
          height: bracketSize,
          borderTop: `1px solid ${c}`,
          borderRight: `1px solid ${c}`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 pointer-events-none"
        style={{
          width: bracketSize,
          height: bracketSize,
          borderBottom: `1px solid ${c}`,
          borderLeft: `1px solid ${c}`,
        }}
      />
      <div
        className="absolute bottom-0 right-0 pointer-events-none"
        style={{
          width: bracketSize,
          height: bracketSize,
          borderBottom: `1px solid ${c}`,
          borderRight: `1px solid ${c}`,
        }}
      />

      {/* Color readout — top-right */}
      <div
        className="absolute right-3 top-[18px] flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-white/30 pointer-events-none"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <span>{color}</span>
        <span className="h-px w-6 bg-current opacity-40" />
      </div>

      {/* Centered label on the top edge */}
      {label && (
        <div
          className="absolute left-3 top-0 z-20 -translate-y-1/2 bg-black px-2 text-[10px] uppercase tracking-[0.24em] font-bold"
          style={{ color: c, fontFamily: "var(--font-display)" }}
        >
          {label}
        </div>
      )}

      {/* Content — flex column so modal bodies can scroll (min-h-0) */}
      <div className={`relative z-10 flex min-h-0 flex-col ${label ? "mt-1.5" : ""}`}>
        {children}
      </div>
    </motion.div>
  );
});
