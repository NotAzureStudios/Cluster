import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); } })();
const sidebar = read('packages/renderer/src/features/application/modules/ApplicationSidebar.tsx');
const shared = read('packages/shared/src/cluster-manifest.ts');
const application = read('packages/renderer/src/features/application/ClusterApplication.tsx');
const settings = read('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
const state = read('packages/renderer/src/features/settings/studio-settings-state.ts');
const systems = read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx');
const gallery = read('packages/renderer/src/features/projects/ProjectsPage.tsx');
const card = read('packages/renderer/src/features/projects/ProjectPortfolioItem.tsx');
const overview = read('packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx');
const timeline = read('packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx');
assert.match(shared, /inventory: \{[^\n]*sidebar: \{[^\n]*icon: "inventory"/);
assert.match(shared, /ClusterAppNavigationIcon[^\n]*"inventory"/);
for (const section of ['customFields','projectTypes','domains','automations']) assert.match(sidebar, new RegExp(`section: "${section}"`));
for (const tab of ['forms','policies','applications','announcements']) assert.match(sidebar, new RegExp(`subsection: "${tab}"`));
assert.match(sidebar, /tools\.filter\(\(\{ screen: route \}\) => route !== "studioSettings"\)/);
assert.match(sidebar, /"cluster-sidebar-admin-list"/);
assert.match(sidebar, /tools\.map|renderRouteLink\(route, true\)/);
assert.match(sidebar, /setScreen\("studioSettings", \{ section: item\.section, subsection: item\.subsection \}\)/);
assert.match(application, /initialSubsection=\{routeSubsection\}/);
assert.match(application, /current !== next \|\| \(next === "studioSettings"/);
assert.match(systems, /initialTab/);
assert.match(systems, /onTabChange\?\.\(value\)/);
assert.match(settings, /section === "customFields" && \(\s*<div[^>]*people-profile-fields-admin/);
assert.doesNotMatch(settings, /section === "people" && \(/);
assert.doesNotMatch(state, /\{ key: "studioSystems", group: "Studio"/);
assert.doesNotMatch(state, /\{ key: "people", group: "People & Access"/);
assert.match(gallery, /if \(!inspectorOpen && !analyticsOpen && !intelligenceOpen\) return;/);
assert.doesNotMatch(card, /project-tile-summary-rc25/);
assert.doesNotMatch(overview, /Your current project workspace/);
assert.match(timeline, /No timeline items in this range/);
assert.doesNotMatch(timeline, /needs a next beat/);
const iconSource = read('packages/renderer/src/components/ClusterIcon.tsx');
const iconUnion = iconSource.match(/export type ClusterIconName\s*=([\s\S]*?);/);
assert.ok(iconUnion);
const icons = new Set([...iconUnion[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]));
const adminItems = [...sidebar.matchAll(/\{ label: "[^"]+", icon: "([^"]+)", section:/g)];
for (const [, icon] of adminItems) assert.ok(icons.has(icon),`Invalid admin icon ${icon}`);
const modified = [
  'packages/renderer/src/features/application/modules/ApplicationSidebar.tsx',
  'packages/renderer/src/features/application/ClusterApplication.tsx',
  'packages/renderer/src/features/settings/StudioSettingsPage.tsx',
  'packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx',
  'packages/renderer/src/features/projects/ProjectsPage.tsx',
  'packages/renderer/src/features/projects/ProjectPortfolioItem.tsx',
  'packages/renderer/src/features/projects/ProjectOverviewDashboard.tsx',
  'packages/renderer/src/features/timeline/TimelineWorkspacePage.tsx',
  'packages/shared/src/cluster-manifest.ts',
];
for (const file of modified) {
  const sourceFile = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sourceFile.parseDiagnostics.length, 0, file+': '+sourceFile.parseDiagnostics.map(e=>ts.flattenDiagnosticMessageText(e.messageText, ' ')));
}
assert.ok(JSON.parse(read('config/release-candidate.json')).sequence >= 27, 'RC27 admin/navigation fixes persist in later candidates');
console.log('RC27 administration/section routing, Inventory icon, text density, and lazy gallery assertions: PASS');
