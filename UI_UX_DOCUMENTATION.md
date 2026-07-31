# Wiergise Media Scanner — UI/UX Documentation

*Generated from source of truth: `theme.css`, `index.css`, `App.tsx`, all `components/*.tsx`.*

---

## 1. Design Language — NERV × Cyberpunk

The entire UI recreates a tactical control-room aesthetic inspired by NERV/MAGI terminals from Neon Genesis Evangelion. Every surface, accent, and animation reinforces a "military-grade media monitoring station" feel.

### 1.1 Color Palette (Tailwind v4 `@theme` tokens)

| Token | Hex | Semantic Role |
|---|---|---|
| `nerv-bg` | `#0a0a0c` | Deep tactical black — app background |
| `nerv-panel` | `#14151c` | Gunmetal container/panel background |
| `nerv-panel-2` | `#1c1d26` | Raised panel (buttons, inputs) |
| `nerv-border` | `#2a2b36` | Default hairline borders |
| `nerv-orange` | `#ff5500` | NERV emergency orange — primary accent (wordmark, scan, active states) |
| `nerv-amber` | `#ffaa00` | Warning/close text, scan progress |
| `nerv-cyan` | `#00f0ff` | Cyberpunk active state (image type, sort) |
| `nerv-green` | `#39ff14` | Cyberpunk terminal green (video type, success) |
| `nerv-text` | `#e6edf3` | Primary text |
| `nerv-muted` | `#6b7280` | Secondary/muted text |

Opacity modifiers work on all tokens: `bg-nerv-orange/30`, `text-nerv-muted/60`, etc.

### 1.2 Typography

| Font Class | Stack | Usage |
|---|---|---|
| `font-mono` (default body) | JetBrains Mono → Share Tech Mono → ui-monospace → Consolas | All UI text, metadata, labels |
| `font-display` | Orbitron → JetBrains Mono → system-ui | Wordmark, section titles, "File Viewer" header |

Base font size: `14px` on `body`. Bundled via `@fontsource/orbitron` and `@fontsource/jetbrains-mono`.

### 1.3 Animations (CSS keyframes)

| Class | Duration | Effect |
|---|---|---|
| `animate-scanline` | 4s linear ∞ | Vertical sweep line across overlays |
| `animate-pulse-glow` | 1.6s ease ∞ | Pulsing box-shadow glow (active group button) |
| `animate-blink` | 1s steps(2) ∞ | Opacity blink (status dot) |
| `animate-boot-glitch` | 0.5s steps(3) | Matrix-style clip-path glitch on boot |
| `animate-scanline-bar` | 1.4s ease ∞ | Horizontal progress bar sweep |
| `animate-nerv-shimmer` | 1.8s ease ∞ | Shimmer skeleton placeholder |
| `animate-viewer-enter` | 0.2s ease-out | Scale+fade entry for lightbox |

### 1.4 Atmosphere

- **CRT noise texture**: `body::before` overlay at 3% opacity — inline SVG fractal noise (`feTurbulence baseFrequency=0.65`). Always present, non-interactive.
- **Scanline overlay**: Inside the media viewer, a `pointer-events-none` gradient sweeps vertically (`animate-scanline`) at `nerv-orange/[0.03]` opacity.
- **Corner ticks**: 4 L-shaped `nerv-orange/40` brackets at viewer corners — targeting reticle aesthetic.

---

## 2. Window Chrome

### 2.1 Frameless Titlebar (`titleBarOverlay`)

Electron `BrowserWindow` config:
```
titleBarStyle: "hidden"
titleBarOverlay: { color: "#0a0a0a", symbolColor: "#e0530a", height: 48 }
```

- **48px overlay** on Windows reserves the right ~138px for native min/max/close caption buttons.
- **`.titlebar-drag`** (`-webkit-app-region: drag`) on header containers makes them window-drag handles.
- **`.no-drag`** (`-webkit-app-region: no-drag`) on interactive elements (buttons, inputs) opts them out of dragging.
- Both the **main header Row 1** and the **viewer top bar** reserve `paddingRight: 160px` (inline style) to clear the caption button area.

---

## 3. Layout Architecture

### 3.1 Root Structure (`App.tsx`)

```
┌─────────────────────────────────────────────────────┐
│ Header (h-12 + h-7 status strip)                    │ ← titlebar-drag, paddingRight:160px
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │ Main Grid Area                           │
│ 240px    │ (flex-1, overflow-hidden)                │
│ (collap- │                                          │
│  sible)  │                                          │
│          │                                          │
│ Folder   │  VirtualizedGrid (masonry)               │
│ Tree     │                                          │
│          │                                          │
├──────────┴──────────────────────────────────────────┤
│ [Viewer overlay — fixed inset-0 z-50 when open]     │
└─────────────────────────────────────────────────────┘
```

### 3.2 Header (2 rows)

**Row 1** (`h-12`, `no-drag`, `paddingRight: 160px`):
- **Wordmark**: Blinking orange dot + "Wiergise" (font-display) + "media scanner" subtitle. Separated by right border.
- **Folder + Scan actions**: "Open/Change" button (folder picker), "Scan" button (orange, disabled without folder), "Cancel" button (amber border, scan-in-progress only).
- **Search bar**: Fills remaining space. Shows `resultCount / totalCount`.
- **Filters**: GroupControls, SortControls, grid density slider.

**Row 2** (`h-7`, status strip, `font-mono text-[10px]`):
- Folder path (`ROOT D:\path\...`) or "No folder selected".
- Inline progress bar (animated scanline-bar) when scanning.
- Status: "N files found" (amber) or "SCAN COMPLETE · N FILES" (green) + image/video/size breakdown.

**Error banner** (conditional, `h-7`):
- Amber text on `nerv-amber/5` background with top border.

### 3.3 Sidebar (`240px`, collapsible)

- **Collapse toggle**: Absolute-positioned 20×40px button at the sidebar boundary. Arrow points left (open) or right (collapsed). Slides with `left: sidebarOpen ? 240px : 0`.
- **Navigation header**: "NAVIGATION" label + "Clear" button (when folder selected).
- **FolderTree**: Virtualized recursive tree of scanned directories. Each node shows folder name + file count (tiered colors). Expand/collapse all buttons.

### 3.4 Main Grid (`VirtualizedGrid`)

- **Masonry layout**: Greedy shortest-column packer distributes tiles across N columns. Each tile preserves its natural aspect ratio (from scanner dimension headers). No cropping.
- **Column count**: Derived from `containerWidth / targetColumnWidth`, clamped to `MIN_COLUMN_WIDTH` (140px).
- **Virtualization**: Only tiles within viewport ± 600px overscan are mounted. Scroll position tracked via rAF-throttled `onScroll`.
- **Group sections**: Optional group headers (32px height) when grouping by date/type.
- **Scroll-to-top button**: Floating button appears after scrolling.

**Density slider** controls `targetColumnWidth` (100–400px range, default 180).

---

## 4. Components

### 4.1 Thumbnail (`Thumbnail.tsx`)

Memoized (`React.memo`) grid tile.

- **Image thumbnails**: Request server-side downscaled JPEG via `?w=` param (`Math.min(512, Math.max(128, round(width * 1.5)))`).
- **Video thumbnails**: `<video preload="metadata">` with play icon overlay.
- **Loading state**: NERV shimmer skeleton (`animate-nerv-shimmer`) until `onLoad` fires.
- **Error state**: Circle+exclamation icon + "UNREADABLE" text.
- **Hover effects**: Ring changes from `nerv-border/40` → `nerv-orange` (2px), shadow glow.
- **Type chip**: Top-right, `nerv-cyan` "IMG" or `nerv-green` "VID".
- **Hover metadata**: Slides up from bottom — filename + file size. Gradient overlay (`from-black/95`).
- **Dimension reporting**: `onLoad` reports `naturalWidth/Height` back to parent via `onDimensions` (coalesced).

### 4.2 MediaViewer (`MediaViewer.tsx`)

Fullscreen lightbox overlay (`fixed inset-0 z-50`, `animate-viewer-enter`).

**Layout**:
```
┌───────────────────────────────────────────┐
│ Top Bar (h-12, paddingRight:160px)        │ ← auto-hides on 2.5s mouse idle
│ "File Viewer" | 1/N | FIT/2.0× | Info | ✕ │
├───────────────────────────────────────────┤
│                                           │
│  ←    [   Media Image / Video   ]    →    │ ← arrows auto-hide with controls
│                                           │
│        [keyboard hints overlay]           │ ← auto-hides after 4s
├───────────────────────────────────────────┤
│ Metadata Panel (collapsible via "I")      │
│ File | Type | Size | Created              │
├───────────────────────────────────────────┤
│ Filmstrip (±50 windowed thumbnails)       │
└───────────────────────────────────────────┘
```

**Two-tier image loading**:
- `zoom === 1` (fit-to-screen): Requests `?w=2560` preview — a 9000px source decodes as ~15MB bitmap, not ~250MB.
- `zoom > 1`: Swaps to raw full-resolution file for pixel-accurate zoom detail.

**Zoom & Pan** (images only):
- Wheel zoom: Non-passive wheel listener, `ZOOM_STEP = 1.4`, clamped to `1× – 8×`.
- Double-click: Toggles between 1× and 2×.
- Drag-to-pan: Mouse down/move/up when `zoom > 1`. Cursor transitions `zoom-in` → `grab` → `grabbing`.
- Reset on file change (`useLayoutEffect` on `file.filePath`).

**Filmstrip**:
- Horizontal scrollable strip at bottom.
- Windowed: renders ±50 items around current index with spacer divs to preserve scroll position.
- Active item highlighted with `nerv-orange` ring.
- Auto-scrolls to center active item (`scrollIntoView` smooth).
- FilmstripThumb uses `?w=112` downscaled URL.

**Auto-hide chrome** (UX-17):
- Top bar, nav arrows, and hints fade out after 2.5s of mouse idle.
- Any mouse movement resets the timer.

**Controls**:
- Left/right arrows: Navigate (no wrap at boundaries).
- `+`/`=`/`-`/`_`/`0`: Zoom in/out/reset.
- `I`: Toggle metadata panel.
- `Esc`: Close viewer.
- Space: Play/pause (video only).

### 4.3 GroupControls (`GroupControls.tsx`)

Segmented button group: NONE | DATE CREATED | FILE TYPE.
- Active button: `bg-nerv-orange text-nerv-bg font-bold animate-pulse-glow`.
- `aria-pressed` on each button for accessibility.
- Inactive: transparent bg, `nerv-muted` → hover `nerv-amber`.

### 4.4 SortControls (`SortControls.tsx`)

SORT label + segmented buttons: AUTO | NAME | SIZE | DATE.
- Active button: `bg-nerv-cyan text-nerv-bg font-bold`.
- Direction toggle: ▲/▼ button (asc/desc), `aria-label="Toggle sort direction"`.
- `aria-pressed` on mode buttons.

### 4.5 SearchBar (`SearchBar.tsx`)

- Text input with placeholder "Search files...".
- Shows `resultCount / totalCount` chip.
- Debounced query (300ms via `useDebouncedValue`).

### 4.6 FolderTree (`FolderTree.tsx`)

- Recursive virtualized tree (`React.memo` on `FolderTree` and `TreeNodeRow`).
- Nodes show folder name + file count with tiered color intensity.
- Expand/collapse per node + global expand/collapse all.
- Click selects folder → filters grid to that subtree.

### 4.7 ContextMenu (`ContextMenu.tsx`)

Right-click menu on thumbnails. Items with SVG icons:
- Open with default app
- Show in file manager
- Open in viewer
- Copy file path
- Copy file name

### 4.8 KeyboardHelp (`KeyboardHelp.tsx`)

Modal panel toggled by `?` key. Lists all keyboard shortcuts.

### 4.9 BootSequence (`BootSequence.tsx`)

Matrix-style glitch animation (`animate-boot-glitch`) on app startup. Fades into the main UI.

### 4.10 ErrorBoundary (`ErrorBoundary.tsx`)

Catches renderer crashes. Shows "⚠ SYSTEM FAULT" with error message + "Reload Application" button.

### 4.11 HexGridOverlay (`HexGridOverlay.tsx`)

Decorative hexagonal grid overlay (NERV MAGI aesthetic).

---

## 5. Global Keyboard Shortcuts

### 5.1 App-level (when viewer is closed)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + O` | Open folder picker |
| `Ctrl/Cmd + Enter` | Start scan |
| `Ctrl/Cmd + F` | Focus search input |
| `?` | Toggle keyboard help panel |
| `Esc` | Clear search → clear folder selection |

### 5.2 Viewer-level (when viewer is open)

| Shortcut | Action |
|---|---|
| `←` / `→` | Previous / Next image |
| `+` / `=` | Zoom in |
| `-` / `_` | Zoom out |
| `0` | Reset zoom to 1× |
| `I` | Toggle metadata panel |
| `Space` | Play/pause (video only) |
| `Esc` | Close viewer |

---

## 6. Performance Architecture

### 6.1 Image Pipeline

```
Grid Thumbnail          Viewer (fit)           Viewer (zoomed)
    │                       │                       │
    ▼                       ▼                       ▼
 ?w=128..512            ?w=2560                 raw file
    │                       │                       │
    ▼                       ▼                       ▼
 sharp resize          sharp resize           net.fetch(file://)
 (concurrency=4)       (concurrency=4)         (streamed, no decode)
    │                       │
    ▼                       ▼
 LRU cache (150)       LRU cache (150)
```

- **sharp** (libvips): Async off-main-thread decode + resize. `sequentialRead: true` streams the decode — never holds full-res bitmap in JS heap.
- **Concurrency semaphore** (`withSharpLimit`): Caps parallel sharp operations at 4. Prevents 50 simultaneous libvips decodes from spiking CPU/RAM.
- **LRU cache**: 150 entries keyed `${path}?w=${w}`. Delete-and-reinsert on hit for LRU ordering.
- **File size guard**: Files >64MB skip resize, stream raw via `net.fetch`.
- **EXIF rotation**: `.rotate()` honors camera orientation metadata.

### 6.2 Scan Pipeline

Two-phase streaming scan in a `utilityProcess` worker:

1. **Phase 1 (enumerate)**: `readdirSync({withFileTypes})` only — zero stat calls. Batches of 250 files sent to renderer immediately.
2. **Phase 2 (stat)**: `statSync` each file for size/birthtime. Sends `MetaPatch` batches of 500. Patches applied in-place via `pathIndex` Map (O(1) per file).

### 6.3 Renderer Optimizations

- **Virtualized masonry grid**: Only visible tiles ± 600px overscan mounted.
- **rAF-throttled scroll/resize**: `ResizeObserver` + `requestAnimationFrame` coalesce measurement bursts.
- **rAF-coalesced dimension updates**: Thumbnail `onLoad` events batched into single state update.
- **`React.memo`** on `Thumbnail`, `TreeNodeRow`, `FolderTree`, `MediaViewer`, `FilmstripThumb`.
- **Stable callbacks**: `useCallback` with index-passed-to-parent pattern avoids per-tile closures.
- **Debounced search**: 300ms delay on query input.
- **Throttled metaBatch**: 150ms coalescing buffer on metadata patches (same pattern as batch buffering).

### 6.4 Filmstrip Virtualization

- Renders only ±50 items around current index.
- Spacer divs (`width: count * 62px`) preserve scroll position for unrendered items.

---

## 7. Accessibility

| Feature | Implementation |
|---|---|
| `aria-pressed` | On all GroupControls and SortControls toggle buttons |
| `aria-label` | Sort direction toggle, search input, grid density slider |
| `role="group"` + `aria-label` | GroupControls container ("Grouping mode") |
| Keyboard nav | Full keyboard control for viewer, scan, folder, search |
| Focus management | Video auto-focus on viewer open |
| Error recovery | ErrorBoundary with reload button |

---

## 8. State Management

### 8.1 Scan State (`useScanState.ts`)

`useReducer` with exhaustive `never` check:

| Action | Effect |
|---|---|
| `start` | Set status to "scanning", reset batches |
| `reset` | Clear to initial state |
| `batch` | Append file batch (150ms coalesced) |
| `metaBatch` | Patch existing files with metadata (150ms coalesced) |
| `progress` | Update scan progress (count + current dir) |
| `done` | Set status "done", flush pending buffers |
| `error` | Set status "error" with message |
| `cancelled` | Set status "cancelled" |
| `restore` | Load cached files instantly |

### 8.2 App State (`App.tsx`)

| State | Type | Purpose |
|---|---|---|
| `folder` | `string \| null` | Selected scan root (persisted in localStorage) |
| `searchQuery` | `string` | Live search text |
| `debouncedQuery` | `string` | 300ms-debounced search |
| `selectedFolder` | `string \| null` | Tree-selected folder filter |
| `groupMode` | `"none" \| "date" \| "type"` | Grouping mode |
| `sortMode` | `"default" \| "name" \| "size" \| "date"` | Sort dimension |
| `sortDir` | `"asc" \| "desc"` | Sort direction |
| `gridDensity` | `number` | Target column width (100–400) |
| `viewerIndex` | `number \| null` | Lightbox open + active file |
| `contextMenu` | `{file, position} \| null` | Right-click menu state |
| `showHelp` | `boolean` | Keyboard help panel |
| `sidebarOpen` | `boolean` | Sidebar visibility |
| `isDragOver` | `boolean` | Drag-and-drop overlay |

### 8.3 Viewer Index Sync (CORR-4)

`viewerFilePathRef` tracks the current file's path. When `derivedFiles` changes (search, sort, scan batch), a `useEffect` re-resolves `viewerIndex` by path. If the file was filtered out, the viewer closes gracefully.

---

## 9. Drag & Drop

- **Folder drop**: Dropping a folder onto the window sets it as the scan root (equivalent to folder picker). Overlay shows when dragging files over the window (UX-2).

---

## 10. Custom Protocols & IPC

### 10.1 `media://` Protocol

```
media://local/<percent-encoded-absolute-path>?w=<width>
```

- Host is fixed sentinel `"local"`.
- Windows: leading `/` stripped from pathname (drive letter fix).
- Linux/macOS: leading `/` preserved (absolute root).
- `?w=` triggers server-side sharp resize (≤2560). Absent = raw file stream.
- Path-traversal guard: only files under whitelisted scan root are served.

### 10.2 IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `scan:start` | renderer → main | Start scan in utilityProcess worker |
| `scan:cancel` | renderer → main | Abort active scan |
| `scan:batch` | main → renderer | Phase 1 file batch (250) |
| `scan:metaBatch` | main → renderer | Phase 2 metadata patches (500) |
| `scan:progress` | main → renderer | Count + current directory |
| `scan:done` | main → renderer | Scan complete + total count |
| `scan:error` | main → renderer | Scan error message |
| `scan:loadCached` | renderer → main | Restore from disk cache |
| `scan:hasCached` | renderer → main | Check cache existence |
| `scan:saveDimensions` | renderer → main | Persist measured dimensions |
| `openPath` / `showItemInFolder` / `writeClipboard` | renderer → main | Shell operations |
