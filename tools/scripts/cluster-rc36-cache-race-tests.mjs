import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(require('node:child_process').execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
const root = path.resolve(new URL('../..', import.meta.url).pathname);
function loadModule(rel, deps) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const output = ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  const run = vm.runInNewContext(`(function(require,module,exports){${output}\n})`,{
    Date, Promise, Map, Set, String, Number, Math, AbortController, DOMException,
    console, performance:{now:()=>0},
  });
  run((spec)=>{ if (!(spec in deps)) throw new Error(`Unexpected import: ${spec}`); return deps[spec]; },mod,mod.exports);
  return mod.exports;
}
const deferred=()=>{let resolve, reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const tick=async()=>{ for(let i=0;i<15;i++) await Promise.resolve(); };
async function harness() {
  const requests=[];
  const queryCache=new Map();
  let sessionGeneration=0;
  const query=loadModule('packages/renderer/src/core/api/query.ts',{
    '../offline-storage':{getOfflineScope:()=> 'owner',readCachedResponse:async()=>null,writeCachedResponse:async()=>{}},
    '../performance':{recordPerformanceMetric:()=>{}},
    './transport':{api:(url)=>{const gate=deferred();requests.push({url,...gate});return gate.promise;}},
    './errors':{ApiError:class ApiError extends Error{constructor(message,status,payload,id,code){super(message);this.status=status;this.code=code;}},isApiNetworkFailure:()=>false,isOnline:()=>true},
    './cache':{
      backgroundRevalidations:new Map(),currentSessionCacheGeneration:()=>sessionGeneration,
      queryCache,setQueryCache:(key,entry)=>queryCache.set(key,entry),
    },
    './live-search-authorization':{requiresFreshSearchAuthorization:()=>false},
  });
  return {query,requests,queryCache,incrementSession:()=>{sessionGeneration++;}};
}
let count=0;
async function test(name,func){await func();count++;console.log(`PASS ${name}`);}
await test('an invalidated in-flight response is refetched before it reaches the view',async()=>{
  const h=await harness();
  const rendered=h.query.queryApi('/api/projects',{persist:false});
  await tick();assert.equal(h.requests.length,1);
  h.queryCache.delete('owner:/api/projects'); // mutation invalidation
  h.requests[0].resolve({version:'old'});
  await tick();assert.equal(h.requests.length,2,'old response must trigger recovery');
  h.requests[1].resolve({version:'new'});
  assert.equal((await rendered).version,'new');
  assert.notEqual(h.queryCache.get('owner:/api/projects')?.value?.version,'old');
});
await test('a newer optimistic projection wins over a late old server response',async()=>{
  const h=await harness();
  const rendered=h.query.queryApi('/api/projects',{persist:false});
  await tick();
  h.queryCache.set('owner:/api/projects',{value:{version:'newer'},staleAt:Date.now()+10000,expiresAt:Date.now()+20000});
  h.requests[0].resolve({version:'old'});
  assert.equal((await rendered).version,'newer');
  assert.equal(h.requests.length,1,'do not issue redundant GET when fresh projection exists');
});
await test('a session change rejects the old payload instead of leaking it',async()=>{
  const h=await harness();
  const rendered=h.query.queryApi('/api/private',{persist:false});
  await tick();
  h.queryCache.clear();h.incrementSession();
  h.requests[0].resolve({secret:'previous-account'});
  await assert.rejects(rendered,err=>err.code==='AUTH_CONTEXT_CHANGED');
  assert.equal(h.requests.length,1);
});
await test('cancelled navigation cannot publish late data',async()=>{
  const h=await harness(), controller=new AbortController();
  const rendered=h.query.queryApi('/api/projects',{persist:false,signal:controller.signal});
  await tick();h.queryCache.clear();controller.abort();h.requests[0].resolve({version:'old'});
  await assert.rejects(rendered,err=>err.name==='AbortError');
  assert.equal(h.requests.length,1);
});
await test('fresh concurrent reads still deduplicate',async()=>{
  const h=await harness();
  const a=h.query.queryApi('/api/projects',{persist:false});
  const b=h.query.queryApi('/api/projects',{persist:false});
  await tick();assert.equal(h.requests.length,1);
  h.requests[0].resolve({version:'current'});
  assert.equal((await a).version,'current');assert.equal((await b).version,'current');
});
console.log(`RC36 cache correctness: ${count}/${count} passed`);
