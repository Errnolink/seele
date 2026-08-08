/**
 * Build `media://` URLs for the renderer.
 *
 * Mirrors the preload bridge so any component (grid tiles, viewer, filmstrip)
 * resolves media the same way. `?w=` asks the main process to downscale via
 * sharp (async, off-thread); without it the raw file is streamed.
 */
export function toMediaUrl(filePath: string): string {
  return typeof window !== "undefined" &&
    window.scanAPI &&
    typeof window.scanAPI.toMediaUrl === "function"
    ? window.scanAPI.toMediaUrl(filePath)
    : `media://local/${encodeURIComponent(filePath)}`;
}

/** Build a downscaled `media://` URL for small thumbnails. */
export function toThumbUrl(filePath: string, width = 112): string {
  return `${toMediaUrl(filePath)}?w=${width}`;
}
