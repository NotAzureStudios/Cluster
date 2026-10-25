import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClusterActionFlight, createClusterLatestResponse } from '../../packages/renderer/src/components/cluster-action-flight.ts';
import { createClusterCreateIntentControl } from '../../packages/renderer/src/features/create/create-intent-control.ts';

const root=resolve(import.meta.dirname,'../..');
const src=p=>readFileSync(resolve(root,p),'utf8');
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};};

test('Synchronous gate prevents different actions racing in the same React frame',()=>{
 const gate=createClusterActionFlight();assert.equal(gate.enter('create'),true);
 assert.equal(gate.enter('note'),false);assert.equal(gate.isActive(),true);
 assert.equal(gate.leave('note'),false);assert.equal(gate.current(),'create');
 assert.equal(gate.leave('create'),true);assert.equal(gate.enter('note'),true);gate.leave('note');
});
test('Empty action identifiers never claim the gate',()=>{
 const gate=createClusterActionFlight();assert.equal(gate.enter('   '),false);assert.equal(gate.isActive(),false);
});
test('Failed mutations release the gate so deliberate retries can proceed',async()=>{
 const gate=createClusterActionFlight();let calls=0;
 async function write(){if(!gate.enter('update'))return;try{calls++;if(calls===1)throw Error('offline')}finally{gate.leave('update')}}
 await assert.rejects(write(),/offline/);await write();assert.equal(calls,2);
});
test('Out-of-order detail replies cannot replace the selected incident',async()=>{
 const gate=createClusterLatestResponse();const old=deferred(),current=deferred();let selected='i2',display='';
 const first=gate.next();const oldTask=old.promise.then(value=>{if(gate.isCurrent(first)&&selected==='i1')display=value});
 const second=gate.next();const newTask=current.promise.then(value=>{if(gate.isCurrent(second)&&selected==='i2')display=value});
 current.resolve('incident-two');old.resolve('incident-one');await Promise.all([oldTask,newTask]);assert.equal(display,'incident-two');
});
test('An unmounted or invalidated panel discards late responses',()=>{
 const gate=createClusterLatestResponse();const read=gate.next();gate.invalidate();assert.equal(gate.isCurrent(read),false);
});
test('Create intent retries use one receipt key for identical payloads',()=>{
 let next=0;const create=createClusterCreateIntentControl(()=> `test-key-${++next}`);const body='{"title":"A"}';
 assert.equal(create.begin(),true);assert.equal(create.begin(),false);
 const key=create.requestKey('POST','/api/admin/operations/incidents',body);create.finish();
 assert.equal(create.begin(),true);assert.equal(create.requestKey('POST','/api/admin/operations/incidents',body),key);
 assert.notEqual(create.requestKey('POST','/api/admin/operations/incidents','{"title":"B"}'),key);
 create.commit();create.finish();assert.equal(create.begin(),false);assert.equal(create.reset(),true);
});
const incidents=src('packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx');
const setup=src('packages/renderer/src/features/admin/AdminSetupChecklist.tsx');
const flight=src('packages/renderer/src/components/useClusterActionFlight.ts');
test('Operations writes use an immediate cross-action gate, not busy state as a lock',()=>{
 for(const action of ['create','update','note'])assert.match(incidents,new RegExp(`beginAction\\("${action}"\\)`));
 assert.match(incidents,/finally \{ finishAction\("update"\); \}/);
 assert.match(incidents,/finally \{ finishAction\("note"\); \}/);
 assert.doesNotMatch(incidents,/setBusy\(/);
});
test('Incident selection invalidates stale detail and avoids cross-incident note clearing',()=>{
 for(const token of ['detailGeneration.current.invalidate()','selectedIdRef.current === id','selectedIdRef.current === incident.id','chooseIncident(incident.id)'])assert.ok(incidents.includes(token),token);
 assert.doesNotMatch(incidents,/if \(selectedId\) void loadIncident\(selectedId\);\s*setStatus/);
});
test('Confirmed incident creation is separated from refresh and retries have stable receipt keys',()=>{
 for(const token of ['"x-cluster-idempotency-key": key','createIntent.current.requestKey','createIntent.current.commit()','await load(true)'])assert.ok(incidents.includes(token),token);
 assert.match(incidents,/Incident outcome is uncertain/);
});
test('Incident timeline notes use their own receipt intent separate from creation',()=>{
 assert.match(incidents,/const noteIntent = useRef\(createClusterCreateIntentControl\(\)\)/);
 assert.match(incidents,/noteIntent.current.requestKey/);
 assert.match(incidents,/noteIntent.current.reset\(\)/);
});
test('Configuration preview and apply use a common synchronous lock',()=>{
 assert.match(setup,/beginAction\("preview"\)/);assert.match(setup,/beginAction\("apply"\)/);
 assert.match(setup,/finishAction\("preview"\)/);assert.match(setup,/finishAction\("apply"\)/);
 assert.doesNotMatch(setup,/setBusy\(/);
});
test('Checklist update and export cannot overlap and stale refreshes are discarded',()=>{
 for(const token of ['beginAction(`skip:${id}`)','beginAction("export")','finishAction("export")','refreshGeneration.current.isCurrent(generation)','refreshGeneration.current.invalidate()'])assert.ok(setup.includes(token),token);
});
test('Shared action gate maintains separate UI feedback and synchronous lock ownership',()=>{
 assert.match(flight,/useRef\(createClusterActionFlight\(\)\)/);
 assert.match(flight,/gate.current.enter\(id\)/);
 assert.match(flight,/gate.current.leave\(id\)/);
});
test('Confirmed mutations retain status while a silent health refresh runs',()=>{
 assert.match(incidents,/if \(!silent\) setStatus\(`Operational evidence refreshed/);
 assert.match(incidents,/if \(!silent\) setStatus\(error instanceof Error/);
});
test('Admin actions expose busy state and suppress stale reads during checklist changes',()=>{
 assert.match(setup,/refreshGeneration.current.invalidate\(\); \/\/ Freeze older server projections/);
 assert.match(setup,/aria-busy=\{actionPending === "preview"\}/);
 assert.match(setup,/aria-busy=\{actionPending === "apply"\}/);
 assert.match(setup,/aria-busy=\{busyId === "export"\}/);
});
test('Configuration history only applies the latest revision response',()=>{
 assert.match(setup,/revisionsGeneration.current.isCurrent\(revision\)/);
 assert.match(setup,/revisionsGeneration.current.invalidate\(\)/);
});
test('Taskbar and People preservation remain in source',()=>{
 const taskbar=src('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 for(const token of ['TaskbarProjectTabs','TaskbarTransferCenter','My Work','Tickets'])assert.ok(taskbar.includes(token),token);
 const avatar=src('packages/renderer/src/components/PresenceAvatar.tsx');
 for(const token of ['accentColor','cluster-presence-indicator-v227'])assert.ok(avatar.includes(token),token);
});
let pass=0;for(const [name,run] of tests){try{await run();pass++;console.log('PASS',name)}catch(e){console.error('FAIL',name,e);process.exitCode=1}}
console.log(`TD3 Pass24 ${pass}/${tests.length}`);
