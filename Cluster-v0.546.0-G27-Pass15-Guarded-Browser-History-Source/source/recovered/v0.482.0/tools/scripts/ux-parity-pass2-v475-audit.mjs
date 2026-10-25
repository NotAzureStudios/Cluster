import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const production = read("packages/renderer/src/styles/design-system/production-ui.css");
const toolsCss = read("packages/renderer/src/styles/layers/application-tools.css");
const visual = read("packages/renderer/src/styles/visual-polish.css");
const adaptive = read("packages/renderer/src/styles/layers/application-adaptive.css");
const color = read("packages/renderer/src/components/ColorField.tsx");
const fileButton = read("packages/renderer/src/components/ClusterFileButton.tsx");
const create = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const workspaces = read("packages/renderer/src/features/application/modules/application-workspaces.tsx");
const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
const admin = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const video = read("packages/renderer/src/features/projects/ProjectVideoWorkspace.tsx");
const copyright = read("packages/renderer/src/features/legal/CopyrightReportPage.tsx");
const changelog = read("packages/renderer/src/features/changelog/data/cluster-changelog.ts");
const notes = read("RELEASE_NOTES_v0.475.0.md");
const packager = read("tools/scripts/package-cluster-master.mjs");

const version = String(pkg.version || "0.0.0").split(".").map((part) => Number(part) || 0);
const atLeast475 = version[0] > 0 || version[1] > 475 || (version[1] === 475 && version[2] >= 0);
const pass2 = production.slice(production.indexOf("v0.475 Phase 2 / Pass 2"));

const checks = [
  ["v0.475 UX parity pass is active", atLeast475],
  ["focus color is a neutral accessibility token", production.includes("--cluster-focus-color: var(--cluster-cyan-500)")],
  ["legacy global field focus no longer follows studio branding", !toolsCss.includes("input:focus-visible, select:focus-visible, textarea:focus-visible) { border-color: color-mix(in srgb, var(--studio-primary")],
  ["visual focus no longer follows studio branding", !visual.match(/focus-visible[^\n]*studio-primary/)],
  ["adaptive focus no longer follows studio branding", !adaptive.match(/focus-visible[^\n]*studio-primary/)],
  ["legacy field priority overrides no longer pin every input geometry", !toolsCss.includes(":where(input, select, textarea) { width: 100%; min-height: var(--v117-control-h) !important")],
  ["shared upload trigger owns visible file chrome", fileButton.includes("cluster-file-button-v475") && fileButton.includes("cluster-file-input-v475") && fileButton.includes("inputRef.current.click()")],
  ["Studio image upload uses the shared file trigger", studio.includes("<ClusterFileButton") && studio.includes('label="Upload studio image"')],
  ["People admin avatar upload uses the shared file trigger", admin.includes('label="Upload profile image"')],
  ["profile avatar upload uses the shared file trigger", workspaces.includes('label="Upload profile icon"')],
  ["project video upload uses the shared file trigger", video.includes('label="Upload video"')],
  ["legal evidence upload no longer exposes a native Choose File control", copyright.includes('label="Add evidence files"') && !copyright.includes('<input type="file"')],
  ["Create launcher search receives a fixed compact row", pass2.includes("grid-template-rows: 48px 38px minmax(0, 1fr) 36px") && pass2.includes("min-height: 32px")],
  ["Create launcher removes the one-sided active stripe", pass2.includes(".shared-create-type-list-v458 > button::before { display: none; }")],
  ["Create catalog remains the flexible region", create.includes("shared-create-picker-scroll-v455 shared-create-picker-scroll-v458") && pass2.includes("minmax(0, 1fr)")],
  ["color picker temporarily escapes clipping surfaces", pass2.includes(':has(.cluster-color-field-v455.open)') && pass2.includes("overflow: visible")],
  ["color selection does not reuse the studio brand as a perimeter", pass2.includes(".cluster-color-grid-v458 > button.active") && pass2.includes("border-color: var(--cluster-border-strong)")],
  ["color picker remains a bounded compact popover", pass2.includes("width: min(340px, calc(100vw - 24px))") && pass2.includes("max-height: min(480px, calc(100dvh - 28px))")],
  ["clock-in supports project filtering on larger project sets", workspaces.includes("clock-project-search-v475") && workspaces.includes("visibleProjects")],
  ["clock-out presents active work context instead of only three raw metrics", workspaces.includes("clock-out-work-v475") && workspaces.includes('active?.title || "Clocked work"')],
  ["clock project selection uses quiet full-boundary state", pass2.includes(".clock-project-options-v470 > button.active") && pass2.includes("background: var(--surface-selected)")],
  ["timeline quarter control receives a dedicated readable minimum width", pass2.includes("minmax(72px, 1.12fr)") && pass2.includes("white-space: nowrap")],
  ["Pass 2 production contract adds no priority overrides", !pass2.includes("!important")],
  ["v0.475 release is documented", changelog.includes('version: "v0.475.0"') && notes.includes("Phase 2 Pass 2")],
  ["v0.475 parity gate participates in master packaging", packager.includes("ux-parity-pass2-v475-audit.mjs")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
console.log(`UX parity Pass 2 v0.475: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exit(1);
