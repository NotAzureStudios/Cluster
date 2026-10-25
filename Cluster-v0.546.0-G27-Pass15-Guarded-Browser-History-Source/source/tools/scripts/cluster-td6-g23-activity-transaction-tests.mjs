/** TD6 G23: executable transaction/outbox boundary checks for the production Activity service. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript')); } })();
const input = readFileSync(resolve(import.meta.dirname,'../../apps/server/src/domains/activity/activity-service.ts'),'utf8');
const compiled = ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const store = [], outbox = [], warnings=[];
let failOutbox=false,wakes=0,seq=0;
const prisma={
  $transaction:async(fn)=>{
    const beforeEvents=store.length,beforeOutbox=outbox.length;
    try {return await fn(prisma)} catch(error){store.length=beforeEvents;outbox.length=beforeOutbox;throw error}
  },
};
const createActivityRepository=(tx)=>({create:async(input)=>{
  const row={...input,id:'activity-'+(++seq),createdAt:new Date(),metadata:JSON.stringify(input.metadata||{})};
  store.push(row);return row;
},list:async()=>[],userSummaries:async()=>[]});
const imports={
  '@cluster/shared':{CLUSTER_DOMAIN_EVENTS:{activityRecorded:'activity-recorded'},CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE:'work_assignment',clusterResourceAddressFromEntity:({entityType,entityId})=>({kind:entityType,id:entityId})},
  '../../core/domain-events.js':{createClusterDomainEvent:(kind,info)=>({kind,info})},
  './activity-repository.js':{createActivityRepository},
  '../../core/cursor-pagination.js':{buildCursorPage:()=>({items:[],nextCursor:null})},
};
const mod={exports:{}};
vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:(id)=>{
 if(id in imports)return imports[id];throw Error('Unexpected '+id);
},Date,Array,String,Number,Map,Set,Promise,Object,Error},{filename:'activity-service.ts'});
const service=mod.exports.createActivityService({prisma,events:{
 appendInTransaction:async(tx,event)=>{if(failOutbox)throw Error('OUTBOX_FAILURE');outbox.push(event)},
 wake:()=>{wakes++},
},logger:{warn:(error,message)=>warnings.push({error,message})}});
const entry={userId:'u1',projectId:'p1',type:'comment',entityType:'project',entityId:'p1',title:'Comment posted',message:null,metadata:{commentId:'c1'}};
let passed=0;
async function check(name,run){await run();console.log('PASS',name);passed++}
await check('strict transactional activity persists both row and domain event',async()=>{
 const row=await prisma.$transaction(tx=>service.recordInTransaction(tx,entry));
 assert.equal(row.id,'activity-1');assert.equal(store.length,1);assert.equal(outbox.length,1);assert.equal(wakes,0);
 service.wakeCommittedActivity();assert.equal(wakes,1);
});
await check('outbox failure rejects strict activity without partial row or wake',async()=>{
 const before=store.length,prevWake=wakes;failOutbox=true;
 await assert.rejects(()=>prisma.$transaction(tx=>service.recordInTransaction(tx,entry)),/OUTBOX_FAILURE/);
 assert.equal(store.length,before);assert.equal(outbox.length,before);assert.equal(wakes,prevWake);
 failOutbox=false;
});
await check('regular activity records remain best-effort to preserve existing contracts',async()=>{
 failOutbox=true;const prevWake=wakes;
 const result=await service.record(entry);
 assert.equal(result,null);assert.equal(store.length,1);assert.equal(wakes,prevWake);assert.equal(warnings.length,1);
 failOutbox=false;
});
await check('successful ordinary activity wakes its event dispatcher after commit',async()=>{
 const saved=await service.record(entry);assert.ok(saved);assert.equal(store.length,2);assert.equal(outbox.length,2);assert.equal(wakes,2);
});
await check('failed strict writer does not mutate caller supplied message or metadata',async()=>{
 const original=JSON.stringify(entry);failOutbox=true;
 await assert.rejects(()=>prisma.$transaction(tx=>service.recordInTransaction(tx,entry)),/OUTBOX_FAILURE/);
 assert.equal(JSON.stringify(entry),original);failOutbox=false;
});
console.log(`TD6 G23 transactional Activity: ${passed}/${passed} passed`);
