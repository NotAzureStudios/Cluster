import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const file = "packages/renderer/src/core/api/query.ts";
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const transpiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}
function makeHarness({ online = true, read = "pending", search = false, networkError = null } = {}) {
  let generation = 0;
  const gate = deferred();
  const timers = new Map();
  let timerCounter = 0;
  let reads = 0;
  let apiCalls = 0;
  let writes = 0;
  let latest = null;
  const queryCache = new Map();
  const deps = {
    "../offline-storage": {
      getOfflineScope: () => "member-1",
      readCachedResponse: async () => {
        reads += 1;
        if (read === "pending") return gate.promise;
        if (read === "denied") throw new Error("IndexedDB blocked");
        return read;
      },
      writeCachedResponse: async () => { writes += 1; },
    },
    "../performance": { recordPerformanceMetric: () => undefined },
    "./transport": { api: async (p) => {
      apiCalls += 1;
      latest = { source: "network", path: p, sequence: apiCalls };
      if (networkError === "offline") throw new TypeError("Cluster server unreachable");
      if (networkError === "forbidden") throw Object.assign(new Error("Permission denied"), { status: 403 });
      return latest;
    } },
    "./errors": {
      ApiError: class ApiError extends Error {
        constructor(message, status, payload, requestId, code) {
          super(message); this.status = status; this.code = code;
        }
      },
      isApiNetworkFailure: (error) => error instanceof TypeError,
      isOnline: () => online,
    },
    "./cache": {
      queryCache,
      backgroundRevalidations: new Map(),
      currentSessionCacheGeneration: () => generation,
      setQueryCache: (key, value) => queryCache.set(key, value),
    },
    "./live-search-authorization": { requiresFreshSearchAuthorization: () => search },
  };
  const mod = { exports: {} };
  const wrapper = vm.runInNewContext(
    `(function (require, module, exports) { ${transpiled.outputText}\n })`,
    { Date, Promise, Map, Set, Math, String, Number, Error, DOMException, AbortController, console,
      setTimeout: (fn, ms) => { const id = ++timerCounter; timers.set(id, { fn, ms }); return id; },
      clearTimeout: (id) => timers.delete(id) },
  );
  wrapper((name) => {
    assert.ok(Object.prototype.hasOwnProperty.call(deps, name), "unknown module: " + name);
    return deps[name];
  }, mod, mod.exports);
  return {
    ...mod.exports,
    queryCache, timers,
    get reads() { return reads; },
    get apiCalls() { return apiCalls; },
    get writes() { return writes; },
    get latest() { return latest; },
    releaseRead: (value) => gate.resolve(value),
    nextTimer: () => {
      assert.equal(timers.size, 1, "one timer for one coalesced GET");
      const [[id, timer]] = timers.entries();
      timers.delete(id);
      timer.fn();
      return timer.ms;
    },
    rotateSession: () => { generation += 1; queryCache.clear(); },
  };
}

let count = 0;
async function test(name, run) { await run(); count++; console.log("PASS " + name); }
const durable = (value, fresh = true) => ({
  value, cachedAt: Date.now() - 1000,
  staleAt: Date.now() + (fresh ? 10_000 : -1000),
  expiresAt: Date.now() + 60_000, tags: ["project"],
});

await test("Cold online navigation starts server GET after bounded disk-cache budget", async () => {
  const h = makeHarness();
  const pending = h.queryApi("/api/projects", { staleMs: 10_000, maxAgeMs: 60_000 });
  await tick();
  assert.equal(h.reads, 1);
  assert.equal(h.apiCalls, 0);
  assert.equal(h.timers.size, 1);
  assert.equal(h.nextTimer(), h.ONLINE_DURABLE_READ_BUDGET_MS);
  await tick();
  assert.equal(h.apiCalls, 1);
  assert.equal((await pending).source, "network");
  assert.equal(h.queryCache.get("member-1:/api/projects")?.value?.source, "network");
  h.releaseRead(durable({ source: "late-stale-disk" }));
  await tick();
  assert.equal(h.queryCache.get("member-1:/api/projects")?.value?.source, "network",
    "late disk cannot overwrite fresh server response");
});
await test("Fresh disk hit wins immediately and cancels the network timer", async () => {
  const h = makeHarness({ read: durable({ source: "local", version: 2 }) });
  const item = await h.queryApi("/api/projects");
  assert.equal(item.source, "local");
  assert.equal(h.apiCalls, 0);
  assert.equal(h.timers.size, 0);
});
await test("Corrupt/denied disk reads fall back promptly to online GET", async () => {
  const h = makeHarness({ read: "denied" });
  const item = await h.queryApi("/api/boards");
  assert.equal(item.source, "network");
  assert.equal(h.apiCalls, 1);
  assert.equal(h.timers.size, 0);
});
await test("Offline navigation still waits for its cached copy and does not launch GET", async () => {
  const h = makeHarness({ online: false });
  const pending = h.queryApi("/api/projects");
  await tick();
  assert.equal(h.timers.size, 0, "offline must not drop durable data after 180ms");
  h.releaseRead(durable({ source: "offline" }));
  assert.equal((await pending).source, "offline");
  assert.equal(h.apiCalls, 0);
});
await test("Concurrent page consumers share one pending disk read and one network GET", async () => {
  const h = makeHarness();
  const p1 = h.queryApi("/api/projects");
  const p2 = h.queryApi("/api/projects");
  await tick();
  assert.equal(h.reads, 1);
  assert.equal(h.timers.size, 1);
  h.nextTimer();
  await tick();
  assert.equal(h.apiCalls, 1);
  assert.equal((await p1).sequence, 1);
  assert.equal((await p2).sequence, 1);
});
await test("Explicit refresh bypasses durable reads and their timer", async () => {
  const h = makeHarness();
  const fresh = await h.queryApi("/api/projects", { force: true });
  assert.equal(fresh.source, "network");
  assert.equal(h.reads, 0);
  assert.equal(h.timers.size, 0);
});
await test("Unpersisted view requests go straight to the server without a durable wait", async () => {
  const h = makeHarness();
  const fresh = await h.queryApi("/api/projects", { persist: false });
  assert.equal(fresh.source, "network");
  assert.equal(h.reads, 0);
});
await test("Search authorization bypass remains fresh and never reads old disk cache", async () => {
  const h = makeHarness({ search: true });
  const fresh = await h.queryApi("/api/search?q=private");
  assert.equal(fresh.source, "network");
  assert.equal(h.reads, 0);
});
await test("Session changes during slow disk read reject the old account's payload", async () => {
  const h = makeHarness();
  const result = h.queryApi("/api/permissions");
  await tick();
  h.rotateSession();
  h.nextTimer();
  await assert.rejects(result, (error) => error.code === "AUTH_CONTEXT_CHANGED");
  h.releaseRead(durable({ secret: "former-session" }));
  await tick();
  assert.equal(h.queryCache.size, 0);
});
await test("Browser online but Cluster server unreachable recovers a late valid durable snapshot", async () => {
  const h = makeHarness({ networkError: "offline" });
  const pending = h.queryApi("/api/projects", { staleMs: 10_000, maxAgeMs: 60_000 });
  await tick();
  assert.equal(h.nextTimer(), h.ONLINE_DURABLE_READ_BUDGET_MS);
  await tick();
  assert.equal(h.apiCalls, 1);
  assert.equal(h.timers.size, 1, "network failure opens one bounded disk recovery window");
  h.releaseRead(durable({ source: "offline-recovery", version: 4 }));
  assert.equal((await pending).source, "offline-recovery");
  assert.equal(h.timers.size, 0);
  assert.equal(h.queryCache.get("member-1:/api/projects")?.value?.source, "offline-recovery");
});
await test("Blocked durable storage and failed network still reject within two finite budgets", async () => {
  const h = makeHarness({ networkError: "offline" });
  const result = h.queryApi("/api/projects");
  await tick();
  assert.equal(h.nextTimer(), h.ONLINE_DURABLE_READ_BUDGET_MS);
  await tick();
  assert.equal(h.nextTimer(), h.FAILED_NETWORK_DURABLE_RECOVERY_MS);
  await assert.rejects(result, /Cluster server unreachable/);
  assert.equal(h.timers.size, 0);
});
await test("Permission denial must never fall back to a delayed cached result", async () => {
  const h = makeHarness({ networkError: "forbidden" });
  const result = h.queryApi("/api/permissions");
  await tick();
  h.nextTimer();
  await assert.rejects(result, /Permission denied/);
  assert.equal(h.timers.size, 0);
  h.releaseRead(durable({ secret: "revoked" }));
  await tick();
  assert.equal(h.queryCache.has("member-1:/api/permissions"), false);
});

await test("Source retains cache ownership and session guard after disk timeout", async () => {
  const s = read(file);
  assert.match(s, /const durableAttempt = persist && !options.force \? await readDurableForNavigation\(path\) : null/);
  assert.match(s, /generation === currentSessionCacheGeneration\(\)/);
  assert.match(s, /queryCache\.get\(memoryKey\)\?\.promise === promise/);
  assert.match(s, /requiresFreshSearchAuthorization\(path\)/);
  assert.equal(ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0);
});
console.log(count + "/" + count + " bounded durable-cache navigation checks passed");
