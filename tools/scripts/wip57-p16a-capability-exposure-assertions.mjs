import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, condition: Boolean(condition) });

const packageJson = JSON.parse(read("package.json"));
const libraryPage = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const libraryGovernance = read("packages/renderer/src/features/library/LibraryGovernancePanel.tsx");
const libraryTypes = read("packages/renderer/src/features/library/library-types.ts");
const libraryRoutes = read("apps/server/src/domains/library/library-routes.ts");
const projectAccess = read("packages/renderer/src/features/projects/ProjectAccessPanel.tsx");

check("Library inspector has first-class lifecycle tab", libraryTypes.includes('"lifecycle"') && libraryPage.includes('tab === "lifecycle"'));
check("Library lifecycle tab uses dedicated governance surface", libraryPage.includes("LibraryGovernancePanel") && libraryGovernance.includes("Retention & hold"));
check("Library governance exposes actual backlink listing", libraryGovernance.includes(`/api/library/${"${item.id}"}/backlinks`) && libraryGovernance.includes("References & backlinks"));
check("Library governance exposes retention authority", libraryGovernance.includes(`/api/library/${"${item.id}"}/retention`) && libraryGovernance.includes("Save lifecycle policy"));
check("Library governance exposes legal hold control", libraryGovernance.includes("Legal / administrative hold") && libraryGovernance.includes("legalHold"));
check("Library governance exposes restore lifecycle", libraryGovernance.includes(`/api/library/${"${item.id}"}/restore`) && libraryGovernance.includes("Library item restored"));
check("Library governance uses typed confirmation for permanent destruction", libraryGovernance.includes("expectedValue: item.title") && libraryGovernance.includes(`/api/library/${"${item.id}"}/disposition`));
check("Destruction preview returns dependency evidence", libraryRoutes.includes("evidence: {") && libraryRoutes.includes("children: childRows") && libraryRoutes.includes("backlinks: backlinkRows.map") && libraryRoutes.includes("versions: versionRows"));
check("Project Access uses authoritative access explanation API", projectAccess.includes('/api/access/explain?${params}') && projectAccess.includes("Access Explorer"));
check("Project Access renders authorization contributors", projectAccess.includes("decision.contributors") && projectAccess.includes("contributor.detail"));
check("Project Access no longer renders local member preview rows", !projectAccess.includes("const previewRows =") && !projectAccess.includes("Member preview"));
check("P16A capability exposure assertions are wired", String(packageJson.scripts?.["verify:source-foundation"] || "").includes("wip57:p16a:assertions"));

let failed = 0;
for (const item of checks) {
  if (item.condition) console.log(`PASS ${item.label}`);
  else { console.error(`FAIL ${item.label}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} WIP57 P16A capability exposure assertions passed.`);
if (failed) process.exit(1);
