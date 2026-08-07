/**
 * InspectorParts — shared building blocks for the two inspector surfaces:
 * the split-view detail panel (MasonryGrid's InspectorCard) and the fullscreen
 * File Viewer side panel (MediaViewer). One implementation each — fixing a bug
 * or adding a field in one panel applies to both.
 *
 * Pure helpers (plateId, dirName, aspectRatio, hasCameraData, FileInsights)
 * live in ../inspectorUtils so this file only exports components (react-refresh).
 */
import React, { memo, useMemo, useState } from "react";
import type { MediaFile } from "../../scanner/types";
import type { TagDef } from "../hooks/useTags";
import { formatBytes, formatDate } from "../utils";
import { aspectRatio, type FileInsights } from "../inspectorUtils";
import { Badge } from "./Badge";

/** Key-value metadata row — label left (muted), value right (bright). */
export const StatRow = memo(function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-nerv-border/40 py-1 last:border-b-0">
      <span className="text-[10px] text-nerv-muted">{label}</span>
      <span className={`ml-2 truncate text-[10px] text-nerv-text ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
});

/** Section heading shared by every inspector block. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.2em] text-nerv-muted">
      {children}
    </span>
  );
}

/** Tags — assigned pills + expandable edit grid (v2.5 §Module 6.4). */
export function TagManager({
  tags,
  fileTags,
  filePath,
  onToggleFileTag,
}: {
  tags: TagDef[];
  fileTags: TagDef[];
  filePath: string;
  onToggleFileTag: (filePath: string, tagKey: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const assignedKeys = useMemo(() => new Set(fileTags.map((t) => t.key)), [fileTags]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-nerv-muted">Tags</span>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="border border-nerv-orange/30 px-1.5 py-0.5 text-[8px] font-mono tracking-wider text-nerv-orange/80 hover:bg-nerv-orange/10 hover:text-nerv-orange"
        >
          {editing ? "DONE" : "EDIT TAGS"}
        </button>
      </div>

      {/* Assigned tag pills */}
      {fileTags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {fileTags.map((tag) => (
            <Badge
              key={tag.key}
              label={tag.label}
              className="font-mono"
              style={{
                color: tag.color,
                backgroundColor: tag.bg,
                border: `1px solid ${tag.border}`,
              }}
              removable
              onRemove={() => onToggleFileTag(filePath, tag.key)}
            />
          ))}
        </div>
      ) : (
        <span className="text-[9px] font-mono text-nerv-muted">No tags assigned</span>
      )}

      {/* Editable tag grid */}
      {editing && (
        <div className="mt-1 flex flex-wrap gap-1 border border-nerv-border bg-nerv-bg p-2">
          {tags.map((tag) => {
            const assigned = assignedKeys.has(tag.key);
            return (
              <button
                key={tag.key}
                type="button"
                onClick={() => onToggleFileTag(filePath, tag.key)}
                className="tag-chip px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-wider transition-colors"
                style={{
                  color: assigned ? tag.color : "#6a6a65",
                  backgroundColor: assigned ? tag.bg : "transparent",
                  border: `1px solid ${assigned ? tag.border : "#2e2e34"}`,
                }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Quick actions — 2x2 boxed grid, icon over label (Favorite/Move/Rename/Trash). */
const ACTION_TONES = {
  amber: "text-nerv-text-dim hover:bg-nerv-amber/5 hover:text-nerv-amber",
  lime: "text-nerv-text-dim hover:bg-nerv-lime/5 hover:text-nerv-lime",
  cyan: "text-nerv-text-dim hover:bg-nerv-cyan/5 hover:text-nerv-cyan",
  red: "text-nerv-text-dim hover:bg-nerv-red/5 hover:text-nerv-red",
} as const;

export function QuickActions({
  file,
  isFavorite,
  onToggleFavorite,
  onMove,
  onRename,
  onTrash,
}: {
  file: MediaFile;
  isFavorite: boolean;
  onToggleFavorite?: (file: MediaFile) => void;
  onMove?: (file: MediaFile) => void;
  onRename?: (file: MediaFile) => void;
  onTrash?: (file: MediaFile) => void;
}) {
  const actions = [
    {
      key: "favorite",
      label: "Favorite",
      hint: "F",
      icon: isFavorite ? "★" : "☆",
      tone: "amber" as const,
      active: isFavorite,
      onClick: onToggleFavorite,
    },
    {
      key: "move",
      label: "Move",
      hint: "M",
      icon: "⇥",
      tone: "lime" as const,
      active: false,
      onClick: onMove,
    },
    {
      key: "rename",
      label: "Rename",
      hint: "Shift+F2",
      icon: "✎",
      tone: "cyan" as const,
      active: false,
      onClick: onRename,
    },
    {
      key: "trash",
      label: "Trash",
      hint: "Del",
      icon: "⌫",
      tone: "red" as const,
      active: false,
      onClick: onTrash,
    },
  ].filter((a) => a.onClick);

  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-2 border border-nerv-border">
      {actions.map((a, i) => (
        <button
          key={a.key}
          type="button"
          onClick={() => a.onClick!(file)}
          title={`${a.label} (${a.hint})`}
          className={`group flex flex-col items-center gap-1 py-2 transition-colors ${
            i % 2 === 0 ? "border-r border-nerv-border" : ""
          } ${i < actions.length - 2 ? "border-b border-nerv-border" : ""} ${
            a.active ? "text-nerv-amber" : ACTION_TONES[a.tone]
          }`}
        >
          <span className="text-sm leading-none">{a.icon}</span>
          <span className="text-[8px] font-bold tracking-wider">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

/** File details — type/size/resolution/aspect/megapixels/created rows. */
export function FileDetails({ file }: { file: MediaFile }) {
  const hasDims = file.width > 0 && file.height > 0;
  return (
    <div className="flex flex-col">
      <StatRow
        label="Type"
        value={file.fileType === "video" ? "VIDEO" : "IMAGE"}
        valueClass="text-nerv-cyan"
      />
      <StatRow label="Size" value={formatBytes(file.sizeBytes)} valueClass="text-nerv-cyan" />
      <StatRow label="Resolution" value={hasDims ? `${file.width}x${file.height}` : "—"} />
      <StatRow label="Aspect" value={hasDims ? aspectRatio(file.width, file.height) : "—"} />
      <StatRow
        label="Megapixels"
        value={hasDims ? `${((file.width * file.height) / 1e6).toFixed(1)} MP` : "—"}
      />
      <StatRow label="Created" value={formatDate(file.birthtimeMs)} />
    </div>
  );
}

/** Color spectrum — gradient bar + labeled swatches (click copies hex). */
export function ColorSpectrum({
  colors,
  loading = false,
}: {
  colors?: FileInsights["colors"] | null;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Color Spectrum</SectionLabel>
      {loading ? (
        <div className="h-8 animate-pulse border border-nerv-border bg-nerv-bg" />
      ) : colors && colors.length > 0 ? (
        <>
          {/* Gradient spectrum bar built from extracted swatches */}
          <div
            className="h-6 w-full border border-nerv-border"
            style={{
              background: `linear-gradient(90deg, ${colors.map((c) => c.hex).join(", ")})`,
            }}
          />
          {/* Individual swatch chips */}
          <div className="flex gap-1">
            {colors.map((c, i) => (
              <button
                key={`${c.hex}-${i}`}
                type="button"
                onClick={() => void window.scanAPI.writeClipboard(c.hex)}
                title={`Copy ${c.hex}`}
                className="group/swatch flex flex-1 flex-col items-center gap-0.5"
              >
                <span
                  className="h-8 w-full border border-nerv-border transition-colors group-hover/swatch:border-nerv-amber"
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-[8px] uppercase text-nerv-muted transition-colors group-hover/swatch:text-nerv-amber">
                  {c.hex}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-8 items-center justify-center border border-nerv-border bg-nerv-bg text-[9px] text-nerv-muted">
          No color data
        </div>
      )}
    </div>
  );
}

/** Camera (EXIF) — only meaningful when at least one field has data. */
export function CameraSection({ camera }: { camera?: FileInsights["camera"] }) {
  return (
    <div className="flex flex-col">
      <SectionLabel>Camera</SectionLabel>
      <StatRow label="Make" value={camera?.make || "—"} />
      <StatRow label="Model" value={camera?.model || "—"} />
      <StatRow label="Lens" value={camera?.lens || "—"} />
      <StatRow label="Aperture" value={camera?.fNumber ? `f/${camera.fNumber}` : "—"} />
      <StatRow label="ISO" value={camera?.iso != null ? String(camera.iso) : "—"} />
      <StatRow label="Exposure" value={camera?.exposure ? `${camera.exposure}s` : "—"} />
    </div>
  );
}

/** Hash — value + copy button. */
export function HashSection({ hash }: { hash: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <SectionLabel>Hash</SectionLabel>
        {hash && (
          <button
            type="button"
            onClick={() => void window.scanAPI.writeClipboard(hash)}
            title="Copy hash"
            className="-mt-1 flex items-center gap-1 text-[9px] text-nerv-muted transition-colors hover:text-nerv-amber"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="1" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            COPY
          </button>
        )}
      </div>
      <div className="break-all border border-nerv-border bg-nerv-bg px-2 py-1.5 text-[10px] text-nerv-text-dim">
        {hash || "—"}
      </div>
    </div>
  );
}
