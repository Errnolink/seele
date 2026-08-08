/**
 * Favorites — runtime-mutated set of file paths (dynamic membership; Set is
 * the correct type, matching the rule's guidance). `toggleFavorite` returns
 * whether the file was ADDED so callers can toast outside the updater
 * (StrictMode-safe). `toggleFavoriteMany` flips a whole batch in ONE state
 * update so the grid re-renders once, not N times.
 *
 * Extracted from App.tsx (de-monolith) — behavior unchanged.
 */
import { useCallback, useState } from "react";
import type { MediaFile, MediaId } from "../types";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<MediaId>>(new Set());

  /** Toggle one file; returns true when ADDED, false when REMOVED. */
  const toggleFavorite = useCallback(
    (file: MediaFile) => {
      const adding = !favorites.has(file.filePath);
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(file.filePath)) next.delete(file.filePath);
        else next.add(file.filePath);
        return next;
      });
      return adding;
    },
    [favorites],
  );

  /** Flip membership for every path in `paths` in a single setState. */
  const toggleFavoriteMany = useCallback((paths: Iterable<string>) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (next.has(p)) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }, []);

  return { favorites, toggleFavorite, toggleFavoriteMany };
}
