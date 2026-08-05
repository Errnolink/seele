import { describe, expect, it } from "vitest";
import { isAnimatedGif, isHeicContent } from "../scanner/sniff";

function bytes(...nums: number[]): Uint8Array {
  return new Uint8Array(nums);
}

function ascii(value: string): number[] {
  return [...value].map((c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isobmffHeader(brand: string): Uint8Array {
  return concat(bytes(0, 0, 0, 24), bytes(...ascii("ftyp")), bytes(...ascii(brand)), bytes(0, 0, 0, 0));
}

describe("isHeicContent", () => {
  it("returns true for a heic major brand", () => {
    expect(isHeicContent(isobmffHeader("heic"))).toBe(true);
  });

  it("returns true for a heix major brand", () => {
    expect(isHeicContent(isobmffHeader("heix"))).toBe(true);
  });

  it("returns true for an avif major brand", () => {
    expect(isHeicContent(isobmffHeader("avif"))).toBe(true);
  });

  it("returns false for a jpeg header", () => {
    expect(isHeicContent(bytes(0xff, 0xd8, 0xff))).toBe(false);
  });

  it("returns false for a png header", () => {
    expect(isHeicContent(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(false);
  });

  it("returns false for short and empty buffers", () => {
    expect(isHeicContent(bytes())).toBe(false);
    expect(isHeicContent(bytes(0, 0, 0, 24, 0x66))).toBe(false);
    expect(isHeicContent(bytes(0, 0, 0, 24))).toBe(false);
  });

  it("returns false for an ftyp box with an unknown brand", () => {
    expect(isHeicContent(isobmffHeader("qt  "))).toBe(false);
  });

  it("returns true for a mif1 major brand", () => {
    expect(isHeicContent(isobmffHeader("mif1"))).toBe(true);
  });

  it("returns true for a msf1 major brand", () => {
    expect(isHeicContent(isobmffHeader("msf1"))).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(isHeicContent(isobmffHeader("HEIC"))).toBe(false);
  });
});

function gifHeader(magic: string, animated: boolean): Uint8Array {
  const header = bytes(...ascii(magic));
  if (!animated) return header;
  return concat(
    header,
    bytes(0x21, 0xff, 0x0b),
    bytes(...ascii("NETSCAPE2.0")),
    bytes(0x03, 0x01, 0x00, 0x00, 0x00),
  );
}

describe("isAnimatedGif", () => {
  it("returns true for an animated GIF89a", () => {
    expect(isAnimatedGif(gifHeader("GIF89a", true))).toBe(true);
  });

  it("returns true for an animated GIF87a", () => {
    expect(isAnimatedGif(gifHeader("GIF87a", true))).toBe(true);
  });

  it("returns false for a single-frame GIF89a", () => {
    expect(isAnimatedGif(gifHeader("GIF89a", false))).toBe(false);
  });

  it("returns false for a single-frame GIF87a", () => {
    expect(isAnimatedGif(gifHeader("GIF87a", false))).toBe(false);
  });

  it("returns false for a jpeg header", () => {
    expect(isAnimatedGif(bytes(0xff, 0xd8, 0xff))).toBe(false);
  });

  it("returns false for a png header", () => {
    expect(isAnimatedGif(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(false);
  });

  it("returns false for short and empty buffers", () => {
    expect(isAnimatedGif(bytes())).toBe(false);
    expect(isAnimatedGif(bytes(0x47, 0x49))).toBe(false);
  });

  it("finds NETSCAPE2.0 past the first few bytes", () => {
    const animated = bytes(0x00, 0x00, 0x00, 0x00);
    const header = concat(bytes(...ascii("GIF89a")), animated, bytes(0x21, 0xff, 0x0b), bytes(...ascii("NETSCAPE2.0")));
    expect(isAnimatedGif(header)).toBe(true);
  });
});