import React from "react";

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  resultCount: number;
  totalCount: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  resultCount,
  totalCount,
}) => {
  return (
    <div className="flex items-center gap-3 flex-1 min-w-[200px] select-none">
      <div className="relative flex items-center flex-1">
        <svg
          className="absolute left-3 text-nerv-muted pointer-events-none"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="w-full h-8 pl-9 pr-7 bg-nerv-panel-2 border border-nerv-border focus:border-nerv-cyan text-nerv-text font-mono text-xs outline-none transition-colors placeholder:text-nerv-muted"
          placeholder="Search files..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value.length > 0 && (
          <button
            type="button"
            className="absolute right-2.5 bg-transparent border-0 text-nerv-muted hover:text-nerv-orange text-xs cursor-pointer p-0.5 transition-colors"
            onClick={() => onChange("")}
            title="Clear search"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="text-nerv-muted font-mono text-[10px] whitespace-nowrap">
        <span className="text-nerv-cyan font-bold">{resultCount.toLocaleString()}</span>
        <span className="text-nerv-muted/60"> / </span>
        <span className="text-nerv-muted">{totalCount.toLocaleString()}</span>
      </div>
    </div>
  );
};

export default SearchBar;

