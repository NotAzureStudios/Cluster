/** Compare matching, successful Cluster v2 API read baselines without leaking response content. */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPORT_KIND = "cluster-live-read-baseline-v2";
const MAX_REPORT_BYTES = 256 * 1024;
const MIN_SAMPLES_PER_ROUTE = 10;
const REGRESSION_THRESHOLD_PERCENT = 15;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function validRoutePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    && /^\/(?:api|health)(?:\/|$)/.test(value)
    && !/[?#\\\u0000-\u001f]/.test(value);
}
function validatedRoutes(report) {
  if (!report || typeof report !== "object" || report.kind !== REPORT_KIND || report.passed !== true) {
    throw Error("Only fully successful v2 read baselines can be compared.");
  }
  if (!Number.isSafeInteger(report.requests) || report.requests < 1 || report.requests > 128
    || !Number.isSafeInteger(report.concurrency) || report.concurrency < 1 || report.concurrency > 4
    || !Number.isSafeInteger(report.delayMs) || report.delayMs < 100 || report.delayMs > 2000
    || !Array.isArray(report.routes) || report.routes.length < 1 || report.routes.length > 8) {
    throw Error("Baseline run settings are missing or invalid.");
  }
  const byPath = new Map();
  let totalRequests = 0;
  for (const route of report.routes) {
    if (!route || !validRoutePath(route.path) || byPath.has(route.path)
      || !Number.isSafeInteger(route.requests) || route.requests < MIN_SAMPLES_PER_ROUTE
      || route.successes !== route.requests || route.successfulLatencySamples !== route.successes
      || !finiteNumber(route.headerP50Ms) || !finiteNumber(route.headerP95Ms)
      || route.headerP95Ms < route.headerP50Ms
      || [route.unexpected3xx, route.rateLimited, route.errors5xx, route.authDenied,
        route.otherHttpErrors, route.networkErrors].some(value => value !== 0)) {
      throw Error("Baseline routes require unique paths, complete 2xx results and at least ten successful samples each.");
    }
    totalRequests += route.requests;
    byPath.set(route.path, route);
  }
  if (totalRequests !== report.requests) throw Error("Baseline route totals do not match its request count.");
  return byPath;
}

function round(value) { return Number(value.toFixed(2)); }
/** This is a deterministic comparison, NOT a statistical significance test. */
export function compareClusterReadBaselines(before, after) {
  const prior = validatedRoutes(before);
  const next = validatedRoutes(after);
  if (before.requests !== after.requests || before.concurrency !== after.concurrency
    || before.delayMs !== after.delayMs || prior.size !== next.size) {
    throw Error("Baseline workloads must use matching requests, concurrency, delay and routes.");
  }
  const routes = [...prior.keys()].sort().map(pathname => {
    const first = prior.get(pathname);
    const second = next.get(pathname);
    if (!second || first.requests !== second.requests) {
      throw Error("Baseline route request counts do not match.");
    }
    const beforeP95Ms = first.headerP95Ms;
    const afterP95Ms = second.headerP95Ms;
    const deltaMs = round(afterP95Ms - beforeP95Ms);
    const deltaPercent = beforeP95Ms > 0 ? round(100 * (afterP95Ms / beforeP95Ms - 1)) : null;
    const flaggedRegression = deltaPercent !== null && deltaPercent >= REGRESSION_THRESHOLD_PERCENT;
    return {
      path: pathname, requests: first.requests,
      beforeP50Ms: first.headerP50Ms, afterP50Ms: second.headerP50Ms,
      beforeP95Ms, afterP95Ms, p95DeltaMs: deltaMs,
      p95DeltaPercent: deltaPercent, flaggedRegression,
    };
  });
  return {
    kind: "cluster-live-read-comparison-v1",
    comparable: true,
    requests: before.requests, concurrency: before.concurrency, delayMs: before.delayMs,
    minimumSuccessfulSamplesPerRoute: MIN_SAMPLES_PER_ROUTE,
    regressionReviewThresholdPercent: REGRESSION_THRESHOLD_PERCENT,
    flaggedRegressions: routes.filter(row => row.flaggedRegression).length,
    routes,
    note: "Matched 2xx-only p95 comparison; verify same machine, dataset, version and concurrent workload. A single run is not statistical or production certification.",
  };
}

async function readReport(filename) {
  const info = await stat(filename);
  if (!info.isFile() || info.size > MAX_REPORT_BYTES) throw Error("Baseline input must be a regular JSON file no larger than 256 KiB.");
  return JSON.parse(await readFile(filename, "utf8"));
}
async function main() {
  if (process.argv.length !== 4) {
    console.error("Usage: node tools/scripts/cluster-compare-read-baselines.mjs BEFORE.json AFTER.json");
    process.exitCode = 2;
    return;
  }
  const result = compareClusterReadBaselines(await readReport(process.argv[2]), await readReport(process.argv[3]));
  console.log(JSON.stringify(result, null, 2));
  if (result.flaggedRegressions > 0) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    // Do not print raw JSON, file paths or secrets from invalid test reports.
    console.error("Cluster baseline comparison refused invalid or mismatched input.");
    process.exitCode = 2;
  });
}
