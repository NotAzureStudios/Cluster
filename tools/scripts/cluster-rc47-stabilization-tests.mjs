import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSidebarCollapsed, nextSidebarMode } from '../../packages/renderer/src/features/shell/sidebar-presentation.ts';
const root = new URL('../../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
let count = 0;
function test(name, body) { body(); count++; console.log(`PASS ${count}: ${name}`); }
test('sidebar expands when user clicks a compact persistent rail', () => {
  assert.equal(nextSidebarMode(resolveSidebarCollapsed('compact', true, false)), 'expanded');
});
test('sidebar collapses when user clicks its expanded persistent header', () => {
  assert.equal(nextSidebarMode(resolveSidebarCollapsed('expanded', true, false)), 'compact');
});
test('Auto modes switch to an explicit opposite state, including compact viewport', () => {
  assert.equal(nextSidebarMode(resolveSidebarCollapsed('auto', true, true)), 'expanded');
  assert.equal(nextSidebarMode(resolveSidebarCollapsed('auto', true, false)), 'compact');
});
test('compact preference never collapses a mobile drawer', () => {
  for (const mode of ['compact', 'expanded', 'auto']) assert.equal(resolveSidebarCollapsed(mode, false, true), false);
});
test('compact sidebar shows reachable header toggle and centered icon', () => {
  const css = read('packages/renderer/src/features/shell/sidebar.css');
  const last = css.slice(css.lastIndexOf('/* RC47:'));
  assert.match(last, /@media\s*\(min-width:\s*900px\)/);
  assert.match(last, /\.cluster-sidebar__mode-toggle\s*\{[^}]*display:\s*inline-grid\s*!important/s);
  assert.match(last, /\.cluster-sidebar__mode-toggle\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  assert.match(last, /\.cluster-sidebar__header\s*\{[^}]*grid-template-rows:\s*34px 34px/s);
});
test('compact persistent navigation preserves the shell grid, not the old block layout', () => {
  const css = read('packages/renderer/src/features/shell/shell-v2.css');
  const last = css.slice(css.lastIndexOf('/* RC47:'));
  assert.match(last, /@media\s*\(min-width:\s*900px\)/);
  assert.match(last, /data-sidebar-collapsed="true"\] \.app-shell\.shell-unified-v3430\s*\{[^}]*display:\s*grid\s*!important/s);
  assert.match(last, /grid-template-columns:\s*var\(--cluster-sidebar-current-width, 72px\) minmax\(0, 1fr\)\s*!important/);
  assert.match(last, /data-sidebar-layout=\"floating\"\] \.app-shell\.shell-unified-v3430\s*\{[^}]*\+ 24px\)/s);
});
test('sidebar button advertises real action and persists explicit mode', () => {
  const source = read('packages/renderer/src/features/application/modules/ApplicationSidebar.tsx');
  assert.match(source, /setSidebarMode\(nextSidebarMode\(effectiveCollapsed\)\)/);
  assert.match(source, /aria-pressed=\{effectiveCollapsed\}/);
  assert.match(source, /effectiveCollapsed \? "Expand navigation" : "Collapse navigation"/);
  assert.match(source, /writePreferenceStorage\("cluster\.sidebar\.mode", sidebarMode\)/);
  assert.match(source, /removeProperty\("--cluster-sidebar-current-width"\)/);
});
test('hover and focus preloads only module code, not API data', () => {
  const s = read('packages/renderer/src/features/shell/feature-prefetch.ts');
  assert.match(s,/options\.includeData \? Promise\.all\(\[moduleTask, prefetchFeatureData\(screen\)\]\) : moduleTask/);
  assert.match(s,/void prefetchFeature\(screen\)/);
  assert.doesNotMatch(s, /people: \(\) => Promise\.all\(\[\s*queryApi/);
});
test('transient module prefetch errors do not remain cached forever', () => {
  const s = read('packages/renderer/src/features/shell/feature-prefetch.ts');
  assert.match(s, /loader\(\)\.catch\(\(\) => \{\s*\/\/ A failed chunk load[^]*?pending\.delete\(screen\)/);
});
test('initial full profile request completes before organization context starts', () => {
  const s = read('packages/renderer/src/features/people/PeoplePages.tsx');
  const section = s.slice(s.indexOf('async function loadProfiles('), s.indexOf('  useEffect(() => {\n    const initialTarget', s.indexOf('async function loadProfiles(')));
  const profileRequest = section.indexOf('await loadProfile(nextId, force)');
  const teamRequest = section.indexOf('Promise.all([');
  assert.ok(profileRequest > 0 && teamRequest > profileRequest);
  assert.match(section, /sequence !== peopleLoadSequenceRef\.current\) return/);
});
test('empty optional profile fields are omitted from overview, without removing private records', () => {
  const s = read('packages/renderer/src/features/people/PeoplePages.tsx');
  assert.match(s, /profile\.email \? <div>/);
  assert.match(s, /profile\.capacityHours != null \? <div>/);
  assert.match(s, /profile\.hideLocation \? "Hidden"/);
  assert.match(s, /profileView === "full"/);
});
test('release identity advances without changing pinned runtime source version', () => {
  const release = JSON.parse(read('config/release-candidate.json'));
  assert.match(release.release,/^1\.0\.0-rc\.\d+$/); assert.ok(release.sequence >= 47);
  assert.equal(release.sourceVersion,'0.546.0');
});
console.log(`RC47 stabilization: ${count}/${count} checks passed.`);
