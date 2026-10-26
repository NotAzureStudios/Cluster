/** TD3 P14: runnable shared-control and source integration contracts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root','-g'], {encoding:'utf8'}).trim(), 'typescript')); } })();
const root = path.resolve(import.meta.dirname,'../..');
const src = (p) => fs.readFileSync(path.join(root,p),'utf8');
let total=0;
function check(name,fn){ fn(); total++; console.log('PASS',name); }
const components='packages/renderer/src/components/';
const hookSource=src(components+'useClusterMenuExecution.ts');
function runModule(filename, react, globals={}) {
 const js=ts.transpileModule(src(components+filename),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require(id){if(id==='react')return react;if(id==='./cluster-menu-navigation')return {movedBeyondLongPress:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)>8};return {}},Promise, ...globals});
 return module.exports;
}
function stubReact(){
 const state=[];return { state, useRef:initial=>({current:initial}),useState:initial=>[initial,value=>state.push(value)],useCallback:fn=>fn,useEffect:()=>{},useId:()=> 'td3-test'};
}
check('action starts in originating gesture and synchronous fence blocks distinct IDs',()=>{
 const hook=runModule('useClusterMenuExecution.ts',stubReact()).useClusterMenuExecution();
 let resolve; const action=new Promise(r=>resolve=r);let started=0;
 hook.execute('move',()=>{started++;return action},()=>{});
 hook.execute('delete',()=>{started++;},()=>{});
 assert.equal(started,1);assert.equal(hook.isExecuting(),true);
 resolve();
});
check('menu hook exposes a synchronous busy gate for the floating-layer dismissal policy',()=>{
 const surface=src(components+'ClusterFloatingSurface.tsx');
 assert.match(surface,/canDismiss && !canDismiss\(\)/g);
 for(const f of ['ClusterContextActions.tsx','ClusterContextMenu.tsx','ClusterSplitButton.tsx']){
  const s=src(components+f);
  assert.match(s,/canDismiss=\{\(\) => !actionExecution\.isExecuting\(\)\}/);
 }
 assert.match(surface,/if \(!localRef\.current\?\.isConnected\) anchorRef\.current\?\.focus/);
});
check('history executor retains synchronous mutation fence and respects unmount',()=>{
 const s=src(components+'useClusterHistoryExecution.ts');
 assert.match(s,/mountedRef\.current = false/);
 assert.match(s,/const isExecuting = useCallback\(\(\) => pendingRef\.current, \[\]\)/);
 assert.match(src(components+'ClusterContextActions.tsx'),/disabled=\{history\.busy\} onClick=\{\(\) => \{ if \(!history\.isExecuting\(\)\) onDismiss\(\); \}\}/);
});
function contextHarness(){
 let serial=0;const timers=new Map();const fakeWindow={
  setTimeout(fn){const n=++serial;timers.set(n,fn);return n},clearTimeout(n){timers.delete(n)}
 };
 const h=runModule('ClusterContextMenu.tsx',stubReact(),{window:fakeWindow}).useClusterContextMenu();
 return {h,timers,runTimers:()=>{const [k,fn]=timers.entries().next().value||[];assert.ok(fn);timers.delete(k);fn();}};
}
check('long press eats the browser synthesized click, not the next real click',()=>{
 const {h,runTimers}=contextHarness();
 h.targetProps.onPointerDown({pointerType:'touch',clientX:100,clientY:100});
 runTimers();let suppressed=0;const ev={preventDefault(){suppressed++},stopPropagation(){suppressed++}};
 h.targetProps.onClickCapture(ev);assert.equal(suppressed,2);
 h.targetProps.onClickCapture(ev);assert.equal(suppressed,2);
});
check('touch scrolling beyond long-press threshold cancels menu opening',()=>{
 const {h,timers}=contextHarness();
 h.targetProps.onPointerDown({pointerType:'touch',clientX:40,clientY:40});
 assert.equal(timers.size,1);
 h.targetProps.onPointerMove({pointerType:'touch',clientX:55,clientY:55});
 assert.equal(timers.size,0);
});
check('cancelled touch cannot swallow a subsequent tap',()=>{
 const {h}=contextHarness();let consumed=0;
 h.targetProps.onPointerDown({pointerType:'touch',clientX:40,clientY:40});
 h.targetProps.onPointerCancel();
 h.targetProps.onClickCapture({preventDefault(){consumed++},stopPropagation(){consumed++}});
 assert.equal(consumed,0);
});
check('Shift F10 and ContextMenu keyboard events open without bubbling into parent shortcuts',()=>{
 const {h}=contextHarness();let handled=0;
 const key=(key,shiftKey=false)=>h.targetProps.onKeyDown({key,shiftKey,preventDefault(){handled++},stopPropagation(){handled++}});
 key('F10',true);key('ContextMenu');key('F10');assert.equal(handled,4);
});
check('People row navigation does not nest an interactive avatar button',()=>{
 const people=src('packages/renderer/src/features/people/PeoplePages.tsx');
 const person=src(components+'PersonSummary.tsx');
 assert.match(people,/<PersonSummary person=\{person\} compact profileAction=\{false\} avatarProfilePeek=\{false\}/);
 assert.match(person,/profilePeek=\{avatarProfilePeek\}/);
});
check('People still renders accent border and a separate presence indicator',()=>{
 const avatar=src(components+'PresenceAvatar.tsx');const css=src('packages/renderer/src/styles/components/presence-avatar.css');
 assert.match(avatar,/--user-avatar-accent/);assert.match(avatar,/cluster-presence-indicator-v227/);
 assert.match(css,/box-shadow: 0 0 0 1px var\(--user-avatar-accent/);
 assert.match(css,/cluster-presence-indicator-v227/);
});
check('quick profile restores keyboard focus and ignores stale unmounted lookups',()=>{
 const avatar=src(components+'PresenceAvatar.tsx');
 assert.match(avatar,/cardRef\.current\?\.focus/);
 assert.match(avatar,/peekTriggerRef\.current\?\.focus/);
 assert.match(avatar,/mountedRef\.current && peekRequestRef\.current === requestId/);
 assert.match(avatar,/tabIndex=\{-1\} role="dialog"/);
});
check('taskbar shell fidelity and animated replacement search are retained',()=>{
 const projectTabs=src('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx');
 const transfer=src('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
 const shell=src('packages/renderer/src/features/application/ClusterApplication.tsx');
 const slots=src('packages/renderer/src/features/shell/ShellPrimitives.tsx');
 assert.ok(projectTabs.length>100 && transfer.length>100 && shell.length>100);
 assert.match(projectTabs,/role="tablist" aria-label="Open project tabs"/);
 assert.match(slots,/cluster-taskbar-search-switch/);
 assert.match(shell,/onOpenTickets=|onOpenMyWork=/);
});
check('native Qt combo delegates have stable index authority and accessible tap height',()=>{
 const q=src('apps/desktop-qt/qml/components/ClusterComboBox.qml');
 assert.match(q,/required property int index/);
 assert.match(q,/Theme.largeTargets \? Math.max\(44/);
});
check('native Qt high-contrast surface suppresses decorative gradient and sheen',()=>{
 const q=src('apps/desktop-qt/qml/components/Surface.qml');
 assert.match(q,/Theme.reducedTransparency \|\| Theme.highContrast \? null : surfaceGradient/);
 assert.match(q,/Theme.highContrast \? "transparent"/);
});
console.log(`${total}/${total} TD3 Pass 14 interaction regressions passed`);
