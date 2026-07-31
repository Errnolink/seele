# WIERGISE // NERV Media Scanner — UI/UX Engineering Specification

> **Version:** 2.6 (EVA-ticket UI)  
> **Document type:** Implementation-ready UI/UX specification  
> **Audience:** Implementation agent / frontend engineer  
> **Source of truth:** This document, plus the reference implementation in `src/` (`App.tsx`, `components/*`, `index.css`, `types.ts`, `data.ts`).
>
> **v2.6 changelog:** The control chrome was rebuilt to a **ticket/bevel design system** (see §2.5). Native `<select>`s were replaced with the `EvaSegmented` ticket control, active tabs use coloured bevelled fills (`accent` per semantic group, not only gold), arrow/divider/readout widgets were redesigned to match, the sidebar collapse moved into the header, and glow was toned down from the earlier heavy neon pass.
>
> **Scope:** This document fully specifies the visual design language, layout architecture, every component's props/state/behavior, interaction model, keyboard shortcuts, state management, accessibility and performance constraints. An agent should be able to rebuild the entire UI from this document alone.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Design Tokens](#2-design-tokens)
3. [Typography](#3-typography)
4. [Animations & Micro-interactions](#4-animations--micro-interactions)
5. [App Shell Layout](#5-app-shell-layout)
6. [Global Behavior & Atmosphere](#6-global-behavior--atmosphere)
7. [Component Specifications](#7-component-specifications)
   - 7.1 Header
   - 7.2 Sidebar
   - 7.3 MasonryGrid (Content Presenter — 4 view modes)
   - 7.4 MediaCard
   - 7.5 MediaViewer (Lightbox)
   - 7.6 ContextMenu
   - 7.7 CommandPalette
   - 7.8 KeyboardHelp
   - 7.9 AnalyticsModal
   - 7.10 BootSequence
8. [Data Model](#8-data-model)
9. [State Management](#9-state-management)
10. [Derived Data Pipeline](#10-derived-data-pipeline)
11. [Keyboard Shortcuts](#11-keyboard-shortcuts)
12. [Interaction Model](#12-interaction-model)
13. [Accessibility](#13-accessibility)
14. [Performance Constraints](#14-performance-constraints)
15. [Implementation Checklist](#15-implementation-checklist)

---

## 1. Design Philosophy

The product is a **tactical media scanning & management workstation** — "NERV × Cyberpunk" — used to scan folders of images and videos, browse them at scale, inspect deep metadata, and batch-organize.

Design pillars (in priority order):

1. **Information density with calm.** Everything is monospace, small, and precise — but white space and opacity discipline prevent visual noise. Subtlety over decoration.
2. **Color as semantics, never decoration.** The orange/cyan/green/amber codex is *load-bearing*: each color always means the same thing (see §2).
3. **Keyboard-first power tool.** Every frequent action has a shortcut. Every control is a native element (button/select/input) with `aria-*` attributes.
4. **Tactile, reactive surfaces.** Hover, active, selected, and disabled states are always visually distinct with 150ms transitions.
5. **Performance is a feature.** The grid virtualizes, images lazy-load, and scroll is rAF-throttled.

---

## 2. Design Tokens

### 2.1 Color Palette (Tailwind v4 `@theme` tokens)

| Token | Hex | Semantic role — MUST be used consistently |
|---|---|---|
| `nerv-bg` | `#07080c` | App background (near-black with blue tint) |
| `nerv-panel` | `#0d0f17` | Panel/container background |
| `nerv-panel-2` | `#141724` | Raised surface (inputs, buttons, hover rows) |
| `nerv-border` | `#1e2235` | Default hairline border |
| `nerv-border-highlight` | `#2f3650` | Border hover/promoted |
| `nerv-orange` | `#ff5500` | **Primary ring accent.** Media-card selection, focus rings, scanline accents |
| `nerv-orange-glow` | `rgba(255,85,0,0.25)` | Glow shadow for primary elements |
| `nerv-amber` | `#ffb700` | **Gold / gold-bevel accent.** Star icon, `> 50MB`, default active tab fill, Scan action |
| `nerv-cyan` | `#00f0ff` | **Images.** Type badge, image stats, inspector highlights, SORT segmented accent |
| `nerv-green` | `#10b981` | **Videos / success.** Type badge, video play, online status, sidebar VIDEOS accent |
| `nerv-red` | `#ef4444` | Errors, destructive hover (close, clear) |
| `nerv-purple` | `#7c3aed` | **EVA chrome structure.** Top bar, sidebar frame, folder chip, v2.5/⌘K chips, GROUP accent |
| `nerv-lime` | `#a3e635` | **EVA phosphor text.** Wordmark, search prompt, section labels, status dot, VIEW accent |
| `nerv-text` | `#f1f5f9` | Primary text |
| `nerv-muted` | `#64748b` | Secondary text, icons, labels |

**Semantic codex (non-negotiable):**

| Meaning | Color |
|---|---|
| Card selection / primary ring | Orange |
| EVA chrome (header, sidebar frames) | Purple |
| EVA phosphor text (search, brand, section labels) | Lime |
| VIEW segmented accent | Lime |
| GROUP segmented accent | Purple |
| FILTER segmented accent / favorites / Scan action | Amber (gold) |
| SORT segmented accent | Cyan |
| Sidebar IMAGES quick view | Cyan |
| Sidebar VIDEOS quick view | Green |
| Image-type entities | Cyan |
| Video-type entities / success | Green |
| Errors / destructive | Red |
| Inactive / secondary | Muted slate |

### 2.2 Opacity & Glow Usage

- **Glow is intentionally subdued (v2.6).** Text glow is a single ~30% 4px shadow via `.phosphor-*` helpers (see §2.4). Multi-layer halo shadows are gone.
- Active segmented tabs use the bevelled fill of their `accent` (see §2.5) — no extra glow classes on top.
- Selection ring on media cards (unchanged): `ring-2 ring-nerv-orange/50 shadow-[0_0_15px_rgba(255,85,0,0.3)]`.
- Type badges: 20% tinted background (`bg-nerv-cyan/20`), 50% border (`border-nerv-cyan/50`), full colour text.
- Hover states on neutral controls: `hover:border-* hover:text-*` with the semantic colour.

### 2.3 Corners & Borders

- **Chrome corners are `clip-path`ed, not `rounded`** — the EVA language uses angled cuts. See §2.5.
- `rounded` / `rounded-full` remain on the *content layer*: media cards, `IMG`/`VID` badges, star button, status dots. Do not clip these.
- Hairline borders via `border-nerv-border`. Chrome borders: violet (`border-nerv-purple/40`) on the top bar/sidebar, warm amber (`rgba(198,120,22,*)`) on the ticket widgets.

### 2.4 Glow / phosphor text classes

Defined in `index.css`. Apply one per text node; never stack.

| Class | Look | Use |
|---|---|---|
| `.phosphor-orange` | `#ff8f4d` + faint orange glow | result digits, orange micro-labels |
| `.phosphor-amber` | `#ffdf80` + faint amber glow | favourites, `{n} SEL` count |
| `.phosphor-lime` | `#c9e98a` + faint lime glow | brand wordmark, search prompt + input, section labels, tree selection, clock |
| `.phosphor-violet` | `#c4b5fd` + faint violet glow | subtitle, folder-path text, search placeholder |
| `.phosphor-cyan` / `.phosphor-green` | cyan / green equivalent | type-specific stats |
| `.phosphor-dim` | `#8a7a68`, **no glow** | cluster micro-labels (`VIEW`, `GROUP`, `SORT`, `SIZE`, `RESULT`), divider content |

### 2.5 Ticket / bevel design system (new in v2.6)

This is the visual language of the *interactive control chrome* (row 2 of the header and the sidebar quick views). It matches the reference screenshot exactly and is **mandatory** — every tabbed control uses it.

**Shape primitives (all `clip-path`):**

| Class | Polygon | Use |
|---|---|---|
| `.eva-ticket` | `polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px))` | **Every tab / chip / readout** in row 2 + sidebar quick views. Top-right + bottom-left chamfered. This is *the* button shape. |
| `.eva-corner` | `polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)` | One top-right chamfer. Only for *larger panels* (logo block, search field container). **Never on buttons.** |

Hexagon/diamond/arrow shapes from earlier iterations are removed.

**Fill / skin classes:**

| Class | Look | Semantics (current usage) |
|---|---|---|
| `.eva-fill-amber` | Bevelled **gold** `#ffb844 → #eb8f00 → #c96e00`, dark `#221100` text | Default active. Scan, FILTER group, sidebar ALL FILES & STARRED |
| `.eva-fill-purple` | Bevelled **violet** `#a78bfa → #7c3aed → #5b21b6`, dark text | GROUP segmented |
| `.eva-fill-lime` | Bevelled **lime** `#d9f99d → #a3e635 → #65a30d`, dark text | VIEW segmented |
| `.eva-fill-cyan` | Bevelled **cyan** `#67e8f9 → #06b6d4 → #0e7490`, dark text | SORT segmented, sidebar IMAGES |
| `.eva-fill-green` | Bevelled **green** `#6ee7b7 → #10b981 → #047857`, dark text | Sidebar VIDEOS |
| `.eva-fill-red` | Bevelled **red** `#fca5b5 → #ef4444 → #b91c1c`, dark text | Reserved for destructive toggles |
| `.eva-dim` | Flat dark `#17130d`, text `#857763` → amber on hover | Idle tab (SINGLE DAY equivalent) |
| `.eva-frame` + `.eva-inner` | 1px amber skin wrapping a dark ticket inner with `#ffb020` glowing digits | Bordered **readout** panels (SIZE, RESULT) |
| `.eva-sqbtn` | Small `#12100b` square, 1px amber border, orange glyph | Sort direction arrow, expand/collapse all, sidebar toggle |
| `.eva-divider` | 1px vertical tick, 5px serif caps top/bottom | Cluster separator in row 2 |

**Bevel contract** — every `-.eva-fill-*` class shares the identical 3D treatment:
- 3-stop vertical gradient (light top → base → dark bottom).
- `inset 0 1px 0` light top highlight + `inset 0 -2px 0` dark bottom edge.
- Tight ~10px, 35%-opacity colour halo.
- Dark text (`#1a*`-toned) — never light text on the bright bevel.
- `:hover` = `filter: brightness(1.07)`. Never fall back to `.eva-dim` on hover.

This is how every active tab reads as the same physical object in a different hue.

---


## 3. Typography

- **Single font family:** `'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, Menlo, monospace` — used for *everything* (labels, values, buttons, inputs, tables).
- Base size: `13px` on `body`. Text scales used:
  - `text-[9px]` — micro labels (uppercase, tracked, muted) e.g. "EXIF & METADATA", "STORAGE & MEDIA ANALYTICS"
  - `text-[10px]` — table cells, count badges, helper text
  - `text-[11px]` — folder tree, filter chips, toolbar labels
  - `text-xs` (12px) — default UI text, buttons, inputs
  - `text-sm` (14px) — modal titles, brand wordmark
  - `text-lg` (18px) — stat numbers in analytics
- **Uppercase + `tracking-widest`** is the house style for section labels and headers (e.g., `tracking-widest text-nerv-muted uppercase text-[10px]`).
- **`tabular-nums`** on all numeric readouts (sizes, counts, clock, percentages).
- `font-bold` for: active states, file names, primary CTA text, stat numbers.
- `user-select: none` on body; inputs and code paths re-enable selection.

---

## 4. Animations & Micro-interactions

All keyframes live in `index.css`. Duration/curve per rule:

| Keyframe / class | Duration | Effect |
|---|---|---|
| `pulse-soft` (`animate-pulse-soft`) | 2.5s ease-in-out ∞ | Soft opacity pulse — status dots, section marker at rest |
| `glow-orange` (`animate-glow-orange`) | 2.5s ∞ | Breathing box-shadow glow — floating batch toolbar only |
| `shimmer-bg` (`.shimmer` class) | 2s ∞ | Loading skeleton sweep — media card placeholder |
| `animate-spin` | built-in | Rotating "SCANNING..." spinner icon |

**Removed in v2.6** (unused or too flashy): `scanline-sweep` on boot, `boot-glitch`, `viewer-enter`, `hex-pulse`, the always-on orange `box-shadow` glow keyframes the old segmented controls used, and all 24px text-shadow halos. Everything below that is not in this table does not animate.

**Standard interaction transitions — apply everywhere:**

```
transition-colors duration-150      // color-only changes (buttons, rows, chips)
transition-all duration-200         // size/shadow/transform changes (cards)
transition-opacity duration-300     // overlay fade-ins (card hover info)
group-hover:scale-105 duration-300  // thumbnail zoom on hover
```

**Loading states:**

- Media cards render a `.shimmer` skeleton `<div className="absolute inset-0 shimmer" />` until `img.onLoad` fires, then cross-fade `opacity-0 → opacity-100` over 300ms.
- The Scan button shows `animate-spin` on its icon and `animate-pulse` on itself while `scanning === true`.

---

## 5. App Shell Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header (h-12 top bar + h-10 control strip)          ──── z-30        │
├──────────┬───────────────────────────────────────────────────────────┤
│ Sidebar  │  Main Content (MasonryGrid — view modes)                  │
│ w-64     │  - masonry / grid / split: p-4 scroll container           │
│ collaps- │  - list: p-4 with bordered <table>                        │
│ ible     │                                                            │
│ z-20     │                                                            │
│          │                                                            │
├──────────┴───────────────────────────────────────────────────────────┤
│ (floating) Batch Action Toolbar — fixed bottom-center z-40           │
│ (floating) Lightbox / Modals — fixed inset-0 z-50+                   │
└──────────────────────────────────────────────────────────────────────┘
```

- Root: `<div className="h-screen w-screen flex flex-col bg-nerv-bg text-nerv-text overflow-hidden relative font-mono select-none">`.
- **Vertical rhythm:** Header is `shrink-0`, main is `flex-1 min-h-0` (critical for scroll containers), modals are `fixed`.
- **Sidebar collapse toggle lives in the Header** (see §7.1, brand cluster) — it is *not* a floating handle. The sidebar itself is a `w-64 ↔ w-0` transition (`duration-300`); the floating `‹/›` drag-style handle from earlier designs was removed.

### 5.1 Layout invariants

- Scroll containers: `<main>` or the grid's own `overflow-y-auto` div. Never let the page itself scroll (`overflow: hidden` on body).
- Use `min-w-0` on flex children that contain truncating text or scroll areas.
- The sidebar animates by width only; its inner content is a fixed `w-64 shrink-0` wrapper so text doesn't reflow during the transition.

---

## 6. Global Behavior & Atmosphere

### 6.1 Background

- Body background `#07080c`.
- `body::before` — fixed, full-viewport, `pointer-events: none`, `z-index: 999`, `opacity: 0.02`, SVG `feTurbulence` noise (baseFrequency 0.8). This subtle film grain is always on.
- The media lightbox canvas uses `bg-black/80` with a faint optional grid.

### 6.2 Scan simulation (mock environment)

On boot, after the `BootSequence` (~1.8s), the app auto-triggers a scan:
- `scanning = true`, files populate in batches of 4 every 45ms until the full mock corpus (48 files) loads.
- Header Scan button reflects `scanning` with the spin icon + `SCANNING...` label + disabled state.
- Re-triggering scan clears `allFiles` and re-populates.

---

## 7. Component Specifications

> Each component below lists: purpose, exact props, internal state, DOM structure, styling classes, and behavior rules. Class strings are given so styling is deterministic.

---

### 7.0 EvaSegmented — the ticket control (new in v2.6)

**File:** `src/components/EvaSegmented.tsx`  
**Export:** `EvaSegmented`

**Purpose:** replaces all native `<select>`s and simple toggle groups. It is the single, canonical segmented control for VIEW / FILTER / GROUP / SORT.

```ts
type FillAccent = 'amber' | 'purple' | 'lime' | 'cyan' | 'green' | 'red';

interface EvaOption<T extends string> {
  value: T;
  label: string;          // uppercase, e.g. "NONE", "DATE"
  icon?: ReactNode;       // small 10px SVG
  title?: string;         // tooltip
}

interface EvaSegmentedProps<T extends string> {
  label?: string;         // left-hand micro label, e.g. "GROUP"
  value: T;
  options: EvaOption<T>[];
  onChange: (v: T) => void;
  accent?: FillAccent;    // hue of the active tab. Default 'amber'.
}
```

**Rendering rules:**
- Each option is a `<button className="eva-ticket h-7 px-3">` — ticket shape, no container box. Float side-by-side with `gap-[5px]`.
- Active → `eva-fill-{accent}`. Idle → `eva-dim`.
- `aria-pressed` on every button. Labels are uppercase, `text-[10px] font-bold tracking-[0.18em]`.
- Micro `label` (e.g. "VIEW") is rendered left, `text-[9px] font-bold tracking-[0.25em] phosphor-dim`.

**Accent assignment in the header (fixed, part of the codex):**

| Control | `accent` |
|---|---|
| VIEW (masonry/grid/list/split) | `lime` |
| FILTER (all/img/vid/★fav/>50mb) | `amber` |
| GROUP (none/date/type/dir/res) | `purple` |
| SORT (date/name/size/res) | `cyan` |

---

### 7.1 Header

**File:** `src/components/Header.tsx`  
**Export:** `export function Header(props: HeaderProps)`

**Purpose:** Global command bar: brand + folder context, scan trigger, global search, tool access, and all layout/filter controls.

#### Props

```ts
interface HeaderProps {
  currentFolder: string;
  onPickFolder: () => void;
  onScan: () => void;
  scanning: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  groupMode: GroupMode;
  onGroupModeChange: (g: GroupMode) => void;
  sortMode: SortMode;
  onSortModeChange: (s: SortMode) => void;
  sortDir: SortDir;
  onSortDirChange: (d: SortDir) => void;
  gridDensity: number;
  onGridDensityChange: (n: number) => void;
  resultCount: number;
  totalCount: number;
  selectedCount: number;
  onOpenHelp: () => void;
  onOpenPalette: () => void;
  onOpenAnalytics: () => void;
  sidebarOpen: boolean;        // NEW v2.6 — controls the header collapse chip
  onToggleSidebar: () => void; // NEW v2.6
}
```

#### Structure (2 rows)

Row 1 carries the brand + folder + scan + search + tools on a subtle EVA-purple surface (`class="eva-top-bar"`, linear 9% violet top sheen over `#07080c`). A violet top scanline accents the bar; violet corner HUD brackets sit at all four corners of the whole header.

**Row 1 — `h-12 px-3 flex items-center justify-between border-b border-nerv-purple/40 gap-3`**

1. **Sidebar toggle (NEW v2.6)** — small square chip at the far left:
   - `w-8 h-8`, lime-fill square when `sidebarOpen` (`bg-nerv-lime text-[#1a3205] shadow-[0_0_8px_rgba(163,230,53,0.35)]`), violet-bordered idle square when closed (`border-[rgba(124,58,237,0.5)] bg-[#100e18] text-[#c4b5fd]`, hover → lime border/text).
   - Glyph: `‹` when open, `›` when closed. Toggling flips the sidebar width.

2. **Brand block** (`shrink-0`, right border divider `border-nerv-purple/40`):
   - **Logo** — `#6d28d9` `eva-corner` block with a lime "W" and a faint 3px lime unit-stripe along its right edge.
   - "WIERGISE" — bold, `text-[13px] font-bold tracking-[0.25em] phosphor-lime`; inline `v2.5` chip = `eva-ticket` + `bg-[rgba(124,58,237,0.25)] text-[#c4b5fd]`.
   - Sub-line — `text-[9px] phosphor-violet tracking-[0.3em]` reading `UNIT-01 // MEDIA SCANNER`.

3. **Folder breadcrumb button** (`onPickFolder`):
   - `eva-ticket` + `bg-[rgba(124,58,237,0.12)]`, hover brightens to `0.22`.
   - Folder icon + truncated path in `phosphor-violet` + trailing `[ CHG ]` hint (brightens to lime on hover).
   - Clicking = open folder picker.

4. **Scan button** (`onScan`, `disabled={scanning}`):
   - Idle: `eva-ticket + eva-fill-amber` — gold bevelled ticket, dark text, refresh icon; hover `filter: brightness(1.07)`.
   - Scanning: `bg-[#33230a] text-[#ffb020] animate-pulse`, icon `animate-spin`, label `SCANNING`.

5. **Global search** (`flex-1 max-w-xl`, `eva-corner + eva-segbar` tinted violet-border):
   - Lime `>` prompt + faint violet magnifier at the left.
   - Input text in `phosphor-lime`; placeholder `QUERY.FILENAME // TAG // EXT` in dim violet.
   - Right: live `{resultCount}` (amber, only when a query is active) + `⌘K` `eva-ticket` chip in violet.

6. **Right tool cluster** (`shrink-0`):
   - ANALYTICS / palette / help — `eva-ticket` (ANALYTICS) + square buttons (palette, help), all violet-surfaced with lime-on-hover.
   - Clock (xl+): lime dot `bg-nerv-lime shadow-[0_0_8px_#a3e635] animate-pulse-soft` + `HH:MM:SS` in `phosphor-lime`, updates each second.

**Row 2 — Control strip `h-12 px-3` on a warm dark amber-black (`#0d0b08 → #0a0908`) with faint vertical tick texture.**

Contains only the new control-chrome widgets (§2.5). Clusters are separated by `.eva-divider` vertical ticks.

1. **VIEW** — `EvaSegmented` `accent="lime"`, options MASONRY / GRID / LIST / SPLIT with 10px glyphs.

2. `.eva-divider`.

3. **FILTER** — `EvaSegmented` `accent="amber"`, options ALL / IMG / VID / ★FAV / >50MB.

4. `.eva-divider`.

5. **GROUP** — `EvaSegmented` `accent="purple"`, options NONE / DATE / TYPE / DIR / RES.

6. `.eva-divider`.

7. **SORT** — `EvaSegmented` `accent="cyan"`, options DATE / NAME / SIZE / RES.

8. **Sort direction button** — `.eva-sqbtn` square, filled orange triangle glyph (▲ ASC / ▼ DESC), 18px.

9. **SIZE readout** (hidden in list mode) — `.eva-frame > .eva-inner` ticket: `SIZE` label · slim `.eva-slider` range (130–360) · `{N}px` in glowing amber digits.

10. **RESULT readout** — `.eva-frame > .eva-inner` ticket: dim `RESULT` label, glowing `{resultCount}` / `{totalCount}`, and `{selectedCount} SEL` in amber when non-zero.

---

### 7.2 Sidebar

**File:** `src/components/Sidebar.tsx`  
**Exports:** `Sidebar` (named) and internal `FolderTreeNode`.

**Purpose:** Quick views, directory navigation tree, and a storage distribution footer widget.

#### Props

```ts
interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  tree: FolderNode;
  selectedFolder: string | null;
  onSelectFolder: (p: string | null) => void;
  typeFilter: MediaTypeFilter;
  onTypeFilterChange: (t: MediaTypeFilter) => void;
  stats: { totalFiles: number; imageCount: number; videoCount: number; totalSizeBytes: number };
}
```

#### Structure

`<aside className={open ? 'w-64' : 'w-0'} ...>` — a `transition-all duration-300` on the width; inner content sits on a fixed `w-64 shrink-0` wrapper so nothing reflows during the animation. The sidebar is a violet-framed panel (`border-r border-nerv-purple/40` + a violet accent line) on a dark purple-tinted gradient.

1. **Quick Views panel** — `p-3 border-b border-nerv-purple/25`:
   - Header: `SectionLabel` with a lime marker + `QUICK VIEWS` in `.phosphor-lime` + a pulsing lime dot.
   - **4 ticket buttons (`eva-ticket`)**. Each button = icon (semantic colour) + uppercase label + zero-padded count badge (`padStart(3,'0')`). Fill hue is per-view:

     | Row | Active fill |
     |---|---|
     | ALL FILES | `.eva-fill-amber` |
     | IMAGES | `.eva-fill-cyan` |
     | VIDEOS | `.eva-fill-green` |
     | STARRED | `.eva-fill-amber` |

     Idle → `.eva-dim`. ALL FILES additionally calls `onSelectFolder(null)`.

2. **Directory explorer header** — `p-3 border-b border-nerv-purple/25`:
   - `SectionLabel` `DIRECTORY // {totalFoldersCount:padded3}` with two `.eva-sqbtn` `+` / `−` squares for expand/collapse all.
   - Folder filter input = `.eva-frame > .eva-inner` ticket with a lime `>` prompt and a lime input, placeholder `FILTER.DIR`.

3. **Tree container** — `flex-1 overflow-y-auto p-2`, renders `FolderTreeNode` recursively.

**FolderTreeNode** (recursive):
- Row: `group relative flex items-center gap-1.5 py-[3px] cursor-pointer font-mono text-[10px] tracking-wider`.
- Selected: `phosphor-lime` bold + a 2px lime marker (`absolute left-0 w-[2px] bg-nerv-lime shadow-[0_0_8px_#a3e635]`). Hover: `hover:text-nerv-lime/80` on muted slate.
- Indentation: inline `paddingLeft: 6 + depth * 10` (10px per depth, tighter than v2.5).
- Chevron rotates 90° when expanded; folder icon follows row colour; count badge is padded `padStart(2,'0')` in muted, `phosphor-amber` when selected.
- Chevron click toggles expansion via stopPropagation; row click toggles `selectedFolder` (clicking the selected row clears it).

4. **Storage telemetry footer** — `border-t border-nerv-purple/20 p-3 bg-black/40`:
   - `SectionLabel` `STORAGE // TELEMETRY`, plus a `TOTAL` line with a `phosphor-amber` `formatBytes(totalSizeBytes)`.
   - Chunky segmented ratio bar `h-3` — a `.eva-segbar` skin with a cyan (images) + green (videos) neon-glowing split, overdrawn with dark tick marks every 10px.
   - Legend: `IMG {count:padded3}` (phosphor-cyan + glowing cyan square) · `VID {count:padded3}` (phosphor-green + glowing green square).
   - Status line: lime dot (`bg-nerv-lime shadow-[0_0_8px_#a3e635] animate-pulse-soft`) + `MAGI.LINK NOMINAL` in `phosphor-dim`.

**SectionLabel** (small helper): lime marker bar (`w-1 h-3 bg-nerv-lime shadow-[0_0_6px_#a3e635]`) + `text-[9px] font-bold tracking-[0.25em] phosphor-lime` + a violet fade divider (`bg-gradient-to-r from-nerv-purple/50 to-transparent`). Optional `pulse` to animate the marker.

---

### 7.3 MasonryGrid — Content Presenter

**File:** `src/components/MasonryGrid.tsx`  
**Exports:** `MasonryGrid` and internal memoized `MediaCard`.

**Purpose:** Renders the file collection in one of four view modes with grouping.

#### Props

```ts
interface MediaContentPresenterProps {
  groups: Array<{ label: string; files: MediaFile[] }>;
  viewMode: ViewMode;               // 'masonry' | 'grid' | 'list' | 'split'
  groupMode: GroupMode;             // 'none' | 'date' | 'type' | 'folder' | 'resolution'
  targetColumnWidth: number;        // 130–360
  selectedIds: Set<string>;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  activeInspectFile: MediaFile | null;
  onInspectFile: (file: MediaFile) => void;
}
```

#### Column math

- Container width tracked via `ResizeObserver` on the scroll root.
- `columnCount = max(1, floor(containerWidth / max(120, targetColumnWidth)))`.
- In **split** mode, reserve 320px for the inspector: `width - 320`.

#### View modes

**A. Masonry** — preserve natural aspect ratio:
- `aspectRatio={file.width / file.height}` on each card.
- Columns as flex columns (`flex gap-3`; N columns, each `flex-1 flex flex-col gap-3`); file `i` goes to column `i % columnCount`.

**B. Grid** — uniform square tiles:
- CSS grid: `grid gap-3`, `gridTemplateColumns: repeat(${columnCount}, minmax(0, 1fr))`.
- `aspectRatio={1}` on cards (object-cover crops).

**C. List** — dense table:
- Bordered `<table>` (`border border-nerv-border rounded overflow-hidden`), full width.
- Columns: `✓` (checkbox), Preview (40px thumb), File Name, Type (colored chip), Dimensions, Size (amber), Date Modified, Actions (star + Open buttons).
- Row hover: `hover:bg-nerv-panel-2/80`. Selected row: `bg-nerv-orange/10`.
- Row click → `onInspectFile`; double click → `onOpen`; right click → context menu.
- Checkbox column stops propagation.

**D. Split** — grid + inspector:
- Layout: `flex gap-4`; left = masonry columns (with 320px subtracted for column math), right = `w-80 shrink-0` sticky inspector card.

#### Group rendering (shared)

- Wrapper per group: `flex flex-col gap-6` (outer) → per group `flex flex-col gap-3`.
- Group label (only when `groupMode !== 'none'`): orange 6×16px rounded bar + uppercase bold orange label + `({n} items)` muted + fading divider line.
- Empty groups: render the label header only.

#### Split inspector card

- `w-80 shrink-0 border border-nerv-border rounded bg-nerv-panel p-4 flex flex-col gap-4 font-mono text-xs h-fit sticky top-0`.
- Header "MEDIA INSPECTOR" (orange bold) + type chip.
- `aspect-video` thumb with `object-contain`.
- File name (bold, break-all) + path (muted, `text-[10px]`).
- 2×2 stats grid (`bg-nerv-bg p-2.5 rounded border border-nerv-border text-[11px]`): Dimensions, File Size (amber), Camera, Date.
- **Color palette strip** if present: `flex rounded overflow-hidden h-5 border border-nerv-border`, one swatch per hex.
- CTA: "Launch Full Screen Lightbox" (`w-full py-2 bg-nerv-orange text-nerv-bg font-bold rounded`).

---

### 7.4 MediaCard (grid tile)

**File:** `src/components/MasonryGrid.tsx` (memoized inner component)

#### Props

```ts
{
  file: MediaFile;
  aspectRatio?: number;
  selected: boolean;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (file: MediaFile) => void;
  onToggleFavorite: (file: MediaFile) => void;
  onContextMenu: (file: MediaFile, e: React.MouseEvent) => void;
  onInspect?: (file: MediaFile) => void;
}
```

#### Structure & behavior

```
<div (root) onClick={inspect|open} onDoubleClick={open} onContextMenu>
  ├─ .shimmer skeleton (until loaded)
  ├─ <img> lazy, object-cover, group-hover:scale-105, fade-in on load
  ├─ top overlay (opacity-0 group-hover:opacity-100):
  │    ├─ checkbox button (w-5 h-5, orange when selected)
  │    └─ favorite star (w-6 h-6 rounded-full, amber when starred)
  ├─ type badge bottom-right: IMG (cyan) / VID (green)
  ├─ video play circle overlay (green, center) when type=video
  └─ bottom info gradient (opacity-0 group-hover:opacity-100):
       fileName (bold truncate) + "WxH" and size (amber)
```

- Root classes: `group relative rounded border overflow-hidden transition-all duration-200 cursor-pointer bg-nerv-panel select-none`.
- Selected: `border-nerv-orange ring-2 ring-nerv-orange/50 shadow-[0_0_15px_rgba(255,85,0,0.3)]`; else `border-nerv-border hover:border-nerv-orange/70 hover:shadow-lg`.
- Top overlay buttons use `pointer-events-none` on the container + `pointer-events-auto` on buttons so the overlay doesn't block card clicks.
- Checkbox glyph `✓`; star glyph `★`.

---

### 7.5 MediaViewer (Lightbox)

**File:** `src/components/MediaViewer.tsx`  
**Export:** `MediaViewer`

**Purpose:** Fullscreen inspection of a single media item with navigation, zoom/pan, video playback, EXIF drawer, and filmstrip.

#### Props

```ts
interface MediaViewerProps {
  files: MediaFile[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onToggleFavorite: (file: MediaFile) => void;
}
```

#### Structure (fixed overlay)

```
<div fixed inset-0 z-50 bg-black/95 backdrop-blur-lg flex flex-col font-mono select-none>
  ├─ Top bar (h-12, panel bg): brand dot "MEDIA LIGHTBOX" | fileName | (index/total)
  │    └─ controls: zoom group, rotate/flip, star, INFO(I), close ✕
  ├─ Main (flex-1 flex overflow-hidden):
  │    ├─ Canvas (flex-1): media or video player + nav arrows
  │    └─ Metadata drawer (w-80, border-l) when showMeta
  └─ Filmstrip (h-20, border-t, panel bg): horizontal scroll of thumbs
```

#### Image interactions

- **Zoom:** wheel (factor 1.2, clamp 0.5×–8×); toolbar `- / % / + / Reset`.
- **Pan:** mouse down when `zoom > 1`; drag updates translate; cursor `grab`/`grabbing`.
- **Transform string:** `translate(x,y) scale(z) rotate(deg) scaleX(flip)`.
- **Rotate (R):** +90° step. **Flip (⇄):** horizontal mirror.
- **Double-click:** not required; single click on card opens.

#### Video player

- Native `<video>` with `poster`, `src={file.videoSrc}`, click toggles play/pause.
- Controls panel (`bg-nerv-panel/90 border border-nerv-border rounded p-3`):
  - Time scrubber `<input type="range">` bound to `currentTime/duration`, accent orange.
  - PLAY/PAUSE button (orange), `{floor(t)}s / {floor(d)}s` readout.
  - Speed `<select>`: 0.5× / 1× / 1.5× / 2× → sets `video.playbackRate`.
- State: `isPlaying`, `currentTime`, `duration`, `playbackRate`.

#### Metadata drawer (toggle I)

- Header "EXIF & METADATA" (orange bold) + type chip.
- FILE NAME (bold), FILE PATH (muted code block + **COPY** button → `navigator.clipboard` + `alert`).
- 2×2 grid on `bg-nerv-bg` card: Resolution (bold), File Size (amber bold), Megapixels (computed `w*h/1e6`), Camera (truncated).
- **Extracted palette** strip (h-6) if `colorPalette`.
- CREATED TIMESTAMP: `formatDateTime(birthtime)`.

#### Filmstrip

- `h-20 border-t border-nerv-border bg-nerv-panel/90 p-2`, inner `flex items-center gap-2 overflow-x-auto`.
- Thumb buttons: `h-full aspect-square rounded border overflow-hidden shrink-0`; active = `border-nerv-orange ring-2 ring-nerv-orange/50 scale-105`; inactive = `border-nerv-border opacity-60 hover:opacity-100`.
- On index change: `scrollIntoView({ inline: 'center' })` on the `[data-active="true"]` element.

#### Keyboard (see §11)

`← → Esc + - 0 R I Space(space only for video)`.

---

### 7.6 ContextMenu

**File:** `src/components/ContextMenu.tsx`  
**Export:** `ContextMenu`

#### Props

```ts
{ file: MediaFile; x: number; y: number; onClose: () => void; onOpen: () => void }
```

#### Structure

- `fixed z-[60] w-56 bg-nerv-panel border border-nerv-orange/40 shadow-[0_0_30px_rgba(255,85,0,0.2)] py-1`.
- Header block: "CONTEXT // ACTIONS" micro label + orange truncated filename.
- Items (12px SVG icon + label):
  1. **Open in Viewer** (orange, primary)
  2. Open with Default
  3. Show in File Manager
  4. Copy File Path
  5. Copy File Name
- Item hover: primary → `hover:bg-nerv-orange/10`; others → `hover:bg-nerv-panel-2`.
- Clamp position to viewport: `min(x, innerWidth - 240)`, `min(y, innerHeight - items*32 - 16)`.
- Clicking anywhere outside closes (handled in App root onClick).

---

### 7.7 CommandPalette

**File:** `src/components/CommandPalette.tsx`  
**Export:** `CommandPalette`

#### Props

```ts
{ files: MediaFile[]; onClose: () => void; onSelect: (f: MediaFile) => void }
```

#### Structure & behavior

- Overlay: `fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[12vh] p-4`.
- Panel: `w-full max-w-2xl bg-nerv-panel border border-nerv-orange/60 rounded-lg shadow-2xl` with orange corner brackets.
- Header strip: "COMMAND // PALADIN SYSTEM" micro label.
- Input row: `›` orange prompt + transparent input + `ESC` kbd hint. Autofocus on mount.
- Results list (max 12, `max-h-[50vh] overflow-y-auto`):
  - Each row: 40px thumb (with I/V micro badge), filename (bold truncate), folder path (muted truncate), size (amber).
  - Active row: `bg-nerv-orange/10 border-l-2 border-nerv-orange`.
- Navigation: `↑/↓` move active index (scrollIntoView nearest), `Enter` selects, `Esc`/backdrop closes.
- Footer: kbd hints `↑↓ navigate · ↵ open · esc close` + `{n} results`.

---

### 7.8 KeyboardHelp

**File:** `src/components/KeyboardHelp.tsx`  
**Export:** `KeyboardHelp`

#### Props

```ts
{ onClose: () => void }
```

#### Structure

- Overlay `fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center`.
- Panel `max-w-2xl bg-nerv-panel border border-nerv-orange/40 rounded-lg shadow-2xl` with corner brackets.
- Header: pulsing orange dot + "KEYBOARD // OPERATIONS MANUAL" (Orbitron-style bold tracking) + close button.
- Body: 3 columns of sections (GLOBAL / VIEWER / SEARCH), each with an orange bar header.
- Each shortcut row: `<kbd>` chip (`bg-nerv-bg border border-nerv-border text-nerv-amber px-1.5 py-0.5`) + description (muted, right-aligned).
- Footer: "NERV TACTICAL OPERATIONS MANUAL v2.15" + "PRESS ? TO CLOSE".

---

### 7.9 AnalyticsModal

**File:** `src/components/AnalyticsModal.tsx`  
**Export:** `AnalyticsModal`

#### Props

```ts
{ files: MediaFile[]; onClose: () => void; onOpenMedia: (file: MediaFile) => void }
```

#### Structure

- Overlay `fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4`.
- Panel `max-w-3xl bg-nerv-panel border border-nerv-orange/50 rounded-lg shadow-2xl p-6 flex flex-col gap-6`; click stops propagation.
- Header: pulsing orange dot + "STORAGE & MEDIA ANALYTICS" + close ✕.
- **Stat cards** (`grid grid-cols-2 sm:grid-cols-4 gap-3`), each `bg-nerv-bg p-3 rounded border border-nerv-border`:
  - TOTAL FILES (orange, `text-lg font-bold tabular-nums`)
  - TOTAL SIZE (amber) — `formatBytes(sum)`
  - AVG FILE SIZE (cyan) — `total/count`
  - VIDEOS / IMAGES (green)
- **Type distribution bar:** `h-4 rounded-md overflow-hidden flex border border-nerv-border`; cyan = image %, green = video %; legend with percentages.
- **Top 5 largest files** list (`divide-y divide-nerv-border bg-nerv-bg rounded border border-nerv-border`): type chip + name (truncate) + amber size; row click → `onClose(); onOpenMedia(file)`; hover `hover:bg-nerv-panel-2`.

---

### 7.10 BootSequence

**File:** `src/components/BootSequence.tsx`  
**Export:** `BootSequence`

- Fullscreen overlay, no props. Runs ~1.8s then the app mounts.
- Contents:
  - `#07080c` background, centered column.
  - Hex-styled NERV logo block (bordered squares + "N"), "NERV" in large tracked display text, motto line.
  - Timed boot log lines (MAGI kernels, uplink, authorization, etc.) appended via `setTimeout` queue, each `text-xs leading-relaxed`, last line pulsing.
  - Final `STANDBY...` line with blinking block cursor.
  - Full-viewport `scanline-sweep` gradient overlay + 4 corner brackets.
- Optional: minimal, fade out via parent unmount (no exit animation required).

---

## 8. Data Model

**File:** `src/types.ts`

```ts
export type ViewMode = 'masonry' | 'grid' | 'list' | 'split';
export type GroupMode = 'none' | 'date' | 'type' | 'folder' | 'resolution';
export type SortMode = 'name' | 'date' | 'size' | 'resolution';
export type SortDir = 'asc' | 'desc';
export type MediaTypeFilter = 'all' | 'image' | 'video' | 'favorite' | 'large';

export interface MediaFile {
  id: string;
  filePath: string;
  fileName: string;
  folderPath: string;
  type: 'image' | 'video';
  size: number;              // bytes
  width: number;
  height: number;
  birthtime: number;         // epoch ms
  thumbnailUrl: string;
  fullUrl: string;
  videoSrc?: string;         // html5 video source
  isFavorite?: boolean;
  tags?: string[];
  colorPalette?: string[];   // 4 hex swatches
  cameraModel?: string;
  iso?: number;
  fps?: number;
}

export interface FolderNode {
  path: string;
  name: string;
  count: number;
  size: number;
  children: FolderNode[];
}

export interface ScanStats {
  totalFiles: number;
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
  avgFileSize: number;
  duplicateCount: number;
  scannedFolders: number;
}
```

**Helper functions** (`src/data.ts`): `formatBytes(n)`, `formatDate(ts)`, `formatDateTime(ts)` — used by every component that prints sizes or dates. Never reimplement inline.

---

## 9. State Management

All state lives in `App.tsx` (single source of truth) and flows down via props. No global store required.

| State | Type | Default | Purpose |
|---|---|---|---|
| `booted` | `boolean` | `false` | Shows BootSequence until true (1.8s) |
| `currentFolder` | `string` | `'/D:/NERV_HQ'` | Scan root path |
| `scanning` | `boolean` | `false` | Scan-in-progress flag |
| `allFiles` | `MediaFile[]` | `[]` | Full scanned corpus |
| `searchQuery` | `string` | `''` | Live input text |
| `debouncedQuery` | `string` | `''` | 200ms-debounced search |
| `selectedFolder` | `string \| null` | `null` | Folder-tree filter |
| `viewMode` | `ViewMode` | `'masonry'` | Layout mode |
| `typeFilter` | `MediaTypeFilter` | `'all'` | Media filter |
| `groupMode` | `GroupMode` | `'none'` | Grouping |
| `sortMode` | `SortMode` | `'date'` | Sort key |
| `sortDir` | `SortDir` | `'desc'` | Sort direction |
| `gridDensity` | `number` | `180` | Target tile width 130–360 |
| `selectedIds` | `Set<string>` | `new Set()` | Multi-selection |
| `viewerIndex` | `number \| null` | `null` | Lightbox open + index |
| `activeInspectFile` | `MediaFile \| null` | `null` | Split-mode inspector target |
| `contextMenu` | `{file,x,y} \| null` | `null` | Right-click menu |
| `showHelp` / `showPalette` / `showAnalytics` | `boolean` | `false` | Overlay visibility |
| `sidebarOpen` | `boolean` | `true` | Sidebar collapse |

**Rules:**

- Update `allFiles` immutably (e.g., favorite toggle maps over the array).
- `selectedIds` always replaced with a new `Set` (never mutated in place) so memoized children re-render.
- Only `App` owns state; components are strictly controlled (no hidden internal data except transient UI like hover/expanded-folder sets).
- Folder tree expansion set is local to `Sidebar` (transient UI state).

---

## 10. Derived Data Pipeline

Order of operations (all in `useMemo`):

1. **folderTree** ← `buildFolderTree(allFiles)` — builds nested `FolderNode` tree with per-node `count` and `size`. Root path `/D:/NERV_HQ`.
2. **derivedFiles** ← `allFiles` filtered by:
   1. `selectedFolder` (path prefix match)
   2. `typeFilter` (`image` / `video` / `favorite` / `large` = size > 50MB)
   3. `debouncedQuery` (matches `fileName` OR any `tag`, case-insensitive)
   4. sorted by `sortMode` then `sortDir` (`date` default; `name` = localeCompare; `size` = bytes; `resolution` = w×h product)
3. **groups** ← `derivedFiles` grouped by `groupMode`:
   - `none` → single `{ label: '', files }` bucket
   - `date` → `formatDate(birthtime)`
   - `type` → `'IMAGE' | 'VIDEO'`
   - `folder` → last path segment
   - `resolution` → `WxH`
4. **stats** ← `allFiles` reduced: `totalFiles`, `imageCount`, `videoCount`, `totalSizeBytes`.

**Invariants:**
- The MediaViewer receives `derivedFiles` + `viewerIndex` — if a filter changes while the lightbox is open, the index stays valid because it is derived from the same array.
- When the active file is filtered out mid-view, the lightbox should close or clamp (implement via an effect comparing `derivedFiles[viewerIndex]?.id` to a stored file id).

---

## 11. Keyboard Shortcuts

### 11.1 App-level (lightbox closed)

| Shortcut | Action |
|---|---|
| `?` | Toggle KeyboardHelp (ignored when typing in inputs) |
| `Ctrl/⌘ + K` | Toggle CommandPalette |
| `Esc` | Close topmost overlay: palette → help → analytics → lightbox → context menu → clear selection |

### 11.2 Viewer-level (lightbox open)

| Shortcut | Action |
|---|---|
| `←` / `→` | Previous / next file |
| `+` / `=` | Zoom in (image, ×1.25 up to 8) |
| `-` / `_` | Zoom out (image, ÷1.25 down to 0.5) |
| `0` | Reset zoom to 100% + reset pan |
| `R` | Rotate 90° (image) |
| `I` | Toggle metadata drawer |
| `Space` | Play/pause (video only; `preventDefault`) |
| `Esc` | Close lightbox |

---

## 12. Interaction Model

| Interaction | Target | Behavior |
|---|---|---|
| **Click card** | MediaCard | `onInspect` in split mode, else `onOpen` (lightbox) |
| **Double-click card** | MediaCard | Always opens lightbox |
| **Hover card** | MediaCard | Scale thumb 1.05, reveal top action buttons + bottom info gradient, orange border |
| **Right-click** | Card / list row | ContextMenu at cursor |
| **Checkbox / top-left ✓** | Card | Toggle `selectedIds`; selected ring + orange border |
| **Star / ★** | Card, list row, lightbox | Toggle `isFavorite` (amber) |
| **Click folder row** | Sidebar tree | Set/clear `selectedFolder` filter |
| **Chevron** | Sidebar tree | Expand/collapse node |
| **Click outside** | Overlays | Close context menu, palette, help, analytics |
| **Folder breadcrumb** | Header | Open folder picker |
| **Scan now** | Header | Restart scan pipeline |
| **Row click** | List view | `onInspectFile` (drives split inspector) |
| **Row double-click** | List view | Open lightbox |

**Selection behavior detail:** clicking the card body does *not* toggle selection (keeps open-on-click simple); selection is explicit via checkbox or future shift-click ranges. The floating batch toolbar appears whenever `selectedIds.size > 0`:

```
fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-nerv-panel border border-nerv-orange/60
rounded-lg px-4 py-2 flex items-center gap-4 text-xs font-mono animate-glow-orange
```
Contents: `{n} item(s) selected` (orange bold) · divider · `★ Toggle Favorite` (batch: applies to all selected) · `Clear Selection`.

---

## 13. Accessibility

- **Native elements first:** real `<button>`, `<select>`, `<input>`, `<table>`, `<video>`. No divs masquerading as controls without keyboard support.
- **`aria-pressed`** on all toggle/segmented buttons (view modes, filter chips).
- **`aria-label`** on icon-only buttons (collapse handle, rotate, flip, close, direction toggle).
- **Keyboard operability:** every action reachable via the shortcuts in §11; inputs autofocus in palette; viewer key handlers attach/detach on mount/unmount.
- **Focus management:** lightbox input-free by design; palette autofocuses; Esc returns focus naturally.
- **Contrast:** body text `#f1f5f9` on `#07080c` (≈15:1). Muted text `#64748b` on `#0d0f17` used only for secondary/optional content (≈4.5:1).
- **Motion:** all animations are opacity/transform/shadow only (GPU-friendly); no element ever animates layout.
- **Reduced data dependency:** `tabular-nums` prevents layout shift on numeric readouts.

---

## 14. Performance Constraints

1. **Virtualization:** The current reference implementation is fine for ≤ a few hundred items. For large corpora, the grid MUST virtualize: only mount cards within `scrollTop ± 600px` overscan; use a `ResizeObserver` + rAF-coalesced scroll handler.
2. **Lazy images:** `loading="lazy"` on every grid thumbnail; thumbs request downscaled server URLs (`?w=`) where the backend supports it; lightbox uses `fullUrl`.
3. **Memoization:** `MediaCard` is `React.memo`; parent passes stable `useCallback` handlers so card props change only when `file`/`selected` actually change.
4. **Debounce search** (200ms) before touching `derivedFiles`.
5. **rAF-throttle** scroll/resize measurement; coalesce `onLoad` dimension reports into a single state update if implemented.
6. **Never** inline-parse/format sizes or dates in render loops without memoization; use `formatBytes` helpers.
7. Filmstrip in lightbox renders all thumbs in reference build — for 10k+ files, window it to `index ± 50` with spacer divs.

---

## 15. Implementation Checklist

Use this to verify the implementation is complete and conformant.

### Shell & Global
- [ ] `body` bg `#07080c`, JetBrains Mono 13px, `overflow: hidden`, noise overlay `body::before` (opacity 0.02, z 999).
- [ ] Root flex column: `h-screen w-screen overflow-hidden select-none font-mono`.
- [ ] BootSequence shown first (~1.8s), then auto-scan populates files.

### Header
- [ ] Row 1: brand block (violet logo block + lime "W" + lime wordmark), sidebar-toggle square chip (lime active / violet idle), folder breadcrumb (violet ticket), gold `INITIATE SCAN` ticket (amber), lime phosphor search field (`⌘K` violet ticket), violet ANALYTICS/palette/help tools, lime clock.
- [ ] Row 2: all four `EvaSegmented` clusters (VIEW `accent=lime`, FILTER `accent=amber`, GROUP `accent=purple`, SORT `accent=cyan`), `.eva-sqbtn` sort-direction arrow, `SIZE` `.eva-frame` readout (hidden in list mode), `RESULT` `.eva-frame` readout, `.eva-divider` ticks between clusters.
- [ ] Every tab renders as a `.eva-ticket`; active uses its accent bevel, idle uses `.eva-dim`.
- [ ] Correct active-state colors per component per the bevel/fill contract (§2.5).

### Sidebar
- [ ] Quick Views: 4 `.eva-ticket` buttons with per-view fill hues (ALL FILES amber, IMAGES cyan, VIDEOS green, STARRED amber), zero-padded counts, lime section label.
- [ ] Folder tree: lime `>` `.eva-frame` filter input, `+`/`−` `.eva-sqbtn` squares, lime selected-marker bar, padded-2 count badges, 10px/depth indentation.
- [ ] Storage footer: chunky 12px segmented ratio bar with glow + tick overlay, `IMG`/`VID` padded legends, lime MAGI.LINK status.
- [ ] Sidebar collapse driven from the header toggle (see §5.1), `w-64 ↔ w-0` with `duration-300`, inner `w-64` content wrapper.

### Grid Presenter
- [ ] All 4 view modes render correctly with group headers.
- [ ] Column math uses ResizeObserver width; split mode subtracts 320px.
- [ ] MediaCard: shimmer skeleton, lazy image, hover overlay (checkbox/star), type badge, video play circle, bottom info, selection ring, context menu hookup.

### Lightbox
- [ ] Image: wheel zoom (0.5–8×), drag pan, rotate/flip, reset, `%` readout.
- [ ] Video: play/pause, scrubber, speed select, time readouts.
- [ ] Metadata drawer (I): name, path + copy, 2×2 stats, palette, timestamp.
- [ ] Filmstrip with auto-center active item; arrows navigate; Esc closes.
- [ ] Favorite toggle synced to corpus.

### Overlays
- [ ] ContextMenu clamps to viewport, closes on outside click.
- [ ] CommandPalette: autofocus, ↑↓/Enter navigation, Esc/backdrop close.
- [ ] KeyboardHelp: 3 sections, `?` toggles.
- [ ] AnalyticsModal: 4 stat cards, distribution bar, top-5 files, click-to-open.

### State & Data
- [ ] All state in App; derived pipeline order matches §10.
- [ ] `selectedIds` immutable Set; batch toolbar appears when >0 and applies favorite toggle to all.
- [ ] Shortcuts match §11 exactly.
- [ ] Types & helpers imported from `types.ts` / `data.ts` — no drift.

---

*End of specification. For visual confirmation, run the reference implementation: `npm run dev`.*
