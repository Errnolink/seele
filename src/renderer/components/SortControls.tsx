import React from "react";

export type SortMode = "default" | "name" | "size" | "date";
export type SortDir = "asc" | "desc";

export interface SortControlsProps {
  mode: SortMode;
  dir: SortDir;
  onModeChange: (m: SortMode) => void;
  onDirChange: (d: SortDir) => void;
}

const OPTIONS: { mode: SortMode; label: string }[] = [
  { mode: "default", label: "AUTO" },
  { mode: "name", label: "NAME" },
  { mode: "size", label: "SIZE" },
  { mode: "date", label: "DATE" },
];

/**
 * Sort dimension + direction toggle (v3 review #14). Mirrors the visual
 * language of `GroupControls` so the toolbar stays consistent.
 */
export const SortControls: React.FC<SortControlsProps> = ({
  mode,
  dir,
  onModeChange,
  onDirChange,
}) => {
  const toggleDir = () => onDirChange(dir === "asc" ? "desc" : "asc");

  return (
    <div className="inline-flex items-center border border-nerv-border bg-nerv-panel p-0.5 select-none">
      <span className="px-2 py-1 font-mono uppercase tracking-wider text-[9px] text-nerv-muted border-r border-nerv-border">
        SORT
      </span>
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          className={`px-2.5 py-1 font-mono uppercase tracking-wider text-xs transition-all duration-150 cursor-pointer ${
            mode === option.mode
              ? "bg-nerv-cyan text-nerv-bg font-bold"
              : "bg-transparent text-nerv-muted hover:text-nerv-cyan hover:bg-nerv-panel-2"
          }`}
          onClick={() => onModeChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
      <button
        type="button"
        className="px-2 py-1 font-mono text-xs text-nerv-muted hover:text-nerv-cyan hover:bg-nerv-panel-2 transition-all duration-150 cursor-pointer border-l border-nerv-border"
        onClick={toggleDir}
        title={`Sort ${dir === "asc" ? "ascending" : "descending"}`}
        aria-label="Toggle sort direction"
      >
        {dir === "asc" ? "▲" : "▼"}
      </button>
    </div>
  );
};

export default SortControls;
