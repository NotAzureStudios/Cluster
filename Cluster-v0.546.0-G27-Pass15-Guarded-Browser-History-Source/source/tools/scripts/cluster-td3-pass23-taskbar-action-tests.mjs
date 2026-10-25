import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTaskbarActionRequestGate } from '../../packages/renderer/src/features/application/modules/taskbar-action-requests.ts';
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(resolve(root,'packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx'),'utf8');
const styles = readFileSync(resolve(root,'packages/renderer/src/features/shell/shell.css'),'utf8');
const checks=[];
const test=(name,fn)=>checks.push({name,fn});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

test('Newest taskbar preview request wins out-of-order replies',()=>{
 const gate=createTaskbarActionRequestGate();
 const old=gate.beginRead(),latest=gate.beginRead();
 assert.equal(gate.currentRead(old),false);
 assert.equal(gate.currentRead(latest),true);
});
test('Mutating a notification invalidates earlier reads immediately',()=>{
 const gate=createTaskbarActionRequestGate();const read=gate.beginRead();const snapshot=gate.snapshotVersion();
 assert.equal(gate.beginMutation(),true);
 assert.equal(gate.currentRead(read),false);
 assert.equal(gate.versionUnchanged(snapshot),false);
 gate.endMutation();
});
test('Distinct rapid actions share a synchronous single-flight lock',()=>{
 const gate=createTaskbarActionRequestGate();
 assert.equal(gate.beginMutation(),true);
 assert.equal(gate.beginMutation(),false);
 assert.equal(gate.isMutating(),true);
 gate.endMutation();
 assert.equal(gate.beginMutation(),true);
 gate.endMutation();
});
test('Failure frees the action gate for a retry',async()=>{
 const gate=createTaskbarActionRequestGate();let attempts=0;
 async function run(){if(!gate.beginMutation())return false;try{attempts++;if(attempts===1)throw Error('offline');return true;}finally{gate.endMutation();}}
 await assert.rejects(run(),/offline/);
 assert.equal(await run(),true);
 assert.equal(attempts,2);
});
test('Queued server results cannot resurrect stale unread preview after a mutation',async()=>{
 const gate=createTaskbarActionRequestGate();const old=deferred();const before=gate.beginRead();let items=[{id:'n1',read:false}];
 const oldRead=old.promise.then(rows=>{if(gate.currentRead(before))items=rows});
 assert.equal(gate.beginMutation(),true);
 items=items.map(item=>({...item,read:true}));gate.endMutation();
 old.resolve([{id:'n1',read:false}]);await oldRead;
 assert.equal(items[0].read,true);
});
test('Local preview invalidation skips late server replies after SSE delivery',()=>{
 const gate=createTaskbarActionRequestGate();const before=gate.beginRead();gate.invalidateReads();
 assert.equal(gate.currentRead(before),false);
});
test('Taskbar preserves My Work, Tickets, Transfer Center and project tabs',()=>{
 for(const token of ['TaskbarProjectTabs','TaskbarTransferCenter','My Work','Tickets','commandPaletteOpen'])assert.ok(source.includes(token),token);
});
test('Notification read writes use a single guarded path and report server failures',()=>{
 assert.match(source,/async function markNotificationPreviewRead\(ids: string\[\]\)/);
 assert.match(source,/if \(!gate\.beginMutation\(\)\) return/);
 assert.match(source,/await api\("\/api\/notifications\/read"/);
 assert.match(source,/setNotificationActionError\(error instanceof Error/);
 assert.doesNotMatch(source,/await api\("\/api\/notifications\/read"[^\n]*\.catch\(\(\) => undefined\)/);
});
test('Read action is acknowledged before local flags or event are changed',()=>{
 const portion=source.slice(source.indexOf('async function markNotificationPreviewRead'),source.indexOf('function openNotificationPreview'));
 assert.ok(portion.indexOf('await api(')<portion.indexOf('setNotificationPreviewItems'));
 assert.ok(portion.indexOf('await api(')<portion.indexOf('window.dispatchEvent'));
});
test('Inbox read and presence actions show accessible pending/error feedback',()=>{
 for(const token of ['notificationActionBusy','notificationActionError','presenceBusy','presenceError','role="alert"','busy={notificationActionBusy}'])assert.ok(source.includes(token),token);
 assert.match(styles,/\.taskbar-notification-error-v548/);
 assert.match(styles,/\.taskbar-presence-error-v548/);
});
test('Modal/taskbar menus cannot dismiss during pending mutation',()=>{
 assert.match(source,/canDismiss=\{\(\) => !notificationRequestGateRef\.current\.isMutating\(\)\}/);
 assert.match(source,/canDismiss=\{\(\) => !presenceRequestGateRef\.current\.isMutating\(\) && !accountUtilityInvocationRef\.current\.isExecuting\(\)\}/);
});
test('Background badge and preview request paths reject stale responses',()=>{
 assert.match(source,/gate\.currentRead\(request\)/);
 assert.match(source,/notificationRequestGateRef\.current\.versionUnchanged\(version\)/);
 assert.match(source,/refreshPending = true/);
});
test('Stream updates cannot be replaced by an older badge projection',()=>{
 assert.match(source,/const streamRevision = notificationStreamRevisionRef\.current/);
 assert.match(source,/streamRevision === notificationStreamRevisionRef\.current/);
 assert.match(source,/notificationStreamRevisionRef\.current\+\+/);
});
test('Missing notification preview projection does not erase otherwise valid UI' ,()=>{
 assert.match(source,/includeRead=true"\)\.catch\(\(\) => null\)/);
 assert.match(source,/if \(preview && streamRevision === notificationStreamRevisionRef\.current\) \{/);
});
test('People identity and search animation stay intact',()=>{
 const avatar=readFileSync(resolve(root,'packages/renderer/src/components/PresenceAvatar.tsx'),'utf8');
 assert.match(avatar,/cluster-presence-indicator-v227/);
 assert.match(avatar,/accentColor/);
 assert.match(source,/TaskbarProjectTabs/);
});
let passed=0;
for(const {name,fn} of checks)try{await fn();passed++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error);process.exitCode=1;}
console.log(`TD3 Pass23: ${passed}/${checks.length} passed`);
