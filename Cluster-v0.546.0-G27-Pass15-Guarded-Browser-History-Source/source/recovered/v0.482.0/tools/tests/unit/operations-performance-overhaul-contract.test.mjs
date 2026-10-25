import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("operations and performance audit passes", () => {
  const result = spawnSync(process.execPath, [path.join(root, "tools/scripts/operations-performance-audit.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /83\/83 passed/);
});

test("v0.387 contract advertises durable inbox and performance boundaries", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const contracts = await read("packages/shared/src/api-contracts.ts");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(contracts, /2026-08-02\.62/);
  for (const capability of ["work-inbox-v2", "operations-observability-v2", "performance-budgets-v1", "postgresql-scalability-v2"]) assert.ok(contracts.includes(`"${capability}"`));
});

test("notification migration is durable and historical backfill is non-disruptive", async () => {
  const schema = await read("apps/server/prisma/schema.prisma");
  const service = await read("apps/server/src/domains/notifications/notification-service.ts");
  const repository = await read("apps/server/src/domains/notifications/notification-repository.ts");
  assert.match(schema, /model NotificationInboxItem/);
  assert.match(schema, /@@unique\(\[userId, activityEventId\]\)/);
  assert.ok(service.includes("materialize(event, { historical: true })"));
  assert.ok(repository.includes("readAt: input.readAt"));
});

test("performance budgets fail closed on actual samples but treat absent PostgreSQL samples as unknown", async () => {
  const budgets = await read("apps/server/src/core/performance-budgets.ts");
  assert.ok(budgets.includes('if (actual == null) return "unknown"'));
  assert.ok(budgets.includes('if (actual <= target) return "pass"'));
  assert.ok(budgets.includes('blockSamples > 0 ? workload.cacheHitRatio : null'));
  assert.ok(budgets.includes('scanSamples > 0 ? workload.indexScanRatio : null'));
});
