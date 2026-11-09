/**
 * Bounded, read-only Cluster API baseline. No mutations, stored credentials,
 * request bodies, response bodies, or automatic deployment.
 *
 * Examples (PowerShell):
 *   $env:CLUSTER_BENCH_URL = 'http://127.0.0.1:3000'
 *   $env:CLUSTER_BENCH_PATHS = '/health/live,/health/ready'
 *   node tools/scripts/cluster-live-read-baseline.mjs
 *
 * Authenticated route testing is opt-in with CLUSTER_BENCH_COOKIE. Never print
 * a cookie or include one in benchmark output. Use HTTPS unless localhost.
 */
import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAFE_BUCKETS = new Set([
  "api", "api-admin", "api-library", "api-inventory", "api-timeline",
  "api-live", "api-mutation", "api-compatibility", "api-project-preview",
  "api-project-create", "api-project-progress", "search-user",
  "export-user", "external", "auth-transport", "security-transport",
  "unattributed",
]);
const num = (value, fallback, min, max) => {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? Math.max(min, Math.min(max, Math.round(valueNumber))) : fallback;
};
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(fraction * sorted.length) - 1].toFixed(2));
}
function safeBase(url) {
  const base = new URL(String(url));
  if (!["http:", "https:"].includes(base.protocol)) throw Error("Only HTTP(S) test servers are supported.");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw Error("Use only a server origin; do not include credentials, a path or query string.");
  }
  return base;
}
function safeRoute(value, base) {
  const pathAndQuery = String(value || "").trim();
  if (!pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//") || /[\u0000-\u001f\\#]/.test(pathAndQuery)) {
    throw Error("Read-only benchmark paths must be relative HTTP paths.");
  }
  const target = new URL(pathAndQuery, base);
  if (target.origin !== base.origin || !(target.pathname === "/health" || target.pathname.startsWith("/health/") || target.pathname.startsWith("/api/"))) {
    throw Error("Only same-origin Cluster health and API routes may be benchmarked.");
  }
  return { url: target.toString(), label: target.pathname };
}
function safeCookie(base, cookie) {
  if (!cookie) return null;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !loopback) throw Error("Authenticated benchmark traffic requires HTTPS except on localhost.");
  if (/[\r\n]/.test(cookie)) throw Error("Cookie contains an invalid newline.");
  return cookie;
}

/**
 * Does not log credentials or response data. Each task performs exactly one
 * GET with redirect handling disabled. Workload and concurrency are bounded.
 */
export async function runClusterReadBaseline(options) {
  const base = safeBase(options.baseUrl);
  const paths = (options.paths || ["/health/live", "/health/ready"]).map(p => safeRoute(p, base));
  if (!paths.length || paths.length > 8) throw Error("Provide between 1 and 8 read-only benchmark paths.");
  // Query strings are deliberately redacted in results. Never merge different
  // workloads under one indistinguishable report label.
  if (new Set(paths.map(p => p.label)).size !== paths.length) throw Error("Benchmark paths must have unique pathnames.");
  const cookie = safeCookie(base, options.cookie);
  const requests = num(options.requests, 24, 1, 128);
  const concurrency = num(options.concurrency, 2, 1, 4);
  const delayMs = num(options.delayMs, 250, 100, 2_000);
  const timeoutMs = num(options.timeoutMs, 10_000, 1_000, 60_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const byPath = new Map(paths.map(p => [p.label, {
    path: p.label, requests: 0, successes: 0, unexpected3xx: 0, rateLimited: 0,
    errors5xx: 0, authDenied: 0, otherHttpErrors: 0, networkErrors: 0,
    timings: [], buckets: {},
  }]));
  let cursor = 0;
  let peakConcurrency = 0;
  let active = 0;
  const startedAt = performance.now();
  const worker = async () => {
    while (cursor < requests) {
      const index = cursor++;
      const route = paths[index % paths.length];
      const stat = byPath.get(route.label);
      stat.requests++;
      active++;
      peakConcurrency = Math.max(peakConcurrency, active);
      const begin = performance.now();
      try {
        const headers = { accept: "application/json" };
        if (cookie) headers.cookie = cookie;
        const response = await fetchImpl(route.url, {
          method: "GET", redirect: "manual", cache: "no-store",
          headers, signal: AbortSignal.timeout(timeoutMs),
        });
        const elapsed = performance.now() - begin;
        // Measure only response-header latency; cancel the body. This never
        // accidentally streams entire Library files into a benchmark process.
        if (response.body && typeof response.body.cancel === "function") await response.body.cancel();
        // Redirects, cache validators and fast authorization denials must not
        // improve a performance report for the actual requested endpoint.
        if (response.status >= 200 && response.status < 300) {
          stat.successes++;
          stat.timings.push(elapsed);
        } else if (response.status >= 300 && response.status < 400) stat.unexpected3xx++;
        else if (response.status === 429) {
          stat.rateLimited++;
          const claimed = String(response.headers.get("x-cluster-rate-limit-bucket") || "unattributed").toLowerCase();
          const bucket = SAFE_BUCKETS.has(claimed) ? claimed : "unattributed";
          stat.buckets[bucket] = (stat.buckets[bucket] || 0) + 1;
        } else if (response.status === 401 || response.status === 403) stat.authDenied++;
        else if (response.status >= 500) stat.errors5xx++;
        else stat.otherHttpErrors++;
      } catch {
        stat.networkErrors++;
      } finally {
        active--;
      }
      if (cursor < requests) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = performance.now() - startedAt;
  const routes = [...byPath.values()].map(row => ({
    path: row.path,
    requests: row.requests,
    successes: row.successes,
    unexpected3xx: row.unexpected3xx,
    successfulLatencySamples: row.timings.length,
    rateLimited: row.rateLimited,
    errors5xx: row.errors5xx,
    authDenied: row.authDenied,
    otherHttpErrors: row.otherHttpErrors,
    networkErrors: row.networkErrors,
    headerP50Ms: percentile(row.timings, .50),
    headerP95Ms: percentile(row.timings, .95),
    rateLimitBuckets: row.buckets,
  }));
  return {
    kind: "cluster-live-read-baseline-v2",
    note: "Successful 2xx response-header latency only; failed/redirected requests cannot improve p50/p95. Not full response transfer or SQL time.",
    passed: routes.every(row => row.successes === row.requests),
    requests,
    concurrency,
    peakConcurrency,
    delayMs,
    elapsedMs: Number(durationMs.toFixed(2)),
    routes,
  };
}

async function main() {
  if (!process.env.CLUSTER_BENCH_URL) {
    console.error("Set CLUSTER_BENCH_URL explicitly to a local or secured Cluster server origin.");
    process.exitCode = 2;
    return;
  }
  const report = await runClusterReadBaseline({
    baseUrl: process.env.CLUSTER_BENCH_URL,
    paths: (process.env.CLUSTER_BENCH_PATHS || "/health/live,/health/ready").split(",").map(s => s.trim()),
    cookie: process.env.CLUSTER_BENCH_COOKIE || null,
    requests: process.env.CLUSTER_BENCH_REQUESTS,
    concurrency: process.env.CLUSTER_BENCH_CONCURRENCY,
    delayMs: process.env.CLUSTER_BENCH_DELAY_MS,
    timeoutMs: process.env.CLUSTER_BENCH_TIMEOUT_MS,
  });
  console.log(JSON.stringify(report, null, 2));
  // Fail closed on every non-2xx response, not just 429s and server failures.
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Validation errors are deliberately generic. Never echo URLs containing
    // tokens or credentials, or body content, into logs.
    console.error("Cluster read baseline could not start: " + (error instanceof Error ? error.message : "unknown error"));
    process.exitCode = 2;
  });
}
