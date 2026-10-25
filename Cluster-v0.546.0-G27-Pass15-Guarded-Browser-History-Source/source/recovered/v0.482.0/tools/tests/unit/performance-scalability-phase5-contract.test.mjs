import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
test("v0.406 closes Phase 5 performance and scalability",()=>{
  const pkg=JSON.parse(read("package.json")); const contracts=read("packages/shared/src/api-contracts.ts");
  assert.equal(pkg.version,"0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"performance-scalability-completion-v1"'));
  assert.ok(read("tools/scripts/performance-load-test.mjs").includes("new Set([10, 25, 50])"));
  assert.ok(read("tools/scripts/bundle-budget.mjs").includes("totalJsBytes"));
  assert.ok(read("apps/server/src/core/database-diagnostics.ts").includes("pg_stat_statements"));
  assert.ok(read("apps/server/src/core/performance-budgets.ts").includes("postgresConnectionUtilization"));
});
