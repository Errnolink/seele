/**
 * End-to-end smoke suite: drives the running Seele renderer over the Chrome
 * DevTools Protocol and asserts real filesystem state after each operation.
 *
 *   node scripts/make-fixture.mjs                       # build the fixture
 *   npx electron . --remote-debugging-port=9223 \
 *       --user-data-dir=<base>/seele-userdata           # launch against it
 *   node scripts/e2e-smoke.mjs 9223 <base>/seele-fixture
 *
 * See docs/DEVELOPMENT.md for the full recipe and its gotchas.
 *
 * No dependencies: Node 22+ ships a native WebSocket client. Every action
 * dispatches real DOM events on real elements, so the actual React handlers
 * and IPC round trips run — this is not a mock. Exits non-zero if any check
 * fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.argv[2] ?? "9223";
const ROOT =
  process.argv[3] ?? path.join(os.tmpdir(), "seele-e2e", "seele-fixture");
const SUB = path.join(ROOT, "sub");

if (!fs.existsSync(ROOT)) {
  console.error(`fixture missing at ${ROOT} — run: node scripts/make-fixture.mjs`);
  process.exit(2);
}

/* ---------------------------- CDP plumbing ---------------------------- */

let ws;
let msgId = 0;
const pending = new Map();

async function connect() {
  // Retry: the window may still be booting when we first poll.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find(
        (t) => t.type === "page" && !t.url.startsWith("devtools://"),
      );
      if (page?.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(ev.data);
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
          }
        });
        return page.url;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`no CDP page target on :${PORT} after 30s`);
}

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    // Hard timeout: if the renderer hot-reloads mid-run the socket dies and
    // the reply never arrives, which would otherwise hang the suite forever.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout on ${method} — did the renderer reload?`));
    }, 20000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Evaluate an expression in the renderer and return its value. */
async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      "renderer threw: " +
        (res.exceptionDetails.exception?.description ??
          JSON.stringify(res.exceptionDetails)),
    );
  }
  return res.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `expression` until it returns truthy, or throw. */
async function waitFor(label, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(expression);
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${label} (last value: ${JSON.stringify(last)})`);
}

/* ------------------------- renderer-side helpers ----------------------- */

// Injected once; gives the test concise accessors over the real DOM.
const HELPERS = `
window.__t = {
  tiles: () => [...document.querySelectorAll('[role="button"][title]')]
      .filter(el => el.getAttribute('draggable') === 'true'),
  tile: (name) => window.__t.tiles().find(el => el.title === name) || null,
  names: () => window.__t.tiles().map(el => el.title).sort(),
  // Click a real element with a real MouseEvent so React's synthetic
  // handler (and its modifier-key logic) actually runs.
  click: (el, init) => { el.dispatchEvent(new MouseEvent('click',
      Object.assign({bubbles:true, cancelable:true, view:window}, init))); },
  key: (k, init) => { window.dispatchEvent(new KeyboardEvent('keydown',
      Object.assign({key:k, bubbles:true, cancelable:true}, init))); },
  // The topmost open overlay, or null. Button lookups MUST be scoped:
  // a bare text/glyph search over the whole document also matches the
  // sidebar's "remove library root" button, which shares the ✕ glyph
  // with every modal close button.
  overlays: () => [...document.querySelectorAll('div.fixed.inset-0')]
      .filter(el => /z-\\[?\\d/.test(el.className)
               && (el.innerText||'').trim().length > 0
               && el.getBoundingClientRect().height > 0),
  modal: () => { const c = window.__t.overlays(); return c[c.length - 1] || null; },
  // Deterministic: the overlay containing this text. Several modals can be
  // mounted at once (one mid exit-animation), so "the last overlay" is not
  // reliable — address them by content instead.
  modalWith: (text) => window.__t.overlays()
      .find(el => new RegExp(text, 'i').test(el.innerText||'')) || null,
  find: (scope, text) => scope ? ([...scope.querySelectorAll('button')]
      .find(b => (b.textContent||'').trim().toUpperCase().includes(text.toUpperCase())) || null) : null,
  // Button inside the topmost modal.
  mbtn: (text) => window.__t.find(window.__t.modal(), text),
  // Button inside the modal identified by its content.
  qbtn: (inModal, text) => window.__t.find(window.__t.modalWith(inModal), text),
  // Button on the page, explicitly NOT inside any modal.
  pbtn: (text) => {
    const m = window.__t.modal();
    return [...document.querySelectorAll('button')].find(b =>
      (!m || !m.contains(b)) &&
      (b.textContent||'').trim().toUpperCase().includes(text.toUpperCase())) || null;
  },
  closeModal: (inModal) => {
    const m = inModal ? window.__t.modalWith(inModal) : window.__t.modal();
    if (!m) return 'no-modal';
    const b = [...m.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '\\u2715');
    if (!b) return 'no-close-button';
    window.__t.click(b);
    return 'closed';
  },
  selectTile: (name) => {
    const t = window.__t.tile(name);
    if (!t) return 'no-tile:' + name;
    const sel = [...t.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') === 'Toggle selection');
    if (!sel) return 'no-checkbox';
    window.__t.click(sel);
    return 'ok';
  },
  // React ignores a plain value assignment; go through the native setter.
  setInput: (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  },
  bodyText: () => document.body.innerText,
};
'ok'
`;

/* ------------------------------ assertions ----------------------------- */

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const onDisk = (dir, f) => fs.existsSync(path.join(dir, f));
const lsDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).isFile()).sort() : []);

/* -------------------------------- the run ------------------------------ */

const url = await connect();
await send("Runtime.enable");
await evaluate(`return ${JSON.stringify(url)};`);
console.log(`connected: ${url}\n`);
await evaluate(HELPERS);

// ---- 1. scan + restore -------------------------------------------------
const names = await waitFor(
  "8 tiles to render",
  `return (() => { const n = window.__t.names(); return n.length === 8 ? n : null; })();`,
  30000,
);
check("scan finds all 8 fixture files", names.length === 8, names.join(", "));

// ---- 2. favorite -------------------------------------------------------
await evaluate(`
  const t = window.__t.tile('alpha.jpg');
  const star = [...t.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Toggle favorite');
  window.__t.click(star);
  return 'ok';
`);
const favOk = await waitFor(
  "STARRED count to reach 1",
  `return /STARRED\\s*0*1\\b/.test(window.__t.bodyText()) ? 'yes' : null;`,
  5000,
).catch(() => null);
check("favorite toggles and counts in sidebar", favOk === "yes");

// ---- 3. selection ------------------------------------------------------
await evaluate(`return window.__t.selectTile('bravo.jpg');`);
const selOk = await waitFor(
  "batch toolbar",
  `return /001\\s*Selected/i.test(window.__t.bodyText()) ? 'yes' : null;`,
  5000,
).catch(() => null);
check("selecting a tile opens the batch toolbar", selOk === "yes");

// ---- 4. Delete key STAGES only (must not touch disk) --------------------
await evaluate(`window.__t.key('Delete'); return 'ok';`);
const staged = await waitFor(
  "trash queue badge",
  `return /TRASH QUEUE/i.test(window.__t.bodyText()) ? 'yes' : null;`,
  5000,
).catch(() => null);
const gridAfterStage = await evaluate(`return window.__t.names();`);
check("Delete stages the file (trash queue badge appears)", staged === "yes");
check(
  "staged file leaves the grid",
  !gridAfterStage.includes("bravo.jpg"),
  `grid: ${gridAfterStage.length} tiles`,
);
check(
  "staging does NOT delete from disk",
  onDisk(ROOT, "bravo.jpg"),
  "bravo.jpg still present",
);

// ---- 5. restore from queue --------------------------------------------
await evaluate(`window.__t.click(window.__t.pbtn('TRASH QUEUE')); return 'ok';`);
await waitFor("queue modal", `return /FILES ARE STAGED ONLY/i.test(window.__t.bodyText()) ? 'y' : null;`);
await evaluate(`window.__t.click(window.__t.qbtn('FILES ARE STAGED ONLY','RESTORE')); return 'ok';`);
const restored = await waitFor(
  "bravo back in grid",
  `return window.__t.names().includes('bravo.jpg') ? 'yes' : null;`,
  8000,
).catch(() => null);
check("restore returns the file to the grid", restored === "yes");
check("restore leaves the file on disk", onDisk(ROOT, "bravo.jpg"));

// close the (now empty) modal
check("modal closes cleanly", (await evaluate(`return window.__t.closeModal('FILES ARE STAGED ONLY');`)) === "closed");
await sleep(600);

// ---- 6. real deletion: stage then Empty Queue --------------------------
check(
  "select charlie.png",
  (await evaluate(`return window.__t.selectTile('charlie.png');`)) === "ok",
);
await sleep(300);
await evaluate(`window.__t.key('Delete'); return 'ok';`);
await waitFor("charlie staged", `return window.__t.names().includes('charlie.png') ? null : 'gone';`, 8000);
check("charlie.png staged, still on disk", onDisk(ROOT, "charlie.png"));

await evaluate(`window.__t.click(window.__t.pbtn('TRASH QUEUE')); return 'ok';`);
await waitFor("queue modal", `return /FILES ARE STAGED ONLY/i.test(window.__t.bodyText()) ? 'y' : null;`);
// Two-stage confirm: first click arms, second commits.
await evaluate(`window.__t.click(window.__t.qbtn('FILES ARE STAGED ONLY','EMPTY QUEUE')); return 'ok';`);
await waitFor("armed", `return /CONFIRM EMPTY/i.test(window.__t.bodyText()) ? 'y' : null;`, 5000);
check("Empty Queue requires a second confirm click", true, "armed state reached");
await evaluate(`window.__t.click(window.__t.qbtn('FILES ARE STAGED ONLY','CONFIRM EMPTY')); return 'ok';`);

let gone = false;
for (let i = 0; i < 40; i++) {
  if (!onDisk(ROOT, "charlie.png")) { gone = true; break; }
  await sleep(250);
}
check("Empty Queue actually deletes from disk", gone, "charlie.png removed from the library folder");

// ---- 7. rename ---------------------------------------------------------
await evaluate(`return window.__t.closeModal('FILES ARE STAGED ONLY');`);
await sleep(600);
check(
  "select delta.jpg",
  (await evaluate(`return window.__t.selectTile('delta.jpg');`)) === "ok",
);
await sleep(300);
await evaluate(`window.__t.key('F2'); return 'ok';`);
await waitFor("rename dialog", `return /Rename Media Designation/i.test(window.__t.bodyText()) ? 'y' : null;`);
await evaluate(`
  const m = window.__t.modalWith('Rename Media Designation');
  const input = m.querySelector('input[type="text"]');
  window.__t.setInput(input, 'delta-renamed');
  return 'ok';
`);
await sleep(300);
await evaluate(`window.__t.click(window.__t.qbtn('Rename Media Designation','SAVE RENAME')); return 'ok';`);
let renamed = false;
for (let i = 0; i < 40; i++) {
  if (onDisk(ROOT, "delta-renamed.jpg") && !onDisk(ROOT, "delta.jpg")) { renamed = true; break; }
  await sleep(250);
}
check("rename writes the new filename to disk", renamed, lsDir(ROOT).join(", "));

// ---- 8. search ---------------------------------------------------------
await evaluate(`
  const s = document.querySelector('input[placeholder="Search"]');
  window.__t.setInput(s, 'echo');
  return 'ok';
`);
const searched = await waitFor(
  "search to filter to 1 tile",
  `return window.__t.names().length === 1 && window.__t.names()[0] === 'echo.jpg' ? 'yes' : null;`,
  8000,
).catch(() => null);
check("search filters the grid", searched === "yes");
await evaluate(`
  const s = document.querySelector('input[placeholder="Search"]');
  window.__t.setInput(s, '');
  return 'ok';
`);
await sleep(600);

// ---- 9. view modes -----------------------------------------------------
for (const mode of ["GRID", "LIST", "FOLDERS", "SPLIT", "MASONRY"]) {
  await evaluate(`
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${mode}');
    if (b) window.__t.click(b);
    return 'ok';
  `);
  await sleep(700);
  const alive = await evaluate(`return document.querySelectorAll('*').length > 50 ? 'y' : null;`);
  check(`view mode ${mode} renders`, alive === "y");
}

/* -------------------------------- summary ------------------------------ */

console.log("\n--- disk state ---");
console.log("root:", lsDir(ROOT).join(", "));
console.log("sub: ", lsDir(SUB).join(", "));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
