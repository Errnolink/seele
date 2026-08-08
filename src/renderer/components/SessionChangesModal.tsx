/**
 * Session Audit Trail & Changes Modal (v2.5 §Module 7).
 *
 * Full-screen modal showing every file operation logged this session:
 * moves, renames, trashes. Summary metric cards at top, filterable
 * chronological audit table below, export to JSON, and clear.
 *
 * Revert is wired via a callback prop — the parent decides what
 * "undo" means per action type (e.g. move-back, restore from trash).
 */
import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { OVERLAY_ENTER, OVERLAY_EXIT, PANEL_ENTER, PANEL_EXIT } from "../motion";
import type { ActivityEntry } from "./ActivityLog";

export interface SessionChangesModalProps {
  open: boolean;
  entries: ActivityEntry[];
  onClose: () => void;
  onClear: () => void;
  onRevert?: (entry: ActivityEntry) => void;
}

type FilterKey = "all" | ActivityEntry["action"];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "move", label: "MOVE" },
  { key: "rename", label: "RENAME" },
  { key: "trash", label: "TRASH" },
];

const ACTION_STYLES: Record<ActivityEntry["action"], { badge: string; label: string }> = {
  move: { badge: "bg-nerv-cyan/15 border-nerv-cyan/50 text-nerv-cyan", label: "MOVE" },
  rename: { badge: "bg-nerv-amber/15 border-nerv-amber/50 text-nerv-amber", label: "RENAME" },
  trash: { badge: "bg-nerv-red/15 border-nerv-red/50 text-nerv-red", label: "TRASH" },
};

function MetricCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-nerv-bg border border-nerv-border p-3 flex flex-col gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-nerv-muted">{label}</span>
      <span className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{count}</span>
    </div>
  );
}

export const SessionChangesModal: React.FC<SessionChangesModalProps> = memo(
  ({ open, entries, onClose, onClear, onRevert }) => {
    const [filter, setFilter] = useState<FilterKey>("all");

    const metrics = useMemo(() => {
      let moves = 0;
      let renames = 0;
      let trashed = 0;
      let succeeded = 0;
      for (const e of entries) {
        if (e.action === "move") moves++;
        else if (e.action === "rename") renames++;
        else if (e.action === "trash") trashed++;
        if (e.ok) succeeded++;
      }
      return { total: entries.length, moves, renames, trashed, succeeded };
    }, [entries]);

    const filtered = useMemo(() => {
      const sorted = [...entries].reverse();
      if (filter === "all") return sorted;
      return sorted.filter((e) => e.action === filter);
    }, [entries, filter]);

    const handleExport = () => {
      const data = entries.map((e) => ({
        timestamp: new Date(e.timestamp).toISOString(),
        action: e.action,
        file: e.fileName,
        detail: e.detail,
        status: e.ok ? "COMMITTED" : "FAILED",
      }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seele-session-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: OVERLAY_ENTER }}
            exit={{ opacity: 0, transition: OVERLAY_EXIT }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 1.02 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: PANEL_ENTER }}
              exit={{ opacity: 0, y: 6, scale: 0.99, transition: PANEL_EXIT }}
              className="w-[900px] max-h-[80vh] flex flex-col bg-nerv-panel border border-nerv-orange/50 shadow-[0_0_40px_rgba(0,0,0,0.8)]"
              onClick={(e) => e.stopPropagation()}
            >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-nerv-border">
            <div className="flex items-center gap-3">
              <span className="eva-title text-nerv-orange font-bold tracking-wider text-[14px]">
                SESSION AUDIT TRAIL
              </span>
              <span className="tag-chip px-1.5 py-0.5 bg-nerv-orange/15 border border-nerv-orange/40 text-nerv-orange text-[9px] font-mono font-bold tracking-wider">
                {metrics.total} OPS
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-nerv-muted hover:text-nerv-red text-sm font-mono"
            >
              {"\u2715"}
            </button>
          </div>

          {/* Summary metric cards */}
          <div className="grid grid-cols-5 gap-2 px-5 py-3 border-b border-nerv-border">
            <MetricCard label="Total Ops" count={metrics.total} color="text-nerv-orange" />
            <MetricCard label="Moves" count={metrics.moves} color="text-nerv-cyan" />
            <MetricCard label="Renames" count={metrics.renames} color="text-nerv-amber" />
            <MetricCard label="Purged" count={metrics.trashed} color="text-nerv-red" />
            <MetricCard label="Committed" count={metrics.succeeded} color="text-nerv-green" />
          </div>

          {/* Action filters */}
          <div className="flex items-center gap-1.5 px-5 py-2 border-b border-nerv-border">
            <span className="text-[9px] font-mono text-nerv-muted tracking-wider mr-2">FILTER:</span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`tag-chip px-2 py-0.5 text-[9px] font-mono font-bold tracking-wider transition-colors ${
                  filter === f.key
                    ? "bg-nerv-orange/20 border border-nerv-orange/50 text-nerv-orange"
                    : "border border-nerv-border text-nerv-muted hover:text-nerv-text"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Audit table */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full text-nerv-muted text-xs font-mono py-12">
                No operations logged.
              </div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 bg-nerv-panel border-b border-nerv-border">
                  <tr className="text-[9px] uppercase tracking-wider text-nerv-muted">
                    <th className="text-left px-5 py-2 font-normal">Time</th>
                    <th className="text-left px-2 py-2 font-normal">Action</th>
                    <th className="text-left px-2 py-2 font-normal">File</th>
                    <th className="text-left px-2 py-2 font-normal">Detail</th>
                    <th className="text-left px-2 py-2 font-normal">Status</th>
                    <th className="text-right px-5 py-2 font-normal">Revert</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => {
                    const style = ACTION_STYLES[entry.action];
                    const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-nerv-border/40 hover:bg-nerv-panel-2/50"
                      >
                        <td className="px-5 py-2 text-nerv-muted tabular-nums whitespace-nowrap">
                          {time}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`tag-chip inline-block px-1.5 py-0.5 text-[8px] font-bold border ${style.badge}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-nerv-text max-w-[180px] truncate" title={entry.fileName}>
                          {entry.fileName}
                        </td>
                        <td className="px-2 py-2 text-nerv-text-dim max-w-[260px] truncate" title={entry.detail}>
                          {entry.detail}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={`text-[8px] font-bold tracking-wider ${
                              entry.ok ? "text-nerv-green" : "text-nerv-red"
                            }`}
                          >
                            {entry.ok ? "COMMITTED" : "FAILED"}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-right">
                          {onRevert && entry.ok && entry.action !== "trash" && (
                            <button
                              type="button"
                              onClick={() => onRevert(entry)}
                              className="border border-nerv-amber/40 text-nerv-amber text-[8px] font-bold tracking-wider px-1.5 py-0.5 hover:bg-nerv-amber/10 transition-colors"
                            >
                              REVERT
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer: export + clear */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-nerv-border">
            <span className="text-[9px] font-mono text-nerv-muted tracking-wider">
              {filtered.length} ENTRIES
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={entries.length === 0}
                className="tag-chip px-3 py-1 bg-nerv-cyan/15 border border-nerv-cyan/40 text-nerv-cyan text-[9px] font-bold tracking-wider hover:bg-nerv-cyan/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                EXPORT LEDGER (.JSON)
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={entries.length === 0}
                className="tag-chip px-3 py-1 bg-nerv-red/15 border border-nerv-red/40 text-nerv-red text-[9px] font-bold tracking-wider hover:bg-nerv-red/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                CLEAR SESSION LOG
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
        )}
      </AnimatePresence>
    );
  },
);

SessionChangesModal.displayName = "SessionChangesModal";
export default SessionChangesModal;
