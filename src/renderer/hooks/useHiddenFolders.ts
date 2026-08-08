/**
 * Folders hidden from the grid via context menu (subtree match).
 * Persisted to `wiergise:hiddenFolders` (same localStorage pattern as
 * tags) so hides survive restarts. Corrupt entries start empty.
 *
 * Extracted from App.tsx (de-monolith) — behavior unchanged.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_HIDDEN = "wiergise:hiddenFolders";

export function useHiddenFolders() {
  const [hiddenFolders, setHiddenFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_HIDDEN);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((p) => typeof p === "string"));
        }
      }
    } catch {
      /* corrupt entry — start empty */
    }
    return new Set();
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...hiddenFolders]));
  }, [hiddenFolders]);

  const toggleHideFolder = useCallback((folderPath: string) => {
    setHiddenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  return { hiddenFolders, toggleHideFolder };
}
