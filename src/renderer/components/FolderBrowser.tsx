/**
 * FolderBrowser — the "FOLDERS" view mode (v2.5 §Module 4).
 *
 * Renders subfolders of the current directory as tactical cards: each
 * card shows the folder name, full path, relative capacity bar, filetype
 * breakdown (IMG/VID/RAW), four sample thumbnail previews, and an
 * EXPLORE button that drills into the subfolder.
 *
 * Unlike the mockup (which derives everything from a synthetic dataset),
 * this operates on the real scanner `MediaFile[]` + the folder tree built
 * in App. Per-folder type counts and sample thumbs are computed here from
 * the file list so we don't need a richer tree node.
 */
import { memo, useMemo } from "react";
import type { FolderNode, MediaFile } from "../types";
import { formatBytes } from "../utils";

/** RAW sensor file extensions (mapped to the magenta RAW chip). */
const RAW_EXTS: Record<string, true> = {
  arw: true, cr2: true, cr3: true, dng: true, nef: true,
  raf: true, rw2: true, orf: true, pef: true, srw: true,
};

interface FolderBrowserProps {
  /** The full folder tree (root + descendants) built in App. */
  tree: FolderNode | null;
  /** Currently selected folder path, or null for root. */
  currentFolder: string | null;
  /** Drill into a folder (null = root). */
  onSelectFolder: (folder: string | null) => void;
  /** All scanned files — used for per-folder type counts + sample thumbs. */
  files: MediaFile[];
  /** Total bytes across the whole archive (for the relative capacity bar). */
  totalBytes: number;
  /** Folders hidden from the grid (subtree match). */
  hiddenFolders: Set<string>;
  /** Toggle a folder's hidden state. */
  onToggleHideFolder: (folderPath: string) => void;
  /** Right-click handler — opens the App-level folder context menu. */
  onFolderContextMenu?: (folderPath: string, x: number, y: number) => void;
}

/** Coarse type breakdown for files inside a folder subtree. */
interface TypeBreakdown {
  img: number;
  vid: number;
  raw: number;
}

/** Classify a single file into IMG / VID / RAW. */
function classifyFile(f: MediaFile): "img" | "vid" | "raw" {
  if (f.fileType === "video") return "vid";
  const ext = f.filePath.split(".").pop()?.toLowerCase() ?? "";
  if (RAW_EXTS[ext] === true) return "raw";
  return "img";
}

/** Build folder → files map (each folder's subtree: own + descendants) in
 *  ONE pass over the file list. Cards read their bucket in O(1) instead of
 *  each card re-filtering the whole array (O(cards × files)). Keys are the
 *  tree's normalized lowercase paths (matching `FolderNode.path`). */
function buildFolderBuckets(
  tree: FolderNode,
  files: MediaFile[],
): Map<string, MediaFile[]> {
  const buckets = new Map<string, MediaFile[]>();
  const rootNorm = tree.path.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  for (const f of files) {
    const rel = f.normPath.startsWith(rootNorm + "/")
      ? f.normPath.slice(rootNorm.length + 1)
      : f.normPath;
    const segs = rel.split("/").filter(Boolean);
    segs.pop(); // drop the file name — directory segments only
    let acc = rootNorm;
    let bucket = buckets.get(acc);
    if (!bucket) {
      bucket = [];
      buckets.set(acc, bucket);
    }
    bucket.push(f);
    for (const seg of segs) {
      acc += "/" + seg;
      bucket = buckets.get(acc);
      if (!bucket) {
        bucket = [];
        buckets.set(acc, bucket);
      }
      bucket.push(f);
    }
  }
  return buckets;
}

/** Derive a thumbnail URL for a sample file (small, sharp-resized). */
function thumbUrl(filePath: string): string {
  return `${window.scanAPI.toMediaUrl(filePath)}?w=96`;
}

/** Find the parent of `target` in the tree, or null if it's the root. */
function findParent(node: FolderNode, target: FolderNode): FolderNode | null {
  for (const c of node.children) {
    if (c === target) return node;
    const hit = findParent(c, target);
    if (hit) return hit;
  }
  return null;
}

export const FolderBrowser = memo(function FolderBrowser({
  tree,
  currentFolder,
  onSelectFolder,
  files,
  totalBytes,
  hiddenFolders,
  onToggleHideFolder,
  onFolderContextMenu,
}: FolderBrowserProps) {
  // Resolve the node we're currently viewing (root if nothing selected).
  const viewingNode = useMemo(() => {
    if (!tree) return null;
    if (!currentFolder) return tree;
    const norm = currentFolder.replace(/\\/g, "/").toLowerCase();
    const find = (node: FolderNode): FolderNode | null => {
      const nodeNorm = node.path.replace(/\\/g, "/").toLowerCase();
      if (nodeNorm === norm) return node;
      for (const c of node.children) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    return find(tree) ?? tree;
  }, [tree, currentFolder]);

  // Breadcrumb path segments for the header trail.
  const pathSegments = useMemo(() => {
    if (!viewingNode || viewingNode === tree) return [];
    return viewingNode.path.replace(/\\/g, "/").split("/").filter(Boolean);
  }, [viewingNode, tree]);

  // Subtree file buckets, built once per (tree, files) change — cards no
  // longer re-filter the entire file list each render.
  const folderBuckets = useMemo(
    () => (tree ? buildFolderBuckets(tree, files) : new Map<string, MediaFile[]>()),
    [tree, files],
  );

  if (!tree || !viewingNode) {
    return (
      <div className="w-full h-full flex items-center justify-center text-nerv-muted font-mono text-xs">
        No folders available.
      </div>
    );
  }

  const subfolders = viewingNode.children;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* ── BREADCRUMB EXPLORER HEADER ── */}
      <div className="flex items-center justify-between border-b border-nerv-border/60 pb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-orange shrink-0">
            <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" />
            <rect x="3" y="9" width="18" height="11" />
          </svg>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[12px] font-bold flex-wrap">
              <button
                type="button"
                onClick={() => onSelectFolder(null)}
                className={`hover:text-nerv-cyan cursor-pointer transition-colors ${!currentFolder ? "text-nerv-orange" : "text-nerv-text-dim"}`}
              >
                ROOT_ARCHIVE
              </button>
              {pathSegments.map((seg, idx) => {
                const isLast = idx === pathSegments.length - 1;
                return (
                  <span key={idx} className="flex items-center gap-1.5">
                    <span className="text-nerv-muted">/</span>
                    <span
                      className={isLast ? "text-nerv-cyan font-bold" : "text-nerv-text-dim"}
                    >
                      {seg}
                    </span>
                  </span>
                );
              })}
            </div>
            <p className="text-[9px] text-nerv-muted font-mono mt-0.5 truncate">
              {currentFolder
                ? `${subfolders.length} SUBFOLDERS · ${formatBytes(viewingNode.size)}`
                : `ALL ROOT VOLUMES · ${subfolders.length} DIRECTORIES`}
            </p>
          </div>
        </div>

        {currentFolder && (
          <button
            type="button"
            onClick={() => {
              const parent = findParent(tree, viewingNode);
              onSelectFolder(parent && parent !== tree ? parent.path : null);
            }}
            className="shrink-0 flex items-center gap-1 border border-nerv-border bg-nerv-panel px-3 py-1.5 font-mono text-[9px] font-bold text-nerv-text-dim hover:text-nerv-text hover:border-nerv-orange transition-all"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4l-4 4 4 4" />
            </svg>
            LEVEL UP
          </button>
        )}
      </div>

      {/* ── SUBFOLDERS TACTICAL GRID ── */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-nerv-orange">
              {currentFolder ? "SUB-DIRECTORIES IN THIS VOLUME" : "ALL MASTER DIRECTORY VOLUMES"}
            </span>
            <span className="bg-nerv-panel-hi px-2 py-0.5 font-mono text-[9px] text-nerv-cyan border border-nerv-border">
              {subfolders.length} VOLUMES
            </span>
          </div>
        </div>

        {subfolders.length === 0 ? (
          <div className="border border-nerv-border bg-nerv-panel p-8 text-center">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1" className="text-nerv-muted mx-auto mb-2">
              <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" />
              <rect x="3" y="9" width="18" height="11" />
            </svg>
            <div className="font-mono text-[11px] font-bold text-nerv-text mb-1">
              NO NESTED SUBFOLDERS
            </div>
            <p className="font-mono text-[9px] text-nerv-muted">
              This volume contains direct media assets with no deeper directory tiers.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {subfolders.map((folderStat) => (
              <SubfolderCard
                key={folderStat.path}
                folder={folderStat}
                folderFiles={folderBuckets.get(folderStat.path) ?? []}
                totalBytes={totalBytes}
                onSelect={onSelectFolder}
                onFolderContextMenu={onFolderContextMenu}
                hiddenFolders={hiddenFolders}
                onToggleHideFolder={onToggleHideFolder}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Subfolder card ────────────────────────────────────────────────────

interface SubfolderCardProps {
  folder: FolderNode;
  /** Files inside this folder's subtree (own + descendants), pre-bucketed. */
  folderFiles: MediaFile[];
  totalBytes: number;
  onSelect: (folder: string | null) => void;
  hiddenFolders: Set<string>;
  onToggleHideFolder: (folderPath: string) => void;
  /** Right-click handler — opens the App-level folder context menu. */
  onFolderContextMenu?: (folderPath: string, x: number, y: number) => void;
}

const SubfolderCard = memo(function SubfolderCard({
  folder,
  folderFiles,
  totalBytes,
  onSelect,
  hiddenFolders,
  onToggleHideFolder,
  onFolderContextMenu,
}: SubfolderCardProps) {
  // Type breakdown: IMG / VID / RAW.
  const { img, vid, raw } = useMemo<TypeBreakdown>(() => {
    let i = 0, v = 0, r = 0;
    for (const f of folderFiles) {
      const c = classifyFile(f);
      if (c === "vid") v++;
      else if (c === "raw") r++;
      else i++;
    }
    return { img: i, vid: v, raw: r };
  }, [folderFiles]);

  // Four sample thumbnails (first files by scan order).
  const samples = useMemo(
    () => folderFiles.slice(0, 4),
    [folderFiles],
  );

  const relativePercent = totalBytes > 0 ? (folder.size / totalBytes) * 100 : 0;
  const displayPath = "/" + folder.path.replace(/\\/g, "/");
  const isHidden = hiddenFolders.has(folder.path);

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        if (onFolderContextMenu) onFolderContextMenu(folder.path, e.clientX, e.clientY);
        else onToggleHideFolder(folder.path);
      }}
      className={`group relative flex flex-col border bg-nerv-panel transition-all overflow-hidden ${
        isHidden
          ? "border-nerv-border/30 opacity-40 grayscale"
          : "border-nerv-border hover:border-nerv-orange/70 hover:shadow-[0_0_24px_rgba(255,152,48,0.25)]"
      }`}
    >
      {/* Top Bar: folder name + size */}
      <div className="p-3 bg-nerv-panel-hi border-b border-nerv-border flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-nerv-orange shrink-0">
              <path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" />
              <rect x="3" y="9" width="18" height="11" />
            </svg>
            <h3 className="font-mono text-[12px] font-bold text-nerv-text truncate tracking-wide group-hover:text-nerv-cyan transition-colors">
              {folder.name}
            </h3>
          </div>
          <p className="font-mono text-[8.5px] text-nerv-muted truncate">
            {displayPath}
          </p>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <span className="font-mono text-[11px] font-bold text-nerv-cyan tabular-nums">
            {formatBytes(folder.size)}
          </span>
          <span className="text-[7.5px] font-mono text-nerv-lime">
            {relativePercent.toFixed(1)}% ARCHIVE
          </span>
        </div>

        {/* Hide/unhide toggle — grays out the card and excludes files from the grid */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleHideFolder(folder.path);
          }}
          title={isHidden ? "Unhide folder" : "Hide folder from grid"}
          aria-label={isHidden ? "Unhide folder" : "Hide folder from grid"}
          className={`shrink-0 w-6 h-6 flex items-center justify-center transition-colors ${
            isHidden
              ? "text-nerv-amber hover:text-nerv-orange"
              : "text-nerv-muted/50 opacity-0 group-hover:opacity-100 hover:text-nerv-amber"
          }`}
        >
          {isHidden ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>
          )}
        </button>
      </div>

      {/* ── Relative capacity bar ── */}
      <div className="h-2 w-full bg-black border-b border-nerv-border relative overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-nerv-orange via-nerv-cyan to-nerv-green transition-all duration-500"
          style={{ width: `${Math.max(4, relativePercent)}%` }}
        />
      </div>

      {/* Sample thumbnails + type chips */}
      <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
        <div>
          <div className="grid grid-cols-4 gap-1.5 h-14 mb-2">
            {samples.map((n) => {
              const kind = classifyFile(n) === "vid" ? "VID" : classifyFile(n) === "raw" ? "RAW" : "IMG";
              return (
                <div
                  key={n.filePath}
                  className="relative h-full w-full overflow-hidden border border-nerv-border bg-nerv-panel thumb-checkerboard"
                >
                  <img
                    src={thumbUrl(n.filePath)}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                  <span className="absolute bottom-0.5 right-0.5 bg-black/80 px-1 text-[6.5px] font-mono font-bold text-nerv-text">
                    {kind}
                  </span>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, 4 - samples.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-full w-full bg-nerv-panel-hi border border-nerv-border/50"
              />
            ))}
          </div>

          {/* Filetype breakdown chips */}
          <div className="grid grid-cols-3 gap-1 text-[8px] font-mono">
            <TypeChip color="cyan" count={img} label="IMG" />
            <TypeChip color="green" count={vid} label="VID" />
            <TypeChip color="magenta" count={raw} label="RAW" />
          </div>
        </div>

        {/* Subfolder count + EXPLORE */}
        <div className="pt-2 border-t border-nerv-border flex items-center justify-between text-[9px] font-mono">
          <span className="text-nerv-text-dim">
            {folder.children.length > 0 ? (
              <span className="text-nerv-amber font-bold">
                {folder.children.length} SUBDIRECTOR{folder.children.length === 1 ? "Y" : "IES"}
              </span>
            ) : (
              <span className="text-nerv-muted">0 SUBDIRECTORIES</span>
            )}
          </span>

          <button
            type="button"
            onClick={() => onSelect(folder.path)}
            className="flex items-center gap-1 bg-nerv-orange px-2.5 py-1 text-[8.5px] font-bold text-black uppercase tracking-wider shadow-[0_0_8px_rgba(255,152,48,0.3)] hover:brightness-110 cursor-pointer transition-all"
          >
            <span>EXPLORE</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8h9M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

// ── Type chip ─────────────────────────────────────────────────────────

interface TypeChipProps {
  color: "cyan" | "green" | "magenta";
  count: number;
  label: string;
}

function TypeChip({ color, count, label }: TypeChipProps) {
  const styles: Record<TypeChipProps["color"], string> = {
    cyan: "bg-nerv-cyan/10 text-nerv-cyan border-nerv-cyan/30",
    green: "bg-nerv-green/10 text-nerv-green border-nerv-green/30",
    magenta: "bg-nerv-magenta/10 text-nerv-magenta border-nerv-magenta/30",
  };
  return (
    <div className={`flex items-center gap-1 p-1 border ${styles[color]}`}>
      <span className="font-bold">{count}</span>
      <span>{label}</span>
    </div>
  );
}

export default FolderBrowser;
