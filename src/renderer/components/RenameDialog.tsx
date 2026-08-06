/**
 * RenameDialog — NERV-styled rename modal (v2.5 §Module 8.2).
 *
 * Replaces the native `window.prompt` for single-file rename. Sanitizes
 * path separators (the backend rejects them) and disables submit when the
 * name is empty or unchanged. Calls back with the trimmed new name.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { MediaFile } from "../types";

interface RenameDialogProps {
  file: MediaFile;
  onClose: () => void;
  onConfirm: (file: MediaFile, newName: string) => void;
}

/** Split a filename into [stem, .ext] preserving the original extension.
 *  Called at multiple sites; the dot-at-0 guard is non-obvious. */
function splitName(fileName: string): [string, string] {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return [fileName, ""];
  return [fileName.slice(0, dot), fileName.slice(dot)];
}

export function RenameDialog({ file, onClose, onConfirm }: RenameDialogProps) {
  const [stem, setStem] = useState(() => splitName(file.fileName)[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the stem on mount so the user can type immediately.
  useEffect(() => {
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(id);
  }, []);

  // Close on Escape (in addition to the global handler, which may be
  // blocked by the input focus).
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

  const [, ext] = splitName(file.fileName);
  // Strip path separators + trim — the backend rejects separators.
  const cleanStem = stem.replace(/[/\\]/g, "").trim();
  const disabled = cleanStem.length === 0 || cleanStem === splitName(file.fileName)[0];

  const submit = () => {
    if (disabled) return;
    onConfirm(file, cleanStem + ext);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md border-2 border-nerv-amber bg-nerv-panel eva-cut shadow-[0_0_30px_rgba(255,183,0,0.35)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-nerv-border pb-3 p-4">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-amber">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <div>
              <h3 className="font-mono text-[13px] font-bold text-nerv-text uppercase tracking-wider">
                Rename Media Designation
              </h3>
              <p className="text-[9px] text-nerv-muted font-mono">{file.fileName}</p>
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

        {/* Input */}
        <div className="p-4">
          <label className="block text-[9px] font-bold uppercase tracking-widest text-nerv-text-dim mb-1.5">
            New Designation
          </label>
          <div className="flex items-center gap-1 border border-nerv-border bg-black px-3 py-2 focus-within:border-nerv-amber/60 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              className="w-full bg-transparent font-mono text-[12px] font-bold text-nerv-text outline-none"
              autoFocus
            />
            <span className="font-mono text-[11px] text-nerv-muted shrink-0">{ext}</span>
          </div>
          <p className="text-[8.5px] text-nerv-muted font-mono mt-1.5">
            Path separators are stripped — only the filename is changed.
          </p>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-nerv-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="border border-nerv-border bg-nerv-panel-hi px-3 py-1.5 text-[10px] font-bold text-nerv-text-dim hover:text-nerv-text transition-colors cursor-pointer"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="flex items-center gap-1.5 bg-nerv-amber px-4 py-1.5 text-[10px] font-bold text-black uppercase tracking-wider shadow-[0_0_12px_rgba(255,183,0,0.4)] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 cursor-pointer transition-[filter]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>SAVE RENAME</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default RenameDialog;
