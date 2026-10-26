import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (()=>{ try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); }})();
const source = readFileSync(new URL('../../packages/renderer/src/core/offline-storage.ts',import.meta.url),'utf8');
const pending = [];
const cache = new Map();
let pauseNextPut = false;
let failNextPut = false;
const bridge = {
  offlineCacheGet: async (_,key) => cache.get(key) || null,
  offlineCacheList: async () => [...cache.values()],
  offlineCachePut: async (_,record) => {
    if (failNextPut) { failNextPut=false; throw Error('simulated desktop disk error'); }
    if (pauseNextPut) { pauseNextPut=false; await new Promise(resolve=>pending.push(resolve)); }
    cache.set(record.key,record);
  },
  offlineCacheRemove: async (_,key) => { cache.delete(key); },
};
const storage = new Map();
const win = {
  clusterDesktop: bridge,
  localStorage: { getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,value) },
  dispatchEvent:()=>{},
};
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module:mod,exports:mod.exports, window:win, Promise,Date,Map,Set,Error,CustomEvent:class{constructor(type,detail){this.type=type;this.detail=detail;}},
  console, setTimeout,clearTimeout, Blob, URL, crypto:globalThis.crypto,
});
const api=mod.exports;
let count=0;
const check=(name,fn)=>{fn();console.log('PASS',name);count++};
api.setOfflineScope('A');
pauseNextPut=true;
const initial=api.saveOfflineDraft('form',{title:'old'});
// Give the queued storage write a chance to enter the Desktop bridge.
for(let i=0;i<12;i++) await Promise.resolve();
check('initial autosave begins before async clear',()=>assert.equal(pending.length,1));
const cleared=api.clearOfflineDraft('form');
const readAfterClear=api.readOfflineDraft('form');
check('read is still behind pending write + clear',()=>assert.equal(cache.has('A:form'),false));
pending.shift()();
await Promise.all([initial,cleared]);
const clearedRead=await readAfterClear; check('committed clear cannot be overwritten by earlier pending draft write',()=>assert.equal(clearedRead,null));
const stored=await api.saveOfflineDraft('form',{title:'new'});
check('saving after clear remains possible',()=>{assert.equal(stored?.value.title,'new');assert.equal(cache.get('A:form').value.title,'new');});
const readBack=await api.readOfflineDraft('form');
check('read after save returns latest durable record',()=>assert.equal(readBack?.value.title,'new'));
failNextPut=true;
await assert.rejects(api.saveOfflineDraft('fail',{title:'ignored'}),/disk error/);
await api.clearOfflineDraft('fail');
check('failed save does not poison later operations',()=>assert.equal(cache.has('A:fail'),false));
const queuedWrite=api.saveOfflineDraft('form',{title:'first'});
const queuedSecond=api.saveOfflineDraft('form',{title:'second'});
await Promise.all([queuedWrite,queuedSecond]);
check('two writes respect invocation ordering',()=>assert.equal(cache.get('A:form').value.title,'second'));
// Pause A's first write then switch to B, preserving the previous draft.
pauseNextPut=true;
const held=api.saveOfflineDraft('stale',{title:'A'});
for(let i=0;i<12;i++)await Promise.resolve();
api.setOfflineScope('B');
const b=await api.saveOfflineDraft('stale',{title:'B'});
pending.shift()();
await held;
check('different account keys cannot overwrite one another',()=>{assert.equal(b?.value.title,'B');assert.equal(cache.get('B:stale')?.value.title,'B');});
api.setOfflineScope('A');
const queuedBeforeSwitch=api.saveOfflineDraft('relogin',{title:'first login'});
api.setOfflineScope('B');api.setOfflineScope('A');
const result=await queuedBeforeSwitch;
check('account A-to-B-to-A generation invalidates stale queued writes',()=>{assert.equal(result,null);assert.equal(cache.has('A:relogin'),false);});
check('draft operation serialization and session ownership are present',()=>{
  assert.match(source,/draftOperationTails/);
  assert.match(source,/inDraftOrder\(storageKey/);
  assert.match(source,/draftOwnerIsCurrent/);
});
console.log(`G27 P41 offline draft order: ${count}/${count} assertions passed`);
