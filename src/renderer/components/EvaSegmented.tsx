import { memo, type ReactNode } from "react";

/** Hue of the active tab bevel (§2.5). */
export type FillAccent =
  | "amber"
  | "purple"
  | "lime"
  | "cyan"
  | "green"
  | "red";

export interface EvaOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
}

export interface EvaSegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: EvaOption<T>[];
  onChange: (v: T) => void;
  accent?: FillAccent;
}

/**
 * EvaSegmented — the canonical ticket control (§7.0).
 *
 * Replaces every native `<select>` and toggle group in the header control
 * strip. Each option is a chamfered `.eva-ticket` button; the active one
 * takes the bevelled fill of its semantic `accent`, the rest sit `.eva-dim`.
 */
function EvaSegmentedInner<T extends string>({
  label,
  value,
  options,
  onChange,
  accent = "amber",
}: EvaSegmentedProps<T>) {
  return (
    <div className="flex items-center gap-[5px]">
      {label && (
        <span className="text-[9px] font-bold tracking-[0.25em] phosphor-dim mr-1">
          {label}
        </span>
      )}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`eva-ticket h-7 px-3 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase transition-[filter] duration-150 ${
              active ? `eva-fill-${accent}` : "eva-dim"
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const EvaSegmented = memo(EvaSegmentedInner) as typeof EvaSegmentedInner;
