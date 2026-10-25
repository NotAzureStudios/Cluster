import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
test("v0.414 Phase C Home + My Work overhaul contract", () => {
  const pkg = JSON.parse(read("package.json"));
  const contracts = read("packages/shared/src/api-contracts.ts");
  const shell = read("packages/renderer/src/features/application/modules/application-shell.tsx");
  const work = read("packages/renderer/src/features/work/MyWorkPage.tsx");
  assert.equal(pkg.version, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"polish-enhancement-phase-c-v1"'));
  assert.ok(shell.includes("home-personal-brief-v414"));
  assert.ok(shell.includes('api<TeamAssignment[]>("/api/team/assignments")'));
  assert.ok(work.includes("Daily focus plan"));
  assert.ok(work.includes("mywork-execution-health-v414"));
});
