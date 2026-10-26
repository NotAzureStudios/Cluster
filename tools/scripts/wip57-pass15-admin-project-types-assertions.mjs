import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const pkg = json("package.json");
const studioState = read("packages/renderer/src/features/settings/studio-settings-state.ts");
const studioPage = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const settingsModel = read("packages/renderer/src/features/application/application-models/settings-server.ts");
const settingsRoute = read("apps/server/src/app/server-routes-configuration-integrations.ts");
const createDrawer = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const projectTypes = read("packages/shared/src/project-types.ts");
const adminState = read("packages/renderer/src/features/admin/admin-workspace-state.ts");
const adminPage = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const adminUtility = read("packages/renderer/src/features/admin/AdminUtilitySections.tsx");
const manifest = read("packages/shared/src/cluster-manifest.ts");
const adminCss = read("packages/renderer/src/features/admin/admin-workspace.css");
const settingsCss = read("packages/renderer/src/features/settings/settings-workspace.css");
const checklist = read("RC17_RUNTIME_TEST_CHECKLIST.md");
const serverConfigPage = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const toolInfrastructurePage = read("packages/renderer/src/features/application/modules/application-admin-workspaces.tsx");

const checks = [
  ["Studio Settings has five canonical top-level groups", studioState.includes('label: "Studio"') && studioState.includes('label: "People & Access"') && studioState.includes('label: "Projects"') && studioState.includes('label: "Delivery"') && studioState.includes('label: "Automation"') && (studioState.match(/nav: true/g) || []).length === 0],
  ["Studio Settings uses a contextual visual rail instead of another top-level submenu", studioPage.includes("studioSettingsNavAnchor(section)") && studioPage.includes("<PipelineRail") && studioPage.includes("visibleStudioGroupSections")],
  ["Operations exposes only five canonical admin destinations", adminState.includes('label: "Command Center"') && adminState.includes('label: "Incidents"') && adminState.includes('label: "Governance"') && adminState.includes('label: "Systems"') && adminState.includes('label: "Data & Audit"') && !adminState.includes('nav: false')],
  ["Old admin destinations converge into canonical surfaces", adminState.includes('requested === "approvals"') && adminState.includes('return "security-center"') && adminState.includes('["operations-center", "maintenance", "system", "persistence", "stabilization"]') && adminState.includes('return "systems"') && adminState.includes('["activity", "imports", "changelog", "data-model", "templates"]') && adminState.includes('return "reports"')],
  ["Governance combines approvals and Security Center", adminPage.includes('adminSection === "security-center"') && adminPage.includes("<AdminApprovalCenter projects={projects} />") && adminPage.includes("<SecurityCenterPanel")],
  ["Systems combines system status, runtime evidence, maintenance and recovery", adminPage.includes('adminSection === "systems"') && adminPage.includes("<OperationsSystemsPanel />") && adminPage.includes("<OperationsCenterPanel />") && adminPage.includes("<OperationsEvidencePanel />") && adminPage.includes("<AdminMaintenanceToolsPanel") && adminPage.includes("<PersistenceBridgePanel />") && adminPage.includes("<StabilizationCenterPanel")],
  ["Data & Audit combines reports, imports, relationships, templates, changelog and activity", adminPage.includes('adminSection === "reports"') && adminPage.includes("<AdminReportsPanel") && adminPage.includes("<ImportToolsPanel") && adminPage.includes("<DataModelStandardsPanel") && adminPage.includes("<TemplateStudioPanel") && adminPage.includes("<ChangelogPage />") && adminPage.includes("initialView=\"audit\"")],
  ["Admin utility router is reduced to People exports", adminUtility.includes('if (adminSection !== "exports") return null') && !adminUtility.includes('adminSection === "maintenance"') && !adminUtility.includes('adminSection === "imports"')],
  ["Admin surfaces use visual health strips", (adminPage.match(/<HealthStrip/g) || []).length >= 3 && adminCss.includes("admin-consolidated-stack-v15")],
  ["Command Center is an administration hub", adminPage.includes("admin-workspace-hub-v15") && adminPage.includes("Studio settings") && adminPage.includes("Tools") && adminPage.includes("Server") && adminPage.includes("Governance") && adminPage.includes("Data & audit")],
  ["Server Configuration is flattened into four contextual domains", serverConfigPage.includes('label: "Runtime"') && serverConfigPage.includes('label: "Security & Access"') && serverConfigPage.includes('label: "Data & Recovery"') && serverConfigPage.includes('label: "Extensions"') && serverConfigPage.includes('navLabel="Server configuration domains"') && serverConfigPage.includes('<PipelineRail')],
  ["Tool Infrastructure keeps specialist time administration collapsed", toolInfrastructurePage.includes('<details className="panel admin-consolidated-details-v15 tool-infrastructure-time-admin-v15">') && toolInfrastructurePage.includes("Advanced time administration") && toolInfrastructurePage.includes("Routine scheduling stays in the Scheduler workspace")],
  ["Standalone Activity is removed from admin sidebar duplication", manifest.includes('activity: { label: "Activity", group: "control", tool: "activity", adminOnly: true, parent: "admin", action:') && !manifest.includes('activity: { label: "Activity", group: "control", tool: "activity", adminOnly: true, parent: "admin", sidebar:')],
  ["Project Type tools use the canonical manifest and visual tri-state control", studioPage.includes("CLUSTER_PROJECT_TOOL_IDS.map") && studioPage.includes('value: "included", label: "On"') && studioPage.includes('value: "optional", label: "Optional"') && studioPage.includes('value: "hidden", label: "Off"') && settingsCss.includes("project-type-tool-matrix-v15")],
  ["Project Type tool lists are canonical and mutually exclusive server-side", projectTypes.includes("const hiddenToolSet = new Set(hiddenTools)") && projectTypes.includes("const optionalToolSet = new Set(optionalTools)") && projectTypes.includes("!hiddenToolSet.has(tool) && !optionalToolSet.has(tool)")],
  ["Technology presets explicitly separate standard from specialized profiles", projectTypes.includes('exposure?: "standard" | "specialized"') && projectTypes.includes('exposure: "standard"') && (projectTypes.match(/exposure: "specialized"/g) || []).length >= 8],
  ["Studio specialized-profile selection uses a typed array", settingsModel.includes("studioEnabledProductionProfileIds?: string[]") && settingsRoute.includes("studioEnabledProductionProfileIds: z.array") && !settingsModel.includes("studioEnabledProductionProfilesCsv")],
  ["Project creation filters specialized technology presets by Studio opt-in", createDrawer.includes("clusterProductionProfilesForStudio(enabledProductionProfileIds)") && createDrawer.includes("productionProfiles.length > 1") && createDrawer.includes("Technology preset")],
  ["Build profile choices follow enabled technology presets", studioPage.includes("enabledSpecializedBuildProfileKeys") && studioPage.includes("availableBuildProfiles") && studioPage.includes('profile.key === "generic" || enabledSpecializedBuildProfileKeys.has(profile.key)')],
  ["CurseForge admin policy is hidden unless a relevant technology preset is enabled", studioPage.includes("curseForgePublishingEnabled") && studioPage.includes("{curseForgePublishingEnabled ? <div")],
  ["Default creation policy is vendor-neutral", studioPage.includes('studioCreateConditionalFieldsCsv: "external project: external project owner"') && !studioPage.includes('studioCreateConditionalFieldsCsv: "external project: external project owner; unreal:') && createDrawer.includes('placeholder="Package link, folder, release draft, portal URL"')],
  ["Pass 15 runtime checklist covers consolidated admin and Project Type behavior", checklist.includes("Pass 15 — Admin surfaces + Project Type generalization") && checklist.includes("technology presets") && checklist.includes("100%, 125%, and 150%")],
  ["Pass 15 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass15:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 15 Admin + Project Types assertions passed.`);
if (failed.length) process.exit(1);
