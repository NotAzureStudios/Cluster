import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = "apps/server/src/domains/jobs/job-queue-service.ts";
const source = fs.readFileSync(path.join(root, sourcePath), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: sourcePath,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const mocks = {
  "node:crypto": require("node:crypto"),
  "../../core/reliability-context.js": { currentReliabilityContext: () => null },
  "../../core/cursor-pagination.js": { decodeCursor: () => null, encodeCursor: () => "" },
  "./job-types.js": { assertBackgroundJobTransition: () => {}, BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY: "__cluster_auth" },
  "../../core/postgres-advisory-lock.js": { acquireTransactionAdvisoryLock: async () => undefined },
};
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(
  name => { assert.ok(Object.hasOwn(mocks, name), "Unexpected runtime import " + name); return mocks[name]; },
  module, module.exports,
);
const { BackgroundJobQueue } = module.exports;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function makeQueue(read) {
  const db = { $queryRawUnsafe: read };
  return new BackgroundJobQueue(db);
}
const counts = (queued, running = 0) =>
  [{ status: "QUEUED", count: String(queued) }, { status: "RUNNING", count: String(running) }];
let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}

await test("64 parallel count readers generate exactly one PostgreSQL aggregation", async () => {
  const gate = deferred();
  let calls = 0;
  const queue = makeQueue(async () => { calls++; return gate.promise; });
  const readers = Array.from({ length: 64 }, () => queue.counts());
  assert.equal(calls, 1);
  assert.strictEqual(readers[0], readers[63], "pending readers share the same promise");
  gate.resolve(counts(5, 2));
  const result = await Promise.all(readers);
  assert.ok(result.every(row => row.queued === 5 && row.running === 2));
  assert.equal((await queue.counts()).queued, 5);
  assert.equal(calls, 1, "subsequent requests use the existing two-second cache");
});

await test("queue mutation invalidation starts a fresh read and prevents stale cache resurrection", async () => {
  const old = deferred(), current = deferred();
  let calls = 0;
  const queue = makeQueue(async () => (++calls === 1 ? old.promise : current.promise));
  const earlier = queue.counts();
  queue.invalidateCounts(); // Private only to TypeScript; exercises the real generation boundary.
  const newer = queue.counts();
  assert.equal(calls, 2, "mutation bypasses the old in-flight count read");
  current.resolve(counts(2, 11));
  assert.equal((await newer).running, 11);
  old.resolve(counts(100, 0));
  assert.equal((await earlier).queued, 100, "original caller retains its already-started result");
  assert.equal(queue.snapshot().running, 11, "an old result must not overwrite the newer cache");
  assert.equal((await queue.counts()).running, 11);
  assert.equal(calls, 2);
});

await test("forced fresh reads bypass cache and supersede older in-flight cache writers", async () => {
  const old = deferred(), current = deferred();
  let calls = 0;
  const queue = makeQueue(async () => (++calls === 1 ? old.promise : current.promise));
  const earlier = queue.counts();
  const forced = queue.counts(true);
  assert.equal(calls, 2);
  current.resolve(counts(9));
  assert.equal((await forced).queued, 9);
  old.resolve(counts(2));
  await earlier;
  assert.equal(queue.snapshot().queued, 9, "forced refresh is newest cache authority");
});

await test("failed count lookups do not poison the pending slot or TTL cache", async () => {
  const gate = deferred();
  let calls = 0;
  const queue = makeQueue(async () => (++calls === 1 ? gate.promise : counts(7)));
  const first = queue.counts(), second = queue.counts();
  gate.reject(new Error("postgres unavailable"));
  await assert.rejects(first, /postgres unavailable/);
  await assert.rejects(second, /postgres unavailable/);
  assert.equal((await queue.counts()).queued, 7);
  assert.equal(calls, 2);
});

const pressureQueries = {
  age: [{ oldestQueuedAt: new Date("2026-01-01T00:00:00.000Z"), oldestQueuedAgeMs: "1000" }],
  leases: [{ count: "3" }],
  queues: [{ queue: "media", status: "QUEUED", count: "5" }, { queue: "default", status: "RUNNING", count: "2" }],
};
function pressureRead(gate, calls) {
  return async (sql) => {
    calls.push(sql);
    await gate.promise;
    if (sql.includes('MIN("createdAt")')) return pressureQueries.age;
    if (sql.includes('"leaseExpiresAt" < NOW()')) return pressureQueries.leases;
    if (sql.includes('GROUP BY "queue", "status"')) return pressureQueries.queues;
    throw Error("Unexpected query: " + sql);
  };
}
await test("48 concurrent admin pressure readers share only three existing SQL queries", async () => {
  const gate = deferred(), calls = [];
  const queue = makeQueue(pressureRead(gate, calls));
  const readers = Array.from({ length: 48 }, () => queue.pressure());
  assert.equal(calls.length, 3, "one 3-query pressure snapshot for all concurrent readers");
  assert.strictEqual(readers[0], readers[47]);
  gate.resolve();
  const result = await Promise.all(readers);
  assert.equal(result[0].stalledLeases, 3);
  assert.equal(result[0].oldestQueuedAgeMs, 1000);
  assert.equal(result[0].byQueue.length, 2);
  assert.equal(result[0].byQueue.find(r => r.queue === "media").queued, 5);
  await queue.pressure();
  assert.equal(calls.length, 6, "pressure queries never cache completed results");
});

await test("pending pressure reads cannot cross a committed queue mutation", async () => {
  const gate = deferred(), calls = [];
  const queue = makeQueue(pressureRead(gate, calls));
  const previous = queue.pressure();
  queue.invalidateCounts();
  const next = queue.pressure();
  assert.equal(calls.length, 6, "new generation starts independent pressure sample");
  gate.resolve();
  await Promise.all([previous, next]);
});

await test("pressure failures are observed and do not permanently block refresh", async () => {
  let calls = 0;
  const queue = makeQueue(async sql => {
    calls++;
    if (calls <= 3) throw new Error("database unavailable");
    if (sql.includes('MIN("createdAt")')) return pressureQueries.age;
    if (sql.includes('"leaseExpiresAt" < NOW()')) return pressureQueries.leases;
    return pressureQueries.queues;
  });
  const first = queue.pressure(), second = queue.pressure();
  await assert.rejects(first, /database unavailable/);
  await assert.rejects(second, /database unavailable/);
  assert.equal(calls, 3);
  assert.equal((await queue.pressure()).stalledLeases, 3);
  assert.equal(calls, 6);
});

console.log(checks + "/" + checks + " queue read coalescing regression tests passed");
