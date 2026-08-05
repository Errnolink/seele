const HEIC_BRANDS: ReadonlySet<string> = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "avif",
]);

function brandAt(header: Uint8Array, offset: number): string {
  return String.fromCharCode(
    header[offset],
    header[offset + 1],
    header[offset + 2],
    header[offset + 3],
  );
}

export function isHeicContent(header: Uint8Array): boolean {
  if (header.length < 12) {
    return false;
  }
  if (brandAt(header, 4) !== "ftyp") {
    return false;
  }
  return HEIC_BRANDS.has(brandAt(header, 8));
}

const GIF_MAGIC_87A = "GIF87a";
const GIF_MAGIC_89A = "GIF89a";
const NETSCAPE_EXTENSION = "NETSCAPE2.0";

export function isAnimatedGif(header: Uint8Array): boolean {
  if (header.length < 6) {
    return false;
  }
  const magic = String.fromCharCode(header[0], header[1], header[2], header[3], header[4], header[5]);
  if (magic !== GIF_MAGIC_87A && magic !== GIF_MAGIC_89A) {
    return false;
  }
  const limit = Math.min(header.length, 1024);
  const sig = NETSCAPE_EXTENSION;
  for (let i = 0; i <= limit - sig.length; i++) {
    let matches = true;
    for (let j = 0; j < sig.length; j++) {
      if (header[i + j] !== sig.charCodeAt(j)) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}