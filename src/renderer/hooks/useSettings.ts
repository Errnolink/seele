/**
 * App settings — persisted via the main process (settingsStore). Loads on
 * mount; on a true first launch (no file on disk) adopts the OS-level
 * reduced-motion preference as the default. `updateSettings` applies a
 * patch locally and pushes it to the main process (best-effort).
 *
 * Extracted from App.tsx (de-monolith) — behavior unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import type { AppSettings } from "../../../electron/settings";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Load persisted settings on mount. On a true first launch (no file on
  // disk), adopt the OS-level reduced-motion preference as the default.
  useEffect(() => {
    void window.scanAPI
      .getSettings()
      .then((res) => {
        if (
          !res.exists &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          setSettings({ ...res.settings, reduceMotion: true });
          void window.scanAPI.setSettings({ reduceMotion: true });
        } else {
          setSettings(res.settings);
        }
      })
      .catch(() => {
        /* defaults already in state — best-effort */
      });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    void window.scanAPI.setSettings(patch).catch(() => {
      /* main also clamps — best-effort */
    });
  }, []);

  return { settings, updateSettings };
}
