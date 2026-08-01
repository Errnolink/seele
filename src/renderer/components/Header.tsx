/**
 * Header — global command bar (§7.1).
 *
 * Two rows on the `eva-top-bar` EVA-purple surface:
 *  - Row 1: brand block, sidebar-toggle chip, folder breadcrumb, gold Scan
 *    ticket, lime search field with a `⌘K` chip, violet tools + live clock.
 *  - Row 2: control strip — VIEW / FILTER / GROUP / SORT `EvaSegmented`
 *    clusters, sort-direction sqbtn, SIZE frame readout (hidden in list
 *    mode), RESULT frame readout, separated by `.eva-divider` ticks.
 *
 * Row 1 is the Windows frameless titlebar drag region; every interactive
 * element opts out via `.no-drag`, and `paddingRight: 160px` clears the
 * caption buttons.
 */
import { useEffect, useState, type ReactNode } from "react";
import { EvaSegmented, type EvaOption } from "./EvaSegmented";
import type {
  GroupMode,
  MediaTypeFilter,
  SortDir,
  SortMode,
  ViewMode,
} from "../types";
import { formatClock, pad } from "../utils";

export interface HeaderProps {
  currentFolder: string | null;
  onPickFolder: () => void;
  onScan: () => void;
  scanning: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  groupMode: GroupMode;
  onGroupModeChange: (g: GroupMode) => void;
  sortMode: SortMode;
  onSortModeChange: (s: SortMode) => void;
  sortDir: SortDir;
  onSortDirChange: (d: SortDir) => void;
  gridDensity: number;
  onGridDensityChange: (n: number) => void;
  resultCount: number;
  totalCount: number;
  selectedCount: number;
  onOpenHelp: () => void;
  onOpenPalette: () => void;
  onOpenAnalytics: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/** 10px stroke icon used by the VIEW cluster. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const VIEW_OPTIONS: EvaOption<ViewMode>[] = [
  {
    value: "masonry",
    label: "MASONRY",
    title: "Masonry view",
    icon: (
      <Glyph>
        <rect x="3" y="3" width="7" height="10" />
        <rect x="3" y="15" width="7" height="6" />
        <rect x="14" y="3" width="7" height="6" />
        <rect x="14" y="11" width="7" height="10" />
      </Glyph>
    ),
  },
  {
    value: "grid",
    label: "GRID",
    title: "Uniform grid",
    icon: (
      <Glyph>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </Glyph>
    ),
  },
  {
    value: "list",
    label: "LIST",
    title: "Detail list",
    icon: (
      <Glyph>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </Glyph>
    ),
  },
  {
    value: "split",
    label: "SPLIT",
    title: "Split view",
    icon: (
      <Glyph>
        <rect x="3" y="3" width="18" height="18" />
        <path d="M12 3v18" />
      </Glyph>
    ),
  },
];

const FILTER_OPTIONS: EvaOption<MediaTypeFilter>[] = [
  { value: "all", label: "ALL", title: "All media" },
  { value: "image", label: "IMG", title: "Images only" },
  { value: "video", label: "VID", title: "Videos only" },
  { value: "favorite", label: "\u2605FAV", title: "Favorites" },
  { value: "large", label: ">50MB", title: "Large files (>50MB)" },
];

const GROUP_OPTIONS: EvaOption<GroupMode>[] = [
  { value: "none", label: "NONE", title: "No grouping" },
  { value: "date", label: "DATE", title: "Group by date" },
  { value: "type", label: "TYPE", title: "Group by media type" },
  { value: "folder", label: "DIR", title: "Group by directory" },
  { value: "resolution", label: "RES", title: "Group by resolution" },
];

const SORT_OPTIONS: EvaOption<SortMode>[] = [
  { value: "name", label: "NAME", title: "Sort by filename" },
  { value: "date", label: "DATE", title: "Sort by date" },
  { value: "size", label: "SIZE", title: "Sort by file size" },
  { value: "resolution", label: "RES", title: "Sort by resolution" },
];

export function Header(props: HeaderProps) {
  const {
    currentFolder,
    onPickFolder,
    onScan,
    scanning,
    searchQuery,
    onSearchChange,
    viewMode,
    onViewModeChange,
    typeFilter,
    onTypeFilterChange,
    groupMode,
    onGroupModeChange,
    sortMode,
    onSortModeChange,
    sortDir,
    onSortDirChange,
    gridDensity,
    onGridDensityChange,
    resultCount,
    totalCount,
    selectedCount,
    onOpenHelp,
    onOpenPalette,
    onOpenAnalytics,
    sidebarOpen,
    onToggleSidebar,
  } = props;

  // Live clock — updates every second (§7.1).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const folderLabel = currentFolder
    ? currentFolder.replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
      currentFolder
    : "NO FOLDER SELECTED";

  return (
    <header className="relative shrink-0 z-30 select-none">
      {/* Row 1 — titlebar drag region; 160px clears Windows caption buttons. */}
      <div
        className="titlebar-drag eva-top-bar h-12 px-3 flex items-center justify-between border-b border-nerv-purple/40 gap-3"
        style={{ paddingRight: 160 }}
      >
        {/* Left cluster: sidebar toggle + brand + folder + scan */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Sidebar-toggle chip */}
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-pressed={sidebarOpen}
            className={`no-drag shrink-0 w-8 h-8 flex items-center justify-center text-sm font-bold transition-colors ${
              sidebarOpen
                ? "bg-nerv-lime text-[#1a3205] shadow-[0_0_8px_rgba(163,230,53,0.35)]"
                : "border border-[rgba(124,58,237,0.5)] bg-[#100e18] text-[#c4b5fd] hover:border-nerv-lime hover:text-nerv-lime"
            }`}
          >
            {sidebarOpen ? "\u2039" : "\u203A"}
          </button>

          {/* Brand block */}
          <div className="shrink-0 flex items-center gap-2 pr-3 border-r border-nerv-purple/40">
            <div className="relative w-8 h-8 eva-corner bg-[#6d28d9] flex items-center justify-center">
              <span className="text-[15px] font-bold text-nerv-lime leading-none">
                W
              </span>
              <span className="absolute right-0 top-0 bottom-0 w-[3px] bg-nerv-lime/70" />
            </div>
            <div className="flex flex-col leading-none">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold tracking-[0.25em] phosphor-lime">
                  WIERGISE
                </span>
                <span className="eva-ticket bg-[rgba(124,58,237,0.25)] text-[#c4b5fd] text-[9px] font-bold tracking-[0.15em] px-1.5 py-0.5">
                  v2.5
                </span>
              </div>
              <span className="text-[9px] phosphor-violet tracking-[0.3em] mt-0.5">
                UNIT-01 // MEDIA SCANNER
              </span>
            </div>
          </div>

          {/* Folder breadcrumb */}
          <button
            type="button"
            onClick={onPickFolder}
            title={currentFolder ?? "Pick a folder to scan"}
            className="no-drag shrink-0 eva-ticket bg-[rgba(124,58,237,0.12)] hover:bg-[rgba(124,58,237,0.22)] transition-colors h-8 px-3 flex items-center gap-2 max-w-[260px]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="phosphor-violet shrink-0"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="phosphor-violet text-[11px] font-bold tracking-[0.1em] truncate">
              {folderLabel.toUpperCase()}
            </span>
            <span className="text-[9px] font-bold tracking-[0.2em] phosphor-dim group-hover:phosphor-lime">
              [ CHG ]
            </span>
          </button>

          {/* Scan button */}
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            title={scanning ? "Scanning in progress" : "Initiate media scan"}
            className={`no-drag shrink-0 eva-ticket h-8 px-3 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] uppercase transition-[filter] duration-150 ${
              scanning
                ? "bg-[#33230a] text-[#ffb020] animate-pulse cursor-wait"
                : "eva-fill-amber hover:brightness-110"
            }`}
          >
            {scanning ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                className="animate-spin"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            )}
            {scanning ? "SCANNING" : "INITIATE SCAN"}
          </button>
        </div>

        {/* Right cluster: search + tools + clock */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Global search */}
          <div className="flex-1 max-w-xl min-w-0">
            <div className="eva-corner eva-segbar border border-nerv-purple/40 h-8 px-2.5 flex items-center gap-2 bg-[#0a0814]">
              <span className="phosphor-lime font-bold text-xs select-none">
                {">"}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="phosphor-violet/70 shrink-0"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="QUERY.FILENAME // TAG // EXT"
                spellCheck={false}
                className="no-drag flex-1 min-w-0 bg-transparent outline-none phosphor-lime text-[11px] tracking-[0.08em] placeholder:text-[#6d5a9a]"
              />
              {searchQuery.trim().length > 0 && (
                <span className="phosphor-amber text-[10px] font-bold tabular-nums shrink-0">
                  {pad(resultCount, 4)}
                </span>
              )}
              <span className="no-drag eva-ticket bg-[rgba(124,58,237,0.25)] text-[#c4b5fd] text-[9px] font-bold tracking-[0.15em] px-1.5 py-0.5 shrink-0">
                &#8984;K
              </span>
            </div>
          </div>

          {/* Tool cluster */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenAnalytics}
              title="Storage & media analytics"
              className="no-drag eva-ticket bg-[rgba(124,58,237,0.18)] hover:bg-[rgba(124,58,237,0.32)] hover:text-nerv-lime text-[#c4b5fd] h-8 px-2.5 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.15em] transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 3 3 5-6" />
              </svg>
              ANALYTICS
            </button>
            <button
              type="button"
              onClick={onOpenPalette}
              title="Command palette"
              aria-label="Command palette"
              className="no-drag eva-sqbtn w-8 h-8 flex items-center justify-center"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M4 17l6-6-6-6M12 19h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onOpenHelp}
              title="Keyboard help"
              aria-label="Keyboard help"
              className="no-drag eva-sqbtn w-8 h-8 flex items-center justify-center"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" />
              </svg>
            </button>

            {/* Live clock */}
            <div className="flex items-center gap-1.5 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-nerv-lime shadow-[0_0_8px_#a3e635] animate-pulse-soft" />
              <span className="phosphor-lime text-[12px] font-bold tabular-nums tracking-[0.1em]">
                {formatClock(now)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — control strip */}
      <div className="h-12 px-3 flex items-center gap-2 bg-gradient-to-b from-[#0d0b08] to-[#0a0908] border-b border-nerv-border/60">
        <EvaSegmented
          label="VIEW"
          value={viewMode}
          options={VIEW_OPTIONS}
          onChange={onViewModeChange}
          accent="lime"
        />
        <span className="eva-divider" />

        <EvaSegmented
          label="FILTER"
          value={typeFilter}
          options={FILTER_OPTIONS}
          onChange={onTypeFilterChange}
          accent="amber"
        />
        <span className="eva-divider" />

        <EvaSegmented
          label="GROUP"
          value={groupMode}
          options={GROUP_OPTIONS}
          onChange={onGroupModeChange}
          accent="purple"
        />
        <span className="eva-divider" />

        <EvaSegmented
          label="SORT"
          value={sortMode}
          options={SORT_OPTIONS}
          onChange={onSortModeChange}
          accent="cyan"
        />

        {/* Sort direction */}
        <button
          type="button"
          onClick={() => onSortDirChange(sortDir === "asc" ? "desc" : "asc")}
          title={sortDir === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)"}
          aria-label={`Sort ${sortDir === "asc" ? "ascending" : "descending"}`}
          className="eva-sqbtn w-7 h-7 flex items-center justify-center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={sortDir === "asc" ? "M12 5l7 9H5z" : "M12 19l7-9H5z"} />
          </svg>
        </button>

        <span className="eva-divider" />

        {/* SIZE readout — hidden in list mode */}
        {viewMode !== "list" && (
          <div className="eva-frame">
            <div className="eva-inner h-7 px-2.5 flex items-center gap-2 bg-[#0a0908]">
              <span className="text-[9px] font-bold tracking-[0.25em] phosphor-dim">
                SIZE
              </span>
              <input
                type="range"
                min={130}
                max={360}
                step={1}
                value={gridDensity}
                onChange={(e) => onGridDensityChange(Number(e.target.value))}
                className="eva-slider w-24"
                aria-label="Grid tile size"
              />
              <span className="phosphor-amber text-[10px] font-bold tabular-nums w-9 text-right">
                {gridDensity}px
              </span>
            </div>
          </div>
        )}

        {/* RESULT readout — pushed to the right */}
        <div className="flex-1" />

        <div className="eva-frame">
          <div className="eva-inner h-7 px-3 flex items-center gap-2 bg-[#0a0908]">
            <span className="text-[9px] font-bold tracking-[0.25em] phosphor-dim">
              RESULT
            </span>
            <span className="phosphor-amber text-[11px] font-bold tabular-nums">
              {pad(resultCount, 4)}
            </span>
            <span className="phosphor-dim text-[10px]">/</span>
            <span className="phosphor-dim text-[11px] font-bold tabular-nums">
              {pad(totalCount, 4)}
            </span>
            {selectedCount > 0 && (
              <>
                <span className="phosphor-dim text-[10px] mx-0.5">|</span>
                <span className="phosphor-amber text-[10px] font-bold tabular-nums">
                  {pad(selectedCount, 3)} SEL
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
