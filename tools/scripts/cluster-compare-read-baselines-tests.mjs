import assert from "node:assert/strict";
import { compareClusterReadBaselines } from "./cluster-compare-read-baselines.mjs";

let checks = 0;
function check(name, verify) { verify(); checks++; console.log("PASS " + name); }
function route(path, p95 = 100, requests = 12) {
  return { path, requests, successes: requests, successfulLatencySamples: requests,
    headerP50Ms: p95 / 2, headerP95Ms: p95, unexpected3xx: 0,
    rateLimited: 0, errors5xx: 0, authDenied: 0, otherHttpErrors: 0, networkErrors: 0 };
}
function sample(routes = [route("/health/ready"), route("/api/projects")]) {
  return { kind: "cluster-live-read-baseline-v2", passed: true,
    requests: routes.reduce((sum, item) => sum + item.requests, 0),
    concurrency: 2, delayMs: 250, routes };
}
check("two matching healthy reports compare p95 by route independent of order", () => {
  const before = sample([route("/api/projects", 100), route("/health/ready", 40)]);
  const after = sample([route("/health/ready", 36), route("/api/projects", 90)]);
  const report = compareClusterReadBaselines(before, after);
  assert.equal(report.comparable, true);
  assert.equal(report.flaggedRegressions, 0);
  assert.deepEqual(report.routes.map(x => x.path), ["/api/projects", "/health/ready"]);
  assert.equal(report.routes[0].p95DeltaPercent, -10);
  assert.equal(report.routes[0].p95DeltaMs, -10);
  assert.equal(report.routes[1].p95DeltaPercent, -10);
});
check("regressions are flagged but not misrepresented as statistical certification", () => {
  const before = sample([route("/api/me", 100)]);
  const after = sample([route("/api/me", 116)]);
  const report = compareClusterReadBaselines(before, after);
  assert.equal(report.flaggedRegressions, 1);
  assert.equal(report.routes[0].flaggedRegression, true);
  assert.equal(report.routes[0].p95DeltaPercent, 16);
  assert.match(report.note, /not statistical/);
});
check("zero baseline p95 does not divide by zero", () => {
  const report = compareClusterReadBaselines(sample([route("/api/me", 0)]), sample([route("/api/me", 12)]));
  assert.equal(report.routes[0].p95DeltaPercent, null);
  assert.equal(report.flaggedRegressions, 0);
});
check("failed or mixed v1/v2 benchmarks are never compared", () => {
  const clean = sample([route("/api/me")]);
  for (const malformed of [
    { ...clean, kind: "cluster-live-read-baseline-v1" },
    { ...clean, passed: false },
    { ...clean, routes: [{ ...clean.routes[0], successes: 11 }] },
    { ...clean, routes: [{ ...clean.routes[0], successfulLatencySamples: 11 }] },
    { ...clean, routes: [{ ...clean.routes[0], authDenied: 1 }] },
    { ...clean, routes: [{ ...clean.routes[0], headerP95Ms: NaN }] },
    sample([route("/api/me", 100, 9)]),
  ]) assert.throws(() => compareClusterReadBaselines(clean, malformed));
});
check("mismatched concurrency, delay, route identity or route request count is rejected", () => {
  const clean = sample([route("/api/projects")]);
  for (const mismatch of [
    { ...clean, concurrency: 3 },
    { ...clean, delayMs: 300 },
    sample([route("/api/me")]),
    sample([route("/api/projects", 100, 11)]),
    sample([route("/api/projects?secret=foo")]),
    sample([route("//host.example")]),
    sample([route("/api/projects"), route("/api/projects")]),
  ]) assert.throws(() => compareClusterReadBaselines(clean, mismatch));
});
console.log(checks + "/" + checks + " read baseline comparison regressions passed");
