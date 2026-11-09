import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTrafficLane, readTrafficLanes, noteReadRateLimit, rateLimitCooldownRemaining, resetReadRateLimitCooldowns } from "../../packages/api-client/src/read-rate-limit.ts";
import { apiTransportRateLimitPolicy } from "../../apps/server/src/core/request-workload.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
let checks = 0;
function check(name, fn) { fn(); checks++; console.log("PASS " + name); }
check("primary lanes agree with server GET/HEAD transport policy", () => {
  const paths = [
    "/api/meta/compatibility", "/api/projects", "/api/projects/provision/job-1",
    "/api/notifications/summary", "/api/time/active", "/api/calendar/upcoming",
    "/api/library/summary", "/api/me/presence", "/api/presence/online",
    "/api/library/workspace", "/api/library/collections/abc",
    "/api/admin/inventory/assets", "/api/inventory/assets",
    "/api/timeline", "/api/timeline/events", "/api/admin/people",
    "/api/command/search", "/api/admin/integrations/webhooks",
    "/api/projects/p1/source-control", "/api/admin/discord/status",
  ];
  for (const method of ["GET", "HEAD"]) for (const pathname of paths) {
    const actual = readTrafficLane(pathname + "?refresh=1", method);
    const expected = apiTransportRateLimitPolicy({ pathname, method, apiRateLimitMax: 12_000 }).bucketName;
    assert.equal(actual, expected, method + " " + pathname);
  }
  assert.equal(readTrafficLane("/api/projects", "POST"), null);
});
check("search quota is isolated from ordinary API reads", () => {
  assert.deepEqual(readTrafficLanes("/api/command/search?q=private", "GET"), ["api", "search-user"]);
  assert.deepEqual(readTrafficLanes("/api/projects", "GET"), ["api"]);
});
check("export quota is isolated from unrelated views", () => {
  assert.deepEqual(readTrafficLanes("/api/reports/export?format=csv", "GET"), ["api", "export-user"]);
  assert.deepEqual(readTrafficLanes("/api/reports/export", "HEAD"), ["api"]);
});
check("external integrations respect transport and external quotas", () => {
  assert.deepEqual(readTrafficLanes("/api/admin/discord/status", "GET"), ["api-admin", "external"]);
  assert.deepEqual(readTrafficLanes("/api/projects/p1/source-control/branches", "GET"), ["api", "external"]);
});
check("only safe reads participate in coordinated backoff", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.deepEqual(readTrafficLanes("/api/projects/provision/job-1", method), []);
  }
});
check("secondary cooldown does not stall unrelated paths", () => {
  resetReadRateLimitCooldowns();
  const now = 10_000;
  assert.ok(readTrafficLanes("/api/command/search?q=private", "GET").includes("search-user"));
  noteReadRateLimit("search-user", "5", now);
  assert.equal(rateLimitCooldownRemaining("search-user", now + 1_000), 4_000);
  assert.equal(rateLimitCooldownRemaining("api", now + 1_000), 0);
  resetReadRateLimitCooldowns();
});
check("fetch honors authoritative 429 buckets and every applicable lane", () => {
  const src = read("packages/api-client/src/index.ts");
  assert.match(src, /trafficLanes\.map\(\(lane\) => readRateLimitCooldown\(lane, init\.signal\)\)/);
  assert.match(src, /response\.headers\.get\("X-Cluster-Rate-Limit-Bucket"\)/);
  assert.match(src, /trafficLanes\.includes\(authoritativeLane\)/);
  assert.match(src, /requestCooldownGeneration === readRateLimitGeneration\(\)/);
});
console.log(checks + "/" + checks + " rate-limit lane authority regression tests passed");
