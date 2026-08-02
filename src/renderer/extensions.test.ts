import { describe, expect, it } from "vitest";
import { FILE_TYPE_BY_EXT } from "../scanner/extensions";

const IMAGE_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".tiff",
  ".tif",
  ".ico",
  ".avif",
  ".heic",
  ".heif",
];

const VIDEO_EXTS = [
  ".mp4",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".ogv",
];

describe("FILE_TYPE_BY_EXT", () => {
  it("classifies every known image extension as image", () => {
    for (const ext of IMAGE_EXTS) {
      expect(FILE_TYPE_BY_EXT[ext]).toBe("image");
    }
  });

  it("classifies every known video extension as video", () => {
    for (const ext of VIDEO_EXTS) {
      expect(FILE_TYPE_BY_EXT[ext]).toBe("video");
    }
  });

  it("returns undefined for non-media and unknown extensions", () => {
    for (const ext of [".txt", ".pdf", ".zip", ".exe", ".md", ".json", ".css", ""]) {
      expect(FILE_TYPE_BY_EXT[ext]).toBeUndefined();
    }
  });

  it("is case-sensitive — uppercase extensions must be lowercased by the caller first", () => {
    expect(FILE_TYPE_BY_EXT[".JPG"]).toBeUndefined();
    expect(FILE_TYPE_BY_EXT[".PNG"]).toBeUndefined();
    expect(FILE_TYPE_BY_EXT[".MP4"]).toBeUndefined();
  });

  it("has only dot-prefixed, lowercase keys", () => {
    for (const key of Object.keys(FILE_TYPE_BY_EXT)) {
      expect(key.startsWith(".")).toBe(true);
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("maps every entry to exactly one of the two supported types", () => {
    const entries = Object.entries(FILE_TYPE_BY_EXT);
    expect(entries.length).toBe(IMAGE_EXTS.length + VIDEO_EXTS.length);
    const types = new Set(entries.map(([, v]) => v));
    expect(types).toEqual(new Set(["image", "video"]));
    expect(entries.every(([, v]) => v === "image" || v === "video")).toBe(true);
  });

  it("covers every extension the scanner extracts via path.extname", () => {
    const extracted = IMAGE_EXTS.concat(VIDEO_EXTS).map((e) => e.toLowerCase());
    for (const ext of extracted) {
      expect(FILE_TYPE_BY_EXT[ext]).toBeDefined();
    }
  });
});
