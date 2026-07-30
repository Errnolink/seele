import React, { useState, useMemo, useEffect } from "react";
import { MediaFile } from "../../scanner/types";
import "./FolderTree.css";

export interface FolderTreeProps {
  files: MediaFile[];
  /**
   * A value that changes whenever `files` content changes (e.g. the file
   * count). Passed explicitly because `files` may arrive as the same
   * array reference across batches; including this in the tree `useMemo`
   * deps guarantees the tree rebuilds as files stream in (review #4).
   */
  filesVersion: number;
  rootPath: string;
  selectedFolder: string | null;
  onSelect: (folderPath: string | null) => void;
}

interface TreeNode {
  path: string;
  normPath: string;
  name: string;
  count: number;
  children: TreeNode[];
}

function normalizePath(p: string): string {
  if (!p) return "";
  let s = p.replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/") && !s.endsWith(":/")) {
    s = s.slice(0, -1);
  }
  // Lowercase to match the scanner's precomputed `normPath` so every
  // comparison (tree keys, selection, filtering) is consistent and
  // case-insensitive (v2 review #10).
  return s.toLowerCase();
}

function getBasename(p: string): string {
  if (!p) return "";
  // Split the raw path — do NOT route through normalizePath, which
  // lowercases and would display folder names in lowercase (v3 review #10).
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  /** Pre-normalized selected folder (lowercase), or null. */
  normSelectedFolder: string | null;
  expandedPaths: Set<string>;
  onToggleExpand: (normPath: string, e: React.MouseEvent) => void;
  onSelect: (path: string) => void;
}
const TreeNodeRow: React.FC<TreeNodeRowProps> = ({
  node,
  depth,
  normSelectedFolder,
  expandedPaths,
  onToggleExpand,
  onSelect,
}) => {
  const isExpanded = expandedPaths.has(node.normPath);
  const isSelected =
    normSelectedFolder !== null && normSelectedFolder === node.normPath;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={`flex items-center py-1.5 px-3 cursor-pointer border-l-2 transition-all duration-150 gap-1.5 leading-tight text-xs font-mono select-none ${
          isSelected
            ? "bg-nerv-orange/15 border-nerv-orange text-nerv-amber font-semibold shadow-[inset_0_0_12px_rgba(255,85,0,0.12)]"
            : "border-transparent hover:bg-nerv-panel-2 hover:shadow-[inset_0_0_8px_rgba(255,85,0,0.1)] text-nerv-text"
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => onSelect(node.path)}
        title={node.path}
      >
        {hasChildren ? (
          <button
            type="button"
            className="inline-flex items-center justify-center w-4 h-4 p-0 bg-transparent border-0 text-nerv-orange cursor-pointer flex-shrink-0 hover:text-nerv-amber transition-colors"
            onClick={(e) => onToggleExpand(node.normPath, e)}
            aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isExpanded ? (
                <polyline points="6 9 12 15 18 9" />
              ) : (
                <polyline points="9 18 15 12 9 6" />
              )}
            </svg>
          </button>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 flex-shrink-0 ${
            isSelected ? "text-nerv-orange" : "text-nerv-amber/70"
          }`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
        </span>
        <span className="flex-1 truncate">{node.name}</span>
        <span
          className={`font-mono text-[10px] flex-shrink-0 px-1.5 py-0.5 ${
            isSelected
              ? "text-nerv-amber bg-nerv-orange/20"
              : node.count >= 1000
                ? "text-nerv-orange bg-nerv-panel-2"
                : node.count >= 100
                  ? "text-nerv-amber bg-nerv-panel-2"
                  : node.count >= 10
                    ? "text-nerv-cyan bg-nerv-panel-2"
                    : "text-nerv-muted bg-nerv-panel-2"
          }`}
        >
          {node.count}
        </span>
      </div>

      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.normPath}
            node={child}
            depth={depth + 1}
            normSelectedFolder={normSelectedFolder}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
          />
        ))}
    </>
  );
};

export const FolderTree: React.FC<FolderTreeProps> = ({
  files,
  filesVersion,
  rootPath,
  selectedFolder,
  onSelect,
}) => {
  const normRootPath = useMemo(() => normalizePath(rootPath), [rootPath]);
  // Precompute once so each row doesn't re-normalize on every render
  // (v3 review #6).
  const normSelectedFolder = useMemo(
    () => (selectedFolder ? normalizePath(selectedFolder) : null),
    [selectedFolder],
  );

  const tree = useMemo(() => {
    const normRoot = normalizePath(rootPath);
    const sep =
      rootPath.includes("\\") ||
      (files.length > 0 && files[0].filePath.includes("\\"))
        ? "\\"
        : "/";

    interface RawNode {
      path: string;
      normPath: string;
      name: string;
      count: number;
      childrenNormPaths: Set<string>;
    }

    const nodeMap = new Map<string, RawNode>();

    const rootRaw: RawNode = {
      path: rootPath,
      normPath: normRoot,
      name: getBasename(rootPath),
      count: 0,
      childrenNormPaths: new Set(),
    };
    nodeMap.set(normRoot, rootRaw);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fp = file.filePath;
      if (!fp) continue;

      const normFp = fp.replace(/\\/g, "/");
      const lastSlashIdx = normFp.lastIndexOf("/");
      const dirPath = lastSlashIdx > 0 ? fp.slice(0, lastSlashIdx) : rootPath;
      const normDir = normalizePath(dirPath);

      if (
        normDir === normRoot ||
        normDir.startsWith(normRoot + "/")
      ) {
        // Compute the relative path from the ORIGINAL-case dirPath so the
        // node `name` (last segment) keeps its real casing instead of the
        // lowercased form used only for matching/keys (v3 review #10).
        const origDir = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
        const rel =
          origDir.length > normalizePath(rootPath).length
            ? origDir.slice(normalizePath(rootPath).length + 1)
            : "";
        const segments = rel ? rel.split("/").filter(Boolean) : [];

        let currentNormPath = normRoot;
        let currentOrigPath = rootPath;

        nodeMap.get(normRoot)!.count++;

        for (let s = 0; s < segments.length; s++) {
          const seg = segments[s];
          const nextNormPath = currentNormPath + "/" + seg;
          const nextOrigPath = currentOrigPath.endsWith(sep)
            ? currentOrigPath + seg
            : currentOrigPath + sep + seg;

          let node = nodeMap.get(nextNormPath);
          if (!node) {
            node = {
              path: nextOrigPath,
              normPath: nextNormPath,
              name: seg,
              count: 0,
              childrenNormPaths: new Set(),
            };
            nodeMap.set(nextNormPath, node);

            const parentNode = nodeMap.get(currentNormPath);
            if (parentNode) {
              parentNode.childrenNormPaths.add(nextNormPath);
            }
          }
          node.count++;

          currentNormPath = nextNormPath;
          currentOrigPath = nextOrigPath;
        }
      } else {
        rootRaw.count++;
      }
    }

    function buildTreeNode(normPath: string): TreeNode {
      const raw = nodeMap.get(normPath)!;
      const children: TreeNode[] = [];
      for (const childNorm of raw.childrenNormPaths) {
        children.push(buildTreeNode(childNorm));
      }
      children.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );

      return {
        path: raw.path,
        normPath: raw.normPath,
        name: raw.name,
        count: raw.count,
        children,
      };
    }

    return buildTreeNode(normRoot);
  }, [files, filesVersion, rootPath]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([normRootPath])
  );

  // Auto-expand the root whenever the user picks a new folder, so the
  // tree isn't left with only the old root's normPath expanded (v2 #13).
  useEffect(() => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add(normRootPath);
      return next;
    });
  }, [normRootPath]);

  const handleToggleExpand = (normPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(normPath)) {
        next.delete(normPath);
      } else {
        next.add(normPath);
      }
      return next;
    });
  };

  /** Recursively collect every normPath in the tree (for Expand All). */
  function collectAllNormPaths(node: TreeNode, acc: Set<string>): void {
    acc.add(node.normPath);
    for (const child of node.children) collectAllNormPaths(child, acc);
  }

  const handleExpandAll = () => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      collectAllNormPaths(tree, next);
      return next;
    });
  };

  const handleCollapseAll = () => {
    // Keep only the root expanded so the tree doesn't fully vanish.
    setExpandedPaths(new Set([normRootPath]));
  };

  const isAllFilesSelected = selectedFolder === null;

  return (
    <aside className="folder-tree-sidebar h-full flex flex-col bg-nerv-panel/50 overflow-y-auto select-none font-mono text-xs">
        {/* Expand / Collapse All toolbar (review issue #22) */}
        <div className="flex items-center gap-1 px-3 py-1 border-b border-nerv-border/40 mb-1">
          <button
            type="button"
            className="px-1.5 py-0.5 text-[9px] font-mono uppercase text-nerv-muted hover:text-nerv-cyan border border-transparent hover:border-nerv-cyan/40 transition-colors cursor-pointer"
            onClick={handleExpandAll}
            title="Expand all folders"
          >
            + Expand
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-[9px] font-mono uppercase text-nerv-muted hover:text-nerv-cyan border border-transparent hover:border-nerv-cyan/40 transition-colors cursor-pointer"
            onClick={handleCollapseAll}
            title="Collapse all folders"
          >
            − Collapse
          </button>
        </div>
      <div className="py-2 flex flex-col">
        {/* All Files Node */}
        <div
          className={`flex items-center py-1.5 px-3 cursor-pointer border-l-2 transition-all duration-150 gap-1.5 leading-tight text-xs font-mono ${
            isAllFilesSelected
              ? "bg-nerv-cyan/15 border-nerv-cyan text-nerv-cyan font-bold"
              : "border-transparent hover:bg-nerv-panel-2 hover:shadow-[inset_0_0_8px_rgba(255,85,0,0.1)] text-nerv-text"
          }`}
          style={{ paddingLeft: "12px" }}
          onClick={() => onSelect(null)}
          title="All Files"
        >
          <span className="w-4 h-4 flex-shrink-0" />
          <span
            className={`inline-flex items-center justify-center w-4 h-4 flex-shrink-0 ${
              isAllFilesSelected ? "text-nerv-cyan" : "text-nerv-amber/70"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </span>
          <span className="flex-1 truncate">All Files</span>
          <span
            className={`font-mono text-[10px] flex-shrink-0 px-1.5 py-0.5 ${
              isAllFilesSelected ? "text-nerv-cyan bg-nerv-cyan/20" : "text-nerv-muted bg-nerv-panel-2"
            }`}
          >
            {files.length}
          </span>
        </div>

        {/* Folder Hierarchy starting with root folder */}
        <TreeNodeRow
          node={tree}
          depth={0}
          normSelectedFolder={normSelectedFolder}
          expandedPaths={expandedPaths}
          onToggleExpand={handleToggleExpand}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
};

export default FolderTree;

