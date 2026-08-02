# Seele — Viewer Overhaul & Trash Queue

Two linked issues found during review of `v2.5.1`. Ship in this order: **trash queue first**, then keyboard/layout — adding fast keyboard-driven trashing on top of today's instant, unqueued delete makes the app more dangerous, not better.

---

## Issue 1: No trash queue (staged/reversible delete)

### Current behavior
`electron/main.ts` — `file:trash` / `file:trashBatch` call `shell.trashItem(src)` **immediately** on every trash action. No staging, no confirmation, no in-app record that survives past the session log.

```ts
ipcMain.handle("file:trash", async (_e, filePath: string): Promise<FileOpResult> => {
  const src = path.resolve(filePath);
  if (!isUnderAllowedRoot(src)) return { filePath, ok: false, error: "forbidden" };
  try {
    await shell.trashItem(src);
    return { filePath, ok: true };
  } catch (err) { ... }
});
```

The app *looks* like it has undo — `SessionChangesModal` renders a "Revert" button per entry:

```tsx
// SessionChangesModal.tsx
{onRevert && entry.ok && ( ... revert button ... )}
```

But `onRevert` is optional and is **never passed** from `App.tsx`:

```tsx
<SessionChangesModal
  open={showSessionLog}
  entries={activityLog}
  onClose={() => setShowSessionLog(false)}
  onClear={() => { setActivityLog([]); setShowSessionLog(false); }}
  // onRevert not supplied
/>
```

Net effect: the revert button doesn't render. The audit trail is read-only. There is no way, from inside the app, to undo a trash action.

### Why this needs a queue, not just a revert function
Electron's `shell` module can send a file to the OS trash but has **no API to restore from it**. Once `shell.trashItem` runs, undoing it means shelling out to platform-specific trash-restore mechanisms — different per OS, fragile, not something the `shell` module gives you. So a "revert" button that fires *after* `shell.trashItem` has already run is fighting the platform.

The reliable fix is to **never call `shell.trashItem` until the user explicitly confirms** — i.e., stage deletions in an app-level queue first. That makes "undo" trivial (it's just app state, no disk operation ever happened) and makes the eventual real delete a deliberate, batched action.

### Proposed design
1. **Split "trash" into two actions.**
   Pressing `Delete` (or clicking Trash) no longer calls `file:trash` directly. It adds the file to an in-app `trashQueue` (e.g. `Map<filePath, { queuedAt: number }>`) and removes it from the active grid via the same `onRemoveFiles` mechanism already used elsewhere in `useScanState`. Visually identical to today — the file disappears from the grid immediately.

2. **A Trash Queue panel**, same UI pattern as the existing Session Log button:
   - Floating badge: `TRASH QUEUE (12)`
   - Opens a list of queued files with thumbnails (reuse `MediaCard`/thumbnail plumbing already in `MasonryGrid`)
   - Per row: **Restore** (pulls the file back into the active file set, no disk operation ever occurred) or **Delete Forever** (calls `file:trash` for just that file, now)

3. **"Empty Queue" batch action.**
   This is the only point where `file:trashBatch` actually runs and files leave disk. Add a confirmation dialog showing count + total size (you already compute aggregate size for the footer telemetry bar — reuse that).

4. **Auto-advance (see Issue 2) becomes safe once this exists.**
   Rapid Delete-Delete-Delete through a folder is fine because nothing is destructive until "Empty Queue" is explicitly pressed.

5. **Fix `onRevert` regardless.**
   Even with a trash queue, Move and Rename are real disk operations the instant they happen (not staged). A working revert for those is still valuable — wire `onRevert` in `App.tsx` to actually call the inverse operation (`file:move` back to original path, `file:rename` back to original name) instead of leaving the prop unset.

### Open questions to settle before building
- Does the queue persist across app restarts, or is it session-only? (Session-only is simpler and probably fine — but should be a deliberate choice, not a default.)
- Does closing the app with a non-empty queue prompt the user, silently discard the queue (files stay untouched, nothing was ever sent to OS trash), or auto-empty it? Recommend: silently discard — queued-but-uncommitted trash should behave like it never happened.
- Cap on queue size / age? Not urgent for a personal-use app, but worth a mental note if the queue is ever left open a long time.

---

## Issue 2: Viewer has no keyboard shortcuts, controls are mouse-only and hidden

### Current behavior
`MediaViewer.tsx`'s `handleKeyDown` only handles:
`ArrowLeft` / `ArrowRight` / `Escape` / `+` / `-` / `0` / `i` / `Space`

Move, Rename, and Trash exist **only** as click targets inside a top bar that fades out on mouse idle:

```tsx
<div className={`... transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
  {/* Move / Rename / Trash / Close buttons live here */}
</div>
```

`Delete` and `F2` do exist — but only at the `App.tsx` level, scoped to grid selection (`selectedIdsRef`). They are not part of `MediaViewer`'s own key handler and are effectively unreachable while the viewer overlay has focus.

Worse: the current Trash button calls `onTrash(file); onClose();` — **every trash action closes the viewer entirely.** There's no way to review 200 photos and trash the bad ones without reopening the lightbox 200 times.

`KeyboardHelp.tsx` doesn't list `Delete` or `F2` at all, so even the shortcuts that exist today aren't documented anywhere in the app.

### Proposed design

**A. Keyboard bindings inside `MediaViewer.handleKeyDown`**

| Key | Action |
|---|---|
| `Delete` / `Backspace` | Queue-trash current file (see Issue 1) → auto-advance to next |
| `F` | Toggle favorite (doesn't exist in the viewer at all today) |
| `M` | Open `MoveDialog` for current file |
| `Shift+F2` or `Ctrl+R` | Rename current — **do not bind plain `R`**, it's already global for "reload failed thumbnails" per `KeyboardHelp.tsx` |
| `Ctrl+Z` | Undo last action — wire to the same handler that fixes `onRevert` in Issue 1 |

**B. Auto-advance after every organizing action.**
Change trash/move handlers so they advance to the next file (or close only if it was the last file in the set) instead of unconditionally closing. This is the change that actually makes keyboard shortcuts useful for fast triage — shortcuts alone don't help if every action still kicks you back to the grid.

**C. Stop gating organizing controls behind mouse movement.**
Either:
- Move the action bar to a persistent bottom bar, matching the pattern already used for the grid's `BatchBar` (consistent with the rest of the app, always visible), or
- Split the fade behavior: keep zoom/info controls fading on idle, but keep Move/Rename/Trash always visible. Right now everything fades together, which means the exact controls needed for triage vanish the moment the user stops moving the mouse — which happens constantly once keyboard shortcuts are the primary interaction.

**D. Optional — a dedicated "review mode."**
Since the actual goal is *fast* organizing, consider binding number keys (`1`/`2`/`3`...) to either the existing tag system (`useTags`) or to preset destination folders, so sorting a file into a category is one keypress instead of Move → browse → pick → confirm. Pair with a small persistent counter ("47 remaining · 12 queued for trash · 3 moved this session") using data already tracked in the session audit trail.

**E. Fix the shortcut legend.**
Once A is implemented, add every new binding — and the pre-existing `Delete`/`F2` — to `KeyboardHelp.tsx`. A shortcuts panel missing half the real shortcuts is worse than none, since people stop trusting and stop checking it.

### Build order within this issue
1. Auto-advance (B) — cheapest, highest immediate impact, minimal risk
2. Keyboard bindings (A) — depends on Issue 1's queue for the `Delete` binding to be safe
3. Layout fix (C) — independent, can be done anytime
4. Shortcut legend (E) — do alongside A, not after
5. Review mode (D) — the real "massive change," build after 1–3 are solid

---

## Summary sequencing

1. **Trash queue** (Issue 1) — makes everything downstream safe
2. **Auto-advance** — cheap, high impact, now safe because of the queue
3. **Viewer keyboard shortcuts** — the actual "fast organizing" ask
4. **Layout: persistent action bar** — removes the mouse dependency
5. **Fix `onRevert` for Move/Rename**
6. **Shortcut legend update**
7. **Review mode / number-key quick-sort** — stretch goal once the above is solid
