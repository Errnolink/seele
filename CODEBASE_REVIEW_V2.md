# Wiergise Media Scanner — Follow-up Review (v2)

> Second review after the codebase update. Focuses on the two **user-reported bugs** (thumbnails show "UNREADABLE", no image viewer) and **16 additional issues** found in the updated code.

---

## Acknowledgements — Issues Fixed Since v1

Many items from the first review have been properly addressed:

| v1 Issue | Status |
|---|---|
| #1 `filesRef` mutations | ✅ Replaced with `useReducer` in [useScanState.ts](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/hooks/useScanState.ts) |
| #3 No scan cancellation | ✅ `cancelScan` button + `AbortSignal` plumbed through |
| #5 Streaming flush broken | ✅ `flush()` now called inside the `BATCH_SIZE` check in [scan.ts](file:///C:/Users/Chef/orca/projects/Wiergise/src/scanner/scan.ts#L204-L207) |
| #7 `sandbox: false` | ✅ Changed to `sandbox: true` |
| #9 Missing `React.memo` | ✅ `Thumbnail` and `HexGridOverlay` are now memoized |
| #10/#11 Repeated Date / path normalization | ✅ Precomputed `normPath`, `birthtimeMs`, `dateKey` in scanner |
| #12 HexGridOverlay re-renders | ✅ Wrapped in `memo` |
| #16 No error handling | ✅ Error state + error banner added |
| #17 No error boundary | ✅ `ErrorBoundary` added at the root |
| #18 Scanner in main process | ✅ Moved to `utilityProcess` worker |
| #22 Expand/Collapse all | ✅ Added in [FolderTree.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/FolderTree.tsx#L282-L293) |
| #23 No keyboard shortcuts | ✅ Ctrl+O, Ctrl+F, Ctrl+Enter, Escape wired |
| #24 No search debounce | ✅ `useDebouncedValue` hook added |
| #25 Thumbnail error states | ✅ Loading skeleton + "UNREADABLE" fallback added |
| #26 Boot blocks in dev | ✅ `durationMs={import.meta.env.DEV ? 0 : 600}` |
| #29 No progress bar | ✅ Indeterminate scanline-bar animation added |

---

## 🔴 Bug #1 — Thumbnails All Show "UNREADABLE"

**Root Cause: `pathToFileUrl()` generates invalid `file://` URLs on Windows**

**File:** [main.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L157-L160)

```typescript
function pathToFileUrl(p: string): string {
  const norm = process.platform === "win32" ? p.replace(/\\/g, "/") : p;
  return `file://${norm}`;
}
```

On Windows, `path.resolve('C:\\Users\\foo\\image.jpg')` returns `C:\Users\foo\image.jpg`. After the backslash replace, `norm` becomes `C:/Users/foo/image.jpg`. The function then builds:

```
file://C:/Users/foo/image.jpg
```

This is **invalid**. The correct `file://` URL for a Windows absolute path requires **three** slashes:

```
file:///C:/Users/foo/image.jpg
```

`file://C:` tells the URL parser that `C:` is the **authority (host)**, not a drive letter. Chromium/Electron's `net.fetch()` then fails to resolve this, returning an error. The `Thumbnail` component catches the error via `onError` and shows the "UNREADABLE" fallback — which is exactly what the user sees.

**Fix:**

```typescript
function pathToFileUrl(p: string): string {
  const norm = process.platform === "win32" ? p.replace(/\\/g, "/") : p;
  // Windows absolute paths need three slashes: file:///C:/...
  // Unix absolute paths already start with /: file:///home/...
  return `file:///${norm.replace(/^\/+/, "")}`;
}
```

---

## 🔴 Bug #2 — Path-Traversal Guard May Also Block Legitimate Files

Even after Bug #1 is fixed, the path-traversal guard has a subtle pathname-parsing issue.

**File:** [main.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L134-L148)

The preload builds URLs like: `media://local/${encodeURIComponent(filePath)}`

For a Windows path `C:\Users\Chef\Photos\img.jpg`, `encodeURIComponent` produces `C%3A%5CUsers%5CChef%5CPhotos%5Cimg.jpg`.

So the full URL is `media://local/C%3A%5CUsers%5CChef%5CPhotos%5Cimg.jpg`.

When parsed with `new URL()`:
- `url.pathname` = `"/C%3A%5CUsers%5CChef%5CPhotos%5Cimg.jpg"` (note the **leading `/`**)

Then:
```typescript
const requested = path.resolve(decodeURIComponent(url.pathname));
```

`decodeURIComponent(url.pathname)` = `"/C:\Users\Chef\Photos\img.jpg"` — note the **leading slash**. On Windows, `path.resolve("/C:\\Users\\...")` can produce unexpected results depending on the current working directory's drive letter. If the CWD is also on `C:`, it happens to work. But if it's on a different drive, `path.resolve` resolves `/C:\Users\...` relative to that drive's root.

**Fix:** Strip the leading slash before resolving:

```typescript
const raw = decodeURIComponent(url.pathname).replace(/^\//, "");
const requested = path.resolve(raw);
```

---

## 🔴 Bug #3 — No Image Viewer / Lightbox Exists

**The user says they "can't open the image viewer" — that's because there is no image viewer.**

There is no click handler on `Thumbnail` that opens a full-size image/video preview. The `cursor-pointer` class is applied to each thumbnail, suggesting an image viewer was planned, but **no lightbox, modal, or detail view component exists anywhere in the codebase**.

Clicking a thumbnail does nothing.

**Recommendation:** Implement a `MediaViewer` component — a fullscreen overlay that:
- Shows the full-resolution image or plays the video
- Supports left/right navigation (arrow keys + swipe)
- Shows file metadata (name, path, date, size)
- Has a close button (Escape key)
- Wire it to a `selectedFile` state in `App.tsx`

---

## 🟠 Additional Issues Found

### 4. `scanWorker` never explicitly exits — process leak + IPC hang

**File:** [scanWorker.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/scanWorker.ts#L42-L52)

```typescript
scanFolderStream(...)
  .then((total) => post({ type: "done", total }))
  .catch((err) => { ... });
```

After posting `{ type: "done" }`, the worker just sits there. The main process does `await once(child, "exit")` ([main.ts:247](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L247)), which will **hang forever** because the `utilityProcess` never calls `process.exit()`.

The `utilityProcess` stays alive as an orphan consuming memory. If the user scans multiple times, each scan forks a new worker that never dies, leaking processes.

**Fix:** Add `process.exit(0)` after the `.then()` / `.catch()`:

```typescript
scanFolderStream(...)
  .then((total) => { post({ type: "done", total }); process.exit(0); })
  .catch((err) => { post({ type: "error", message: ... }); process.exit(1); });
```

> [!CAUTION]
> Without this fix, `scan:start` IPC handler never resolves and the app effectively hangs after the first scan completes.

---

### 5. `onCancelled` action is defined but never dispatched

**File:** [useScanState.ts](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/hooks/useScanState.ts#L108) — defines `onCancelled`

**File:** [App.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L94-L101) — never calls it

```typescript
const cancelScan = useCallback(async () => {
  playClick();
  try {
    await window.scanAPI.cancelScan();
  } catch {
    // Best-effort
  }
}, [playClick]);
```

When the user clicks "Cancel", `cancelScan()` sends the IPC but the reducer status stays `"scanning"` until the worker posts `"done"`. The UI shows "SCAN CANCELLED" status text mapping, but the reducer state never transitions to `"cancelled"`.

**Fix:** Call `onCancelled()` after `cancelScan()`:

```typescript
await window.scanAPI.cancelScan();
onCancelled();
```

---

### 6. `onHover` prop is not passed to `Thumbnail` in `VirtualizedGrid`

**File:** [VirtualizedGrid.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/VirtualizedGrid.tsx#L221-L228)

```typescript
{rowData.files.map((file) => (
  <Thumbnail
    key={file.filePath}
    file={file}
    width={tileWidth}
    height={tileHeight}
    // ← onHover is missing!
  />
))}
```

The `Thumbnail` component was refactored to accept `onHover` as a prop (instead of calling `useSfx()` internally), but `VirtualizedGrid` never passes it. The `useSfx` import was removed from `Thumbnail`, so **no hover sound plays at all anymore** — a UX regression.

---

### 7. `indexHeaders` is dead code doing O(rows × headers) work

**File:** [App.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L22-L41)

```typescript
function indexHeaders(headers, totalRows) {
  const map = new Map();
  for (let row = 0; row < totalRows; row++) {
    let best;
    for (const h of headers) {
      if (h.startIndex <= row && ...) best = h;
    }
    if (best) map.set(row, best);
  }
  return map;
}
```

With 100k files / 5 columns = 20k rows and ~365 date groups, this runs ~7.3M iterations on every filter change. But the result is **never used** — [VirtualizedGrid.tsx:166](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/VirtualizedGrid.tsx#L166) does `void headerIndex;` (explicitly discards it).

**Recommendation:** Delete `indexHeaders` and remove the `headerIndex` prop entirely.

---

### 8. `ErrorBoundary` uses wrong type for `componentDidCatch`

**File:** [ErrorBoundary.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/ErrorBoundary.tsx#L28)

```typescript
componentDidCatch(error: Error, info: ErrorInterface): void {
```

React's `componentDidCatch` expects `(error: Error, errorInfo: React.ErrorInfo)`. The local `ErrorInterface` type is a subset. `ErrorInfo` is already imported on [line 1](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/ErrorBoundary.tsx#L1) but not used for this parameter.

---

### 9. Unnecessary `messageStringField` wrapper in `scan:start`

**File:** [main.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L206)

```typescript
const folder = messageStringField({ folderPath }, "folderPath");
```

This wraps the already-typed `folderPath: string` parameter in a new object just to validate it. Simpler:

```typescript
if (typeof folderPath !== "string" || !folderPath) return 0;
```

---

### 10. FolderTree `normalizePath` doesn't lowercase — mismatches scanner's `normPath`

**File:** [FolderTree.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/FolderTree.tsx#L27-L34) — does NOT lowercase

**File:** [scan.ts](file:///C:/Users/Chef/orca/projects/Wiergise/src/scanner/scan.ts#L43-L45) — DOES lowercase

The scanner stores `normPath` as lowercased. But FolderTree constructs its own node paths without lowercasing. When the folder filter in [App.tsx:179-183](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L179-L183) compares `selectedFolder` (from FolderTree, not lowercased) against `f.normPath` (from scanner, lowercased), the filter **will fail to match on case-sensitive string comparison**.

For example:
- FolderTree `selectedFolder`: `C:/Users/Chef/Photos`
- Scanner `normPath`: `c:/users/chef/photos/img.jpg`
- `normSel` = `C:/Users/Chef/Photos` (lowercased at line 179 → `c:/users/chef/photos`) ✓

Wait — [line 179](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L179) does `.toLowerCase()`:

```typescript
const normSel = selectedFolder.replace(/\\/g, "/").toLowerCase();
```

So the filter comparison itself is fine. But the FolderTree **displays** inconsistent paths internally, and if any other code compares without lowercasing, it will break. This is a latent consistency issue.

---

### 11. `allowedRoots.clear()` flashes old thumbnails as UNREADABLE

**File:** [main.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L204)

When starting a new scan, all previous roots are cleared. If the user is still viewing thumbnails from a previous scan of a **different** folder, those thumbnails will immediately 403. Minor UX issue.

---

### 12. `scan:start` handler always returns 0

**File:** [main.ts](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L250)

The `startScan` method's return type is `Promise<number>` (the total count), but the main process always returns 0. The actual count arrives via `scan:done`. Nobody reads the return value, but the type contract is misleading.

---

### 13. FolderTree `expandedPaths` stale after folder change

**File:** [FolderTree.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/FolderTree.tsx#L259-L261)

`useState` initializer runs only once. If `rootPath` changes (user picks a new folder), `expandedPaths` still contains only the **old** root's normPath. The new root won't be auto-expanded.

**Fix:** Add `useEffect` to auto-expand the new root:

```typescript
useEffect(() => {
  setExpandedPaths(prev => new Set([...prev, normRootPath]));
}, [normRootPath]);
```

---

### 14. `App.css` still exists but is no longer imported — dead file

The original `App.css` with `.app-container` class is still on disk but `App.tsx` no longer imports it. Safe to delete.

---

### 15. `tsconfig.json` references non-existent `src/vite-env.d.ts`

```json
"include": ["src/renderer", "src/scanner/types.ts", "src/vite-env.d.ts"]
```

No such file exists. Vite types are declared via `/// <reference>` in `global.d.ts`.

---

### 16. SFX system is still silent — no audio files configured

Unchanged from v1: `SoundManager.setConfig()` is never called, so all `playClick()`, `playHover()`, `playScan()` calls are no-ops.

---

## Summary & Priority

### 🔴 Must Fix (Blocking User)

| # | Issue | Fix Effort |
|---|---|---|
| **1** | `pathToFileUrl()` missing triple-slash → all thumbnails fail | 1 line |
| **2** | `url.pathname` leading slash → path resolution may fail | 1 line |
| **4** | `scanWorker` never exits → process leak + app hang | 2 lines |

### 🟠 Should Fix (Broken Functionality)

| # | Issue | Fix Effort |
|---|---|---|
| **3** | No image viewer/lightbox component exists | New component |
| **5** | `onCancelled` never dispatched → cancel UI stuck | 1 line |
| **6** | `onHover` not passed → hover SFX regression | 2 lines |
| **7** | `indexHeaders` dead code doing O(n×h) work | Delete function |
| **10** | FolderTree normalization inconsistency | Audit and unify |
| **13** | `expandedPaths` stale after folder change | 3 lines |

### ⚪ Cleanup

| # | Issue |
|---|---|
| **8** | `ErrorBoundary` uses wrong type name |
| **9** | Needless `messageStringField` wrapper |
| **11** | `allowedRoots.clear()` flashes old thumbnails |
| **12** | `scan:start` return value always 0 |
| **14** | Dead `App.css` file |
| **15** | Dangling `tsconfig.json` include |
| **16** | SFX never configured |

---

*Follow-up review for Wiergise Media Scanner v2. 16 issues identified, 3 are blocking the user's workflow.*
