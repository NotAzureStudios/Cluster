#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(p,'utf8');
const source='apps/server/src/domains/inventory/inventory-credential-expiry-lifecycle.ts';
const js=ts.transpileModule(read(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,Date,Set,Error,Promise,console},{filename:source});
const {inventoryExpiryStage,runInventoryCredentialExpiryTick}=module.exports;
const now=new Date('2026-11-08T12:00:00.000Z'), day=86400000;
const deadline=n=>new Date(now.getTime()+n*day);
let checked=0;
async function test(label,fn){await fn();checked++;console.log(`PASS G26 Batch G ${label}`)}
for(const [delta,stage] of [[-2,'expired'],[0,'expired'],[0.3,'one_day'],[1,'one_day'],[1.01,'seven_days'],[7,'seven_days'],[8,null]])
  await test(`deadline classification ${delta}d`,()=>assert.equal(inventoryExpiryStage(deadline(delta),now),stage));
await test('invalid timestamp does not trigger',()=>assert.equal(inventoryExpiryStage('bad',now),null));
const person={archived:false,accountState:'ACTIVE',accessExpiresAt:deadline(30)};
function fixture() {
  const seats=new Map([['seat1',{id:'seat1',userId:'person1',status:'active',expiresAt:deadline(6),asset:{kind:'license',status:'active'}}]]);
  const keys=new Map([['key1',{id:'key1',userId:'person1',status:'assigned',expiresAt:deadline(0.5),pool:{status:'active'},secret:{revokedAt:null}}]]);
  const vault=new Map([['vault1',{id:'vault1',expiresAt:deadline(-1),revokedAt:null}]]);
  const users=new Map([['person1',{...person}]]);
  const notified=new Set();const messages=[];const admins=[{userId:'admin1'},{userId:'admin2'}];
  let failMessage=false, mutateBeforeTx=()=>{}, missingAdmins=false, overflow=false;
  const views={studioInventoryAllocation:seats,studioInventoryKey:keys,studioVaultSecret:vault};
  const db={
    studioInventoryAllocation:{findMany:async ({take})=> overflow? Array.from({length:take},()=>({id:'overflow'})): [...seats.values()].filter(r=>r.status==='active' && r.expiresAt<=deadline(7) && r.asset.status==='active').slice(0,take)},
    studioInventoryKey:{findMany:async ({take})=> [...keys.values()].filter(r=>r.status==='assigned' && r.pool.status==='active' && !r.secret.revokedAt && r.expiresAt<=deadline(7)).slice(0,take)},
    studioVaultSecret:{findMany:async ({take})=> [...vault.values()].filter(r=>!r.revokedAt && r.expiresAt<=deadline(7)).slice(0,take)},
    workspaceMember:{findMany:async()=>missingAdmins?[]:admins},
    $transaction:async fn=>{
      mutateBeforeTx();
      const local=[];const memo=new Set();
      const tx={
        $queryRaw:async(parts,id)=>[...seats.keys(),...keys.keys(),...vault.keys()].includes(id)?[{id}]:[],
        studioInventoryAllocation:{findUnique:async({where})=>seats.get(where.id)},
        studioInventoryKey:{findUnique:async({where})=>keys.get(where.id)},
        studioVaultSecret:{findUnique:async({where})=>vault.get(where.id)},
        user:{findUnique:async({where})=>users.get(where.id)},
        studioInventoryExpiryNotice:{createMany:async({data})=>{let count=0;for(const d of data){const key=[d.subjectKind,d.subjectId,d.expiresAt.toISOString(),d.stage].join(':');if(!notified.has(key)){memo.add(key);count++;}}return {count}}},
        notificationInboxItem:{createMany:async({data})=>{if(failMessage)throw Error('inbox unavailable');local.push(...data);return {count:data.length}}},
      };
      const result=await fn(tx);
      for(const key of memo)notified.add(key);
      messages.push(...local);
      return result;
    },
  };
  return {db,seats,keys,vault,users,notified,messages,admins,
    setFail(v){failMessage=v},setMutation(fn){mutateBeforeTx=fn},setAdminsMissing(v){missingAdmins=v},setOverflow(v){overflow=v}};
}
await test('delivers 3 independent credential deadlines to 2 admins atomically',async()=>{
  const f=fixture();let signals=0;const result=await runInventoryCredentialExpiryTick({prisma:f.db,now,onCommitted:ids=>{assert.equal(ids.length,2);signals++}});
  assert.equal(result.committed,3);assert.equal(f.messages.length,6);assert.equal(f.notified.size,3);assert.equal(signals,3);
  assert.equal(result.containsSecrets,false);
  for(const m of f.messages){assert.equal(m.entityType,'security');assert.equal(m.signal,'inventory_credential_expiration');
    assert.equal(m.requiresAction,true);assert.ok(!m.entityId);assert.ok(!m.resourceId);
    assert.doesNotMatch(JSON.stringify(m),/vault1|key1|seat1|ciphertext|encryptedValue|fingerprint|licenseKey/);}
});
await test('a second run does not redeliver the same stage',async()=>{
  const f=fixture();await runInventoryCredentialExpiryTick({prisma:f.db,now});const again=await runInventoryCredentialExpiryTick({prisma:f.db,now});
  assert.equal(again.committed,0);assert.equal(f.messages.length,6);
});
await test('advancing from seven-day to one-day to expired emits one notice per stage',async()=>{
  const f=fixture();const day1=deadline(5.5),expired=deadline(8);
  await runInventoryCredentialExpiryTick({prisma:f.db,now});
  const n1=await runInventoryCredentialExpiryTick({prisma:f.db,now:day1});assert.equal(n1.committed,2);
  const n2=await runInventoryCredentialExpiryTick({prisma:f.db,now:expired});assert.equal(n2.committed,1);
  assert.equal(f.notified.size,6);
});
await test('renewing a credential creates a new deadline window without losing history',async()=>{
  const f=fixture();await runInventoryCredentialExpiryTick({prisma:f.db,now});
  f.seats.get('seat1').expiresAt=deadline(4);
  const updated=await runInventoryCredentialExpiryTick({prisma:f.db,now});
  assert.equal(updated.committed,1);assert.equal(f.notified.size,4);
});
await test('revoking the Vault secret between read and transaction prevents notice',async()=>{
  const f=fixture();f.setMutation(()=>{f.vault.get('vault1').revokedAt=now;});
  const result=await runInventoryCredentialExpiryTick({prisma:f.db,now});
  assert.equal(result.committed,2);assert.equal(f.notified.size,2);
});
await test('closing a key pool between scan and commit prevents notice',async()=>{
  const f=fixture();f.setMutation(()=>{f.keys.get('key1').pool.status='closed'});
  const result=await runInventoryCredentialExpiryTick({prisma:f.db,now});assert.equal(result.committed,2);
});
await test('changing the lease deadline after scan prevents stale delivery',async()=>{
  const f=fixture();f.setMutation(()=>{f.seats.get('seat1').expiresAt=deadline(30)});
  const result=await runInventoryCredentialExpiryTick({prisma:f.db,now});assert.equal(result.committed,2);
});
await test('inactive offboarded recipients do not generate license custody reminders',async()=>{
  const f=fixture();f.users.get('person1').archived=true;
  const result=await runInventoryCredentialExpiryTick({prisma:f.db,now});assert.equal(result.committed,1);
});
await test('database write failures roll back notification and deduplication evidence',async()=>{
  const f=fixture();f.setFail(true);
  await assert.rejects(runInventoryCredentialExpiryTick({prisma:f.db,now}),/inbox unavailable/);
  assert.equal(f.notified.size,0);assert.equal(f.messages.length,0);
  f.setFail(false);const result=await runInventoryCredentialExpiryTick({prisma:f.db,now});assert.equal(result.committed,3);
});
await test('no active admin fails before writing any record',async()=>{
  const f=fixture();f.setAdminsMissing(true);
  await assert.rejects(runInventoryCredentialExpiryTick({prisma:f.db,now}),/NO_ADMIN/);
  assert.equal(f.notified.size,0);
});
await test('incomplete scan fails rather than pretending all credentials were checked',async()=>{
  const f=fixture();f.setOverflow(true);
  await assert.rejects(runInventoryCredentialExpiryTick({prisma:f.db,now,limitPerKind:2}),/SCAN_INCOMPLETE/);
  assert.equal(f.notified.size,0);
});
await test('notice schema enforces unique deadline-stage evidence',()=>{
  const schema=read('apps/server/prisma/schema.prisma');
  assert.match(schema,/model StudioInventoryExpiryNotice[\s\S]*@@unique\(\[subjectKind, subjectId, expiresAt, stage\]\)/);
  const sql=read('apps/server/prisma/migrations/20261102000000_td6_g26_inventory_credential_expiry_notices/migration.sql');
  assert.match(sql,/CREATE UNIQUE INDEX/);
});
await test('worker registration, daily durable producer and visibility guard are wired',()=>{
  const jobs=read('apps/server/src/app/server-job-runtime.ts');
  assert.match(jobs,/register\("studio\.inventory-credential-expiry"/);
  assert.match(jobs,/scheduleAdaptive\("studio-inventory-credential-expiry-enqueue", 24 \* 60 \* 60 \* 1000/);
  const visibility=read('apps/server/src/domains/notifications/notification-visibility.ts');
  assert.match(visibility,/item\?\.signal === "inventory_credential_expiration"\) return false/);
});
console.log(`G26 Batch G credential lifecycle: ${checked}/${checked} passed`);
