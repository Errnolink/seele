# Seele — Syncthing phone-sync setup

Keep your phone's camera roll, downloads, and screenshots in Seele automatically. The phone pushes to the PC via Syncthing; Seele watches the destination folders and re-scans them when new files land.

## Layout

One Syncthing destination folder **per phone directory**, as siblings on the PC:

```
D:\Jevesh\Oneplus-12\
├── Pictures\      ← phone Pictures / DCIM/Camera → Seele root
├── Downloads\     ← phone Downloads             → Seele root
└── Screenshots\   ← optional                    → Seele root
```

**Single-root variant**: a phone that pushes one folder containing category subdirectories (e.g. `Onepiss 12\` with `Screenshots/`, `Wallpaper/`, `Pixez/`, …) works the same — add that one folder as a Seele root and browse the categories via the folder tree.

Add each destination folder to Seele via the sidebar **LIBRARY ROOTS → ADD ROOT** (or drop it onto the window). Seele merges all roots into one library.

## Phone (Android Syncthing app)

For each directory:

1. Add Folder (e.g. ID `phone-pictures`, path `Pictures` or `DCIM/Camera`).
2. **Folder Type: Send Only** — deletes never propagate to the PC (the PC copy is append-only, so Seele never sees files vanish), and the phone never accepts files you re-organize on the PC.
3. Add the PC device as a receiver.

Repeat per directory (`phone-downloads` → `Downloads`, `phone-screenshots` → `Screenshots`, …).

## PC (Syncthing desktop)

For each phone folder:

1. Add Folder with the **matching folder ID** (e.g. `phone-pictures`), path `D:\Jevesh\Oneplus-12\Pictures`.
2. **Folder Type: Receive Only** — mirrors the phone direction and pins the contents to exactly what the phone pushed.

## How it plays with Seele

- Syncthing's markers (`.stfolder`, `.stignore`, `.stversions`) and partial downloads (`~syncthing~*.tmp`) are **ignored by Seele's watcher** — only completed files trigger a re-scan.
- The watcher **debounces 2s per root**: a sync burst collapses into one re-scan of that root. Scans of different roots run concurrently.
- New files appear in the grid within seconds of the sync completing.
- First time: let the initial sync finish, then add the roots. Seele restores each root from its cache instantly and re-scans in the background.

## What the watcher does and doesn't do

- Watches **only the configured roots** — new roots are picked up on `settings:set` (or restart).
- Re-scans the **affected root** on change (full walk, debounced). A root whose directory doesn't exist yet is skipped until it appears.
- Because the phone folder is send-only, deletes almost never arrive; if a file is removed on the PC side, the re-scan drops it from the library too.
