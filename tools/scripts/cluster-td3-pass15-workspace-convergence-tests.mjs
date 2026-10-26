/** TD3 P15: executable Create-intent behavior + source integration contracts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClusterCreateIntentControl } from '../../packages/renderer/src/features/create/create-intent-control.ts';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = path => readFileSync(resolve(root,path),'utf8');
let count=0;
function check(label,fn){fn();count++;console.log('PASS',label);}
check('synchronous Create fence rejects a second submit in the same tick',()=>{
 const gate=createClusterCreateIntentControl(()=> 'mock-0001');
 assert.equal(gate.begin(),true);assert.equal(gate.begin(),false);assert.equal(gate.inFlight,true);
 gate.finish();assert.equal(gate.inFlight,false);
});
check('uncertain result reuses same server receipt for exact request',()=>{
 const gate=createClusterCreateIntentControl(()=> 'mock-0001');
 const a=gate.requestKey('POST','/api/tickets','{"title":"same"}');
 gate.begin();gate.finish();
 assert.equal(gate.requestKey('post','/api/tickets','{"title":"same"}'),a);
 assert.equal(gate.begin(),true);
 assert.notEqual(gate.requestKey('POST','/api/tickets','{"title":"different"}'), '');
});
check('confirmed creation cannot be repeated even after loading finishes',()=>{
 const gate=createClusterCreateIntentControl(()=> 'mock-0001');
 gate.begin();gate.commit();gate.finish();
 assert.equal(gate.begin(),false);
 assert.equal(gate.reset(),true);
 assert.equal(gate.begin(),true);
});
check('a pending submission cannot be reset or reopened',()=>{
 const gate=createClusterCreateIntentControl(()=> 'mock-0001');
 gate.begin();assert.equal(gate.reset(),false);assert.equal(gate.begin(),false);
});
const taskbar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
check('taskbar quick-ticket uses durable receipt header from exact body',()=>{
 assert.match(taskbar,/ticketCreateIntentRef\.current\.requestKey\("POST", "\/api\/tickets", body\)/);
 assert.match(taskbar,/headers\.set\("X-Cluster-Idempotency-Key"/);
 assert.match(taskbar,/await api<TicketCard>\("\/api\/tickets", \{ method: "POST", body, headers \}\)/);
});
check('taskbar guards both duplicate submissions and ticket drawer dismissal',()=>{
 assert.match(taskbar,/if \(!ticketCreateIntentRef\.current\.begin\(\)\)/);
 assert.match(taskbar,/canDismiss=\{\(\) => !ticketCreateIntentRef\.current\.inFlight\}/);
 assert.match(taskbar,/ticketCreateIntentRef\.current\.finish\(\);\s*setTicketSaving\(false\)/);
 assert.match(taskbar,/disabled=\{ticketSaving\}/);
});
check('ticket creation receipt committed before read/list projection refresh',()=>{
 const commit=taskbar.indexOf('ticketCreateIntentRef.current.commit()');
 const refresh=taskbar.indexOf('await loadPersonalTickets()',commit);
 assert.ok(commit>0 && refresh>commit);
});
check('ticket view suppresses superseded fetch completions',()=>{
 assert.match(taskbar,/requestId !== ticketLoadSequenceRef\.current/);
 assert.match(taskbar,/\+\+ticketLoadSequenceRef\.current; window\.removeEventListener/);
});
check('navigation utilities and project-only tabs retained',()=>{
 assert.match(taskbar,/TaskbarTransferCenter/);
 assert.match(taskbar,/canSeeMyWork/);
 assert.match(taskbar,/canSeeTickets/);
 const tabs=read('packages/renderer/src/features/shell/TaskbarProjectTabs.tsx');
 assert.match(tabs,/role="tablist" aria-label="Open project tabs"/);
 const shell=read('packages/renderer/src/features/shell/ShellPrimitives.tsx');
 assert.match(shell,/cluster-taskbar-search-switch/);
});
for(const [name,filename,cls] of [
 ['People','packages/renderer/src/features/people/PeoplePages.tsx','people-data-tools-v524'],
 ['Projects','packages/renderer/src/features/projects/ProjectsPage.tsx','projects-data-tools-v528']]){
 check(`${name} uses a shared Data tools disclosure, preserving content`,()=>{
  const source=read(filename);
  assert.match(source,new RegExp(`<ClusterDisclosureGroup className="${cls}" title="Data tools"`));
  assert.doesNotMatch(source,new RegExp(`<details className="${cls}">`));
  assert.match(source,/ClusterDataView/);
  assert.match(source,/DataViewProjectionComposer/);
 });
}
check('shared disclosure provides a class slot for existing layout',()=>{
 const shared=read('packages/renderer/src/components/ClusterDisclosureGroup.tsx');
 assert.match(shared,/contentClassName\?: string/);
 assert.match(shared,/className=\{contentClassName\}/);
 assert.match(shared,/aria-controls=\{contentId\}/);
});
check('People avatar user accent and separate presence dot preserved',()=>{
 const avatar=read('packages/renderer/src/components/PresenceAvatar.tsx');
 assert.match(avatar,/--user-avatar-accent/);assert.match(avatar,/cluster-presence-indicator-v227/);
});
check('Qt native controls explicitly expose focus and accessible labels',()=>{
 const combo=read('apps/desktop-qt/qml/components/ClusterComboBox.qml');
 const toggle=read('apps/desktop-qt/qml/components/ClusterSwitch.qml');
 assert.match(combo,/Accessible\.name: accessibleName\.length > 0/);
 assert.match(combo,/activeFocusOnTab: true/);
 assert.match(toggle,/Accessible\.name: accessibleName\.length > 0 \? accessibleName : text/);
 assert.match(toggle,/Accessible\.checked: control\.checked/);
 assert.match(toggle,/Theme\.focusRing/);
});
console.log(`${count}/${count} TD3 Pass 15 tests passed`);
