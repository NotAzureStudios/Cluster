import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startVisibleJobPolling } from "../../packages/renderer/src/core/visible-job-polling.ts";
import { projectRevisionKey, planMissingProjectSnapshotBatches } from "../../packages/renderer/src/features/projects/project-snapshot-batching.ts";

function makeHarness(initialVisibility = "hidden") {
  let nextTimer = 1;
  const timers = new Map();
  const events = new Map();
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.document = {
    visibilityState: initialVisibility,
    addEventListener(type, listener) { events.set(type, listener); },
    removeEventListener(type, listener) { if (events.get(type) === listener) events.delete(type); },
  };
  return {
    timers,
    events,
    setVisibility(value) {
      globalThis.document.visibilityState = value;
      events.get("visibilitychange")?.();
    },
    tick() {
      const first = timers.entries().next().value;
      assert.ok(first, "expected a pending timer");
      timers.delete(first[0]);
      first[1].callback();
      return first[1].delay;
    },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

const h = makeHarness();
let calls = 0;
const stop = startVisibleJobPolling(() => { calls++; }, 2_500);
await settle();
assert.equal(calls, 0, "hidden pages must never refresh on activation");
assert.equal(h.timers.size, 0, "hidden pages must never retain wake timers");
h.setVisibility("visible");
await settle();
assert.equal(calls, 1);
assert.equal(h.timers.size, 1);
assert.equal(h.tick(), 2_500);
await settle();
assert.equal(calls, 2);
assert.equal(h.timers.size, 1, "only one timer is scheduled at a time");
h.setVisibility("hidden");
assert.equal(h.timers.size, 0);
h.setVisibility("visible");
await settle();
assert.equal(calls, 3, "restored visibility should refresh once");
stop();
assert.equal(h.timers.size, 0);
assert.equal(h.events.size, 0);
h.setVisibility("visible");
await settle();
assert.equal(calls, 3, "disposed polling loops cannot revive");

const inFlight = makeHarness("visible");
let release;
let started = 0;
const stopInFlight = startVisibleJobPolling(() => {
  started++;
  return new Promise((resolve) => { release = resolve; });
}, 6_000);
assert.equal(started, 1);
inFlight.setVisibility("hidden");
inFlight.setVisibility("visible");
assert.equal(started, 1, "visibility transitions must not overlap an in-flight request");
release();
await settle();
assert.equal(started, 2, "one recovery request is due after the in-flight request");
stopInFlight();
release();
await settle();
assert.equal(inFlight.timers.size, 0);

const retry = makeHarness("visible");
let attempts = 0;
const stopRetry = startVisibleJobPolling(async () => {
  attempts++;
  throw Error("temporary network failure");
}, 4_000);
await settle();
assert.equal(attempts, 1);
assert.equal(retry.timers.size, 1, "a transient failure should not kill a job tracker");
assert.equal(retry.tick(), 4_000);
await settle();
assert.equal(attempts, 2);
stopRetry();

const projects = Array.from({ length: 125 }, (_, index) => ({ id: "project-" + index, updatedAt: "rev1" }));
const revisions = new Map(projects.slice(0, 80).map((project) => [project.id, project.updatedAt]));
const batches = planMissingProjectSnapshotBatches(projects, revisions, 40);
assert.deepEqual(batches.map((batch) => batch.length), [40, 5]);
assert.deepEqual(batches.flat(), projects.slice(80).map((project) => project.id));
assert.equal(planMissingProjectSnapshotBatches(projects, new Map(projects.map((project) => [project.id, "rev1"]))).length, 0);
assert.deepEqual(planMissingProjectSnapshotBatches([projects[0], projects[0]], new Map(), 40), [[projects[0].id]]);
assert.deepEqual(planMissingProjectSnapshotBatches([{ id: "p", updatedAt: "rev2" }], new Map([["p", "rev1"]])), [["p"]]);
assert.notEqual(projectRevisionKey(projects), projectRevisionKey([...projects.slice(0, 2), { ...projects[2], updatedAt: "rev2" }, ...projects.slice(3)]));
assert.ok(batches.every((batch) => batch.length <= 40));

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const portfolio = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
assert.equal((library.match(/startVisibleJobPolling\(refresh,/g) || []).length, 5);
assert.doesNotMatch(library, /window\.setInterval\(\(\) => void refresh\(\)/);
assert.match(portfolio, /planMissingProjectSnapshotBatches\(portfolioProjects, knownRevisions, 40\)/);
assert.match(portfolio, /Promise\.allSettled\(batches\.slice\(offset, offset \+ 3\)/);
assert.match(portfolio, /const projectSeedRevisionKey = useMemo/);
assert.match(portfolio, /const pinnedProjectSet = useMemo/);
console.log("Cluster UI idle and portfolio performance: polling, pagination and source contracts passed.");
