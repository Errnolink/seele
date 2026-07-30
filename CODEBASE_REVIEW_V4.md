# Wiergise Media Scanner — Code Review V4

> **Date**: 2026-07-30
> **Scope**: All 27 source files across `electron/`, `src/scanner/`, `src/renderer/`

---

## Executive Summary

23 issues found: 1 CRITICAL, 6 HIGH, 8 MEDIUM, 6 LOW, 2 INFO.

---

## 🔴 CRITICAL Issues

### C-1: Arbitrary Code Execution via `shell:openPath` IPC Handler

- **File**: `electron/main.ts`, lines 355–361
- **Category**: Security

**Problem**: The `shell:openPath` handler calls `shell.openPath()` with any string the renderer provides. It only validates that the argument is a non-empty string — there is **no check** that the path is under an `allowedRoots` entry or that it targets a media file. A compromised renderer process could invoke this to execute arbitrary system binaries (`cmd.exe`, `.bat` scripts, `.app` bundles).

This is especially dangerous because `shell.openPath()` uses the OS default association, which for executables means *running them*.

The same concern applies to `shell:showItemInFolder` at line 348 (which can disclose arbitrary filesystem locations) though with lower impact.

**Fix**: Apply the same `allowedRoots` path-traversal guard used by the `media://` protocol handler to both `shell:openPath` and `shell:showItemInFolder`:

```typescript
ipcMain.handle("shell:openPath", async (_e, filePath: string) => {
  if (typeof filePath !== "string" || filePath.length === 0) return "no path";
  
  // Validate path is under an allowed scan root
  const requestedLower = path.resolve(filePath).toLowerCase();
  const isAllowed = [...allowedRoots].some((root) => {
    const rel = path.relative(root, requestedLower);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!isAllowed) return "forbidden: path not under scanned folder";
  
  const err = await shell.openPath(filePath);
  return err;
});
```

Apply the same guard to `shell:showItemInFolder`.

---

## 🟠 HIGH Issues

### H-1: IPC Listener Leak on Rapid Re-scan or Cancellation

- **File**: `electron/preload.ts`, lines 91–121
- **Category**: Memory Leak / Bug

**Problem**: `startScan()` registers listeners for `scan:batch`, `scan:progress`, `scan:error`, and `scan:metaBatch`. These are only cleaned up inside the `doneHandler`. If the user:
1. Cancels a scan and immediately starts a new one, or
2. The worker crashes without emitting `scan:done`

…the old listeners are never removed. Each subsequent scan stacks another set of listeners, causing duplicate batch processing, stale callback invocations, and a growing memory leak.

**Fix**: Track active handlers in module-level variables and remove them at the start of each `startScan` call:

```typescript
let activeCleanup: (() => void) | null = null;

startScan: (folderPath, onBatch, onProgress, onDone, onError, onMetaBatch) => {
  // Clean up any previous scan listeners
  activeCleanup?.();
  
  const batchHandler = (_e: Electron.IpcRendererEvent, batch: MediaFile[]) =>
    onBatch(batch);
  const progressHandler = (_e: Electron.IpcRendererEvent, progress: ScanProgress) =>
    onProgress?.(progress);
  const errorHandler = (_e: Electron.IpcRendererEvent, message: string) =>
    onError?.(message);
  const metaBatchHandler = (_e: Electron.IpcRendererEvent, patches: MetaPatch[]) =>
    onMetaBatch?.(patches);
  const doneHandler = (_e: Electron.IpcRendererEvent, total: number) => {
    cleanup();
    onDone?.(total);
  };

  function cleanup() {
    ipcRenderer.removeListener("scan:batch", batchHandler);
    ipcRenderer.removeListener("scan:progress", progressHandler);
    ipcRenderer.removeListener("scan:error", errorHandler);
    ipcRenderer.removeListener("scan:metaBatch", metaBatchHandler);
    ipcRenderer.removeListener("scan:done", doneHandler);
    activeCleanup = null;
  }

  activeCleanup = cleanup;

  ipcRenderer.on("scan:batch", batchHandler);
  ipcRenderer.on("scan:progress", progressHandler);
  ipcRenderer.on("scan:error", errorHandler);
  ipcRenderer.on("scan:metaBatch", metaBatchHandler);
  ipcRenderer.once("scan:done", doneHandler);

  return ipcRenderer.invoke("scan:start", folderPath);
},
```

---

### H-2: `React.memo` Defeated by Inline Function on Every Thumbnail

- **File**: `src/renderer/components/VirtualizedGrid.tsx`, lines 353–356
- **Category**: Performance

**Problem**: The `Thumbnail` component is wrapped in `React.memo` to prevent unnecessary re-renders. However, the `onClick` prop is an inline closure:
```tsx
onClick={onThumbnailClick ? (f) => onThumbnailClick(f, tile.index) : undefined}
```
This creates a new function reference for every tile on every render. Since `React.memo` compares props by reference, this **completely bypasses the memoization** — every visible thumbnail re-renders on every scroll event.

**Fix**: Accept `index` as a prop on `Thumbnail` and pass the stable `onThumbnailClick` directly.

In `src/renderer/components/Thumbnail.tsx`, add `index` to the props interface:
```typescript
export interface ThumbnailProps {
  file: MediaFile;
  width: number;
  height: number;
  /** Absolute index within the flat files array, for viewer navigation. */
  index: number;
  onHover?: () => void;
  onClick?: (file: MediaFile, index: number) => void;
  onContextMenu?: (file: MediaFile, e: React.MouseEvent) => void;
  onDimensions?: (filePath: string, width: number, height: number) => void;
}
```
And in the component body, change the click handler to:
```tsx
onClick={onClick && !errored ? () => onClick(file, index) : undefined}
```

In `src/renderer/components/VirtualizedGrid.tsx`, change the Thumbnail render to:
```tsx
<Thumbnail
  file={tile.file}
  width={tile.width}
  height={tile.height}
  index={tile.index}
  onHover={onThumbnailHover}
  onClick={onThumbnailClick}
  onContextMenu={onThumbnailContextMenu}
  onDimensions={handleDimensionsMeasured}
/>
```

---

### H-3: Race Condition on Scan Cancellation Can Break Future Scans

- **File**: `electron/main.ts`, lines 265, 298
- **Category**: Race Condition

**Problem**: When scan A finishes/exits, `activeScanCancel` is set to `null` (line 298). If the user starts scan B while scan A's worker is still exiting, the sequence is:
1. User starts Scan B → `activeScanCancel` is set to B's cancel function (line 265)
2. Scan A's worker finally exits → `await once(child, "exit")` resolves → `activeScanCancel = null` (line 298)

Now scan B has no cancel function registered. Pressing "Cancel" does nothing.

**Fix**: Use a generation counter so the cleanup only applies to the correct scan:

```typescript
let currentScanId = 0;

ipcMain.handle("scan:start", async (event, folderPath: string) => {
  const scanId = ++currentScanId;
  // ... existing setup ...

  activeScanCancel = () => {
    if (child.pid) child.postMessage({ type: "cancel" });
  };

  // ... existing message handlers ...

  await once(child, "exit");
  // Only clear if we're still the current scan
  if (currentScanId === scanId) activeScanCancel = null;

  return total;
});
```

---

### H-4: Worker `process.exit()` Can Lose Buffered IPC Messages

- **File**: `electron/scanWorker.ts`, lines 42, 48
- **Category**: Race Condition

**Problem**: After posting the `done` or `error` message, the worker immediately calls `process.exit(0)` or `process.exit(1)`. `process.parentPort.postMessage()` is asynchronous — the message is enqueued in the IPC channel but may not have been delivered to the parent process by the time `process.exit()` tears down the event loop.

On fast exit, the main process might never receive the `done` message. The scan appears "stuck" — the status bar never transitions to "SCAN COMPLETE".

**Fix**: Allow IPC to drain before exiting. Replace lines 39-49 with:

```typescript
  .then((total) => {
    console.error(`[worker] DONE total=${total} batches=${batchCount} files=${fileCount} elapsed=${Date.now() - t0}ms`);
    post({ type: "done", total });
    // Allow IPC to flush before exiting
    setTimeout(() => process.exit(0), 100);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ERROR: ${message}`);
    post({ type: "error", message });
    setTimeout(() => process.exit(1), 100);
  });
```

---

### H-5: Global Concurrency Explosion in Directory Scanner

- **File**: `src/scanner/scan.ts`, lines 159, 237
- **Category**: Architecture / Resource Exhaustion

**Problem**: The `pool()` function limits concurrency for a flat array of items, but it's called *recursively* — each directory spawns its own pool of up to 16 workers, each of which can recursively spawn another pool. The effective global concurrency is `16^depth`, not 16.

For a directory tree 4 levels deep with 10 subdirectories at each level: 16 × 16 × 16 × 16 = 65,536 concurrent operations. This causes `EMFILE` (too many open files) errors on deeply nested trees.

**Fix**: Replace the per-call `pool()` with a global semaphore that limits total in-flight directory reads across the entire recursive walk. Add this at the top of `scan.ts`:

```typescript
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private limit: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
```

Then in `scanFolderStream`, create a single shared semaphore and acquire/release around each directory read instead of using the `pool()` function:

```typescript
const sem = new Semaphore(concurrency);

async function enumerate(dir: string): Promise<void> {
  await sem.acquire();
  try {
    // ... existing enumerate logic ...
  } finally {
    sem.release();
  }
  // Recurse into subdirectories — sem limits total concurrency globally
  await Promise.all(subDirs.map(enumerate));
}
```

---

### H-6: Synchronous `writeFileSync` / `renameSync` in Main Process Cache

- **File**: `electron/mediaCache.ts`, lines 69–80
- **Category**: Performance

**Problem**: `persist()` uses `fs.writeFileSync` + `fs.renameSync` on the main thread. For large libraries, `JSON.stringify(cache)` and the synchronous disk write block the Electron main process event loop. Since `persist()` is triggered by the 2-second `scheduleFlush()` timer while the user is actively scrolling/viewing, this causes visible UI freezes (200–500ms for a 50k-file cache).

**Fix**: Make `persist()` async. Replace lines 68–80 with:

```typescript
/** Atomically write the cache to disk (tmp + rename). */
async function persist(): Promise<void> {
  try {
    const p = ensurePath();
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(cache), "utf-8");
    await fs.promises.rename(tmp, p);
    dirty = false;
  } catch (e) {
    console.warn("mediaCache persist failed:", e);
  }
}
```

Also update `flush()` to handle the async version (line 162–168):
```typescript
export function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirty) void persist();
}
```

And update `scheduleFlush()` (line 86–92):
```typescript
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) void persist();
  }, 2000);
}
```

---

## 🟡 MEDIUM Issues

### M-1: `Ctrl+F` Keyboard Shortcut Does Nothing (Dead Code)

- **File**: `src/renderer/App.tsx`, lines 262–267
- **Category**: Bug / UX

**Problem**: The `Ctrl+F` handler queries for the search input element but never calls `.focus()` on it:
```typescript
const input = document.querySelector<HTMLInputElement>('input[placeholder="Search files..."]');
// <-- missing: input?.focus();
```

**Fix**: Add `input?.focus();` after line 266. The block should read:
```typescript
if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
  e.preventDefault();
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="Search files..."]',
  );
  input?.focus();
}
```

---

### M-2: `navigateTo` in Filmstrip Calls `onNavigate` N Times Instead of Jumping

- **File**: `src/renderer/components/MediaViewer.tsx`, lines 347–357
- **Category**: Performance / UX

**Problem**: Clicking a filmstrip thumbnail N positions away calls `onNavigate("prev")` or `onNavigate("next")` in a loop N times:
```typescript
for (let i = currentIndex; i > target; i--) onNavigate?.("prev");
```
Each call triggers a state update and re-render. Clicking 50 positions away causes 50 re-renders.

**Fix**: 

1. In `src/renderer/App.tsx`, add a `navigateViewerTo` callback and pass it to `MediaViewer`:
```typescript
const navigateViewerTo = useCallback(
  (index: number) => {
    if (index >= 0 && index < derivedFiles.length) {
      setViewerIndex(index);
    }
  },
  [derivedFiles.length],
);
```
Pass it as a new prop:
```tsx
<MediaViewer
  file={derivedFiles[viewerIndex]}
  files={derivedFiles}
  index={viewerIndex}
  onClose={() => setViewerIndex(null)}
  onNavigate={navigateViewer}
  onNavigateTo={navigateViewerTo}
/>
```

2. In `src/renderer/components/MediaViewer.tsx`, add the prop and use it:
```typescript
export interface MediaViewerProps {
  // ... existing props ...
  onNavigateTo?: (index: number) => void;
}
```
Replace the `navigateTo` function body (lines 347–357):
```typescript
const navigateTo = useCallback(
  (target: number) => {
    if (onNavigateTo) {
      onNavigateTo(target);
    } else if (onNavigate) {
      // Fallback to step-by-step
      if (target < currentIndex) {
        for (let i = currentIndex; i > target; i--) onNavigate("prev");
      } else if (target > currentIndex) {
        for (let i = currentIndex; i < target; i++) onNavigate("next");
      }
    }
  },
  [currentIndex, onNavigate, onNavigateTo],
);
```

---

### M-3: CLI Skips Phase 2 Metadata (All Files Output `sizeBytes: 0`)

- **File**: `src/scanner/cli.ts`, lines 30–44
- **Category**: Bug

**Problem**: The CLI calls `scanFolderStream` without providing the `onMetaBatch` callback. In `scan.ts` line 247, Phase 2 (stat for size/date) is entirely skipped when `onMetaBatch` is undefined. So `npm run scan -- <folder> --json` outputs all files with `sizeBytes: 0`, `birthtimeMs: 0`, and `dateKey: "unknown"`.

**Fix**: Pass an `onMetaBatch` callback to `scanFolderStream` that patches the accumulated array. Replace lines 30–44 with:

```typescript
  // Build a path→index lookup so metaBatch patches are O(1) per file.
  const pathIndex = new Map<string, number>();

  const total = await scanFolderStream(
    folder,
    (batch) => {
      for (const f of batch) {
        pathIndex.set(f.filePath, all.length);
        all.push(f);
      }
      if (!json) {
        // In NDJSON mode, we'll re-emit after metadata patches
      }
    },
    ({ count, currentDir }) => {
      if (!quiet && !json) {
        process.stderr.write(`\r${count} files…  ${currentDir}`.slice(0, 100) + "\x1b[K");
      }
    },
    {},
    (patches) => {
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
```

Then at the end, for NDJSON mode, emit after all patches:
```typescript
  if (!quiet) process.stderr.write("\n");
  if (json) {
    process.stdout.write(JSON.stringify(all));
  } else {
    for (const f of all) process.stdout.write(JSON.stringify(f) + "\n");
  }
  process.stderr.write(`Done: ${total} media file${total === 1 ? "" : "s"}.\n`);
```

---

### M-4: O(N²) Index Rebuild in `recordDimensions`

- **File**: `electron/mediaCache.ts`, lines 117–139, specifically line 122
- **Category**: Performance

**Problem**: `recordDimensions` rebuilds a `Map` from the entire `cache.files` array on every call:
```typescript
const indexByPath = new Map(cache.files.map((f, i) => [f.filePath, i]));
```
This runs on every batch of dimension updates (every 3 seconds during scrolling). For a 50k-file cache: 50k iterations per call.

**Fix**: Maintain a persistent index map. Add a module-level variable:

```typescript
let fileIndexByPath: Map<string, number> | null = null;
```

Rebuild it only in `recordScanResult` (after the files array changes):
```typescript
export function recordScanResult(folderPath: string, files: MediaFile[]): void {
  load();
  // ... existing logic ...
  cache = { folder: folderPath, files, dims: survivingDims };
  // Rebuild the persistent index
  fileIndexByPath = new Map(cache.files.map((f, i) => [f.filePath, i]));
  dirty = true;
  scheduleFlush();
}
```

Also rebuild in `load()`:
```typescript
function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    // ... existing parse logic ...
  } catch {
    cache = { folder: "", files: [], dims: {} };
  }
  fileIndexByPath = new Map(cache.files.map((f, i) => [f.filePath, i]));
}
```

Then in `recordDimensions`, use the persistent index instead of rebuilding:
```typescript
export function recordDimensions(
  entries: { filePath: string; width: number; height: number }[],
): void {
  load();
  let changed = false;
  for (const { filePath, width, height } of entries) {
    if (width <= 0 || height <= 0) continue;
    const prev = cache.dims[filePath];
    if (prev && prev.w === width && prev.h === height) continue;
    cache.dims[filePath] = { w: width, h: height };
    changed = true;
    const idx = fileIndexByPath?.get(filePath);
    if (idx !== undefined) {
      cache.files[idx] = { ...cache.files[idx], width, height };
    }
  }
  if (changed) {
    dirty = true;
    scheduleFlush();
  }
}
```

---

### M-5: Excessive Event Listener Rebinding on Search Keystroke

- **File**: `src/renderer/App.tsx`, lines 236–282
- **Category**: Performance

**Problem**: The global keyboard shortcut `useEffect` includes `searchQuery`, `selectedFolder`, and `viewerIndex` in its dependency array. Every keystroke in the search bar removes and re-adds the global `keydown` event listener.

**Fix**: Follow the existing pattern from lines 62–69 (using refs for `folder` and `scan.status`). Add these refs after line 69:

```typescript
const searchQueryRef = useRef(searchQuery);
const selectedFolderRef = useRef(selectedFolder);
const viewerIndexRef = useRef(viewerIndex);
useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);
useEffect(() => { viewerIndexRef.current = viewerIndex; }, [viewerIndex]);
```

Then inside the `useEffect` handler (lines 236–282), replace direct references to `searchQuery`, `selectedFolder`, and `viewerIndex` with their `.current` counterparts, and remove them from the dependency array:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // ... existing logic, but use refs:
    // viewerIndex  → viewerIndexRef.current
    // searchQuery  → searchQueryRef.current
    // selectedFolder → selectedFolderRef.current
    
    if (e.key === "Escape") {
      if (viewerIndexRef.current !== null) return;
      if (searchQueryRef.current) {
        setSearchQuery("");
      } else if (selectedFolderRef.current !== null) {
        setSelectedFolder(null);
      }
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [pickFolder, startScan]); // removed searchQuery, selectedFolder, viewerIndex
```

---

### M-6: Case-Insensitive Path Normalization Breaks on Linux

- **File**: `electron/main.ts`, lines 77–78
- **Category**: Bug (cross-platform)

**Problem**: `normalizeRoot()` unconditionally calls `.toLowerCase()` on paths. On case-sensitive filesystems (Linux, some macOS configurations), `/home/User/Photos` and `/home/user/photos` are different directories. This can allow path-traversal bypass or cause legitimate files to 403.

**Fix**: Only lowercase on Windows. Replace lines 77–79:
```typescript
function normalizeRoot(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
```

Also update the `media://` handler path comparison (lines 159–163) to be platform-aware:
```typescript
const requestedNorm = process.platform === "win32"
  ? requested.toLowerCase()
  : requested;
const isAllowed = [...allowedRoots].some((root) => {
  const rel = path.relative(root, requestedNorm);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
});
```

The same fix should be applied to `normalizeRoot` usage in `FolderTree.tsx` (line 36) and `scan.ts` (line 43) for consistency.

---

### M-7: `onWheel` `preventDefault()` Ignored Due to Passive Listener

- **File**: `src/renderer/components/MediaViewer.tsx`, lines 279–292
- **Category**: Bug / UX

**Problem**: In React 17+, `onWheel` synthetic events are attached as passive listeners by default. Calling `e.preventDefault()` inside a passive handler has no effect — the browser still scrolls underneath the media viewer while the user tries to zoom.

**Fix**: Remove the `onWheel` prop from the JSX and attach a non-passive wheel listener via `useEffect`. Add this after the existing `useEffect` blocks (around line 207):

```typescript
// Wheel-to-zoom: must use native non-passive listener so preventDefault works.
useEffect(() => {
  const el = mediaContainerRef.current;
  if (!el || isVideo) return;
  const handler = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };
  el.addEventListener("wheel", handler, { passive: false });
  return () => el.removeEventListener("wheel", handler);
}, [isVideo]);
```

Then remove the `onWheel={handleWheel}` prop from the media stage div (line 429) and remove the `handleWheel` callback (lines 279–292).

---

### M-8: `BootSequence` Re-triggers on `onDone` Reference Change

- **File**: `src/renderer/components/BootSequence.tsx`, lines 19–30
- **Category**: Bug / React Anti-pattern

**Problem**: The `useEffect` includes `onDone` in its dependency array. If the parent passes a non-memoized `onDone` callback, the timer restarts on every parent re-render. Currently dormant (parent passes no `onDone`) but a latent bug.

**Fix**: Store `onDone` in a ref. Replace lines 19–30:

```typescript
const onDoneRef = useRef(onDone);
useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

useEffect(() => {
  if (durationMs === 0) {
    onDoneRef.current?.();
    return;
  }
  const timer = setTimeout(() => {
    setDone(true);
    onDoneRef.current?.();
  }, durationMs);

  return () => clearTimeout(timer);
}, [durationMs]); // onDone removed from deps
```

---

## 🔵 LOW Issues

### L-1: Worker `stdout`/`stderr` Silently Discarded

- **File**: `electron/main.ts`, lines 261–262
- **Category**: Debugging / Observability

**Problem**: Worker stdout/stderr are consumed with no-op handlers `() => {}`. Worker diagnostic messages go nowhere.

**Fix**: Forward to main process console:
```typescript
child.stdout?.on("data", (d: Buffer) => console.log(`[scanWorker] ${d.toString().trimEnd()}`));
child.stderr?.on("data", (d: Buffer) => console.error(`[scanWorker] ${d.toString().trimEnd()}`));
```

---

### L-2: `persist()` Error Swallowed Without Any Logging

- **File**: `electron/mediaCache.ts`, lines 77–79
- **Category**: Error Handling

**Problem**: Bare `catch {}` block with no logging. If the cache file corrupts or the disk is full, there's zero diagnostic output.

**Fix**: Add logging in the catch block:
```typescript
} catch (e) {
  console.warn("mediaCache persist failed:", e);
}
```

---

### L-3: Inconsistent Timezone Between `birthtime` (UTC) and `dateKey` (Local)

- **File**: `src/scanner/scan.ts`, lines 47–55, 127
- **Category**: Logic

**Problem**: `birthtime` is serialized as UTC ISO string via `.toISOString()`, but `dateKey` uses local time methods (`getFullYear`, `getMonth`, `getDate`). A file created at 11:30 PM UTC on Jan 1 shows `birthtime: "2026-01-01T23:30:00Z"` but `dateKey: "2026-01-02"` for UTC+1 users.

**Fix**: Use UTC methods in `dateKeyFromMs` for consistency:
```typescript
function dateKeyFromMs(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

Or keep local time and document the intentional behavior with a comment.

---

### L-4: `FolderTree` Redundantly Lowercases Already-Lowered Values

- **File**: `src/renderer/components/FolderTree.tsx`, line 198
- **Category**: Code Quality

**Problem**: Line 198 calls `normRoot.toLowerCase()` but `normRoot` is already the output of `normalizePath()` which already lowercases.

**Fix**: Remove the redundant `.toLowerCase()` call on line 198:
```typescript
// Before:
normDir.toLowerCase().startsWith(normRoot.toLowerCase() + "/")
// After:
normDir.startsWith(normRoot + "/")
```

---

### L-5: Debug Diagnostics Leaked into Status Bar

- **File**: `src/renderer/App.tsx`, line 624
- **Category**: UX

**Problem**: The "SCAN COMPLETE" status message includes raw debug counters:
```
SCAN COMPLETE · ${scan.count} FILES · batches=${scan.batches.length} · files=${files.length} · derived=${derivedFiles.length}
```

**Fix**: Simplify to user-facing text only:
```typescript
`SCAN COMPLETE · ${scan.count.toLocaleString()} FILES`
```

---

### L-6: `formatBytes` Duplicated Across Two Files

- **Files**: `src/renderer/components/Thumbnail.tsx` (lines 31–40), `src/renderer/components/MediaViewer.tsx` (lines 28–37)
- **Category**: Maintainability

**Problem**: Identical `formatBytes` utility function is copy-pasted in both files.

**Fix**: Extract to a shared utility file `src/renderer/utils.ts`:
```typescript
/** Human-readable byte size, e.g. `4.2 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
```

Then import from both files:
```typescript
import { formatBytes } from "../utils";
```

---

## ⚪ INFO

### I-1: `TacticalPanel` Component Is Unused

- **File**: `src/renderer/components/TacticalPanel.tsx`
- **Category**: Dead Code

`TacticalPanel` is defined and exported but never imported or rendered anywhere in the app. It appears to be a leftover from an earlier UI iteration. Consider removing it or marking it with a `@deprecated` JSDoc tag.

---

### I-2: `SoundManager` Has No Configured Sound URLs

- **Files**: `src/renderer/sfx/SoundManager.ts`, `src/renderer/sfx/useSfx.ts`
- **Category**: Dead Code

The `SoundManager` singleton is instantiated and its methods (`playHover`, `playClick`, `playScan`) are called throughout the app, but `setConfig()` is never called anywhere in the codebase. No sound URLs are configured, so all SFX calls are silent no-ops. The entire SFX system is wired up but never activated.

If SFX is planned for a future release, add a `TODO` comment. If it's been abandoned, consider removing the SFX infrastructure to reduce code surface.

---

## Summary of Recommended Priority Actions

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 P0 | **C-1**: Add `allowedRoots` guard to `shell:openPath` / `shell:showItemInFolder` | Small |
| 🟠 P1 | **H-1**: Fix IPC listener leak in preload `startScan` | Small |
| 🟠 P1 | **H-2**: Fix defeated `React.memo` on Thumbnail onClick | Small |
| 🟠 P1 | **M-1**: Fix dead `Ctrl+F` shortcut (add `.focus()` call) | Trivial |
| 🟠 P1 | **H-3**: Fix scan cancellation race condition | Small |
| 🟡 P2 | **H-4**: Fix worker `process.exit()` losing IPC messages | Small |
| 🟡 P2 | **H-5**: Fix global concurrency explosion in scanner pool | Medium |
| 🟡 P2 | **H-6**: Make `persist()` async to avoid main-thread freeze | Small |
| 🟡 P2 | **M-3**: Fix CLI skipping Phase 2 metadata | Small |
| 🟢 P3 | **M-2**: Fix filmstrip navigateTo O(N) loop | Small |
| 🟢 P3 | **M-4**: Cache `indexByPath` to avoid O(N²) rebuild | Small |
| 🟢 P3 | **M-5**: Stabilize keyboard shortcut listener (use refs) | Small |
| 🟢 P3 | **M-6**: Platform-aware case normalization | Small |
| 🟢 P3 | **M-7**: Fix passive wheel event in MediaViewer | Small |
| 🟢 P3 | **L-5**: Remove debug diagnostics from status bar | Trivial |
| 🟢 P3 | **L-6**: Extract shared `formatBytes` utility | Trivial |
