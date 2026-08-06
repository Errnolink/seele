/**
 * Trash Queue panel (ui-upgrade.md Issue 1).
 *
 * Files queued for trash are only staged here — nothing has touched disk
 * until "Delete Forever" (per-file) or "Empty Queue" (batch) commits.
 * Restore is pure app state (re-adds the file to the grid; the file never
 * left the filesystem).
 */
import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MediaFile } from "../../scanner/types";
import { formatBytes } from "../utils";

export interface TrashQueueEntry {
  file: MediaFile;
  queuedAt: number;
}

export interface TrashQueueModalProps {
  open: boolean;
  entries: TrashQueueEntry[];
  onClose: () => void;
  onRestore: (filePath: string) => void;
  onDelete: (filePath: string) => void;
  onEmptyAll: () => void;
}

function toThumbUrl(filePath: string): string {
  return `${window.scanAPI.toMediaUrl(filePath)}?w=80`;
}

export const TrashQueueModal: React.FC<TrashQueueModalProps> = memo(
  ({ open, entries, onClose, onRestore, onDelete, onEmptyAll }) => {
    const [armEmpty, setArmEmpty] = useState(false);

    useEffect(() => {
      if (!open) setArmEmpty(false);
    }, [open]);

    useEffect(() => {
      setArmEmpty(false);
    }, [entries.length]);

    const totalBytes = useMemo(
      () => entries.reduce((sum, e) => sum + e.file.sizeBytes, 0),
      [entries],
    );

    return (
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-[760px] max-h-[80vh] flex flex-col bg-nerv-panel border border-nerv-red/50 shadow-[0_0_40px_rgba(0,0,0,0.8)]"
              onClick={(e) => e.stopPropagation()}
            >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-nerv-border">
            <div className="flex items-center gap-3">
              <span className="eva-title text-nerv-red font-bold tracking-wider text-[14px]">
                TRASH QUEUE
              </span>
              <span className="tag-chip px-1.5 py-0.5 bg-nerv-red/15 border border-nerv-red/40 text-nerv-red text-[9px] font-mono font-bold tracking-wider">
                {entries.length} STAGED
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

          {/* Staging note */}
          <div className="px-5 py-2 border-b border-nerv-border bg-nerv-amber/5">
            <span className="font-mono text-[9px] tracking-wider text-nerv-amber">
              FILES ARE STAGED ONLY — NOTHING HAS BEEN DELETED. RESTORE IS
              INSTANT; DELETION ONLY HAPPENS ON COMMIT.
            </span>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-nerv-muted text-xs font-mono py-12">
                Queue is empty.
              </div>
            ) : (
              <div className="flex flex-col">
                {entries.map(({ file, queuedAt }) => (
                  <div
                    key={file.filePath}
                    className="flex items-center gap-3 px-5 py-2 border-b border-nerv-border/40 hover:bg-nerv-panel-2/50"
                  >
                    <div className="h-10 w-10 flex-shrink-0 overflow-hidden border border-nerv-border bg-nerv-bg">
                      <img
                        src={toThumbUrl(file.filePath)}
                        alt={file.fileName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.opacity = "0"; }}
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="font-mono text-[11px] text-nerv-text truncate" title={file.filePath}>
                        {file.fileName}
                      </span>
                      <span className="font-mono text-[9px] text-nerv-muted truncate">
                        {file.filePath}
                      </span>
                    </div>
                    <span className="shrink-0 tabular-nums text-nerv-muted text-[10px]">
                      {formatBytes(file.sizeBytes)}
                    </span>
                    <span className="shrink-0 tabular-nums text-nerv-muted/60 text-[9px] w-14 text-right">
                      {new Date(queuedAt).toLocaleTimeString(undefined, {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRestore(file.filePath)}
                      className="shrink-0 px-2 py-1 border border-nerv-lime/40 text-nerv-lime text-[8px] font-bold tracking-wider hover:bg-nerv-lime/10 transition-colors"
                    >
                      RESTORE
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(file.filePath)}
                      className="shrink-0 px-2 py-1 border border-nerv-red/40 text-nerv-red text-[8px] font-bold tracking-wider hover:bg-nerv-red/10 transition-colors"
                    >
                      DELETE FOREVER
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer: empty queue (two-stage confirm) */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-nerv-border">
            <span className="text-[9px] font-mono text-nerv-muted tracking-wider">
              {entries.length} FILES · {formatBytes(totalBytes)}
            </span>
            <button
              type="button"
              disabled={entries.length === 0}
              onClick={() => {
                if (!armEmpty) {
                  setArmEmpty(true);
                  return;
                }
                setArmEmpty(false);
                onEmptyAll();
              }}
              className={`tag-chip px-3 py-1 text-[9px] font-bold tracking-wider transition-colors ${
                armEmpty
                  ? "bg-nerv-red text-nerv-bg border border-nerv-red animate-pulse-soft"
                  : "bg-nerv-red/15 border border-nerv-red/40 text-nerv-red hover:bg-nerv-red/25"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              {armEmpty
                ? `CONFIRM EMPTY — ${entries.length} FILES · ${formatBytes(totalBytes)}`
                : `EMPTY QUEUE (${entries.length})`}
            </button>
          </div>
        </motion.div>
      </motion.div>
        )}
      </AnimatePresence>
    );
  },
);

TrashQueueModal.displayName = "TrashQueueModal";
export default TrashQueueModal;
