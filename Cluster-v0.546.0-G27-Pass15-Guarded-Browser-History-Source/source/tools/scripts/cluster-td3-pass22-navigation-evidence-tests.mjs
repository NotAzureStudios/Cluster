/** TD3 Pass22 source-level contracts and real shared keyboard navigation helper. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {focusMenuItem,nextMenuFocusIndex} from '../../packages/renderer/src/components/cluster-menu-navigation.ts';
const root=resolve(import.meta.dirname,'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const checks=[];const test=(name,fn)=>checks.push({name,fn});
const nav=read('packages/renderer/src/components/CompactSectionNav.tsx');
const css=read('packages/renderer/src/styles/components/compact-section-nav.css');
const shared=read('packages/renderer/src/components/ClusterFloatingSurface.tsx');
const keyboard=read('packages/renderer/src/components/cluster-menu-navigation.ts');
test('Compact nav uses body-ported floating surface rather than clipped inline details',()=>{
 assert.match(nav,/<ClusterFloatingSurface/);assert.match(nav,/anchorRef=\{moreTriggerRef\}/);
 assert.doesNotMatch(nav,/<details/);assert.match(nav,/mobileMode="sheet"/);
});
test('Compact nav retains active section identity and grouped navigation',()=>{
 for(const phrase of ['secondaryGroups.map','groupItems.map','aria-checked={activeId === item.id}', 'activeSecondary.label','moreLabel','item.detail'])assert.ok(nav.includes(phrase),phrase);
});
test('Compact nav trigger is an accessible menu toggle',()=>{
 for(const phrase of ['aria-haspopup="menu"','aria-expanded={moreOpen}', 'aria-controls={moreOpen ? moreId : undefined}', 'onClick={() => setMoreOpen'])assert.ok(nav.includes(phrase),phrase);
});
test('Compact nav keyboard operates same shared menu helper as other actions',()=>{
 assert.match(nav,/focusMenuItem\(moreMenuRef.current, event.key\)/);
 assert.match(nav,/autoFocusSelector=\{.button\[role="menuitemradio"\]:not\(:disabled\).\}/);
 assert.match(keyboard,/menuitemradio/);
});
test('Overlay owns focus, outside and Escape handling',()=>{
 for(const phrase of ['onDismiss("outside")','onDismiss("escape")','anchorRef.current?.focus'])assert.ok(shared.includes(phrase),phrase);
});
test('Compact nav overlay CSS maintains texture/depth and visible focus',()=>{
 assert.match(css,/\.compact-section-menu-v204\.cluster-floating-surface-v504/);
 assert.match(css,/box-shadow: var\(--cluster-shadow-float/);
 assert.match(css,/menuitemradio.*:focus-visible/);
});
test('Shared keyboard helper handles empty lists and wrapping',()=>{
 assert.equal(nextMenuFocusIndex('Home',2,5),0);assert.equal(nextMenuFocusIndex('End',2,5),4);
 assert.equal(nextMenuFocusIndex('ArrowDown',4,5),0);assert.equal(nextMenuFocusIndex('ArrowUp',0,5),4);
 assert.equal(nextMenuFocusIndex('ArrowDown',0,0),-1);
});
test('Real keyboard helper focuses menuitemradio nodes',()=>{
 let focused='';const nodes=[{focus:()=>{focused='a'}},{focus:()=>{focused='b'}}];
 globalThis.document={activeElement:nodes[0]};
 const surface={querySelectorAll:(selector)=>{assert.match(selector,/menuitemradio/);return nodes;}};
 assert.equal(focusMenuItem(surface,'ArrowDown'),true);assert.equal(focused,'b');
 assert.equal(focusMenuItem(surface,'Escape'),false);
 delete globalThis.document;
});
for (const [file,labels] of [
 ['features/admin/AdminToolControls.tsx',['Setting sources','saved overrides','Reset saved value']],
 ['features/admin/AdminAuditStreamPanel.tsx',['Evidence / metadata','JSON.stringify(event.metadata']],
 ['features/desktop/DesktopNativeServicesPanel.tsx',['Capture a screen region','Capture region']],
 ['features/desktop/DesktopWorkstationPanel.tsx',['Sanitized task output','Sanitized Git output']],
]) test(`${file} retains diagnostic evidence in shared disclosure`,()=>{
 const code=read('packages/renderer/src/'+file);
 assert.match(code,/<ClusterDisclosureGroup/);
 for(const label of labels) assert.ok(code.includes(label),label);
});
test('Admin audit search ignores stale results and unmounted requests',()=>{
 const code=read('packages/renderer/src/features/admin/AdminAuditStreamPanel.tsx');
 for (const phrase of ['const requestId = ++requestSequence.current','if (requestId !== requestSequence.current) return;','if (requestId === requestSequence.current) setLoading(false);','return () => { ++requestSequence.current; };'])assert.ok(code.includes(phrase),phrase);
});
test('Taskbar utilities and animated search remain canonical',()=>{
 const code=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 for(const phrase of ['TaskbarProjectTabs','My Work','Tickets','TaskbarTransferCenter'])assert.ok(code.includes(phrase),phrase);
});
test('People identity ring and presence dot preserved',()=>{
 const code=read('packages/renderer/src/components/PresenceAvatar.tsx');
 assert.match(code,/personalAccentColor|accentColor/);assert.match(code,/cluster-presence-indicator-v227/);
});
let pass=0;
for(const {name,fn} of checks){try{await fn();pass++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error);process.exitCode=1;}}
console.log(`TD3 Pass22: ${pass}/${checks.length} checks passed`);
