/**
 * UI-layer type additions for the v2.6 EVA-ticket redesign.
 *
 * These live *alongside* the scanner's canonical {@link MediaFile}
 * (see `../../scanner/types`). They describe view modes, filters, the
 * folder tree, and aggregate stats — all renderer-only concerns.
 */
import type { MediaFile } from "../scanner/types";

/** Grid layout mode (§7.3). */
export type ViewMode = "masonry" | "grid" | "list" | "split";

/**
 * Grouping mode. "default"/"none" preserve scan order; the others
 * partition the derived file set. `folder` maps to the scanner's
 * directory segments; `resolution` groups by `WxH`.
 */
export type GroupMode = "none" | "date" | "type" | "folder" | "resolution";

/** Sort dimension applied to the derived list. */
export type SortMode = "name" | "date" | "size" | "resolution";

/** Sort direction. */
export type SortDir = "asc" | "desc";

/**
 * Media type filter. `all` = no filter; `large` = >50MB (§7.1 FILTER
 * cluster). `favorite` filters to locally-flagged favorites.
 */
export type MediaTypeFilter = "all" | "image" | "video" | "favorite" | "large";

/** Threshold (bytes) for the `large` filter (§7.1 ">50MB"). */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

/** A folder-tree node built from the flat file list (§8, §10.1). */
export interface FolderNode {
  path: string;
  name: string;
  count: number;
  size: number;
  children: FolderNode[];
}

/** Aggregate scan statistics for the sidebar footer + analytics modal. */
export interface ScanStats {
  totalFiles: number;
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
}

/** Re-export so components import UI types from one place. */
export type { MediaFile };

/**
 * ID for a media file. The scanner uses `filePath` as the natural key;
 * this alias keeps component prop signatures readable and decoupled.
 */
export type MediaId = string;
