# Seele — Development

Setup, commands, workflow, verification, and machine-specific gotchas.

## Prerequisites

- Node.js ≥ 24 (this machine: 24.18.0), npm.
- **ffmpeg on PATH** — required for video thumbnails (and HEIC fallback). Seele finds it via `where ffmpeg` / `which ffmpeg` at first use. On Windows, MSYS2 (`<msys2>\ucrt64\bin\ffmpeg.exe`) and the WinGet package both work. Without it, video tiles show `NO THUMBNAIL` and R can't help.
- npm scripts run **directly in PowerShell** on this machine (verified v2.7.1):

```powershell
cd <repo>; npm run typecheck
```

  Earlier revisions of this doc said the execution policy blocked npm and to
  wrap everything in `cmd /c "…"`. That is no longer true here, and the
  `cmd /c` form is actively worse: invoked from a non-interactive shell it
  can drop into an interactive prompt and hang instead of running.

## Commands

| Script | Purpose |
| --- | --- |
| `npm install` | Install deps. **`chokidar` stays at v3** — v5 is ESM-only and crashes the CJS Electron main with `ERR_REQUIRE_ESM`. If something pulls v5, pin again: `npm install chokidar@3`. |
| `npm run dev` | `concurrently` vite (HMR) + `tsc -p tsconfig.node.json --watch` + electron with `VITE_DEV_SERVER_URL=http://localhost:5173`. |
| `npm run scan` | Standalone scanner CLI (`tsx src/scanner/cli.ts`). |
| `npm run typecheck` | Renderer (`tsconfig.json`) + electron (`tsconfig.node.json`) typecheck. |
| `npm run lint` | ESLint (flat config). |
| `npm test` | Vitest (60 tests across 5 files as of v2.7.0). |
| `npm run build:electron` | `tsc -p tsconfig.node.json` → `dist-electron/`. |
| `npm run build:renderer` | `vite build` → `dist/`. |
| `npm run build` | Both, in order. |
| `node scripts/make-fixture.mjs` | Build the throwaway E2E library + isolated profile. |
| `node scripts/e2e-smoke.mjs <port> <fixtureRoot>` | Drive the running app over CDP; 21 checks, non-zero exit on failure. |

## Dev workflow

- **Renderer edits** (`src/renderer/**`, `src/scanner/**` consumed by the renderer) → apply via HMR on the vite dev server. No restart needed.
- **Main-process edits** (`electron/**`) → require an electron restart only. **Never kill the vite/tsc watch processes** — restart just the electron instance (`stop-server seele-electron` / relaunch, per the server-manager skill).
- **Preload edits** (`electron/preload.ts`) → electron restart (the bridge is injected at window load).
- The window loads `VITE_DEV_SERVER_URL` in dev (and opens detached DevTools) or `dist/index.html` in production (`npx electron .` with no env var).

## Verification (run before finishing any change)

```powershell
cd <repo>; npm run typecheck; npm run lint; npm test; npm run build
```

All four must pass. Main-process changes specifically need `npm run build:electron` to validate the CJS output (typecheck alone doesn't catch require/ESM issues — see chokidar v5). For behavioral changes to file ops or the grid, also run the E2E smoke suite below.

## Running production mode

```powershell
cd <repo>; npx electron .
```

Loads the built `dist/index.html` + `dist-electron/electron/main.js`. For a testable instance add `--remote-debugging-port=9223` and drive it over CDP (below).

## E2E smoke testing (`scripts/`)

Native folder pickers can't be automated, so the suite seeds an **isolated
profile** instead of touching the user's real state. Nothing needs backing
up or restoring.

```powershell
# 1. Build the throwaway library + profile (prints resolved paths)
node scripts/make-fixture.mjs                       # → %TEMP%\seele-e2e\

# 2. Launch a second instance against it, with CDP.
#    --user-data-dir redirects app.getPath("userData"), so this instance has
#    its own settings.json/media-cache.json. There is no single-instance
#    lock, so the user's app can stay open alongside it.
$env:VITE_DEV_SERVER_URL = 'http://localhost:5173'   # omit for prod mode
.\node_modules\electron\dist\electron.exe . `
  --remote-debugging-port=9223 `
  "--user-data-dir=$env:TEMP\seele-e2e\seele-userdata"

# 3. Drive it (21 checks; exits non-zero on failure)
node scripts/e2e-smoke.mjs 9223 "$env:TEMP\seele-e2e\seele-fixture"
```

`scripts/e2e-smoke.mjs` needs **no dependencies** — Node 22+ has a native
`WebSocket`, so it speaks CDP directly (`GET /json/list` → `webSocketDebuggerUrl`
→ `Runtime.evaluate`). It dispatches real `MouseEvent`/`KeyboardEvent`s on
real elements, so actual React handlers and IPC run, and asserts on the
**filesystem** after each op (staged delete leaves files on disk, restore
returns them, Empty Queue commits to the OS trash, rename/move land on disk).

### Gotchas that will bite you

- **Never edit `src/**` while the suite is running.** Vite HMR reloads the
  renderer, the CDP page target dies, and every in-flight request hangs. The
  harness has a 20s per-request timeout so this now fails loudly instead of
  hanging forever — but the run is still invalid.
- **Scope button lookups.** A document-wide search for the `✕` glyph also
  matches the sidebar's *remove library root* button; a naive close-modal
  click silently deleted the library root mid-run. Use the harness's
  `modalWith(text)` / `qbtn(modal, text)` / `pbtn(text)` helpers, which
  address dialogs by their content rather than by position or glyph.
- **`electron/**` edits need `npm run build:electron` + an instance restart**
  before the suite sees them; main-process code does not hot-reload.
- Set React input values through the native setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`)
  plus an `input` event — a plain `el.value = …` is ignored by React.

The watcher can be exercised by copying files into a fixture root while the
instance runs (2s debounce, then a re-scan of that root).

## Machine gotchas

- **`node -e "…"` quoting breaks through cmd/PowerShell** — write a temp `.js` file and run `node file.js`.
- **Vite on Windows** with `@tailwindcss/vite` can silently serve an empty page; if the dev window is blank, check the vite log and reload.
- **Vite dev server binds `[::1]:5173`** — readiness probes on `127.0.0.1` may time out while `http://localhost:5173` works.
- **`npm approve-scripts` warnings** during install are non-fatal.
- **Reconcile watchers case**: `electron/main.ts` `reconcileWatchers` must iterate original-case root paths for `chokidarWatch` and the `library:rootChanged` poke. Lowercased keys there create duplicate roots (double tiles + cache entries). Watcher map keys may be normalized; the payload must not be.
- **Screenshots require a visible tab**; the working model can't read images anyway — use `document.body.innerText` / console instrumentation (`JSON.stringify`, objects print as `[object Object]`).
- **Trash-queue / undo (Ctrl+Z)** reverts moves/renames and restores staged trash within the session; it does not undelete from the OS trash.
