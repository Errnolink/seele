import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { OVERLAY_ENTER, OVERLAY_EXIT, PANEL_ENTER, PANEL_EXIT } from "../motion";
import type { MediaFile } from "../../scanner/types";
import { formatBytes } from "../utils";
import { TerminalDisplay } from "./TerminalDisplay";
import { BarChart } from "./BarChart";
import { PieChart, type PieSlice } from "./PieChart";
import { Divider } from "./Divider";
import { TargetingContainer } from "./TargetingContainer";

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
 * Four sections framed by a TargetingContainer:
 *  - STORAGE SUMMARY — MAGI terminal log (TerminalDisplay)
 *  - TYPE DISTRIBUTION — IMG/VID segmented ratio bar
 *  - LARGEST FILES — horizontal segmented BarChart of the top-5 files by
 *    size; clicking a bar opens the file in the media viewer (which the
 *    parent closes the modal on open)
 *  - STORAGE BY FOLDER — donut PieChart of the storage share per
 *    top-level folder (drive + first directory segment), top 5 + OTHER
 */
export default function AnalyticsModal({ files, onClose, onOpenMedia }: AnalyticsModalProps) {
  const stats = useMemo(() => computeStats(files), [files]);

  const top5 = useMemo(
    () => [...files].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 5),
    [files],
  );

  /** Bars for the largest-files chart, color-coded by media type. */
  const top5Bars = useMemo(
    () =>
      top5.map((f) => ({
        label: f.fileName,
        value: f.sizeBytes,
        color: f.fileType === "image" ? "#20f0ff" : "#50ff50",
      })),
    [top5],
  );

  /**
   * Storage share by top-level directory: group every file under its
   * drive + first directory segment (split on /[\\/]+/), keep the top 5
   * folders, and fold the rest into an "OTHER" bucket. The sum of all
   * slices equals totalSizeBytes by construction.
   */
  const folderSlices = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const f of files) {
      const segs = f.filePath.split(/[\\/]+/).filter(Boolean);
      const key = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : (segs[0] ?? "(root)");
      buckets.set(key, (buckets.get(key) ?? 0) + f.sizeBytes);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const slices: PieSlice[] = sorted.slice(0, 5).map(([label, value]) => ({ label, value }));
    const otherBytes = sorted.slice(5).reduce((sum, [, value]) => sum + value, 0);
    if (otherBytes > 0) slices.push({ label: "OTHER", value: otherBytes, color: "#6a6a65" });
    return slices;
  }, [files]);

  // Esc closes — matches the other z-50 overlays.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: OVERLAY_ENTER }}
      exit={{ opacity: 0, transition: OVERLAY_EXIT }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-[720px]" onClick={(e) => e.stopPropagation()}>
        <TargetingContainer label="ANALYTICS" showCrosshairs={false}>
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 1.02 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: PANEL_ENTER }}
            exit={{ opacity: 0, y: 6, scale: 0.99, transition: PANEL_EXIT }}
            className="flex flex-col gap-4 bg-nerv-panel px-3 pb-3 pt-2"
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

          {/* Storage summary — MAGI terminal log (NERV-UI TerminalDisplay) */}
          <Divider label="STORAGE SUMMARY" color="cyan" />
          <TerminalDisplay
            color="cyan"
            title="STORAGE SUMMARY"
            maxHeight="160px"
            prompt=">"
            lines={[
              `FILES: ${stats.totalFiles.toLocaleString()}`,
              `IMAGES: ${stats.imageCount.toLocaleString()} (${stats.imagePct.toFixed(0)}%)`,
              `VIDEOS: ${stats.videoCount.toLocaleString()} (${stats.videoPct.toFixed(0)}%)`,
              `TOTAL SIZE: ${formatBytes(stats.totalSizeBytes)}`,
              `AVG FILE: ${formatBytes(stats.avgFileSize)}`,
            ]}
          />

          {/* Type distribution — segmented ratio bar matching sidebar telemetry */}
          <Divider label="TYPE DISTRIBUTION" color="green" />
          <div className="flex flex-col gap-2">
            <div className="eva-segbar relative h-3 flex">
              <div
                className="h-full bg-nerv-cyan shadow-[0_0_8px_#20f0ff]"
                style={{ width: `${stats.imagePct}%` }}
              />
              <div
                className="h-full bg-nerv-green shadow-[0_0_8px_#50ff50]"
                style={{ width: `${stats.videoPct}%` }}
              />
              {/* dark tick marks */}
              <div className="absolute inset-0 flex justify-between pointer-events-none">
                {Array.from({ length: 23 }, (_, i) => (
                  <span key={i} className="w-px h-full bg-black/50" />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-nerv-cyan shadow-[0_0_6px_#20f0ff]" />
                <span className="phosphor-cyan">IMG</span>
                <span className="phosphor-cyan tabular-nums">{stats.imagePct.toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-nerv-green shadow-[0_0_6px_#50ff50]" />
                <span className="phosphor-green">VID</span>
                <span className="phosphor-green tabular-nums">{stats.videoPct.toFixed(0)}%</span>
              </div>
            </div>
          </div>

          {/* Top 5 largest files + storage by folder — side by side */}
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <Divider label="LARGEST FILES" color="orange" />
              {top5.length === 0 ? (
                <div className="px-3 py-2 text-xs text-nerv-muted">No files.</div>
              ) : (
                <BarChart
                  bars={top5Bars}
                  color="orange"
                  formatValue={formatBytes}
                  onBarClick={(_bar, index) => onOpenMedia(top5[index])}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Divider label="STORAGE BY FOLDER" color="orange" />
              {folderSlices.length === 0 ? (
                <div className="px-3 py-2 text-xs text-nerv-muted">No files.</div>
              ) : (
                <PieChart
                  slices={folderSlices}
                  donut
                  size={150}
                  showLabels
                  color="mixed"
                  formatValue={formatBytes}
                  className="w-full"
                />
              )}
            </div>
          </div>
          </motion.div>
        </TargetingContainer>
      </div>
    </motion.div>
  );
}
