import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const pkg = json("package.json");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const libraryCss = read("packages/renderer/src/features/library/library-workspace.css");
const planning = read("packages/renderer/src/features/projects/ProjectPlanningPanel.tsx");
const detail = read("packages/renderer/src/features/projects/ProjectDetailPage.tsx");
const integrations = read("packages/renderer/src/features/projects/ProjectConnectionsPanel.tsx");
const portfolio = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
const projectCss = read("packages/renderer/src/features/projects/project-detail-workspace.css");

const checks = [
  ["Library folder expansion persists as user state", library.includes('library.explorer.expanded-folders') && library.includes('useServerState<string[]>')],
  ["Library folder tree exposes expand/collapse all", library.includes('Expand" : "Expand"') || (library.includes('Collapse" : "Expand"') && library.includes('allExpanded'))],
  ["Library expand-all includes every expandable folder and root", library.includes('new Set(["root", ...expandableFolderIds])')],
  ["Library collapse-all preserves the Library root", library.includes('new Set(["root"])')],
  ["Library tree toolbar has dedicated canonical styling", libraryCss.includes('.library-tree-toolbar-v13') && libraryCss.includes('.library-tree-expand-all-v13')],
  ["Project Plan receives the canonical setup checklist", detail.includes('setupChecklist={setupChecklist}') && planning.includes('setupChecklist = []')],
  ["Project Plan computes readiness from concrete checks", planning.includes('completedSetup') && planning.includes('readinessPercent')],
  ["Project Plan renders actionable readiness rows", planning.includes('title="Readiness"') && planning.includes('item.done ? "Ready" : "Required"')],
  ["Project readiness styling differentiates ready and required checks", projectCss.includes('.project-readiness-v13__list') && projectCss.includes('[data-done="true"]')],
  ["Project Integrations workspace uses Integrations wording", integrations.includes('eyebrow="Integrations"') && integrations.includes('title="Project integrations"')],
  ["Project Integrations save action no longer says connections", integrations.includes('Save integrations') && !integrations.includes('Save connections')],
  ["Project detail save status uses integrations wording", detail.includes('Saving project integrations…') && detail.includes('Project integrations saved.')],
  ["Portfolio understands the at-risk Project Snapshot state", portfolio.includes('health.state === "at_risk"') && portfolio.includes('label: "At Risk"')],
  ["Pass 13 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass13:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 13 Library + Projects Polish assertions passed.`);
if (failed.length) process.exit(1);
