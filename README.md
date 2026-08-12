# seele

Local media file scanner and browser (formerly Wiergise) — an Electron + React + TypeScript desktop app with a NERV tactical UI theme.

## Features

- **Multi-root library** — merge several folders (Syncthing-synced phone dirs like Pictures/DCIM/Downloads, external drives, etc.) into one browsable library. Roots are managed in the sidebar (**LIBRARY ROOTS**) or by dropping a folder onto the window; each root scans independently and concurrently
- **Auto-refresh on sync** — every root is file-watched; when Syncthing delivers new files, Seele re-scans the affected root automatically (2s debounce; Syncthing artifacts like `.stfolder`/`.stversions`/`~syncthing~*.tmp` ignored), so new photos appear without a manual re-scan
- Scan local folders and browse photos/videos at scale (~25k files) with virtualized masonry, grid, list, and split-inspector views
- Fullscreen file viewer with filmstrip navigation, zoom/pan, and keyboard controls
- Inspector panels (split view + fullscreen side panel) with tags, quick actions, file details, color spectrum, EXIF camera data, and file hash
- Tag system, favorites, move/rename/trash with a staged (reversible) trash queue and session-changes export
- **Nothing is deleted until you commit it** — `Delete` only stages files; they stay on disk and can be restored instantly. Emptying the queue needs a second confirm and sends files to the OS trash (recoverable from the Recycle Bin), never an unlink
- Fast thumbnail pipeline: server-side sharp/ffmpeg resizing, RAM + disk caches with eviction; on-screen media always gets decode priority over prefetch and metadata work
- Command palette (Ctrl+K), analytics, settings with performance mode / reduced motion / decode concurrency controls
- Keyboard-navigable throughout, with a visible focus ring, ARIA tree/dialog semantics, and an OS-reduced-motion default you can override

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Process model, scan pipeline, multi-root model, watcher, thumbnail server, cache & IPC contracts, security |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, dev workflow, verification, UI smoke testing, machine gotchas |
| [docs/SYNCTHING.md](docs/SYNCTHING.md) | Phone → PC Syncthing setup (send-only per dir, matching folder IDs, receive-only on PC) |

## Quick start

```bash
npm install
npm run dev        # vite (HMR) + tsc --watch + electron
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev app (vite on :5173, tsc watch, electron) |
| `npm run scan` | Run the scanner CLI |
| `npm run typecheck` | Typecheck renderer + electron projects |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest suite (60 unit tests) |
| `npm run build` | Build electron main + renderer into `dist-electron/` and `dist/` |
| `node scripts/make-fixture.mjs` + `node scripts/e2e-smoke.mjs` | End-to-end smoke suite — drives the real UI over CDP against a throwaway library and asserts on the filesystem. Zero dependencies |

Run production with `npx electron .` (loads the built `dist/` bundle; no dev server). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl+O` | Open folder / add root |
| `Ctrl+Enter` | Re-scan all roots |
| `R` | Reload failed thumbnails (errored tiles re-fetch; transient failures heal) |
| `Delete` | Queue selected for trash (staged — not deleted) |
| `M` | Move selected files |
| `F2` / `Shift+F2` / `Ctrl+R` | Rename (grid / viewer) |
| `Ctrl+Z` | Undo last move/rename; restore staged trash |
| `?` | Keyboard help |

Full list in the app (`?`).

## Syncthing phone-sync

One receive-only folder per phone directory, added to the library as roots (e.g. `D:\<Phone>\{Pictures, Downloads, Screenshots}`). Phone side is **send-only** so deletes never propagate. Step-by-step: [docs/SYNCTHING.md](docs/SYNCTHING.md).

## Architecture in brief

Main process (`electron/main.ts`) owns IPC, the `media://` thumbnail server (sharp for images, ffmpeg for video/HEIC), per-root chokidar watchers, and the on-disk settings + scan caches (`%APPDATA%\seele\`). Scans run in a `utilityProcess` fork (`scanWorker.ts` → `src/scanner/scan.ts`) streaming folder-tagged batches to the sandboxed React renderer, which merges per-root state into one virtualized gallery. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
