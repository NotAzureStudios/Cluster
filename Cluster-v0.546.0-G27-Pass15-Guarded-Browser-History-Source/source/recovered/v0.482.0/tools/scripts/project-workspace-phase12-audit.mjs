import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [overview, detail, header, nav, metadata, workspace, workflowStorage, styles, docs, pkgText, packager, notes, changelog] = await Promise.all([
  text("packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx"),
  text("packages/renderer/src/features/projects/ProjectDetailPage.tsx"),
  text("packages/renderer/src/features/projects/ProjectDetailHeader.tsx"),
  text("packages/renderer/src/features/projects/ProjectWorkspaceNav.tsx"),
  text("packages/renderer/src/features/projects/ProjectMetadataPanels.tsx"),
  text("packages/renderer/src/features/projects/useProjectDetailWorkspace.ts"),
  text("packages/renderer/src/core/project-workflow-storage.ts"),
  text("packages/renderer/src/features/projects/project-detail-workspace.css"),
  text("docs/PROJECT_WORKSPACE_PHASE12.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.435.0.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
]);

check("Overview uses canonical delivery summary", overview.includes("<ClusterMetricStrip") && overview.includes('label="Project delivery summary"'));
check("Overview exposes production flow", overview.includes("Delivery → Build → QA → Release") && overview.includes("project-production-flow-v435"));
check("Overview has actionable attention queue", overview.includes("ProjectAttentionItem") && overview.includes("project-attention-list-v435"));
check("Overview keeps upcoming milestones first class", overview.includes("Upcoming project checkpoints") && overview.includes("dashboard.timeline.upcoming"));
check("Overview exposes recent activity", overview.includes("What changed") && overview.includes("dashboard.activity.slice"));
check("Overview exposes assigned ownership", overview.includes("Assigned team") && overview.includes("teamMembers.slice"));
check("Overview exposes setup gaps without duplicate readiness card", overview.includes("Workspace readiness") && overview.includes("project-setup-gaps-v435"));
check("Overview makes project controls supporting information", overview.includes("Project supporting information") && overview.includes("<details>"));
check("Overview makes project metadata supporting information", overview.includes("Project metadata") && overview.includes("project-metadata-stack-v435"));
check("Overview primary board action remains visible", overview.includes('variant="primary"') && overview.includes("Open board"));
check("Overview secondary actions use canonical menu", overview.includes("<ClusterActionMenu") && overview.includes("Project overview actions"));
check("Overview does not retain old duplicate pulse grid", !overview.includes("project-pulse-grid-v310"));
check("Overview does not retain old duplicate metric grid", !overview.includes("project-metric-grid-v307"));
check("Overview does not retain old duplicate project-system grid", !overview.includes("project-system-grid-v413"));
check("Overview does not retain old workspaces summary card", !overview.includes("project-workarea-list-v147"));

check("Project detail supplies authoritative team members", detail.includes("projectTeamMembers") && detail.includes("assignedSet.has(user.id)"));
check("Project detail passes team members to Overview", detail.includes("teamMembers={projectTeamMembers}"));
check("Project detail avoids duplicate health strip on Overview", detail.includes('tab !== "overview" ? <ProjectHealthStripV195'));
check("Project section memory remains active", workspace.includes('useServerState<Record<string, ProjectWorkspaceTabId>>("user", "projects.last-tabs"'));
check("Project command handoff remains active", workspace.includes("cluster-project-tab-command") && workspace.includes("cluster-project-tab-handoff"));

check("Workflow event contract is exported", workflowStorage.includes('export const PROJECT_WORKFLOW_EVENT = "cluster-project-workflow-updated"'));
check("Workflow writes still dispatch scoped updates", workflowStorage.includes("new CustomEvent(PROJECT_WORKFLOW_EVENT, { detail: { kind, projectId } })"));
check("Project workspace consumes workflow updates", workspace.includes("window.addEventListener(PROJECT_WORKFLOW_EVENT, refreshProjectPulse)"));
check("Workflow refresh is project scoped", workspace.includes("detail.projectId !== projectId"));
check("Workflow refresh is bounded/debounced", workspace.includes("window.setTimeout") && workspace.includes("}, 140)"));
check("Workflow refresh updates delivery dashboard", workspace.includes("void loadProjectDashboard()"));
check("Workflow refresh avoids unconditional control reload", workspace.includes('tab === "overview" || tab === "control"'));
check("Workflow refresh avoids unconditional intelligence reload", workspace.includes('tab === "intelligence"'));

check("Project health uses canonical metric strip", metadata.includes("<ClusterMetricStrip") && metadata.includes("project-health-strip-v435"));
check("Project header back action uses shared button", header.includes("<ClusterButton") && header.includes("← Projects"));
check("Project header secondary shortcuts use action menu", header.includes("<ClusterActionMenu") && header.includes("Project workspace shortcuts"));
check("Project tabs remain semantic tablist", nav.includes('role="tablist"') && nav.includes('role="tab"') && nav.includes("aria-selected"));

const phaseCss = styles.slice(styles.indexOf("/* Phase 12: project workspace deep polish */"));
check("Phase 12 CSS marker exists", phaseCss.startsWith("/* Phase 12: project workspace deep polish */"));
check("Phase 12 CSS adds no important overrides", !phaseCss.includes("!important"));
check("Phase 12 CSS adds no backdrop filters", !phaseCss.includes("backdrop-filter"));
check("Phase 12 CSS adds no gradients", !phaseCss.includes("gradient("));
check("Phase 12 CSS adds no raw hex colors", !/#[0-9a-fA-F]{3,8}\b/.test(phaseCss));

check("Phase 12 docs define operational overview hierarchy", docs.includes("## Overview hierarchy") && docs.includes("Delivery → Build → QA → Release"));
check("Phase 12 docs preserve dedicated workspaces", docs.includes("hide dedicated workspaces") && docs.includes("Boards, Whiteboards, Timeline, Build, or QA"));
check("Phase 12 docs forbid polling and root workflow subscription", docs.includes("poll project state continuously") && docs.includes("root Cluster application"));
check("Phase 12 docs define release-blocking gate", docs.includes("## Release-blocking boundary") && docs.includes("project-workspace-phase12-audit.mjs"));
check("Phase 12 notes identify capability", notes.includes("project-workspace-phase12-v1") && notes.includes("2026-08-02.63"));
check("Changelog includes v0.435.0", changelog.includes('version: "v0.435.0"') && changelog.includes("Project workspace deep polish"));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 12 gate", String(pkg.scripts?.audit || "").includes("project-workspace-phase12-audit.mjs"));
check("named Phase 12 audit exists", String(pkg.scripts?.["audit:project-workspace-phase12"] || "").includes("project-workspace-phase12-audit.mjs"));
check("master packager invokes Phase 12 gate", packager.includes("project-workspace-phase12-audit.mjs"));
const docOccurrences = packager.split("docs/PROJECT_WORKSPACE_PHASE12.md").length - 1;
check("master and source packages carry Phase 12 docs", docOccurrences >= 2);

console.log(`\nProject workspace Phase 12 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
