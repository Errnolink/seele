import { useEffect, useMemo } from "react";
import type { MediaFile } from "../../scanner/types";
import { formatBytes } from "../utils";

interface AnalyticsModalProps {
  files: MediaFile[];
  onClose: () => void;
  onOpenMedia: (f: MediaFile) => void;
}

/** Aggregate stats derived from the file list (§7.9). */
interface AnalyticsStats {
  totalFiles: number;
  totalSizeBytes: number;
  imageCount: number;
  videoCount: number;
  avgFileSize: number;
  imagePct: number;
  videoPct: number;
}

/** Compute storage/media stats in a single reduce pass over files. */
function computeStats(files: MediaFile[]): AnalyticsStats {
  let totalSizeBytes = 0;
  let imageCount = 0;
  let videoCount = 0;
  for (const f of files) {
    totalSizeBytes += f.sizeBytes;
    if (f.fileType === "image") imageCount += 1;
    else if (f.fileType === "video") videoCount += 1;
  }
  const totalFiles = files.length;
  const avgFileSize = totalFiles > 0 ? totalSizeBytes / totalFiles : 0;
  const imagePct = totalFiles > 0 ? (imageCount / totalFiles) * 100 : 0;
  const videoPct = totalFiles > 0 ? (videoCount / totalFiles) * 100 : 0;
  return { totalFiles, totalSizeBytes, imageCount, videoCount, avgFileSize, imagePct, videoPct };
}

/**
 * Storage & media analytics overlay (§7.9).
 *
 * Shows aggregate counts/sizes, an image/video distribution bar, and the
 * top-5 largest files. Rows click through to the media viewer (which the
 * parent closes the modal on open).
 */
export default function AnalyticsModal({ files, onClose, onOpenMedia }: AnalyticsModalProps) {
  const stats = useMemo(() => computeStats(files), [files]);

  const top5 = useMemo(
    () => [...files].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 5),
    [files],
  );

  // Esc closes — matches the other z-50 overlays.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full bg-nerv-panel border border-nerv-orange/50 rounded-lg shadow-2xl p-6 flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-nerv-orange animate-pulse-soft rounded-full" />
          <span className="text-sm font-bold tracking-widest uppercase text-nerv-orange">
            STORAGE &amp; MEDIA ANALYTICS
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-nerv-muted hover:text-nerv-red"
            aria-label="Close analytics"
          >
            ✕
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="TOTAL FILES" value={String(stats.totalFiles)} valueClass="text-nerv-orange" />
          <StatCard label="TOTAL SIZE" value={formatBytes(stats.totalSizeBytes)} valueClass="text-nerv-amber" />
          <StatCard label="AVG FILE SIZE" value={formatBytes(stats.avgFileSize)} valueClass="text-nerv-cyan" />
          <StatCard
            label="VIDEOS / IMAGES"
            value={`${stats.videoCount} / ${stats.imageCount}`}
            valueClass="text-nerv-green"
          />
        </div>

        {/* Type distribution bar + legend */}
        <div className="flex flex-col gap-2">
          <div className="h-4 rounded-md overflow-hidden flex border border-nerv-border">
            <span
              className="bg-nerv-cyan/60 h-full"
              style={{ width: `${stats.imagePct}%` }}
            />
            <span
              className="bg-nerv-green/60 h-full"
              style={{ width: `${stats.videoPct}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LegendRow colorClass="bg-nerv-cyan" label={`IMG ${stats.imagePct.toFixed(0)}%`} />
            <LegendRow colorClass="bg-nerv-green" label={`VID ${stats.videoPct.toFixed(0)}%`} />
          </div>
        </div>

        {/* Top 5 largest files */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] tracking-[0.2em] uppercase text-nerv-muted">
            TOP 5 LARGEST FILES
          </div>
          <div className="divide-y divide-nerv-border bg-nerv-bg rounded border border-nerv-border">
            {top5.length === 0 ? (
              <div className="px-3 py-2 text-xs text-nerv-muted">No files.</div>
            ) : (
              top5.map((f) => (
                <div
                  key={f.filePath}
                  className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-nerv-panel-2"
                  onClick={() => onOpenMedia(f)}
                >
                  <span
                    className={
                      f.fileType === "image"
                        ? "text-[9px] px-1.5 py-0.5 rounded text-nerv-cyan bg-nerv-cyan/10"
                        : "text-[9px] px-1.5 py-0.5 rounded text-nerv-green bg-nerv-green/10"
                    }
                  >
                    {f.fileType === "image" ? "IMG" : "VID"}
                  </span>
                  <span className="truncate flex-1 text-nerv-text">{f.fileName}</span>
                  <span className="text-nerv-amber tabular-nums">{formatBytes(f.sizeBytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── small presentational helpers ───────────────────────────────────

function StatCard({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="bg-nerv-bg p-3 rounded border border-nerv-border">
      <div className="text-[9px] tracking-[0.2em] uppercase text-nerv-muted">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function LegendRow({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-nerv-muted tabular-nums">
      <span className={`w-2.5 h-2.5 rounded-sm ${colorClass}`} />
      <span>{label}</span>
    </div>
  );
}
