import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const src=(file)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
const transpile=(code)=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const load=(code,deps)=>{const m={exports:{}};vm.runInNewContext(transpile(code),{module:m,exports:m.exports,require:id=>deps[id]||{},Headers,crypto,Promise,Date,Map,Set,performance,console,setTimeout,clearTimeout});return m.exports};
const ownership=load(src('packages/renderer/src/core/user-state-ownership.ts'),{});
const alice={scope:'alice',generation:1},bob={scope:'bob',generation:2},newAlice={scope:'alice',generation:3};
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
function fixture(){
 let owner=alice;let batch=async()=>({results:[]});let single=async()=>({});const calls=[],updates=[],deletes=[],invalidations=[];const records=new Map();
 const db={getOfflineScopeIdentity:()=>owner,listOfflineMutations:async (scope)=>[...records.values()].filter(r=>r.scope===(scope||owner.scope)),updateOfflineMutation:async(id,change)=>{updates.push({id,change});const old=records.get(id);if(old)records.set(id,{...old,...change});return records.get(id)||null},removeOfflineMutation:async id=>{deletes.push(id);records.delete(id)}};
 const deps={
 '../offline-policy':{shouldQuarantineMutation:()=>false},'../offline-storage':db,'../user-state-ownership':ownership,
 '../offline-server-binding':{readOfflineServerBinding:()=>null,queuedWorkMatchesServerBinding:()=>({ok:true})},
 '../performance':{recordPerformanceMetric:()=>{}},'../version':{APP_VERSION:'0.546.0'},
 './errors':{ApiError:class extends Error{constructor(message,status){super(message);this.status=status}},isOnline:()=>true},
 './transport':{rawApi:async(...args)=>{calls.push('batch');return batch(...args)},api:async(...args)=>{calls.push('single');return single(...args)}},
 './config':{syncDeviceId:()=> 'device'},'./mutation-cache':{invalidateMutationCache:()=>invalidations.push('cache')},
 './mutation-support':{invalidateMutationQueries:()=>invalidations.push('query')},'./offline-replay':{retryDelay:()=>1000}
 };
 const api=load(src('packages/renderer/src/core/api/outbox.ts'),deps);
 const seed=(id,scope='alice',dependsOn=[])=>records.set(id,{id,scope,status:'pending',nextAttemptAt:0,method:'PATCH',path:'/api/test',body:{},headers:{},attempts:0,dependsOn,idempotencyKey:`key-${id}`});
 return {api,calls,updates,deletes,invalidations,records,seed,set owner(x){owner=x},set batch(fn){batch=fn},set single(fn){single=fn}};
}
const f=fixture();f.seed('a');let resolveBatch;
f.batch=()=>new Promise(resolve=>resolveBatch=resolve);
const inFlight=f.api.flushApiOutbox();
for(let i=0;i<30&&!resolveBatch;i++)await Promise.resolve();
assert.equal(typeof resolveBatch,'function');
f.owner=bob;
const newSession=await f.api.flushApiOutbox();
check('new account cannot adopt old account in-flight batch',()=>assert.equal(newSession.length,0));
resolveBatch({results:[{id:'a',ok:true,status:200}]});
const old=await inFlight;
check('old session results suppressed after switch',()=>assert.equal(old.length,0));
check('old batch leaves record intact for next authorized replay',()=>assert(f.records.has('a')));
check('old response does not delete or invalidate next account cache',()=>{assert.deepEqual(f.deletes,[]);assert.deepEqual(f.invalidations,[])});
check('old account stats not shown under new identity',()=>assert.equal(f.api.getLastApiOutboxFlushStats().replayed,0));
const g=fixture();g.seed('one');g.batch=async()=>({results:[{id:'one',ok:true,status:200}]});
const successful=await g.api.flushApiOutbox();
check('normal successful replay removes queued entry',()=>{assert.equal(successful.length,0);assert.deepEqual(g.deletes,['one'])});
check('normal replay exposes current stats',()=>assert.equal(g.api.getLastApiOutboxFlushStats().replayed,1));
const h=fixture();h.seed('one');let rejectBatch;
h.batch=()=>new Promise((resolve,reject)=>rejectBatch=reject);
const failing=h.api.flushApiOutbox();for(let i=0;i<30&&!rejectBatch;i++)await Promise.resolve();
h.owner=newAlice;
rejectBatch(Object.assign(Error('batch unsupported'),{status:404}));
await failing;
check('old 404 response does not initiate sequential fallback for new session',()=>assert(!h.calls.includes('single')));
const j=fixture();j.seed('one');j.seed('two','alice',['one']);let resolveFirst;j.batch=()=>new Promise(resolve=>resolveFirst=resolve);
const multi=j.api.flushApiOutbox();for(let i=0;i<30&&!resolveFirst;i++)await Promise.resolve();j.owner=bob;resolveFirst({results:[{id:'one',ok:true,status:200}]});await multi;
check('account transition stops before dependent batch',()=>assert.equal(j.calls.filter(v=>v==='batch').length,1));
const s=src('packages/renderer/src/core/offline-storage.ts');
check('mutation update compares stored row scope',()=>assert.match(s,/existing\.scope !== owner\.scope \|\| !current\(\)/));
check('mutation patches cannot change queue scope',()=>assert.match(s,/const next = \{ \.\.\.existing, \.\.\.patch, scope: existing\.scope, id/));
check('explicit cleanup removes only named scope in all stores',()=>assert.match(s,/for \(const area of \[MUTATION_STORE, UPLOAD_STORE, DRAFT_STORE, META_STORE\]\)/));
const o=src('packages/renderer/src/core/api/outbox.ts');
check('outbox rechecks current owner after server batch reply',()=>assert.match(o,/if \(!isCurrent\(\)\) return \[\];\s+const byId = new Map/));
check('outbox checks owner before fallback replay',()=>assert.match(o,/if \(!isCurrent\(\)\) return \[\];\s+if \(error instanceof ApiError && error\.status === 404\)/));
console.log(`G27 Pass 50 outbox session ownership: ${count}/${count} checks passed`);
