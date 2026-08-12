import { memo, useState } from "react";

export interface ActivityEntry {
  id: number;
  action: "move" | "trash" | "rename";
  fileName: string;
  detail: string;
  ok: boolean;
  timestamp: number;
  /** Absolute path before the operation (move/rename) — powers revert. */
  fromPath?: string;
  /** Absolute path after the operation (move/rename) — powers revert. */
  toPath?: string;
}

export interface ActivityLogProps {
  entries: ActivityEntry[];
  onClear: () => void;
  /** Open the full session audit trail (the modal that can revert an op). */
  onOpenFullLog: () => void;
}

const ACTION_META: Record<ActivityEntry["action"], { label: string; icon: string; color: string }> = {
  move: { label: "MOVED", icon: "⇥", color: "text-nerv-lime" },
  trash: { label: "TRASHED", icon: "⌫", color: "text-nerv-red" },
  rename: { label: "RENAMED", icon: "✎", color: "text-nerv-cyan" },
};

/**
 * Collapsible activity log panel. Shows recent file operations for the
 * current session. Floats in the bottom-right corner.
 */
export const ActivityLog: React.FC<ActivityLogProps> = memo(({ entries, onClear, onOpenFullLog }) => {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-[var(--seele-dock-bottom)] right-6 z-30 flex flex-col gap-1">
      {open && (
        <div className="w-80 max-h-64 overflow-y-auto bg-nerv-panel border border-nerv-border rounded shadow-[0_4px_24px_rgba(0,0,0,0.5)] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-nerv-border sticky top-0 bg-nerv-panel">
            <span className="font-mono text-[9px] font-bold tracking-[0.2em] uppercase text-nerv-amber">
              SESSION LOG
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenFullLog}
                title="Open the full audit trail (revert moves and renames)"
                className="text-[8px] font-mono tracking-wider uppercase text-nerv-muted hover:text-nerv-amber transition-colors"
              >
                FULL LOG
              </button>
              <button
                type="button"
                onClick={onClear}
                className="text-[8px] font-mono tracking-wider uppercase text-nerv-muted hover:text-nerv-red transition-colors"
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse activity log"
                className="text-nerv-muted hover:text-nerv-text text-xs"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Entries */}
          <div className="flex flex-col">
            {entries.map((e) => {
              const meta = ACTION_META[e.action];
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2 px-3 py-1.5 border-b border-nerv-border/30 last:border-b-0"
                >
                  <span className={`shrink-0 text-xs ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-mono font-bold tracking-wider ${meta.color}`}>
                        {meta.label}
                      </span>
                      {!e.ok && (
                        <span className="text-[8px] font-mono text-nerv-red">
                          FAILED
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-nerv-text truncate">
                      {e.fileName}
                    </span>
                    {e.detail && (
                      <span className="font-mono text-[9px] text-nerv-muted truncate">
                        {e.detail}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="self-end flex items-center gap-2 px-3 py-1.5 bg-nerv-panel border border-nerv-border rounded hover:border-nerv-amber/50 transition-colors group"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-nerv-lime shadow-[0_0_6px_#c9e98a]" />
        <span className="font-mono text-[9px] tracking-wider uppercase text-nerv-muted group-hover:text-nerv-text">
          {open ? "HIDE" : `${entries.length} OP${entries.length !== 1 ? "S" : ""}`}
        </span>
      </button>
    </div>
  );
});

export default ActivityLog;
