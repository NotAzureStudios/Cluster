import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startVisibleJobPolling } from "../../packages/renderer/src/core/visible-job-polling.ts";
import { projectRevisionKey, planMissingProjectSnapshotBatches, projectSnapshotInvalidationTarget, projectSnapshotRetryDelayMs } from "../../packages/renderer/src/features/projects/project-snapshot-batching.ts";
import { buildWhiteboardConnectorAdjacency, selectedWhiteboardConnectorIds } from "../../packages/renderer/src/features/whiteboards/whiteboard-connector-adjacency.ts";

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
const delayedRetry = [...retry.timers.values()][0].delay;
assert.ok(delayedRetry >= 8_000 && delayedRetry <= 8_800,
  "a transient failure must back off with positive jitter instead of retrying at the original 4-second interval");
// The dedicated visible-refresh backoff suite advances a virtual clock to
// certify execution timing, 429 headers, focus recovery and subsequent success.
stopRetry();
assert.equal(retry.timers.size, 0);

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

assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "build", id: "b1", projectId: "p1" } }), "p1");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "calendar", id: "e1", projectId: "p1" } }), "p1");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "qa_session", id: "q1", projectId: "p2" } }), "p2");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "project", id: "p2" } }), "p2");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "team", id: "team-1", projectId: "p2" } }), "all");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "department", id: "d1", projectId: "p2" } }), "all");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "job_role", id: "r1" } }), "all");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "policy", id: "p1" } }), "all");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "file", id: "f1", projectId: "p1" } }), null);
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "approval", id: "a1", projectId: "p2" } }), "p2");
assert.deepEqual([1, 2, 3, 4, 5, 100].map(projectSnapshotRetryDelayMs), [5000, 10000, 20000, 40000, 60000, 60000]);
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "timeline", id: "t1" } }), "all");
assert.equal(projectSnapshotInvalidationTarget({ resource: { kind: "automation_run", id: "a1" } }), null);

const elements = [
  { id: "n1", type: "rectangle" },
  { id: "n2", type: "rectangle" },
  { id: "n3", type: "rectangle" },
  { id: "connector-a", type: "line", fromId: "n1", toId: "n2" },
  { id: "connector-b", type: "arrow", fromId: "n2", toId: "n1" },
  { id: "connector-loop", type: "line", fromId: "n1", toId: "n1" },
  { id: "connector-other", type: "line", fromId: "n3", toId: null },
  { id: "ordinary-shape", type: "sticky", fromId: "n1", toId: "n2" },
];
const adjacency = buildWhiteboardConnectorAdjacency(elements);
assert.deepEqual(adjacency.get("n1"), ["connector-a", "connector-b", "connector-loop"]);
assert.deepEqual(adjacency.get("n2"), ["connector-a", "connector-b"]);
assert.deepEqual([...selectedWhiteboardConnectorIds(new Set(["n1", "n2"]), adjacency)].sort(),
  ["connector-a", "connector-b", "connector-loop"]);
assert.deepEqual([...selectedWhiteboardConnectorIds(new Set(["n3"]), adjacency)], ["connector-other"]);
assert.equal(selectedWhiteboardConnectorIds(new Set(), adjacency).size, 0);

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const portfolio = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
const whiteboard = read("packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx");
const whiteboardViewport = read("packages/renderer/src/features/whiteboards/use-whiteboard-viewport.ts");
assert.equal((library.match(/startVisibleJobPolling\(refresh,/g) || []).length, 5);
assert.match(library, /const storageBytes = useMemo\(\(\) => items\.reduce/);
assert.match(library, /const currentFolder = folderById\.get/);
assert.match(library, /const expandableFolderIds = useMemo/);
assert.doesNotMatch(library, /window\.setInterval\(\(\) => void refresh\(\)/);
assert.match(portfolio, /planMissingProjectSnapshotBatches\(portfolioProjects, knownRevisions, 80\)/);
assert.match(portfolio, /Promise\.allSettled\(batches\.slice\(offset, offset \+ 2\)/);
assert.match(portfolio, /const projectSeedRevisionKey = useMemo/);
assert.match(portfolio, /const pinnedProjectSet = useMemo/);
assert.match(portfolio, /authority=\$\{portfolioAuthorityEpoch\}/);
assert.match(portfolio, /portfolioAuthorityEpoch > 0 \|\| deferredQuery\.trim\(\)/);
assert.match(portfolio, /setPortfolioAuthorityEpoch\(\(epoch\) => epoch \+ 1\)/);
assert.match(portfolio, /subscribeResourceChangeFeedResets\(\(\) => schedule\("all", true\)\)/);
assert.match(portfolio, /subscribeResourceChanges/);
assert.match(portfolio, /subscribeResourceChangeFeedResets/);
assert.match(portfolio, /projectSnapshotRefreshEpoch/);
assert.match(portfolio, /!loadedProjectIdsRef\.current\.has\(id\)/);
assert.match(portfolio, /document\.visibilityState === "visible"/);
assert.match(portfolio, /intervalMs: 180_000/);
assert.match(portfolio, /if \(attempts <= 4\)/);
assert.match(portfolio, /projectSnapshotRetryDelayMs\(attempts\)/);
assert.match(portfolio, /const queueSnapshotPublish = \(\) =>/);
assert.match(portfolio, /const requests = new AbortController\(\)/);
assert.match(portfolio, /\{ signal: requests\.signal \}/);
assert.match(portfolio, /requests\.abort\(\)/);
assert.match(portfolio, /!navigator\.onLine/);
assert.match(portfolio, /window\.addEventListener\("online", onOnline\)/);
assert.match(portfolio, /window\.removeEventListener\("online", onOnline\)/);
assert.match(portfolio, /publishTimer = window\.setTimeout\(\(\) =>/);
assert.match(portfolio, /const flushSnapshots = \(\) =>/);
assert.match(portfolio, /if \(changed\) queueSnapshotPublish\(\)/);
assert.match(portfolio, /if \(publishTimer\) window\.clearTimeout\(publishTimer\)/);
assert.match(portfolio, /!retryPending \|\| document\.visibilityState !== "visible"/);
assert.match(whiteboard, /buildWhiteboardConnectorAdjacency\(visibleElements\)/);
assert.match(whiteboard, /selectedWhiteboardConnectorIds\(selectedIds, connectorAdjacency\)/);
assert.match(whiteboard, /for \(const id of priorityElementIds\)/);
assert.match(whiteboard, /for \(const id of selectedConnectorIds\)/);
assert.match(whiteboard, /useVisibleTicker\(\(\) => setFacilitatorClock/);
assert.match(whiteboardViewport, /previous\.x === next\.x && previous\.y === next\.y/);
assert.match(whiteboardViewport, /frameRef\.current = null;/);
console.log("Cluster UI responsiveness: Library polling, Project snapshots and Whiteboard spatial priority contracts passed.");
