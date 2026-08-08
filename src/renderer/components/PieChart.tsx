// Donut/ring chart — ported from @mdrbx/nerv-ui (MIT) and adapted to
// Seele's palette + motion tokens.
//
// Adaptations vs upstream:
//  - framer-motion → motion/react; slice reveal + hover dim animate
//    opacity/scale (GPU-composited) with EASE_MECHANICAL + 0.04 stagger
//  - the custom floating hover tooltip is dropped — slices expose native
//    SVG <title> elements instead (no Tooltip component anywhere);
//    legend rows lost their hover tooltip too
//  - hover bloom dropped; tokens remapped, hexes → Seele palette,
//    fonts → var(--font-display) / var(--font-mono)
//  - added `formatValue` (bytes → "1.4 GB") for the center readout and
//    slice <title>s — raw byte counts are unreadable at donut-center size

import { forwardRef, useState } from "react";
import { motion } from "motion/react";
import { EASE_MECHANICAL } from "../motion";

export interface PieSlice {
  label: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  /** Slice data */
  slices: PieSlice[];
  /** Chart title */
  title?: string;
  /** Chart size in pixels */
  size?: number;
  /** Donut mode (hollow center) */
  donut?: boolean;
  /** Show legend */
  showLegend?: boolean;
  /** Show percentage labels */
  showLabels?: boolean;
  /** Color theme (auto-assigns colors if slices don't specify) */
  color?: "cyan" | "green" | "orange" | "mixed";
  /** Format the displayed value (e.g. bytes → "1.4 GB") for the center readout and slice titles. Defaults to the raw value. */
  formatValue?: (value: number) => string;
  /** Optional className */
  className?: string;
}

const themeColors = {
  cyan: ["#20f0ff", "#10a0b0", "#0a5a66", "#10ccdd", "#0a3344"],
  green: ["#50ff50", "#30bb30", "#0a550a", "#10cc10", "#0a330a"],
  orange: ["#ff9830", "#c87020", "#995500", "#ffbb33", "#664400"],
  mixed: ["#20f0ff", "#ff9830", "#50ff50", "#ff3030", "#ff4fd8", "#ffb700", "#0099ff"],
} as const;

export const PieChart = forwardRef<HTMLDivElement, PieChartProps>(function PieChart(
  {
    slices,
    title,
    size = 180,
    donut = false,
    showLegend = true,
    showLabels = true,
    color = "mixed",
    formatValue,
    className = "",
  },
  ref,
) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return null;

  const palette = themeColors[color];
  const displayValue = formatValue ?? ((value: number) => `${value}`);
  const cx = 50;
  const cy = 50;
  const outerR = 42;
  const innerR = donut ? 26 : 0;

  let accumulatedAngle = -90;
  const arcData = slices.map((slice, index) => {
    const pct = slice.value / total;
    const sweepDeg = pct * 360;
    const startDeg = accumulatedAngle;
    accumulatedAngle += sweepDeg;
    const endDeg = accumulatedAngle;
    const midDeg = (startDeg + endDeg) / 2;
    const sliceColor = slice.color || palette[index % palette.length];

    return { ...slice, pct, startDeg, endDeg, midDeg, sliceColor };
  });

  const degToXY = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const slicePath = (startDeg: number, endDeg: number) => {
    const start = degToXY(startDeg, outerR);
    const end = degToXY(endDeg, outerR);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;

    if (donut) {
      const innerStart = degToXY(endDeg, innerR);
      const innerEnd = degToXY(startDeg, innerR);
      return `M ${start.x} ${start.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${end.x} ${end.y} L ${innerStart.x} ${innerStart.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y} Z`;
    }

    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
  };

  return (
    <div ref={ref} className={`inline-flex flex-col items-center font-mono ${className}`}>
      {title && (
        <div
          className="mb-2 w-full border-b border-nerv-orange/25 pb-1 text-left text-[10px] uppercase tracking-[0.22em] font-bold text-nerv-orange"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </div>
      )}

      <div className="relative flex items-center gap-4 border border-white/10 bg-black/65 px-3 py-3">
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <rect x="6" y="6" width="88" height="88" fill="none" stroke="rgba(224,224,224,0.08)" strokeWidth="0.6" />
          {[18, 28, 38, 42].map((radius) => (
            <circle
              key={radius}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={0.5}
            />
          ))}
          <line x1={cx} y1={6} x2={cx} y2={94} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
          <line x1={6} y1={cy} x2={94} y2={cy} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />

          {arcData.map((arc, index) => {
            const reveal = { duration: 0.16, delay: index * 0.04, ease: EASE_MECHANICAL };
            const titleText = `${arc.label}: ${displayValue(arc.value)} (${Math.round(arc.pct * 100)}%)`;

            if (arc.pct >= 0.999) {
              return (
                <motion.circle
                  key={arc.label}
                  cx={cx}
                  cy={cy}
                  r={donut ? (outerR + innerR) / 2 : outerR / 2}
                  fill={donut ? "none" : arc.sliceColor}
                  stroke={donut ? arc.sliceColor : "none"}
                  strokeWidth={donut ? outerR - innerR : 0}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{
                    opacity: hoveredIndex === null || hoveredIndex === index ? 0.94 : 0.5,
                    scale: hoveredIndex === index ? 1.05 : 1,
                  }}
                  transition={reveal}
                  style={{ transformOrigin: `${cx}px ${cy}px`, cursor: "pointer" }}
                  tabIndex={0}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onFocus={() => setHoveredIndex(index)}
                  onBlur={() => setHoveredIndex(null)}
                >
                  <title>{titleText}</title>
                </motion.circle>
              );
            }

            return (
              <motion.path
                key={arc.label}
                d={slicePath(arc.startDeg, arc.endDeg)}
                fill={arc.sliceColor}
                stroke="#000"
                strokeWidth={0.8}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: hoveredIndex === null || hoveredIndex === index ? 0.94 : 0.5,
                  scale: hoveredIndex === index ? 1.05 : 1,
                }}
                transition={reveal}
                style={{ transformOrigin: `${cx}px ${cy}px`, cursor: "pointer" }}
                tabIndex={0}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
              >
                <title>{titleText}</title>
              </motion.path>
            );
          })}

          {donut && (
            <>
              <circle cx={cx} cy={cy} r={innerR - 1} fill="#000" fillOpacity={0.8} />
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                fill="#e8e8e4"
                fontSize={7}
                fontFamily="var(--font-mono)"
                fontWeight="bold"
              >
                {displayValue(total)}
              </text>
            </>
          )}

          {showLabels &&
            arcData
              .filter((arc) => arc.pct >= 0.05)
              .map((arc) => {
                const labelRadius = donut ? (outerR + innerR) / 2 : outerR * 0.65;
                const pos = degToXY(arc.midDeg, labelRadius);
                return (
                  <text
                    key={`${arc.label}-label`}
                    x={pos.x}
                    y={pos.y + 2}
                    textAnchor="middle"
                    fill="#000"
                    fontSize={5}
                    fontFamily="var(--font-mono)"
                    fontWeight="bold"
                  >
                    {Math.round(arc.pct * 100)}%
                  </text>
                );
              })}
        </svg>

        {showLegend && (
          <div className="space-y-1">
            {arcData.map((arc) => (
              <div
                key={arc.label}
                className="grid grid-cols-[8px_minmax(0,1fr)_34px] items-center gap-2 border-b border-white/10 pb-1 transition-colors hover:bg-white/[0.03]"
              >
                <span className="h-2 w-2 shrink-0" style={{ backgroundColor: arc.sliceColor }} />
                <span className="truncate text-[9px] uppercase tracking-[0.12em] text-nerv-text/70" title={arc.label}>
                  {arc.label}
                </span>
                <span className="ml-auto text-right text-[9px] text-nerv-muted tabular-nums">
                  {Math.round(arc.pct * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
