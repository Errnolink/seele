import { scanFolderStream } from "../src/scanner/scan";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";
import { imageSize } from "image-size";

const controller = new AbortController();

function post(msg: unknown): void {
  process.parentPort.postMessage(msg);
}

process.parentPort.on("message", (event: unknown) => {
  const data = extractData(event);
  if (!data || typeof data !== "object") return;

  if (readType(data as Record<string, unknown>) === "cancel") {
    controller.abort();
    return;
  }
  const folderPath = readStringField(data as Record<string, unknown>, "folderPath");
  if (!folderPath) {
    post({ type: "error", message: "Missing folderPath" });
    return;
  }

  scanFolderStream(
    folderPath,
    (files: MediaFile[]) => {
      post({ type: "batch", files });
    },
    (progress: ScanProgress) => post({ type: "progress", progress }),
    {
      signal: controller.signal,
      probeDimensions: probeImageDimensions,
    },
    (patches: MetaPatch[]) => post({ type: "metaBatch", patches }),
  )
    .then((total) => {
      post({ type: "done", total });
      // Allow IPC to flush before exiting — postMessage is async, so
      // process.exit(0) can fire before the main process receives the
      // done message, leaving the scan "stuck" (v4 review H-4).
      setTimeout(() => process.exit(0), 100);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: "error", message });
      setTimeout(() => process.exit(1), 100);
    });
});

/** Pull `.data` off a MessageEvent-like payload, narrowed at runtime. */
function extractData(event: unknown): unknown {
  if (event && typeof event === "object" && "data" in event) {
    return (event as { data: unknown }).data;
  }
  return event;
}

function readType(data: Record<string, unknown>): string | undefined {
  const t = data.type;
  return typeof t === "string" ? t : undefined;
}

function readStringField(
  data: Record<string, unknown>,
  field: string,
): string | undefined {
  const v = data[field];
  return typeof v === "string" ? v : undefined;
}

/**
 * Header-only dimension probe for image files. Receives a pre-read header
 * Buffer (the first ~64KB of the file) so the scanner can merge stat +
 * header-read into a single open() — no second file open per image.
 * Runs in the worker thread so the main process never blocks. Returns
 * `null` for corrupt/unsupported headers; the file keeps its placeholder
 * `0×0` and the renderer falls back to a default aspect ratio.
 */
function probeImageDimensions(header: Buffer): { width: number; height: number } | null {
  try {
    const dim = imageSize(header);
    if (dim && typeof dim.width === "number" && typeof dim.height === "number") {
      return { width: dim.width, height: dim.height };
    }
  } catch {
    // Corrupt or unsupported header → leave at 0×0.
  }
  return null;
}