import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");
const checks = [];
const failures = [];
function check(label, ok, detail = "") { checks.push({ label, ok, detail }); if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`); }

const versions = JSON.parse(await read("config/toolchain-versions.json"));
const contracts = await read("packages/shared/src/api-contracts.ts");
const schemas = await read("packages/shared/src/api-schemas.ts");
const searchTypes = await read("apps/server/src/domains/search/search-index-types.ts");
const searchQuery = await read("apps/server/src/domains/search/search-query-runtime.ts");
const searchRepo = await read("apps/server/src/domains/search/search-repository.ts");
const searchBuilder = await read("apps/server/src/domains/search/search-index-builder.ts");
const intelligence = await read("apps/server/src/domains/projects/project-intelligence-service.ts");
const intelligenceRoutes = await read("apps/server/src/domains/projects/project-intelligence-routes.ts");
const workflowRoutes = await read("apps/server/src/domains/projects/project-workflow-routes.ts");
const automation = await read("apps/server/src/domains/automation/studio-automation-service.ts");
const jobs = await read("apps/server/src/app/server-job-runtime.ts");
const app = await read("apps/server/src/app/cluster-server.ts");
const palette = await read("packages/renderer/src/features/search/CommandPalette.tsx");
const paletteConfig = await read("packages/renderer/src/features/search/search-palette-config.ts");
const detail = await read("packages/renderer/src/features/projects/ProjectDetailPage.tsx");
const panel = await read("packages/renderer/src/features/projects/ProjectIntelligencePanel.tsx");
const hook = await read("packages/renderer/src/features/projects/useProjectDetailWorkspace.ts");
const models = await read("packages/renderer/src/features/application/application-models.ts");
const css = await read("packages/renderer/src/features/projects/project-quality.css");
const openapi = await read("apps/server/src/core/openapi.ts");
const pkg = JSON.parse(await read("package.json"));
const packager = await read("tools/scripts/package-cluster-master.mjs");
const docs = await read("docs/PROJECT_INTELLIGENCE_OVERHAUL.md");
const notes = await read("RELEASE_NOTES_v0.386.0.md");
const changelog = await read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");

check("Step 5 release baseline is present", Number(versions.cluster.split(".")[1] || 0) >= 386, versions.cluster);
check("Step 5 API contract is current", contracts.includes("2026-08-02.63"));
for (const capability of ["search-v2", "project-intelligence-v1", "build-qa-traceability-v1", "workflow-automation-v2"]) check(`capability ${capability} is advertised`, contracts.includes(`"${capability}"`));
check("search domain is v2", contracts.includes("search: 2"));
check("projects domain is v2", contracts.includes("projects: 2"));
check("automation domain is v2", contracts.includes("automation: 2"));

for (const kind of ["control", "build", "qa", "release"]) {
  check(`shared search schema includes ${kind}`, schemas.includes(`"${kind}"`));
  check(`server search kind includes ${kind}`, searchTypes.includes(`"${kind}"`));
  check(`query runtime scopes ${kind}`, searchQuery.includes(`"${kind}"`));
  check(`renderer search scopes ${kind}`, paletteConfig.includes(`"${kind}"`));
}
check("search repository loads project workflow records", searchRepo.includes("workflowRecords") && searchRepo.includes("buildArtifact") && searchRepo.includes("qaSession") && searchRepo.includes("releaseNote"));
check("search builder indexes workflow records", searchBuilder.includes("corpus.workflowRecords") && searchBuilder.includes('record.kind === "buildArtifact" ? "build"') && searchBuilder.includes('record.kind === "releaseNote" ? "release"'));
check("project controls are first-class search results", searchBuilder.includes('kind: "control"'));
check("search results hand off to project workspaces", palette.includes("cluster-project-tab-handoff") && palette.includes('result.kind === "release"'));

check("project intelligence service exists", intelligence.includes("createProjectIntelligenceService"));
check("project intelligence computes readiness", intelligence.includes("const score") && intelligence.includes("releaseReadyBuilds"));
check("project intelligence builds traceability nodes", intelligence.includes('relationship: "verified_by"') && intelligence.includes('relationship: "documented_by"') && intelligence.includes('relationship: "supports"'));
check("traceability prefers artifact IDs", intelligence.includes("artifactId") && intelligence.includes("linkedArtifactId"));
check("project intelligence route is view-authorized", intelligenceRoutes.includes('/api/projects/:projectId/intelligence') && intelligenceRoutes.includes('"view"'));
check("project intelligence route is registered", app.includes("registerProjectIntelligenceRoutes"));
check("OpenAPI exposes project intelligence", openapi.includes('/api/projects/{projectId}/intelligence'));
check("renderer has Project Intelligence tab", detail.includes('id: "intelligence"') && detail.includes("ProjectIntelligencePanel"));
check("renderer loads server-derived intelligence", hook.includes("loadProjectIntelligence") && hook.includes("/intelligence"));
check("renderer shows Build QA Release traceability", panel.includes("Build → QA → Release traceability"));
check("new intelligence CSS uses semantic values", css.includes("project-intelligence-grid-v386") && !/project-intelligence[^}]*#[0-9a-fA-F]{3,8}/s.test(css));

check("Studio Automation uses durable jobs", automation.includes('type: "automation.studio-action"') && automation.includes("jobQueue.enqueue"));
check("all matched Studio Automation actions queue durably", automation.includes('status: "queued", jobId: job.id') && !automation.includes("if (rule.delayMinutes > 0) {\n            await enqueue"));
check("Studio Automation exposes no legacy pseudo-job writes", !automation.includes('kind: JOB_KIND') && !automation.includes('const JOB_KIND = "studioAutomationJob"'));
check("legacy active automation jobs migrate durably", automation.includes("LEGACY_JOB_KIND") && automation.includes("migrateLegacyJobs") && automation.includes("studio-automation-legacy:"));
check("legacy jobs archive only after durable enqueue", automation.indexOf("await jobQueue.enqueue") < automation.indexOf('status: "migrated"'));
check("durable worker owns automation execution", jobs.includes('.register("automation.studio-action"') && jobs.includes("executeDurableJob"));
check("legacy migration is startup-owned", jobs.includes("studio-automation-legacy-migration") && jobs.includes("migrateLegacyJobs"));
check("Build workflow transitions emit server automation", workflowRoutes.includes('return "build_failed"') && workflowRoutes.includes('return "build_completed"'));
check("QA workflow transitions emit server automation", workflowRoutes.includes('return "qa_failed"') && workflowRoutes.includes('return "qa_passed"'));
check("workflow event IDs bind revision", workflowRoutes.includes("record.revision") && workflowRoutes.includes("project-workflow:"));
check("project workflow automation is registered server-side", app.includes("studioAutomation,"));
check("automation queue renderer accepts non-ticket entities", /entityType:\s*string;/.test(models));

check("Step 5 documentation exists", docs.includes("Core Product & Architecture Roadmap Step 5 of 7"));
check("Step 5 release notes exist", notes.includes("Core Product & Architecture Roadmap Step 5 of 7"));
check("Step 5 changelog entry exists", changelog.includes('version: "v0.386.0"'));
check("Step 5 audit is release-blocking", String(pkg.scripts.audit || "").includes("project-intelligence-audit.mjs"));
check("Step 5 audit has a named script", pkg.scripts["audit:project-intelligence"] === "node tools/scripts/project-intelligence-audit.mjs");
check("master packager runs Step 5 audit", packager.includes("project-intelligence-audit.mjs"));
check("master packager includes Step 5 docs", packager.includes("docs/PROJECT_INTELLIGENCE_OVERHAUL.md"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail && !item.ok ? ` (${item.detail})` : ""}`);
console.log(`\nCluster project intelligence audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
