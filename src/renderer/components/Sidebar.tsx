/**
 * Sidebar — v2.6 EVA-ticket directory panel (§7.2).
 *
 * Three regions stacked top-to-bottom:
 *  1. Quick Views — four eva-ticket filter buttons (per-view fill hue).
 *  2. Directory explorer — SectionLabel + expand/collapse-all + filter input,
 *     then a scrollable recursive FolderTreeNode list.
 *  3. Storage telemetry footer — segmented ratio bar + legend + MAGI.LINK status.
 *
 * Folder expansion state is LOCAL to this panel (a `Set<string>` of paths).
 */
import { memo, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import type { FolderNode, MediaTypeFilter, ScanStats } from "../types";
import type { TagDef } from "../hooks/useTags";
import { formatBytes, pad } from "../utils";

export interface SidebarProps {
  open: boolean;
  tree: FolderNode | null;
  totalFolders: number;
  selectedFolder: string | null;
  onSelectFolder: (p: string | null) => void;
  /** Folders hidden from the grid (grayed out in the tree). */
  hiddenFolders?: Set<string>;
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  stats: ScanStats;
  /** Count of starred/favorite files (the Set lives in App). */
  favoriteCount: number;
  /** Move selected files to a directory (drag-to-folder support). */
  onDropFiles?: (filePaths: string[], destDir: string) => void;
  /** Currently selected file IDs (for the drag source). */
  selectedIds?: Set<string>;
  /** Tag system — v2.5 §Module 3.3 */
  tags?: TagDef[];
  activeTags?: Set<string>;
  tagCounts?: Map<string, number>;
  onAddTag?: (label: string, category?: TagDef["category"]) => string;
  onRemoveTag?: (key: string) => void;
  onToggleActiveTag?: (key: string) => void;
}
/** A quick-view filter button definition. */
interface QuickView {
  key: MediaTypeFilter;
  label: string;
  /** True when this row also clears the folder selection. */
  clearFolder?: boolean;
}

const QUICK_VIEWS: QuickView[] = [
  { key: "all", label: "ALL ASSETS", clearFolder: true },
  { key: "image", label: "STILL IMAGES" },
  { key: "video", label: "VIDEO" },
  { key: "favorite", label: "STARRED" },
];

/* --------------------------- SectionLabel helper -------------------------- */

function SectionLabel({
  children,
  pulse = false,
}: {
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 select-none">
      <span
        className={`w-1 h-3 bg-nerv-amber shadow-[0_0_6px_#ffb700] ${
          pulse ? "animate-pulse-soft" : ""
        }`}
      />
      <span className="text-[9px] font-bold tracking-[0.25em] text-nerv-amber whitespace-nowrap">
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-nerv-amber/40 to-transparent" />
    </div>
  );
}

interface QuickViewsProps {
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  onSelectFolder: (p: string | null) => void;
  stats: ScanStats;
  favoriteCount: number;
}

const QuickViews = memo(function QuickViews({
  typeFilter,
  onTypeFilterChange,
  onSelectFolder,
  stats,
  favoriteCount,
}: QuickViewsProps) {
  // Count per quick view — `favorite` reads the real favorites Set size.
  const countFor = (key: MediaTypeFilter): number => {
    switch (key) {
      case "all":
        return stats.totalFiles;
      case "image":
        return stats.imageCount;
      case "video":
        return stats.videoCount;
      case "favorite":
        return favoriteCount;
      default:
        return stats.totalFiles;
    }
  };

  return (
    <div className="p-3 border-b border-nerv-border/60 flex flex-col gap-2.5">
      <SectionLabel>TYPE</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {QUICK_VIEWS.map((qv) => {
          const active = typeFilter === qv.key;
          return (
            <button
              key={qv.key}
              type="button"
              aria-pressed={active}
              title={qv.label}
              onClick={() => {
                onTypeFilterChange(qv.key);
                if (qv.clearFolder) onSelectFolder(null);
              }}
              className={`relative flex items-center gap-2 h-8 px-2.5 text-[10px] font-bold tracking-[0.18em] uppercase transition-colors border ${
                active
                  ? "border-nerv-amber/60 bg-nerv-amber/10 text-nerv-amber"
                  : "border-nerv-border/60 text-nerv-text-dim hover:border-nerv-amber/40 hover:text-nerv-text"
              }`}
            >
              <span className="flex-1 text-left">{qv.label}</span>
              <span
                className={`font-mono text-[10px] tabular-nums tracking-normal ${
                  active ? "text-nerv-amber" : "text-nerv-muted"
                }`}
              >
                {pad(countFor(qv.key), 3)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* --------------------------- Folder tree node ----------------------------- */

interface FolderTreeNodeProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedFolder: string | null;
  onSelectFolder: (p: string | null) => void;
  filter: string;
  onDropFiles?: (filePaths: string[], destDir: string) => void;
  selectedIds?: Set<string>;
  hiddenFolders?: Set<string>;
  /** Root tree total size (bytes) for computing capacity percentages. */
  rootSize?: number;
}

/** Recursive folder row. The ALL FILES clearFolder action lives above; rows
 *  toggle selectedFolder (clicking the selected row clears it). */
const FolderTreeNode = memo(function FolderTreeNode({
  node,
  depth,
  expanded,
  onToggleExpand,
  selectedFolder,
  onSelectFolder,
  filter,
  onDropFiles,
  selectedIds,
  hiddenFolders,
  rootSize,
}: FolderTreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.path);
  const selected = selectedFolder === node.path;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const isHidden = hiddenFolders?.has(node.path) ?? false;

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={selected}
        onClick={() =>
          onSelectFolder(selected ? null : node.path)
        }
        onDoubleClick={(e) => {
          if (hasChildren) {
            e.stopPropagation();
            onToggleExpand(node.path);
          }
        }}
        onDragOver={(e) => {
          if (onDropFiles && selectedIds && selectedIds.size > 0) {
            e.preventDefault();
            setIsDropTarget(true);
          }
        }}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDropTarget(false);
          if (onDropFiles && selectedIds && selectedIds.size > 0) {
            onDropFiles([...selectedIds], node.path);
          }
        }}
        style={{ paddingLeft: 6 + depth * 10 }}
        className={`group relative flex items-center gap-1.5 py-[3px] pr-1 cursor-pointer font-mono text-[10px] tracking-wider transition-colors ${
          selected
            ? "phosphor-lime font-bold"
            : "text-nerv-muted hover:text-nerv-lime/80"
        } ${isDropTarget ? "bg-nerv-lime/20 ring-1 ring-nerv-lime/50" : ""} ${isHidden ? "opacity-40" : ""}`}
      >
        {/* 2px lime selection marker */}
        {selected && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-nerv-lime shadow-[0_0_8px_#c9e98a]" />
        )}

        {/* chevron — toggles expansion only */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.path);
            }}
            className="w-3 h-3 shrink-0 flex items-center justify-center text-nerv-muted hover:text-nerv-lime"
            style={{
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 120ms ease-out",
            }}
          >
            ▸
          </button>
        ) : (
          <span className="w-3 h-3 shrink-0" />
        )}

        {/* folder icon follows row colour */}
        <span className="shrink-0">{selected ? "▮" : "▯"}</span>

        <span className="flex-1 truncate">{node.name}</span>

        {/* drop indicator */}
        {isDropTarget && (
          <span className="shrink-0 phosphor-lime text-[9px]">⇐ DROP</span>
        )}

        <span
          className={`shrink-0 tabular-nums ${
            selected ? "phosphor-amber" : "text-nerv-muted"
          } ${isDropTarget ? "hidden" : ""}`}
        >
          {pad(node.count, 2)}
        </span>

        {/* Capacity bar — shows byte size relative to root (v2.5 §Module 3.2). */}
        {!isDropTarget && node.size > 0 && rootSize && rootSize > 0 && (
          <span
            className="shrink-0 w-12 h-1.5 bg-nerv-border/60 relative overflow-hidden"
            title={`${formatBytes(node.size)} · ${((node.size / rootSize) * 100).toFixed(1)}%`}
          >
            <span
              className="absolute inset-y-0 left-0 bg-nerv-orange/70"
              style={{ width: `${Math.max(2, (node.size / rootSize) * 100)}%` }}
            />
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              filter={filter}
              onDropFiles={onDropFiles}
              selectedIds={selectedIds}
              hiddenFolders={hiddenFolders}
              rootSize={rootSize}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/* --------------------------- Directory explorer --------------------------- */

interface DirectoryExplorerProps {
  tree: FolderNode | null;
  totalFolders: number;
  selectedFolder: string | null;
  onSelectFolder: (p: string | null) => void;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onDropFiles?: (filePaths: string[], destDir: string) => void;
  selectedIds?: Set<string>;
  hiddenFolders?: Set<string>;
}

const DirectoryExplorer = memo(function DirectoryExplorer({
  tree,
  totalFolders,
  selectedFolder,
  onSelectFolder,
  expanded,
  setExpanded,
  onDropFiles,
  selectedIds,
  hiddenFolders,
}: DirectoryExplorerProps) {
  const [filterRaw, setFilterRaw] = useState("");
  // Keep typing responsive; defer the (potentially deep) subtree filter.
  const filter = useDeferredValue(filterRaw.trim().toLowerCase());
  // Filter input collapses to a magnifier by default; expands on click.
  const [searchOpen, setSearchOpen] = useState(false);

  /** Collect every descendant path under `node` (inclusive). */
  const collectPaths = (node: FolderNode): string[] => {
    const out = [node.path];
    for (const c of node.children) out.push(...collectPaths(c));
    return out;
  };

  const expandAll = () => {
    if (!tree) return;
    setExpanded(new Set(collectPaths(tree)));
  };

  const collapseAll = () => setExpanded(new Set());

  // Prune the tree to rows matching the filter (a node survives if it or any
  // descendant matches); ancestors of a match are force-expanded.
  const visible = useMemo(() => {
    if (!tree) return null;
    if (!filter) return { tree, forced: new Set<string>() };
    const forced = new Set<string>();
    const matches = (n: FolderNode): FolderNode | null => {
      const self = n.name.toLowerCase().includes(filter);
      const kids = n.children
        .map(matches)
        .filter((x): x is FolderNode => x !== null);
      if (self || kids.length) {
        forced.add(n.path);
        return { ...n, children: kids };
      }
      return null;
    };
    const pruned = matches(tree);
    return pruned ? { tree: pruned, forced } : null;
  }, [tree, filter]);

  return (
    <>
      <div className="p-3 border-b border-nerv-border/60 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SectionLabel>DIRECTORY // {pad(totalFolders, 3)}</SectionLabel>
          </div>
          <button
            type="button"
            title="Expand all"
            aria-label="Expand all folders"
            onClick={expandAll}
            className="shrink-0 text-[9px] font-bold tracking-[0.15em] text-nerv-muted hover:text-nerv-amber transition-colors uppercase"
          >
            EXP
          </button>
          <button
            type="button"
            title="Collapse all"
            aria-label="Collapse all folders"
            onClick={collapseAll}
            className="shrink-0 text-[9px] font-bold tracking-[0.15em] text-nerv-muted hover:text-nerv-amber transition-colors uppercase"
          >
            COL
          </button>
        </div>

        {/* folder filter input — icon-triggered, collapsed by default */}
        {searchOpen ? (
          <div className="flex items-center gap-2 h-7 bg-nerv-bg border border-nerv-amber/40 px-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-nerv-amber">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              autoFocus
              value={filterRaw}
              onChange={(e) => setFilterRaw(e.target.value)}
              onBlur={() => { if (!filterRaw.trim()) setSearchOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setFilterRaw(""); setSearchOpen(false); } }}
              placeholder="FILTER.DIR"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent outline-none text-nerv-amber placeholder:text-nerv-muted/60 text-[10px] font-mono tracking-wider"
            />
            <button
              type="button"
              onClick={() => { setFilterRaw(""); setSearchOpen(false); }}
              className="text-nerv-muted hover:text-nerv-text shrink-0"
              aria-label="Close filter"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Filter directories"
            aria-label="Filter directories"
            className={`flex items-center gap-2 h-7 px-2 border transition-colors ${
              filter
                ? "border-nerv-amber/40 text-nerv-amber bg-nerv-amber/5"
                : "border-nerv-border/60 text-nerv-muted hover:text-nerv-amber hover:border-nerv-amber/40"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase">{filter ? filterRaw : "FILTER.DIR"}</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visible ? (
          <FolderTreeNode
            node={visible.tree}
            depth={0}
            expanded={
              filter ? new Set([...expanded, ...visible.forced]) : expanded
            }
            onToggleExpand={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            selectedFolder={selectedFolder}
            onSelectFolder={onSelectFolder}
            filter={filter}
            onDropFiles={onDropFiles}
            selectedIds={selectedIds}
            hiddenFolders={hiddenFolders}
            rootSize={visible.tree.size}
          />
        ) : (
          <div className="text-[10px] font-mono text-nerv-muted px-1 py-2">
            {filter ? "NO MATCH" : "NO DIRECTORY"}
          </div>
        )}
      </div>
    </>
  );
});

/* --------------------------- Classification Tags --------------------------- */

const TagSection = memo(function TagSection({
  tags,
  activeTags,
  tagCounts,
  onAddTag,
  onRemoveTag,
  onToggleActiveTag,
}: {
  tags: TagDef[];
  activeTags: Set<string>;
  tagCounts: Map<string, number>;
  onAddTag?: (label: string, category?: TagDef["category"]) => string;
  onRemoveTag?: (key: string) => void;
  onToggleActiveTag?: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const handleAdd = () => {
    const label = newLabel.trim();
    if (label && onAddTag) {
      onAddTag(label);
      setNewLabel("");
      setAdding(false);
    }
  };

  return (
    <div className="border-t border-nerv-border/60 flex flex-col">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-nerv-panel-2/50 transition-colors w-full"
      >
        <span
          className={`text-[9px] text-nerv-muted transition-transform ${
            collapsed ? "" : "rotate-90"
          }`}
        >
          ▸
        </span>
        <span className="text-[9px] font-bold tracking-[0.25em] text-nerv-amber">
          TAGS
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-nerv-amber/40 to-transparent" />
        <span className="text-[9px] font-mono text-nerv-muted tabular-nums">
          {tags.length}
        </span>
      </button>

      {/* Tag pills */}
      {!collapsed && (
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          {tags.map((tag) => {
            const active = activeTags.has(tag.key);
            const count = tagCounts.get(tag.key) ?? 0;
            return (
              <div key={tag.key} className="group/tag flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onToggleActiveTag?.(tag.key)}
                  className="flex-1 flex items-center gap-2 h-7 px-2 text-[10px] font-bold tracking-wider transition-all"
                  style={{
                    color: active ? tag.color : "#6a6a65",
                    backgroundColor: active ? tag.bg : "transparent",
                    borderLeft: `2px solid ${tag.border}`,
                    borderTop: "1px solid rgba(31,31,35,0.8)",
                    borderRight: "1px solid rgba(31,31,35,0.8)",
                    borderBottom: "1px solid rgba(31,31,35,0.8)",
                  }}
                >
                  <span
                    className="w-2 h-2 shrink-0"
                    style={{
                      backgroundColor: tag.color,
                      boxShadow: active ? `0 0 6px ${tag.color}` : "none",
                    }}
                  />
                  <span className="flex-1 text-left">{tag.label}</span>
                  <span className="font-mono text-[9px] tabular-nums opacity-70">
                    {pad(count, 3)}
                  </span>
                </button>
                {onRemoveTag && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTag(tag.key);
                    }}
                    className="opacity-0 group-hover/tag:opacity-100 text-nerv-muted hover:text-nerv-red text-[10px] font-mono w-4 h-4 flex items-center justify-center transition-opacity"
                    title="Remove tag"
                  >
                    {"\u2715"}
                  </button>
                )}
              </div>
            );
          })}

          {/* Add new tag */}
          {adding ? (
            <div className="flex items-center gap-1.5 mt-1">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewLabel("");
                  }
                }}
                placeholder="TAG LABEL"
                autoFocus
                className="eva-cut-tr flex-1 bg-nerv-bg border border-nerv-orange/40 text-nerv-text text-[10px] font-mono px-2 py-1.5 outline-none focus:border-nerv-orange"
              />
              <button
                type="button"
                onClick={handleAdd}
                className="tag-chip px-2 py-1 bg-nerv-orange/20 border border-nerv-orange/50 text-nerv-orange text-[9px] font-bold hover:bg-nerv-orange/30"
              >
                ADD
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewLabel("");
                }}
                className="text-nerv-muted hover:text-nerv-red text-[10px] font-mono px-1"
              >
                {"\u2715"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex items-center gap-1.5 h-7 px-2 text-[10px] font-mono text-nerv-muted hover:text-nerv-orange transition-colors"
            >
              <span className="text-[12px] leading-none">+</span>
              <span className="tracking-wider">ADD TAG</span>
            </button>
          )}

          {activeTags.size > 0 && (
            <div className="mt-1 text-[8px] font-mono text-nerv-muted text-center">
              {activeTags.size} FILTER{activeTags.size > 1 ? "S" : ""} ACTIVE
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/* --------------------------- Storage telemetry ---------------------------- */

const StorageTelemetry = memo(function StorageTelemetry({
  stats,
}: {
  stats: ScanStats;
}) {
  const img = stats.imageCount;
  const vid = stats.videoCount;
  const total = Math.max(1, img + vid); // avoid divide-by-zero

  // Segmented ratio bar: cyan images + green videos, proportional widths.
  const imgPct = (img / total) * 100;
  const vidPct = 100 - imgPct;

  // Tick marks every 10px across the bar (overdrawn, decorative).
  const ticks = useMemo(() => {
    // 10px stride over a nominal 240px-wide bar; CSS flex handles real width.
    return Array.from({ length: 23 }, (_, i) => i);
  }, []);

  return (
    <div className="border-t border-nerv-border/60 p-3 bg-black/40 flex flex-col gap-2">
      <SectionLabel>STORAGE // TELEMETRY</SectionLabel>

      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="phosphor-dim tracking-wider">TOTAL</span>
        <span className="phosphor-amber">{formatBytes(stats.totalSizeBytes)}</span>
      </div>

      {/* chunky segmented ratio bar */}
      <div className="eva-segbar relative h-3 flex">
        <div
          className="h-full bg-nerv-cyan shadow-[0_0_8px_#20f0ff]"
          style={{ width: `${imgPct}%` }}
        />
        <div
          className="h-full bg-nerv-green shadow-[0_0_8px_#50ff50]"
          style={{ width: `${vidPct}%` }}
        />
        {/* dark tick marks overdrawn */}
        <div className="absolute inset-0 flex justify-between pointer-events-none">
          {ticks.map((i) => (
            <span key={i} className="w-px h-full bg-black/50" />
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex items-center gap-4 text-[10px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-nerv-cyan shadow-[0_0_6px_#20f0ff]" />
          <span className="phosphor-cyan">IMG</span>
          <span className="phosphor-cyan tabular-nums">{pad(img, 3)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-nerv-green shadow-[0_0_6px_#50ff50]" />
          <span className="phosphor-green">VID</span>
          <span className="phosphor-green tabular-nums">{pad(vid, 3)}</span>
        </div>
      </div>

      {/* status line */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-nerv-amber shadow-[0_0_8px_#ffb700] animate-pulse-soft" />
        <span className="phosphor-dim tracking-[0.2em]">MAGI.LINK NOMINAL</span>
      </div>
    </div>
  );
});

/* -------------------------------- Sidebar --------------------------------- */

function SidebarInner({
  open,
  tree,
  totalFolders,
  selectedFolder,
  hiddenFolders,
  onSelectFolder,
  typeFilter,
  onTypeFilterChange,
  stats,
  favoriteCount,
  onDropFiles,
  selectedIds,
  tags,
  activeTags,
  tagCounts,
  onAddTag,
  onRemoveTag,
  onToggleActiveTag,
}: SidebarProps) {
  // Folder expansion state is LOCAL to the sidebar.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <aside
      className={`shrink-0 h-full transition-all duration-300 overflow-hidden ${
        open ? "w-64" : "w-0"
      } border-r border-nerv-border/60 bg-nerv-panel`}
      aria-label="Sidebar"
    >
      <div className="w-64 h-full flex flex-col">
        <QuickViews
          typeFilter={typeFilter}
          onTypeFilterChange={onTypeFilterChange}
          onSelectFolder={onSelectFolder}
          stats={stats}
          favoriteCount={favoriteCount}
        />

        <DirectoryExplorer
          tree={tree}
          totalFolders={totalFolders}
          hiddenFolders={hiddenFolders}
          selectedFolder={selectedFolder}
          onSelectFolder={onSelectFolder}
          expanded={expanded}
          setExpanded={setExpanded}
          onDropFiles={onDropFiles}
          selectedIds={selectedIds}
        />

        {/* Classification Tags — v2.5 §Module 3.3 */}
        {tags && (
          <TagSection
            tags={tags}
            activeTags={activeTags ?? new Set()}
            tagCounts={tagCounts ?? new Map()}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onToggleActiveTag={onToggleActiveTag}
          />
        )}

        <StorageTelemetry stats={stats} />
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarInner);
export default Sidebar;
