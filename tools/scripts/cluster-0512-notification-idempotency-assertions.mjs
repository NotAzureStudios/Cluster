import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const src=ts.transpileModule(fs.readFileSync('apps/server/src/domains/notifications/notification-repository.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(src,{module,exports:module.exports,require:(name)=>name==='../../core/cursor-pagination.js'?{cursorWhere:()=>null}:require(name),Date,Set,Map,Number,String,JSON},{filename:'notification-repository.ts'});
const createNotificationRepository=module.exports.createNotificationRepository;
const persisted=new Map();
let writes=0;
let checks=0;
const test=async(label,fn)=>{await fn();console.log('PASS',label);checks++;};
const prisma={
 user:{findMany:async(input)=>input.where.id.in.filter(id=>!['disabled','suspended'].includes(id)).map(id=>({id}))},
 notificationInboxItem:{
  create:async({data})=>{
   // Mimic PostgreSQL unique-index behavior under simultaneous calls.
   const key=`${data.userId}:${data.activityEventId}`;
   if(persisted.has(key))throw Object.assign(new Error('Unique constraint'),{code:'P2002'});
   const value={id:`notification-${++writes}`,...data};persisted.set(key,value);return value;
  },
 }
};
const repo=createNotificationRepository(prisma);
const input={activityEventId:'event-1',title:'Build failed',category:'system',priority:'critical',entityType:'build',createdAt:new Date(),metadata:{notificationSignal:'failure'}};
await test('First delivery creates one record',async()=>{const result=await repo.deliver(input,['u1']);assert.equal(result.count,1);assert.equal(result.records[0].userId,'u1');});
await test('Repeated delivery is not considered newly delivered',async()=>{const result=await repo.deliver({...input,title:'Updated wrong!'},['u1']);assert.equal(result.count,0);assert.equal(result.records.length,0);assert.equal(persisted.get('u1:event-1').title,'Build failed');});
await test('Multiple recipient delivery is per-user unique',async()=>{const result=await repo.deliver(input,['u1','u2','u3','u2']);assert.equal(result.count,2);assert.equal(persisted.size,3);});
await test('Account filtering prevents disabled recipients',async()=>{const result=await repo.deliver(input,['disabled','suspended']);assert.equal(result.count,0);});
await test('Concurrent retries are idempotent',async()=>{const [a,b,c]=await Promise.all([repo.deliver({...input,activityEventId:'event-2'},['u1']),repo.deliver({...input,activityEventId:'event-2'},['u1']),repo.deliver({...input,activityEventId:'event-2'},['u1'])]);assert.equal(a.count+b.count+c.count,1);});
await test('Missing stable event ID fails closed',async()=>{await assert.rejects(()=>repo.deliver({title:'invalid'},['u1']),/ACTIVITY_ID_REQUIRED/);});
await test('Repository preserves existing read state on replay',async()=>{const row=persisted.get('u1:event-1');row.readAt=new Date();await repo.deliver(input,['u1']);assert.equal(persisted.get('u1:event-1').readAt,row.readAt);});
await test('Unrelated database failures are not swallowed',async()=>{const failing=createNotificationRepository({user:prisma.user,notificationInboxItem:{create:async()=>{throw Object.assign(new Error('DB offline'),{code:'P1001'})}}});await assert.rejects(()=>failing.deliver({...input,activityEventId:'event-3'},['u1']),/DB offline/);});
await test('Service live and Discord notifications only fire for fresh materializations',async()=>{const service=fs.readFileSync('apps/server/src/domains/notifications/notification-service.ts','utf8');assert.match(service,/if \(!options\.historical\) for \(const record of result\.records/);assert.match(service,/await publishLive\(record\)/);assert.match(service,/externalDeliveryHandler\(record\)/);});
console.log(`${checks}/${checks} notification idempotency assertions passed`);
