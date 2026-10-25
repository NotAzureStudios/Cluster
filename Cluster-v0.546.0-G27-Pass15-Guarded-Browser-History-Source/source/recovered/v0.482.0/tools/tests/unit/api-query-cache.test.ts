import assert from "node:assert/strict";
import test from "node:test";
import { api, invalidateApiQueries, queryApi } from "../../../packages/renderer/src/core/api";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

function installBrowserClock() {
  Object.assign(globalThis, { window: globalThis });
}

test.afterEach(() => {
  invalidateApiQueries();
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.assign(globalThis, { window: originalWindow });
});

test("queryApi deduplicates in-flight reads and reuses fresh results", async () => {
  installBrowserClock();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ calls }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const [first, second] = await Promise.all([
    queryApi<{ calls: number }>("/api/cache-test", { staleMs: 5_000 }),
    queryApi<{ calls: number }>("/api/cache-test", { staleMs: 5_000 })
  ]);
  const third = await queryApi<{ calls: number }>("/api/cache-test", { staleMs: 5_000 });

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test("successful mutations invalidate cached reads", async () => {
  installBrowserClock();
  let reads = 0;
  globalThis.fetch = async (_input, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (method === "GET") reads += 1;
    return new Response(JSON.stringify({ method, reads }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await queryApi("/api/projects", { staleMs: 60_000 });
  await queryApi("/api/projects", { staleMs: 60_000 });
  assert.equal(reads, 1);

  await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "Cache invalidation" }) });
  await queryApi("/api/projects", { staleMs: 60_000 });
  assert.equal(reads, 2);
});
