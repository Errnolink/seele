# Wiergise — UI/UX Upgrade Recommendations

> **Date**: 2026-07-30
> **Scope**: Visual polish, interaction design, and missing UX features
> **Theme**: NERV × Cyberpunk tactical aesthetic — all suggestions stay within this design language

---

## 🔴 Critical Visual Issues (Broken)

### UX-1: Custom Fonts Never Loaded — Falling Back to System Monospace

- **File**: `index.html` (no font links), `src/renderer/theme.css` (references fonts)
- **Category**: Typography

**Problem**: The theme defines `--font-display: "Orbitron"` and `--font-mono: "JetBrains Mono"`, but neither font is loaded anywhere — no `<link>` tag in `index.html`, no `@font-face` declarations, no bundled `.woff2` files. The browser silently falls back to `ui-monospace` / `Consolas` / `system-ui`, so the "Orbitron" display font that gives NERV its distinctive tactical feel **never renders**.

This is the single biggest visual quality gap in the app — the wordmark "WIERGISE", group headers, and viewer titles all use `font-display` but render in a generic system font.

**Fix**: Since this is an Electron app (offline), bundle the fonts locally. Download the woff2 files and add `@font-face` declarations in `theme.css`:

```css
@font-face {
  font-family: "Orbitron";
  src: url("../fonts/Orbitron-Variable.woff2") format("woff2");
  font-weight: 400 900;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("../fonts/JetBrainsMono-Variable.woff2") format("woff2");
  font-weight: 100 800;
  font-display: swap;
}
```

Place the font files in `src/renderer/fonts/`. Update CSP if needed (current `font-src 'self' data:` already allows this).

---

### UX-2: No Drag-and-Drop Visual Feedback

- **File**: `src/renderer/App.tsx`, lines 502–505
- **Category**: Interaction Feedback

**Problem**: The app supports folder drag-and-drop but provides **zero visual feedback** when a folder is dragged over the window. The `onDragOver` handler only calls `e.preventDefault()` — no highlight, no border change, no overlay. Users have no idea the app accepts drag-and-drop.

**Fix**: Add a `dragOver` state and render a visual drop zone overlay:

```tsx
const [isDragOver, setIsDragOver] = useState(false);

// On the root div:
onDragEnter={(e) => {
  if (e.dataTransfer?.types?.includes("Files")) setIsDragOver(true);
}}
onDragLeave={(e) => {
  // Only trigger if leaving the root element
  if (e.currentTarget === e.target) setIsDragOver(false);
}}
onDrop={(e) => { setIsDragOver(false); handleDrop(e); }}

// Render overlay:
{isDragOver && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg/90 backdrop-blur-sm border-2 border-dashed border-nerv-orange pointer-events-none">
    <div className="flex flex-col items-center gap-3 animate-pulse">
      <svg className="w-16 h-16 text-nerv-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className="font-display text-sm uppercase tracking-widest text-nerv-orange font-bold">
        Drop Folder to Scan
      </span>
    </div>
  </div>
)}
```

---

## 🟠 High-Impact Visual Upgrades

### UX-3: Collapsible Sidebar with Toggle Button

- **File**: `src/renderer/App.tsx`, lines 652–676
- **Category**: Layout / Space Efficiency

**Problem**: The sidebar is hardcoded at 240px with no way to collapse it. On smaller screens or when the user wants to focus on the grid, 240px of sidebar is wasted space. There's no toggle.

**Fix**: Add a collapse toggle button and animate the sidebar width:

```tsx
const [sidebarOpen, setSidebarOpen] = useState(true);

// Sidebar:
<aside className={`${sidebarOpen ? 'w-[240px] min-w-[240px]' : 'w-0 min-w-0'} h-full flex-shrink-0 border-r border-nerv-border/60 bg-nerv-panel/20 overflow-hidden flex flex-col transition-all duration-200`}>
  {/* ... sidebar content ... */}
</aside>

// Toggle button (on the sidebar edge):
<button
  type="button"
  onClick={() => setSidebarOpen(s => !s)}
  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-5 h-10 bg-nerv-panel border border-nerv-border/60 flex items-center justify-center text-nerv-muted hover:text-nerv-orange hover:border-nerv-orange/50 transition-all cursor-pointer"
  style={{ left: sidebarOpen ? '240px' : '0' }}
  title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
>
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d={sidebarOpen ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
  </svg>
</button>
```

---

### UX-4: Grid Density / Column Width Slider

- **File**: `src/renderer/components/VirtualizedGrid.tsx`, lines 57–59
- **Category**: User Control

**Problem**: The grid has a fixed `TARGET_COLUMN_WIDTH = 180` with no user control. Users can't zoom in to see larger thumbnails or zoom out for a denser overview. This is a standard feature in every media browser (Photos, Lightroom, Explorer thumbnails view).

**Fix**: Add a zoom slider to the toolbar that controls `TARGET_COLUMN_WIDTH`. Pass it as a prop to `VirtualizedGrid`:

In `App.tsx`:
```tsx
const [gridDensity, setGridDensity] = useState(180); // 100–400 range

// In the toolbar, add a slider:
<div className="flex items-center gap-2 flex-shrink-0">
  <svg className="w-3 h-3 text-nerv-muted" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
  <input
    type="range"
    min={100}
    max={400}
    value={gridDensity}
    onChange={(e) => setGridDensity(Number(e.target.value))}
    className="w-20 h-1 accent-nerv-orange"
  />
  <svg className="w-4 h-4 text-nerv-muted" viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="2" width="20" height="20" rx="1" />
  </svg>
</div>
```

In `VirtualizedGrid.tsx`, accept `targetColumnWidth` as a prop instead of using the hardcoded constant.

---

### UX-5: Scroll-to-Top Button with Progress Indicator

- **File**: `src/renderer/components/VirtualizedGrid.tsx`
- **Category**: Navigation

**Problem**: After scrolling through thousands of files in the masonry grid, there's no quick way to jump back to the top. Users must scroll manually, which is slow in a masonry layout.

**Fix**: Add a floating scroll-to-top button that appears after scrolling past the first screenful:

```tsx
{scrollTop > viewportHeight && (
  <button
    type="button"
    onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
    className="fixed bottom-6 right-6 z-40 w-10 h-10 bg-nerv-panel border border-nerv-orange/40 flex items-center justify-center text-nerv-orange hover:bg-nerv-orange/10 hover:border-nerv-orange hover:shadow-[0_0_12px_rgba(255,85,0,0.2)] transition-all backdrop-blur-sm"
    title="Scroll to top"
  >
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 15l-6-6-6 6" />
    </svg>
  </button>
)}
```

---

### UX-6: Thumbnail Image Fade-In Animation

- **File**: `src/renderer/components/Thumbnail.tsx`, lines 133–146
- **Category**: Visual Polish

**Problem**: When images load, they snap from invisible (`opacity-0`) to fully visible with no transition. This creates a jarring "popping" effect as the user scrolls through the grid. The transition from skeleton → image should feel smooth.

**Fix**: Add a CSS transition on opacity so images fade in gracefully:

```tsx
className={`w-full h-full object-cover block transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
```

Do the same for video thumbnails (line 122).

---

### UX-7: Loading Skeleton Should Have NERV-Styled Shimmer, Not Plain Pulse

- **File**: `src/renderer/components/Thumbnail.tsx`, line 91
- **Category**: Visual Polish

**Problem**: The loading skeleton uses Tailwind's default `animate-pulse` which is a generic gray fade. This looks generic and doesn't match the NERV tactical aesthetic at all.

**Fix**: Replace with a NERV-styled shimmer that sweeps orange across the skeleton:

In `theme.css`, add:
```css
@keyframes nerv-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@theme {
  --animate-nerv-shimmer: nerv-shimmer 1.8s ease-in-out infinite;
}
```

In `Thumbnail.tsx`, replace line 91:
```tsx
<div
  className="absolute inset-0 animate-nerv-shimmer"
  style={{
    background: 'linear-gradient(90deg, #1c1d26 25%, rgba(255,85,0,0.08) 50%, #1c1d26 75%)',
    backgroundSize: '200% 100%',
  }}
/>
```

---

## 🟡 Medium-Impact Improvements

### UX-8: Status Bar Should Show Summary Statistics

- **File**: `src/renderer/App.tsx`, lines 604–631
- **Category**: Information Density

**Problem**: After a scan completes, the status bar only shows the file count. Users would benefit from a quick summary — total size, image/video split — without needing to scroll through everything.

**Fix**: Compute and display summary stats:

```tsx
{scan.status === "done" && (
  <div className="flex items-center gap-4 ml-auto">
    <span className="text-nerv-green font-semibold tracking-wider">
      SCAN COMPLETE · {scan.count.toLocaleString()} FILES
    </span>
    <span className="text-nerv-muted/60">|</span>
    <span className="text-nerv-cyan text-[10px]">
      {files.filter(f => f.fileType === 'image').length.toLocaleString()} images
    </span>
    <span className="text-nerv-green text-[10px]">
      {files.filter(f => f.fileType === 'video').length.toLocaleString()} videos
    </span>
    <span className="text-nerv-muted text-[10px]">
      {formatBytes(files.reduce((sum, f) => sum + f.sizeBytes, 0))}
    </span>
  </div>
)}
```

---

### UX-9: Keyboard Shortcut Help Panel (`?` Key)

- **Category**: Discoverability

**Problem**: The app has several keyboard shortcuts (`Ctrl+O`, `Ctrl+Enter`, `Ctrl+F`, `Escape`, plus viewer shortcuts) but no way for users to discover them other than reading the code or hovering over tooltips.

**Fix**: Add a `?` key shortcut that opens a NERV-styled shortcuts overlay:

```tsx
const [showShortcuts, setShowShortcuts] = useState(false);

// In keyboard handler:
if (e.key === "?" && !inEditable) {
  setShowShortcuts(s => !s);
}

// Render overlay:
{showShortcuts && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg/90 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
    <div className="border border-nerv-orange/40 bg-nerv-panel p-6 max-w-md w-full shadow-[0_0_30px_rgba(255,85,0,0.15)]">
      <h2 className="font-display text-sm uppercase tracking-widest text-nerv-orange font-bold mb-4 border-b border-nerv-border/60 pb-2">
        Keyboard Shortcuts
      </h2>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs font-mono">
        <kbd className="text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 text-center">Ctrl+O</kbd>
        <span className="text-nerv-text">Open folder</span>
        <kbd className="text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 text-center">Ctrl+Enter</kbd>
        <span className="text-nerv-text">Start scan</span>
        <kbd className="text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 text-center">Ctrl+F</kbd>
        <span className="text-nerv-text">Focus search</span>
        <kbd className="text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 text-center">Esc</kbd>
        <span className="text-nerv-text">Clear search / close viewer</span>
        <kbd className="text-nerv-orange border border-nerv-orange/30 px-1.5 py-0.5 text-center">?</kbd>
        <span className="text-nerv-text">Toggle this panel</span>
      </div>
      <div className="mt-3 pt-3 border-t border-nerv-border/40 text-[10px] text-nerv-muted">
        Press <kbd className="text-nerv-orange px-1 border border-nerv-orange/30">Esc</kbd> or click outside to close
      </div>
    </div>
  </div>
)}
```

---

### UX-10: Smooth Viewer Open/Close Transitions

- **File**: `src/renderer/components/MediaViewer.tsx`
- **Category**: Animation

**Problem**: The media viewer appears and disappears instantly with no transition — a hard cut from grid to fullscreen overlay. This feels abrupt and disorienting.

**Fix**: Add a fade-in/scale-up animation on mount and fade-out on unmount. Use CSS animation on the viewer root:

In `theme.css`:
```css
@keyframes viewer-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@theme {
  --animate-viewer-enter: viewer-enter 0.2s ease-out;
}
```

On the MediaViewer root div:
```tsx
className="fixed inset-0 z-50 flex flex-col bg-nerv-bg/98 backdrop-blur-sm select-none animate-viewer-enter"
```

---

### UX-11: Sidebar Folder Count Badges Should Use Semantic Colors

- **File**: `src/renderer/components/FolderTree.tsx`, lines 118–124
- **Category**: Visual Hierarchy

**Problem**: All folder count badges look the same — tiny monochrome numbers on a dark background. There's no visual distinction between folders with 5 files and folders with 5000 files.

**Fix**: Apply tiered color intensity based on count:

```tsx
const countClass = node.count > 100
  ? "text-nerv-orange bg-nerv-orange/20"
  : node.count > 20
    ? "text-nerv-amber bg-nerv-amber/10"
    : "text-nerv-muted bg-nerv-panel-2";
```

---

### UX-12: Context Menu Should Have Icons

- **File**: `src/renderer/App.tsx`, lines 441–477
- **Category**: Visual Polish

**Problem**: The right-click context menu items are text-only with no icons. Every modern context menu uses icons for quick visual scanning.

**Fix**: Add SVG icons to each menu item:

```tsx
{
  key: "open-default",
  label: "Open with default app",
  icon: (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  onClick: () => void window.scanAPI.openPath(file.filePath),
},
// etc. for each item
```

---

### UX-13: Selection Highlight Should Glow, Not Just Tint

- **File**: `src/renderer/components/FolderTree.tsx`, lines 72–76
- **Category**: Visual Feedback

**Problem**: The selected folder in the sidebar uses a flat `bg-nerv-orange/15` tint. This is subtle and can be hard to distinguish from the hover state. In a tactical UI, the selection should have more visual authority.

**Fix**: Add a subtle orange glow to the selected state:

```tsx
isSelected
  ? "bg-nerv-orange/15 border-nerv-orange text-nerv-amber font-semibold shadow-[inset_0_0_12px_rgba(255,85,0,0.12)]"
  : "border-transparent hover:bg-nerv-panel-2 hover:shadow-[inset_0_0_8px_rgba(255,85,0,0.1)] text-nerv-text"
```

---

## 🔵 Lower-Priority Polish

### UX-14: Custom Window Titlebar (Frameless)

- **Category**: Visual Cohesion

**Problem**: The app uses the default OS window frame (white/gray titlebar on Windows), which clashes with the dark tactical aesthetic. Every high-end Electron app uses a custom titlebar.

**Fix**: In `electron/main.ts`:
```typescript
mainWindow = new BrowserWindow({
  // ...
  frame: false,
  titleBarStyle: "hidden",
  titleBarOverlay: {
    color: "#0a0a0c",
    symbolColor: "#ff5500",
    height: 32,
  },
});
```

This uses Windows' native overlay controls (minimize/maximize/close) styled with the NERV palette, while removing the white frame.

---

### UX-15: Thumbnail Hover Should Show Orange Glow on the Border, Not Just Ring Change

- **File**: `src/renderer/components/Thumbnail.tsx`, lines 72–73
- **Category**: Micro-interaction

**Problem**: The hover effect changes the ring from `ring-nerv-border/40` to `ring-nerv-orange`, which is a good start but could be more dramatic for the tactical aesthetic.

**Fix**: Add a subtle orange shadow glow on hover:

```tsx
className={`... ring-1 ring-nerv-border/40 hover:ring-2 hover:ring-nerv-orange hover:shadow-[0_0_12px_rgba(255,85,0,0.15)] transition-all duration-150 ...`}
```

---

### UX-16: Add Subtle CRT Noise Texture to Background

- **Category**: Atmosphere

**Problem**: The background is a flat `#0a0a0c`. For a true NERV/cyberpunk feel, a very subtle noise texture or CRT scanline effect on the background adds depth without being distracting.

**Fix**: Add a CSS pseudo-element with a subtle noise overlay in `index.css`:

```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

---

### UX-17: Viewer Navigation Arrows Should Auto-Hide After Inactivity

- **File**: `src/renderer/components/MediaViewer.tsx`, lines 434–492
- **Category**: Immersion

**Problem**: The prev/next navigation arrows are permanently visible, adding visual clutter when the user is just viewing an image.

**Fix**: Auto-hide arrows (and the top bar) after 3 seconds of mouse inactivity, showing them again on mouse move:

```tsx
const [showControls, setShowControls] = useState(true);
const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

const resetHideTimer = useCallback(() => {
  setShowControls(true);
  if (hideTimer.current) clearTimeout(hideTimer.current);
  hideTimer.current = setTimeout(() => setShowControls(false), 3000);
}, []);

// On the viewer root:
onMouseMove={resetHideTimer}

// On arrows:
className={`... transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
```

---

### UX-18: Progress Bar Should Be Determinate When Possible

- **File**: `src/renderer/App.tsx`, lines 598–601
- **Category**: Information

**Problem**: The scanning progress bar is an indeterminate animation (`animate-scanline-bar`). Once Phase 1 completes and Phase 2 (stat) begins, the total file count is known, so a determinate progress bar could show real progress.

**Fix**: When `scan.progress` includes a count and the total is known, render a real progress bar:

```tsx
{isScanning && scan.progress && scan.count > 0 ? (
  <div className="h-px flex-1 max-w-[200px] bg-nerv-panel-2 overflow-hidden">
    <div
      className="h-full bg-nerv-orange transition-all duration-300"
      style={{ width: `${Math.min(100, (scan.progress.count / Math.max(1, scan.count)) * 100)}%` }}
    />
  </div>
) : isScanning ? (
  <div className="h-px flex-1 max-w-[200px] bg-nerv-panel-2 overflow-hidden">
    <div className="h-full w-1/3 bg-nerv-orange animate-scanline-bar" />
  </div>
) : null}
```

---

## Summary — Priority Order

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 🔴 P0 | **UX-1**: Bundle & load Orbitron + JetBrains Mono fonts | Small | Huge — transforms the entire feel |
| 🔴 P0 | **UX-2**: Add drag-and-drop visual feedback overlay | Small | Essential UX |
| 🟠 P1 | **UX-6**: Thumbnail fade-in transition | Trivial | Removes jarring pop-in |
| 🟠 P1 | **UX-7**: NERV-styled shimmer skeleton | Small | Consistent aesthetic |
| 🟠 P1 | **UX-3**: Collapsible sidebar toggle | Medium | Major space efficiency gain |
| 🟠 P1 | **UX-10**: Viewer open/close animation | Small | Feels premium |
| 🟡 P2 | **UX-4**: Grid density slider | Medium | User control |
| 🟡 P2 | **UX-5**: Scroll-to-top button | Small | Navigation |
| 🟡 P2 | **UX-8**: Summary statistics in status bar | Small | Information density |
| 🟡 P2 | **UX-9**: Keyboard shortcut help panel | Medium | Discoverability |
| 🟡 P2 | **UX-15**: Thumbnail hover glow | Trivial | Polish |
| 🟢 P3 | **UX-12**: Context menu icons | Small | Polish |
| 🟢 P3 | **UX-14**: Custom frameless titlebar | Small | Visual cohesion |
| 🟢 P3 | **UX-16**: CRT noise texture | Trivial | Atmosphere |
| 🟢 P3 | **UX-17**: Auto-hide viewer controls | Small | Immersion |
| 🟢 P3 | **UX-11**: Tiered folder count colors | Trivial | Visual hierarchy |
| 🟢 P3 | **UX-13**: Selection glow effect | Trivial | Feedback |
| 🟢 P3 | **UX-18**: Determinate progress bar | Small | Information |
