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
import { formatBytes, pad } from "../utils";

export interface SidebarProps {
  open: boolean;
  tree: FolderNode | null;
  totalFolders: number;
  selectedFolder: string | null;
  onSelectFolder: (p: string | null) => void;
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  stats: ScanStats;
  /** Move selected files to a directory (drag-to-folder support). */
  onDropFiles?: (filePaths: string[], destDir: string) => void;
  /** Currently selected file IDs (for the drag source). */
  selectedIds?: Set<string>;
}

/** A quick-view filter button definition (§7.2 table). */
interface QuickView {
  key: MediaTypeFilter;
  label: string;
  /** Bevel fill class when active. */
  fill: string;
  /** True when this row also clears the folder selection. */
  clearFolder?: boolean;
}

const QUICK_VIEWS: QuickView[] = [
  { key: "all", label: "ALL FILES", fill: "eva-fill-amber", clearFolder: true },
  { key: "image", label: "IMAGES", fill: "eva-fill-cyan" },
  { key: "video", label: "VIDEOS", fill: "eva-fill-green" },
  { key: "favorite", label: "STARRED", fill: "eva-fill-amber" },
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
        className={`w-1 h-3 bg-nerv-lime shadow-[0_0_6px_#a3e635] ${
          pulse ? "animate-pulse-soft" : ""
        }`}
      />
      <span className="text-[9px] font-bold tracking-[0.25em] phosphor-lime whitespace-nowrap">
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-nerv-purple/50 to-transparent" />
    </div>
  );
}

/* ------------------------------ Quick Views ------------------------------- */

interface QuickViewsProps {
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  onSelectFolder: (p: string | null) => void;
  stats: ScanStats;
}

const QuickViews = memo(function QuickViews({
  typeFilter,
  onTypeFilterChange,
  onSelectFolder,
  stats,
}: QuickViewsProps) {
  // Count per quick view. `all`/`favorite` share the file total; the per-type
  // figures come straight from the aggregate stats.
  const countFor = (key: MediaTypeFilter): number => {
    switch (key) {
      case "all":
      case "favorite":
        return stats.totalFiles;
      case "image":
        return stats.imageCount;
      case "video":
        return stats.videoCount;
      default:
        return stats.totalFiles;
    }
  };

  return (
    <div className="p-3 border-b border-nerv-purple/25 flex flex-col gap-2.5">
      <SectionLabel pulse>QUICK VIEWS</SectionLabel>
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
              className={`eva-ticket relative flex items-center gap-2 h-8 px-2.5 text-[10px] font-bold tracking-[0.18em] uppercase transition-[filter] duration-150 ${
                active ? qv.fill : "eva-dim"
              }`}
            >
              {/* semantic marker glyph (square chip) */}
              <span
                className={`w-2 h-2 shrink-0 ${
                  qv.key === "image"
                    ? "bg-nerv-cyan shadow-[0_0_6px_#22d3ee]"
                    : qv.key === "video"
                    ? "bg-nerv-green shadow-[0_0_6px_#4ade80]"
                    : "bg-nerv-amber shadow-[0_0_6px_#fbbf24]"
                }`}
              />
              <span className="flex-1 text-left">{qv.label}</span>
              <span
                className={`font-mono text-[10px] tabular-nums tracking-normal ${
                  active ? "phosphor-lime" : "phosphor-dim"
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
}: FolderTreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.path);
  const selected = selectedFolder === node.path;
  const [isDropTarget, setIsDropTarget] = useState(false);

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
        } ${isDropTarget ? "bg-nerv-lime/20 ring-1 ring-nerv-lime/50" : ""}`}
      >
        {/* 2px lime selection marker */}
        {selected && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-nerv-lime shadow-[0_0_8px_#a3e635]" />
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
}: DirectoryExplorerProps) {
  const [filterRaw, setFilterRaw] = useState("");
  // Keep typing responsive; defer the (potentially deep) subtree filter.
  const filter = useDeferredValue(filterRaw.trim().toLowerCase());

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
      <div className="p-3 border-b border-nerv-purple/25 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SectionLabel>DIRECTORY // {pad(totalFolders, 3)}</SectionLabel>
          </div>
          <button
            type="button"
            title="Expand all"
            aria-label="Expand all folders"
            onClick={expandAll}
            className="eva-sqbtn shrink-0 text-nerv-muted hover:text-nerv-lime"
          >
            +
          </button>
          <button
            type="button"
            title="Collapse all"
            aria-label="Collapse all folders"
            onClick={collapseAll}
            className="eva-sqbtn shrink-0 text-nerv-muted hover:text-nerv-lime"
          >
            −
          </button>
        </div>

        {/* folder filter input */}
        <div className="eva-frame">
          <div className="eva-inner flex items-center gap-1.5 h-7 px-2">
            <span className="phosphor-lime shrink-0">&gt;</span>
            <input
              value={filterRaw}
              onChange={(e) => setFilterRaw(e.target.value)}
              placeholder="FILTER.DIR"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent outline-none phosphor-lime placeholder:text-nerv-muted/60 text-[10px] font-mono tracking-wider"
            />
          </div>
        </div>
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
    <div className="border-t border-nerv-purple/20 p-3 bg-black/40 flex flex-col gap-2">
      <SectionLabel>STORAGE // TELEMETRY</SectionLabel>

      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="phosphor-dim tracking-wider">TOTAL</span>
        <span className="phosphor-amber">{formatBytes(stats.totalSizeBytes)}</span>
      </div>

      {/* chunky segmented ratio bar */}
      <div className="eva-segbar relative h-3 flex">
        <div
          className="h-full bg-nerv-cyan shadow-[0_0_8px_#22d3ee]"
          style={{ width: `${imgPct}%` }}
        />
        <div
          className="h-full bg-nerv-green shadow-[0_0_8px_#4ade80]"
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
          <span className="w-2 h-2 bg-nerv-cyan shadow-[0_0_6px_#22d3ee]" />
          <span className="phosphor-cyan">IMG</span>
          <span className="phosphor-cyan tabular-nums">{pad(img, 3)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-nerv-green shadow-[0_0_6px_#4ade80]" />
          <span className="phosphor-green">VID</span>
          <span className="phosphor-green tabular-nums">{pad(vid, 3)}</span>
        </div>
      </div>

      {/* status line */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-nerv-lime shadow-[0_0_8px_#a3e635] animate-pulse-soft" />
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
  onSelectFolder,
  typeFilter,
  onTypeFilterChange,
  stats,
  onDropFiles,
  selectedIds,
}: SidebarProps) {
  // Folder expansion state is LOCAL to the sidebar.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <aside
      className={`shrink-0 h-full transition-all duration-300 overflow-hidden ${
        open ? "w-64" : "w-0"
      } border-r border-nerv-purple/40`}
      style={{
        background:
          "linear-gradient(180deg, rgba(88,28,135,0.18) 0%, rgba(10,8,20,0.6) 100%)",
      }}
      aria-label="Sidebar"
    >
      {/* fixed-width inner wrapper so nothing reflows during the width anim */}
      <div className="w-64 h-full flex flex-col">
        <QuickViews
          typeFilter={typeFilter}
          onTypeFilterChange={onTypeFilterChange}
          onSelectFolder={onSelectFolder}
          stats={stats}
        />

        <DirectoryExplorer
          tree={tree}
          totalFolders={totalFolders}
          selectedFolder={selectedFolder}
          onSelectFolder={onSelectFolder}
          expanded={expanded}
          setExpanded={setExpanded}
          onDropFiles={onDropFiles}
          selectedIds={selectedIds}
        />

        <StorageTelemetry stats={stats} />
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarInner);
export default Sidebar;
