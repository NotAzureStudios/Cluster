import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("condensed roadmap Step 5 expands permission-aware search into delivery records", async () => {
  const versions = JSON.parse(await read("config/toolchain-versions.json"));
  const contracts = await read("packages/shared/src/api-contracts.ts");
  const repository = await read("apps/server/src/domains/search/search-repository.ts");
  const builder = await read("apps/server/src/domains/search/search-index-builder.ts");
  const palette = await read("packages/renderer/src/features/search/CommandPalette.tsx");
  assert.equal(versions.cluster, "0.422.0");
  assert.match(contracts, /2026-08-02\.62/);
  for (const capability of ["search-v2", "project-intelligence-v1", "build-qa-traceability-v1", "workflow-automation-v2"]) assert.match(contracts, new RegExp(capability));
  assert.match(repository, /workflowRecords/);
  assert.match(builder, /corpus\.workflowRecords/);
  assert.match(builder, /kind: "control"/);
  assert.match(palette, /cluster-project-tab-handoff/);
});

test("condensed roadmap Step 5 makes project delivery traceability server-derived", async () => {
  const service = await read("apps/server/src/domains/projects/project-intelligence-service.ts");
  const routes = await read("apps/server/src/domains/projects/project-intelligence-routes.ts");
  const panel = await read("packages/renderer/src/features/projects/ProjectIntelligencePanel.tsx");
  assert.match(service, /releaseReadyBuilds/);
  assert.match(service, /verified_by/);
  assert.match(service, /documented_by/);
  assert.match(service, /unlinkedBuildIds/);
  assert.match(routes, /\/api\/projects\/:projectId\/intelligence/);
  assert.match(routes, /"view"/);
  assert.match(panel, /Build → QA → Release traceability/);
});

test("condensed roadmap Step 5 moves Studio Automation onto the durable job queue", async () => {
  const automation = await read("apps/server/src/domains/automation/studio-automation-service.ts");
  const runtime = await read("apps/server/src/app/server-job-runtime.ts");
  const workflows = await read("apps/server/src/domains/projects/project-workflow-routes.ts");
  assert.match(automation, /automation\.studio-action/);
  assert.match(automation, /migrateLegacyJobs/);
  assert.doesNotMatch(automation, /const JOB_KIND = "studioAutomationJob"/);
  assert.match(runtime, /register\("automation\.studio-action"/);
  assert.match(workflows, /build_failed/);
  assert.match(workflows, /build_completed/);
  assert.match(workflows, /qa_failed/);
  assert.match(workflows, /qa_passed/);
});

test("Step 5 audit is release-blocking and documented", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const packager = await read("tools/scripts/package-cluster-master.mjs");
  const docs = await read("docs/PROJECT_INTELLIGENCE_OVERHAUL.md");
  const notes = await read("RELEASE_NOTES_v0.386.0.md");
  assert.match(pkg.scripts.audit, /project-intelligence-audit\.mjs/);
  assert.equal(pkg.scripts["audit:project-intelligence"], "node tools/scripts/project-intelligence-audit.mjs");
  assert.match(packager, /project-intelligence-audit\.mjs/);
  assert.match(docs, /Step 5 of 7/);
  assert.match(notes, /Step 5 of 7/);
  const result = await execFileAsync(process.execPath, ["tools/scripts/project-intelligence-audit.mjs"], { cwd: root });
  assert.match(result.stdout, /Cluster project intelligence audit: \d+\/\d+ passed/);
  assert.doesNotMatch(result.stdout, /^FAIL/m);
});
