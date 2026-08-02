import type { AppSettings } from "../../electron/settings";

/**
 * Renderer-side copy of the persisted defaults. The main process owns the
 * settings file (electron/settings.ts); this mirrors its DEFAULT_SETTINGS
 * so the renderer has initial state before the first `settings:get` round
 * trip resolves.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  reduceMotion: false,
  dialogBlur: true,
  decodeConcurrency: 4,
  overscan: 600,
};
