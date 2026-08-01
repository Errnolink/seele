# WIERGISE // NERV Media Scanner — UI/UX Documentation (v2.7)

> **Current state:** This document reflects the codebase as of v2 commit `91e0f55`.  
> **Source of truth:** The code in `src/renderer/` and `electron/`. This document describes what exists.

---

## 1. Overview

Wiergise is a **tactical media organization workstation** — scan folders of images and videos at scale, browse them in virtualized masonry/grid/list views, and organize files via move/trash/rename/drag-to-folder. Built with Electron + React + TypeScript + Vite.

**Core capabilities:**
- Scan 25k+ files with streaming batch loading, dimension probing, and cache persistence
- Four view modes: masonry (variable-height), grid (uniform), list (detail rows), split (grid + inspector)
- File operations: move (in-app folder tree dialog), trash (OS recycle bin), rename, drag-to-sidebar-folder
- Custom frameless title bar with NERV-styled window controls
- Activity log panel tracking session operations
- Command palette, keyboard shortcuts, analytics dashboard

---

## 2. App Shell Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar (h-8) — drag region + status + min/max/close    z-40        │
├──────────────────────────────────────────────────────────────────────┤
│ Header (h-12 row 1 + flex-wrap row 2 control strip)      z-30        │
├──────────┬───────────────────────────────────────────────────────────┤
│ Sidebar  │  Main Content                                            │
│ w-64     │  - MasonryGrid / GridView / ListView / SplitView          │
│ (collap- │  - Virtualized via rAF scroll + overscan                  │
│  sible)  │  - Idle state when no scan loaded                         │
│          │                                                          │
├──────────┴───────────────────────────────────────────────────────────┤
│ Floating overlays (z-40/50):                                         │
│   Batch toolbar (bottom-center) · Activity log (bottom-right)       │
│   ContextMenu · MoveDialog · MediaViewer · Modals                   │
└──────────────────────────────────────────────────────────────────────┘
```

**TitleBar** (`components/TitleBar.tsx`):
- Frameless window (`frame: false` in BrowserWindow)
- `WebkitAppRegion: "drag"` makes the bar draggable; window controls use `"no-drag"`
- Left: status dot (lime pulse) + folder path or "AWAITING DIRECTORY INPUT"
- Right: SVG minimize/maximize/close buttons via `window.scanAPI.winMinimize/winMaximize/winClose`

**Header** (`components/Header.tsx`):
- Row 1 (`h-12`): sidebar toggle, brand block (logo + WIERGISE + v2.5 + subtitle), folder breadcrumb, scan button, search box, analytics/palette/help buttons, live clock
- Row 2 (flex-wrap): VIEW / FILTER / GROUP / SORT segmented controls, sort direction toggle, tile size slider, RESULT counter
- Row 2 uses `flex flex-wrap` — controls reflow to multiple lines on narrow windows (no scrollbar)

---

## 3. Design Tokens

### 3.1 Color Palette (Tailwind v4 `@theme`)

| Token | Hex | Semantic role |
|---|---|---|
| `nerv-bg` | `#07080c` | App background |
| `nerv-panel` | `#0d0f17` | Panel/container background |
| `nerv-panel-2` | `#141724` | Raised surfaces (inputs, hover rows) |
| `nerv-border` | `#1e2235` | Default hairline border |
| `nerv-orange` | `#ff5500` | Primary ring accent, card selection |
| `nerv-amber` | `#ffb700` | Gold accent, favorites, active tabs |
| `nerv-cyan` | `#00f0ff` | Images, image stats |
| `nerv-green` | `#10b981` | Videos, success |
| `nerv-red` | `#ef4444` | Errors, destructive actions |
| `nerv-purple` | `#7c3aed` | EVA chrome structure (header, sidebar) |
| `nerv-lime` | `#a3e635` | EVA phosphor text, status, drag-drop targets |
| `nerv-text` | `#f1f5f9` | Primary text |
| `nerv-muted` | `#64748b` | Secondary text, icons |

### 3.2 Typography

- **Font:** `'JetBrains Mono'` for everything; `'Orbitron'` for display headings
- Base: `13px` on body
- Sizes: `text-[9px]` micro labels → `text-[10px]` table cells → `text-[11px]` tree/filter → `text-xs` UI → `text-sm` titles
- `uppercase tracking-widest` for section labels
- `tabular-nums` on all numeric readouts

### 3.3 Scrollbars (new in v2.7)

Custom NERV-styled scrollbars defined in `index.css`:
- 8px wide, dark track (`rgba(10, 8, 20, 0.6)`)
- Orange thumb (`rgba(255, 85, 0, 0.25)`) → brightens on hover
- `scrollbar-width: thin` for Firefox compatibility

### 3.4 Ticket / Bevel Design System

All control chrome uses `clip-path` polygon shapes:
- `.eva-ticket` — chamfered top-right + bottom-left corners (tabs, chips, buttons)
- `.eva-corner` — single top-right chamfer (logo block, search field)
- `.eva-fill-{amber,purple,lime,cyan,green,red}` — 3-stop gradient bevels with inset highlights
- `.eva-segbar` — segmented ratio bar (storage telemetry, analytics distribution)
- `.eva-slider` — range slider styled to match ticket frame
- `.phosphor-*` — text glow classes (single ~30% 4px shadow per text node)

---

## 4. Component Inventory

| Component | File | Purpose |
|---|---|---|
| **TitleBar** | `TitleBar.tsx` | Frameless drag region + window controls |
| **Header** | `Header.tsx` | Brand, folder, scan, search, view/filter/sort controls |
| **Sidebar** | `Sidebar.tsx` | Quick views, directory tree, storage telemetry, drag-drop target |
| **MasonryGrid** | `MasonryGrid.tsx` | Content presenter: MasonryView, GridView, ListView, SplitView |
| **MediaViewer** | `MediaViewer.tsx` | Fullscreen lightbox with zoom/pan, filmstrip, file ops |
| **ContextMenu** | `ContextMenu.tsx` | Right-click menu (open, reveal, copy, move, rename, trash) |
| **MoveDialog** | `MoveDialog.tsx` | In-app folder tree picker with fuzzy search |
| **ActivityLog** | `ActivityLog.tsx` | Session operation history (move/trash/rename) |
| **CommandPalette** | `CommandPalette.tsx` | Ctrl+K fuzzy file finder |
| **AnalyticsModal** | `AnalyticsModal.tsx` | Storage/media stats with segmented distribution bar |
| **KeyboardHelp** | `KeyboardHelp.tsx` | Shortcut reference overlay |
| **BootSequence** | `BootSequence.tsx` | NERV-style boot animation |

---

## 5. File Operations (Core Feature)

### 5.1 Backend IPC (`electron/main.ts`)

| Handler | Purpose |
|---|---|
| `file:move` | Move single file to dest dir, collision-safe via `uniquePath()` |
| `file:moveBatch` | Batch move multiple files |
| `file:trash` | Send single file to OS recycle bin (`shell.trashItem`) |
| `file:trashBatch` | Batch trash |
| `file:rename` | Rename file (rejects path separators) |
| `folder:create` | Create new directory |
| `dialog:pickMoveTarget` | Native folder picker (unused in UI now, kept for API) |
| `win:minimize` / `win:maximize` / `win:close` | Window controls |

All file handlers gated through `isUnderAllowedRoot()` — blocks path traversal outside scanned directories.

### 5.2 Move Dialog (`MoveDialog.tsx`)

- Replaces the OS folder picker for all move operations
- Renders the library's own folder tree as a pickable list
- **Fuzzy search bar** — subsequence matching on folder names; flattens tree to filtered results while typing
- Two clicks to move: select folder → hit MOVE
- Keyboard: type to search, click to select

### 5.3 Drag-to-Folder

- Media tiles (cards + list rows) are `draggable`
- `onDragStart` selects the file if not already in selection
- Sidebar folder rows accept drops with visual highlight (`bg-nerv-lime/20 ring-1`) and "⇐ DROP" indicator
- Drop calls `moveFiles(selectedIds, folderPath)` then `onRemoveFiles`

### 5.4 Activity Log (`ActivityLog.tsx`)

- Collapsible panel in bottom-right corner
- Shows recent move/trash/rename operations with icon, action label, filename, detail
- "FAILED" badge for errored operations
- Session-scoped (cleared on app close)
- "CLEAR" button to wipe the list manually
- Capped at 50 entries

---

## 6. Views & Virtualization

All views in `MasonryGrid.tsx` use **absolute positioning inside a `totalHeight` container** with rAF-throttled scroll + 600px overscan.

### 6.1 Masonry View
- Variable-height tiles using probed `width`/`height` dimensions
- `aspectRatio` CSS for layout before image loads
- Columns calculated from container width / tile size slider

### 6.2 Grid View
- Uniform square tiles
- Same absolute-positioning scroll engine

### 6.3 List View
- Detail rows (thumbnail, name, type badge, date, size, resolution)
- Sticky column header
- Group headers interleaved at section offsets (not stacked at top)

### 6.4 Split View
- Grid on left, inspector panel on right
- Inspector shows full metadata for the inspected file

---

## 7. MediaViewer (Lightbox)

- **Two-tier image loading:** 2560px preview layer (instant) + full-res layer (fades in on zoom > 1)
- **Adjacent image preload:** prev+next 2560px previews preloaded via `new Image()` for instant arrow-key navigation
- **Zoom/pan:** wheel to zoom (1×–8×), drag to pan, double-click to toggle
- **Filmstrip:** horizontal scrollable thumbnails at bottom, click for O(1) jump
- **File operations in toolbar:** Move (⇥), Rename (✎), Trash (⌫) buttons in the top bar
- **Video:** `preload="auto"` for smoother playback
- **Controls auto-hide:** mouse idle 3s → controls fade out; mousemove → fade in

---

## 8. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+O` | Pick folder |
| `Ctrl/Cmd+Enter` | Start scan |
| `Ctrl/Cmd+K` | Command palette |
| `?` | Toggle keyboard help |
| `Esc` | Close topmost overlay → clear selection → clear folder filter |
| `Delete` | Trash selected files |
| `M` | Move selected files (opens MoveDialog) |
| `F2` | Rename single selected file |

**In MediaViewer:**

| Shortcut | Action |
|---|---|
| `←` / `→` | Previous / next file |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |
| `Esc` | Close viewer |

---

## 9. Sidebar

### 9.1 Quick Views
- ALL FILES / IMAGES / VIDEOS / STARRED — ticket-style segmented buttons with counts
- Clicking applies a type filter; clicking active clears it

### 9.2 Directory Explorer
- Recursive folder tree built from `buildFolderTree(files, rootPath)`
- **Counts aggregate from children** — parent folders show total descendant file count
- Click: select folder (filters view); click again: deselect
- **Double-click:** expand/collapse if folder has children
- Drag target: accepts file drops for move operations
- Expand/collapse all buttons, directory filter input

### 9.3 Storage Telemetry
- Segmented ratio bar (`eva-segbar`): cyan images + green videos
- Total size, IMG/VID counts with phosphor glow
- "MAGI.LINK NOMINAL" status indicator with pulsing lime dot

---

## 10. State Management

### 10.1 useScanState Hook (`hooks/useScanState.ts`)

Reducer-based scan lifecycle:
- `idle` → `scanning` → `done` / `cancelled` / `error`
- Actions: `start`, `batch`, `metaBatch`, `progress`, `done`, `cancelled`, `error`, `removeFiles`
- `removeFiles`: filters all file batches by path set, updates count
- Exposes `onRemoveFiles(Set<string>)` for post-operation state cleanup

### 10.2 App-Level State (`App.tsx`)

- `files`, `favorites`, `selectedIds`, `selectedFolder`, `searchQuery`
- `viewerIndex`, `contextMenu`, `moveDialogPaths`, `activityLog`
- Derived data pipeline (`useMemo`): folder filter → type filter → favorites filter → search filter → group → sort

---

## 11. Performance Constraints

- **Virtualization:** rAF-throttled scroll with 600px overscan on all views
- **Thumbnail URLs:** `media://local/<path>?w=<tileWidth>` — sharp resizes on main process (4-concurrency semaphore)
- **LRU thumbnail cache:** 150 entries in `mediaCache.ts`
- **Image dimension probing:** `image-size` reads headers only (no full decode) in scan worker thread
- **Adjacent image preload:** viewer preloads ±1 images at 2560px
- **Batch dispatching:** coalesced via rAF to avoid render thrashing on 25k files

---

## 12. IPC Bridge (`electron/preload.ts`)

`window.scanAPI` exposes:
- Scan: `selectFolder`, `startScan`, `cancelScan`, `loadCachedFiles`, `hasCachedFiles`, `saveDimensions`
- Media: `toMediaUrl`, `showItemInFolder`, `openPath`, `writeClipboard`
- File ops: `moveFile`, `moveFiles`, `trashFile`, `trashFiles`, `renameFile`, `createFolder`, `pickMoveTarget`
- Window: `winMinimize`, `winMaximize`, `winClose`

---

## 13. Analytics Dashboard (`AnalyticsModal.tsx`)

- Stat cards: total files, total size, avg file size, video/image count
- **Segmented distribution bar** (`eva-segbar`) — matches sidebar telemetry style with tick marks + phosphor glow legend
- Top 5 largest files with click-to-open in viewer

---

*End of documentation. Run `npm run dev` to see the live state.*
