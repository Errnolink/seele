import { scanFolderStream } from "../src/scanner/scan";
import type { MediaFile, MetaPatch, ScanProgress } from "../src/scanner/types";

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

  let batchCount = 0;
  let fileCount = 0;
  const t0 = Date.now();

  scanFolderStream(
    folderPath,
    (files: MediaFile[]) => {
      batchCount++;
      fileCount += files.length;
      post({ type: "batch", files });
    },
    (progress: ScanProgress) => post({ type: "progress", progress }),
    { signal: controller.signal },
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