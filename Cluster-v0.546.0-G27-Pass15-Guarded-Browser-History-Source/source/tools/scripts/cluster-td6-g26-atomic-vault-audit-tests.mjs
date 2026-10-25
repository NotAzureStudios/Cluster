#!/usr/bin/env node
// Executes the actual Vault route handlers with a rollback-capable transactional
// store. Real PostgreSQL 18 advisory lock/concurrency certification is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const shape={parse(v){return v},strict(){return this},trim(){return this},min(){return this},max(){return this},
  int(){return this},positive(){return this},nullable(){return this},optional(){return this},default(){return this},datetime(){return this},extend(){return this}};
const z=Object.fromEntries(['object','string','number','enum','array'].map(n=>[n,()=>Object.create(shape)]));
const source=readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const loaded={exports:{}};
new Function('require','module','exports',js)(name=>{
 if(name==='node:crypto')return require('node:crypto');
 if(name==='zod')return {z};
 if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
 if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};
 if(name.endsWith('vault-reviewed-rotation.js'))return {registerVaultReviewedRotationRoutes:()=>{}};
 if(name.endsWith('crypto-service.js'))return {clusterSecretFingerprint:value=>`fingerprint:${value}`};
 if(name.endsWith('setting-crypto.js'))return {encryptSecuritySecret:(_,value)=>`sealed:${value}`,
   decryptSecuritySecret:(_,value)=>value.replace('sealed:',''),encryptionKeyConfigured:()=>true};
 throw Error(`Unexpected import ${name}`);
},loaded,loaded.exports);
let count=0;
async function test(label,fn){await fn();count++;console.log(`PASS G26 atomic Vault audit ${label}`)}
function harness({auditFailure=null,includeWriter=true}={}){
 const routes=new Map(),secrets=new Map(),events=[];
 let failure=auditFailure,boundSecret=null;
 function db(){return {
   studioVaultSecret:{
     create:async({data})=>{secrets.set(data.id,{revision:1,revokedAt:null,...structuredClone(data)});return structuredClone(secrets.get(data.id));},
     findUnique:async({where})=>secrets.has(where.id)?structuredClone(secrets.get(where.id)):null,
     updateMany:async({where,data})=>{const item=secrets.get(where.id);
       if(!item || item.revision!==where.revision || item.revokedAt!==null)return {count:0};
       for(const [k,v]of Object.entries(data)){item[k]=k==='revision'?item.revision+1:structuredClone(v)}
       return {count:1};}
   },
   studioInventoryKey:{findUnique:async({where})=>boundSecret===where.vaultSecretId?{id:'bound-key'}:null},
   $queryRaw:async(_parts,id)=>secrets.has(id)?[{id}]:[],
  }}
 const prisma={...db(),$transaction:async run=>{
   const before=structuredClone([...secrets.entries()]), savedAudit=structuredClone(events);
   try{return await run(db());}
   catch(e){secrets.clear();for(const [k,v] of before)secrets.set(k,v);events.splice(0,events.length,...savedAudit);throw e}
 }};
 const app={post:(p,fn)=>routes.set(`POST ${p}`,fn),patch:(p,fn)=>routes.set(`PATCH ${p}`,fn),get:(p,fn)=>routes.set(`GET ${p}`,fn)};
 const writer=includeWriter ? async (_tx,event)=>{
   events.push(structuredClone(event));
   if(failure===event.event)throw new Error('Audit database failure after write');
   if(failure==='ack-false')return {ok:false};
   return {ok:true};
 } : undefined;
 loaded.exports.registerStudioInventoryVaultRoutes({app,prisma,authorization:{requireAdmin:async()=>({id:'administrator'})},
   requireConfirmation:()=>true,logSecurityEvent:async()=>{},getCurrentUser:async()=>null,verifyUserPin:async()=>{},
   auditService:{recordSecurityInTransaction:writer}});
 async function call(method,url,body={},params={}){
   const reply={status:200,code(n){this.status=n;return this},header(){return this},send(v){return v}};
   const handler=routes.get(`${method} ${url}`);assert.ok(handler,`${method} ${url}`);
   const response=await handler({id:'request-1',body,params},reply);
   return {status:reply.status,response};
 }
 const create=()=>call('POST','/api/admin/vault/secrets',{name:'Studio API credential',kind:'integration',value:'private-string',expiresAt:null});
 const metadata=(id,rev=1)=>call('PATCH','/api/admin/vault/secrets/:id',{name:'Edited label',kind:'password',expiresAt:null,expectedRevision:rev},{id});
 const revoke=(id,rev=1)=>call('POST','/api/admin/vault/secrets/:id/revoke',{expectedRevision:rev},{id});
 return {create,metadata,revoke,secrets,events,setFailure:v=>failure=v,bind:id=>{boundSecret=id}};
}
await test('creating a Vault secret and its security audit commits together',async()=>{
 const h=harness(),out=await h.create();assert.equal(out.status,201);assert.equal(h.secrets.size,1);
 assert.equal(h.events.length,1);assert.equal(h.events[0].event,'vault.secret_created');
 assert.deepEqual(Object.keys(h.events[0].metadata),['secretId']);
 assert.ok(!JSON.stringify(h.events).includes('private-string'));
});
await test('failed creation audit rolls back encrypted credential',async()=>{
 const h=harness({auditFailure:'vault.secret_created'}),out=await h.create();
 assert.equal(out.status,503);assert.equal(out.response.code,'VAULT_AUDIT_UNAVAILABLE');
 assert.equal(h.secrets.size,0);assert.equal(h.events.length,0);
});
await test('missing transactional security writer blocks new credential',async()=>{
 const h=harness({includeWriter:false}),out=await h.create();
 assert.equal(out.status,503);assert.equal(h.secrets.size,0);
});
await test('audit result not confirmed blocks secret creation',async()=>{
 const h=harness({auditFailure:'ack-false'}),out=await h.create();
 assert.equal(out.status,503);assert.equal(h.events.length,0);
});
await test('metadata change writes an audit in the same transaction',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;
 const out=await h.metadata(id);assert.equal(out.status,200);
 assert.equal(h.secrets.get(id).name,'Edited label');assert.equal(h.secrets.get(id).revision,2);
 assert.deepEqual(h.events.map(x=>x.event),['vault.secret_created','vault.secret_metadata_updated']);
});
await test('failed metadata audit rolls back revision and fields',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;h.setFailure('vault.secret_metadata_updated');
 const out=await h.metadata(id);assert.equal(out.status,503);
 assert.equal(h.secrets.get(id).revision,1);assert.equal(h.secrets.get(id).name,'Studio API credential');
 assert.deepEqual(h.events.map(x=>x.event),['vault.secret_created']);
});
await test('stale metadata revision does not emit audit',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id,out=await h.metadata(id,404);
 assert.equal(out.status,409);assert.equal(h.events.length,1);
});
await test('pool-bound secret refuses standalone metadata changes',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;h.bind(id);
 assert.equal((await h.metadata(id)).response.code,'INVENTORY_KEYS_USE_POOL_LIFECYCLE');
 assert.equal(h.secrets.get(id).revision,1);assert.equal(h.events.length,1);
});
await test('revocation and its audit commit together',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;
 assert.equal((await h.revoke(id)).response.ok,true);
 assert.ok(h.secrets.get(id).revokedAt instanceof Date);
 assert.deepEqual(h.events.map(x=>x.event),['vault.secret_created','vault.secret_revoked']);
});
await test('revocation audit failure leaves credential unrevoked',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;h.setFailure('vault.secret_revoked');
 const out=await h.revoke(id);assert.equal(out.status,503);
 assert.equal(h.secrets.get(id).revokedAt,null);assert.equal(h.secrets.get(id).revision,1);
 assert.equal(h.events.length,1);
});
await test('pool-bound secrets cannot use standalone revocation',async()=>{
 const h=harness(),id=(await h.create()).response.secret.id;h.bind(id);
 const out=await h.revoke(id);assert.equal(out.status,409);assert.equal(h.events.length,1);
});
await test('audit transaction implementation is wired through production service',()=>{
 const audit=readFileSync('apps/server/src/domains/audit/audit-service.ts','utf8');
 const reviewed=readFileSync('apps/server/src/domains/inventory/vault-reviewed-rotation.ts','utf8');
 assert.match(audit,/appendSecurityAuditEvent\(tx, input\)/);
 assert.match(reviewed,/auditTransition\(tx, request, actor, "vault.rotation_completed"/);
 assert.doesNotMatch(reviewed,/await audit\(request, actor/);
});
// Verify the real audit-service adapter uses the caller's transaction rather
// than silently opening a second commit boundary around the audit chain.
function auditServiceHarness({breakStore=false,breakLogger=false}={}) {
 const path='apps/server/src/domains/audit/audit-service.ts';
 const js=ts.transpileModule(readFileSync(path,'utf8'),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
 }).outputText;
 const loaded={exports:{}};
 let nestedTx=0,appended=0;
 new Function('require','module','exports',js)(name=>{
   if(name==='node:crypto')return require('node:crypto');
   if(name.endsWith('audit-repository.js'))return {createAuditRepository:()=>({createSecurity:async()=>{}})};
   if(name.endsWith('cursor-pagination.js'))return {buildCursorPage:()=>({})};
   if(name.endsWith('security-audit-integrity.js'))return {stableAuditJson:()=>'',verifySecurityAuditChain:()=>({})};
   if(name.endsWith('security-audit-store.js'))return {appendSecurityAuditEvent:async(tx,input)=>{
     assert.equal(tx.marker,'caller-owned');assert.equal(input.event,'vault.rotation_completed');
     appended++;if(breakStore)throw Error('DB write failed');
   }};
   throw Error(`Unexpected audit import ${name}`);
 },loaded,loaded.exports);
 const service=loaded.exports.createAuditService({prisma:{$transaction:async()=>{nestedTx++;}},
   logger:{error:()=>{if(breakLogger)throw Error('logging failed')}}});
 return {service,tx:{marker:'caller-owned'},counts:()=>({nestedTx,appended})};
}
await test('audit adapter appends into caller-owned transaction without nesting',async()=>{
 const h=auditServiceHarness();assert.deepEqual(await h.service.recordSecurityInTransaction(h.tx,{event:'vault.rotation_completed'}),{ok:true});
 assert.deepEqual(h.counts(),{nestedTx:0,appended:1});
});
await test('audit adapter propagates storage failure to rollback caller',async()=>{
 const h=auditServiceHarness({breakStore:true});
 await assert.rejects(h.service.recordSecurityInTransaction(h.tx,{event:'vault.rotation_completed'}));
 assert.deepEqual(h.counts(),{nestedTx:0,appended:1});
});
await test('secondary logger failure cannot change audit failure into success',async()=>{
 const h=auditServiceHarness({breakStore:true,breakLogger:true});
 await assert.rejects(h.service.recordSecurityInTransaction(h.tx,{event:'vault.rotation_completed'}));
});
console.log(`G26 atomic Vault audit + adapter: ${count}/${count} passed`);
