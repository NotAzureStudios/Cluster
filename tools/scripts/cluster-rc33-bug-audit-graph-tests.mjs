import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTs(path, dependencies = {}) {
  const source = fs.readFileSync(path, "utf8");
  const transformed = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(`(function(require, module, exports) { ${transformed.outputText}\n})`, { Date, Map, Set, Promise, Number, Math, String, document: { visibilityState: "visible" } })(
    (name) => { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import: ${name}`); }, module, module.exports,
  );
  return module.exports;
}
const base = new URL("../../", import.meta.url).pathname;
const graph = loadTs(`${base}packages/renderer/src/components/telemetry-trend.ts`);
let history = [];
const first = { at: 1700000000000, requestP95Ms: 40, databaseP95Ms: 10 };
history = graph.appendTrendSample(history, first);
assert.equal(history.length, 1);
assert.equal(graph.appendTrendSample(history, first), history, "cached snapshots should not create chart points or unnecessary renders");
assert.equal(graph.appendTrendSample(history, { ...first, at: first.at - 1 }), history, "older samples must not reverse time");
for (let n = 1; n < 90; n++) history = graph.appendTrendSample(history, { at: first.at + n * 1000, requestP95Ms: n, databaseP95Ms: n / 2 });
assert.equal(history.length, 60, "memory history must be bounded");
assert.equal(history.at(-1).requestP95Ms, 89);
history = graph.appendTrendSample(history, { at: first.at + 100000, requestP95Ms: Number.POSITIVE_INFINITY, databaseP95Ms: -1 });
assert.equal(history.at(-1).requestP95Ms, null);
assert.equal(history.at(-1).databaseP95Ms, null);
console.log("PASS: chart histories are bounded, deduplicate cached snapshots, and discard invalid metrics");

let resolved = null;
const requests = [];
const cache = new Map();
const background = new Map();
const mkDeferred = () => { let resolve; const promise = new Promise((done) => resolve = done); return { promise, resolve }; };
const q = loadTs(`${base}packages/renderer/src/core/api/query.ts`, {
  "../offline-storage": { getOfflineScope: () => "account-test", readCachedResponse: async () => null, writeCachedResponse: async () => {} },
  "../performance": { recordPerformanceMetric: () => {} },
  "./transport": { api: () => { const deferred = mkDeferred(); requests.push(deferred); return deferred.promise; } },
  "./errors": { ApiError: class ApiError extends Error {}, isApiNetworkFailure: () => false, isOnline: () => true },
  "./cache": { backgroundRevalidations: background, currentSessionCacheGeneration: () => 0, queryCache: cache, setQueryCache: (key, value) => cache.set(key, value) },
  "./live-search-authorization": { requiresFreshSearchAuthorization: () => false },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const path = "/api/projects";
const key = `account-test:${path}`;
const loading = q.queryApi(path, { persist: false });
await tick();
assert.equal(requests.length, 1);
cache.delete(key); // simulated mutation/realtime invalidation
requests[0].resolve({ stale: true });
await tick();
assert.equal(requests.length, 2, "invalidated read must request fresh data");
requests[1].resolve({ version: "recovered" });
assert.equal((await loading).version, "recovered", "old data must not reach the active view");
assert.equal(cache.has(key), false, "stale foreground response must not restore an invalidated cache entry");
console.log("PASS: invalidation defeats an earlier foreground read and recovers fresh data");

const pending = q.queryApi(path, { persist: false });
await tick();
assert.equal(requests.length, 3);
cache.set(key, { value: { version: "new" }, staleAt: Date.now() + 100000, expiresAt: Date.now() + 100000, tags: [] });
requests[2].resolve({ version: "old" });
await pending;
assert.equal(cache.get(key).value.version, "new", "older response must not overwrite a newer optimistic/confirmed cache update");
console.log("PASS: late network result does not overwrite a newer cache update");

cache.set(key, { value: { version: "old" }, staleAt: 0, expiresAt: Date.now() + 100000, tags: [] });
assert.equal((await q.queryApi(path, { persist: false })).version, "old");
assert.equal(requests.length, 4);
cache.delete(key);
requests[3].resolve({ version: "obsolete" });
await tick();
assert.equal(cache.has(key), false, "stale background revalidation must not restore deleted cache entry");
console.log("PASS: invalidation defeats an earlier background revalidation");

let storageWrites = 0;
const secondCache = new Map();
const online = loadTs(`${base}packages/renderer/src/core/api/query.ts`, {
  "../offline-storage": { getOfflineScope: () => "account-test", readCachedResponse: async () => null, writeCachedResponse: async () => { storageWrites++; throw new Error("quota exceeded"); } },
  "../performance": { recordPerformanceMetric: () => {} },
  "./transport": { api: async () => ({ ok: true }) },
  "./errors": { ApiError: class ApiError extends Error {}, isApiNetworkFailure: () => false, isOnline: () => true },
  "./cache": { backgroundRevalidations: new Map(), currentSessionCacheGeneration: () => 0, queryCache: secondCache, setQueryCache: (key, value) => secondCache.set(key, value) },
  "./live-search-authorization": { requiresFreshSearchAuthorization: () => false },
});
assert.equal((await online.queryApi("/api/home", { persist: true })).ok, true);
await tick();
assert.equal(storageWrites, 1, "successful network requests still attempt background durability");
console.log("PASS: rejected durable-cache writes do not invalidate successful online reads");

const modified = [
  "packages/renderer/src/core/api/query.ts",
  "packages/renderer/src/core/api/cache.ts",
  "packages/renderer/src/components/TelemetryTrendChart.tsx",
  "packages/renderer/src/components/telemetry-trend.ts",
  "packages/renderer/src/features/operations/ServerPerformancePanel.tsx",
  "packages/renderer/src/features/operations/ClientPerformancePanel.tsx",
];
for (const name of modified) {
  const source = fs.readFileSync(`${base}${name}`, "utf8");
  const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(syntax.parseDiagnostics.length, 0, `${name} must parse as TS/TSX`);
}
console.log("PASS: all changed TypeScript/TSX files parse");
