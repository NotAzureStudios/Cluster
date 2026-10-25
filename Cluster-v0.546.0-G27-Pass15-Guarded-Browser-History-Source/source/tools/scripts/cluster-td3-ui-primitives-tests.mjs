import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch {
  return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));
} })();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const css = read('packages/renderer/src/styles/components/cluster-select.css');
const primitives=read('packages/renderer/src/styles/design-system/primitives.css');
const context=read('packages/renderer/src/components/ClusterContextMenu.tsx');
const split=read('packages/renderer/src/components/ClusterSplitButton.tsx');
const select=read('packages/renderer/src/components/ClusterSelect.tsx');
const multi=read('packages/renderer/src/components/ClusterMultiSelect.tsx');
const button=read('packages/renderer/src/components/ClusterButton.tsx');
let passed=0;
function test(label, fn) { fn(); passed++; console.log('PASS',label); }
function loadTs(file, globals={}) {
  const code=ts.transpileModule(read(file),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,...globals},{filename:file});
  return module.exports;
}
const nav=loadTs('packages/renderer/src/components/cluster-menu-navigation.ts');
const move=nav.nextMenuFocusIndex;
test('menu ArrowDown focuses first if nothing selected',()=>assert.equal(move('ArrowDown',-1,3),0));
test('menu ArrowUp focuses last if nothing selected',()=>assert.equal(move('ArrowUp',-1,3),2));
test('menu ArrowDown wraps',()=>assert.equal(move('ArrowDown',2,3),0));
test('menu ArrowUp wraps',()=>assert.equal(move('ArrowUp',0,3),2));
test('menu Home focuses first',()=>assert.equal(move('Home',2,3),0));
test('menu End focuses last',()=>assert.equal(move('End',0,3),2));
test('empty action menu has no active index',()=>assert.equal(move('ArrowDown',-1,0),-1));
test('menu with one item stays on one item',()=>assert.equal(move('ArrowUp',0,1),0));
test('helper does not focus on unknown keys',()=>assert.equal(nav.focusMenuItem({querySelectorAll:()=>[]},'Escape'),false));
test('helper does not focus on empty menu',()=>assert.equal(nav.focusMenuItem({querySelectorAll:()=>[]},'ArrowDown'),false));
const makeFake=(size,active,disabled=[])=>{
 const focus=[];const items=Array.from({length:size},(_,i)=>({focus:()=>focus.push(i)}));
 const container={querySelectorAll:selector=>{assert.match(selector,/:not\(:disabled\)/);return items.filter((_,i)=>!disabled.includes(i));}};
 return {focus,items,container,document:{activeElement:items[active]}};
};
for(const [key,expected] of [['ArrowDown',2],['ArrowUp',0],['Home',0],['End',2]]){
 test(`shared action-menu helper focuses ${key} option`,()=>{
  const fake=makeFake(3,1);const bound=loadTs('packages/renderer/src/components/cluster-menu-navigation.ts',{document:fake.document});
  assert.equal(bound.focusMenuItem(fake.container,key),true);assert.deepEqual(fake.focus,[expected]);
 });
}
test('disabled action items are excluded from menu traversal',()=>{
 const fake=makeFake(4,1,[2]);const bound=loadTs('packages/renderer/src/components/cluster-menu-navigation.ts',{document:fake.document});
 assert.equal(bound.focusMenuItem(fake.container,'ArrowDown'),true);assert.deepEqual(fake.focus,[3]);
});
test('context and split buttons both use the shared menu keyboard handler',()=>{
 for(const source of [context,split])assert.match(source,/focusMenuItem\(/);
});
test('split button supports arrow opening and closes when disabled',()=>{
 assert.match(split,/event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
 assert.match(split,/if \(disabled \|\| actions\.length === 0\) setOpen\(false\)/);
});
test('select navigates by stable option value and honors initial arrow direction',()=>{
 assert.match(select,/moveClusterActiveValue\(options, initial, direction\)/);
 assert.match(select,/resolveClusterActiveValue\(options, activeValue, value\)/);
});
test('multi-select navigates by stable option values when filtered',()=>{
 assert.match(multi,/moveClusterActiveValue\(visible, current, direction\)/);
 assert.match(multi,/resolveClusterActiveValue\(visible, activeValue\)/);
});
test('multi-select trigger explicitly owns the popup listbox',()=>assert.match(multi,/aria-controls=\{open \? listId : undefined\}/));
test('disabled link button blocks navigation and skips keyboard focus',()=>{
 assert.match(button,/event\.preventDefault\(\); event\.stopPropagation\(\); return/);
 assert.match(button,/tabIndex=\{inert \? -1 : props\.tabIndex\}/);
});
test('links expose current page, never aria-pressed',()=>{
 const source=button.slice(button.indexOf('export const ClusterLinkButton'),button.indexOf('type ClusterIconButtonProps'));
 assert.match(source,/aria-current=\{selected \? "page"/);assert.doesNotMatch(source,/aria-pressed=/);
});
test('select styles use zero important overrides',()=>assert.doesNotMatch(css,/!important/));
test('select styles have a single canonical select menu surface block',()=>{
 assert.equal((css.match(/\n\.cluster-select-menu-v227 \{/g)||[]).length,1);
});
test('select menu text is at least 13px at normal 16px root',()=>assert.match(css,/max\(\.8125rem, var\(--cluster-font-size-sm\)\)/));
test('secondary metadata is at least 12px',()=>assert.match(css,/max\(\.75rem, var\(--cluster-font-size-xs\)\)/));
test('select and menu affordances have >=44px touch targets',()=>{
 assert.match(css,/@media \(pointer: coarse\)/);assert.match(css,/min-height: 44px/);
 assert.match(primitives,/@media \(pointer: coarse\)[\s\S]*?cluster-action-menu-entry-v428 > button \{ min-height: 44px/);
});
test('focus indication is independent of subtle hover backgrounds',()=>{
 assert.match(css,/outline: 2px solid var\(--cluster-focus-color/);
 assert.match(primitives,/\.cluster-button-v425:focus-visible/);
});
test('menu entry names and descriptions can wrap instead of clip',()=>{
 assert.match(primitives,/\.cluster-action-menu-entry-v428 span \{[^}]*overflow-wrap: anywhere/);
 assert.match(css,/\.cluster-select-menu-v227 \.cluster-select-option-v370 > span \{[^}]*overflow-wrap: anywhere/);
});
test('reduced motion disables control movement',()=>{
 assert.match(css,/:root\[data-motion="none"\]/);
 assert.match(primitives,/:root\[data-motion="none"\] \.cluster-floating-surface-v504/);
});
test('stylesheet keeps one import for each canonical primitive owner',()=>{
 const entry=read('packages/renderer/src/styles.css');
 assert.equal((entry.match(/design-system\/primitives\.css/g)||[]).length,1);
 assert.equal((entry.match(/components\/cluster-select\.css/g)||[]).length,1);
});
test('Qt native controls do not use 11px labels at normal text scale',()=>{
 for(const control of ['ClusterButton','ClusterComboBox','ClusterSwitch']) {
  const qml=read(`apps/desktop-qt/qml/components/${control}.qml`);
  assert.match(qml,/Theme\.scaledFont\(13\)/,control);
 }
});
test('Qt buttons use a moderate label weight',()=>assert.match(read('apps/desktop-qt/qml/components/ClusterButton.qml'),/font\.weight: Font\.Medium/));
console.log(`${passed}/${passed} TD3 UI primitive checks passed`);
