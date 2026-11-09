import assert from "node:assert/strict";
import { runClusterReadBaseline } from "./cluster-live-read-baseline.mjs";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}

await check("read-only route totals, 429 attribution and authentication status are grouped without response data", async () => {
  const statuses = [200, 429, 503, 401, 204, 200];
  let calls = 0;
  let secretSeen = false;
  const sample = await runClusterReadBaseline({
    baseUrl: "http://127.0.0.1:3000",
    paths: ["/health/live", "/api/notifications/summary?internal=SECRET_QUERY"],
    cookie: "cluster_session=SECRET_COOKIE",
    requests: statuses.length, concurrency: 1, delayMs: 100,
    sleep: async () => undefined,
    fetchImpl: async (url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers.cookie, "cluster_session=SECRET_COOKIE");
      if (url.includes("SECRET_QUERY")) secretSeen = true;
      const status = statuses[calls++];
      return new Response(null, { status, headers: {
        "X-Cluster-Rate-Limit-Bucket": status === 429 ? "api-live" : "not-applicable",
      } });
    },
  });
  assert.equal(calls, 6);
  assert.equal(secretSeen, true);
  assert.equal(sample.requests, 6);
  assert.equal(sample.routes.reduce((sum, item) => sum + item.requests, 0), 6);
  assert.equal(sample.routes.reduce((sum, item) => sum + item.rateLimited, 0), 1);
  assert.equal(sample.routes.reduce((sum, item) => sum + item.errors5xx, 0), 1);
  assert.equal(sample.routes.reduce((sum, item) => sum + item.authDenied, 0), 1);
  assert.equal(sample.routes[1].rateLimitBuckets["api-live"], 1);
  assert.ok(!JSON.stringify(sample).includes("SECRET_COOKIE"));
  assert.ok(!JSON.stringify(sample).includes("SECRET_QUERY"));
  assert.equal(typeof sample.routes[0].headerP95Ms, "number");
});

await check("unknown bucket values cannot escape into reports", async () => {
  const result = await runClusterReadBaseline({
    baseUrl: "http://localhost:3333", paths: ["/health"],
    requests: 1, concurrency: 1, delayMs: 100,
    fetchImpl: async () => new Response(null, { status: 429,
      headers: { "x-cluster-rate-limit-bucket": "private-user-id-with-secret" } }),
  });
  assert.deepEqual(result.routes[0].rateLimitBuckets, { unattributed: 1 });
  assert.ok(!JSON.stringify(result).includes("private-user-id"));
});

await check("request and concurrency caps protect the server from accidental floods", async () => {
  let active = 0, peak = 0, calls = 0;
  const result = await runClusterReadBaseline({
    baseUrl: "http://127.0.0.1:9876", requests: 9_999, concurrency: 99, delayMs: 0,
    paths: ["/health/ready"], sleep: async () => undefined,
    fetchImpl: async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(result.requests, 128);
  assert.equal(calls, 128);
  assert.ok(peak <= 4);
  assert.ok(result.peakConcurrency <= 4);
  assert.equal(result.delayMs, 100);
});

await check("benchmark refuses external origin shifts, non-GET paths and insecure remote credentials", async () => {
  const base = { baseUrl: "http://127.0.0.1:3000", requests: 1, fetchImpl: async () => new Response(null) };
  for (const path of ["//attacker.example/", "https://attacker.example/path", "/not-a-cluster-endpoint"]) {
    await assert.rejects(runClusterReadBaseline({ ...base, paths: [path] }));
  }
  await assert.rejects(runClusterReadBaseline({
    ...base, baseUrl: "http://cluster.example.com", paths: ["/health/live"],
    cookie: "session=SECRET",
  }), /HTTPS/);
  await assert.rejects(runClusterReadBaseline({
    ...base, baseUrl: "http://username:password@127.0.0.1:3000",
  }), /credentials/);
});

await check("response bodies are not downloaded into the benchmark", async () => {
  let cancelled = 0;
  const result = await runClusterReadBaseline({
    baseUrl: "http://localhost:2222", paths: ["/api/admin/operations/performance"],
    requests: 1, concurrency: 1, delayMs: 100,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers(),
      body: { cancel: async () => { cancelled++; } },
    }),
  });
  assert.equal(cancelled, 1);
  assert.equal(result.routes[0].successes, 1);
});

console.log(checks + "/" + checks + " live read baseline utility tests passed");
