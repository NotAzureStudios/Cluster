#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSyncControlRepository } from '../../apps/server/src/domains/sync/sync-control-repository.ts';
let record={id:'c1',userId:'owner',status:'OPEN',allowedActions:JSON.stringify(['merge','discard']),classification:'REVISION_DIVERGED',deviceId:'d1',mutationId:'m1',idempotencyKey:'i1',createdAt:new Date(),resolvedAt:null};
const store={
 findFirst:async({where})=>record?.id===where.id&&record.userId===where.userId?{...record}:null,
 updateMany:async({where,data})=>{
  if(record.id===where.id&&record.userId===where.userId&&where.status.in.includes(record.status)){
   record={...record,...data};return {count:1};
  }
  return {count:0};
 }
};
const service=createSyncControlRepository({clusterSyncConflict:store});
let passed=0;
async function test(title,fn){await fn();console.log('PASS',title);passed++;}
await test('unauthorized user cannot resolve or inspect another account conflict',async()=>assert.equal(await service.resolveConflict({id:'c1',userId:'intruder',action:'merge'}),null));
await test('ungranted action rejected and OPEN record retained',async()=>{const r=await service.resolveConflict({id:'c1',userId:'owner',action:'keep_mine'});assert.equal(r.allowed,false);assert.equal(record.status,'OPEN');});
await test('first authorized action atomically transitions OPEN to RESOLVED',async()=>{const r=await service.resolveConflict({id:'c1',userId:'owner',action:'merge'});assert.equal(r.allowed,true);assert.equal(record.status,'RESOLVED');assert.equal(record.resolution,'merge');});
await test('stale second tab cannot overwrite the prior resolution',async()=>{const r=await service.resolveConflict({id:'c1',userId:'owner',action:'discard'});assert.equal(r.allowed,false);assert.equal(record.resolution,'merge');});
await test('QUARANTINED record can resolve only once',async()=>{record={...record,status:'QUARANTINED',resolution:null};const r=await service.resolveConflict({id:'c1',userId:'owner',action:'discard'});assert.equal(r.allowed,true);const repeat=await service.resolveConflict({id:'c1',userId:'owner',action:'discard'});assert.equal(repeat.allowed,false);});
await test('race between read and update fails closed',async()=>{
 record={...record,status:'OPEN',resolution:null};
 const original=store.updateMany;
 store.updateMany=async(...a)=>{record={...record,status:'RESOLVED',resolution:'discard'};return original(...a);};
 const r=await service.resolveConflict({id:'c1',userId:'owner',action:'merge'});
 assert.equal(r.allowed,false);assert.equal(record.resolution,'discard');store.updateMany=original;
});
console.log(`G25 WS13 conflict CAS: ${passed}/${passed} passed`);
