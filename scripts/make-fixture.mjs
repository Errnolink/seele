/**
 * Build a hermetic Seele test library for the E2E smoke suite.
 *
 *   node scripts/make-fixture.mjs [baseDir]
 *
 * Creates real, decodable images in `<baseDir>/seele-fixture` and an
 * isolated Electron profile in `<baseDir>/seele-userdata` seeded to point
 * at it. The user's real library and `%APPDATA%\seele` are never touched —
 * the app is launched with `--user-data-dir` pointing at the throwaway
 * profile, so there is nothing to back up or restore.
 *
 * Prints the resolved paths as JSON for the caller.
 */
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? path.join(os.tmpdir(), "seele-e2e");
const ROOT = path.join(BASE, "seele-fixture");
const SUB = path.join(ROOT, "sub");
const USERDATA = path.join(BASE, "seele-userdata");

fs.rmSync(ROOT, { recursive: true, force: true });
fs.rmSync(USERDATA, { recursive: true, force: true });
fs.mkdirSync(SUB, { recursive: true });
fs.mkdirSync(USERDATA, { recursive: true });

// Distinct sizes + hues: real aspect-ratio variety for the masonry packer,
// and visually distinguishable tiles when debugging by eye.
const SPEC = [
  { name: "alpha.jpg", w: 800, h: 600, rgb: { r: 220, g: 60, b: 60 } },
  { name: "bravo.jpg", w: 600, h: 900, rgb: { r: 60, g: 200, b: 90 } },
  { name: "charlie.png", w: 500, h: 500, rgb: { r: 70, g: 130, b: 240 } },
  { name: "delta.jpg", w: 1200, h: 500, rgb: { r: 240, g: 190, b: 40 } },
  { name: "echo.jpg", w: 700, h: 700, rgb: { r: 190, g: 70, b: 220 } },
  { name: "foxtrot.png", w: 400, h: 650, rgb: { r: 40, g: 210, b: 210 } },
];
// A subfolder gives the tree, FOLDERS view and move-target picker something
// real to work with.
const SUB_SPEC = [
  { name: "golf.jpg", w: 640, h: 480, rgb: { r: 255, g: 140, b: 0 } },
  { name: "hotel.jpg", w: 480, h: 640, rgb: { r: 120, g: 120, b: 120 } },
];

async function make(dir, spec) {
  for (const s of spec) {
    const img = sharp({
      create: { width: s.w, height: s.h, channels: 3, background: s.rgb },
    });
    const out = path.join(dir, s.name);
    await (s.name.endsWith(".png") ? img.png() : img.jpeg({ quality: 90 })).toFile(out);
  }
}

await make(ROOT, SPEC);
await make(SUB, SUB_SPEC);

fs.writeFileSync(
  path.join(USERDATA, "settings.json"),
  JSON.stringify(
    {
      reduceMotion: false,
      dialogBlur: true,
      decodeConcurrency: 4,
      overscan: 600,
      roots: [ROOT],
    },
    null,
    2,
  ),
);

const list = (d) => fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).isFile());
console.log(JSON.stringify({ BASE, ROOT, SUB, USERDATA, root: list(ROOT), sub: list(SUB) }, null, 2));
