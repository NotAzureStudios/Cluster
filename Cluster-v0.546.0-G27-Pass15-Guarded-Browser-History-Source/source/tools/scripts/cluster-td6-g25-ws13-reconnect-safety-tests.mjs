#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = p => readFileSync(join(root,p),'utf8');
const apiRequests=[]; const rebaseRequests=[]; const removals=[];
let failNetwork=false; let queuedRecord; let missingRebase=false;
const mockApi = async (path, options) => {if (failNetwork) throw new Error('server unavailable'); apiRequests.push({path,options}); return {ok:true};};
const mocks = {'./api':{api:mockApi},'./offline-storage':{
 rebaseOfflineMutation:async(...a)=>{rebaseRequests.push(a);return missingRebase ? null : true;},
 listOfflineMutations:async()=>queuedRecord ? [queuedRecord] : [],
 removeOfflineMutation:async(id)=>{removals.push(id);}
}};
const src=read('packages/renderer/src/core/offline-conflicts.ts');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}}; vm.runInNewContext(js,{module:mod,exports:mod.exports,require:(p)=>{if(!mocks[p])throw new Error('unknown module '+p);return mocks[p];},JSON,Array,Object,Number,String,Set,Date,Error});
const c=mod.exports;
const base={id:'queued-a',method:'PATCH',path:'/api/cards/c1',status:'conflict',body:{title:'mine',expectedRevision:2},baseRevision:2,changedFields:['title'],conflictId:'conflict-1',conflictPayload:{allowedActions:['keep_mine','keep_server','merge'],serverPayload:{current:{id:'c1',title:'server',revision:7,userId:'other',privateComment:'not writable'}}}};
queuedRecord=base;
let passed=0;
async function test(title,fn){await fn();console.log('PASS',title);passed++;}
await test('server grants determine displayed actions',()=>assert.deepEqual(Array.from(c.offlineConflictAllowedActions(base)),['keep_mine','keep_server','merge']));
await test('no registered conflict never invents replay or merge authority',()=>assert.deepEqual(Array.from(c.offlineConflictAllowedActions({...base,conflictId:null,conflictPayload:{serverPayload:{current:{revision:7}}}})),['discard']));
await test('a registered conflict with no grants has no implicit resolution',()=>assert.deepEqual(Array.from(c.offlineConflictAllowedActions({...base,conflictPayload:{serverPayload:{current:{revision:7}}}})),[]));
await test('unknown server action cannot be accepted',()=>assert.deepEqual(Array.from(c.offlineConflictAllowedActions({...base,conflictPayload:{allowedActions:['keep_mine','install','merge'],serverPayload:{current:{revision:7}}}})),['keep_mine','merge']));
await test('only submitted editable keys appear in field review',()=>assert.deepEqual(Array.from(c.buildOfflineConflictFields(base).map(x=>x.key)),['title']));
await test('merging does not overpost ownership, IDs, timestamps or unrelated private metadata',()=>{
 const result=c.mergeOfflineConflictFields(base,{title:'server'});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{title:'server',expectedRevision:2});
});
await test('keep-mine rejected without current server revision before any network request',async()=>{
 const before=apiRequests.length;
 await assert.rejects(()=>c.resolveOfflineConflict({...base,conflictPayload:{allowedActions:['keep_mine'],serverPayload:{error:'stale'}}},'keep_mine'),/current revision/);
 assert.equal(apiRequests.length,before);
});
await test('merge rejected without an authoritative record',async()=>{
 const before=apiRequests.length;
 await assert.rejects(()=>c.resolveOfflineConflict({...base,conflictPayload:{allowedActions:['merge'],serverPayload:{error:'stale'}}},'merge'),/current revision/);
 assert.equal(apiRequests.length,before);
});
await test('permission-only discard does not permit keep-mine',async()=>{
 await assert.rejects(()=>c.resolveOfflineConflict({...base,conflictPayload:{allowedActions:['discard'],classification:'PERMISSION_REVOKED'}},'keep_mine'),/not authorized/);
});
await test('drafts not currently in conflict cannot be resolved',async()=>{
 await assert.rejects(()=>c.resolveOfflineConflict({...base,status:'pending'},'merge'),/no longer awaiting/);
});
await test('merge replays submitted fields against latest revision after recorded server resolution',async()=>{
 await c.resolveOfflineConflict(base,'merge',{title:'server'});
 assert.equal(apiRequests.at(-1).options.method,'POST');
 assert.deepEqual(rebaseRequests.at(-1).slice(0,2),['queued-a',7]);
 assert.equal(rebaseRequests.at(-1)[2].privateComment,undefined);
 assert.equal(rebaseRequests.at(-1)[2].title,'server');
});
await test('successful keep-server removes draft after server acknowledgement',async()=>{
 const old=removals.length;await c.resolveOfflineConflict(base,'keep_server');assert.equal(removals.length,old+1);
});
await test('server outage retains local queued work without rebase or removal',async()=>{
 const before=removals.length, rebases=rebaseRequests.length;
 failNetwork=true;
 await assert.rejects(()=>c.resolveOfflineConflict(base,'keep_server'),/server unavailable/);
 assert.equal(removals.length,before);assert.equal(rebaseRequests.length,rebases);
 failNetwork=false;
});
await test('unregistered conflict still supports explicit local discard',async()=>{
 const noId={...base,conflictId:null,conflictPayload:{}};
 const n=removals.length;queuedRecord=noId;
 await c.resolveOfflineConflict(noId,'discard');assert.equal(removals.length,n+1);queuedRecord=base;
});
await test('absent or changed queued mutation cannot trigger server conflict resolution',async()=>{
 const before=apiRequests.length;queuedRecord=null;
 await assert.rejects(()=>c.resolveOfflineConflict(base,'keep_server'),/changed in another window/);
 queuedRecord={...base,updatedAt:123};
 await assert.rejects(()=>c.resolveOfflineConflict(base,'keep_server'),/changed in another window/);
 queuedRecord=base;assert.equal(apiRequests.length,before);
});
await test('server acknowledgement does not imply retry when local rebase disappears',async()=>{
 missingRebase=true;
 await assert.rejects(()=>c.resolveOfflineConflict(base,'merge',{title:'local'}),/replay was not confirmed/);
 missingRebase=false;
});
await test('automatic silent discard is absent from server-posture refresh' ,()=>{
 const runtime=read('packages/renderer/src/core/offline-runtime.ts');
 assert.doesNotMatch(runtime,/allowedActions\.length\s*===\s*1\s*&&\s*allowedActions\[0\]\s*===\s*['"]discard['"]/);
 assert.match(runtime,/if \(item\.conflictId\)\s*\{/);
 assert.match(runtime,/await resolveOfflineConflict\(item, action\)/);
 assert.match(runtime,/mayRetryFailedMutation/);
});
await test('Sync Center offers copy and explicit confirmation, disables unsafe retries',()=>{
 const ui=read('packages/renderer/src/components/SyncStatusIndicator.tsx');
 assert.match(ui,/copyQueuedMutation\(mutation\)/);
 assert.match(ui,/window\.confirm\(`/);
 assert.match(ui,/mayRetryFailedMutation\(mutation\)/);
 assert.match(ui,/role="status"/);
});
const retryJs=ts.transpileModule(read('packages/renderer/src/core/offline-policy.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const retryMod={exports:{}};vm.runInNewContext(retryJs,{module:retryMod,exports:retryMod.exports,require,Number,Boolean,String,Math,Set});
const mayRetry=retryMod.exports.mayRetryFailedMutation;
await test('transient failed mutation can be retried',()=>assert.equal(mayRetry({status:'failed',conflictKind:null}),true));
await test('permission, validation, deleted, and revision failures cannot be bulk retried',()=>{
 for(const conflictKind of ['permission','validation','deleted','revision']) assert.equal(mayRetry({status:'failed',conflictKind}),false);
});
await test('quarantined and unresolved conflicts cannot be bulk retried',()=>{
 assert.equal(mayRetry({status:'failed',quarantinedAt:Date.now()}),false);
 assert.equal(mayRetry({status:'conflict'}),false);
});
console.log(`G25 WS13 offline conflict safety: ${passed}/${passed} passed`);
