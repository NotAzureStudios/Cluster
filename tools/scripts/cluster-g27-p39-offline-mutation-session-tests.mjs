import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const src=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const load=(code,deps={})=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:id=>deps[id]||{},Headers,crypto,Blob,Promise});return mod.exports};
const ownership=load(src('packages/renderer/src/core/user-state-ownership.ts'));
let count=0;const check=(label,fn)=>{fn();count++;console.log('PASS',label)};
const a={scope:'alice',generation:1},b={scope:'bob',generation:2},aLater={scope:'alice',generation:3};
check('same public origin remains valid',()=>assert.equal(ownership.sameOfflineRequestContext({scope:'anonymous',generation:0},{scope:'anonymous',generation:0}),true));
check('different user rejected',()=>assert.equal(ownership.sameOfflineRequestContext(a,b),false));
check('ABA prior login rejected',()=>assert.equal(ownership.sameOfflineRequestContext(a,aLater),false));
let current=a, network=true, requests=[], queued=[], invalidate=[], allowQueue=true, pendingReject=null;
const api={
 '../offline-storage':{
  getOfflineScopeIdentity:()=>current,
  queueOfflineMutation:async(record,permit)=>{queued.push({record,permit:permit()});if(!permit())throw Error('wrong identity');return {...record,id:'m1'}},
  writeCachedResponse:async(record)=>{},
 },
 '../offline-server-binding':{readOfflineServerBinding:()=>null},
 './transport':{api:async()=>{requests.push('api');if(pendingReject)return pendingReject;return {ok:true}}},
 './errors':{ApiError:class extends Error{constructor(m,code){super(m);this.status=code}},isApiNetworkFailure:()=>true,isOnline:()=>network},
 './config':{mutationIdempotencyKey:()=> 'attempt-id'},
 './cache':{invalidateApiQueries:()=>{},setQueryCache:()=>{}},
 './mutation-cache':{invalidateMutationCache:()=>invalidate.push('cache')},
 './mutation-support':{invalidateMutationQueries:()=>invalidate.push('queries'),persistentMutationHeaders:()=>({})},
 '../offline-policy':{classifyOfflineMutation:()=>({safety:'safe',reason:null})},
 '../user-state-ownership':ownership,
};
const mutation=load(src('packages/renderer/src/core/api/mutation.ts'),api);
const options={method:'PUT',body:{title:'alice'},label:'Save',queueWhenOffline:true,dedupeKey:'my-settings'};
network=false;current=a;
const offline=await mutation.mutateApi('/api/client-state/user/a',options);
check('offline action queues once for initiating account',()=>{assert.equal(offline.queued,true);assert.equal(queued.at(-1).record.scope,'alice');assert.equal(queued.at(-1).permit,true)});
queued=[];network=true;current=a;
let rejectPending;
pendingReject=new Promise((resolve,reject)=>rejectPending=reject);
const inflight=mutation.mutateApi('/api/client-state/user/a',options);
current=b;rejectPending(Error('network disconnected'));
await assert.rejects(inflight,/Authentication context changed/);
check('network failure after account switch cannot queue under next account',()=>assert.equal(queued.length,0));
current=aLater;pendingReject=null;network=false;queued=[];
await mutation.mutateApi('/api/client-state/user/a',options);
check('fresh account session can still queue its own work',()=>assert.equal(queued[0].record.scope,'alice'));
current=a;network=true;pendingReject=null;requests=[];invalidate=[];
const direct=await mutation.mutateApi('/api/hello',options);
check('normal online mutation commits and invalidates',()=>{assert.equal(direct.queued,false);assert.deepEqual(invalidate,['cache','queries'])});
const source=src('packages/renderer/src/core/api/mutation.ts'),store=src('packages/renderer/src/core/offline-storage.ts');
check('offline queue receives pinned original account scope',()=>assert.match(source,/scope: origin\.scope/));
check('offline queue receives live admission callback',()=>assert.match(source,/\}, isCurrent\);/));
check('post-network failure rechecks identity before fallback',()=>assert.match(source,/catch \(error\) \{[\s\S]*?ensureCurrent\(\);[\s\S]*?isApiNetworkFailure\(error\)/));
check('queued optimistic cache pins original account',()=>assert.match(source,/writeOptimisticCache\(options\.optimisticCache, origin\.scope, isCurrent\)/));
check('queue rechecks after async database list',()=>assert.match(store,/const current = await listOfflineMutations\(scope\);\s+if \(!canCommit\(\)\)/));
check('queue rechecks before IndexedDB commit',()=>assert.match(store,/if \(!canCommit\(\)\) throw new Error\("Authentication context changed before queuing the offline operation\."\);\s+const transaction = db\.transaction\(MUTATION_STORE/));
console.log(`G27 P39 Offline mutation ownership: ${count}/${count} checks passed`);
