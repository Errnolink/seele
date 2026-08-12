# Seele — Development

Setup, commands, workflow, verification, and machine-specific gotchas.

## Prerequisites

- Node.js ≥ 24 (this machine: 24.18.0), npm.
- **ffmpeg on PATH** — required for video thumbnails (and HEIC fallback). Seele finds it via `where ffmpeg` / `which ffmpeg` at first use. This machine: `C:\msys64\ucrt64\bin\ffmpeg.exe` (MSYS2) or the WinGet link. Without it, video tiles show `NO THUMBNAIL` and R can't help.
- Windows PowerShell execution policy blocks npm/pip scripts — run npm through `cmd /c`, e.g.:

```powershell
cmd /c "cd /d C:\Users\Chef\Documents\Errnolink\Seele && npm run typecheck"
```

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

## Dev workflow

- **Renderer edits** (`src/renderer/**`, `src/scanner/**` consumed by the renderer) → apply via HMR on the vite dev server. No restart needed.
- **Main-process edits** (`electron/**`) → require an electron restart only. **Never kill the vite/tsc watch processes** — restart just the electron instance (`stop-server seele-electron` / relaunch, per the server-manager skill).
- **Preload edits** (`electron/preload.ts`) → electron restart (the bridge is injected at window load).
- The window loads `VITE_DEV_SERVER_URL` in dev (and opens detached DevTools) or `dist/index.html` in production (`npx electron .` with no env var).

## Verification (run before finishing any change)

```powershell
cmd /c "cd /d C:\Users\Chef\Documents\Errnolink\Seele && npm run typecheck && npm run lint && npm test && npm run build"
```

All four must pass. Main-process changes specifically need `npm run build:electron` to validate the CJS output (typecheck alone doesn't catch require/ESM issues — see chokidar v5).

## Running production mode

```powershell
cmd /c "cd /d C:\Users\Chef\Documents\Errnolink\Seele && npx electron ."
```

Loads the built `dist/index.html` + `dist-electron/electron/main.js`. For a testable instance add `--remote-debugging-port=9223` and drive it over CDP (below).

## UI smoke testing (no native dialogs)

Native folder pickers can't be automated. To test with specific roots:

1. Back up the user's real state, then seed `settings.json`:
   `%APPDATA%\seele\settings.json` → set `"roots": ["C:\\…\\root-a", …]`. (`media-cache.json` optional — the app re-scans.)
2. Start vite + electron with CDP: `npx vite --port 5173`, then `npx electron . --remote-debugging-port=9222` (optionally with `VITE_DEV_SERVER_URL=http://localhost:5173` for dev).
3. Drive via CDP. Working pattern (browser tool, `app.cdp_url`):
   ```js
   await wait(() => tab.evaluate(() => Boolean(document.querySelector("…"))));
   const txt = await tab.evaluate(() => document.body.innerText);
   ```
   There is no `document` in the run scope — always `tab.evaluate(...)`.
4. The watcher can be exercised by copying files into a root (sharp/ffmpeg generate test media; see `AppData/Local/Temp/seele-smoke2/gen-videos.js` pattern — write a temp `.js` and `node file.js`, because `node -e` quoting is unreliable through cmd/PowerShell).
5. **Restore** the user's real `settings.json` / `media-cache.json` from backups and quit the app before restoring (main flushes on quit; don't overwrite a live file).

## Machine gotchas

- **`node -e "…"` quoting breaks through cmd/PowerShell** — write a temp `.js` file and run `node file.js`.
- **Vite on Windows** with `@tailwindcss/vite` can silently serve an empty page; if the dev window is blank, check the vite log and reload.
- **Vite dev server binds `[::1]:5173`** — readiness probes on `127.0.0.1` may time out while `http://localhost:5173` works.
- **`npm approve-scripts` warnings** during install are non-fatal.
- **Reconcile watchers case**: `electron/main.ts` `reconcileWatchers` must iterate original-case root paths for `chokidarWatch` and the `library:rootChanged` poke. Lowercased keys there create duplicate roots (double tiles + cache entries). Watcher map keys may be normalized; the payload must not be.
- **Screenshots require a visible tab**; the working model can't read images anyway — use `document.body.innerText` / console instrumentation (`JSON.stringify`, objects print as `[object Object]`).
- **Trash-queue / undo (Ctrl+Z)** reverts moves/renames and restores staged trash within the session; it does not undelete from the OS trash.
