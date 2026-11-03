// Lightweight UI contract to prevent reintroducing the numbered flow rail
// or silently losing the ability to settle an already-staged network rollout.
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const page = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const domain = read("packages/renderer/src/features/domains/DomainManagementPanel.tsx");
const nav = read("packages/renderer/src/components/CompactSectionNav.tsx");
const shell = read("packages/renderer/src/components/SettingsWorkspaceShell.tsx");
const layout = read("packages/renderer/src/features/settings/settings-workspace.css");
const native = read("apps/server-launcher-go/launcher_ui_windows.go");
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed += 1; }
check(!page.includes("PipelineRail"), "no sequence/flow rail on Server Configuration");
check(page.includes('activeId={section}'), "side navigation addresses active subsection, not only group");
check(page.includes('primaryIds={sectionLabels.map((item) => item.id)}'), "all settings destinations appear in persistent sidebar");
check(page.includes("showGroupHeadings"), "server subsection headings requested");
check(nav.includes("compact-section-group-heading-v103") && shell.includes("showGroupHeadings"), "grouped nav supported by reusable components");
check(page.includes('networkDeploymentPending') && page.includes('NETWORK_DEPLOYMENT_PENDING'), "409 staged rollout receives specific UI");
check(page.includes("authorizePendingRestart") && page.includes('method: "POST"'), "restart is explicitly operator-authorized");
check(page.includes("networkDeploymentPending || !changedFields.length"), "save is held while rollout is staged");
check(domain.includes('className="cluster-domain-progress-v103"'), "domain readiness overview exists");
check(domain.includes("domainsLoadError") && domain.includes("Retry loading domains"), "domain failure is distinguishable from empty registry");
check(domain.includes("listRequestSequence.current") && domain.includes("search.trim() ? 250 : 0"), "domain search debounced with stale response guard");
check(domain.includes("cluster-domain-workflow-card-v103"), "hostname and gateway are distinct panels");
check(layout.includes(".cluster-domains-rc46 {") && layout.includes("background: var(--domain-surface)"), "domain surface covers patterned workspace background");
check(layout.includes("@media (max-width: 700px)"), "mobile presentation exists");
check(native.includes("verifyNativeNetworkDeployment(c.options.root)"), "interactive supervisor settles staged network rollout on readiness");
console.log(`Cluster 1.0.3 Server Config UI: ${passed} source contracts passed.`);
