import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const json = (rel) => JSON.parse(read(rel));

const sharedIndex = read("packages/shared/src/index.ts");
const snapshotContract = read("packages/shared/src/project-snapshot-contracts.ts");
const snapshotService = read("apps/server/src/domains/projects/project-snapshot-service.ts");
const projectRoutes = read("apps/server/src/domains/projects/project-routes.ts");
const projectCapabilities = read("apps/server/src/domains/projects/project-capabilities.ts");
const projectsPage = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
const projectDetailHook = read("packages/renderer/src/features/projects/useProjectDetailWorkspace.ts");
const projectDetail = read("packages/renderer/src/features/projects/ProjectDetailPage.tsx");
const overview = read("packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx");
const myWork = read("packages/renderer/src/features/work/MyWorkPage.tsx");
const home = read("packages/renderer/src/features/application/modules/ApplicationDashboard.tsx");
const operationsAdmin = read("packages/renderer/src/features/operations/modules/operations-admin.tsx");
const operationsWorkflows = read("packages/renderer/src/features/operations/modules/operations-workflows.tsx");
const scmContract = read("packages/shared/src/workstation-source-control-contracts.ts");
const workstation = read("apps/workstation-go/main.go");
const workstationTests = read("apps/workstation-go/main_test.go");
const discord = read("apps/server/src/domains/integrations/discord-production-service.ts");
const discordRoutes = read("apps/server/src/domains/integrations/discord-production-routes.ts");
const discordRelay = read("integrations/discord-bot/src/index.mjs");
const pkg = json("package.json");

const checks = [
  ["Canonical Project Snapshot contract exists", exists("packages/shared/src/project-snapshot-contracts.ts") && snapshotContract.includes("CLUSTER_PROJECT_SNAPSHOT_SCHEMA = 1")],
  ["Project Snapshot is exported through @cluster/shared", sharedIndex.includes("project-snapshot-contracts")],
  ["Project Snapshot identity separates display/internal/external/codename", ["displayName", "internalName", "externalName", "codename", "externalSafe"].every((value) => snapshotContract.includes(value))],
  ["Project Snapshot owns readiness and schedule projection", snapshotContract.includes("readiness:") && snapshotContract.includes("schedule:") && snapshotContract.includes("health:")],
  ["Project Snapshot owns next milestone/calendar projection", snapshotContract.includes("nextMilestone") && snapshotContract.includes("nextCalendar")],
  ["Project Snapshot service is request-aware", snapshotService.includes("request: FastifyRequest") && snapshotService.includes("snapshotsForRequest")],
  ["Project Snapshot service uses canonical Calendar authorization", snapshotService.includes("canAccessCalendarEvent")],
  ["Project Snapshot only serializes People identity when People is visible", snapshotService.includes("canPeople && leadMembership") && snapshotService.includes("team: { assigned: canPeople")],
  ["Project Snapshot hides internal identity for external collaborators", snapshotService.includes("externalSafe") && snapshotService.includes("internalName = externalSafe ? null") && snapshotService.includes("codename: externalSafe ? null")],
  ["Project Snapshot derives build/QA health without shipping raw child payloads", snapshotService.includes("deliveryBuild.groupBy") && snapshotService.includes("deliveryQaSession.groupBy")],
  ["Project Snapshot collection endpoint is static before project parameter routes", projectRoutes.indexOf('app.get("/api/projects/snapshots"') > 0 && projectRoutes.indexOf('app.get("/api/projects/snapshots"') < projectRoutes.indexOf('app.get("/api/projects/:projectId/snapshot"')],
  ["Project Snapshot collection filters canonical Project access", projectRoutes.includes('hasTargetAccess(user, decorated?.workspaceRole, "project"')],
  ["Project Snapshot detail endpoint enforces Project view access", projectRoutes.includes('app.get("/api/projects/:projectId/snapshot"') && projectRoutes.includes('enforceTargetAccess(request, reply, "project", project.id, project, "view")')],
  ["Legacy Project summary is external-safe at the capability boundary", projectCapabilities.includes("isExternalCollaboratorRole") && projectCapabilities.includes("project.externalName || project.name") && projectCapabilities.includes("codename: null")],
  ["Projects Portfolio loads canonical snapshots", projectsPage.includes('/api/projects/snapshots?ids=') && projectsPage.includes("projectSnapshots")],
  ["Projects Portfolio uses snapshot readiness", projectsPage.includes("snapshot?.readiness.score")],
  ["Projects Portfolio uses snapshot health", projectsPage.includes("snapshot?.health.attentionScore") && projectsPage.includes("projectSnapshotHealth(snapshot)")],
  ["Projects Portfolio does not fallback to hidden People counts after snapshot authority arrives", projectsPage.includes("snapshot ? (snapshot.team.assigned ?? 0)")],
  ["Project Detail loads its canonical snapshot independently", projectDetailHook.includes('/api/projects/${projectId}/snapshot') && projectDetailHook.includes("project-snapshot")],
  ["Project Detail header consumes canonical readiness/team", projectDetail.includes("snapshot?.readiness.score") && projectDetail.includes("snapshot?.team.assigned")],
  ["Project Overview consumes the same snapshot readiness/schedule authority", overview.includes("snapshot?.readiness.score") && overview.includes("snapshot.schedule.label") && overview.includes("readinessGaps")],
  ["My Work assigned projects consume canonical snapshots", myWork.includes('/api/projects/snapshots?ids=') && myWork.includes("snapshot?.readiness.score") && myWork.includes("snapshot?.schedule.label")],
  ["Home portfolio widgets consume canonical snapshots", home.includes('/api/projects/snapshots?ids=') && home.includes("projectSnapshots[project.id]?.readiness.score") && home.includes("projectHealthForHome")],
  ["Operations project diagnostics consume canonical snapshots", operationsAdmin.includes('/api/projects/snapshots?ids=') && operationsWorkflows.includes("input.projectSnapshots?.[project.id]") && operationsWorkflows.includes("readiness.ready")],
  ["SCM protocol exposes async operation lifecycle", ["operation.start", "operation.status", "operation.cancel"].every((value) => scmContract.includes(`\"${value}\"`))],
  ["SCM protocol defines typed async operation state", scmContract.includes("ClusterWorkstationSourceControlOperationState") && scmContract.includes("ClusterWorkstationSourceControlOperation")],
  ["Workstation advertises repository.resolve truthfully", workstation.includes('"repository.resolve"') && workstation.includes("runtimeCapabilities")],
  ["Workstation exposes SCM operation start/status/cancel", workstation.includes("sourceOperationStart") && workstation.includes("sourceOperationStatus") && workstation.includes("sourceOperationCancel")],
  ["SCM async operation lookup is repository-scoped", workstation.includes("op.RepositoryID != repo.ID")],
  ["SCM cancellation uses operation context cancellation", workstation.includes('op.State = "cancelling"') && workstation.includes("op.cancel()")],
  ["SCM async commit/sync execute without shell invocation", workstation.includes("runGitCommand(ctx, repo.RootPath") && !workstation.includes('runCommand(ctx, repo.RootPath, "sh"')],
  ["Workstation tests cover SCM capability advertisement", workstationTests.includes("TestSourceControlRuntimeAdvertisesResolutionAndAsyncOperations")],
  ["Workstation tests cover repository-scoped operation status", workstationTests.includes("TestSourceOperationStatusIsRepositoryScoped")],
  ["Workstation tests cover cancellation", workstationTests.includes("TestSourceOperationCancelRequestsContextCancellation")],
  ["SCM history is path-aware for Unreal asset revision browsing", workstation.includes("--follow") && workstation.includes("sourceHistory(repo, req.Paths")],
  ["SCM diff supports validated revision pairs", workstation.includes("baseRevision") && workstation.includes("targetRevision") && workstation.includes("validGitRevision")],
  ["SCM revision validation rejects option-like arguments", workstation.includes('strings.HasPrefix(value, "-")') && workstationTests.includes("TestSourceDiffRejectsOptionLikeRevision")],
  ["Workstation tests cover path-scoped history", workstationTests.includes("TestSourceHistoryScopesToRequestedPath")],
  ["Workstation tests cover revision-aware diff", workstationTests.includes("TestSourceDiffSupportsValidatedRevisions")],
  ["Discord delivery summary distinguishes retrying and dead-letter failures", discord.includes("retrying") && discord.includes("deadLetter") && discord.includes("attempts: { gte: 5 }")],
  ["Discord failed-delivery retry remains admin-authorized", discordRoutes.includes('/api/admin/discord/deliveries/:receiptId/retry') && discordRoutes.includes('"integrations", "manage"')],
  ["Discord manual retry remains durable queue work", discord.includes('type: "integration.discord-delivery"') && discord.includes("maxAttempts: 5")],
  ["Discord relay remains zero-privileged-intent transport", discordRelay.includes("intents: 0")],
  ["Pass 4 assertion gate remains wired", pkg.scripts?.["wip57:pass4:assertions"]?.includes("wip57-pass4-assertions.mjs")],
  ["Pass 5 source-foundation verification is wired", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass5:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 5 assertions passed.`);
if (failed.length) process.exit(1);
