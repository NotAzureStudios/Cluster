import assert from "node:assert/strict";
import { openPdfPrintFrame } from "../../packages/renderer/src/features/viewer/pdf-print-frame.ts";

function fixture() {
  const original = { window: globalThis.window, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const pending = new Map();
  const frames = [];
  const revoked = [];
  const cleanups = new Set();
  let id = 0;
  let printed = 0;
  globalThis.window = {
    setTimeout(fn, duration) { const token = ++id; pending.set(token, { fn, duration }); return token; },
    clearTimeout(token) { pending.delete(token); },
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "iframe");
      const frame = {
        onload: null, onerror: null, removed: false,
        contentWindow: { focus() {}, print() { printed++; } },
        remove() { this.removed = true; },
      };
      frames.push(frame);
      return frame;
    },
    body: { append() {} },
  };
  URL.createObjectURL = () => "blob:mock-" + (++id);
  URL.revokeObjectURL = (url) => revoked.push(url);
  const scope = {
    registerCleanup(fn) { cleanups.add(fn); return () => cleanups.delete(fn); },
    dispose() { for (const fn of [...cleanups]) fn(); cleanups.clear(); },
  };
  return {
    scope, frames, pending, revoked,
    printed: () => printed,
    fire(duration) { const item = [...pending.entries()].find(([, data]) => data.duration === duration); assert.ok(item); pending.delete(item[0]); item[1].fn(); },
    restore() { globalThis.window = original.window; globalThis.document = original.document; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; },
  };
}

const cases = [
  { name: "normal print", run(f) { openPdfPrintFrame(new Blob(["pdf"]), f.scope); f.frames[0].onload(); assert.equal(f.printed(), 1); f.fire(1800); } },
  { name: "missing load event", run(f) { openPdfPrintFrame(new Blob(["pdf"]), f.scope); f.fire(30000); assert.equal(f.printed(), 0); } },
  { name: "failed load", run(f) { openPdfPrintFrame(new Blob(["pdf"]), f.scope); f.frames[0].onerror(); } },
  { name: "viewer teardown", run(f) { openPdfPrintFrame(new Blob(["pdf"]), f.scope); f.scope.dispose(); } },
  { name: "immediate scope teardown", run(f) { const closed = { registerCleanup(fn) { fn(); return () => {}; } }; openPdfPrintFrame(new Blob(["pdf"]), closed); assert.equal(f.frames[0].src, undefined); } },
];
for (const c of cases) {
  const f = fixture();
  try {
    c.run(f);
    assert.equal(f.frames.length, 1, c.name);
    assert.equal(f.frames[0].removed, true, c.name);
    assert.equal(f.revoked.length, 1, c.name);
    assert.equal(f.pending.size, 0, c.name);
    f.scope.dispose();
    assert.equal(f.revoked.length, 1, "cleanup must be idempotent");
    console.log("PASS: " + c.name);
  } finally { f.restore(); }
}
