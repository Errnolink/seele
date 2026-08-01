# WIERGISE MEDIA SCANNER // CODEBASE AUDIT & ENHANCEMENT REPORT

**Audited Date:** August 1, 2026  
**Audited Target:** `Wiergise Media Scanner` (Electron + React + TypeScript + Vite)  
**Report Scope:** Comprehensive audit of Performance, Layout/Virtualization, UI/UX, Architecture, and Dead Code Analysis across Main, Worker, and Renderer processes.

---

## Executive Summary

Wiergise is an Electron-based high-performance local media scanner and browser featuring a custom NERV/EVA cyberpunk tactical UI theme. While the foundational streaming two-phase scanner and LRU-cached thumbnail pipeline are well-engineered, a rigorous code-level audit revealed **several critical layout bugs, performance bottlenecks, UX friction points, and over 40 KB of dead legacy code** left over from the UI redesign.

### Key Audit Findings at a Glance
1. **Critical Layout Bug (Severity: HIGH):** `GridView` and `ListView` in [MasonryGrid.tsx](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx) lack a fixed scroll container height (`totalHeight`) and top/bottom spacer rows. When scrolling down, virtualized DOM removal causes remaining rows to jump to the top of the container, breaking scrolling in both views.
2. **Performance Bottleneck (Severity: MEDIUM-HIGH):** Toggling a favorite star in normal views triggers a full re-filter, re-sort, and re-group of up to 50,000 files in [App.tsx:L407-L512](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L407-L512) because `favorites` is included in the `useMemo` dependency array for all filter modes.
3. **Synchronous Disk I/O in Worker (Severity: MEDIUM):** During Phase 2 metadata patching, every image file undergoes two synchronous disk calls (`statSync` and `imageSize()`) in [scanWorker.ts:L84-L94](file:///C:/Users/Chef/orca/projects/Wiergise/electron/scanWorker.ts#L84-L94).
4. **UI/UX Image Zoom Flicker (Severity: MEDIUM):** Lightbox image zooming in [MediaViewer.tsx:L386-L390](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MediaViewer.tsx#L386-L390) switches the `<img>` tag `src` from `?w=2560` to raw full-resolution, causing a blank/flashing reload when double-clicking or zooming.
5. **Dead Code & Bundle Bloat (Severity: MEDIUM):** Nine legacy component files (`FolderTree`, `VirtualizedGrid`, `GroupControls`, etc.) totaling **~40.6 KB** and an unconfigured SFX Web Audio synthesizer remain unused in `src/renderer/components/` and `src/renderer/sfx/`.

---

## 1. Performance Issues & Optimizations

### [P-1] `useMemo` Dependency Blowup on Favorite Toggles
- **Location:** [App.tsx:L407-L512](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L407-L512)
- **Severity:** Medium-High
- **Description:**  
  The primary data pipeline (`derivedFiles`, `groups`, `resultCount`) is wrapped in a single `useMemo` whose dependency array includes `[files, selectedFolder, typeFilter, favorites, debouncedQuery, groupMode, sortMode, sortDir]`.
  
  ```ts
  const { derivedFiles, groups, resultCount } = useMemo(() => {
    // 1. Folder filter -> 2. Type / favorite filter -> 3. Search -> 4. Sort -> 5. Group
    ...
  }, [files, selectedFolder, typeFilter, favorites, debouncedQuery, groupMode, sortMode, sortDir]);
  ```
  
  When `typeFilter !== "favorite"`, `favorites` is **not used anywhere in the filtering or grouping logic**, yet any change to the `favorites` Set (e.g., clicking the star icon on a card) forces React to re-run the entire pipeline across all 25,000–50,000 media files.
- **Actionable Recommendation:**  
  Split the memoized pipeline into two stages: (1) base filtering, searching, sorting, and grouping (without `favorites`), and (2) a lightweight secondary filter that only applies when `typeFilter === "favorite"`.
  
  ```diff
  -  }, [files, selectedFolder, typeFilter, favorites, debouncedQuery, groupMode, sortMode, sortDir]);
  +  }, [files, selectedFolder, typeFilter === "favorite" ? favorites : null, typeFilter, debouncedQuery, groupMode, sortMode, sortDir]);
  ```

---

### [P-2] Synchronous `imageSize()` Disk Calls in Worker Phase 2
- **Location:** [scanWorker.ts:L84-L94](file:///C:/Users/Chef/orca/projects/Wiergise/electron/scanWorker.ts#L84-L94) & [scan.ts:L289-L310](file:///C:/Users/Chef/orca/projects/Wiergise/src/scanner/scan.ts#L289-L310)
- **Severity:** Medium
- **Description:**  
  In Phase 2 of streaming scans (`scanFolderStream`), the worker thread iterates through discovered files in chunks of 500. For each image file, it calls:
  1. `statSync(f.filePath)` (filesystem stat)
  2. `probeImageDimensions(f)` which invokes `imageSize(file.filePath)` synchronously from the `image-size` package.
  
  This results in **two synchronous file descriptor opens/reads per image file**. For 25,000 images, 50,000 synchronous I/O calls occur in the utility process, delaying Phase 2 completion on HDDs or network shares.
- **Actionable Recommendation:**  
  Make image dimension probing **lazy on viewport intersection** (letting `sharp` report `naturalWidth`/`naturalHeight` when the thumbnail renders, which is already persisted via `scan:saveDimensions` in [main.ts:L484-L490](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L484-L490)), or use asynchronous file descriptor reuse to read the header buffer once during statting.

---

### [P-3] Unnecessary Filesystem `stat()` on Every Resized Thumbnail Request
- **Location:** [main.ts:L215-L216](file:///C:/Users/Chef/orca/projects/Wiergise/electron/main.ts#L215-L216)
- **Severity:** Low-Medium
- **Description:**  
  In `serveResized(requested, w)` (`media://local/` custom scheme handler), before calling `sharp(requested)`, an async `stat` is awaited:
  ```ts
  const stat = await fs.promises.stat(requested);
  if (stat.size > 64 * 1024 * 1024) return null;
  ```
  Since `serveResized` is invoked for every thumbnail cache miss when scrolling through the gallery, calling `fs.promises.stat` adds filesystem latency before libvips can begin streaming the header.
- **Actionable Recommendation:**  
  Remove the redundant stat check or pass the file size from the renderer as a query parameter (`?w=512&s=12345`) since the renderer already knows `file.sizeBytes` from Phase 2 metadata.

---

### [P-4] O(N) Linear Visibility Scanning Inside Scroll rAF
- **Location:** [MasonryGrid.tsx:L597-L609](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L597-L609)
- **Severity:** Medium
- **Description:**  
  In `MasonryView`, `visibleTiles` recomputes on every scroll frame (throttled by `requestAnimationFrame`) by linearly scanning all tiles across all sections:
  ```ts
  for (const s of sections) {
    for (const tile of s.tiles) {
      const absY = s.offsetY + headerOffset + tile.y - headerOffset;
      if (absY + tile.height >= top && absY <= bottom) {
        out.push({ tile, y: absY });
      }
    }
  }
  ```
  For 25,000 tiles, checking bounds in a flat JavaScript loop takes ~1–3 ms per frame.
- **Actionable Recommendation:**  
  Because `tile.y` values in each masonry section are monotonically increasing within each column, implement a **binary search** (`O(log N)`) or partition tiles into vertical 500px spatial buckets during masonry packing so `visibleTiles` only checks tiles in the active viewport buckets.

---

## 2. Layout & Virtualization Defects

### [L-1] CRITICAL BUG: Broken Virtualization & Scroll Jump in `GridView` and `ListView`
- **Location:** [MasonryGrid.tsx:L746-L774](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L746-L774) (`GridView`) & [MasonryGrid.tsx:L879-L925](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L879-L925) (`ListView`)
- **Severity:** High (Broken Core Functionality)
- **Description:**  
  `MasonryView` correctly wraps tiles in an absolutely positioned container with `style={{ height: `${totalHeight}px` }}` ([MasonryGrid.tsx:L619](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L619)). However, `GridView` and `ListView` do **not** use absolute positioning or a `totalHeight` container:
  - `GridView` renders rows in a standard CSS grid: `<div className="grid gap-3">`
  - `ListView` renders rows in an HTML table: `<tbody>{visible.rows.map(...)}</tbody>`
  
  Both views compute `visible.rows` using `[top, bottom]` slice windows without rendering top/bottom spacer elements (`<div style={{ height: topSpacerPx }} />`).
- **Impact:**  
  When a user scrolls down in Grid or List view:
  1. Rows above `scrollTop - OVERSCAN` are unmounted from the DOM.
  2. Because there is no top spacer height compensating for removed DOM nodes, the remaining visible rows **jump to the top of the container**.
  3. The container's scrollable height collapses, causing the scrollbar thumb to shrink and jump erratically.
- **Actionable Fix:**  
  Add a wrapper container with `style={{ height: `${totalHeight}px` }}` and apply absolute `top` positioning to each rendered row in `GridView` and `ListView` (or insert top/bottom spacer rows in the table/grid).
  
  ```tsx
  // Example Fix for GridView:
  <div className="relative w-full" style={{ height: `${sections[sections.length - 1]?.offsetY + sections[sections.length - 1]?.height || 0}px` }}>
    {visible.rows.map(({ section, rowIdx, y, files }) => (
      <div key={`${section.label}-${rowIdx}`} className="absolute left-0 right-0" style={{ top: `${y}px` }}>
        <FragmentRow files={files} ... />
      </div>
    ))}
  </div>
  ```

---

### [L-2] Misplaced Group Headers in `ListView`
- **Location:** [MasonryGrid.tsx:L881-L884](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L881-L884)
- **Severity:** Medium
- **Description:**  
  In `ListView`, when grouping is enabled (`groupMode !== "none"`), all visible group header bars are rendered stacked together at the very top of the list view:
  ```tsx
  <div className="flex flex-col gap-3">
    {showGroups &&
      visible.headers.map((h) => (
        <GroupLabel key={`hdr-${h.label}`} label={h.label} count={h.count} />
      ))}
    <div className="border border-nerv-border rounded overflow-hidden">
      <table className="w-full border-collapse text-xs font-mono">
  ```
  Group headers do not appear above their corresponding table sections; instead, all headers stack at the top of the page above a single continuous table.
- **Actionable Fix:**  
  Render a separate table per visible section, or render section header rows directly inside the table body:
  ```tsx
  <tr className="bg-nerv-panel/90 border-t border-nerv-orange/40">
    <td colSpan={8} className="py-2 px-3">
      <GroupLabel label={h.label} count={h.count} />
    </td>
  </tr>
  ```

---

### [L-3] Split View Inspector Overlap on Narrow Screens
- **Location:** [MasonryGrid.tsx:L351-L354](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L351-L354)
- **Severity:** Low-Medium
- **Description:**  
  In Split View (`viewMode === "split"`), `SPLIT_INSPECTOR_W = 320` is unconditionally subtracted from the container width. On application windows narrower than ~850px, this leaves under 450px for the masonry columns, compressing tiles and causing awkward text truncation in the inspector card.
- **Actionable Fix:**  
  Implement a responsive threshold in `MasonryGrid.tsx`: when `containerWidth < 850`, automatically render the inspector as a bottom drawer or floating modal instead of an inline right sidebar.

---

### [L-4] Redundant Offset Calculation in `MasonryView`
- **Location:** [MasonryGrid.tsx:L602](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L602)
- **Severity:** Low (Code Cleanliness)
- **Description:**  
  In `MasonryView`, tile absolute Y-coordinate is calculated as:
  ```ts
  const absY = s.offsetY + headerOffset + tile.y - headerOffset;
  ```
  Since `tile.y` in `masonry` is initialized to `headerOffset` ([MasonryGrid.tsx:L378](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L378)), `+ headerOffset - headerOffset` cancels out mathematically.
- **Actionable Fix:**  
  Simplify to `const absY = s.offsetY + tile.y;`.

---

## 3. UI/UX Enhancements

### [U-1] Lightbox Image Reload Flicker on Zoom (`MediaViewer.tsx`)
- **Location:** [MediaViewer.tsx:L386-L390](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MediaViewer.tsx#L386-L390) & [MediaViewer.tsx:L488-L503](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MediaViewer.tsx#L488-L503)
- **Severity:** Medium (Visual Polish)
- **Description:**  
  In `MediaViewer`, when an image is displayed at default zoom (`zoom === 1`), `mediaUrl` points to `media://local/path?w=2560`. When the user double-clicks or zooms in (`zoom > 1`), `mediaUrl` switches to the raw file (`media://local/path`).
  
  Because the `src` attribute on the single `<img key={file.filePath} src={mediaUrl} />` changes dynamically, the browser clears the 2560px preview bitmap and displays a **flashing blank box** until the full-resolution image finishes loading from disk.
- **Actionable Recommendation:**  
  Render two layered image elements: keep the 2560px preview `<img>` visible as a background base layer, and overlay the full-resolution `<img>` on top with `opacity-0 transition-opacity` until its `onLoad` fires.
  
  ```tsx
  <div className="relative">
    {/* Base preview layer (always visible) */}
    <img src={`${toMediaUrl(file.filePath)}?w=2560`} className="..." style={zoomStyle} />
    {/* High-resolution detail layer (fades in when zoomed) */}
    {zoom > 1 && (
      <img src={toMediaUrl(file.filePath)} onLoad={() => setFullResLoaded(true)} className={`absolute inset-0 ... ${fullResLoaded ? "opacity-100" : "opacity-0"}`} style={zoomStyle} />
    )}
  </div>
  ```

---

### [U-2] Multi-Selection Batch Action Toolbar Expansion
- **Location:** [App.tsx:L814-L839](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L814-L839)
- **Severity:** Medium (Feature Utility)
- **Description:**  
  When multiple items are selected (`selectedIds.size > 0`), the floating bottom toolbar in `App.tsx` only offers two actions: **"Toggle Favorite"** and **"Clear Selection"**.
- **Actionable Recommendation:**  
  Expand the batch toolbar with power-user media operations supported by the existing Electron IPC bridge:
  1. **Copy Paths (`Ctrl+Shift+C`):** Write new-line-separated file paths to the clipboard via `window.scanAPI.writeClipboard()`.
  2. **Open in Native File Manager:** Call `window.scanAPI.showItemInFolder()` on the primary selection.
  3. **Invert Selection:** Select all currently unselected items in `derivedFiles`.
  4. **Select All (`Ctrl+A`):** Quick select button for the active filtered view.

---

### [U-3] Missing Global Keyboard Shortcuts (`Ctrl+A`, `Ctrl+Shift+A`)
- **Location:** [App.tsx:L337-L404](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/App.tsx#L337-L404)
- **Severity:** Low-Medium
- **Description:**  
  The keyboard handler supports `Ctrl+K` (Command Palette), `Ctrl+O` (Open Folder), `Ctrl+Enter` (Start Scan), `?` (Keyboard Help), and `Esc`, but lacks standard desktop file-browser shortcuts.
- **Actionable Recommendation:**  
  Add keyboard listeners in `App.tsx`:
  - `Ctrl+A` / `Cmd+A`: Select all files in `derivedFiles` (`setSelectedIds(new Set(derivedFiles.map(f => f.filePath)))`).
  - `Ctrl+Shift+A` / `Cmd+Shift+A`: Clear selection (`clearSelection()`).
  - `F2` / `F5`: Re-trigger scan on the current folder (`startScan()`).

---

### [U-4] Visual Fallback for Broken or Corrupt Thumbnails
- **Location:** [MasonryGrid.tsx:L129-L143](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L129-L143) (`MediaCard`)
- **Severity:** Low-Medium
- **Description:**  
  If `sharp` fails to decode a corrupt image or unsupported format, `serveResized` returns `null` and falls back to streaming raw bytes. If the raw stream also fails in the renderer, `MediaCard` remains stuck in its `<div className="shimmer absolute inset-0" />` loading state indefinitely.
- **Actionable Recommendation:**  
  Add an `onError` handler to the `<img>` tag in `MediaCard` to render a styled NERV amber/red fallback indicator:
  
  ```tsx
  {error ? (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-nerv-panel border border-nerv-red/40 text-nerv-red gap-1">
      <span className="font-mono text-[10px] font-bold">UNREADABLE</span>
      <span className="text-[9px] text-nerv-muted truncate max-w-[80%]">{file.fileType.toUpperCase()}</span>
    </div>
  ) : ( ... )}
  ```

---

### [U-5] Clickable Table Column Headers in List View
- **Location:** [MasonryGrid.tsx:L889-L898](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/components/MasonryGrid.tsx#L889-L898)
- **Severity:** Low
- **Description:**  
  Table column headers (`<th>`) in `ListView` (File Name, Type, Dimensions, Size, Date) are non-interactive static elements.
- **Actionable Recommendation:**  
  Wire `<th>` click handlers to `onSortModeChange` (`name`, `date`, `size`, `resolution`) and toggle `sortDir` when clicking the currently active sort column.

---

### [U-6] Activate Audio Feedback Synthesizer (`SoundManager.ts`)
- **Location:** [SoundManager.ts:L1-L7](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/sfx/SoundManager.ts#L1-L7) & [useSfx.ts](file:///C:/Users/Chef/orca/projects/Wiergise/src/renderer/sfx/useSfx.ts)
- **Severity:** Low (Delight & Theme Fidelity)
- **Description:**  
  A custom NERV tactical sound effects manager is implemented in `src/renderer/sfx/SoundManager.ts`, but an explicit `@TODO` notes that `setConfig` is never invoked, leaving all sound effects silent across the application.
- **Actionable Recommendation:**  
  Synthesize subtle Web Audio API sci-fi bleeps/clicks directly in `SoundManager.ts` (using `AudioContext` oscillators instead of external MP3 URLs) so tactile audio feedback works out-of-the-box without requiring external audio assets.

---

## 4. Codebase Hygiene & Dead Code Analysis

A comprehensive audit of `src/renderer/` identified **11 legacy files totaling ~45.5 KB** that are never imported or used anywhere in the active application. These files represent dead code from earlier iterations prior to the NERV/EVA UI redesign.

| File Path | Size | Reason Unused | Recommendation |
| :--- | :---: | :--- | :--- |
| `src/renderer/components/FolderTree.tsx` | 13,895 B | Superseded by `Sidebar.tsx` (`DirectoryExplorer` & `FolderTreeNode`) | **Delete** |
| `src/renderer/components/FolderTree.css` | 457 B | Styles for unused `FolderTree.tsx` | **Delete** |
| `src/renderer/components/VirtualizedGrid.tsx` | 13,164 B | Superseded by `MasonryGrid.tsx` | **Delete** |
| `src/renderer/components/VirtualizedGrid.css` | 706 B | Styles for unused `VirtualizedGrid.tsx` | **Delete** |
| `src/renderer/components/Thumbnail.tsx` | 8,280 B | Superseded by `MediaCard` inside `MasonryGrid.tsx` | **Delete** |
| `src/renderer/components/GroupControls.tsx` | 1,317 B | Replaced by `EvaSegmented` in `Header.tsx` | **Delete** |
| `src/renderer/components/SortControls.tsx` | 2,189 B | Replaced by `EvaSegmented` in `Header.tsx` | **Delete** |
| `src/renderer/components/SearchBar.tsx` | 2,053 B | Replaced by inline search field in `Header.tsx` | **Delete** |
| `src/renderer/components/HexGridOverlay.tsx` | 816 B | Unused visual experiment | **Delete** |
| `src/renderer/sfx/SoundManager.ts` | 4,013 B | Unwired audio manager | **Keep & Enable** (see U-6) |
| `src/renderer/sfx/useSfx.ts` | 880 B | Unwired audio hook | **Keep & Enable** (see U-6) |

**Total Dead Code to Clean Up:** **~42.3 KB** across 9 files. Removing these will noticeably reduce bundle size, eliminate IDE autocomplete clutter, and simplify future maintenance.

---

## 5. Prioritized Action Roadmap

### Phase 1: Critical Bug Fixes (Immediate)
1. **Fix GridView & ListView Virtualization ([L-1]):**
   - In `MasonryGrid.tsx`, wrap `GridView` and `ListView` in a container with `style={{ height: `${totalHeight}px` }}`.
   - Use absolute positioning for row windows or add top/bottom spacer rows so scrolling down does not collapse the scrollbar thumb.
2. **Fix ListView Group Header Stacking ([L-2]):**
   - Interleave group headers with their respective table rows in `ListView`.
3. **Fix Favorite Toggle Performance Blowup ([P-1]):**
   - In `App.tsx`, detach `favorites` from the primary `useMemo` dependency array unless `typeFilter === "favorite"`.

### Phase 2: UX & Visual Polish (Short-Term)
1. **Eliminate Lightbox Image Zoom Flicker ([U-1]):**
   - In `MediaViewer.tsx`, layer the 2560px preview under the full-resolution image during zooming.
2. **Add Corrupt/Unreadable Image Error State ([U-4]):**
   - In `MediaCard`, add an `onError` fallback badge so unreadable images do not shimmer indefinitely.
3. **Expand Batch Selection Bar & Keyboard Shortcuts ([U-2], [U-3]):**
   - Add `Ctrl+A` / `Ctrl+Shift+A` keyboard shortcuts and wire up "Copy Paths", "Open in File Manager", and "Invert Selection" to the bottom floating bar.

### Phase 3: Architecture Hygiene & Deep Performance (Medium-Term)
1. **Clean Up 42 KB of Dead Legacy Components ([C-1]):**
   - Remove `FolderTree.*`, `VirtualizedGrid.*`, `Thumbnail.tsx`, `GroupControls.tsx`, `SortControls.tsx`, `SearchBar.tsx`, and `HexGridOverlay.tsx`.
2. **Optimize Worker Phase 2 Disk I/O ([P-2]):**
   - Defer synchronous `imageSize()` calls until thumbnails enter the viewport or optimize header buffer reuse during Phase 2 statting.
3. **Activate Web Audio Synthesizer SFX ([U-6]):**
   - Enable `SoundManager.ts` with lightweight synthesized audio cues for hover, click, and scan completion.

---

## Conclusion

Wiergise possesses a visually stunning cyberpunk aesthetic and an impressive streaming architecture. Addressing the **GridView/ListView virtualization container height bug ([L-1])**, **memoization dependency leak ([P-1])**, and **cleaning up 42 KB of dead code ([C-1])** will elevate the codebase's structural integrity to match its premium UI/UX design.
