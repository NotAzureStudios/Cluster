import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const filepath='apps/server/src/core/resource-change-runtime.ts';
const src=ts.transpileModule(fs.readFileSync(filepath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(src,{module:mod,exports:mod.exports,require:id=>{
 if(id==='@cluster/shared')return {CLUSTER_RESOURCE_CHANGE_WIRE_VERSION:1,clusterResourceChangeSchema:{safeParse:input=>({success:true,data:input})}};
 throw Error(`Unexpected import: ${id}`)
},Date,Promise,Math,Number,BigInt,JSON,Error,Array,Set,Map,String,Object,setTimeout,clearTimeout,setInterval,clearInterval,process},{filename:filepath});
const {ResourceChangeRuntime,resourceChangeSequenceIdentity}=mod.exports;
let passed=0;
async function check(name,fn){await fn();console.log(`PASS ${name}`);passed++}
function harness(){
 let latest=100n;let broken=false;let missing=false;
 const ids=new Map([[100n,'OLD-100']]);const resets=[];const changes=[];
 const db={domainEventOutbox:{
   aggregate:async()=>{if(broken)throw Error('database unavailable');return {_max:{sequence:latest}}},
   findUnique:async({where})=>{if(broken)throw Error('database unavailable');return !missing&&ids.has(where.sequence)?{id:ids.get(where.sequence)}:null},
   findMany:async({where,take})=>changes.filter(c=>c.sequence>where.sequence.gt).slice(0,take),
 }};
 const runtime=new ResourceChangeRuntime(db,{}, {cursorAuditMs:1000});
 runtime.subscribe(()=>{},reset=>resets.push(reset));
 const stop=()=>{runtime.draining=true;runtime.started=false;if(runtime.timer)clearTimeout(runtime.timer)};
 return {runtime,db,resets,ids,changes,setLatest:value=>{latest=value},setBroken:value=>{broken=value},setMissing:value=>{missing=value},stop};
}
await check('zero cursor identity needs no database lookup',async()=>{const h=harness();assert.equal(await resourceChangeSequenceIdentity(h.db,0n),null)});
await check('normal outbox growth retains stable continuity',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.setLatest(120n);h.ids.set(120n,'NEW-120');await h.runtime.reconcileRestoredCursor();assert.equal(h.resets.length,0);assert.equal(h.runtime.snapshot().cursor,'100');assert.equal(h.runtime.snapshot().cursorAnchorSequence,'100');h.stop();
});
await check('same high-water but replaced identity triggers reset',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.ids.set(100n,'REPLACED-100');await h.runtime.reconcileRestoredCursor();assert.equal(h.resets.length,1);assert.equal(h.resets[0].reason,'history_replaced');assert.equal(h.runtime.snapshot().historyReplacements,1);h.stop();
});
await check('rapidly regrown restored outbox past old sequence still triggers reset',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.ids.set(100n,'REPLACED-100');h.ids.set(155n,'NEW-155');h.setLatest(155n);await h.runtime.reconcileRestoredCursor();assert.equal(h.resets[0].reason,'history_replaced');assert.equal(h.resets[0].cursor,'155');assert.equal(h.runtime.snapshot().cursor,'155');assert.equal(h.runtime.snapshot().cursorAnchorSequence,'155');h.stop();
});
await check('pruned anchor fails safe with reset rather than assuming uninterrupted history',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.ids.delete(100n);await h.runtime.reconcileRestoredCursor();assert.equal(h.resets.at(-1)?.reason,'history_replaced');h.stop();
});
await check('ordinary low-water rewind keeps original reset reason',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.setLatest(50n);h.ids.set(50n,'NEW-50');await h.runtime.reconcileRestoredCursor();assert.equal(h.resets.at(-1)?.reason,'cursor_ahead');assert.equal(h.runtime.snapshot().cursor,'50');h.stop();
});
await check('failed anchor read never advances the audit delay or cursor',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.setBroken(true);await assert.rejects(h.runtime.reconcileRestoredCursor(),/database unavailable/);assert.equal(h.runtime.nextCursorAuditAt,0);assert.equal(h.runtime.snapshot().cursor,'100');h.stop();
});
await check('anchor validation after live cursor progress catches replacement of earlier committed row',async()=>{
 const h=harness();await h.runtime.initialize();h.runtime.started=true;h.runtime.cursor=125n;h.ids.set(125n,'NEW-125');h.setLatest(130n);await h.runtime.reconcileRestoredCursor();assert.equal(h.runtime.snapshot().cursorAnchorSequence,'125');h.ids.set(125n,'REPLACED-125');h.setLatest(180n);h.ids.set(180n,'NEW-180');h.runtime.nextCursorAuditAt=0;await h.runtime.reconcileRestoredCursor();assert.equal(h.resets.at(-1)?.cursor,'180');assert.equal(h.resets.at(-1)?.reason,'history_replaced');h.stop();
});
console.log(`${passed}/${passed} TD4 R53 anchored-continuity tests passed`);
