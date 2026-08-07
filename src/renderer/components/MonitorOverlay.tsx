/**
 * MonitorOverlay — CRT monitor targeting overlay (ported from
 * mdrbx/nerv-ui, MIT, adapted).
 *
 * Scanline texture + rule-of-thirds guides + inner frame + corner brackets +
 * tick marks, meant as a subtle backdrop/frame around the viewer media
 * stage. Adaptations for Seele: LOW opacity by default (≤0.15), cyan,
 * normal density, no animated sweep, no glow layers (bloom ban), no label
 * readouts by default. Static rendering only — all GPU-safe (no keyframes).
 */
import { forwardRef, type HTMLAttributes } from "react";

type OverlayHTMLAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  | "className"
  | "color"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragOver"
  | "onAnimationStart"
>;

export interface MonitorOverlayProps extends OverlayHTMLAttributes {
  /** Color theme for guides, frame and readouts */
  color?: "orange" | "green" | "cyan" | "red";
  /** Overall overlay opacity — keep ≤ 0.15 for subtlety */
  opacity?: number;
  /** Background density */
  density?: "sparse" | "normal" | "dense";
  /** Optional upper-left readout (off by default) */
  label?: string;
  /** Optional lower-right readout (off by default) */
  secondaryLabel?: string;
  /** Optional className */
  className?: string;
}

const colorMap = {
  orange: {
    text: "#ff9830",
    scan: "rgba(255, 152, 48, 0.08)",
    guide: "rgba(255, 152, 48, 0.16)",
    frame: "rgba(255, 152, 48, 0.26)",
    inner: "rgba(255, 152, 48, 0.08)",
  },
  green: {
    text: "#50ff50",
    scan: "rgba(80, 255, 80, 0.08)",
    guide: "rgba(80, 255, 80, 0.15)",
    frame: "rgba(80, 255, 80, 0.24)",
    inner: "rgba(80, 255, 80, 0.08)",
  },
  cyan: {
    text: "#20f0ff",
    scan: "rgba(32, 240, 255, 0.08)",
    guide: "rgba(32, 240, 255, 0.15)",
    frame: "rgba(32, 240, 255, 0.24)",
    inner: "rgba(32, 240, 255, 0.08)",
  },
  red: {
    text: "#ff3030",
    scan: "rgba(255, 48, 48, 0.09)",
    guide: "rgba(255, 48, 48, 0.18)",
    frame: "rgba(255, 48, 48, 0.28)",
    inner: "rgba(255, 48, 48, 0.09)",
  },
} as const;

const densityMap = {
  sparse: 24,
  normal: 18,
  dense: 12,
} as const;

const tickOffsets = [18, 30, 42, 58, 70, 82];

export const MonitorOverlay = forwardRef<HTMLDivElement, MonitorOverlayProps>(
  function MonitorOverlay(
    {
      color = "cyan",
      opacity = 0.15,
      density = "normal",
      label,
      secondaryLabel,
      className = "",
      style,
      ...rest
    },
    ref
  ) {
    // Widen the palette to plain strings: the colorMap union would
    // combinatorially explode inside the multi-stop backgroundImage template.
    const palette: Record<
      "text" | "scan" | "guide" | "frame" | "inner",
      string
    > = colorMap[color];
    const spacing = densityMap[density];
    const rootStyle = {
      ...style,
      opacity: style?.opacity ?? opacity,
    };

    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-slot="monitor-overlay"
        className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
        style={rootStyle}
        {...rest}
      >
        {/* Scanline texture + rule-of-thirds guides (no glow layer) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              repeating-linear-gradient(
                180deg,
                transparent 0,
                transparent ${spacing - 1}px,
                ${palette.scan} ${spacing - 1}px,
                ${palette.scan} ${spacing}px
              ),
              linear-gradient(
                90deg,
                transparent 0,
                transparent calc(12% - 0.5px),
                ${palette.guide} calc(12% - 0.5px),
                ${palette.guide} calc(12% + 0.5px),
                transparent calc(12% + 0.5px),
                transparent calc(50% - 0.5px),
                ${palette.guide} calc(50% - 0.5px),
                ${palette.guide} calc(50% + 0.5px),
                transparent calc(50% + 0.5px),
                transparent calc(88% - 0.5px),
                ${palette.guide} calc(88% - 0.5px),
                ${palette.guide} calc(88% + 0.5px),
                transparent calc(88% + 0.5px)
              ),
              linear-gradient(
                180deg,
                transparent 0,
                transparent calc(16% - 0.5px),
                ${palette.guide} calc(16% - 0.5px),
                ${palette.guide} calc(16% + 0.5px),
                transparent calc(16% + 0.5px),
                transparent calc(50% - 0.5px),
                ${palette.guide} calc(50% - 0.5px),
                ${palette.guide} calc(50% + 0.5px),
                transparent calc(50% + 0.5px),
                transparent calc(84% - 0.5px),
                ${palette.guide} calc(84% - 0.5px),
                ${palette.guide} calc(84% + 0.5px),
                transparent calc(84% + 0.5px)
              )
            `,
          }}
        />

        {/* Inner frame + hard inset ring (no blur → not a glow) */}
        <div
          className="absolute inset-[8%] border"
          style={{
            borderColor: palette.frame,
            boxShadow: `inset 0 0 0 1px ${palette.inner}`,
          }}
        />

        {/* Rule-of-thirds hairlines */}
        <div
          className="absolute left-[9%] right-[9%] top-[14%] h-px"
          style={{ backgroundColor: palette.frame }}
        />
        <div
          className="absolute left-[9%] right-[9%] bottom-[14%] h-px"
          style={{ backgroundColor: palette.frame }}
        />
        <div
          className="absolute top-[9%] bottom-[9%] left-[14%] w-px"
          style={{ backgroundColor: palette.frame }}
        />
        <div
          className="absolute top-[9%] bottom-[9%] right-[14%] w-px"
          style={{ backgroundColor: palette.frame }}
        />

        {/* Corner brackets */}
        <div
          className="absolute left-[7.5%] top-[7.5%] h-7 w-7 border-l border-t"
          style={{ borderColor: palette.text }}
        />
        <div
          className="absolute right-[7.5%] top-[7.5%] h-7 w-7 border-r border-t"
          style={{ borderColor: palette.text }}
        />
        <div
          className="absolute left-[7.5%] bottom-[7.5%] h-7 w-7 border-b border-l"
          style={{ borderColor: palette.text }}
        />
        <div
          className="absolute right-[7.5%] bottom-[7.5%] h-7 w-7 border-b border-r"
          style={{ borderColor: palette.text }}
        />

        {/* Edge tick marks */}
        {tickOffsets.map((offset) => (
          <div
            key={`left-${offset}`}
            className="absolute left-[8.8%] h-px w-4"
            style={{
              top: `${offset}%`,
              backgroundColor: palette.frame,
            }}
          />
        ))}
        {tickOffsets.map((offset) => (
          <div
            key={`right-${offset}`}
            className="absolute right-[8.8%] h-px w-4"
            style={{
              top: `${offset}%`,
              backgroundColor: palette.frame,
            }}
          />
        ))}

        {label && (
          <div
            data-slot="monitor-label"
            className="absolute left-[10%] top-[14%] -translate-y-1/2 bg-black/85 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.22em]"
            style={{
              color: palette.text,
              fontFamily: "var(--font-mono)",
              boxShadow: `0 0 0 1px ${palette.frame} inset`,
            }}
          >
            {label}
          </div>
        )}

        {secondaryLabel && (
          <div
            data-slot="monitor-secondary-label"
            className="absolute bottom-[14%] right-[10%] translate-y-1/2 bg-black/85 px-2 py-1 text-[9px] uppercase tracking-[0.2em]"
            style={{
              color: palette.text,
              fontFamily: "var(--font-mono)",
              boxShadow: `0 0 0 1px ${palette.frame} inset`,
            }}
          >
            {secondaryLabel}
          </div>
        )}
      </div>
    );
  }
);
