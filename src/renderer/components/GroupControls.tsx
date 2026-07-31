import React from "react";

export type GroupMode = "none" | "date" | "type";

export interface GroupControlsProps {
  mode: GroupMode;
  onChange: (m: GroupMode) => void;
}

export const GroupControls: React.FC<GroupControlsProps> = ({ mode, onChange }) => {
  const options: { mode: GroupMode; label: string }[] = [
    { mode: "none", label: "NONE" },
    { mode: "date", label: "DATE CREATED" },
    { mode: "type", label: "FILE TYPE" },
  ];

  return (
    <div
      className="inline-flex items-center border border-nerv-border bg-nerv-panel p-0.5 select-none"
      role="group"
      aria-label="Grouping mode"
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          className={`px-2.5 py-1 font-mono uppercase tracking-wider text-xs transition-all duration-150 cursor-pointer ${
            mode === option.mode
              ? "bg-nerv-orange text-nerv-bg font-bold animate-pulse-glow"
              : "bg-transparent text-nerv-muted hover:text-nerv-amber hover:bg-nerv-panel-2"
          }`}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default GroupControls;

