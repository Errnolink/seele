/**
 * BatchTagDialog — modal grid to assign/remove classification tags across
 * multiple marked items (v2.5 §Module 8.4).
 *
 * Shows every available tag as a toggleable cell. Clicking a tag toggles
 * its assignment on ALL selected files at once via `onBatchToggle`.
 * Each tag shows how many of the currently-selected files already carry
 * it, so the user can see the effect before committing.
 */
import { useEffect, useState } from "react";
import type { TagDef } from "../hooks/useTags";

interface BatchTagDialogProps {
  /** All defined tags. */
  tags: TagDef[];
  /** File paths the batch applies to (the current selection). */
  filePaths: string[];
  /**
   * For each selected file path, the set of tag keys currently assigned.
   * Used to compute per-tag counts and the initial toggle state.
   */
  getFileTags: (filePath: string) => TagDef[];
  /** Toggle a tag on/off across the whole batch. */
  onBatchToggle: (filePaths: string[], tagKey: string, assign: boolean) => void;
  onClose: () => void;
}

export function BatchTagDialog({
  tags,
  filePaths,
  getFileTags,
  onBatchToggle,
  onClose,
}: BatchTagDialogProps) {
  // Track which tags are "on" for the batch. A tag is on if every selected
  // file has it; off otherwise. Local state keeps the grid snappy between
  // the toggle click and the parent's re-render.
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const t of tags) {
      const count = countWithTag(filePaths, t.key, getFileTags);
      init[t.key] = count === filePaths.length;
    }
    return init;
  });

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (tag: TagDef) => {
    const next = !checked[tag.key];
    setChecked((prev) => ({ ...prev, [tag.key]: next }));
    onBatchToggle(filePaths, tag.key, next);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg border-2 border-nerv-lime bg-nerv-panel eva-cut shadow-[0_0_30px_rgba(201,233,138,0.3)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-nerv-border p-4">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-lime">
              <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
              <circle cx="7" cy="7" r="1.2" fill="currentColor" />
            </svg>
            <div>
              <h3 className="font-mono text-[13px] font-bold text-nerv-text uppercase tracking-wider">
                Batch Tag Assignment
              </h3>
              <p className="text-[9px] text-nerv-muted font-mono">
                {filePaths.length} file{filePaths.length === 1 ? "" : "s"} selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-nerv-muted hover:text-nerv-text cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tag grid */}
        <div className="p-4">
          {tags.length === 0 ? (
            <div className="text-center py-8 font-mono text-[11px] text-nerv-muted">
              No tags defined. Create tags in the sidebar first.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
              {tags.map((t) => {
                const count = countWithTag(filePaths, t.key, getFileTags);
                const has = checked[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => toggle(t)}
                    className="flex items-center justify-between p-2 text-left text-[10px] transition-colors cursor-pointer border"
                    style={
                      has
                        ? { background: t.bg, color: t.color, borderColor: t.border }
                        : undefined
                    }
                    data-has={has ? "" : undefined}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2 h-2 shrink-0"
                        style={{
                          background: has ? t.color : t.border,
                          boxShadow: has ? `0 0 6px ${t.color}` : "none",
                        }}
                      />
                      <span className={`truncate font-bold ${has ? "" : "text-nerv-text-dim"}`}>
                        {t.label}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-[8.5px] opacity-70 tabular-nums">
                        {count}/{filePaths.length}
                      </span>
                      {has && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[8.5px] text-nerv-muted font-mono mt-3">
            Click a tag to apply it to all selected files. Click again to remove.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-nerv-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="bg-nerv-lime px-4 py-1.5 text-[10px] font-bold text-black uppercase tracking-wider shadow-[0_0_12px_rgba(201,233,138,0.4)] hover:brightness-110 cursor-pointer transition-[filter]"
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}

/** Count how many of the selected files already carry `tagKey`. */
function countWithTag(
  filePaths: string[],
  tagKey: string,
  getFileTags: (p: string) => TagDef[],
): number {
  let n = 0;
  for (const p of filePaths) {
    if (getFileTags(p).some((t) => t.key === tagKey)) n++;
  }
  return n;
}

export default BatchTagDialog;
