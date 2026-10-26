import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const source=readFileSync(new URL('../../packages/renderer/src/core/offline-storage.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const stores=new Map();const store=(area)=>{if(!stores.has(area))stores.set(area,new Map());return stores.get(area)};
const locks=new Map();const names=[];
let delayWrite=null;
const bridge={
 offlineCacheGet:async (area,key)=>store(area).get(key)||null,
 offlineCacheList:async (area)=>[...store(area).values()],
 offlineCachePut:async (area,record)=>{if(delayWrite?.area===area){const wait=delayWrite;await new Promise(r=>wait.release=r)}store(area).set(record.key,record)},
 offlineCacheRemove:async (area,key)=>{store(area).delete(key)},
 offlineCacheRemoveMany:async (area,keys)=>{for(const key of keys)store(area).delete(key)},
};
const navigator={locks:{request:(name,options,cb)=>{
 names.push({name,mode:options.mode});
 const before=locks.get(name)||Promise.resolve();const current=before.catch(()=>undefined).then(()=>cb({name}));
 const tail=current.catch(()=>undefined);locks.set(name,tail);tail.then(()=>{if(locks.get(name)===tail)locks.delete(name)});
 return current;
}}};
function openRenderer(){const m={exports:{}};const window={clusterDesktop:bridge,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},dispatchEvent:()=>{}};
 vm.runInNewContext(js,{module:m,exports:m.exports,window,navigator,Promise,Date,Map,Set,Error,console,crypto:globalThis.crypto,Blob,URL,setTimeout,clearTimeout,CustomEvent:class{}});return m.exports;
}
const a=openRenderer(),b=openRenderer();a.setOfflineScope('Alice');b.setOfflineScope('Alice');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
const until=async(predicate)=>{for(let i=0;i<400;i++){if(predicate())return;await Promise.resolve()}throw Error('timed out waiting for blocked operation')};
let queued={area:'drafts',release:null};delayWrite=queued;
const writing=a.saveOfflineDraft('create',{private:'draft'});
await until(()=>typeof queued.release==='function');
const wiping=b.clearOfflineReadScope('Alice');
await Promise.resolve();
check('scope cleanup cannot finish during a pending write',()=>assert.equal(store('drafts').has('Alice:create'),false));
delayWrite=null;queued.release();
await Promise.all([writing,wiping]);
check('logout scope cleanup removes an earlier draft write',()=>assert.equal(store('drafts').has('Alice:create'),false));
check('scope uses an exclusive Web Lock for cleanup',()=>assert(names.some(i=>i.name==='cluster-offline:read-scope:Alice'&&i.mode==='exclusive')));
check('ordinary draft writes use a shared scope lease',()=>assert(names.some(i=>i.name==='cluster-offline:read-scope:Alice'&&i.mode==='shared')));
queued={area:'meta',release:null};delayWrite=queued;
const metaWrite=a.writeOfflineMeta('delta-cursor','sensitive-cursor');
await until(()=>typeof queued.release==='function');
const metaWipe=b.clearOfflineReadScope('Alice');
delayWrite=null;queued.release();
await Promise.all([metaWrite,metaWipe]);
check('logout scope cleanup removes pending cursor persistence',()=>assert.equal(store('meta').has('Alice:delta-cursor'),false));
await b.writeOfflineMeta('work',{owner:'Bob'},'Bob');
await b.saveOfflineDraft('note',{owner:'Bob'},{scope:'Bob'});
await b.clearOfflineReadScope('Alice');
check('scope cleanup does not erase another account cursor',()=>assert.equal(store('meta').get('Bob:work').value.owner,'Bob'));
check('scope cleanup does not erase another account draft',()=>assert.equal(store('drafts').get('Bob:note').value.owner,'Bob'));
await a.writeOfflineMeta('owned','A');
const before=await a.readOfflineMeta('owned');
check('normal cursor read remains functional',()=>assert.equal(before,'A'));
let releaseRead;
const originalGet=bridge.offlineCacheGet;
bridge.offlineCacheGet=async (area,key)=>{if(area==='meta'&&key==='Alice:owned') await new Promise(resolve=>{releaseRead=resolve});return originalGet(area,key)};
const oldRead=a.readOfflineMeta('owned');
await until(()=>typeof releaseRead==='function');
a.setOfflineScope('Bob');releaseRead();
check('stale cursor read is suppressed after account switch',async()=>assert.equal(await oldRead,null));
await oldRead;
bridge.offlineCacheGet=originalGet;
check('Web Locks released after read and wipe',()=>assert.equal(locks.size,0));
console.log(`G27 P48 local-state cleanup ordering: ${count}/${count} checks passed`);
