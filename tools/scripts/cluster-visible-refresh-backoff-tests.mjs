import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(sourcePath, imports = {}) {
  const original = fs.readFileSync(path.join(root, sourcePath), "utf8");
  const transpiled = ts.transpileModule(original, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal((transpiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function("require", "module", "exports", transpiled.outputText)(specifier => {
    assert.ok(Object.hasOwn(imports, specifier), "Unexpected test dependency: " + specifier);
    return imports[specifier];
  }, module, module.exports);
  return module.exports;
}
const policy = load("packages/renderer/src/core/refresh-backoff.ts");
const job = load("packages/renderer/src/core/visible-job-polling.ts", { "./refresh-backoff.js": policy });

let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log("PASS " + name); }
function failure(status, retryAfterSeconds) {
  return Object.assign(new Error("request rejected"), { status, retryAfterSeconds });
}
await check("exponential retry grows without exceeding bounded normal failure window", () => {
  assert.equal(policy.refreshRetryDelayMs(1_000, 0, null, 0), 1_000);
  assert.equal(policy.refreshRetryDelayMs(1_000, 1, new Error("offline"), 0), 2_000);
  assert.equal(policy.refreshRetryDelayMs(1_000, 2, new Error("offline"), 0), 4_000);
  assert.equal(policy.refreshRetryDelayMs(1_000, 20, new Error("offline"), 0), 60_000);
});
await check("429/503 Retry-After is a lower bound and independent of request jitter", () => {
  assert.equal(policy.refreshRetryDelayMs(1_000, 1, failure(429, 45), 0), 45_000);
  assert.ok(policy.refreshRetryDelayMs(1_000, 1, failure(429, 45), 1) >= 45_000);
  assert.equal(policy.refreshRetryDelayMs(1_000, 1, failure(503, 20), 0), 20_000);
  assert.equal(policy.refreshRetryDelayMs(1_000, 1, failure(400, 45), 0), 2_000);
  assert.equal(policy.refreshRetryDelayMs(5_000, 4, failure(429, 600), 0), 300_000);
});

function browser(start = 100_000) {
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  const previous = new Map(["window", "document", "navigator"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let now = start;
  let nextId = 0;
  const timers = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const add = (map, name, fn) => { const set = map.get(name) || new Set(); set.add(fn); map.set(name, set); };
  const remove = (map, name, fn) => { map.get(name)?.delete(fn); };
  const window = {
    setTimeout(fn, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + Math.max(0, Number(delay)), fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { add(windowListeners, name, fn); },
    removeEventListener(name, fn) { remove(windowListeners, name, fn); },
  };
  const document = {
    visibilityState: "visible",
    addEventListener(name, fn) { add(documentListeners, name, fn); },
    removeEventListener(name, fn) { remove(documentListeners, name, fn); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window, writable: true });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document, writable: true });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true }, writable: true });
  Date.now = () => now;
  Math.random = () => 0;
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  async function advance(ms) {
    const target = now + ms;
    let steps = 0;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      if (++steps > 2_000) throw Error("Unbounded retry loop");
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = target;
    await flush();
  }
  async function visible(state) {
    document.visibilityState = state;
    for (const fn of documentListeners.get("visibilitychange") || []) fn();
    await flush();
  }
  async function fire(event) {
    for (const fn of windowListeners.get(event) || []) fn();
    await flush();
  }
  function cleanup() {
    Date.now = originalDateNow;
    Math.random = originalRandom;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  return { advance, flush, visible, fire, cleanup, get timers() { return timers.size; } };
}

await check("job poll respects 429 during hide/show then resumes its normal interval", async () => {
  const fake = browser();
  let stop = () => {};
  try {
    const calls = [];
    stop = job.startVisibleJobPolling(async () => {
      calls.push(Date.now());
      if (calls.length === 1) throw failure(429, 30);
    }, 1_000);
    await fake.flush();
    assert.equal(calls.length, 1);
    await fake.advance(5_000);
    await fake.visible("hidden");
    assert.equal(fake.timers, 0, "hidden document has no running poll timer");
    await fake.advance(5_000);
    await fake.visible("visible");
    assert.equal(calls.length, 1, "visibility does not bypass 429");
    await fake.advance(19_999);
    assert.equal(calls.length, 1);
    await fake.advance(1);
    assert.equal(calls.length, 2, "first retry occurs after server window");
    await fake.advance(1_000);
    assert.equal(calls.length, 3, "normal interval restored after success");
    stop();
    assert.equal(fake.timers, 0);
  } finally { stop(); fake.cleanup(); }
});
await check("job poll exponentially backs off on repeated failures and stops cleanly", async () => {
  const fake = browser();
  let stop = () => {};
  try {
    let calls = 0;
    stop = job.startVisibleJobPolling(async () => {
      calls += 1;
      if (calls <= 2) throw new Error("network unavailable");
    }, 1_000);
    await fake.flush();
    assert.equal(calls, 1);
    await fake.advance(1_999);
    assert.equal(calls, 1);
    await fake.advance(1);
    assert.equal(calls, 2);
    await fake.advance(3_999);
    assert.equal(calls, 2);
    await fake.advance(1);
    assert.equal(calls, 3);
    await fake.advance(1_000);
    assert.equal(calls, 4, "recovery restores 1-second fallback");
    stop();
    await fake.advance(60_000);
    assert.equal(calls, 4, "disposed polling never wakes");
  } finally { stop(); fake.cleanup(); }
});
await check("workspace focus/visibility refresh shares the same 429 backoff", async () => {
  const fake = browser();
  let cleanup = () => {};
  try {
    const react = {
      useRef: initial => ({ current: initial }),
      useEffect: run => { cleanup = run() || (() => {}); },
    };
    const hooks = load("packages/renderer/src/core/visible-refresh.ts", {
      react, "./refresh-backoff.js": policy,
    });
    let calls = 0;
    hooks.useVisibleRefresh(async () => {
      calls++;
      if (calls === 1) throw failure(429, 25);
    }, { intervalMs: 5_000, minimumGapMs: 0 });
    await fake.advance(5_000);
    assert.equal(calls, 1);
    await fake.advance(11_000);
    await fake.fire("focus");
    await fake.visible("hidden");
    assert.equal(fake.timers, 0, "hidden fallback keeps no timers");
    await fake.visible("visible");
    assert.equal(calls, 1, "focus and visibility cannot bypass server window");
    await fake.advance(13_999);
    assert.equal(calls, 1);
    await fake.advance(1);
    assert.equal(calls, 2);
    await fake.advance(5_000);
    assert.equal(calls, 3, "successful workspace retry resets to baseline");
    cleanup();
    assert.equal(fake.timers, 0);
  } finally { cleanup(); fake.cleanup(); }
});
console.log(checks + "/" + checks + " visible refresh retry budget tests passed");
