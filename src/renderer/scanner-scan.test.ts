import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanFolder, scanFolderStream } from "../scanner/scan";
import type { MediaFile, MetaPatch } from "../scanner/types";

const tempDirs: string[] = [];

/** Build a small tree: 3 images (one uppercase ext, one dotfile), 2 videos,
 *  plus non-media files that must be ignored. */
function makeTree(): string {
  const root = mkdtempSync(path.join(tmpdir(), "seele-scan-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "sub", "deep"), { recursive: true });
  writeFileSync(path.join(root, "a.jpg"), Buffer.alloc(64));
  writeFileSync(path.join(root, "b.PNG"), Buffer.alloc(32));
  writeFileSync(path.join(root, "c.txt"), Buffer.alloc(16));
  writeFileSync(path.join(root, "noext"), Buffer.alloc(8));
  writeFileSync(path.join(root, "sub", "movie.MKV"), Buffer.alloc(128));
  writeFileSync(path.join(root, "sub", "deep", "v.webm"), Buffer.alloc(256));
  writeFileSync(path.join(root, "sub", "deep", ".hidden.jpg"), Buffer.alloc(16));
  return root;
}

function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

afterEach(cleanup);

describe("scanFolder", () => {
  it("discovers only media files, recursively", async () => {
    const root = makeTree();
    const files = await scanFolder(root);
    expect(files).toHaveLength(5);
    expect(files.map((f) => f.fileName).sort()).toEqual([
      ".hidden.jpg",
      "a.jpg",
      "b.PNG",
      "movie.MKV",
      "v.webm",
    ]);
    expect(files.every((f) => f.fileType === "image" || f.fileType === "video")).toBe(true);
  });

  it("precomputes normPath (lowercased forward slashes) and fileNameLower", async () => {
    const root = makeTree();
    const files = await scanFolder(root);
    for (const f of files) {
      expect(f.normPath).toBe(f.filePath.replace(/\\/g, "/").toLowerCase());
      expect(f.normPath).not.toContain("\\");
      expect(f.fileNameLower).toBe(f.fileName.toLowerCase());
    }
  });

  it("maps extensions to fileType and stats real sizes/dates", async () => {
    const root = makeTree();
    const files = await scanFolder(root);
    const byName = new Map<string, MediaFile>(files.map((f) => [f.fileName, f]));
    expect(byName.get("a.jpg")?.fileType).toBe("image");
    expect(byName.get("b.PNG")?.fileType).toBe("image");
    expect(byName.get(".hidden.jpg")?.fileType).toBe("image");
    expect(byName.get("movie.MKV")?.fileType).toBe("video");
    expect(byName.get("v.webm")?.fileType).toBe("video");
    expect(byName.get("a.jpg")?.sizeBytes).toBe(64);
    expect(byName.get("v.webm")?.sizeBytes).toBe(256);
    expect(byName.get("a.jpg")?.birthtimeMs).toBeGreaterThan(0);
    expect(byName.get("a.jpg")?.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns an empty array for an empty directory", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "seele-scan-"));
    tempDirs.push(root);
    expect(await scanFolder(root)).toEqual([]);
  });

  it("returns an empty array for a missing directory", async () => {
    const ghost = path.join(tmpdir(), `does-not-exist-${Date.now()}-${Math.random()}`);
    expect(existsSync(ghost)).toBe(false);
    expect(await scanFolder(ghost)).toEqual([]);
  });

  it("is a no-op when the abort signal is already aborted", async () => {
    const root = makeTree();
    expect(await scanFolder(root, { signal: AbortSignal.abort() })).toEqual([]);
  });

  it("accepts a custom concurrency limit", async () => {
    const root = makeTree();
    expect(await scanFolder(root, { concurrency: 2 })).toHaveLength(5);
  });
});

describe("scanFolderStream", () => {
  it("emits the full file set in batches and reports final progress", async () => {
    const root = makeTree();
    const batches: MediaFile[][] = [];
    const progress: number[] = [];
    const count = await scanFolderStream(
      root,
      (b) => batches.push(b),
      (p) => progress.push(p.count),
    );
    expect(count).toBe(5);
    const all = batches.flat();
    expect(all).toHaveLength(5);
    expect(new Set(all.map((f) => f.fileName)).size).toBe(5);
    expect(progress[progress.length - 1]).toBe(5);
  });

  it("returns 0 without calling callbacks when pre-aborted", async () => {
    const root = makeTree();
    let batchCalls = 0;
    const count = await scanFolderStream(
      root,
      () => {
        batchCalls++;
      },
      undefined,
      { signal: AbortSignal.abort() },
    );
    expect(count).toBe(0);
    expect(batchCalls).toBe(0);
  });

  it("probes dimensions only for images and patches all files with metadata", async () => {
    const root = makeTree();
    const probeCalls: number[] = [];
    const patches: MetaPatch[] = [];
    const count = await scanFolderStream(
      root,
      () => {},
      undefined,
      {
        concurrency: 2,
        probeDimensions: (header: Buffer) => {
          probeCalls.push(header.byteLength);
          return { width: 800, height: 600 };
        },
      },
      (batch) => patches.push(...batch),
    );
    expect(count).toBe(5);
    expect(probeCalls).toHaveLength(3); // a.jpg, b.PNG, .hidden.jpg
    expect(probeCalls.every((n) => n > 0)).toBe(true);
    expect(patches).toHaveLength(5);

    const a = patches.find((p) => p.filePath.endsWith("a.jpg"));
    expect(a?.sizeBytes).toBe(64);
    expect(a?.birthtimeMs).toBeGreaterThan(0);
    expect(a?.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a?.width).toBe(800);
    expect(a?.height).toBe(600);

    const movie = patches.find((p) => p.filePath.endsWith("movie.MKV"));
    expect(movie?.width).toBeUndefined(); // videos are never probed
  });
});
