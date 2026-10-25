import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClusterActionFlight, createClusterLatestResponse } from '../../packages/renderer/src/components/cluster-action-flight.ts';
const root=resolve(import.meta.dirname,'../..');
const src=(p)=>readFileSync(resolve(root,p),'utf8');
const transfer=src('packages/renderer/src/features/shell/TaskbarTransferCenter.tsx');
const poll=src('packages/renderer/src/components/useClusterOperationJobStatus.ts');
const exports=src('packages/renderer/src/components/DataExportOperationFeedback.tsx');
const imports=src('packages/renderer/src/components/DataImportOperationFeedback.tsx');
const styles=src('packages/renderer/src/features/shell/shell-v2.css');
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};};
test('Different rapid transfer actions share one synchronous lock', async()=>{
 const gate=createClusterActionFlight();const delayed=defer();let calls=0;
 async function run(id,action){if(!gate.enter(id))return;try{calls++;await action()}finally{gate.leave(id)}}
 const first=run('pause:n1',()=>delayed.promise);
 await run('cancel:n1',()=>Promise.resolve());
 assert.equal(calls,1);assert.equal(gate.isActive(),true);
 delayed.resolve();await first;assert.equal(gate.isActive(),false);
 await run('cancel:n1',()=>Promise.resolve());assert.equal(calls,2);
});
test('Failed transfer action frees gate so user can retry',async()=>{
 const gate=createClusterActionFlight();let tries=0;
 async function run(){if(!gate.enter('retry'))return;try{tries++;if(tries===1)throw Error('connection lost')}finally{gate.leave('retry')}}
 await assert.rejects(run(),/connection lost/);await run();assert.equal(tries,2);
});
test('Old native transfer refresh cannot overwrite newer push-state',async()=>{
 const latest=createClusterLatestResponse();const old=defer(),next=defer();let rows=['initial'];
 const r1=latest.next(),first=old.promise.then(value=>{if(latest.isCurrent(r1))rows=value});
 const r2=latest.next(),second=next.promise.then(value=>{if(latest.isCurrent(r2))rows=value});
 next.resolve(['current']);old.resolve(['obsolete']);await Promise.all([first,second]);assert.deepEqual(rows,['current']);
});
test('Closing the native transfer watcher invalidates old replies',()=>{
 const latest=createClusterLatestResponse(),r=latest.next();latest.invalidate();assert.equal(latest.isCurrent(r),false);
});
test('Transfer Center uses shared admission, explicit feedback and guarded dismissal',()=>{
 for(const part of ['useClusterActionFlight()','beginAction(id)','finishAction(id)','setActionError(', 'role="alert"','canDismiss={() => !isExecuting()}','createClusterLatestResponse()'])assert.ok(transfer.includes(part),part);
 assert.match(transfer,/const request = nativeRefreshGeneration\.current\.next\(\)/);
 assert.match(transfer,/isCurrent\(request\)/);
 assert.match(transfer,/aria-busy=\{Boolean\(actionPending\)\}/);
});
test('All important transfer commands use one guarded execution path',()=>{
 for(const part of ['pauseOfflineUpload','resumeOfflineUpload','retryOfflineUpload','discardOfflineUpload','pauseNativeTransfer','resumeNativeTransfer','retryNativeTransfer','cancelNativeTransfer','openNativeTransferResult']){
  assert.match(transfer,new RegExp('runAction\\(`[^`]*`, \\(\\) => '+part+'\\('),part);
 }
 assert.match(transfer,/runAction\("retry-all", retryAll\)/);
});
test('Bulk retry reports rejected actions instead of swallowing every failure',()=>{
 assert.match(transfer,/Promise\.allSettled/);assert.match(transfer,/PromiseRejectedResult/);
 assert.match(transfer,/browserUploads\.some\(\(item\) => item\.status === \"failed\"\)/);
 assert.match(transfer,/activeNative\.some\(\(item\) => item\.state === \"failed\"\)/);
 assert.match(transfer,/if \(failures\.length\) throw new Error/);
});
test('Progress card polling belongs to one shared job-specific owner',()=>{
 assert.match(exports,/useClusterOperationJobStatus<ClusterDataExportJobStatus>/);
 assert.match(imports,/useClusterOperationJobStatus<ClusterDataImportJobStatus>/);
 assert.doesNotMatch(exports,/window\.setTimeout\(poll/);
 assert.doesNotMatch(imports,/window\.setTimeout\(poll/);
});
test('Switching job IDs never retains previous job download controls',()=>{
 assert.match(poll,/snapshot\.jobId === jobId \? snapshot\.status : null/);
 assert.match(poll,/snapshot\.jobId === jobId \? snapshot\.error : ""/);
 assert.match(poll,/if \(!active\) return/);
});
test('Hidden tabs suspend job polling and recover on visibility',()=>{
 for(const part of ['document.hidden','visibilitychange','clearTimeout(timer)','onVisibilityChange','TERMINAL_STATES.has'])assert.ok(poll.includes(part),part);
});
test('Transfer failures retain theme-aware, accessible material styling',()=>{
 assert.match(styles,/\.cluster-transfer-action-error/);assert.match(styles,/var\(--cluster-visual-surface-raised\)/);
});
test('Taskbar and People identity protections remain present',()=>{
 const taskbar=src('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 for(const part of ['TaskbarProjectTabs','TaskbarTransferCenter','My Work','Tickets','commandPaletteOpen'])assert.ok(taskbar.includes(part),part);
 const avatar=src('packages/renderer/src/components/PresenceAvatar.tsx');
 for(const part of ['accentColor','cluster-presence-indicator-v227'])assert.ok(avatar.includes(part),part);
});
let passes=0;
for(const [name,run] of tests){try{await run();passes++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error);process.exitCode=1}}
console.log(`TD3 Pass25: ${passes}/${tests.length}`);
