/**
 * Grid selection — runtime-mutated set of selected file paths (dynamic
 * membership; Set is correct here). Semantics preserved from App.tsx:
 * ctrl/meta toggles, shift is additive, plain click clears + selects.
 *
 * Extracted from App.tsx (de-monolith) — behavior unchanged.
 */
import { useCallback, useState } from "react";
import type { MediaId } from "../types";

export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<MediaId>>(new Set());

  const toggleSelect = useCallback((filePath: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        // toggle
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
      } else if (e.shiftKey) {
        // additive
        next.add(filePath);
      } else {
        // plain click → exclusive select
        next.clear();
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /** Drop paths from the selection (after they were moved/trashed away). */
  const removeMany = useCallback((paths: Iterable<string>) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of paths) next.delete(p);
      return next;
    });
  }, []);

  return { selectedIds, toggleSelect, clearSelection, removeMany };
}
