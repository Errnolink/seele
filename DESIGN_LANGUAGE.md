# Wiergise Media Scanner — Design Language

> A single-source spec an agent can use to generate a pixel-faithful HTML mockup
> of the **current** app state. Every color, radius, spacing, and animation below
> is taken verbatim from the codebase — nothing invented.

---

## 1. Identity

**Theme:** NERV × Cyberpunk — a tactical, control-room aesthetic inspired by
Neon Genesis Evangelion's MAGI terminals. Dark, industrial, high-contrast,
orange-led, mono-typed. Every surface reads like an instrument.

**Vibe keywords:** tactical, hexagonal, scanline, mono, emergency-orange,
glitch, terminal, militaristic, HUD.

---

## 2. Color Palette (exact)

All UI color derives from these tokens. Use the hex values directly in a mockup.

| Token | Hex | Usage |
|---|---|---|
| `nerv-bg` | `#0a0a0c` | App background (deep tactical black) |
| `nerv-panel` | `#14151c` | Container / panel background (gunmetal) |
| `nerv-panel-2` | `#1c1d26` | Raised / nested panel, scrollbar fill, skeleton pulse |
| `nerv-border` | `#2a2b36` | Default hairline borders |
| `nerv-orange` | `#ff5500` | **Primary accent** — NERV emergency orange. CTAs, active borders, focus rings, scanlines |
| `nerv-amber` | `#ffaa00` | **Warning / status text**, hover target, secondary highlight |
| `nerv-cyan` | `#00f0ff` | **Active/info state** — counters, "filter active", sort active, image-type chip |
| `nerv-green` | `#39ff14` | Terminal green — "complete", "live", video-type chip, online status |
| `nerv-text` | `#e6edf3` | Primary text |
| `nerv-muted` | `#6b7280` | Secondary / muted text |

### Opacity conventions (how tokens are softened)
- Borders: `border-nerv-orange/30` (≈ `rgba(255,85,0,0.3)`) is the standard panel outline; `/40`–`/70` on hover.
- Glows: `shadow-[0_0_10px_rgba(255,85,0,0.3)]` on primary buttons; `0_0_15px_…0.15` on panel hover; `0_0_12px_…0.2` on viewer arrows.
- Tints: active rows `bg-nerv-orange/15`, status pills `bg-nerv-cyan/20`, scanline overlay `via-nerv-orange/[0.04]`.

---

## 3. Typography

| Role | Stack | Usage |
|---|---|---|
| **Body / mono** (`--font-mono`) | `"JetBrains Mono", "Share Tech Mono", ui-monospace, "Cascadia Code", Consolas, monospace` | **Everything by default** — body, buttons, labels, data, paths |
| **Display** (`--font-display`) | `"Orbitron", "JetBrains Mono", system-ui, sans-serif` | Panel **titles** only (uppercase, `tracking-widest`, bold) |

**Base:** `font-size: 14px`, body color `nerv-text`, background `nerv-bg`.

### Typographic conventions
- **Titles:** `font-display`, `text-sm`, `uppercase`, `tracking-widest`, `font-bold`, color `nerv-orange`.
- **Labels/status:** `text-[9px]–[11px]`, `uppercase`, `tracking-wider`/`tracking-widest`, `font-mono`.
- **Data values:** amber or cyan, `font-bold` / `font-semibold`.
- **Tiny meta:** `text-[10px]`, `nerv-muted`.
- Inline `<kbd>` chips: `px-1.5 py-0.5 border border-nerv-orange/40 text-nerv-orange text-[10px]`.

---

## 4. Layout Architecture

The app is a **fixed full-screen** layout, no page scroll. Three-column-ish shell:

```
┌─────────────────────────────────────────────────────────────┐
│  (overlay) HexGridOverlay  ·  BootSequence                  │  ← absolute, decorative
├──────────┬──────────────────────────────────────────────────┤
│          │  HEADER PANEL "MEDIA SCANNER"                     │
│          │  [Select folder] [Scan] [Cancel]  SEARCH  GROUP SORT │
│ SIDEBAR  │  root path · progress · status                    │
│ "NAVIGA  │────────────────────────────────────────────────── │
│  TION"   │  GRID PANEL "TARGETING MATRIX"                     │
│ Folder   │  ┌──┐ ┌──┐ ┌──┐ ┌──┐                              │
│ tree     │  │  │ │  │ │  │ │  │  ← thumbnail grid             │
│ (280px)  │  └──┘ └──┘ └──┘ └──┘                              │
│          │                                                     │
└──────────┴──────────────────────────────────────────────────┘
```

- Root `<div>`: `h-screen w-screen overflow-hidden`, `p-3 gap-3`, `relative z-10 box-border`.
- **Sidebar:** fixed `w-[280px] min-w-[280px] max-w-[280px] h-full flex-shrink-0`.
- **Main:** `flex-1 flex flex-col gap-3 overflow-hidden`, vertical stack of header panel + grid panel.
- All major regions wrap in **`TacticalPanel`** (see §6).

---

## 5. Global Surface Rules

- **Borders are hairlines:** `1px solid nerv-border` (`/30`–`/40` for orange tints).
- **NO border-radius anywhere.** Everything is sharp-cornered (the only rounding in the codebase is decorative svg `rounded-full` dots and `rounded` on skeletons — keep mockup corners square).
- **Backgrounds are flat** — `nerv-panel` / `nerv-panel-2`, no gradients except the scanline overlay and the small radial glows.
- **Hover = brighten border to orange + inset/outset glow.** Example panel hover:
  `hover:border-nerv-orange/70 hover:shadow-[0_0_15px_rgba(255,85,0,0.15)]`.
- **Padding rhythm:** panels `p-4`; toolbar rows `gap-2`–`gap-3`; tree rows `py-1.5 px-3`.

### Scrollbars (custom, orange)
Thin, transparent track, orange thumb:
```css
scrollbar-width: thin;
scrollbar-color: rgba(255,85,0,0.3) transparent;
::-webkit-scrollbar { width: 5-6px; }
::-webkit-scrollbar-thumb { background: rgba(255,85,0,0.3); }
::-webkit-scrollbar-thumb:hover { background: rgba(255,85,0,0.6); }
```

---

## 6. Core Components

### 6.1 TacticalPanel (the universal container)
Every boxed region. Gunmetal panel with corner ticks + optional scanline.

- Container: `relative border border-nerv-orange/30 bg-nerv-panel p-4 overflow-hidden`
  - hover: `hover:border-nerv-orange/70 hover:shadow-[0_0_15px_rgba(255,85,0,0.15)] transition-all duration-200`
- **4 corner ticks** (absolute, `10×10px`, orange `/40`): each corner has two 2px orange borders (e.g. top-left = `border-t-2 border-l-2`).
- **Scanline overlay** (optional, `showScanline`): `absolute inset-0 pointer-events-none`, gradient `from-transparent via-nerv-orange/[0.04] to-transparent animate-scanline`. *(Sidebar disables it; header/grid keep it.)*
- **Header row:** `flex justify-between items-center border-b border-nerv-orange/20 pb-2 mb-4`
  - Title (left): `font-display text-sm tracking-widest text-nerv-orange uppercase font-bold`, `group-hover:animate-pulse`
  - Status pill (right): `font-mono text-[9px] tracking-tighter px-1 border`, tone-colored:
    - `green`: `text-nerv-green bg-nerv-green/10 border-nerv-green/30`
    - `amber`: `text-nerv-amber bg-nerv-amber/10 border-nerv-amber/30`
    - `cyan`: `text-nerv-cyan bg-nerv-cyan/10 border-nerv-cyan/30`

### 6.2 Buttons
**Primary (CTA):** `bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-mono font-bold text-xs uppercase` + `shadow-[0_0_10px_rgba(255,85,0,0.3)]`. (e.g. Scan button, idle CTA)
**Secondary:** `bg-nerv-panel-2 border border-nerv-border hover:border-nerv-orange text-nerv-text text-xs uppercase`.
**Ghost/danger:** `bg-transparent border border-nerv-amber/60 hover:bg-nerv-amber/10 text-nerv-amber` (Cancel).
**Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed`.
All buttons: `px-3/4 py-1.5`, `transition-all duration-150 cursor-pointer`, **no rounded corners**.

### 6.3 Segmented Controls (GroupControls / SortControls)
`inline-flex items-center border border-nerv-border bg-nerv-panel p-0.5`.
- Each option button: `px-2.5 py-1 font-mono uppercase tracking-wider text-xs`.
- **Active (Group):** `bg-nerv-orange text-nerv-bg font-bold animate-pulse-glow`.
- **Active (Sort):** `bg-nerv-cyan text-nerv-bg font-bold`.
- Inactive: `bg-transparent text-nerv-muted hover:text-nerv-amber/cyan hover:bg-nerv-panel-2`.
- Sort has a leading `SORT` label (`text-[9px] text-nerv-muted border-r`) and a trailing ▲/▼ direction toggle.

### 6.4 SearchBar
`flex items-center gap-3 bg-nerv-panel border border-nerv-border px-3 py-1.5 flex-1 min-w-[240px]`.
- Leading magnifier svg (`text-nerv-cyan`, 14px), absolute left.
- Input: `w-full pl-8 pr-7 py-1 bg-nerv-bg border border-nerv-border focus:border-nerv-cyan text-nerv-text text-xs outline-none`, placeholder `SEARCH TARGETS...`.
- Clear ✕ button when non-empty.
- Counter on right: `SHOWING <amber-bold resultCount> OF <amber-bold totalCount>`, `text-[10px] text-nerv-muted`.

### 6.5 FolderTree (sidebar)
- Header toolbar: `+ Expand` / `− Collapse` (`text-[9px] uppercase text-nerv-muted hover:text-nerv-cyan`).
- **"All Files" node:** cyan when selected (`bg-nerv-cyan/15 border-l-2 border-l-nerv-cyan text-nerv-cyan font-bold`), cube icon.
- **Folder rows:** `flex items-center py-1.5 px-3 gap-1.5 text-xs border-l-2`
  - Selected: `bg-nerv-orange/15 border-nerv-orange text-nerv-amber font-semibold`
  - Unselected: `border-transparent hover:bg-nerv-panel-2 text-nerv-text`
  - Indent: `paddingLeft = depth*16 + 12` px.
  - Chevron (▾/▸) toggle, folder svg icon, name (`truncate`), **count badge** (`text-[10px] px-1.5 py-0.5`, selected → amber on `nerv-orange/20`, else muted on `nerv-panel-2`).

### 6.6 Thumbnail Tile
`relative flex flex-col bg-nerv-panel border border-nerv-border hover:border-nerv-orange overflow-hidden select-none flex-shrink-0 group`, fixed pixel size.
- Cursor: `cursor-pointer` normally, **`cursor-not-allowed` when unreadable**.
- **Media area** (`flex-1`): loading skeleton = `bg-nerv-panel-2 animate-pulse`; error = ⚠ + `UNREADABLE` (`text-[9px] uppercase`); video gets a center play glyph + top-right **`LIVE FEED`** chip (green blinking dot + `text-[9px] text-nerv-green font-bold`).
- **Bottom bar** (`h-[24px] bg-black/70 border-t border-nerv-border/50 text-[10px] text-nerv-amber`):
  - `fileName` (truncate) · **`sizeBytes`** (cyan, `text-[9px]`) · `VID`/`IMG` (muted, `text-[9px]`).

### 6.7 MediaViewer (fullscreen lightbox)
- Overlay: `fixed inset-0 z-50 flex flex-col bg-nerv-bg/98 backdrop-blur-sm select-none`.
- 4 **larger corner ticks** (`14×14px`, `/40`).
- Full **scanline overlay** (`z-10`).
- Top bar: `FILE VIEWER` title + `N / total` counter chip (`text-[10px] text-nerv-cyan border border-nerv-cyan/20`), `✕ Close` button.
- Center: prev/next arrow buttons (`w-10 h-10 border border-nerv-orange/30 bg-nerv-panel/80 hover:shadow-[0_0_12px_rgba(255,85,0,0.2)]`), hidden at boundaries. Media container `max-h-[85vh] max-w-[85vw]` with **`min-width/height: 240px`** (prevents layout shift).
- Bottom metadata bar (`bg-nerv-panel/90 font-mono text-[10px]`):
  `fileName` (orange bold) | `VID`/`IMG` (green/cyan) | **size** (cyan) | `filePath` (muted) | date (amber).

### 6.8 ContextMenu (right-click)
`fixed z-[60] min-w-[180px] bg-nerv-panel border border-nerv-orange/40 shadow-[0_0_20px_rgba(255,85,0,0.25)] py-1 font-mono text-xs`.
- Items: `px-3 py-1.5 text-left uppercase tracking-wider`, hover `bg-nerv-orange/15 text-nerv-amber`.
- Dividers: `my-1 mx-2 border-t border-nerv-border/60`.
- Viewport-clamped (never overflows edge).

---

## 7. Animations

| Utility | Keyframe | Use |
|---|---|---|
| `animate-scanline` | `translateY(-100% → 100%)`, 4s linear infinite | Panel scanline overlays |
| `animate-pulse-glow` | box-shadow `0 0 0→8px` `rgba(255,85,0,.4→.6)`, 1.6s | Active Group option |
| `animate-blink` | opacity `1 → 0.2`, 1s steps(2) | "LIVE FEED" dot, status LEDs |
| `animate-scanline-bar` | `translateX(-100% → 400%)`, 1.4s | Indeterminate scan progress bar |
| `animate-pulse` | (Tailwind built-in) | Loading skeletons |
| boot glitch | `matrix-glitch` (clip-path + translateX), 0.5s | BootSequence only |

**Motion principle:** animations are subtle ambient texture (scanlines, blinks, glows), never the focal point. The UI itself feels static/instrument-like; motion implies "system is alive."

---

## 8. Decorative Overlays

- **HexGridOverlay:** faint hex grid pattern over the whole app (absolute, behind content).
- **BootSequence:** brief glitch-in splash on launch (dev: 0ms; prod: ~600ms).
- **Scanlines:** vertical sweeping gradient band on panels (header + grid; sidebar off).

---

## 9. States Reference

| State | Visual |
|---|---|
| **Idle (no folder)** | Grid shows `[ AWAITING TARGET DESIGNATION ]` + folder svg + "Select folder…" CTA + `Ctrl+O`/`Ctrl+Enter` `<kbd>` hints |
| **Scanning** | Indeterminate bar (`w-1/3 bg-nerv-orange animate-scanline-bar`), `N files found so far`, `[currentDir]` path, Cancel button visible |
| **Empty result** | `[ NO MEDIA TARGETS DETECTED ]` + folder svg |
| **Error** | Amber banner: `⚠ SCAN ERROR: <msg>` + dismiss |
| **Status tones** | standby=cyan, scanning=amber, done=green, error/cancelled=amber |

---

## 10. Quick Mockup Recipe (for the agent)

1. `<body>` dark `#0a0a0c`, font JetBrains Mono 14px, text `#e6edf3`.
2. Full-screen flex row, 12px gap, 12px padding. No scroll, no border-radius anywhere.
3. Left 280px sidebar panel (`TacticalPanel` "NAVIGATION") with a folder tree (folders with counts, "All Files" on top).
4. Right column = stacked panels:
   - Top "MEDIA SCANNER" header: `[Select folder…] [Scan]` + search box + `GROUP` (orange active) + `SORT` (cyan active) segmented controls, plus a root-path/status line.
   - Bottom "TARGETING MATRIX" grid: 4–6 columns of thumbnail tiles (`bg #14151c`, orange-on-hover border, 24px black bottom bar with name+size+VID/IMG), videos show a green "LIVE FEED" chip.
5. Sprinkle corner ticks (orange L-shapes) on every panel, add a faint vertical scanline gradient sweeping top→bottom on header+grid panels, faint hex grid behind everything.
6. Accent hierarchy: **orange** = primary/CTA, **amber** = status/warning text, **cyan** = active/sort/counters, **green** = complete/live/video.
7. Keep it dense, sharp, mono, instrument-like. No soft shadows except the small orange glows on interactive elements.

**Tone check:** if it looks like a sci-fi military HUD terminal, it's right.
