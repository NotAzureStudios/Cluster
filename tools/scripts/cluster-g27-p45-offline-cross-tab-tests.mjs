import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); }})();
const source = readFileSync(new URL('../../packages/renderer/src/core/offline-storage.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const storage = new Map([['cluster-offline:scope','private-A']]);
const records = new Map();
const locks = new Map();
const lockNames = [];
let gatePut = null;
let gateList = null;
const lockManager = {
  request(name, options, operation) {
    assert(['exclusive','shared'].includes(options.mode));
    lockNames.push(name);
    const previous = locks.get(name) || Promise.resolve();
    const current = previous.catch(()=>undefined).then(() => operation({name}));
    const tail = current.catch(()=>undefined);
    locks.set(name,tail);
    tail.then(()=>{ if (locks.get(name) === tail) locks.delete(name); });
    return current;
  }
};
const bridge = {
  offlineCacheGet: async (_,key) => records.get(key) || null,
  offlineCacheList: async () => { const snapshot = [...records.values()]; if (gateList) await new Promise(resolve=>gateList(resolve)); return snapshot; },
  offlineCachePut: async (_,record) => { if (gatePut) await new Promise(resolve=>gatePut(resolve)); records.set(record.key,record); },
  offlineCacheRemove: async (_,key) => { records.delete(key); },
};
function renderer() {
  const localStorage = { getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) };
  const win = {clusterDesktop:bridge, localStorage, dispatchEvent:()=>{}};
  const module={exports:{}};
  vm.runInNewContext(javascript, {
    module, exports:module.exports, window:win, navigator:{locks:lockManager},
    Promise,Date,Map,Set,Error,CustomEvent:class{constructor(type,detail){this.type=type;this.detail=detail;}},
    console, setTimeout,clearTimeout, Blob, URL, crypto:globalThis.crypto,
  });
  return module.exports;
}
const A=renderer(), B=renderer();
let count=0;
function check(label,fn){fn();console.log('PASS',label);count++;}
async function until(predicate, label){for(let i=0;i<200;i++){if(predicate())return; await Promise.resolve();}throw Error(`Timed out waiting for ${label}`);}
check('a new unauthenticated renderer ignores old browser-wide scope',()=>assert.equal(A.getOfflineScope(),'anonymous'));
check('another tab also cannot inherit the last account',()=>assert.equal(B.getOfflineScope(),'anonymous'));
A.setOfflineScope('private-A');
check('authenticated A stays in its own memory scope',()=>assert.equal(A.getOfflineScope(),'private-A'));
check('A no longer publishes identity into localStorage',()=>assert.equal(storage.has('cluster-offline:scope'),false));
check('B stays anonymous until independently authenticated',()=>assert.equal(B.getOfflineScope(),'anonymous'));
B.setOfflineScope('private-A');
// Different renderer-local queues but one shared Web Lock must serialize the
// older write and newer clear.
let releasePut;
gatePut=(fn)=>{releasePut=fn;};
const writing=A.saveOfflineDraft('compose',{body:'stale'});
await until(()=>Boolean(releasePut),'blocked A write');
const clearing=B.clearOfflineDraft('compose');
await Promise.resolve();
check('B clear waits behind A write in the browser lock',()=>assert.equal(records.has('private-A:compose'),false));
gatePut=null;releasePut();
await Promise.all([writing,clearing]);
check('concurrent tab clear wins over previously initiated write',()=>assert.equal(records.has('private-A:compose'),false));
check('Web Lock uses account and exact draft key',()=>assert(lockNames.includes('cluster-offline:drafts:private-A:compose')));
check('cross-renderer locks have released',()=>assert.equal(locks.size,0));
const refresh=await A.saveOfflineDraft('expire',{text:'fresh'});
const old={...refresh, updatedAt:refresh.updatedAt-1234567,expiresAt:Date.now()-500};
records.set(old.key,old);
let releaseList;
gateList=(fn)=>{releaseList=fn;};
const pruning=A.pruneOfflineDrafts('private-A');
await until(()=>Boolean(releaseList),'blocked cleanup snapshot');
gateList=null;
await B.saveOfflineDraft('expire',{text:'renewed'});
releaseList();
const removed=await pruning;
check('stale prune snapshot does not delete renewed cross-tab draft',()=>assert.equal(removed,0));
check('renewed draft survives cleanup',()=>assert.equal(records.get(old.key)?.value.text,'renewed'));
const expired={...records.get(old.key),updatedAt:Date.now()-5000,expiresAt:Date.now()-1000};
records.set(old.key,expired);
const removedExpired=await A.pruneOfflineDrafts('private-A');
check('unchanged expired draft is pruned',()=>assert.equal(removedExpired,1));
check('expired record no longer remains in bridge cache',()=>assert.equal(records.has(old.key),false));
A.setOfflineScope('private-B');
check('B switching accounts never changes tab A identity',()=>assert.equal(B.getOfflineScope(),'private-A'));
console.log(`G27 P45 cross-renderer storage ownership: ${count}/${count} assertions passed`);
