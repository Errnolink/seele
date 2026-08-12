/**
 * Folder-tree builders for the library view.
 *
 * Extracted from App.tsx so the multi-root aggregation is unit-testable.
 * A single-root tree (buildFolderTree) is a nested hierarchy rooted at
 * the scanned folder; the library tree (buildLibraryTree) is a synthetic
 * root node whose children are one tree per library root — each root
 * shows up as a top-level "volume" in the folder browser.
 */
import type { FolderNode, MediaFile } from "./types";

/** Normalize an absolute path for tree-key comparisons (forward slashes,
 *  lowercased, no trailing slash). Mirrors the scanner's `normPath`. */
export function normKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
}

/**
 * Build a nested folder tree from the flat file list of one root (§10.1).
 * Each node carries a running file count and size sum. Uses the
 * scanner's precomputed `normPath` so we don't re-normalize on every
 * render.
 */
export function buildFolderTree(
  files: MediaFile[],
  rootPath: string,
): FolderNode | null {
  if (files.length === 0) return null;
  const normRoot = normKey(rootPath);
  const root: FolderNode = {
    path: rootPath,
    name: rootPath.split(/[\\/]/).pop() || rootPath,
    count: 0,
    size: 0,
    children: [],
  };
  // Index children by their normalized path segment stack for dedup.
  const nodeByPath = new Map<string, FolderNode>();
  nodeByPath.set(normRoot, root);

  for (const f of files) {
    // Walk from root down to the file's folder.
    const rel = f.normPath.startsWith(normRoot + "/")
      ? f.normPath.slice(normRoot.length + 1)
      : f.normPath;
    const segs = rel.split("/").filter(Boolean);
    // Drop the file name itself — keep directory segments only.
    segs.pop();
    let cur = root;
    let acc = normRoot;
    for (const seg of segs) {
      acc += "/" + seg;
      let child = nodeByPath.get(acc);
      if (!child) {
        child = {
          path: acc,
          name: seg,
          count: 0,
          size: 0,
          children: [],
        };
        nodeByPath.set(acc, child);
        cur.children.push(child);
      }
      cur = child;
    }
    cur.count += 1;
    cur.size += f.sizeBytes;
  }
  // Aggregate counts up the tree so parent folders show total descendant files.
  const aggregate = (nd: FolderNode): { count: number; size: number } => {
    for (const c of nd.children) {
      const a = aggregate(c);
      nd.count += a.count;
      nd.size += a.size;
    }
    return { count: nd.count, size: nd.size };
  };
  aggregate(root);
  return root;
}

/**
 * Build the multi-root library tree: a synthetic root whose children are
 * one folder tree per library root. Files are partitioned per root so
 * nothing leaks across roots. Returns null when there is nothing to show.
 */
export function buildLibraryTree(
  files: MediaFile[],
  roots: string[],
): FolderNode | null {
  if (files.length === 0 || roots.length === 0) return null;
  const library: FolderNode = {
    path: "",
    name: "LIBRARY",
    count: 0,
    size: 0,
    children: [],
  };
  for (const rootPath of roots) {
    const normRoot = normKey(rootPath);
    const sub = buildFolderTree(
      files.filter((f) => f.normPath.startsWith(normRoot + "/")),
      rootPath,
    );
    if (sub) library.children.push(sub);
  }
  if (library.children.length === 0) return null;
  library.count = library.children.reduce((n, c) => n + c.count, 0);
  library.size = library.children.reduce((s, c) => s + c.size, 0);
  return library;
}

/** Count distinct folders in the tree (for the sidebar header). */
export function countFolders(node: FolderNode | null): number {
  if (!node) return 0;
  let n = 0;
  const walk = (nd: FolderNode) => {
    n += 1;
    for (const c of nd.children) walk(c);
  };
  walk(node);
  return n;
}
