/**
 * ViewerSidePanel — the viewer's right inspector panel: FILE identity, shared
 * TagManager, DETAILS, color SPECTRUM, CAMERA, HASH, and the staged-trash
 * count. Slides out (width/opacity transition) when info is hidden.
 */
import React, { memo } from "react";
import type { MediaFile } from "../../scanner/types";
import type { TagDef } from "../hooks/useTags";
import { dirName, hasCameraData, plateId, type FileInsights } from "../inspectorUtils";
import { Badge } from "./Badge";
import { Divider } from "./Divider";
import {
  CameraSection,
  ColorSpectrum,
  FileDetails,
  HashSection,
  TagManager,
} from "./InspectorParts";

/** Right side panel width — wide enough for hash strings + EXIF labels. */
export const SIDE_PANEL_W = 264;

export interface ViewerSidePanelProps {
  file: MediaFile;
  isVideo: boolean;
  /** Panel visible (I toggles; hidden state animates width to 0). */
  showMetadata: boolean;
  palette: FileInsights["colors"] | null;
  hash: string;
  camera: FileInsights["camera"] | undefined;
  insightsLoading: boolean;
  queuedCount?: number;
  tags?: TagDef[];
  fileTags?: TagDef[];
  onToggleFileTag?: (filePath: string, tagKey: string) => void;
}

export const ViewerSidePanel: React.FC<ViewerSidePanelProps> = memo(
  ({ file, isVideo, showMetadata, palette, hash, camera, insightsLoading, queuedCount, tags, fileTags, onToggleFileTag }) => (
    <div
      className={`relative z-20 flex-shrink-0 overflow-hidden border-l border-nerv-orange/20 bg-nerv-panel/90 transition-[width,opacity] duration-200 ease-out no-drag ${
        showMetadata ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{ width: showMetadata ? SIDE_PANEL_W : 0 }}
    >
      {/* Fixed-width content — the wrapper animates, the content never
          reflows (no layout thrash during the slide). */}
      <div
        className="flex h-full flex-col overflow-y-auto"
        style={{ width: SIDE_PANEL_W, scrollbarWidth: "thin" }}
      >
        {/* 1. FILE — name + reveal-in-folder + path + ID/type badges */}
        <section className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase tracking-widest text-nerv-muted">
              FILE
            </span>
            <span className="flex gap-1">
              <Badge variant="default" label={plateId(file.filePath)} />
              <Badge
                variant={isVideo ? "success" : "info"}
                label={isVideo ? "VID" : "IMG"}
              />
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="break-all font-mono text-[11px] font-bold leading-snug text-nerv-cyan">
              {file.fileName}
            </span>
            <button
              type="button"
              onClick={() => void window.scanAPI.showItemInFolder(file.filePath)}
              title="Reveal in folder"
              aria-label="Reveal in folder"
              className="shrink-0 text-nerv-orange transition-colors hover:text-nerv-amber"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
            </button>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-nerv-muted">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-nerv-orange/70"><path d="M3 7a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1" /><rect x="3" y="9" width="18" height="11" /></svg>
            <span className="truncate">{dirName(file.filePath)}</span>
          </div>
        </section>

        {/* 2. TAGS — shared TagManager (same as split view) */}
        {tags && onToggleFileTag && (
          <>
            <Divider label="TAGS" color="cyan" variant="dashed" />
            <section className="px-4 py-3">
              <TagManager
                tags={tags}
                fileTags={fileTags ?? []}
                filePath={file.filePath}
                onToggleFileTag={onToggleFileTag}
              />
            </section>
          </>
        )}

        {/* 3. FILE DETAILS — merged basic + resolution stats */}
        <Divider label="DETAILS" color="orange" />
        <section className="px-4 py-3">
          <div className="mb-2 text-[9px] font-mono uppercase tracking-widest text-nerv-muted">
            FILE DETAILS
          </div>
          <FileDetails file={file} />
        </section>

        {/* 5. COLOR SPECTRUM — shared gradient + labeled swatches */}
        <Divider label="SPECTRUM" color="cyan" variant="dashed" />
        <section className="px-4 py-3">
          <ColorSpectrum colors={palette} loading={insightsLoading} />
        </section>

        {/* 6. CAMERA — omitted entirely when no EXIF data */}
        {hasCameraData(camera) && (
          <>
            <Divider label="CAMERA" color="orange" />
            <section className="px-4 py-3">
              <CameraSection camera={camera} />
            </section>
          </>
        )}

        {/* 7. HASH — value + copy */}
        <Divider label="HASH" color="cyan" variant="dashed" />
        <section className="px-4 py-3">
          <HashSection hash={hash} />
        </section>

        <div className="mt-auto px-4 py-2">
          {queuedCount !== undefined && queuedCount > 0 && (
            <Badge
              variant="danger"
              label={`${queuedCount} STAGED FOR TRASH`}
              className="font-mono"
            />
          )}
        </div>
      </div>
    </div>
  ),
);
ViewerSidePanel.displayName = "ViewerSidePanel";
