import { describe, expect, it } from "vitest";
import { formatBytes, formatClock, formatDate, pad } from "./utils";

describe("formatBytes", () => {
  it("returns 0 B for zero, negative, and NaN sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(-1024)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });

  it("formats whole bytes with no decimals below 1024", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("hits exact binary unit boundaries", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
    expect(formatBytes(1024 ** 5)).toBe("1.0 PB");
  });

  it("rounds fractional units to one decimal below 100", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1.5 * 1024 ** 2)).toBe("1.5 MB");
    expect(formatBytes(2.25 * 1024 ** 3)).toBe("2.3 GB");
  });

  it("drops decimals once the value reaches 100 or more", () => {
    expect(formatBytes(150 * 1024)).toBe("150 KB");
    expect(formatBytes(100 * 1024 ** 2)).toBe("100 MB");
    expect(formatBytes(999 * 1024)).toBe("999 KB");
  });

  it("stays within the units table for very large inputs", () => {
    expect(formatBytes(2 * 1024 ** 5)).toBe("2.0 PB");
  });
});

describe("formatDate", () => {
  it("returns unknown for falsy, NaN, and non-finite timestamps", () => {
    expect(formatDate(0)).toBe("unknown");
    expect(formatDate(NaN)).toBe("unknown");
    expect(formatDate(Infinity)).toBe("unknown");
    expect(formatDate(-Infinity)).toBe("unknown");
  });

  it("formats a local timestamp as YYYY-MM-DD", () => {
    expect(formatDate(new Date(2024, 4, 7, 14, 30, 0).getTime())).toBe("2024-05-07");
    expect(formatDate(new Date(2024, 0, 1, 0, 0, 0).getTime())).toBe("2024-01-01");
    expect(formatDate(new Date(2024, 11, 31, 23, 59, 59).getTime())).toBe("2024-12-31");
  });

  it("zero-pads month and day", () => {
    expect(formatDate(new Date(2024, 2, 3, 12, 0, 0).getTime())).toBe("2024-03-03");
  });
});

describe("formatClock", () => {
  it("formats HH:MM:SS from a local timestamp", () => {
    expect(formatClock(new Date(2024, 4, 7, 9, 5, 3).getTime())).toBe("09:05:03");
    expect(formatClock(new Date(2024, 4, 7, 0, 0, 0).getTime())).toBe("00:00:00");
  });
});

describe("pad", () => {
  it("zero-pads to width 3 by default", () => {
    expect(pad(5)).toBe("005");
    expect(pad(42)).toBe("042");
    expect(pad(0)).toBe("000");
    expect(pad(999)).toBe("999");
  });

  it("does not truncate numbers wider than the width", () => {
    expect(pad(1234)).toBe("1234");
    expect(pad(99999)).toBe("99999");
  });

  it("clamps negatives to 0", () => {
    expect(pad(-3)).toBe("000");
    expect(pad(-9999)).toBe("000");
  });

  it("truncates fractional input to an integer", () => {
    expect(pad(1.9)).toBe("001");
    expect(pad(3.5, 5)).toBe("00003");
  });

  it("respects custom widths", () => {
    expect(pad(7, 5)).toBe("00007");
    expect(pad(7, 1)).toBe("7");
  });

  it("coerces NaN to 0", () => {
    expect(pad(NaN)).toBe("000");
  });
});
