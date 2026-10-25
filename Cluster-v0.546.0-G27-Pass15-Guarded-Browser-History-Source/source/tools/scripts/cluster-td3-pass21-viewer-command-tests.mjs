/** TD3 Pass 21: Viewer menu convergence and real registry execution assertions. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createViewerCommandRegistry } from '../../packages/renderer/src/features/viewer/viewer-command-registry.ts';
const root = resolve(import.meta.dirname, '../..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const bar = read('packages/renderer/src/features/viewer/ViewerCommandBar.tsx');
const registrySource = read('packages/renderer/src/features/viewer/viewer-command-registry.ts');
const shell = read('packages/renderer/src/features/viewer/ViewerShell.tsx');
const css = read('packages/renderer/src/features/viewer/viewer-shell.css');
const taskbar = read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
const avatar = read('packages/renderer/src/components/PresenceAvatar.tsx');
const checks = [];
const test = (title, run) => checks.push([title, run]);
test('Viewer commands use body-portaled shared floating surface', () => {
  assert.match(bar, /<ClusterFloatingSurface/);
  assert.match(bar, /anchorRef={triggerRef}/);
  assert.match(bar, /mobileMode="sheet"/);
  assert.doesNotMatch(bar, /\{overflowOpen\s*\?\s*<div className="cluster-viewer-command-menu"/);
});
test('Viewer command popup owns focus and keyboard navigation', () => {
  for (const token of ['aria-haspopup="menu"','aria-expanded={overflowOpen}','autoFocus="first"','focusMenuItem(menuRef.current','triggerRef.current.focus','role="menuitem"']) assert.ok(bar.includes(token),token);
});
test('Viewer actions share synchronous single-flight protection', () => {
  assert.match(bar, /useClusterMenuExecution/);
  assert.match(bar, /execution\.execute\(command\.id/);
  assert.match(bar, /canDismiss=\{\(\) => !execution\.isExecuting\(\)\}/);
  assert.match(bar, /disabled=\{!enabled\(command\) \|\| execution\.busy\}/);
});
test('Viewer shows menu errors instead of closing on failure', () => {
  assert.match(bar,/execution\.error\s*\?\s*<p role="alert"/);
  assert.match(bar,/if \(!completed\) throw/);
});
test('Viewer keeps original command label, icon and shortcut', () => {
  assert.match(bar,/command\.label/);
  assert.match(bar,/command\.icon/);
  assert.match(bar,/command\.shortcut/);
});
test('Viewer shortcut failures report feedback instead of unhandled rejection',()=> {
  assert.match(shell,/registry\.handleKeyDown\(event, commandContext\)\.catch/);
  assert.match(shell,/setSystemStatus\(\"Viewer command failed/);
});
test('Viewer popup CSS no longer competes with shared absolute positioning', () => {
  assert.doesNotMatch(css,/\.cluster-viewer-command-menu\{[^}]*position:absolute/);
  assert.match(css,/\.cluster-viewer-command-menu\.cluster-floating-surface-v504/);
});
test('Keyboard shortcuts and toolbar commands converge on registry execute',()=> {
  assert.match(registrySource,/return this\.execute\(winner\.id, context\)/);
  assert.match(registrySource,/private executing = false/);
});
test('Taskbar preservation: tabs, My Work, Tickets and transfers',()=> {
  for (const token of ['TaskbarProjectTabs','My Work','Tickets','TaskbarTransferCenter']) assert.ok(taskbar.includes(token),token);
});
test('People identity preservation: individual color and independent presence dot',()=> {
  assert.match(avatar,/personalAccentColor|accentColor/);
  assert.match(avatar,/cluster-presence-indicator-v227/);
});
// Dynamic behavior checks invoke the actual TypeScript command registry via Node stripping.
const context = { capabilities: {}, medium:'image', mode:'view' };
const deferred = () => { let resolvePromise; const promise = new Promise(resolve => { resolvePromise=resolve; }); return { promise, release: resolvePromise }; };
test('Rapid invocations of different commands cannot overlap', async () => {
  const gate=deferred();const runs=[];
  const registry=createViewerCommandRegistry([
    {id:'a', label:'A', run:()=>{runs.push('a');return gate.promise;}},
    {id:'b', label:'B', run:()=>{runs.push('b');}},
  ]);
  const first=registry.execute('a',context);
  assert.equal(await registry.execute('b',context), false);
  assert.deepEqual(runs,['a']);
  gate.release();assert.equal(await first,true);
  assert.equal(await registry.execute('b',context),true);
  assert.deepEqual(runs,['a','b']);
});
test('Rejected commands free the registry lock for recovery', async () => {
  let attempts=0;
  const registry=createViewerCommandRegistry([{id:'broken',label:'Broken',run:()=>{attempts++;if(attempts===1)throw new Error('nope');}}]);
  await assert.rejects(registry.execute('broken',context),/nope/);
  assert.equal(await registry.execute('broken',context),true);
  assert.equal(attempts,2);
});
test('Disabled/capability-gated commands never run', async () => {
  let count=0;
  const registry=createViewerCommandRegistry([{id:'hidden',label:'Hidden',requiredCapability:'download',run:()=>{count++;}}]);
  assert.equal(await registry.execute('hidden',context),false);
  assert.equal(count,0);
});
test('Shortcut execution honors the same pending lock as toolbar commands', async () => {
  // Browser HTMLElement is used only for the target guard; no editable target here.
  globalThis.HTMLElement ??= class HTMLElement {};
  const gate=deferred();let count=0, prevented=0, stopped=0;
  const registry=createViewerCommandRegistry([
    {id:'delayed',label:'Delayed',run:()=>gate.promise},
    {id:'shortcut',label:'Shortcut',shortcut:'Ctrl+K',run:()=>{count++;}},
  ]);
  const pending=registry.execute('delayed',context);
  const event={ctrlKey:true,altKey:false,shiftKey:false,metaKey:false,key:'k',target:null,preventDefault:()=>{prevented++},stopPropagation:()=>{stopped++}};
  assert.equal(await registry.handleKeyDown(event,context),false);
  assert.equal(count,0);
  gate.release();await pending;
  assert.equal(await registry.handleKeyDown(event,context),true);
  assert.equal(count,1);
  assert.equal(prevented,2);assert.equal(stopped,2);
});
let passed=0;
for(const [name, fn] of checks){
  try {await fn();passed++;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}`,e);process.exitCode=1;}
}
console.log(`${passed}/${checks.length} TD3 Pass 21 tests passed`);
