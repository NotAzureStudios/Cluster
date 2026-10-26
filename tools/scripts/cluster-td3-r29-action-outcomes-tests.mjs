/** TD3 R29: executable negative-outcome contract and source-wiring checks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireConfirmedMenuOutcome } from '../../packages/renderer/src/components/cluster-menu-action-outcome.ts';
import { createClusterCommandInvocation } from '../../packages/renderer/src/features/search/cluster-command-invocation.ts';

const root = resolve(import.meta.dirname, '../..');
const read = name => readFileSync(resolve(root, name), 'utf8');
const tests = [];
const test = (name, fn) => tests.push({name, fn});
const checker = read('packages/renderer/src/components/useClusterMenuExecution.ts');
const menu = read('packages/renderer/src/components/ClusterContextActions.tsx');
const split = read('packages/renderer/src/components/ClusterSplitButton.tsx');
const registry = read('packages/renderer/src/core/resource-action-registry.ts');
const work = read('packages/renderer/src/features/workflow/WorkActionMenu.tsx');
const actions = read('packages/renderer/src/features/workflow/work-actions.ts');
const switcher = read('packages/renderer/src/components/ProjectResourceSwitcher.tsx');
const board = read('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');
const whiteboard = read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
const palette = read('packages/renderer/src/features/search/CommandPalette.tsx');

for (const value of [undefined, true]) test(`Confirmed menu result ${String(value)} accepted`, () => assert.equal(requireConfirmedMenuOutcome(value), undefined));
test('False is never success', () => assert.throws(() => requireConfirmedMenuOutcome(false), /did not complete/));
test('Promise-resolved false also fails and retry can succeed', async () => {
  const run = result => Promise.resolve(result).then(requireConfirmedMenuOutcome);
  await assert.rejects(run(Promise.resolve(false)), /did not complete/);
  assert.equal(await run(Promise.resolve(true)), undefined);
});
test('Failure/rejection never changes the meaning of the action outcome', async () => {
  await assert.rejects(Promise.reject(new Error('native timeout')).then(requireConfirmedMenuOutcome), /native timeout/);
});
test('Menu actions keep synchronous user gestures, pending lock, and error feedback', () => {
  assert.match(checker, /activeRef\.current = id;\s*setPendingId\(id\);/);
  assert.match(checker, /result = action\(\);/);
  assert.match(checker, /requireConfirmedMenuOutcome\(outcome\);\s*if \(mountedRef\.current\) onSuccess\(\);/);
  assert.match(checker, /\.catch\(\(\) => \{\s*if \(mountedRef\.current\) setError/);
  assert.match(checker, /\.finally\(\(\) => \{\s*activeRef\.current = null/);
});
test('Context, split, and registry menus expose the same boolean-aware action type', () => {
  for (const source of [menu,split]) assert.match(source, /onSelect: ClusterMenuAction/);
  assert.match(split, /onPrimary: ClusterMenuAction/);
  assert.match(registry, /onSelect: \(target: ClusterActionTarget\) => ClusterMenuActionResult \| Promise<ClusterMenuActionResult>/);
});
test('Work copy and window commands pass results without swallowing them', () => {
  assert.match(work, /push\("open_window", \(\) => openWorkInDesktopWindow\(/);
  assert.match(work, /push\("copy_link", \(\) => copyWorkLink\(context\)\)/);
  assert.doesNotMatch(work, /await (?:copyWorkLink|openWorkInDesktopWindow)\(/);
});
test('Mention action rejects denied clipboard rather than closing menu', () => {
  assert.match(actions, /if \(!await copyClusterText\(context\.mentionText\)\) throw new Error/);
});
test('Project resource windows propagate false through switcher, Board, and Whiteboard owners', () => {
  assert.match(switcher, /onOpenWindow\?: \(item: ProjectResourceSwitcherItem\) => ClusterMenuActionResult \| Promise<ClusterMenuActionResult>/);
  assert.match(switcher, /actions\.execute\(`window:\$\{item\.id\}`, \(\) => onOpenWindow\(item\)/);
  for (const source of [board,whiteboard]) {
    assert.match(source, /if \(!target\) return false;/);
    assert.match(source, /return opened;/);
    assert.match(source, /setWorkspaceWindowStatus\(error instanceof Error[^\n]+\);\s*return false;/);
  }
});
test('Palette Desktop operations return native outcomes into existing command invocation', () => {
  for (const action of ['openCurrentWorkInDesktopWindow', 'openNativeAppSettings', 'openNativeServerProfiles', 'reloadNativeRenderer']) {
    assert.match(palette, new RegExp('action: \\(\\) => '+action+'\\('));
    assert.doesNotMatch(palette, new RegExp('void '+action+'\\('));
  }
  assert.match(palette, /const attempt = commandInvocation\.current\.run\(action\)/);
  assert.match(palette, /if \(!successful\) \{\s*setCommandError\(/);
});
test('Palette invocation recovers after async clipboard/window denial', async () => {
  const gate = createClusterCommandInvocation();
  const calls = [];
  const denied = gate.run(async () => { calls.push('denied'); return false; });
  assert.equal(gate.run(() => { calls.push('duplicate');return true; }), null);
  assert.equal(await denied, false);
  assert.equal(await gate.run(async () => { calls.push('success');return true; }), true);
  assert.deepEqual(calls, ['denied', 'success']);
});
let pass=0;
for (const {name,fn} of tests) {
  try { await fn(); pass++; console.log('PASS', name); }
  catch (error) { console.error('FAIL',name, error); process.exitCode=1; }
}
console.log(`${pass}/${tests.length} TD3 R29 action-outcome tests passed`);
