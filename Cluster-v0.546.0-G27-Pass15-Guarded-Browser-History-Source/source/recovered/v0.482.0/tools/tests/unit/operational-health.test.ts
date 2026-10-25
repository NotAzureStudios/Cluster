import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";

import { OperationalHealthHistory, WritableStorageProbe, assessOperationalHealth } from "../../../apps/server/src/core/operational-health.js";

const runtime = (overrides: any = {}) => ({
  requests: { total: 100, errors: 0, errorRate: 0, inFlight: 0, averageMs: 10, p95Ms: 20, maxMs: 40, slow: 0 },
  eventLoop: { meanMs: 3, p95Ms: 10, maxMs: 20 },
  memory: { rssMiB: 100, heapUsedMiB: 50, heapTotalMiB: 100, externalMiB: 5 },
  routes: [],
  ...overrides,
});

const database = { ok: true, checkedAt: new Date().toISOString(), latencyMs: 4, cached: false, timedOut: false, error: null };
const storage = { ok: true, checkedAt: new Date().toISOString(), latencyMs: 3, cached: false, failures: [] };

test("healthy readiness requires lifecycle, database, and writable storage", () => {
  const result = assessOperationalHealth({ serverReady: true, serverDraining: false, database, storage, runtime: runtime(), backgroundTasks: [] });
  assert.equal(result.ready, true);
  assert.equal(result.state, "healthy");
});

test("database or storage failure makes traffic unavailable", () => {
  const failedDatabase = { ...database, ok: false, error: "offline" };
  const result = assessOperationalHealth({ serverReady: true, serverDraining: false, database: failedDatabase, storage, runtime: runtime(), backgroundTasks: [] });
  assert.equal(result.ready, false);
  assert.equal(result.state, "unavailable");
});

test("runtime pressure degrades health without lying about dependency readiness", () => {
  const result = assessOperationalHealth({
    serverReady: true,
    serverDraining: false,
    database,
    storage,
    runtime: runtime({ eventLoop: { meanMs: 300, p95Ms: 400, maxMs: 800 } }),
    backgroundTasks: [],
  });
  assert.equal(result.ready, true);
  assert.equal(result.state, "degraded");
});

test("storage probe proves actual write and delete access and caches the result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-health-test-"));
  try {
    const probe = new WritableStorageProbe([{ key: "data", root }], { ttlMs: 60_000, timeoutMs: 2_000 });
    const first = await probe.check(true);
    assert.equal(first.ok, true);
    assert.equal(first.cached, false);
    const second = await probe.check();
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal((await fs.readdir(root)).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("operational transition history is bounded", () => {
  const history = new OperationalHealthHistory();
  for (let index = 0; index < 100; index += 1) {
    history.observe({
      state: index % 2 ? "degraded" : "healthy",
      ready: true,
      generatedAt: new Date(Date.now() + index).toISOString(),
      checks: [{ key: "runtime", status: index % 2 ? "warn" : "pass", detail: "test" }],
    });
  }
  assert.equal(history.snapshot().incidents.length, 64);
});
