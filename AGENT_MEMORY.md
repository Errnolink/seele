# AGENT MEMORY — seele Project (formerly Wiergise)

## Operating Rule (MANDATORY — read every session start)

**ALWAYS TREAT THE CODE AS SOURCE OF TRUTH.**
- NEVER assume from memory.
- NEVER trust a prior summary, a prior "done", or a claimed edit state without reading the actual current code.
- ALWAYS verify by reading the real file contents before acting on any belief about what the code does.
- When a summary says "X was done," READ X and confirm it. Summaries lie; code doesn't.

This rule exists because prior work on this project produced a review summary that claimed fixes were applied, but the actual code did not match — e.g. "thumbnail downscaling" was implemented in a way that made performance *worse* (synchronous full-res decode on the main thread), contradicting the summary's "fixed" claim. Verify everything.

## Project: seele — Media Scanner (renamed from Wiergise, commit 8f48ca5)
- Electron + React + TypeScript media browser, NERV tactical UI theme.
- Working branch: `v2.5.1`. Remote: https://github.com/Errnolink/seele.git (push to `origin/v2.5.1`).
- App on Windows runs in dev via: `cmd.exe /c "set ELECTRON_ENABLE_LOGGING=1 && npm run dev"` — concurrently starts vite (:5173) + `tsc --watch` (compiles to `dist-electron/`) + electron. Launch with `Start-Process` + redirect stdout/stderr to `%TEMP%\opencode\seele-devN.log` (stderr gets the `[electron] ... CONSOLE` lines; `[vite]`/`[tsc]` lines are prefixed too). Renderer console strings print, but OBJECT args print as `[object Object]` — always `JSON.stringify` in logs.
- HMR hot-applies renderer edits (vite). **Main-process (electron/) edits require an electron restart**: tsc watch rebuilds `dist-electron/electron/main.js` automatically; only restart the electron process (children die with it; `vite`/`tsc` keep running). Relaunch electron with `ELECTRON_ENABLE_LOGGING=1` or renderer console output stops flowing.
- Scripts: `typecheck:renderer` (tsconfig.json), `typecheck:electron` (tsconfig.node.json), `lint` (eslint . — flat config), `test` (vitest run; 35 tests in `src/renderer/*.test.ts`), `build`.
- Project renamed to "seele": package name, window title, cache paths (`%LOCALAPPDATA%\seele\Cache`, tmp prefixes `seele-thumbs`), session download filenames. **Deliberately NOT renamed**: localStorage keys `wiergise:lastFolder`, `wiergise:tags`, `wiergise:tagAssignments` (would wipe user state).
- **This model cannot read images.** UI bugs are diagnosed via console instrumentation (`console.log` + read the dev log), not screenshots.
- Keep `AGENT_MEMORY.md` — user explicitly wants it. Stale reports/docs (`report.md`, `nvidia agent report.md`, `V2.5_TRACKER.md`, `UI_UX_DOCUMENTATION.md`, `v2.5 ui ux.md`) were deleted; user plans to write one doc later.

## Key Architecture
- Media served via custom `media://local/<percent-encoded-path>` protocol in `electron/main.ts` (host sentinel "local"; strip leading `/` on win32; `file:///` needs THREE slashes for drive letters). Path-traversal guard `isUnderAllowedRoot` (allowed scan roots).
- `?w=<width>` triggers server-side resize: videos → ffmpeg frame extract, images → sharp. Grid thumbs use `?w=128..512`.
- Image resize MUST stay off the main thread. `nativeImage.createFromBuffer` is SYNC and decodes full-res — freezes main. Use `sharp`. `withSharpLimit` semaphore (SHARP_CONCURRENCY=4) bounds concurrent decodes.
- Thumbnail cache, two tiers (electron/main.ts): RAM LRU `thumbCache` (THUMB_CACHE_MAX=150) + disk under `%LOCALAPPDATA%\seele\Cache\thumbs` sharded `<sha1[:2]>/<sha1>`. `storeThumb`/`lookupThumb` async best-effort (sync writes froze scrolling). **Disk tier is bounded by `pruneThumbCache`**: THUMB_DISK_MAX_FILES=5000 / THUMB_DISK_MAX_BYTES=512MB, oldest-first by mtime, throttled to once/60s, invoked from `storeThumb` + at startup in `app.whenReady`.
- Insights (`file:insights` IPC): partial sha1 (first/last 64KB + size), then median-cut palette (`medianCutPalette` in main.ts — 4 colors from 48px raw preview via `sharp().resize(48).removeAlpha().flatten().raw()`; sorted by population; fallback to `stats().dominant`) + best-effort EXIF camera parse (`parseExif` scans latin1 dump for Make/Model/Lens/FNumber/ISO/ExposureTime). Videos: one ffmpeg frame at ~1s. Renderer: `InspectorCard` in MasonryGrid.tsx fetches via `window.scanAPI.getFileInsights`; `.catch` resets loading (stuck-skeleton bug fixed).
- Settings system (issues.md perf pass): `electron/settings.ts` owns `settings.json` in userData (`AppSettings`: reduceMotion, dialogBlur, decodeConcurrency 1–6, overscan 100–1200; defaults false/true/4/600). IPC: `settings:get` → `{settings, exists}` (exists:false = first launch → renderer adopts OS `prefers-reduced-motion`); `settings:set` → partial patch, persists, and `applyConcurrencySettings` re-sizes the sharp/ffmpeg semaphores live (`sharpConcurrency`, `ffmpegConcurrency` ≈ half). Settings page = `SettingsModal.tsx` (gear icon in Header tool cluster); Performance Mode is a *derived* preset (reduceMotion && !dialogBlur && conc×2 && overscan LOW 200), not a stored flag. Renderer defaults in `src/renderer/settingsDefaults.ts` (mirrors main's). Root div carries `seele-reduce-motion` / `seele-no-blur` classes (index.css: kills `[class*="animate-"]` + `.crt-overlay`, switches `.shimmer` to `shimmer-pulse` opacity animation, strips all `backdrop-filter`). MasonryGrid `overscan` prop (default 600) feeds the three view windows. No `transition-all` left in the codebase — all scoped (arbitrary `transition-[...]` utilities).
- Scan runs in a worker (`electron/scanWorker.ts`); progress coalesced in `useScanState` (150ms last-write-wins); `media-cache.json` persisted under userData (`AppData\Roaming\seele`).
- Context menus: sidebar tree rows get `onFolderContextMenu` threaded Sidebar → DirectoryExplorer → FolderTreeNode (preventDefault + stopPropagation; row span `flex-1 truncate` had none before — fixed in 2b88982). Folder-view cards use FolderBrowser → App `folderContextMenu`.

## Session Continuity (start of new session)
- Repo: branch `v2.5.2` (created from `v2.5.1`; **nothing committed yet** — all v2.5.2 work is uncommitted in the working tree).
- The dev app MAY still be running from a previous session: check `Get-CimInstance Win32_Process` for `electron.exe` and `node.exe` with "Wiergise" in CommandLine, and `Get-NetTCPConnection -LocalPort 5173` before relaunching. If running, HMR/tsc-watch are live; main-process changes still need an electron-only restart. Log: `%TEMP%\opencode\seele-dev3.log` (v2.5.2 sessions used `seele-dev-v252.log`).
- **DO NOT blanket-kill recent `node`/`cmd` processes to stop electron** — it kills the vite dev server too, causing `ERR_CONNECTION_REFUSED` + white screen. Kill only `electron.exe` processes; relaunch `npm run dev` (concurrently starts vite + tsc --watch + electron) via `Start-Process` with `ELECTRON_ENABLE_LOGGING=1` and redirected logs.
- New issue/feature lists arrive as markdown files (e.g. `*.md` at repo root). Read them, then VERIFY each claim against the code before fixing (Operating Rule above).
- Verification commands: `npm run typecheck:renderer`, `npm run typecheck:electron`, `npm run lint`, `npm test` (35 tests), `npm run build`.

## v2.5.2 Work (in progress — NOT COMMITTED, branch v2.5.2)
Spec: `ui-upgrade.md` (fully implemented) + MediaViewer layout rework. Pending user "commit" confirmation before committing; commit style `feat(v2.5.2): ...`.

### Implemented (ui-upgrade.md + layout rework)
- **Trash queue (staged, session-only)**: `queueForTrash`/`restoreFromQueue`/`deleteFromQueue`/`emptyTrashQueue` in App.tsx; `TrashQueueModal.tsx` (restore / delete-forever / two-stage empty confirm); `useScanState` gained `addFiles` action + `onAddFiles`; `ActivityEntry` gained `fromPath`/`toPath` (ActivityLog.tsx). No `shell.trashItem` until "Delete Forever"/"Empty Queue". REVERT in SessionChangesModal only for `move`/`rename`.
- **Viewer keyboard (MediaViewer)**: native window listener; Del/Backspace → queue+advance; F favorite; M move; Shift+F2/Ctrl+R rename; Ctrl+Z undo; viewer surrenders when `modalOpen` (move/rename dialogs or trash queue). App-level keydown gate: `if (viewerIndexRef.current !== null) return;` (after `inEditable` check). **Plain R stays "reload failed thumbnails" (App.tsx global); plain F2 stays grid rename-selected.** `advanceViewer` runs BEFORE `onRemoveFiles` (reads `derivedFilesRef`); `handleTrashSelected` uses `derivedFilesRef.current` (TDZ fix — never reference `derivedFiles` before its declaration). KeyboardHelp legend updated.
- **Auto-advance** in viewer; **persistent controls** (were inside slide-in panel, now moved into new side panel).
- **MediaViewer layout rework**: media stage wrapped in `flex flex-1 min-h-0` main row; old bottom metadata panel + action bar REPLACED by a right side panel (`SIDE_PANEL_W = 248`, transition width+opacity, `pointer-events-none` when closed, inner content fixed at SIDE_PANEL_W so no reflow). Sections: 1. FILE (MetaItem label-value rows — label above value), 2. PALETTE (6-swatch strip; ANALYZING pulse / UNAVAILABLE states), 3. QUICK ACTIONS (`ActionRow` rows: Favorite amber ★/☆, Move lime ⇥, Rename cyan ✎, Trash red ⌫; icon+label left, key hint kbd right; tone colors via ACTION_TONES map). Local helpers: `Hairline` (h-px bg-nerv-border/40), `ActionRow` (color prop amber|lime|cyan|red). Footer: `{queuedCount} STAGED FOR TRASH`. Top bar: logo + page counter + FIT + "Hide Info" toggle (showMetadata) + Close — inline filename/metadata removed from top bar.
- **Filmstrip**: thumb `h-14 w-14` → `h-10 w-10` (60→40px); container restyled to thin dock `py-1` (was `py-2`), still full width under image+panel, horizontal scroll; spacer step `40 + 6` (was `56 + 6`); amber active border + bottom accent kept.
- **Palette**: `medianCutPalette` 4 → 6 colors (electron/main.ts — visual target 5–6 swatches; main-process change, needed electron restart). Renderer: `paletteCacheRef` Map<path, Swatch[]|null>, coalescing drain loop (`paletteFetchingRef` + `wantedPalettePathRef`), `currentFilePathRef` guard, gated on `showMetadata`; fetch via `window.scanAPI.getFileInsights`. **Palette swatch keys MUST be `${hex}-${i}` (index-suffixed)** — median cut can return duplicate hexes (#000000) → duplicate React key warning at MediaViewer.tsx:754 (fixed).
- Verified: typecheck renderer+electron, lint, 35 tests, build — all green. White screen incident: caused by killing vite, not code.

### Pending / Caveats
- Commit of all v2.5.2 work (approved by user, not yet executed).
- Watch for: duplicate React keys from derived hex colors; `npm run dev` full relaunch if vite dies.

## Recent v2.5.1 Commits
- `bda3cf9` feat: settings page (Performance Mode / Reduce Motion / Dialog Blur / Decode Concurrency / Scroll Buffer), settings.json persistence + settings:get/set IPC, live sharp/ffmpeg semaphore resizing, settings-driven masonry overscan, scoped transitions (no transition-all left), reduced-motion shimmer + OS prefers-reduced-motion.
- `deb50d2` docs: session-continuity notes.
- `0ade0e2` perf: windowed masonry rendering (O(visible) via binary-search columns + arithmetic rows), async thumbnail cache I/O, render-path optimizations (memoization, deferred folder tree, batch favorite updates, progress coalescing).
- `8f48ca5` chore: rename Wiergise → seele.
- `2b88982` fix: sidebar folder context menu; median-cut color spectrum (was 4× identical washed-out average); disk cache eviction.
- `3f78659` chore: deleted stale docs/reports.
- `2538867` chore: restored AGENT_MEMORY.md.
- v2.5 module work (a1c6d2d + earlier): FolderBrowser, RenameDialog, BatchTagDialog, tags system, session changes export (`SessionChangesModal` → `seele-session-*.json`).
