/**
 * CPU isolation certification for the compiled Node 24 server. Unlike the
 * source-level tests, this actually starts the bundled Search Worker thread.
 */
import assert from "node:assert/strict";
import { buildPostings, buildPostingsResponsive } from "../../apps/server/dist/domains/search/search-index-builder.js";
import { buildSearchPostings, searchPostingExecutorDiagnostics, stopSearchPostingWorker } from "../../apps/server/dist/domains/search/search-postings-executor.js";

const check = async (name, verify) => { await verify(); console.log("PASS", name); };
const canonical = (index) => [...index.entries()].map(([token, indices]) => [token, [...indices].sort((a, b) => a - b)]).sort((a, b) => a[0].localeCompare(b[0]));
const makeItems = count => Array.from({ length: count }, (_, i) => ({
  id: String(i),
  tokens: [
    "project", "board", "library", "team", "notification", "relationship",
    "alpha" + String(i % 700), "beta" + String(i % 50), "file" + String(i % 100),
  ],
}));
const original = {
  mode: process.env.CLUSTER_SEARCH_POSTINGS_WORKER,
  threshold: process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD,
};
try {
  await check("small indexes keep identical synchronous token postings", async () => {
    const items = makeItems(64);
    const baseline = buildPostings(items);
    const responsive = await buildPostingsResponsive(items);
    assert.deepEqual(canonical(responsive), canonical(baseline));
    assert.equal(searchPostingExecutorDiagnostics().workerStarts, 0);
  });

  await check("large postings use one real worker and exactly preserve full/prefix/bigram matches", async () => {
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER = "on";
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD = "256";
    const items = makeItems(2_200);
    const expected = canonical(buildPostings(items));
    let ticked = false;
    const nextTurn = new Promise(resolve => setImmediate(() => { ticked = true; resolve(); }));
    const result = await buildSearchPostings(items);
    await nextTurn;
    assert.equal(ticked, true);
    assert.deepEqual(canonical(result), expected);
    const stats = searchPostingExecutorDiagnostics();
    assert.equal(stats.workerStarts, 1);
    assert.equal(stats.workerBuilds, 1);
    assert.equal(stats.workerFailures, 0);
    assert.equal(stats.workerBusy, false);
  });

  await check("repeated large builds reuse one thread rather than spawning per request", async () => {
    const result = await buildSearchPostings(makeItems(2_200));
    assert.ok(result.get("project")?.has(2199));
    const stats = searchPostingExecutorDiagnostics();
    assert.equal(stats.workerStarts, 1);
    assert.equal(stats.workerBuilds, 2);
  });

  await check("worker opt-out uses cooperative slices with identical ranking postings", async () => {
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER = "off";
    const items = makeItems(900);
    const before = searchPostingExecutorDiagnostics().cooperativeBuilds;
    const result = await buildSearchPostings(items);
    assert.deepEqual(canonical(result), canonical(buildPostings(items)));
    assert.equal(searchPostingExecutorDiagnostics().cooperativeBuilds, before + 1);
  });

  await check("oversized transfer budget falls back cooperatively without creating another worker", async () => {
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER = "on";
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD = "256";
    const items = Array.from({ length: 300 }, (_, index) => ({ tokens: ["long" + String(index) + "z".repeat(16_000)] }));
    const before = searchPostingExecutorDiagnostics();
    const result = await buildSearchPostings(items);
    assert.equal(result.get(items[299].tokens[0])?.has(299), true);
    assert.equal(searchPostingExecutorDiagnostics().workerStarts, before.workerStarts);
    assert.equal(searchPostingExecutorDiagnostics().cooperativeBuilds, before.cooperativeBuilds + 1);
  });

  await check("worker termination during an index build preserves correctness via cooperative fallback", async () => {
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER = "on";
    process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD = "256";
    const items = makeItems(4_500);
    const before = searchPostingExecutorDiagnostics().cooperativeBuilds;
    const building = buildSearchPostings(items);
    await stopSearchPostingWorker();
    const completed = await building;
    assert.deepEqual(canonical(completed), canonical(buildPostings(items)));
    assert.ok(searchPostingExecutorDiagnostics().cooperativeBuilds >= before + 1);
  });

  await check("idle worker is explicitly terminable without leaking process lifetime", async () => {
    await stopSearchPostingWorker();
    const state = searchPostingExecutorDiagnostics();
    assert.equal(state.workerActive, false);
    assert.equal(state.workerBusy, false);
  });
} finally {
  await stopSearchPostingWorker();
  if (original.mode === undefined) delete process.env.CLUSTER_SEARCH_POSTINGS_WORKER;
  else process.env.CLUSTER_SEARCH_POSTINGS_WORKER = original.mode;
  if (original.threshold === undefined) delete process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD;
  else process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD = original.threshold;
}
console.log("Search CPU posting worker certification passed");
