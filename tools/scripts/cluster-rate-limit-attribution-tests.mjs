import assert from "node:assert/strict";
import { RuntimeTelemetry } from "../../apps/server/src/core/runtime-telemetry.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = pathname => fs.readFileSync(path.join(root, pathname), "utf8");
const telemetry = new RuntimeTelemetry({ maxSamples: 48, maxRoutes: 4 });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log("PASS " + name); }
try {
  const record = (route, status, bucket) => telemetry.complete(telemetry.begin(), route, status, bucket);
  record("/api/projects", 200);
  record("/api/projects", 429, "api");
  record("/api/projects", 429, "api");
  record("/api/library/workspace?key=private", 429, "api-library");
  record("/api/library/workspace?key=secrets", 429, "api-library");
  record("/api/timeline", 503);
  record("/api/other", 429, "auth-transport");
  record("/api/misc", 429, "unexpected-secret-from-header");
  check("counts 429 separately from server errors and 503", () => {
    const data = telemetry.snapshot();
    assert.equal(data.requests.total, 8);
    assert.equal(data.requests.rateLimited, 6);
    assert.equal(data.requests.errors, 1);
    assert.equal(data.rateLimits.total, 6);
  });
  check("uses bounded, sanitized server bucket names", () => {
    const buckets = telemetry.snapshot().rateLimits.byBucket;
    assert.deepEqual(buckets.find(x => x.bucket === "api"), { bucket: "api", count: 2 });
    assert.deepEqual(buckets.find(x => x.bucket === "api-library"), { bucket: "api-library", count: 2 });
    assert.deepEqual(buckets.find(x => x.bucket === "unattributed"), { bucket: "unattributed", count: 1 });
    assert.ok(!JSON.stringify(buckets).includes("unexpected-secret"));
  });
  check("surfaces busy 429 routes without exposing raw query strings", () => {
    const info = telemetry.snapshot();
    assert.ok(info.rateLimits.byRoute.some(x => x.route === "/api/library/workspace" && x.count === 2));
    assert.ok(!JSON.stringify(info.rateLimits).includes("private"));
    assert.ok(!JSON.stringify(info.rateLimits).includes("secrets"));
    assert.ok(telemetry.routeMetricsSnapshot().some(x => x.rateLimited >= 2));
  });
  check("caps route cardinality under repeated 429s", () => {
    for (let i = 0; i < 100; i++) record("/api/example-" + i, 429, "api");
    const info = telemetry.snapshot();
    assert.ok(info.routes.length <= 5, "existing route cap reserves an other bucket");
    assert.ok(info.rateLimits.byRoute.length <= 5);
    assert.equal(info.rateLimits.total, 106);
    assert.equal(info.requests.rateLimited, 106);
  });
  check("request boundary forwards only the existing bucket on 429", () => {
    const src = read("apps/server/src/app/server-request-infrastructure.ts");
    assert.match(src, /reply\.statusCode === 429 \? reply\.getHeader\("X-Cluster-Rate-Limit-Bucket"\) : undefined/);
  });
  console.log(checks + "/" + checks + " rate-limit attribution tests passed");
} finally {
  telemetry.stop();
}
