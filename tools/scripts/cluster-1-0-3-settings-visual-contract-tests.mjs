import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const chips = read("packages/renderer/src/components/SettingsStateChip.tsx");
const chipCss = read("packages/renderer/src/components/settings-state-chip.css");
const server = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const integrations = read("packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx");
const systems = read("packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx");
const forms = read("packages/renderer/src/features/settings/MyFormsPanel.tsx");
const automation = read("packages/renderer/src/features/application/modules/application-automation-settings.tsx");
const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const settingsCss = read("packages/renderer/src/features/settings/settings-workspace.css");
const automationCss = read("packages/renderer/src/features/application/styles/automation-settings.css");
const adminCss = read("packages/renderer/src/features/admin/admin.css");
const topology = read("packages/renderer/src/features/settings/ServerNetworkTopology.tsx");
const topologyCss = read("packages/renderer/src/features/settings/server-network-topology.css");

const checks = [
  ["semantic status tones", chips.includes('"neutral" | "info" | "success" | "warning" | "danger"')],
  ["chip icons + text", chips.includes('DEFAULT_ICONS') && chips.includes('children: ReactNode')],
  ["color not sole signal", chips.includes('<span>{children}</span>') && chipCss.includes("border: 1px")],
  ["no arbitrary rainbow panel", chipCss.includes("--chip-color: var(--warning") && chipCss.includes("--chip-color: var(--danger")],
  ["restart field metadata", server.includes("Restart after save") && server.includes("Restart on change")],
  ["server network chip is not public proof", server.includes("Local startup verified")],
  ["integration health uses observed healthState", integrations.includes("integrationStateTone(connection.healthState)") && integrations.includes("Last check healthy")],
  ["integration provider is availability not health", integrations.includes('label: "Discord provider"') && integrations.includes('detail: botTokenConfigured || webhookConfigured ? "Credentials configured · health unverified"')],
  ["discord OAuth configuration is not a live test", integrations.includes("Configuration present · test account linking")],
  ["integration telemetry scoped styling", adminCss.includes(".admin-integration-health-cell-v103")],
  ["form/policy version publication from records", systems.includes('version.status === "published"') && systems.includes("formsWithPublishedVersion") && systems.includes("policiesWithPublishedVersion")],
  ["form/policy chips", systems.includes("formTone(") && systems.includes("policyTone(")],
  ["personal forms use due states", forms.includes('item.dueState === "overdue"') && forms.includes('item.dueState === "completed"')],
  ["personal forms retain separate reviewer entitlement", forms.includes("Separate permission") && forms.includes("reviewForms.length")],
  ["automation queue sample not total", automation.includes("Loaded queue sample") && automation.includes("jobs.filter((job) => job.status ===")],
  ["automation rule enablement chips", automation.includes("rule.enabled ? \"Enabled\" : \"Disabled\"")],
  ["automation dry-run is explicitly non-executable", automation.includes("Preview only · no actions committed")],
  ["automation responsive metrics", automationCss.includes(".automation-overview-v103")],
  ["project preview is driven from current settings draft", studio.includes("studio-project-defaults-preview-v103") && studio.includes("settings.defaultCreateStarterBoard !== false")],
  ["project visibility not effective permissions", studio.includes("Permissions apply separately") && studio.includes("does not create anything")],
  ["project default responsive preview", settingsCss.includes(".studio-project-defaults-preview-v103")],
  ["network topology renders configured origin", topology.includes("publicWebUrl.trim()") && topology.includes('NetworkNode icon="cloud"')],
  ["network topology warns all-interface API binds", topology.includes("All-interface bind · review exposure")],
  ["network diagram explicitly disclaims external verification", topology.includes("External test not run") && topology.includes("Public DNS, TLS and external reachability not verified here")],
  ["network topology is responsive without live probe requests", topologyCss.includes("@media (max-width: 680px)") && !topology.includes("fetch(") && !topology.includes("api(")],
  ["network topology reflects draft and rollout state", server.includes("<ServerNetworkTopology") && server.includes("hasDraftChanges={changedFields.some")],

];

for (const [description, passed] of checks) assert.ok(passed, description);
console.log(`Cluster 1.0.3 settings visual source contracts: ${checks.length} passed.`);
