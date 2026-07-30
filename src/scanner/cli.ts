#!/usr/bin/env node
/**
 * Standalone CLI for the media scanner.
 *
 *   npm run scan -- <folder>            # stream batches as NDJSON
 *   npm run scan -- <folder> --json     # emit one JSON array at the end
 *   npm run scan -- <folder> --quiet    # suppress progress on stderr
 *
 * This is intentionally usable without Electron — it doubles as the
 * scanner's integration test surface.
 */
import { scanFolderStream } from "./scan";
import type { MediaFile, MetaPatch } from "./types";

function parseArgs(argv: string[]): { folder: string; json: boolean; quiet: boolean } {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const folder = positional[0];
  if (!folder) {
    console.error("Usage: scan <folder> [--json] [--quiet]");
    process.exit(2);
  }
  return { folder, json: flags.has("--json"), quiet: flags.has("--quiet") };
}

async function main(): Promise<void> {
  const { folder, json, quiet } = parseArgs(process.argv.slice(2));
  const all: MediaFile[] = [];
  /** Path→index lookup so metaBatch patches are O(1) per file (v4 M-3). */
  const pathIndex = new Map<string, number>();

  const total = await scanFolderStream(
    folder,
    (batch) => {
      for (const f of batch) {
        pathIndex.set(f.filePath, all.length);
        all.push(f);
      }
      if (!json) {
        for (const f of batch) process.stdout.write(JSON.stringify(f) + "\n");
      }
    },
    ({ count, currentDir }) => {
      if (!quiet && !json) {
        process.stderr.write(`\r${count} files…  ${currentDir}`.slice(0, 100) + "\x1b[K");
      }
    },
    {},
    (patches: MetaPatch[]) => {
      // Phase 2 metadata: patch the accumulated array in place so the
      // final output carries real size/date instead of zeroes (v4 M-3).
      for (const patch of patches) {
        const idx = pathIndex.get(patch.filePath);
        if (idx !== undefined) {
          all[idx] = {
            ...all[idx],
            sizeBytes: patch.sizeBytes,
            birthtimeMs: patch.birthtimeMs,
            birthtime: patch.birthtime,
            dateKey: patch.dateKey,
          };
        }
      }
    },
  );

  if (!quiet) process.stderr.write("\n");
  if (json) process.stdout.write(JSON.stringify(all));
  process.stderr.write(`Done: ${total} media file${total === 1 ? "" : "s"}.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
