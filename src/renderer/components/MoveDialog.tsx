import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FolderNode } from "../types";

export interface MoveDialogProps {
  /** Root of the scanned library's folder tree. */
  tree: FolderNode;
  /** How many files are being moved. */
  count: number;
  onClose: () => void;
  onConfirm: (destDir: string) => void;
}

/** Flatten the tree into a list of { node, depth } for fuzzy search. */
function flattenTree(node: FolderNode, depth = 0): { node: FolderNode; depth: number }[] {
  const out = [{ node, depth }];
  for (const c of node.children) out.push(...flattenTree(c, depth + 1));
  return out;
}

/** Simple subsequence fuzzy match — all chars of query appear in order. */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * NERV-styled in-app move dialog. Renders the library's own folder tree
 * as a scrollable pick-list with fuzzy search — type to filter, click or
 * use ↑/↓ to select, hit ENTER to move.
 */
export const MoveDialog: React.FC<MoveDialogProps> = ({
  tree,
  count,
  onClose,
  onConfirm,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([tree.path]),
  );
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const q = query.trim();

  // When searching, flatten + filter the tree for a fast pick list.
  const flatResults = useMemo(() => {
    if (!q) return null;
    return flattenTree(tree)
      .filter(({ node }) => fuzzyMatch(node.name, q) || fuzzyMatch(node.path, q))
      .slice(0, 100);
  }, [tree, q]);

  // Reset active index + auto-select first result when search changes.
  useEffect(() => {
    setActiveIdx(0);
    if (flatResults && flatResults.length > 0) {
      setSelected(flatResults[0].node.path);
    }
  }, [flatResults]);

  // Scroll active item into view during keyboard navigation.
  useEffect(() => {
    if (!flatResults || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, flatResults]);

  // Keyboard navigation: ↑/↓ move highlight, ENTER moves, ESC closes.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!flatResults) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = Math.min(i + 1, flatResults.length - 1);
          if (flatResults[next]) setSelected(flatResults[next].node.path);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = Math.max(i - 1, 0);
          if (flatResults[next]) setSelected(flatResults[next].node.path);
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const dest = flatResults[activeIdx]?.node.path ?? selected;
        if (dest) onConfirm(dest);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [flatResults, activeIdx, selected, onConfirm, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[75vh] flex flex-col bg-nerv-panel border border-nerv-orange/50 rounded-lg shadow-[0_0_30px_rgba(255,85,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nerv-border">
          <span className="font-mono text-xs font-bold tracking-[0.2em] uppercase text-nerv-amber">
            MOVE {count} ITEM{count !== 1 ? "S" : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-nerv-muted hover:text-nerv-red text-sm font-mono"
          >
            ✕
          </button>
        </div>

        {/* Fuzzy search */}
        <div className="p-3 border-b border-nerv-border">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="SEARCH.FOLDER // type to filter, ↑↓ select, ENTER move..."
              autoFocus
              className="w-full bg-nerv-bg border border-nerv-border px-3 py-2 pl-8 font-mono text-[11px] text-nerv-text placeholder:text-nerv-muted/50 focus:outline-none focus:border-nerv-lime/60 transition-colors"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nerv-muted"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
          </div>
        </div>

        {/* Tree / search results */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {flatResults ? (
            flatResults.length === 0 ? (
              <div className="text-center py-8 font-mono text-[10px] text-nerv-muted tracking-wider">
                NO FOLDERS MATCH &quot;{q}&quot;
              </div>
            ) : (
              flatResults.map(({ node, depth }, idx) => {
                const isSel = selected === node.path;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={node.path}
                    data-idx={idx}
                    onClick={() => {
                      setSelected(node.path);
                      setActiveIdx(idx);
                    }}
                    onDoubleClick={() => onConfirm(node.path)}
                    style={{ paddingLeft: 6 + depth * 14 }}
                    className={`group relative flex items-center gap-1.5 py-[4px] pr-2 cursor-pointer font-mono text-[11px] tracking-wider rounded transition-colors ${
                      isSel
                        ? "bg-nerv-orange/15 text-nerv-amber"
                        : isActive
                          ? "bg-nerv-lime/10 text-nerv-text"
                          : "text-nerv-text hover:bg-nerv-panel-2"
                    }`}
                  >
                    <span className="shrink-0">{isSel ? "▣" : "▢"}</span>
                    <span className="flex-1 truncate">{node.name}</span>
                    <span className="shrink-0 tabular-nums text-nerv-muted text-[9px]">
                      {node.count}
                    </span>
                  </div>
                );
              })
            )
          ) : (
            <TreeList
              node={tree}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-nerv-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-[10px] font-mono font-bold tracking-wider uppercase text-nerv-muted hover:text-nerv-text border border-nerv-border rounded transition-colors"
          >
            CANCEL
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
            className={`px-4 py-1.5 text-[10px] font-mono font-bold tracking-wider uppercase rounded transition-colors ${
              selected
                ? "bg-nerv-orange/20 border border-nerv-orange text-nerv-amber hover:bg-nerv-orange/40"
                : "border border-nerv-border text-nerv-muted/40 cursor-not-allowed"
            }`}
          >
            MOVE
          </button>
        </div>
      </div>
    </div>
  );
};

interface TreeListProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  selected: string | null;
  onSelect: (p: string) => void;
}

const TreeList = memo(function TreeList({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
}: TreeListProps) {
  const isOpen = expanded.has(node.path);
  const isSel = selected === node.path;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isSel}
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: 6 + depth * 14 }}
        className={`group relative flex items-center gap-1.5 py-[4px] pr-2 cursor-pointer font-mono text-[11px] tracking-wider rounded transition-colors ${
          isSel
            ? "bg-nerv-orange/15 text-nerv-amber"
            : "text-nerv-text hover:bg-nerv-panel-2"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
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
        <span className="shrink-0">{isSel ? "▣" : "▢"}</span>
        <span className="flex-1 truncate">{node.name}</span>
        <span className="shrink-0 tabular-nums text-nerv-muted">
          {node.count}
        </span>
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeList
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default MoveDialog;
