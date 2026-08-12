/**
 * Header — global command bar (§7.1).
 *
 * Two rows:
 *  - Row 1: sidebar-toggle chip, brand block, folder pill, Scan ticket,
 *    search field with a platform-correct palette chip, tools + live clock.
 *  - Row 2: control strip — VIEW / FILTER / GROUP / SORT `EvaSegmented`
 *    clusters, sort-direction sqbtn, SIZE frame readout (hidden in list
 *    and folders modes), RESULT readout, separated by `.eva-divider` ticks.
 *
 * Row 1 is a frameless-window drag region (`.titlebar-drag`); every
 * interactive element opts out via `.no-drag`. The min/max/close caption
 * buttons live in `TitleBar` above this, so no caption-clearing pad is
 * needed here.
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
  roots: string[];
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
  onOpenSettings: () => void;
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
    value: "folders",
    label: "FOLDERS",
    title: "Folder & subfolder explorer",
    icon: (
      <Glyph>
        <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" />
        <rect x="3" y="9" width="18" height="12" />
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

/** Command-palette hint shown in the search field. macOS uses ⌘, every
 *  other platform Ctrl — the App keyboard handler accepts both. */
const PALETTE_HINT = /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? "⌘K"
  : "Ctrl K";

const SORT_OPTIONS: EvaOption<SortMode>[] = [
  { value: "name", label: "NAME", title: "Sort by filename" },
  { value: "date", label: "DATE", title: "Sort by date" },
  { value: "size", label: "SIZE", title: "Sort by file size" },
  { value: "resolution", label: "RES", title: "Sort by resolution" },
];

export function Header(props: HeaderProps) {
  const {
    roots,
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
    onOpenSettings,
    sidebarOpen,
    onToggleSidebar,
  } = props;

  // Live clock — updates every second (§7.1).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const folderLabel = roots.length > 0
    ? roots[0].replace(/\\/g, "/").split("/").filter(Boolean).pop() ??
      roots[0]
    : "NO FOLDER SELECTED";
  const extraRoots = roots.length - 1;
  const folderLabelFull =
    roots.length > 1 ? `${folderLabel} +${extraRoots}` : folderLabel;

  return (
    <header className="relative shrink-0 z-30 select-none">
      {/* Row 1 — titlebar drag region; 160px clears Windows caption buttons. */}
      <div
        className="titlebar-drag h-12 px-3 flex items-center justify-between border-b border-nerv-border/60 gap-3"
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
                ? "bg-nerv-amber text-black shadow-[0_0_8px_rgba(255,183,0,0.35)]"
                : "border border-nerv-border bg-nerv-panel text-nerv-text-dim hover:border-nerv-amber hover:text-nerv-amber"
            }`}
          >
            {sidebarOpen ? "\u2039" : "\u203A"}
          </button>

          {/* Brand block — plain amber wordmark, no gradient icon */}
          <div className="shrink-0 flex items-center gap-2 pr-3 border-r border-nerv-border/60">
            <span className="eva-title text-[16px] text-nerv-amber">Seele</span>
            <span className="text-[9px] text-nerv-muted">v2.7</span>
          </div>

          {/* Folder pill — terse root label, neutral styling */}
          <button
            type="button"
            onClick={onPickFolder}
            title={roots.length > 0 ? "Add another folder to the library" : "Pick a folder to scan"}
            className="no-drag shrink-0 h-8 px-3 flex items-center gap-1.5 text-[11px] text-nerv-text-dim hover:text-nerv-amber transition-colors max-w-[200px]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-nerv-amber">
              <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" />
              <rect x="3" y="9" width="18" height="11" />
            </svg>
            <span className="truncate">{folderLabelFull.toUpperCase()}</span>
          </button>

          {/* Scan button — terse "Scan" */}
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            title={scanning ? "Scanning in progress" : "Initiate media scan"}
            className={`no-drag shrink-0 eva-shear h-8 px-4 flex items-center gap-1.5 text-[11px] font-bold tracking-wider transition-colors ${
              scanning
                ? "bg-[#33230a] text-[#ffb020] animate-pulse cursor-wait"
                : "bg-nerv-orange text-black hover:brightness-110"
            }`}
          >
            {scanning ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            )}
            {scanning ? "Scanning" : "Scan"}
          </button>
        </div>

        {/* Right cluster: search + tools + clock */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Global search */}
          <div className="flex-1 max-w-md min-w-0">
            <div className="flex items-center gap-2 h-8 bg-nerv-bg border border-nerv-border focus-within:border-nerv-amber/60 px-3 transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-nerv-amber shrink-0">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search"
                spellCheck={false}
                className="no-drag flex-1 min-w-0 bg-transparent outline-none text-[11px] text-nerv-text placeholder:text-nerv-muted"
              />
              {searchQuery.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  aria-label="Clear search"
                  title="Clear search"
                  className="text-nerv-muted hover:text-nerv-text shrink-0"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              ) : (
                // Was a hardcoded ⌘K on a non-focusable <span>: the wrong
                // modifier on Windows/Linux (the shortcut is Ctrl+K there)
                // and unreachable by keyboard despite being clickable.
                <button
                  type="button"
                  onClick={onOpenPalette}
                  title="Command palette"
                  aria-label="Open command palette"
                  className="no-drag shrink-0 border border-nerv-border px-1.5 py-0.5 text-[9px] text-nerv-muted hover:text-nerv-amber hover:border-nerv-amber/50 transition-colors cursor-pointer"
                >
                  {PALETTE_HINT}
                </button>
              )}
            </div>
          </div>

          {/* Tool cluster */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenAnalytics}
              title="Storage & media analytics"
              className="no-drag text-nerv-text-dim hover:text-nerv-amber h-8 w-8 flex items-center justify-center transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 3 3 5-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onOpenPalette}
              title="Command palette"
              aria-label="Command palette"
              className="no-drag text-nerv-text-dim hover:text-nerv-amber h-8 w-8 flex items-center justify-center transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 17l6-6-6-6M12 19h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              title="Performance settings"
              aria-label="Performance settings"
              className="no-drag text-nerv-text-dim hover:text-nerv-amber h-8 w-8 flex items-center justify-center transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onOpenHelp}
              title="Keyboard help"
              aria-label="Keyboard help"
              className="no-drag text-nerv-text-dim hover:text-nerv-amber h-8 w-8 flex items-center justify-center transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" />
              </svg>
            </button>

            {/* Live clock */}
            <div className="flex items-center gap-1.5 pl-1">
              <span className="w-1.5 h-1.5 bg-nerv-amber shadow-[0_0_8px_#ffb700] animate-pulse-soft" />
              <span className="text-nerv-amber text-[12px] font-bold tabular-nums tracking-wider">
                {formatClock(now)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — single control strip: VIEW | FILTER | GROUP | SORT | STAR | SIZE | RESULT */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5 border-b border-nerv-border/60">
        <EvaSegmented
          value={viewMode}
          options={VIEW_OPTIONS}
          onChange={onViewModeChange}
          accent="amber"
        />
        <span className="eva-divider" />

        <EvaSegmented
          value={typeFilter}
          options={FILTER_OPTIONS}
          onChange={onTypeFilterChange}
          accent="amber"
        />
        <span className="eva-divider" />

        <EvaSegmented
          value={groupMode}
          options={GROUP_OPTIONS}
          onChange={onGroupModeChange}
          accent="amber"
        />
        <span className="eva-divider" />

        <EvaSegmented
          value={sortMode}
          options={SORT_OPTIONS}
          onChange={onSortModeChange}
          accent="amber"
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

        {/* SIZE — hidden in list/folders modes */}
        {viewMode !== "list" && viewMode !== "folders" && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-widest text-nerv-muted">SIZE</span>
            <input
              type="range"
              min={130}
              max={360}
              step={1}
              value={gridDensity}
              onChange={(e) => onGridDensityChange(Number(e.target.value))}
              className="eva-slider w-20"
              aria-label="Grid tile size"
            />
            <span className="text-nerv-amber text-[10px] font-bold tabular-nums w-9 text-right">
              {gridDensity}px
            </span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* RESULT — plain text, no box */}
        <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
          <span className="text-nerv-text font-bold">{pad(resultCount, 4)}</span>
          <span className="text-nerv-muted">of</span>
          <span className="text-nerv-muted font-bold">{pad(totalCount, 4)}</span>
          {selectedCount > 0 && (
            <span className="text-nerv-amber font-bold ml-2">{pad(selectedCount, 3)} sel</span>
          )}
        </div>
      </div>
    </header>
  );
}
