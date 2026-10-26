import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const pkg = json("package.json");
const shellPrimitives = read("packages/renderer/src/features/shell/ShellPrimitives.tsx");
const shellCss = read("packages/renderer/src/features/shell/shell-v2.css");
const sidebar = read("packages/renderer/src/features/application/modules/ApplicationSidebar.tsx");
const taskbar = read("packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx");
const projectTabs = read("packages/renderer/src/features/shell/TaskbarProjectTabs.tsx");
const history = read("packages/renderer/src/features/shell/TaskbarHistory.tsx");
const app = read("packages/renderer/src/features/application/ClusterApplication.tsx");
const visual = read("packages/renderer/src/core/visual-system.ts");
const appearancePreview = read("packages/renderer/src/features/settings/AppearanceShellPreview.tsx");
const settings = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const settingsCss = read("packages/renderer/src/features/settings/settings-workspace.css");
const rail = read("packages/renderer/src/components/ClusterResizableRail.tsx");
const controlsCss = read("packages/renderer/src/styles/controls.css");
const masterDetail = read("packages/renderer/src/components/ClusterMasterDetail.tsx");
const primitiveCss = read("packages/renderer/src/styles/design-system/primitives.css");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const libraryCss = read("packages/renderer/src/features/library/library-workspace.css");

const checks = [
  ["Shell composition primitives exist", shellPrimitives.includes("export function ClusterTaskbar") && shellPrimitives.includes("export function ClusterSidebarShell") && shellPrimitives.includes("export function SidebarNavItem") && shellPrimitives.includes("export function SidebarProjectItem")],
  ["Sidebar consumes canonical shell composition primitives", sidebar.includes("<ClusterSidebarShell") && sidebar.includes("<SidebarNavItem") && sidebar.includes("<SidebarProjectItem") && sidebar.includes("<SidebarSection")],
  ["Taskbar consumes canonical ClusterTaskbar composition", taskbar.includes("<ClusterTaskbar") && taskbar.includes("tabs={<TaskbarProjectTabs")],
  ["Project tab behavior is extracted from the taskbar monolith", projectTabs.includes("export function TaskbarProjectTabs") && projectTabs.includes("cluster-taskbar-project") && taskbar.includes("TaskbarProjectTabs")],
  ["History/recovery behavior is extracted from the taskbar monolith", history.includes("export function TaskbarHistory") && history.includes("window.history.back()") && history.includes("window.history.forward()") && history.includes("cluster-taskbar-resume")],
  ["Shell 2.0 stylesheet is loaded after legacy Sidebar CSS", app.indexOf('import "../shell/sidebar.css"') >= 0 && app.indexOf('import "../shell/shell-v2.css"') > app.indexOf('import "../shell/sidebar.css"')],
  ["Shell 2.0 stylesheet defines canonical taskbar zones", [".cluster-taskbar__left", ".cluster-taskbar__tabs", ".cluster-taskbar__utilities"].every((selector) => shellCss.includes(selector))],
  ["Shell 2.0 stylesheet defines canonical Sidebar rows", shellCss.includes(".cluster-sidebar-nav-item") && shellCss.includes(".cluster-sidebar-project")],
  ["Taskbar has real Project overflow handling", projectTabs.includes("openProjects.length > 1") && projectTabs.includes("cluster-taskbar-projects__overflow") && projectTabs.includes("ClusterActionMenu")],
  ["Taskbar project tabs have compact/standard presentation hooks", shellCss.includes('data-project-tab-style="compact"') || shellCss.includes('data-project-tab-style="standard"') || shellCss.includes("cluster-taskbar-project")],

  ["Visual system has an explicit master visual instance", visual.includes("export const CLUSTER_VISUAL_MASTER") && visual.includes("cluster-visual-master")],
  ["Visual system exposes instance layers instead of copied component themes", visual.includes("export type VisualInstanceLayer") && visual.includes("export function resolveVisualInstance") && visual.includes("VISUAL_INSTANCE_PARAMETERS")],
  ["Effective visual context resolves through the visual instance layer", visual.includes("const instance = resolveVisualInstance(CLUSTER_VISUAL_MASTER") && visual.includes("resolveAccessibilityPreferences(instance")],
  ["Appearance page renders the live Cluster shell preview", settings.includes("<AppearanceShellPreview") && appearancePreview.includes("Live shell preview")],
  ["Appearance preview includes Sidebar, Taskbar and workspace surfaces", appearancePreview.includes("appearance-shell-preview__sidebar") && appearancePreview.includes("appearance-shell-preview__taskbar") && appearancePreview.includes("appearance-shell-preview__content")],
  ["Appearance preview styling is owned by settings workspace", settingsCss.includes("appearance-shell-preview-v10") && settingsCss.includes("appearance-shell-preview__frame")],

  ["Resizable rail supports a real collapsed state", rail.includes("collapsed = false") && rail.includes("data-rail-collapsed") && rail.includes("!collapsed ?")],
  ["Collapsed rails surrender their grid track", controlsCss.includes("cluster-resizable-rail-v497.rail-collapsed") && controlsCss.includes("grid-template-columns:minmax(0,1fr)")],
  ["Master/detail primitive has an explicit closed-inspector state", masterDetail.includes('detailOpen ? "detail-open" : "detail-empty"')],
  ["Closed inspectors surrender the shared detail track", primitiveCss.includes(".cluster-master-detail-v429.detail-empty { grid-template-columns: minmax(0, 1fr);") && primitiveCss.includes(".cluster-master-detail-v429.detail-empty .cluster-detail-pane-v429 { display: none;")],

  ["Library Explorer can collapse independently of the page", library.includes('library.explorer-collapsed') && library.includes("collapsed={explorerCollapsed}") && library.includes("library-explorer-toggle-v10")],
  ["Library Explorer sections remember their own collapse states", ["library.explorer.views-open", "library.explorer.collections-open", "library.explorer.folders-open"].every((key) => library.includes(key))],
  ["Library Explorer exposes separate Views, Collections and Folders sections", library.includes("<strong>Views</strong>") && library.includes("<strong>Collections</strong>") && library.includes("<strong>Folders</strong>")],
  ["Library no longer renders a fixed-height virtual list", library.includes("function LibraryListRows") && !library.includes("function VirtualLibraryList") && !library.includes("height: 590")],
  ["Library automatically pages as document scroll approaches the end", library.includes("IntersectionObserver") && library.includes('rootMargin: "900px 0px"') && library.includes("loadMoreSentinelRef")],
  ["Library retains an explicit load-more recovery action", library.includes("More items load as you scroll") && library.includes("Load more now")],
  ["Library cards and list rows use browser content virtualization hints", libraryCss.includes("content-visibility:auto") && libraryCss.includes("contain-intrinsic-size")],
  ["Library grid reflows from available container width", libraryCss.includes("repeat(auto-fill,minmax(min(196px,100%),1fr))")],
  ["Library fixed viewport clamp was removed", !libraryCss.includes("height:clamp(620px,calc(100dvh - 270px),860px)")],
  ["Library canonical results surface allows document scrolling", libraryCss.includes(".cluster-library-workspace .library-results-v217{min-height:0;flex:1 1 auto;overflow:visible}") || libraryCss.includes(".library-results-v217{min-height:0;overflow:visible !important}" )],
  ["Library inspector collapse explicitly reclaims the content width", libraryCss.includes(".library-master-detail-v429.detail-empty") && libraryCss.includes("grid-template-columns: minmax(0, 1fr) !important")],
  ["Library Explorer becomes sticky instead of trapping the whole workspace", libraryCss.includes(".library-sidebar-v217{align-self:start;position:sticky") && libraryCss.includes("max-height:calc(100dvh")],

  ["Collections support manual and smart creation", library.includes('createLibraryCollection("manual")') && library.includes('createLibraryCollection("smart")')],
  ["Collections now expose rename and removal actions", library.includes("renameLibraryCollection") && library.includes("deleteLibraryCollection") && library.includes("Remove collection")],
  ["Smart collections can update their rules from the current view", library.includes("updateSmartCollectionFromCurrentView") && library.includes("Update from current view") && library.includes("smartCollectionQueryFromCurrentView()")],
  ["Collection edits use revision fencing", library.includes("expectedRevision: collection.revision")],
  ["Removing a collection explicitly preserves Library items", library.includes("Library items are not deleted") && library.includes("Library items were left intact")],
  ["Collection rows have independent action-menu chrome", library.includes("library-collection-row-v10") && libraryCss.includes(".library-collection-row-v10")],

  ["Pass 10 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass10:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 10 Shell + Library assertions passed.`);
if (failed.length) process.exit(1);
