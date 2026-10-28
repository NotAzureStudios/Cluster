import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(require('node:child_process').execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); }
})();
const root = new URL('../../', import.meta.url).pathname;
let passed = 0;
function test(name, callback) { return Promise.resolve().then(callback).then(() => { console.log('PASS', name); passed++; }); }
function load(file, deps = {}, extra = {}) {
  const source=fs.readFileSync(root + file, 'utf8');
  const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const context={Date, Map, Set, Promise, Array, Number, String, Math, console, Error, URL, queueMicrotask,
    Blob, FormData, DOMException, AbortController, AbortSignal, Headers, setTimeout, clearTimeout, ...extra};
  const wrapper=vm.runInNewContext(`(function(require, module, exports) { ${transpiled}\n})`,context);
  wrapper((spec) => { if (spec in deps) return deps[spec]; throw new Error(`Unexpected module: ${spec}`);},module,module.exports);
  return module.exports;
}
let eventCount=0;
const records=new Map();
let holdPut=null, releasePut=null;
const bridge={
  offlineCacheGet: async (_,key)=>records.get(key)||null,
  offlineCacheList: async (_area, scope)=>[...records.values()].filter(x=>x.scope===scope),
  offlineCachePut: async (_area,record)=>{ if (holdPut) await new Promise(resolve=>releasePut=resolve); records.set(record.key, record); },
  offlineCacheRemove: async (_area,key)=>{ records.delete(key); },
  // Deliberately no offlineCacheRemoveMany: older/native versions need fallback.
};
const windowMock={clusterDesktop:bridge, localStorage:{removeItem:()=>{}}, dispatchEvent:()=>{eventCount++;}};
const store=load('packages/renderer/src/core/offline-storage.ts',{}, {
  window:windowMock,
  CustomEvent:class CustomEvent {constructor(type,opts){this.type=type;this.detail=opts?.detail;}},
});
await test('unchanged authenticated scope does not wake every offline subscriber', () => {
  store.setOfflineScope('alice');
  assert.equal(eventCount,1);
  const identity=store.getOfflineScopeIdentity();
  for(let i=0;i<20;i++) store.setOfflineScope('alice');
  assert.equal(eventCount,1);
  assert.deepEqual({...store.getOfflineScopeIdentity()}, {...identity});
});
const record=(path,value)=>({path,value,cachedAt:1,staleAt:100,expiresAt:200,tags:['project']});
await test('Desktop cache invalidates records without optional bulk-delete API',async()=>{
  await store.writeCachedResponse(record('/api/projects', ['first']));
  await store.writeCachedResponse(record('/api/calendar', ['second']));
  assert.equal(records.size,2);
  await store.invalidateCachedResponses(x=>x.path.startsWith('/api/projects'));
  assert.equal(records.size,1);
  assert.equal([...records.values()][0].path, '/api/calendar');
});
await test('old Desktop writes cannot resurrect records after invalidation',async()=>{
  holdPut=true;
  const writing=store.writeCachedResponse(record('/api/private', {old:true}));
  for(let i=0;i<20 && !releasePut;i++) await Promise.resolve();
  assert.ok(releasePut, 'write was blocked inside the native bridge');
  await store.invalidateCachedResponses(x=>x.path==='/api/private');
  holdPut=false;
  releasePut();
  await writing;
  assert.equal(records.has('alice:/api/private'),false);
});
let invalidationCount=0, invalidationScope=null, combinedFilter=null;
const cacheData=new Map();
let activeScope='alice';
const cache=load('packages/renderer/src/core/api/cache.ts',{
  '../performance':{recordPerformanceMetric:()=>{}},
  '../offline-storage':{
    clearOfflineReadScope:async()=>{},getOfflineScope:()=>activeScope,
    invalidateCachedResponses:async (fn,scope)=>{invalidationCount++;invalidationScope=scope;combinedFilter=fn;},
    setOfflineScope:(scope)=>{activeScope=scope;}, writeCachedResponse:async()=>{},
  },
},{performance:{now:()=>0}});
await test('multiple cache invalidation prefixes and tags share a durable disk scan',async()=>{
  cache.invalidateApiQueries('/api/projects');
  cache.invalidateApiQueries('/api/calendar');
  cache.invalidateApiQueryTags(['important']);
  activeScope='bob';
  await Promise.resolve();
  assert.equal(invalidationCount,1);
  assert.equal(invalidationScope,'alice');
  assert.equal(combinedFilter({path:'/api/projects/1',tags:[]}),true);
  assert.equal(combinedFilter({path:'/api/calendar/events',tags:[]}),true);
  assert.equal(combinedFilter({path:'/api/other',tags:['important']}),true);
  assert.equal(combinedFilter({path:'/api/other',tags:[]}),false);
});
await test('a cancelled navigation request is not misdiagnosed as timeout',async()=>{
  const {ApiError}=load('packages/renderer/src/core/api/errors.ts',{
    '@cluster/shared':{clusterErrorDefinition:()=>null}
  });
  const cancelled=new AbortController();
  cancelled.abort();
  const api=load('packages/renderer/src/core/api/transport.ts',{
    '@cluster/shared':{CLUSTER_PERSON_CHANGED_EVENT:'person',CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT:'work',clusterErrorDefinition:()=>null},
    '@cluster/api-client':{ClusterApiClientError:class extends Error {}, clusterApiFetch:async()=>{throw new DOMException('Aborted','AbortError');}},
    '../cohesion-events':{emitClusterCohesionEvent:()=>{}},
    '../performance':{recordPerformanceMetric:()=>{}},
    '../reauthentication':{requestReauthentication:async()=>false},
    '../session-lifecycle':{shouldInvalidateAuthenticatedClientForError:()=>false},
    '../offline-storage':{getOfflineScopeIdentity:()=>({scope:'alice',generation:1}),resumeAuthenticationPausedOfflineWork:async()=>{},setOfflineScope:()=>{}},
    './auth-context':{authenticatedUserIdFromResponse:()=>null,isCurrentAccountRequest:()=>true},
    './config':{API_TIMEOUT_MS:20000,installationDeviceId:()=> 'device'},
    './errors':{ApiError,apiOperationLabel:(a,b)=>a+' '+b},
    './cache':{invalidateAuthenticatedClientState:async()=>{}},
    './mutation-cache':{invalidateMutationCache:()=>{}},
  });
  let rejected=null;
  try {await api.rawApi('/api/projects',{signal:cancelled.signal});} catch (e) {rejected=e;}
  if (rejected?.name !== 'AbortError') console.error('ABORT TEST ERROR', rejected?.stack || rejected);
  assert.equal(rejected?.name,'AbortError');
});
await test('rate-limit windows remain strict without a full-map sweep per request',()=>{
  const {FixedWindowRateLimiter}=load('apps/server/src/core/rate-limit.ts');
  const limiter=new FixedWindowRateLimiter(2,10);
  const prune=limiter.prune.bind(limiter);
  let scans=0;
  limiter.prune=(at)=>{scans++;return prune(at);};
  for (let i=0;i<400;i++) limiter.consumeCost(i%2?'a':'b',1000,60000,1,10000);
  assert.ok(scans<=2, `expected bounded sweeping, got ${scans}`);
  for(let i=0;i<30;i++) limiter.consume('unique-'+i,1,60000,10000);
  assert.ok(limiter.stats().buckets<=10);
  assert.equal(limiter.consume('only',1,60000,30000).allowed,true);
});
await test('collaboration queue ignores unrelated response-cache writes',()=>{
  const file=fs.readFileSync(root+'packages/renderer/src/features/collaboration/offlineQueue.ts','utf8');
  assert.equal((file.match(/area === "mutations" \|\| area === "scope" \|\| area === "all"/g)||[]).length,2);
});
for(const name of [
  'packages/renderer/src/core/offline-storage.ts','packages/renderer/src/core/api/cache.ts',
  'packages/renderer/src/core/api/query.ts','packages/renderer/src/core/api/transport.ts',
  'packages/renderer/src/features/collaboration/offlineQueue.ts','apps/server/src/core/rate-limit.ts'
]){
  const src=ts.createSourceFile(name,fs.readFileSync(root+name,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(src.parseDiagnostics.length,0,`${name}: ${src.parseDiagnostics.map(e=>e.messageText).join('; ')}`);
}
console.log(`RC35 release-closeout checks: ${passed}/${passed} passed`);
