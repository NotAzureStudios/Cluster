#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const runtime=readFileSync('packages/renderer/src/core/offline-runtime.ts','utf8');
const first=runtime.indexOf('function readSyncLease()');
const end=runtime.indexOf('\nasync function performOfflineRefresh',first);
assert(first>=0&&end>first);
const block=runtime.slice(first,end);
function harness({foreign=false,writeFails=false,webLocks=false,noPersistence=false}={}){
 const values=new Map();let tick=null;const states=[];let runs=0;
 if(foreign) values.set('cluster-sync-lease',JSON.stringify({owner:'other',expiresAt:Date.now()+300000}));
 const store={getItem:key=>values.get(key)??null,setItem:(key,val)=>{if(writeFails)throw Error('storage disabled');if(!noPersistence)values.set(key,val);},removeItem:key=>values.delete(key)};
 const window={localStorage:store,setInterval:cb=>{tick=cb;return 1},clearInterval:()=>{tick=null}};
 const navigator=webLocks ? {locks:{request:async(_key,_options,cb)=>cb({name:'lock'})}} : {};
 const code=`const SYNC_LEASE_KEY='cluster-sync-lease';const SYNC_LEASE_TTL_MS=15000;const syncRuntimeId='local';${block}\nmodule.exports={withSyncLeadership,readSyncLease};`;
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,window,navigator,setSnapshot:value=>states.push(value),Date,JSON,Promise,Number,Error},{filename:'extracted-offline-leadership.ts'});
 return {fn:mod.exports.withSyncLeadership,store,values,states,getTick:()=>tick,count:()=>runs,doTask:async()=>{runs++;return 'performed'}};
}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name)}
await test('atomic Web Locks path runs and does not use storage fallback',async()=>{const h=harness({webLocks:true,writeFails:true});assert.equal(await h.fn(h.doTask),'performed');assert.equal(h.count(),1)});
await test('fallback foreign lease preserves local work and marks follower',async()=>{const h=harness({foreign:true});assert.equal(await h.fn(h.doTask),null);assert.equal(h.count(),0);assert.equal(h.states.at(-1).leadership,'follower')});
await test('storage write failure never executes an unlocked mutation replay',async()=>{const h=harness({writeFails:true});assert.equal(await h.fn(h.doTask),null);assert.equal(h.count(),0);assert.match(h.states.find(s=>s.lastError)?.lastError,/preserved/)});
await test('write accepted but not persisted cannot claim leadership',async()=>{const h=harness({noPersistence:true});assert.equal(await h.fn(h.doTask),null);assert.equal(h.count(),0)});
await test('fallback valid lease executes task and releases it afterward',async()=>{const h=harness();assert.equal(await h.fn(h.doTask),'performed');assert.equal(h.count(),1);assert.equal(h.values.has('cluster-sync-lease'),false)});
await test('lost fallback lease never steals it back during a heartbeat',async()=>{const h=harness();let finish;const task=()=>new Promise(resolve=>{finish=resolve});const pending=h.fn(task);await Promise.resolve();assert(h.getTick());h.store.setItem('cluster-sync-lease',JSON.stringify({owner:'other',expiresAt:Date.now()+300000}));h.getTick()();assert.equal(JSON.parse(h.values.get('cluster-sync-lease')).owner,'other');finish('done');await pending;assert.equal(JSON.parse(h.values.get('cluster-sync-lease')).owner,'other')});
await test('expired fallback lease cannot be blindly renewed from a paused tab',async()=>{const h=harness();let finish;const pending=h.fn(()=>new Promise(resolve=>{finish=resolve}));await Promise.resolve();h.store.setItem('cluster-sync-lease',JSON.stringify({owner:'local',expiresAt:Date.now()-1000}));h.getTick()();assert.equal(JSON.parse(h.values.get('cluster-sync-lease')).expiresAt<Date.now(),true);finish('done');await pending});
await test('queued replay checks current lease before uploads and edits',()=>{assert.match(runtime,/const leadershipSafe = \(\)/);assert.match(runtime,/if \(intent.flush && !leadershipSafe\(\)\)/);assert.match(runtime,/Sync leadership was lost/);assert.match(runtime,/Sync leadership changed before queued edits/)});
console.log(`G25 WS15 multi-tab lease tests ${count}/${count} passed`);
