/**
 * Static lookup table: file extension (lowercased, with leading dot) → media
 * category. One probe replaces the classic two-`Set` membership check.
 *
 * Anything not present here is ignored by the scanner.
 */
export const FILE_TYPE_BY_EXT: Record<string, "image" | "video"> = {
  // images
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".gif": "image",
  ".bmp": "image",
  // .webp supports both still images and animated sequences (effectively video);
  // this project treats it as image-only. Consumers that need animated WebP
  // detection should probe the file header.
  ".webp": "image",
  ".svg": "image",
  ".tiff": "image",
  ".tif": "image",
  ".ico": "image",
  ".avif": "image",
  ".heic": "image",
  ".heif": "image",

  // videos
  ".mp4": "video",
  ".webm": "video",
  ".mkv": "video",
  ".avi": "video",
  ".mov": "video",
  ".wmv": "video",
  ".flv": "video",
  ".m4v": "video",
  ".mpg": "video",
  ".mpeg": "video",
  ".3gp": "video",
  ".ogv": "video",
};
