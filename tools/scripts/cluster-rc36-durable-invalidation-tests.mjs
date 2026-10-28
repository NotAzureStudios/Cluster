import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'));}})();
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const source=fs.readFileSync(path.join(root,'packages/renderer/src/core/offline-storage.ts'),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const records=new Map();
let holdListing=null;
const bridge={
  offlineCacheGet:async(_area,key)=>records.get(key)||null,
  offlineCacheList:async(_area,scope)=>{if(holdListing)await holdListing.promise;return [...records.values()].filter(x=>x.scope===scope);},
  offlineCachePut:async(_area,record)=>{records.set(record.key,record);},
  offlineCacheRemove:async(_area,key)=>{records.delete(key);},
};
const win={clusterDesktop:bridge,localStorage:{removeItem:()=>{}},dispatchEvent:()=>{}};
const mod={exports:{}};
vm.runInNewContext(`(function(require,module,exports){${output}\n})`,{
  Date,Map,Set,Promise,Array,Number,String,Math,console,Blob,crypto:globalThis.crypto,
  window:win,CustomEvent:class {constructor(type,opts){this.type=type;this.detail=opts?.detail;}},
})(()=>{throw new Error('unexpected import')},mod,mod.exports);
const store=mod.exports;
const gate=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const make=(scope,path)=>({scope,path,key:`${scope}:${path}`,value:{owner:scope},cachedAt:Date.now(),staleAt:Date.now()+60000,expiresAt:Date.now()+120000,tags:['private'],sizeBytes:25});
let passed=0;
async function test(name,work){await work();passed++;console.log(`PASS ${name}`);}
store.setOfflineScope('alice');
await test('an invalidating projection cannot be read before native deletion finishes',async()=>{
  records.set('alice:/api/private',make('alice','/api/private'));
  holdListing=gate();
  const clearing=store.invalidateCachedResponses(x=>x.path==='/api/private');
  const cached=await store.readCachedResponse('/api/private');
  assert.equal(cached,null);
  holdListing.resolve();await clearing;holdListing=null;
  assert.equal(await store.readCachedResponse('/api/private'),null);
});
await test('a read that began before invalidation is screened on completion',async()=>{
  records.set('alice:/api/private',make('alice','/api/private'));
  const original=bridge.offlineCacheGet;
  const held=gate();
  bridge.offlineCacheGet=async(_,key)=>{const snapshot=records.get(key);await held.promise;return snapshot;};
  const reading=store.readCachedResponse('/api/private');
  const clearing=store.invalidateCachedResponses(x=>x.path==='/api/private');
  held.resolve();
  assert.equal(await reading,null);
  await clearing;
  bridge.offlineCacheGet=original;
});
await test('an invalidation failure fails closed instead of reviving a private record',async()=>{
  records.set('alice:/api/private',make('alice','/api/private'));
  const original=bridge.offlineCacheList;
  bridge.offlineCacheList=async()=>{throw new Error('storage offline');};
  await assert.rejects(store.invalidateCachedResponses(x=>x.path==='/api/private'),/storage offline/);
  bridge.offlineCacheList=original;
  assert.equal(await store.readCachedResponse('/api/private'),null);
});
await test('failure quarantine does not block a different account',async()=>{
  store.setOfflineScope('bob');
  records.set('bob:/api/private',make('bob','/api/private'));
  assert.equal((await store.readCachedResponse('/api/private'))?.scope,'bob');
});
console.log(`RC36 durable-cache correctness: ${passed}/${passed} passed`);
