import { describe, expect, it } from "vitest";
import { buildFolderTree, buildLibraryTree, countFolders } from "./folderTree";
import type { MediaFile } from "../scanner/types";

/** Minimal MediaFile with the fields the tree builders read. */
function file(path: string, sizeBytes = 100): MediaFile {
  const name = path.split(/[\\/]/).pop() ?? path;
  const birthtime = "2026-01-01T00:00:00.000Z";
  return {
    filePath: path,
    fileName: name,
    fileNameLower: name.toLowerCase(),
    birthtime,
    fileType: "image",
    sizeBytes,
    width: 0,
    height: 0,
    normPath: path.replace(/\\/g, "/").toLowerCase(),
    birthtimeMs: Date.parse(birthtime),
    dateKey: "2026-01-01",
  };
}

describe("buildFolderTree", () => {
  it("nests subfolders and aggregates counts and sizes", () => {
    const files = [
      file("C:/Pics/2026/Jan/a.jpg", 10),
      file("C:/Pics/2026/Jan/b.jpg", 20),
      file("C:/Pics/2026/Feb/c.jpg", 30),
      file("C:/Pics/loose.jpg", 40),
    ];
    const tree = buildFolderTree(files, "C:\\Pics");
    expect(tree).not.toBeNull();
    expect(tree!.count).toBe(4);
    expect(tree!.size).toBe(100);
    // Node names come from the scanner's normalized (lowercase) paths.
    expect(tree!.children.map((c) => c.name)).toEqual(["2026"]);
    const jan = tree!.children[0].children.find((c) => c.name === "jan");
    expect(jan?.count).toBe(2);
    expect(jan?.size).toBe(30);
  });

  it("counts files directly in the root against the root node", () => {
    const tree = buildFolderTree([file("D:/Pics/loose.jpg")], "D:/Pics");
    expect(tree!.count).toBe(1);
    expect(tree!.children).toHaveLength(0);
  });

  it("returns null for an empty file list", () => {
    expect(buildFolderTree([], "C:/Pics")).toBeNull();
  });
});

describe("buildLibraryTree", () => {
  const pics = [
    file("C:/Pics/2026/a.jpg"),
    file("C:/Pics/loose.jpg"),
  ];
  const downloads = [
    file("D:/Download/b.png"),
    file("D:/Download/sub/c.png"),
  ];

  it("merges multiple roots under a synthetic root", () => {
    const tree = buildLibraryTree([...pics, ...downloads], [
      "C:\\Pics",
      "D:\\Download",
    ]);
    expect(tree).not.toBeNull();
    expect(tree!.name).toBe("LIBRARY");
    expect(tree!.children.map((c) => c.name)).toEqual(["Pics", "Download"]);
    expect(tree!.children[0].count).toBe(2);
    expect(tree!.children[1].count).toBe(2);
    expect(tree!.count).toBe(4);
  });

  it("does not leak files across roots", () => {
    const tree = buildLibraryTree([...pics, ...downloads], [
      "C:\\Pics",
      "D:\\Download",
    ]);
    // The Downloads root must not contain any Pics files.
    const downloadRoot = tree!.children.find((c) => c.name === "Download")!;
    expect(downloadRoot.count).toBe(2);
    expect(downloadRoot.size).toBe(200);
  });

  it("returns null when there are no roots or no files", () => {
    expect(buildLibraryTree([], ["C:/Pics"])).toBeNull();
    expect(buildLibraryTree([file("C:/Pics/a.jpg")], [])).toBeNull();
  });

  it("matches Windows and forward-slash root spellings case-insensitively", () => {
    const tree = buildLibraryTree(
      [file("C:/PICS/2026/a.jpg")],
      ["c:\\pics"],
    );
    expect(tree?.children).toHaveLength(1);
    expect(tree!.count).toBe(1);
  });
});

describe("countFolders", () => {
  it("counts every node including the root", () => {
    const tree = buildLibraryTree(
      [file("C:/Pics/a.jpg"), file("C:/Pics/sub/b.jpg")],
      ["C:/Pics"],
    );
    expect(countFolders(tree)).toBe(3); // LIBRARY + Pics + sub
  });

  it("counts zero for a null tree", () => {
    expect(countFolders(null)).toBe(0);
  });
});
