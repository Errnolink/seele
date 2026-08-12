# Seele — Architecture

Local media scanner/browser (formerly Wiergise). Electron 33 + React 18 + TypeScript 5.7 + Vite 6, NERV tactical UI theme.

## Process model

```
┌─────────────────────────── main process (electron/main.ts) ───────────────────────────┐
│  BrowserWindow (sandboxed renderer)                                                   │
│  IPC handlers: scans, file ops, settings, shell, window controls                       │
│  media:// protocol server: sharp (images) + ffmpeg (video/HEIC) thumbnails             │
│  chokidar@3 watchers per library root (Syncthing auto-refresh)                         │
│  Owns settings.json + media-cache.json (flush on quit)                                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
        │ utilityProcess.fork(scanWorker.js)
        ▼
┌───────────── scanWorker (electron/scanWorker.ts) ─────────────┐
│  Runs src/scanner/scan.ts scanFolderStream in a child process │
│  Posts { batch | progress | metaBatch | done | error }        │
│  Exits 100ms after done so IPC flushes (v4 H-4)               │
└────────────────────────────────────────────────────────────────┘
        │ contextBridge (window.scanAPI)
        ▼
┌──────────────────────────── renderer (src/renderer) ──────────────────────────────────┐
│  React 18: virtualized MASONRY/GRID/LIST/SPLIT views, FOLDERS browser, viewer,        │
│  inspector, tag system, trash queue, command palette, analytics                        │
│  State: per-root scan reducer (useScanState), tags, favorites, selection, hidden dirs  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

The scanner runs in a `utilityProcess` fork so a 25k-file walk never blocks the main process event loop. The renderer is sandboxed (`contextIsolation` + `contextBridge`); all privileged work goes through the preload bridge.

## Directory map

| Path | Role |
| --- | --- |
| `electron/main.ts` | Main process: IPC, window, thumbnail server, watchers, settings/cache ownership |
| `electron/preload.ts` | `window.scanAPI` bridge; folder-routed scan event subscription |
| `electron/scanWorker.ts` | Utility-process wrapper around `scanFolderStream` |
| `electron/mediaCache.ts` | On-disk scan cache (`{ folders: Record<folder, { files, dims }> }`) |
| `electron/settings.ts` | `settings.json` read/write, validation, clamping |
| `src/scanner/scan.ts` | Tree walk: sync `readdirSync` enumeration + async metadata patch phase |
| `src/scanner/types.ts` | `MediaFile`, `MetaPatch`, `ScanProgress` — shared contracts |
| `src/scanner/extensions.ts` | `FILE_TYPE_BY_EXT`: ext → `"image"` / `"video"` |
| `src/scanner/sniff.ts` | `isHeicContent`, `isAnimatedGif` header sniffers |
| `src/scanner/cli.ts` | Standalone scan CLI (`npm run scan`) |
| `src/renderer/App.tsx` | App shell: keybindings, root management, scan orchestration, derived pipeline |
| `src/renderer/folderTree.ts` | `buildLibraryTree` (synthetic LIBRARY root) + `buildFolderTree` |
| `src/renderer/hooks/useScanState.ts` | Per-root scan reducer (`Record<root, RootScanState>`) |
| `src/renderer/hooks/*` | Leaf hooks: tags, favorites, selection, hidden folders, settings, viewer stage |
| `src/renderer/components/*` | Sidebar, views, viewer, modals, NERV-UI ports |
| `src/renderer/theme.css` / `index.css` | Tailwind v4 + NERV tokens (orange `#ff9830`, cyan `#20f0ff`) |

## Scan pipeline

1. Renderer calls `scanAPI.startScan(folder, onBatch, onProgress, onDone, onError, onMetaBatch)`.
2. Main: normalizes the root, **cancels any in-flight scan of the same root** (`activeScans` Map keyed by normalized path), forks `scanWorker.js`.
3. Worker streams to main: `batch` (chunks of `MediaFile[]` placeholders), `progress`, `metaBatch` (dimension patches), `done(total)`, `error(msg)`.
4. Main relays every event **tagged with the originating folder** (`{ folder, ...payload }`) and accumulates its own copy of the file list for the cache.
5. Preload subscribes per-`startScan` call and early-returns events whose `folder` doesn't match; listeners are removed when that scan settles (no handler leaks, concurrent roots stay distinct).
6. `onDone` → main writes the accumulated list into the media cache.

Each root scans independently and concurrently; re-scanning one root cancels only that root.

**Startup restore**: `scanAPI.loadCachedFiles(root)` returns the cached file list (validating that each file still exists on disk, dropping strays) so the gallery renders instantly; the live scan then streams behind it.

**Renderer state** (`useScanState`): a reducer over `Record<root, RootScanState>`, each root holding batches-of-batches + progress. The memoized flat file list is `Object.values(roots).flatMap(r => r.batches).flat()`. `onStart` replaces the root entry (clearing it); `onRestore` seeds from cache first. A per-root promise chain (`scanChainsRef` in App) serializes overlapping scan triggers so watcher pokes can't interleave restore/start/batch dispatches.

## Multi-root library model

- Roots live in `AppSettings.roots: string[]` (persisted `settings.json`, IPC `settings:get`/`settings:set`).
- Each root is scanned independently; the library view is the union.
- `buildLibraryTree(files, roots)` produces a synthetic **LIBRARY** node (`path: ""`, click → clear folder selection) wrapping one `buildFolderTree` per root, partitioned by `normPath.startsWith(normRoot + "/")`.
- Sidebar **LIBRARY ROOTS** section: per-root status dot, ✕ remove, ADD ROOT (native picker). Dropping a folder onto the window: under an existing root → navigate; otherwise → add as a new root.
- Cache keys are per-folder; the old single-folder cache shape is adopted once on load.
- `allowedRoots` (media:// whitelist) is **add-only** — roots accumulate so thumbnails of multiple roots (and cross-root moves) keep working.
- Files moved/renamed within or across roots: renderer patches its own state (`onRemoveFiles`/`onAddFiles`); the watcher stays consistent because removals of already-removed paths are no-ops and re-adds upsert by path.

## Watcher (Syncthing auto-refresh)

- One `chokidar@3` watcher per root (v3 pinned: v5 is ESM-only and crashes the CJS main with `ERR_REQUIRE_ESM`).
- `ignored: isSyncthingArtifact` — paths whose segments start with `.st` / `.syncthing` / `~syncthing~` (folder markers, version backups, partial downloads) never trigger a scan.
- Changes are debounced **2s per root** (`scheduleRootPoke` clears the prior timer) — a sync burst collapses into one event.
- On fire: main sends `library:rootChanged(root)` (original-case path) → the renderer re-scans **that root only**.
- `reconcileWatchers(roots)` runs at startup and on `settings:set`: starts/stops watchers to match `roots`, adds each root to `allowedRoots`, skips roots whose directory doesn't exist yet.
- **Gotcha (fixed in v2.7.0)**: watch + poke must iterate the **original-case** root paths. Iterating the lowercased `normalizeRoot` keys made the renderer treat the lowercase spelling as a second root — duplicate tiles and duplicate cache entries.

**Behavior**: a filesystem change triggers a **full re-scan of the affected root** (debounced). That is the simplest correct behavior for a Syncthing sink — a few files per delivery, correctness over delta bookkeeping. The walk is fast (sync enumeration, placeholders stream immediately) and the cache makes restarts cheap. A delta/incremental scan is a possible future optimization, not current behavior.

## Thumbnail pipeline

- Privileged custom scheme `media://` (`registerSchemesAsPrivileged`, registered before `app.whenReady()`).
- URL shape: `media://local/<percent-encoded-absolute-path>?w=<width>` — host is a fixed sentinel so Windows drive letters live in the pathname.
- Handler: validate host + decode + resolve + **`isUnderAllowedRoot`** (path-traversal guard against `allowedRoots`), then route by extension:
  - video → `serveVideoThumb`: ffmpeg extracts one frame at `-ss 1` (retry from `-ss 0` for sub-second clips), scaled to `w`; 8s timeout, concurrency-gated.
  - image → `serveResized`: sharp resize; HEIC/HEIF (sniffed by magic bytes, not extension) → ffmpeg full-res frame (no seek — tiled HEVC grids reject `-ss`/`-vf`) + sharp downscale; animated GIF → sharp-first animated decode.
  - failure → images fall back to the raw file stream; videos fall back to the raw video (which `<img>` can't decode → error tile → R retries).
- **Two-tier cache**:
  - RAM: LRU `Map`, max 150 entries.
  - Disk: sha1 of the cache key, sharded `%LOCALAPPDATA%\seele\Cache\thumbs\<2-hex>\<sha1>` on Windows (`userData/thumbs` elsewhere); budget 5000 files + byte cap, oldest-first eviction (`pruneThumbCache`, throttled to 1/min + at startup).
  - Cache keys are distinct per pipeline: `?w=` static, `?w=&vid=1` video, `?w=&gifanim=1` animated GIF, `?w=&heic=1` ffmpeg fallback. The renderer's `&retry=N` cache-buster is **never part of any key**.
- Encoding: resized JPEGs use plain libjpeg-turbo, **not mozjpeg**. mozjpeg buys ~20% smaller files for ~270ms/image of extra encode time (measured on 9400×4000 sources) — the wrong trade for a locally-served cache the user is actively waiting on, especially one that already has a byte budget + eviction. Alpha-bearing sources (PNG/GIF/WebP) still encode as PNG so transparency survives.
- Concurrency: sharp/ffmpeg semaphores sized from settings (`decodeConcurrency`; ffmpeg ≈ half). Header sniffing is memoized (size+mtime key) to avoid re-opening source files on cache hits.
- **Decode priority (v2.7.1)**: the sharp gate is a shared resource, so work that is not on screen must not race work that is. Opening a viewer image used to fire, simultaneously: the `?w=1920` preview, both neighbour prefetches, and `file:insights` (three more sharp ops) — four jobs for four permits, with the visible image given no priority. The renderer now holds the neighbour prefetch and the insights fetch until the current preview's `onLoad`. Measured contention removed: ~770ms per open on large sources.
- **Irreducible cost**: on 37MP sources (9400×4000) a single `?w=1920` decode is ~1.0s and cannot be optimized away — libvips' JPEG shrink-on-load *is* engaging (w=512 ≈ 870ms vs w=3840 ≈ 1830ms, so time scales with target), and `.rotate()` does not defeat it. First open of a given image pays this; every later open is a disk-cache hit, which is why scrolling (cached tile thumbs) feels smooth while first-open does not.
- **R key = reload failed thumbnails only**: bumps `reloadEpoch`; errored tiles re-request with `&retry=N` (fresh ffmpeg/sharp attempt — transient failures heal). It does **not** re-scan (that's Ctrl+Enter / the Header Scan button) — re-scanning would unmount the grid and the errored tiles' retry before it could fire.

## Data & cache contracts

### `settings.json` — `%APPDATA%\seele\settings.json` (userData, lowercase `seele`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `reduceMotion` | boolean | `false` | Disable decorative animations |
| `dialogBlur` | boolean | `true` | Backdrop blur on modals |
| `decodeConcurrency` | number | `4` | Sharp decodes (1–6); ffmpeg gets ~half |
| `overscan` | number | `600` | Masonry scroll overscan band (px) |
| `roots` | string[] | `[]` | Library roots (absolute paths, original case) |

Loaded values are clamped (`clampNumber`) so hand-edited files can't feed bogus values into the main process. `exists: false` on first launch lets the renderer adopt the OS reduced-motion default.

### `media-cache.json` — `%APPDATA%\seele\media-cache.json`

```jsonc
{
  "folders": {
    "C:\\Users\\…\\Pictures": {
      "files": [ /* MediaFile[] */ ],
      "dims": { "C:\\…\\a.jpg": { "width": 320, "height": 240 } }
    }
  }
}
```

Written on scan completion and dimension batches; flushed on quit. `recordDimensions` uses a flat `fileIndexByPath`; `removeFiles` filters every folder.

### MediaFile (src/scanner/types.ts)

`filePath` (native absolute), `normPath` (lowercased forward-slash for keys), `fileName`, `fileNameLower` (precomputed search key), `sizeBytes`, `birthtimeMs` + `birthtime`, `dateKey` (`YYYY-MM-DD` UTC), `fileType` (`"image" | "video"`), `width`/`height` (placeholder `0` until probed).

## IPC contract (`window.scanAPI`)

| Channel | Direction | Payload |
| --- | --- | --- |
| `dialog:selectFolder` | invoke → | `string \| null` |
| `scan:start` | invoke → | folder; events tagged `{ folder, ... }` stream back |
| `scan:cancel` | invoke → | optional folder; cancels one root or all |
| `scan:loadCached` | invoke → | `MediaFile[]` (existence-checked) |
| `scan:saveDimensions` | invoke → | `{ filePath, width, height }[]` |
| `library:rootChanged` | main → renderer | `root: string` (original case) |
| `shell:showItemInFolder` / `shell:openPath` | invoke → | guarded by `allowedRoots` |
| `file:insights` | invoke → | hash, dominant colors, EXIF camera |
| `file:move` / `file:moveBatch` / `file:rename` | invoke → | `FileOpResult[]` |
| `file:trash` / `file:trashBatch` | invoke → | staged trash (reversible) |
| `folder:create` / `dialog:pickMoveTarget` | invoke → | folder ops for moves |
| `clipboard:writeText` | invoke → | text |
| `win:minimize` / `win:maximize` / `win:close` | send | custom titlebar |
| `settings:get` / `settings:set` | invoke → | `{ settings, exists }` / merged settings |

## Security model

- Renderer sandboxed; no `nodeIntegration`; all privileged APIs behind `contextBridge`.
- `media://` and shell/file IPC are guarded by `isUnderAllowedRoot` against the add-only `allowedRoots` set (path-traversal reads of arbitrary locations are rejected).
- File operations resolve + re-check paths: both source and destination must resolve under an allowed root. Cross-root moves work (all library roots stay whitelisted); moves to arbitrary locations are rejected.
- `dialog:pickMoveTarget` also rejects (returns `null`) a directory outside every root, so the picker can only ever yield a destination `file:move` will accept. It previously returned the path and let the move fail with `forbidden`, surfacing as an unexplained failed move.
- Malformed URLs / bad payloads are rejected, not thrown, inside handlers.

## Data locations

| What | Where |
| --- | --- |
| Settings | `%APPDATA%\seele\settings.json` |
| Scan cache | `%APPDATA%\seele\media-cache.json` |
| Thumbnail disk cache | `%LOCALAPPDATA%\seele\Cache\thumbs\` (Windows) / `userData/thumbs` (POSIX) |
| Renderer localStorage | Electron userData (`wiergise:*` keys — kept intentionally, renaming wipes user state) |
