/**
 * Shared formatting helpers (§8). Used by every component that prints
 * sizes, dates, or times. Never reimplement these inline.
 */

/** Format bytes into a human-readable string (e.g. "1.4 GB"). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format an epoch-ms timestamp as a short date: `YYYY-MM-DD`. */
export function formatDate(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return "unknown";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format an epoch-ms timestamp as a clock `HH:MM:SS` (header clock). */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Zero-pad a number to a fixed width (§7.2 padded count badges). */
export function pad(n: number, width = 3): string {
  return String(Math.max(0, n | 0)).padStart(width, "0");
}
