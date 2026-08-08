/**
 * SettingsModal — performance & accessibility knobs (issues.md item 6).
 *
 * The actual deliverable of the performance pass: every expensive-or-not
 * behavior in the app is a live toggle/slider here, persisted to
 * settings.json in userData via `window.scanAPI.setSettings`. The user
 * flips switches and feels the difference immediately — no code edits,
 * no rebuilds.
 *
 * Controls:
 *  - Performance Mode (master) — sets Reduce Motion on, Dialog Blur off,
 *    Decode Concurrency 2, Scroll Buffer LOW, all at once. The switch
 *    state reflects whether the current values match the preset, so
 *    fine-tuning individual controls underneath naturally unsets it.
 *  - Reduce Motion — kills scanline/glow/pulse animations + switches the
 *    shimmer to the cheap opacity pulse.
 *  - Dialog Blur — removes full-viewport backdrop-blur from modals.
 *  - Decode Concurrency — feeds the sharp/ffmpeg semaphores in main.
 *  - Scroll Buffer — the masonry overscan band.
 */
import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { OVERLAY_ENTER, OVERLAY_EXIT, PANEL_ENTER, PANEL_EXIT } from "../motion";
import type { AppSettings } from "../../../electron/settings";

export interface SettingsModalProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

/** Scroll-buffer presets in px. */
const OVERSCAN_LOW = 200;
const OVERSCAN_MED = 400;
const OVERSCAN_HIGH = 600;

const SCROLL_PRESETS = [
  { value: "LOW", px: OVERSCAN_LOW, title: "Less offscreen rendering, more pop-in" },
  { value: "MED", px: OVERSCAN_MED, title: "Balanced" },
  { value: "HIGH", px: OVERSCAN_HIGH, title: "Smoothest scroll, more work offscreen" },
] as const;

type ScrollLevel = (typeof SCROLL_PRESETS)[number]["value"];

function scrollLevelOf(px: number): ScrollLevel {
  if (px <= OVERSCAN_LOW + 25) return "LOW";
  if (px <= OVERSCAN_MED + 25) return "MED";
  return "HIGH";
}

/** Does the current combo match the Performance Mode preset? */
function isPerformanceMode(s: AppSettings): boolean {
  return (
    s.reduceMotion === true &&
    s.dialogBlur === false &&
    s.decodeConcurrency === 2 &&
    scrollLevelOf(s.overscan) === "LOW"
  );
}

const PERF_PRESET_ON: Partial<AppSettings> = {
  reduceMotion: true,
  dialogBlur: false,
  decodeConcurrency: 2,
  overscan: OVERSCAN_LOW,
};

const PERF_PRESET_OFF: Partial<AppSettings> = {
  reduceMotion: false,
  dialogBlur: true,
  decodeConcurrency: 4,
  overscan: OVERSCAN_HIGH,
};

/** Small NERV toggle — ON takes the lime bevel, OFF sits dim. */
function EvaToggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-[5px]">
      <span className="text-[9px] font-bold tracking-[0.25em] text-nerv-muted mr-1">
        {label}
      </span>
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(true)}
        className={`eva-ticket h-7 px-3 text-[10px] font-bold tracking-[0.18em] uppercase transition-[filter] duration-150 ${
          value ? "eva-fill-lime" : "eva-dim"
        }`}
      >
        ON
      </button>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(false)}
        className={`eva-ticket h-7 px-3 text-[10px] font-bold tracking-[0.18em] uppercase transition-[filter] duration-150 ${
          !value ? "eva-fill-red" : "eva-dim"
        }`}
      >
        OFF
      </button>
    </div>
  );
}

/** A labeled settings row: title + description on the left, control right. */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3 border-b border-nerv-border/60">
      <div className="min-w-0">
        <div className="text-[11px] font-bold tracking-widest uppercase text-nerv-text">
          {title}
        </div>
        <div className="text-[9px] text-nerv-muted mt-0.5 leading-relaxed">
          {desc}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onChange,
  onClose,
}) => {
  const perfMode = isPerformanceMode(settings);

  // Escape closes (mirrors the other overlays' behavior).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const level = scrollLevelOf(settings.overscan);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: OVERLAY_ENTER }}
      exit={{ opacity: 0, transition: OVERLAY_EXIT }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 1.02 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: PANEL_ENTER }}
        exit={{ opacity: 0, y: 6, scale: 0.99, transition: PANEL_EXIT }}
        className="relative w-full max-w-2xl border border-nerv-orange/60 bg-nerv-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Orange corner brackets */}
        <div className="pointer-events-none absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-nerv-orange" />
        <div className="pointer-events-none absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-nerv-orange" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-nerv-orange" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-nerv-orange" />

        {/* Header strip */}
        <div className="flex items-center justify-between border-b border-nerv-border px-4 py-2">
          <span className="text-[9px] uppercase tracking-[0.25em] phosphor-dim">
            SEELE // PERFORMANCE CONFIG
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[9px] font-mono tracking-widest text-nerv-muted hover:text-nerv-amber transition-colors"
          >
            ESC ✕
          </button>
        </div>

        {/* Performance Mode master */}
        <div className="flex items-center justify-between gap-6 px-4 py-3 border-b border-nerv-orange/40 bg-nerv-orange/5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold tracking-widest uppercase text-nerv-orange">
              Performance Mode
            </div>
            <div className="text-[9px] text-nerv-muted mt-0.5 leading-relaxed">
              One switch — Reduce Motion ON, Dialog Blur OFF, Decode ×2,
              Scroll Buffer LOW. Individual controls stay adjustable below.
            </div>
          </div>
          <EvaToggle
            label="MASTER"
            value={perfMode}
            onChange={(v) => onChange(v ? PERF_PRESET_ON : PERF_PRESET_OFF)}
          />
        </div>

        {/* Reduce Motion */}
        <SettingRow
          title="Reduce Motion"
          desc="Disables the scanline overlay + glow/pulse animations and switches
                the thumbnail shimmer to a cheap opacity pulse."
        >
          <EvaToggle
            label=""
            value={settings.reduceMotion}
            onChange={(v) => onChange({ reduceMotion: v })}
          />
        </SettingRow>

        {/* Dialog Blur */}
        <SettingRow
          title="Dialog Blur"
          desc="Full-viewport backdrop blur on modal overlays is one of the most
                GPU-expensive effects — OFF keeps just the dark overlay."
        >
          <EvaToggle
            label=""
            value={settings.dialogBlur}
            onChange={(v) => onChange({ dialogBlur: v })}
          />
        </SettingRow>

        {/* Decode Concurrency */}
        <SettingRow
          title="Decode Concurrency"
          desc="Parallel thumbnail decodes (sharp) — ffmpeg uses about half.
                Lower on a weaker CPU; takes effect immediately."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={settings.decodeConcurrency}
              onChange={(e) =>
                onChange({ decodeConcurrency: Number(e.target.value) })
              }
              className="eva-slider w-28"
              aria-label="Decode concurrency"
            />
            <span className="text-nerv-amber text-[10px] font-bold tabular-nums w-16 text-right">
              {settings.decodeConcurrency}
              <span className="text-nerv-muted font-normal">
                {" "}
                (×{settings.decodeConcurrency} shp · ×
                {Math.max(1, Math.round(settings.decodeConcurrency / 2))} ffm)
              </span>
            </span>
          </div>
        </SettingRow>

        {/* Scroll Buffer */}
        <SettingRow
          title="Scroll Buffer"
          desc="Overscan band above/below the viewport. LOWER renders less
                offscreen during scroll at the cost of more visible pop-in."
        >
          <div className="flex items-center gap-[5px]">
            {SCROLL_PRESETS.map((p) => {
              const active = p.value === level;
              return (
                <button
                  key={p.value}
                  type="button"
                  title={p.title}
                  aria-pressed={active}
                  onClick={() => onChange({ overscan: p.px })}
                  className={`eva-ticket h-7 px-3 text-[10px] font-bold tracking-[0.18em] uppercase transition-[filter] duration-150 ${
                    active ? "eva-fill-amber" : "eva-dim"
                  }`}
                >
                  {p.value}
                </button>
              );
            })}
            <span className="text-nerv-muted text-[9px] tabular-nums w-12 text-right">
              {settings.overscan}px
            </span>
          </div>
        </SettingRow>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[8.5px] text-nerv-muted font-mono">
            PERSISTS IN USERDATA / SETTINGS.JSON · SURVIVES RESTART
          </span>
          <button
            type="button"
            onClick={() => onChange(PERF_PRESET_OFF)}
            className="text-[9px] font-mono tracking-widest text-nerv-muted hover:text-nerv-red transition-colors"
          >
            RESET DEFAULTS
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default SettingsModal;
