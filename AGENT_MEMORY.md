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
- Repo: branch `v2.5.1`, clean tree, in sync with `origin/v2.5.1` (last push: `e7633fb`).
- The dev app MAY still be running from a previous session: check `Get-CimInstance Win32_Process` for `electron.exe` and `node.exe` with "Wiergise" in CommandLine, and `Get-NetTCPConnection -LocalPort 5173` before relaunching. If running, HMR/tsc-watch are live; main-process changes still need an electron-only restart. Log: `%TEMP%\opencode\seele-dev3.log`.
- New issue/feature lists arrive as markdown files (e.g. `*.md` at repo root). Read them, then VERIFY each claim against the code before fixing (Operating Rule above).
- Verification commands: `npm run typecheck:renderer`, `npm run typecheck:electron`, `npm run lint`, `npm test` (35 tests), `npm run build`.

## Recent v2.5.1 Commits
- `bda3cf9` feat: settings page (Performance Mode / Reduce Motion / Dialog Blur / Decode Concurrency / Scroll Buffer), settings.json persistence + settings:get/set IPC, live sharp/ffmpeg semaphore resizing, settings-driven masonry overscan, scoped transitions (no transition-all left), reduced-motion shimmer + OS prefers-reduced-motion.
- `deb50d2` docs: session-continuity notes.
- `0ade0e2` perf: windowed masonry rendering (O(visible) via binary-search columns + arithmetic rows), async thumbnail cache I/O, render-path optimizations (memoization, deferred folder tree, batch favorite updates, progress coalescing).
- `8f48ca5` chore: rename Wiergise → seele.
- `2b88982` fix: sidebar folder context menu; median-cut color spectrum (was 4× identical washed-out average); disk cache eviction.
- `3f78659` chore: deleted stale docs/reports.
- `2538867` chore: restored AGENT_MEMORY.md.
- v2.5 module work (a1c6d2d + earlier): FolderBrowser, RenameDialog, BatchTagDialog, tags system, session changes export (`SessionChangesModal` → `seele-session-*.json`).
