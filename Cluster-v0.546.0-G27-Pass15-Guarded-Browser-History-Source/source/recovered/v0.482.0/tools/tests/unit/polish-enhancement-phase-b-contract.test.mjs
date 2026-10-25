import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
test("v0.413 Phase B Projects mega-pass contract", () => {
  const pkg = JSON.parse(read("package.json"));
  const contracts = read("packages/shared/src/api-contracts.ts");
  const routes = read("apps/server/src/domains/projects/project-routes.ts");
  const overview = read("packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx");
  const projects = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  assert.equal(pkg.version, "0.422.0");
  assert.ok(contracts.includes('version: "2026-08-02.62"'));
  assert.ok(contracts.includes('"polish-enhancement-phase-b-v1"'));
  assert.ok(routes.includes('"buildArtifact", "qaPlan", "qaSession"'));
  assert.ok(overview.includes("project-system-map-v413"));
  assert.ok(projects.includes("project-portfolio-pulse-v413"));
});
