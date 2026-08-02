/**
 * Inspector utilities — pure helpers shared by both inspector surfaces
 * (split-view detail panel + fullscreen File Viewer side panel).
 * Kept out of InspectorParts.tsx so react-refresh's only-export-components
 * rule stays satisfied.
 */

/** Shape of `file:insights` (hash + palette + EXIF camera). */
export interface FileInsights {
  hash: string;
  colors: Array<{ r: number; g: number; b: number; hex: string }>;
  camera: {
    make?: string;
    model?: string;
    lens?: string;
    fNumber?: number;
    iso?: number;
    exposure?: string;
  };
}

/** Stable EVA-style plate ID (e.g. "EVA-00042") derived from a file path. */
export function plateId(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) - hash + filePath.charCodeAt(i)) | 0;
  }
  return `EVA-${String(Math.abs(hash) % 100000).padStart(5, "0")}`;
}

/** Parent directory name from a full path. */
export function dirName(filePath: string): string {
  const sep = filePath.includes("/") ? "/" : "\\";
  const parts = filePath.split(sep).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? filePath;
}

/** Format WxH as a simplified aspect ratio (e.g. "3:2", "16:9"). */
export function aspectRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/** True when the EXIF camera object carries at least one real field. */
export function hasCameraData(camera?: FileInsights["camera"]): boolean {
  if (!camera) return false;
  return Boolean(
    camera.make ||
      camera.model ||
      camera.lens ||
      camera.fNumber != null ||
      camera.iso != null ||
      camera.exposure,
  );
}
