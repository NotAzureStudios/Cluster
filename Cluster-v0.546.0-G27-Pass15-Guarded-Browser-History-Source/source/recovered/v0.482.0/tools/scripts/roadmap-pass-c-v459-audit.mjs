import { readFile } from "node:fs/promises";
const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");
const admin = await read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const projects = await read("packages/renderer/src/features/projects/ProjectsPage.tsx");
const account = await read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const css = await read("packages/renderer/src/styles/design-system/production-ui.css");
const marker = css.indexOf("v0.459 Pass C");
const passCss = marker >= 0 ? css.slice(marker) : "";
const checks = [
  ["admin uses shared workspace header", admin.includes("<WorkspacePageShell")],
  ["projects uses shared ToolPageHeader", projects.includes('className="projects-primary-header-v459"') && projects.includes('icon="project"')],
  ["account settings has pronounced title icon", account.includes("<WorkspacePageShell") && account.includes('title="Account Settings"') && account.includes('icon="user"')],
  ["Pass C production contract exists", marker >= 0],
  ["admin headers use full strong boundaries", passCss.includes("border: 1.5px solid var(--cluster-border-strong)")],
  ["admin panels remove decorative elevation", passCss.includes("Administration panels share one crisp header anatomy") && passCss.includes("box-shadow: none")],
  ["People Management gets directory/detail workbench rules", passCss.includes("People Management: make the directory/detail split behave like a workbench") && passCss.includes("user-admin-layout-v244")],
  ["Tool Infrastructure gets focused list/editor rules", passCss.includes("Tool Infrastructure: list first, one focused editor second") && passCss.includes("tool-catalog-list-v250 button.active")],
  ["Settings gets compact form workbench rules", passCss.includes("Settings: compact form workbench") && passCss.includes("settings-console-content-v269")],
  ["production workspaces share header hierarchy", passCss.includes("Production workspace headers now use the same visual hierarchy") && passCss.includes("tickets-page-v184") && passCss.includes("timeline-page-v156") && passCss.includes("calendar-page-v189")],
  ["project detail removes decorative color wash", passCss.includes("Project detail keeps project color as a locator") && passCss.includes("background: transparent") && passCss.includes("border-left: 0") && passCss.includes("border-top-color: var(--project-line)")],
  ["mobile admin KPI strip is swipeable", passCss.includes("scroll-snap-type: x proximity") && passCss.includes("operations-kpis-v245")],
  ["Pass C adds no forced styles", !passCss.includes("!important")],
  ["Pass C adds no raw hex colors", !/#[0-9a-f]{3,8}\b/i.test(passCss)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; }
console.log(`Roadmap Pass C v0.459: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
