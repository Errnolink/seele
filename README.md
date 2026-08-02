# seele

Local media file scanner and browser (formerly Wiergise) — an Electron + React + TypeScript desktop app with a NERV tactical UI theme.

## Features

- Scan local folders and browse photos/videos at scale (~25k files) with virtualized masonry, grid, list, and split-inspector views
- Fullscreen file viewer with filmstrip navigation, zoom/pan, and keyboard controls
- Inspector panels (split view + fullscreen side panel) with tags, quick actions, file details, color spectrum, EXIF camera data, and file hash
- Tag system, favorites, move/rename/trash with a staged (reversible) trash queue and session-changes export
- Fast thumbnail pipeline: server-side sharp/ffmpeg resizing, RAM + disk caches with eviction
- Command palette, analytics, settings with performance mode / reduced motion / decode concurrency controls

## Development

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
| `npm test` | Vitest suite |
| `npm run build` | Build electron main + renderer into `dist-electron/` and `dist/` |

Media is served to the renderer through a custom `media://` protocol with server-side resize (`?w=`) so the UI never decodes full-resolution images on the main thread.

## Branches

- `main` — stable baseline
- `v2.5.x` — feature branches per milestone (e.g. `v2.5.2` adds the staged trash queue, viewer keyboard shortcuts, and unified inspector panels)
