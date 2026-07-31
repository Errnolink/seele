# Wiergise Media Scanner — Comprehensive V5 Codebase Review

An exhaustive, brutally honest senior engineering code review of the **Wiergise Media Scanner** repository (`electron/`, `src/renderer/`, and `src/scanner/`). This review evaluates every source file across seven architectural and quality dimensions, documenting critical bugs, performance bottlenecks, security flaws, correctness issues, and low-hanging improvements.

---

## What Is Excellent in This Codebase

Before detailing areas for improvement, it is worth highlighting where Wiergise demonstrates exemplary engineering:
1. **Two-Phase Streaming Architecture (`scan.ts`)**: Separating directory enumeration (`readdirSync({withFileTypes: true})`) from metadata statting (`statSync`) is an outstanding design. Phase 1 achieves sub-millisecond per-directory discovery so the UI can mount placeholders almost instantly without waiting on disk I/O.
2. **Precomputed Normalization (`types.ts` & `scan.ts`)**: Precomputing `fileNameLower`, `normPath`, `birthtimeMs`, and `dateKey` during scanning ensures that hot filtering, grouping, and search pipelines in React never allocate temporary lowercased strings or construct `Date` objects on every render.
3. **Bounded Global Concurrency (`Semaphore` in `scan.ts`)**: Implementing a shared concurrency semaphore rather than a per-call thread pool prevents recursive exponential explosion and `EMFILE` / descriptor exhaustion on deep directory trees.
4. **Frameless Cyberpunk Aesthetic & UI Craftsmanship**: The NERV/tactical cyberpunk design tokens (`theme.css`), custom frameless window controls (`titleBarOverlay`), SVG hex grid overlay, and CRT noise texture show exceptional polish and attention to detail.

---

## Detailed Issue Report

### 🔴 [Critical] Issue ARCH-1: Phase 1 Placeholder Files Persisted to On-Disk Cache Without Phase 2 Metadata Patches
**File**: `electron/main.ts` (lines 298–340)  
**Category**: Architecture | Correctness  
**Problem**:  
When `scan:batch` arrives from the scan worker, `main.ts` accumulates Phase 1 placeholder `MediaFile` objects (where `sizeBytes = 0`, `birthtimeMs = 0`, and `dateKey = "unknown"`) into `collected: MediaFile[]`. When `scan:metaBatch` messages arrive during Phase 2, `main.ts` simply forwards `messagePatches(msg)` to the renderer via IPC (`send("scan:metaBatch", ...)`) but **never applies the metadata patches to `collected` in memory**. Consequently, when the scan completes and `scan:done` fires, `mediaCache.recordScanResult(folderPath, collected)` writes the unpatched Phase 1 placeholder files to `media-cache.json`. Whenever the user reopens the app or loads a folder from cache (`scan:loadCached`), every cached file has `sizeBytes = 0` and `dateKey = "unknown"`, breaking date grouping, size sorting, and status bar statistics on cached loads.

**Fix**:  
Maintain a path-to-index lookup Map in `main.ts` alongside `collected` and mutate `collected[idx]` in place when `scan:metaBatch` arrives (matching the CLI pattern in `cli.ts` lines 49–64):

```diff
  let total = 0;
  const collected: MediaFile[] = [];
+ const pathIndex = new Map<string, number>();

  child.on("message", (msg: unknown) => {
    switch (messageType(msg)) {
      case "batch": {
        const files = messageFiles(msg);
+       for (const f of files) {
+         pathIndex.set(f.filePath, collected.length);
+         collected.push(f);
+       }
-       collected.push(...files);
        send("scan:batch", files);
        break;
      }
      case "metaBatch": {
+       const patches = messagePatches(msg);
+       for (const patch of patches) {
+         const idx = pathIndex.get(patch.filePath);
+         if (idx !== undefined) {
+           collected[idx] = {
+             ...collected[idx],
+             sizeBytes: patch.sizeBytes,
+             birthtimeMs: patch.birthtimeMs,
+             birthtime: patch.birthtime,
+             dateKey: patch.dateKey,
+           };
+         }
+       }
        send("scan:metaBatch", messagePatches(msg));
        break;
      }
```

**Risk**: Negligible memory footprint increase for `pathIndex` during the scan; ensures cached scans retain accurate size and timestamp metadata.

---

### 🔴 [Critical] Issue CORR-1: Masonry Grid Double-Counts Section `offsetY` on Grouped Modes (`date` & `type`)
**File**: `src/renderer/components/VirtualizedGrid.tsx` (lines 206–276, 338–360)  
**Category**: Correctness | UI  
**Problem**:  
In `VirtualizedGrid.tsx`, when packing tiles for a group section, `colHeights` is initialized to `bodyStartY`, which is an **absolute Y coordinate** from the top of the entire scroll container (`sectionStartY + HEADER_HEIGHT + GAP`). Each tile's `y` is set to `colHeights[shortestCol]`, meaning `tile.y` is already stored as an absolute coordinate. However, when calculating visible tiles in `visibleTiles` (line 271), the code computes:
```ts
const absY = section.offsetY + tile.y;
```
For Section 0 (`offsetY = 0`), `0 + tile.y` works. But for Section 1 (`offsetY = 1000`), `tile.y` is already ~`1000`, so `absY` becomes `1000 + 1000 = 2000`! Every subsequent section is shifted downward by its own cumulative `offsetY`, creating massive blank gaps in the masonry layout and causing virtualized viewport culling to fail for Group by Date and Group by Type.

**Fix**:  
Store `tile.y` as a **relative coordinate within the section** (starting from `group.header ? HEADER_HEIGHT + GAP : 0`), so that `section.offsetY + tile.y` correctly computes the absolute Y position:

```diff
    for (const group of groups) {
      const sectionStartY = cursorY;
-     let bodyStartY = sectionStartY;
-     if (group.header) {
-       bodyStartY = sectionStartY + HEADER_HEIGHT + GAP;
-     }
+     const sectionHeaderOffset = group.header ? HEADER_HEIGHT + GAP : 0;
+     const colHeights = new Array(columnCount).fill(sectionHeaderOffset);
      const tiles: PlacedTile[] = [];

      for (let i = 0; i < group.files.length; i++) {
        // ...
        const tileHeight = Math.round(columnWidth * ratio);
        const x = PADDING + shortestCol * (columnWidth + GAP);
        const y = colHeights[shortestCol];

        tiles.push({
          file,
          index: group.startIndex + i,
          x,
          y,
          width: columnWidth,
          height: tileHeight,
        });

        colHeights[shortestCol] = y + tileHeight + GAP;
      }

-     const sectionHeight = Math.max(...colHeights, bodyStartY) - sectionStartY;
+     const sectionHeight = Math.max(...colHeights, sectionHeaderOffset);
      const section: Section = {
        header: group.header,
        tiles,
        height: sectionHeight,
        offsetY: sectionStartY,
      };
      sections.push(section);
      cursorY = sectionStartY + sectionHeight + GAP * 2;
    }
```

**Risk**: None; fixes broken grouping layouts and restores correct virtualized scrolling in grouped modes.

---

### 🔴 [Critical] Issue SEC-1: Cross-Platform Path Traversal Bypass on Linux & macOS in `media://` Protocol Handler
**File**: `electron/main.ts` (lines 172–183)  
**Category**: Security  
**Problem**:  
In `protocol.handle("media", ...)`, line 172 unconditionally strips any leading slash from the URL pathname:
```ts
const raw = decodeURIComponent(url.pathname).replace(/^\//, "");
const requested = path.resolve(raw);
```
While stripping `/` before a Windows drive letter (`/C:/Users/...` → `C:/Users/...`) is necessary on Windows, **on Linux and macOS an absolute path begins with `/` (e.g. `/home/user/media/img.jpg`)**. Stripping the leading slash converts Unix paths into relative paths (`home/user/media/img.jpg`), causing `path.isAbsolute(requested)` to return `false` (or resolving relative to CWD), which breaks `media://` loading entirely on macOS and Linux.

**Fix**:  
Condition leading-slash stripping on `process.platform === "win32"`:

```diff
-   const raw = decodeURIComponent(url.pathname).replace(/^\//, "");
+   const rawPath = decodeURIComponent(url.pathname);
+   const raw = process.platform === "win32" ? rawPath.replace(/^\//, "") : rawPath;
    const requested = path.resolve(raw);
```

**Risk**: None on Windows; restores correct `media://` path resolution on macOS and Linux.

---

### 🔴 [Critical] Issue PERF-1: Masonry Grid Loads Full-Resolution 50MB Media Without `?w=` Server-Side Downscaling
**File**: `src/renderer/components/Thumbnail.tsx` (lines 54–59, 140–153)  
**Category**: Performance  
**Problem**:  
While `main.ts` supports server-side thumbnail downscaling via `?w=N` on the `media://` protocol (and `FilmstripThumb` in `MediaViewer.tsx` uses `toThumbUrl(file.filePath)` with `?w=112`), `Thumbnail.tsx` in the masonry grid calls `window.scanAPI.toMediaUrl(file.filePath)` **without appending the `?w=` width query parameter**. When a user scrolls through thousands of photos in the virtualized grid, the browser downloads, decodes, and renders multi-megapixel full-resolution images (e.g., 24–50 MP JPEGs/PNGs) for every 180px thumbnail tile. This causes massive GPU/DOM memory consumption (several gigabytes of RAM), UI thread freezes, and potential renderer crashes on large libraries.

**Fix**:  
Append `?w=${Math.min(512, Math.max(128, Math.round(width * 1.5)))}` to `mediaUrl` for image files in `Thumbnail.tsx`:

```diff
    const mediaUrl =
      typeof window !== "undefined" &&
      window.scanAPI &&
      typeof window.scanAPI.toMediaUrl === "function"
-       ? window.scanAPI.toMediaUrl(file.filePath)
+       ? `${window.scanAPI.toMediaUrl(file.filePath)}${file.fileType === "image" ? `?w=${Math.min(512, Math.max(128, Math.round(width * 1.5)))}` : ""}`
        : file.filePath;
```

**Risk**: Low risk; thumbnails load dramatically faster with minimal memory usage. Note that `onDimensions` still captures accurate aspect ratios from `naturalWidth`/`naturalHeight`, which is invariant under uniform downscaling.

---

### 🔴 [Critical] Issue CORR-2: Async Race Condition in `mediaCache.ts` Can Silently Discard Dimension and Scan Updates
**File**: `electron/mediaCache.ts` (lines 77–92, 111–150)  
**Category**: Correctness | Concurrency  
**Problem**:  
In `mediaCache.ts`, `persist()` is an asynchronous function that writes JSON to disk. At line 88, **after `await fs.promises.rename(...)` finishes, it sets `dirty = false;`**:
```ts
async function persist(): Promise<void> {
  try {
    // ...
    await fs.promises.writeFile(tmp, JSON.stringify(cache), "utf-8");
    await fs.promises.rename(tmp, p);
    dirty = false;
  } catch (e) { ... }
}
```
If `recordDimensions(...)` or `recordScanResult(...)` is called **while `persist()` is awaiting I/O**, it updates `cache`, sets `dirty = true`, and schedules a flush. But when the running `persist()` finishes its async I/O (which wrote the older snapshot), it overwrites `dirty = false`. When `flushTimer` fires later, `if (dirty) void persist();` evaluates to `false`, causing the new dimensions or scan results to be permanently lost from disk.

**Fix**:  
Clear `dirty = false` **synchronously at the start of `persist()`** before any async I/O:

```diff
  async function persist(): Promise<void> {
+   if (!dirty) return;
+   dirty = false;
+   const snapshot = JSON.stringify(cache);
    try {
      const p = ensurePath();
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
-     await fs.promises.writeFile(tmp, JSON.stringify(cache), "utf-8");
+     await fs.promises.writeFile(tmp, snapshot, "utf-8");
      await fs.promises.rename(tmp, p);
-     dirty = false;
    } catch (e) {
+     dirty = true;
      console.warn("mediaCache persist failed:", e);
    }
  }
```

**Risk**: Low risk; guarantees zero data loss in on-disk cache persistence.

---

### 🟡 [Important] Issue PERF-2: Synchronous `nativeImage.createFromBuffer` and `resize` Block Electron Main Thread
**File**: `electron/main.ts` (lines 189–209)  
**Category**: Performance | Security  
**Problem**:  
In the `media://` protocol handler, when `?w=N` is requested, `main.ts` reads the entire file into memory (`await fs.promises.readFile(requested)`), then synchronously calls C++ `nativeImage.createFromBuffer(buf)` and `img.resize({ width: w, quality: "good" })` on the main process UI thread. When dozens of thumbnails are requested concurrently during fast scrolling, C++ image decoding and bicubic resizing block the Electron main thread, causing window dragging, frameless controls, and IPC processing to stutter or freeze. Additionally, there is no caching of downscaled thumbnails, so scrolling away and back re-decodes from disk every time.

**Fix**:  
Move thumbnail resizing to a utility worker thread or implement an LRU in-memory thumbnail cache in `main.ts` (capped at ~500 entries / 50 MB) so each image is downscaled at most once per session. Also add a file size check before `readFile` (e.g., skip downscaling for files > 50 MB to prevent OOM / DoS).

**Risk**: Moderate effort; provides massive UI smoothness and DoS protection.

---

### 🟡 [Important] Issue PERF-3: O(n * m) Array Reallocations During Phase 2 Metadata Patching in `useScanState`
**File**: `src/renderer/hooks/useScanState.ts` (lines 85–119, 172–175)  
**Category**: Performance  
**Problem**:  
In `useScanState.ts`, when `metaBatch` actions arrive during Phase 2 statting, `scanReducer` maps over every batch (`state.batches.map(batch => batch.map(...))`). For a library of 50,000 files, Phase 2 emits 100 chunks of 500 patches. Each chunk iterates over all 50,000 files in `state.batches` (5 million file iterations). Worse, every `metaBatch` increments `state.filesVersion`, causing `useMemo(() => state.batches.flat(), [state.filesVersion])` to allocate a brand new 50,000-element flat array 100 times, triggering expensive re-renders in subscribing components.

**Fix**:  
Throttle `onMetaBatch` dispatches in `useScanState.ts` (similar to how `onBatch` coalesces via `setTimeout(..., 150)` in lines 185–201) so that incoming `metaBatch` messages are buffered and dispatched at most once every 150ms. Furthermore, maintain a persistent path-to-batch/index map for O(patches) updates.

**Risk**: Low risk; prevents UI lockup during Phase 2 metadata streaming.

---

### 🟡 [Important] Issue PERF-4: `FolderTree` Recomputes Tree O(n) on Every `App` Re-Render & Unmemoized `TreeNodeRow`
**File**: `src/renderer/components/FolderTree.tsx` (lines 56–150, 167–279)  
**Category**: Performance  
**Problem**:  
In `FolderTree.tsx`, `TreeNodeRow` is a standard functional component without `React.memo`, causing the entire recursive DOM tree to re-render whenever `expandedPaths` or any prop changes. Furthermore, `FolderTree` itself is not wrapped in `React.memo`, meaning that every time `App.tsx` re-renders (e.g. typing in the search bar, adjusting the grid density slider, or toggling sort mode), `FolderTree` re-evaluates and re-renders all rows even when `files` and `filesVersion` are unchanged.

**Fix**:  
Wrap `TreeNodeRow` in `React.memo` (with stable callback props) and wrap `FolderTree` in `React.memo`:

```diff
- const TreeNodeRow: React.FC<TreeNodeRowProps> = ({ ... }) => { ... };
+ const TreeNodeRow: React.FC<TreeNodeRowProps> = React.memo(({ ... }) => { ... });

- export const FolderTree: React.FC<FolderTreeProps> = ({ ... }) => { ... };
+ export const FolderTree: React.FC<FolderTreeProps> = React.memo(({ ... }) => { ... });
```

**Risk**: None; improves React rendering performance.

---

### 🟡 [Important] Issue CORR-3: Symbolic Links to Directories and Files Silently Ignored During Scan
**File**: `src/scanner/scan.ts` (lines 84–90)  
**Category**: Correctness  
**Problem**:  
In `enumerateDirectory`, `readdirSync(dir, { withFileTypes: true })` returns `Dirent` entries. The code checks `if (entry.isDirectory())` and `if (!entry.isFile()) continue;`. In Node.js `Dirent`, a symbolic link (`entry.isSymbolicLink()`) returns `false` for both `isDirectory()` and `isFile()`. Consequently, symlinked directories and symlinked media files are skipped entirely.

**Fix**:  
Check `entry.isSymbolicLink()` and use `statSync(path.join(dir, entry.name))` to determine whether the target is a directory or file (wrapped in a `try/catch` to ignore broken symlinks).

**Risk**: Low risk; enables scanning media inside symlinked folders or symlinked files.

---

### 🟡 [Important] Issue CORR-4: Unsynchronized `viewerIndex` When `derivedFiles` Mutates While Lightbox is Open
**File**: `src/renderer/App.tsx` (lines 860–869)  
**Category**: Correctness | UX  
**Problem**:  
When the fullscreen `MediaViewer` is open (`viewerIndex !== null`), `App.tsx` passes `derivedFiles[viewerIndex]` based on a static integer index. If `derivedFiles` changes while the viewer is open (e.g. because a background scan batch arrived, a debounced search query completed, or files were sorted), `viewerIndex` still points to the old integer index. This can cause the viewer to display a completely different image, throw an out-of-bounds error, or unmount abruptly.

**Fix**:  
In `App.tsx`, track the active file path (`viewerFilePath: string | null`) alongside `viewerIndex`. When `derivedFiles` updates, recompute `viewerIndex = derivedFiles.findIndex(f => f.filePath === viewerFilePath)`. If `-1` (file removed by filter), close the viewer or clamp gracefully.

**Risk**: Prevents jarring image jumps or crashes when filtering/scanning while viewing media.

---

### 🟡 [Important] Issue TOOL-1: Unused Dependency `@tanstack/react-virtual` in `package.json`
**File**: `package.json` (line 21)  
**Category**: Tooling  
**Problem**:  
`package.json` lists `"@tanstack/react-virtual": "^3.14.8"` as a production dependency, but the project uses its own custom masonry layout engine in `src/renderer/components/VirtualizedGrid.tsx`. The dependency is never imported or used anywhere in the codebase.

**Fix**:  
Remove `"@tanstack/react-virtual"` from `dependencies` in `package.json` (`npm uninstall @tanstack/react-virtual`).

**Risk**: None; reduces node_modules bundle size and removes dead dependencies.

---

### 🟡 [Important] Issue TOOL-2: Missing Lint, Format, and Test Scripts in `package.json`
**File**: `package.json` (lines 7–17)  
**Category**: Tooling  
**Problem**:  
`package.json` only defines `dev`, `scan`, `typecheck`, `build`, and `start` scripts. There are no scripts for linting (`eslint`), formatting (`prettier`), or testing (`vitest` / CLI test runner), even though `src/scanner/cli.ts` notes it doubles as an integration test surface.

**Fix**:  
Add `"lint": "eslint . --ext .ts,.tsx"`, `"format": "prettier --write \"**/*.{ts,tsx,css,md}\""`, and `"test": "vitest"` scripts to `package.json`.

**Risk**: None; improves CI/CD and developer ergonomics.

---

### 🔵 [Suggestion] Issue ARCH-2: Coalesce Redundant IPC `onDimensionsMeasured` Calls
**File**: `src/renderer/components/Thumbnail.tsx` (lines 145–150)  
**Category**: Architecture | Performance  
**Problem**:  
`Thumbnail.tsx` calls `onDimensions` every time an image `onLoad` fires, even if `file.width` and `file.height` already match `naturalWidth`/`naturalHeight`.

**Fix**:  
Check `if (nw !== file.width || nh !== file.height) onDimensions?.(file.filePath, nw, nh);`.

**Risk**: None; reduces unnecessary IPC traffic and cache writes.

---

### 🔵 [Suggestion] Issue ARCH-3: SoundManager Configuration Never Initialized (`setConfig` Never Called)
**File**: `src/renderer/sfx/SoundManager.ts` (lines 2–7)  
**Category**: Architecture | UX  
**Problem**:  
SFX calls (`playHover`, `playClick`, `playScan`) are wired throughout the app, but `soundManager.setConfig(...)` is never called, making all sounds silent no-ops while still incurring hook and debouncing overhead.

**Fix**:  
Provide embedded Web Audio synth sound effects or check `isEnabled()` before attaching hover listeners.

**Risk**: Adds audible feedback if activated.

---

### 🔵 [Suggestion] Issue TS-1: Silent `catch` Blocks Hide Debugging Context
**File**: `src/renderer/App.tsx` (line 228), `src/scanner/scan.ts` (line 80)  
**Category**: TypeScript | Code Quality  
**Problem**:  
Multiple `try/catch` blocks silently swallow exceptions (`catch { }`).

**Fix**:  
In development mode, log ignored exceptions (`if (process.env.NODE_ENV === 'development') console.debug(...)`).

**Risk**: None; aids developer debugging.

---

### 🔵 [Suggestion] Issue TS-2: Add Exhaustive Switch Check to `scanReducer`
**File**: `src/renderer/hooks/useScanState.ts` (lines 55–133)  
**Category**: TypeScript | Code Quality  
**Problem**:  
`scanReducer` lacks an exhaustive compile-time `never` check in default branches.

**Fix**:  
Add a type assertion `const _: never = action;` or `assertNever(action)` helper.

**Risk**: Strengthens compile-time type safety.

---

### 🔵 [Suggestion] Issue UX-1: Add ARIA Pressed States to Toolbar Toggles
**File**: `src/renderer/components/GroupControls.tsx` (lines 24–35), `src/renderer/components/SortControls.tsx` (lines 38–50)  
**Category**: UX | Accessibility  
**Problem**:  
Grouping and sorting toolbar buttons lack `aria-pressed={mode === option.mode}` attributes.

**Fix**:  
Add `aria-pressed` to improve screen-reader accessibility.

**Risk**: None; accessibility polish.

---

### 🔵 [Suggestion] Issue UX-2: 9px Monospace Metadata Readability
**File**: `src/renderer/theme.css`, `src/renderer/components/Thumbnail.tsx` (line 159)  
**Category**: UX  
**Problem**:  
9px uppercase text in `MetaItem` and thumbnail chips can be difficult to read on low-DPI monitors.

**Fix**:  
Increase minimum text sizes to `10px` or `11px`.

**Risk**: None; improves visual clarity.

---

### 🔵 [Suggestion] Issue CORR-5: Align `scanFolderStream` Docstring with Sequential Phase 1 / Phase 2 Execution
**File**: `src/scanner/scan.ts` (lines 175–192)  
**Category**: Correctness | Documentation  
**Problem**:  
The docstring claims Phase 1 and Phase 2 are interleaved per-directory, but the code executes full tree enumeration before starting Phase 2 statting.

**Fix**:  
Update the docstring to match sequential execution or interleave Phase 2 per directory.

**Risk**: None; improves documentation accuracy.

---

### 🔵 [Suggestion] Issue TOOL-3: Enable Additional Strict Compiler Checks in `tsconfig.json`
**File**: `tsconfig.json` (lines 2–18)  
**Category**: Tooling  
**Problem**:  
Helpful strict flags like `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` are not enabled.

**Fix**:  
Enable them in `tsconfig.json`.

**Risk**: None; prevents unused code accumulation.

---

## 1. Priority-Ordered Summary Table

| Severity | Issue ID | Title | Category | File | Impact / Why It Matters |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 🔴 **Critical** | **ARCH-1** | Phase 1 Placeholder Files Persisted Without Phase 2 Metadata Patches | Architecture | `electron/main.ts` | On-disk cache saves `sizeBytes = 0` and `dateKey = "unknown"`, breaking grouping, sorting, and stats on cache loads. |
| 🔴 **Critical** | **CORR-1** | Masonry Grid Double-Counts Section `offsetY` on Grouped Modes | Correctness | `src/renderer/components/VirtualizedGrid.tsx` | Group by Date / Type creates massive blank gaps and breaks scroll height and viewport culling. |
| 🔴 **Critical** | **SEC-1** | Cross-Platform Path Traversal Bypass on Linux & macOS in `media://` Handler | Security | `electron/main.ts` | Unconditional leading slash stripping turns Unix absolute paths into relative paths, breaking image loading on macOS/Linux. |
| 🔴 **Critical** | **PERF-1** | Masonry Grid Loads Full-Resolution 50MB Media Without `?w=` | Performance | `src/renderer/components/Thumbnail.tsx` | Grid thumbnails download full 24–50 MP images without server downscaling, causing high RAM spikes and stuttering. |
| 🔴 **Critical** | **CORR-2** | Async Race Condition in `mediaCache.ts` Silently Discards Updates | Correctness | `electron/mediaCache.ts` | Setting `dirty = false` after async `rename()` overwrites modifications made during write, permanently losing cache updates. |
| 🟡 **Important** | **PERF-2** | Synchronous `nativeImage` Decode & Resize Block Main Thread | Performance | `electron/main.ts` | Synchronous C++ image decode and resize on main thread cause UI freezes during fast scrolling. |
| 🟡 **Important** | **PERF-3** | O(n * m) Array Reallocations During Phase 2 Metadata Patching | Performance | `src/renderer/hooks/useScanState.ts` | 50,000 files re-mapped 100 times during Phase 2 causes 5 million array copies and UI freezes. |
| 🟡 **Important** | **PERF-4** | Unmemoized `FolderTree` and `TreeNodeRow` Re-Render O(n) | Performance | `src/renderer/components/FolderTree.tsx` | Every search keystroke or slider change re-renders the entire DOM folder hierarchy. |
| 🟡 **Important** | **CORR-3** | Symbolic Links Silently Ignored During Directory Walk | Correctness | `src/scanner/scan.ts` | Symlinks return false for `isDirectory()` and `isFile()`, skipping symlinked libraries. |
| 🟡 **Important** | **CORR-4** | Unsynchronized `viewerIndex` When `derivedFiles` Mutates | Correctness | `src/renderer/App.tsx` | Lightbox shows wrong file or throws out-of-bounds error if files filter/sort while open. |
| 🟡 **Important** | **TOOL-1** | Unused Dependency `@tanstack/react-virtual` | Tooling | `package.json` | Dead dependency increases bundle size. |
| 🟡 **Important** | **TOOL-2** | Missing Lint, Format, and Test Scripts | Tooling | `package.json` | Lacks automated quality gates. |
| 🔵 **Suggestion** | **ARCH-2** | Coalesce Redundant IPC `onDimensionsMeasured` Calls | Architecture | `src/renderer/components/Thumbnail.tsx` | Fires IPC calls even when dimensions are already known. |
| 🔵 **Suggestion** | **ARCH-3** | SoundManager Configuration Never Initialized | Architecture | `src/renderer/sfx/SoundManager.ts` | SFX calls are silent no-ops. |
| 🔵 **Suggestion** | **TS-1** | Silent `catch` Blocks Hide Debugging Context | TypeScript | `src/renderer/App.tsx`, `scan.ts` | Harder to debug developer issues. |
| 🔵 **Suggestion** | **TS-2** | Add Exhaustive Switch Check to `scanReducer` | TypeScript | `src/renderer/hooks/useScanState.ts` | Lacks compile-time never assertion. |
| 🔵 **Suggestion** | **UX-1** | Add ARIA Pressed States to Toolbar Toggles | UX | `GroupControls.tsx`, `SortControls.tsx` | Accessibility polish. |
| 🔵 **Suggestion** | **UX-2** | 9px Monospace Metadata Readability | UX | `theme.css`, `Thumbnail.tsx` | Can be hard to read on low-DPI displays. |
| 🔵 **Suggestion** | **CORR-5** | Align `scanFolderStream` Docstring with Sequential Execution | Documentation | `src/scanner/scan.ts` | Doc says interleaved; code runs sequential. |
| 🔵 **Suggestion** | **TOOL-3** | Enable Additional Strict Compiler Checks | Tooling | `tsconfig.json` | Additional TS strictness flags. |

---

## 2. Top 5 Quick Wins (High-Impact, Low-Effort)

1. **Fix Masonry Grid Grouping `offsetY` Double-Counting (CORR-1)**  
   - **Why**: 3 lines changed in `VirtualizedGrid.tsx` (`colHeights.fill(sectionHeaderOffset)` and `sectionHeight = Math.max(...colHeights, sectionHeaderOffset)`). Instantly fixes broken Group by Date and Group by Type layouts.
2. **Enable `?w=` Downscaling on Masonry Thumbnails (PERF-1)**  
   - **Why**: 1 line changed in `Thumbnail.tsx` to append `?w=${Math.round(width * 1.5)}`. Instantly reduces renderer memory usage by several gigabytes and makes scrolling smooth.
3. **Patch Phase 1 Placeholder Files in `main.ts` During Phase 2 (ARCH-1)**  
   - **Why**: ~10 lines added in `main.ts` (`case "metaBatch":`) to update `collected[idx]` in place. Instantly ensures cached scans preserve real file sizes and dates.
4. **Fix Async Cache Persistence Race Condition (CORR-2)**  
   - **Why**: Move `dirty = false;` to the very top of `persist()` in `mediaCache.ts`. Prevents silent loss of dimension and scan updates.
5. **Wrap `FolderTree` and `TreeNodeRow` in `React.memo` (PERF-4)**  
   - **Why**: 2 lines changed in `FolderTree.tsx`. Instantly eliminates O(n) sidebar DOM re-renders on search input typing and toolbar interactions.

---

## 3. "Do Not Touch" List (Deliberately Correct Implementations)

The following patterns look unusual at first glance but are **deliberately correct** to prevent regressions:
1. **Generation Counter for Scans (`currentScanId` / `activeScanCancel` in `main.ts`)**  
   - Do not simplify or remove `currentScanId`. It ensures that a late-exiting previous scan worker does not clear the active cancellation handler of a newer scan (v4 review H-3).
2. **Global Semaphore Concurrency (`Semaphore` in `scan.ts`)**  
   - Do not replace `Semaphore` with a per-call thread pool or unbounded Promise concurrency. Recursion on deep directory trees would cause exponential concurrency explosion and `EMFILE` / descriptor exhaustion (v4 review H-5).
3. **Platform-Aware Path Normalization (`normalizeRoot` in `main.ts` & `normalizePath` in `scan.ts`)**  
   - Do not remove OS checking (`process.platform === "win32"`). Windows requires lowercasing for case-insensitive matching, whereas Linux and macOS are case-sensitive and must NOT be lowercased (v4 review M-6).
4. **O(1) Dimension Patching via Cached `fileIndexByPath` Map (`mediaCache.ts`)**  
   - Do not replace `fileIndexByPath.get(filePath)` with `cache.files.findIndex(...)` or rebuild a 50k-entry Map inside `recordDimensions`. The persistent lookup map is essential for O(1) dimension merging without O(n) array scans (v4 review M-4).
5. **Worker Exit Drain (`setTimeout(() => process.exit(0), 100)` in `scanWorker.ts`)**  
   - Do not remove the 100ms timeout before `process.exit()`. `process.parentPort.postMessage` is asynchronous; calling `process.exit(0)` immediately can terminate the worker before the main process receives `scan:done` (v4 review H-4).
6. **Non-Passive Wheel Listener for Zoom (`MediaViewer.tsx` lines 296–310)**  
   - Do not convert the native wheel listener to a React `onWheel` prop. React synthetic wheel events are passive by default, preventing `e.preventDefault()` from blocking default browser scrolling while zooming (v4 review M-7).
7. **Frameless Titlebar & Drag Regions (`titleBarStyle: "hidden"`, `.titlebar-drag`, `.no-drag`)**  
   - Do not modify `titleBarOverlay` or remove `.titlebar-drag`/`.no-drag` classes. On Windows, `titleBarOverlay` reserves a small caption area for native min/max/close buttons overlaying the custom header (UX-14).
8. **Three-Slash `file:///` URLs on Windows (`pathToFileUrl` in `main.ts`)**  
   - Do not change `file:///${norm}` to two slashes. Windows absolute paths (`C:/...`) require three slashes after `file:` so the drive letter is treated as the path rather than the URL authority (v2 review bug #1).
