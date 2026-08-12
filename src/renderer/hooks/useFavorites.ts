/**
 * Favorites — runtime-mutated set of file paths (dynamic membership; Set is
 * the correct type, matching the rule's guidance). `toggleFavorite` returns
 * whether the file was ADDED so callers can toast outside the updater
 * (StrictMode-safe). `toggleFavoriteMany` flips a whole batch in ONE state
 * update so the grid re-renders once, not N times.
 *
 * Extracted from App.tsx (de-monolith) — behavior unchanged.
 */
import { useCallback, useRef, useState } from "react";
import type { MediaFile, MediaId } from "../types";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<MediaId>>(new Set());
  // Latest-value ref so `toggleFavorite` can read current membership
  // without listing `favorites` as a dependency. With that dependency the
  // callback got a new identity on every star, which propagated through
  // App's toast wrapper into MasonryGrid and re-rendered every mounted
  // tile instead of just the one that changed.
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;

  /** Toggle one file; returns true when ADDED, false when REMOVED. */
  const toggleFavorite = useCallback((file: MediaFile) => {
    const adding = !favoritesRef.current.has(file.filePath);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(file.filePath)) next.delete(file.filePath);
      else next.add(file.filePath);
      return next;
    });
    return adding;
  }, []);

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
