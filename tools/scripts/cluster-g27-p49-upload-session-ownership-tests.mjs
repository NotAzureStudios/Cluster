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
const mod=(code,imports)=>{const m={exports:{}};vm.runInNewContext(transpile(code),{module:m,exports:m.exports,require:(id)=>imports[id]||{},Headers,Blob,Promise,Date,Map,Set,crypto,performance,console,setTimeout,clearTimeout});return m.exports};
const ownership=mod(src('packages/renderer/src/core/user-state-ownership.ts'),{});
let count=0;
const check=(name,callback)=>{callback();count++;console.log('PASS',name)};
const a={scope:'alice',generation:1},b={scope:'bob',generation:2},a2={scope:'alice',generation:3};
function harness(){
  let current=a, online=false, transfer=async()=>({id:'done'}), queued=[], updates=[], removals=[], uploaded=[];
  const records=new Map();
  const store={
    getOfflineScopeIdentity:()=>current,
    listOfflineUploads:async(scope)=>[...records.values()].filter(r=>r.scope===(scope||current.scope)),
    queueOfflineUpload:async(record,allowed)=>{if(!allowed())throw Error('Authentication context changed before queuing');let item={...record,id:`u${queued.length+1}`,status:'pending',nextAttemptAt:0,attempts:0};queued.push(item);records.set(item.id,item);return item},
    updateOfflineUpload:async(id,patch)=>{updates.push({id,patch});if(!records.has(id))return null;const next={...records.get(id),...patch};records.set(id,next);return next},
    removeOfflineUpload:async(id)=>{removals.push(id);records.delete(id)},
  };
  const modules={
    '../offline-storage':store,
    '../user-state-ownership':ownership,
    '../offline-server-binding':{readOfflineServerBinding:()=>null,queuedWorkMatchesServerBinding:()=>({ok:true})},
    '../performance':{recordPerformanceMetric:()=>{}},
    './errors':{ApiError:class extends Error{constructor(message,status){super(message);this.status=status}},isApiNetworkFailure:e=>e?.code==='NETWORK',isOnline:()=>online},
    './config':{mutationIdempotencyKey:()=> 'once-123'},
    './offline-replay':{retryDelay:()=>1000},
    './mutation-support':{persistentMutationHeaders:()=>({})},
    './upload-session-transport':{discardUploadSession:async()=>{},finalizeStagedUpload:async(...args)=>{uploaded.push(args);return transfer(...args)}}
  };
  const api=mod(src('packages/renderer/src/core/api/uploads.ts'),modules);
  const props={get current(){return current},set current(v){current=v},set online(v){online=v},set transfer(v){transfer=v},queued,updates,removals,records,uploaded,api};
  return props;
}
const options={file:new Blob(['payload']),fileName:'a.txt',body:{projectId:'P'},label:'Upload evidence'};
const x=harness();
const offline=await x.api.uploadApi('/api/library/upload',options);
check('offline upload persists initiating account scope',()=>{assert.equal(offline.queued,true);assert.equal(x.queued[0].scope,'alice')});
x.current=b;
const returned=await x.api.flushApiUploads();
check('new account receives only own offline uploads',()=>assert.equal(returned.length,0));
const y=harness();
y.online=true;
let fail;
y.transfer=()=>new Promise((resolve,reject)=>{fail=reject});
const inflight=y.api.uploadApi('/api/library/upload',{...options,persistBeforeTransfer:false});
await Promise.resolve();await Promise.resolve();
y.current=b;
fail(Object.assign(new Error('network down'),{code:'NETWORK'}));
await assert.rejects(inflight,/Authentication context changed/);
check('network failure after account switch cannot queue old upload',()=>assert.equal(y.queued.length,0));
const z=harness();z.online=true;
let release;
z.transfer=()=>new Promise(r=>{release=r});
const committed=z.api.uploadApi('/api/library/upload',{...options,queueWhenOffline:false});
await Promise.resolve();await Promise.resolve();z.current=a2;release({id:'committed'});
await assert.rejects(committed,/Authentication context changed/);
check('A to B to A login does not adopt earlier upload result',()=>assert.equal(z.queued.length,0));
const t=harness();t.online=true;
let finish;
t.records.set('pending',{id:'pending',scope:'alice',status:'pending',path:'/upload',method:'POST',file:new Blob(['x']),fileName:'x',body:{},headers:{},idempotencyKey:'key',sizeBytes:1,nextAttemptAt:0,attempts:0});
t.transfer=()=>new Promise(r=>{finish=r});
const older=t.api.flushApiUploads();
for(let k=0;k<20&&!finish;k++)await Promise.resolve();
assert.equal(typeof finish,'function');
t.current=b;
const newer=await t.api.flushApiUploads();
check('new session cannot inherit in-flight old-account flush',()=>assert.equal(newer.length,0));
finish({id:'ok'});
const oldResult=await older;
check('old replay response suppressed after switch',()=>assert.equal(oldResult.length,0));
check('old queue record retained for original account review',()=>assert(t.records.has('pending')));
check('old session cannot remove completed transfer after switch',()=>assert.deepEqual(t.removals,[]));
const ok=harness();ok.online=true;
ok.records.set('up',{id:'up',scope:'alice',status:'pending',path:'/upload',method:'POST',file:new Blob(['x']),fileName:'x',body:{},headers:{},idempotencyKey:'key',sizeBytes:1,nextAttemptAt:0,attempts:0});
const good=await ok.api.flushApiUploads();
check('same account successful flush removes completed record',()=>{assert.equal(good.length,0);assert.deepEqual(ok.removals,['up'])});
const source=src('packages/renderer/src/core/offline-storage.ts');
check('durable queue snapshots scope generation',()=>assert.match(source,/queueOfflineUpload[\s\S]+?const owner = getOfflineScopeIdentity\(\)/));
check('durable queue checks owner after async listing',()=>assert.match(source,/const current = await listOfflineUploads\(scope\);\s+if \(!authorized\(\)\)/));
check('durable queue checks owner before IndexedDB insert',()=>assert.match(source,/if \(!authorized\(\)\) throw new Error\("Authentication context changed before queuing the offline upload\."\);\s+const transaction = db\.transaction\(UPLOAD_STORE/));
check('file queue updates cannot rewrite scope',()=>assert.match(source,/const next = \{ \.\.\.existing, \.\.\.patch, scope: existing\.scope, id/));
check('queue removals compare original row owner',()=>assert.match(source,/if \(!existing \|\| existing\.scope !== owner\.scope \|\| !current\(\)\) return;\s+store\.delete\(id\)/));
check('logout clear scopes uploads explicitly',()=>assert.match(source,/for \(const area of \[MUTATION_STORE, UPLOAD_STORE, DRAFT_STORE, META_STORE\]\)[\s\S]+?if \(row\.scope === scope\) store\.delete\(String\(row\.id \|\| row\.key\)\)/));
console.log(`G27 Pass 49 upload session ownership: ${count}/${count} checks passed`);
