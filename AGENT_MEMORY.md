# AGENT MEMORY ÔÇö Wiergise Project

## Operating Rule (MANDATORY ÔÇö read every session start)

**ALWAYS TREAT THE CODE AS SOURCE OF TRUTH.**
- NEVER assume from memory.
- NEVER trust a prior summary, a prior "done", or a claimed edit state without reading the actual current code.
- ALWAYS verify by reading the real file contents before acting on any belief about what the code does.
- When a summary says "X was done," READ X and confirm it. Summaries lie; code doesn't.

This rule exists because prior work on this project produced a V5 review summary that claimed fixes were applied, but the actual code did not match ÔÇö e.g. the "thumbnail downscaling" was implemented in a way that made performance *worse* (synchronous full-res decode on the main thread), contradicting the summary's "fixed" claim. Verify everything.

## Project: Wiergise Media Scanner
- Electron + React + TypeScript media browser, NERV tactical UI theme.
- Branches: `ui/ux-upgrade` carries UI work + V5 review fixes.
- App run on Windows: `cmd.exe /c npm run dev` (npx/npm don't spawn in PTY directly). Vite on port 5173.
- Typecheck: `npm run typecheck` (renderer tsconfig.json + electron tsconfig.node.json).
- Build: `npm run build`.

## Key Architectural Notes
- Media served via custom `media://local/<encoded-path>` protocol in `electron/main.ts`.
- `?w=<width>` query param triggers server-side resize. Grid thumbnails use `?w=128..512`.
- Image resize MUST stay off the main thread. `nativeImage.createFromBuffer` is SYNC and decodes the full-res bitmap ÔÇö it freezes the Electron main process. Use `sharp` (libvips, off-thread) instead.
