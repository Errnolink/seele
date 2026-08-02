import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/**
 * App settings (performance & accessibility knobs).
 *
 * Persisted as a tiny JSON file in userData so the choices survive
 * restarts. The main process owns the file (it needs decodeConcurrency
 * at startup to size the sharp/ffmpeg semaphores); the renderer reads
 * it via `settings:get` and pushes patches via `settings:set`.
 *
 * See issues.md — every knob is a real in-app setting, not a constant
 * someone has to edit and rebuild.
 */

export interface AppSettings {
  /** Disable scanline/glow/pulse decorative animations + cheap shimmer. */
  reduceMotion: boolean;
  /** backdrop-blur on modal overlays. */
  dialogBlur: boolean;
  /** Concurrent sharp decodes; ffmpeg gets ~half. 1–6, default 4. */
  decodeConcurrency: number;
  /** Masonry overscan band in px (scroll buffer). */
  overscan: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  reduceMotion: false,
  dialogBlur: true,
  decodeConcurrency: 4,
  overscan: 600,
};

const SETTINGS_FILENAME = "settings.json";

/** Clamp a loaded value back into a sane range — a hand-edited or stale
 *  settings file must never feed a bogus concurrency/overscan value
 *  into the main process. */
function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

let settingsPath = "";
let loaded = false;
let current: AppSettings = { ...DEFAULT_SETTINGS };
let exists = false;

/** Lazily resolve the settings file path under userData. */
function ensurePath(): string {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath("userData"), SETTINGS_FILENAME);
  }
  return settingsPath;
}

/** Read the settings file from disk (once per process). */
function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(ensurePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    exists = true;
    current = {
      reduceMotion: parsed.reduceMotion === true,
      dialogBlur: parsed.dialogBlur !== false,
      decodeConcurrency: clampNumber(
        parsed.decodeConcurrency,
        1,
        6,
        DEFAULT_SETTINGS.decodeConcurrency,
      ),
      overscan: clampNumber(parsed.overscan, 100, 1200, DEFAULT_SETTINGS.overscan),
    };
  } catch {
    // Corrupt or missing — keep defaults.
    current = { ...DEFAULT_SETTINGS };
    exists = false;
  }
}

/** Atomically write the settings file. Tiny + rare, sync is fine. */
function persist(): void {
  try {
    const p = ensurePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), "utf-8");
    fs.renameSync(tmp, p);
    exists = true;
  } catch (e) {
    console.warn("settings persist failed:", e);
  }
}

/** Return the current settings plus whether a persisted file exists.
 *  `exists: false` tells the renderer this is a first launch — it can
 *  then adopt the OS-level `prefers-reduced-motion` default. */
export function loadSettings(): { settings: AppSettings; exists: boolean } {
  load();
  return { settings: { ...current }, exists };
}

/** Get the current settings (main-process convenience). */
export function getSettings(): AppSettings {
  load();
  return { ...current };
}

/** Apply a partial patch, persist, and return the new settings. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  load();
  const next: AppSettings = {
    reduceMotion: patch.reduceMotion === true ? true : patch.reduceMotion === false ? false : current.reduceMotion,
    dialogBlur: patch.dialogBlur === true ? true : patch.dialogBlur === false ? false : current.dialogBlur,
    decodeConcurrency:
      typeof patch.decodeConcurrency === "number"
        ? clampNumber(patch.decodeConcurrency, 1, 6, current.decodeConcurrency)
        : current.decodeConcurrency,
    overscan:
      typeof patch.overscan === "number"
        ? clampNumber(patch.overscan, 100, 1200, current.overscan)
        : current.overscan,
  };
  current = next;
  persist();
  return { ...current };
}

/** Flush on quit (mirrors mediaCache.flush). */
export function flush(): void {
  load();
  persist();
}
