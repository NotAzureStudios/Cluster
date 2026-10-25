const target = String(process.env.CLUSTER_LOAD_URL || process.argv[2] || "").replace(/\/$/, "");
const scenarioArg = Number(process.env.CLUSTER_LOAD_USERS || process.argv[3] || 10);
const durationMs = Number(process.env.CLUSTER_LOAD_DURATION_MS || 30_000);
const cookie = String(process.env.CLUSTER_LOAD_COOKIE || "");
const route = String(process.env.CLUSTER_LOAD_ROUTE || "/health");
const allowedUsers = new Set([10, 25, 50]);
if (!target) { console.error("Set CLUSTER_LOAD_URL or pass a target URL."); process.exit(2); }
if (!allowedUsers.has(scenarioArg)) { console.error("Virtual users must be one of 10, 25, or 50."); process.exit(2); }
if (!route.startsWith("/") || /(?:delete|logout|reset|remove|purge)/i.test(route)) { console.error("Load harness only accepts bounded read-only routes."); process.exit(2); }
const samples = []; let failures = 0; let completed = 0; let stopped = false;
const percentile = (values, ratio) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : 0;
async function worker() {
  while (!stopped) {
    const started = performance.now();
    try {
      const response = await fetch(`${target}${route}`, { method: "GET", headers: cookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch { failures += 1; }
    samples.push(performance.now() - started); completed += 1;
    if (samples.length > 25_000) samples.splice(0, samples.length - 25_000);
  }
}
const timer = setTimeout(() => { stopped = true; }, durationMs);
await Promise.all(Array.from({ length: scenarioArg }, () => worker()));
clearTimeout(timer);
const sorted = [...samples].sort((a,b)=>a-b);
const elapsedSeconds = durationMs / 1000;
const result = { users: scenarioArg, route, completed, failures, errorRate: completed ? failures / completed : 1, requestsPerSecond: completed / elapsedSeconds, p50Ms: percentile(sorted,.5), p95Ms: percentile(sorted,.95), p99Ms: percentile(sorted,.99), maxMs: sorted.at(-1) || 0 };
console.log(JSON.stringify(result, null, 2));
const p95Budget = Number(process.env.CLUSTER_LOAD_P95_MS || 750);
const p99Budget = Number(process.env.CLUSTER_LOAD_P99_MS || 1500);
const errorBudget = Number(process.env.CLUSTER_LOAD_ERROR_RATE || 0.01);
if (result.p95Ms > p95Budget || result.p99Ms > p99Budget || result.errorRate > errorBudget) process.exit(1);
