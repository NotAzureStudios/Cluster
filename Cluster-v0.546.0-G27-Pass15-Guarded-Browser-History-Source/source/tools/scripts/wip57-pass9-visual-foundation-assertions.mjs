import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const pkg = json("package.json");
const visual = read("packages/renderer/src/core/visual-system.ts");
const visualCss = read("packages/renderer/src/styles/visual-system.css");
const shellRuntime = read("packages/renderer/src/features/application/modules/application-shell-runtime.ts");
const foundation = read("packages/renderer/src/features/application/modules/application-foundation.tsx");
const models = read("packages/renderer/src/features/application/application-models/settings-server.ts");
const settings = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
const settingsCss = read("packages/renderer/src/features/settings/settings-workspace.css");
const taskbar = read("packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx");
const taskbarHistory = read("packages/renderer/src/features/shell/TaskbarHistory.tsx");
const taskbarSurface = `${taskbar}\n${taskbarHistory}`;
const dashboard = read("packages/renderer/src/features/application/modules/ApplicationDashboard.tsx");
const app = read("packages/renderer/src/features/application/ClusterApplication.tsx");
const serverPrefs = read("apps/server/src/domains/users/user-preference-routes.ts");
const serverTypes = read("apps/server/src/app/server-composition-types.ts");

const checks = [
  ["Canonical visual resolver exists", visual.includes("export type EffectiveVisualContext") && visual.includes("export function resolveVisualContext") && visual.includes("export function applyVisualContext")],
  ["Background base and pattern are independent visual parameters", visual.includes('VisualBackgroundBase = "clean" | "gradient" | "aurora" | "midnight"') && visual.includes('VisualBackgroundPattern = "none" | "hex" | "grid" | "dots"')],
  ["Visual resolver constrains glass when transparency is disabled", visual.includes('requestedSurface === "glass" && accessibility.transparency === "off" ? "outlined"') && visual.includes('value === "glass" && accessibility.transparency === "off" ? "solid"')],
  ["Visual resolver publishes canonical shell and taskbar datasets", visual.includes("root.dataset.sidebarSurface") && visual.includes("root.dataset.taskbarSurface") && visual.includes("root.dataset.taskbarLabels") && visual.includes("root.dataset.projectTabStyle")],
  ["Visual resolver publishes pattern scale and strength tokens", visual.includes("--cluster-pattern-percent") && visual.includes("--cluster-pattern-scale")],
  ["Visual resolver publishes glass percentage without CSS arithmetic hacks", visual.includes("--glass-percent") && visualCss.includes("var(--glass-percent, 58%)")],
  ["Shell runtime delegates appearance resolution to visual system", shellRuntime.includes("resolveVisualContext") && shellRuntime.includes("applyVisualContext")],
  ["Old foundation no longer defines a duplicate customization resolver", !foundation.includes("export function applyCustomization") && !foundation.includes("function applyCustomization")],
  ["Canonical appearance preferences are represented in renderer Settings", ["backgroundBaseStyle", "backgroundPattern", "backgroundPatternIntensity", "backgroundPatternScale", "surfaceStyle", "sidebarSurface", "taskbarSurface", "projectTabStyle"].every((key) => models.includes(key))],
  ["Server preference schema accepts dense density", serverPrefs.includes('interfaceDensity: z.enum(["dense", "compact", "comfortable"])')],
  ["Server preference schema accepts canonical visual parameters", ["backgroundBaseStyle", "backgroundPattern", "backgroundPatternIntensity", "backgroundPatternScale", "sidebarSurface", "taskbarSurface", "projectTabStyle"].every((key) => serverPrefs.includes(key))],
  ["Server composition payload carries canonical visual parameters", ["backgroundBaseStyle", "backgroundPattern", "backgroundPatternIntensity", "backgroundPatternScale", "sidebarSurface", "taskbarSurface", "projectTabStyle"].every((key) => serverTypes.includes(key))],
  ["Appearance UI edits background base independently", settings.includes('patch("backgroundBaseStyle", option)') && settings.includes('["clean", "gradient", "aurora", "midnight"]')],
  ["Appearance UI edits background pattern independently", settings.includes('patch("backgroundPattern", option)') && settings.includes('["none", "hex", "grid", "dots"]')],
  ["Appearance UI exposes pattern intensity and scale", settings.includes("Pattern intensity") && settings.includes('patch("backgroundPatternIntensity"') && settings.includes('patch("backgroundPatternScale"')],
  ["Appearance UI exposes Sidebar and Taskbar surface parameters", settings.includes('patch("sidebarSurface", option)') && settings.includes('patch("taskbarSurface", option)')],
  ["Appearance UI exposes real Taskbar label and Project tab parameters", settings.includes('patch("userTaskbarLabels", option)') && settings.includes('patch("projectTabStyle", option)')],
  ["Appearance UI uses canonical motion preference", settings.includes('["system", "full", "reduced", "none"]') && settings.includes('patch("userMotionPreference", option)')],
  ["Appearance editor has dedicated visual-instance styling", settingsCss.includes("appearance-visual-instance-v3") || settingsCss.includes("appearance-instance" ) || settingsCss.includes("appearance-visual" )],
  ["Hex background is a first-class procedural pattern", visualCss.includes(':root[data-background-pattern="hex"]') && visualCss.includes("linear-gradient(30deg") && visualCss.includes("--cluster-visual-pattern-position")],
  ["Grid and dot patterns remain first-class alternatives", visualCss.includes(':root[data-background-pattern="grid"]') && visualCss.includes(':root[data-background-pattern="dots"]')],
  ["Workspace background consumes resolved pattern position and size", visualCss.includes("background-position: var(--cluster-visual-pattern-position), center top") && visualCss.includes("background-size: var(--cluster-visual-pattern-size), cover")],
  ["Taskbar labels now consume the appearance preference", visualCss.includes(':root[data-taskbar-labels="icons"] .cluster-taskbar-action__label') && taskbar.includes('className="cluster-taskbar-action__label"')],
  ["Back and Forward controls are universal taskbar controls", taskbarSurface.includes('aria-label="Navigation history"') && taskbarSurface.includes('onClick={() => window.history.back()}') && taskbarSurface.includes('onClick={() => window.history.forward()}')],
  ["Workspace recovery moved into compact taskbar chrome", taskbarHistory.includes('className="cluster-taskbar-resume"') && taskbarHistory.includes("onResumeContext") && taskbarHistory.includes("onClearResumeContext")],
  ["Giant Home resume card is removed from active Dashboard markup", !dashboard.includes('className="smart-resume-v276"') && !dashboard.includes("visibleResumeContext") && !dashboard.includes("resumeTitle") && !dashboard.includes("resumeDetail")],
  ["Dashboard no longer owns resume/clear actions", !dashboard.includes("onResumeContext") && !dashboard.includes("onClearResumeContext")],
  ["Visual system stylesheet is loaded after Sidebar legacy CSS", app.indexOf('import "../shell/sidebar.css"') >= 0 && app.indexOf('import "../../styles/visual-system.css"') > app.indexOf('import "../shell/sidebar.css"')],
  ["Pass 9 visual assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass9:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 9 Visual Foundation assertions passed.`);
if (failed.length) process.exit(1);
