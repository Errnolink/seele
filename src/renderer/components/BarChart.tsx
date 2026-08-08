// Horizontal segmented bar chart — ported from @mdrbx/nerv-ui (MIT) and
// adapted to Seele's palette + motion tokens.
//
// Adaptations vs upstream:
//  - horizontal direction only (the only direction Seele uses) — the
//    vertical branch, `direction`, and `height` props were dropped
//  - framer-motion → motion/react; the fill reveal animates `scaleX`
//    (GPU-composited) with EASE_MECHANICAL + 0.04 stagger instead of
//    animating `width`
//  - Tooltip stripped — each row is a <button> with an aria-label when
//    `onBarClick` is provided, so the AnalyticsModal can open media
//  - hover bloom dropped (no box-shadow glow) — crisp ring-less
//    brightness + row highlight only
//  - tokens remapped (nerv-mid-gray→nerv-border-highlight, …), hexes →
//    Seele palette, fonts → var(--font-display) / var(--font-mono)
//  - added `formatValue` (bytes → "1.4 GB") so byte values don't print raw
//  - `showGrid` now defaults to off — the modal's chart reads busy with
//    lane ticks on top of the segmented fill

import { forwardRef } from "react";
import { motion } from "motion/react";
import { EASE_MECHANICAL } from "../motion";

export interface BarChartBar {
  label: string;
  value: number;
  /** Optional override color for this bar */
  color?: string;
}

export interface BarChartProps {
  /** Bar data */
  bars: BarChartBar[];
  /** Max value for scale (auto-detected if omitted) */
  maxValue?: number;
  /** Color theme */
  color?: "cyan" | "green" | "orange" | "red" | "magenta";
  /** Chart title */
  title?: string;
  /** Show grid lines */
  showGrid?: boolean;
  /** Show value labels on bars */
  showValues?: boolean;
  /** Animation stagger delay in seconds */
  stagger?: number;
  /** Unit suffix for values (e.g. "%", "ms") */
  unit?: string;
  /** Segmented LCD-cell look with discrete blocks */
  segmented?: boolean;
  /** Optional className */
  className?: string;
  /** Format the displayed value (e.g. bytes → "1.4 GB"). Defaults to `${value}${unit}`. */
  formatValue?: (value: number) => string;
  /** Called when a bar row is clicked. */
  onBarClick?: (bar: BarChartBar, index: number) => void;
}

const colorMap = {
  cyan: { bar: "#20f0ff", text: "text-nerv-cyan", grid: "rgba(32,240,255,0.12)", lane: "rgba(32,240,255,0.06)" },
  green: { bar: "#50ff50", text: "text-nerv-green", grid: "rgba(80,255,80,0.12)", lane: "rgba(80,255,80,0.06)" },
  orange: { bar: "#ff9830", text: "text-nerv-orange", grid: "rgba(255,152,48,0.12)", lane: "rgba(255,152,48,0.06)" },
  red: { bar: "#ff3030", text: "text-nerv-red", grid: "rgba(255,48,48,0.12)", lane: "rgba(255,48,48,0.06)" },
  magenta: { bar: "#ff4fd8", text: "text-nerv-magenta", grid: "rgba(255,79,216,0.12)", lane: "rgba(255,79,216,0.06)" },
} as const;

export const BarChart = forwardRef<HTMLDivElement, BarChartProps>(function BarChart(
  {
    bars,
    maxValue,
    color = "cyan",
    title,
    showGrid = false,
    showValues = true,
    stagger = 0.04,
    unit = "",
    segmented = true,
    className = "",
    formatValue,
    onBarClick,
  },
  ref,
) {
  const c = colorMap[color];
  const max = maxValue ?? Math.max(1, ...bars.map((bar) => bar.value));
  const gridLines = 4;
  const displayValue = formatValue ?? ((value: number) => `${value}${unit}`);

  return (
    <div ref={ref} className={`font-mono ${className}`}>
      {title && (
        <div
          className={`mb-2 border-b border-current/25 pb-1 text-[10px] uppercase tracking-[0.22em] font-bold ${c.text}`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </div>
      )}
      <div className="space-y-1.5">
        {bars.map((bar, index) => {
          const pct = Math.min((bar.value / max) * 100, 100);
          const barColor = bar.color || c.bar;
          const valueText = displayValue(bar.value);

          const row = (
            <>
              <span className="truncate text-[9px] uppercase tracking-[0.15em] text-nerv-text/58 transition-colors group-hover:text-nerv-text">
                {bar.label}
              </span>
              <span
                className="relative h-3 overflow-hidden border bg-black/70"
                style={{ borderColor: `${barColor}30` }}
              >
                <span className="absolute inset-0" style={{ backgroundColor: c.lane }} />
                {showGrid &&
                  Array.from({ length: gridLines }).map((_, gridIndex) => (
                    <span
                      key={gridIndex}
                      className="absolute top-0 bottom-0 w-px"
                      style={{
                        left: `${((gridIndex + 1) / (gridLines + 1)) * 100}%`,
                        backgroundColor: c.grid,
                      }}
                    />
                  ))}
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.16, delay: index * stagger, ease: EASE_MECHANICAL }}
                  className="absolute inset-y-0 left-0 origin-left transition-[filter] duration-150 group-hover:brightness-125"
                  style={{
                    width: `${pct}%`,
                    ...(segmented
                      ? {
                          backgroundImage: `repeating-linear-gradient(90deg, ${barColor} 0px, ${barColor} 7px, transparent 7px, transparent 9px)`,
                        }
                      : { backgroundColor: barColor }),
                    borderRight: `1px solid ${barColor}`,
                  }}
                />
              </span>
              {showValues && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12, delay: index * stagger + 0.1, ease: "easeOut" }}
                  className={`text-right text-[9px] ${c.text} tabular-nums`}
                >
                  {valueText}
                </motion.span>
              )}
            </>
          );

          const gridClass = "grid w-full min-w-0 items-center gap-2";
          const gridStyle = { gridTemplateColumns: "78px minmax(0,1fr) 48px" };

          return onBarClick ? (
            <button
              key={`${bar.label}-${index}`}
              type="button"
              onClick={() => onBarClick(bar, index)}
              aria-label={`${bar.label}: ${valueText}`}
              className={`${gridClass} group cursor-pointer bg-transparent p-0 text-left hover:bg-nerv-panel-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-nerv-orange/50`}
              style={gridStyle}
            >
              {row}
            </button>
          ) : (
            <div key={`${bar.label}-${index}`} className={`${gridClass} group`} style={gridStyle}>
              {row}
            </div>
          );
        })}
      </div>
    </div>
  );
});
