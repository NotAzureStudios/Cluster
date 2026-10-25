#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const f = () => new Proxy({ parse: x=>x, strict(){return this}, default(){return this}, min(){return this}, max(){return this} },
  { get:(o,k)=>k in o?o[k]:()=>f() });
const z = { object:f, string:f, number:f, enum:f };
function load() {
 const path='apps/server/src/domains/inventory/vault-reviewed-rotation.ts';
 const js=ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS} }).outputText;
 const module={exports:{}};
 new Function('require','module','exports',js)(name=>{
  if(name==='node:crypto')return {randomUUID:()=>`review-${++uid}`};
  if(name==='zod')return {z};
  if(name.endsWith('crypto-service.js'))return {clusterSecretFingerprint:(v)=>`fingerprint:${v}`};
  if(name.endsWith('setting-crypto.js'))return {encryptSecuritySecret:(_,v)=>`sealed:${v}`, encryptionKeyConfigured:()=>true};
  throw Error(`Unexpected import ${name}`);
 }, module, module.exports);
 return module.exports;
}
let uid=0,checks=0;
const { vaultRotationDecision, registerVaultReviewedRotationRoutes } = load();
async function test(label,fn){await fn();checks++;console.log('PASS G26 reviewed Vault',label)}
function harness({auditFailure=null}={}){
 const routes=new Map(), audit=[];
 let injectedAuditFailure=auditFailure;
 const secret={id:'s1',revision:1,revokedAt:null,fingerprint:'fingerprint:old',encryptedValue:'sealed:old'};
 const reviews=[];
 const tx={
  $queryRaw:async(strings,...values)=>{const table=String(strings[0]).includes('StudioVaultSecret')?'secret':'review';return table==='secret'?(values[0]===secret.id?[{id:secret.id}]:[]):(reviews.some(r=>r.id===values[0])?[{id:values[0]}]:[])},
  studioVaultSecret:{ findUnique:async({where})=>where.id===secret.id?{...secret}:null,updateMany:async({where,data})=>{
   if(where.id!==secret.id||where.revision!==secret.revision||secret.revokedAt!==null)return {count:0};
   Object.assign(secret,{fingerprint:data.fingerprint,encryptedValue:data.encryptedValue,revision:secret.revision+1});return {count:1};
  } },
  studioInventoryKey:{ findUnique:async()=>null },
  studioVaultRotationReview:{
    findMany:async({where={},take})=>reviews.filter(r=>(!where.secretId||r.secretId===where.secretId)&&
      (!where.status || (typeof where.status==='string'?r.status===where.status:where.status.in.includes(r.status)))&&
      (!where.expiresAt||r.expiresAt>where.expiresAt.gt)).slice(0,take),
    findUnique:async({where})=>reviews.find(r=>r.id===where.id)||null,
    create:async({data})=>{const r={requestedAt:new Date(),reviewedAt:null,completedAt:null,reviewedById:null,reviewReason:null,externalNote:null,externalStatus:null,...data};reviews.push(r);return {...r}},
    updateMany:async({where,data})=>{const r=reviews.find(r=>r.id===where.id&&r.status===where.status);if(!r)return {count:0};Object.assign(r,data);return {count:1}},
    update:async({where,data})=>{const r=reviews.find(r=>r.id===where.id);Object.assign(r,data);return {...r}}
  }
 };
 const db={...tx,$transaction:async(fn)=>{
   const snapshot={secret:structuredClone(secret),reviews:structuredClone(reviews),audit:structuredClone(audit)};
   try { return await fn(tx); }
   catch(error){Object.assign(secret,snapshot.secret);reviews.splice(0,reviews.length,...snapshot.reviews);
     audit.splice(0,audit.length,...snapshot.audit);throw error;}
 },studioVaultRotationReview:tx.studioVaultRotationReview};
 const app={post:(path,handler)=>routes.set('POST '+path,handler),get:(path,handler)=>routes.set('GET '+path,handler)};
 registerVaultReviewedRotationRoutes({app,prisma:db,admin:async(req)=>({id:req.actor}),requireConfirmation:()=>true,
  recordSecurityInTransaction:async(_tx,event)=>{
   if(injectedAuditFailure===event.event) throw new Error('Injected transactional audit database failure');
   if(injectedAuditFailure==='ack-false') return {ok:false};
   audit.push({actor:event.actorUserId,event:event.event,id:event.metadata.reviewId,metadata:event.metadata});
   return {ok:true};
  }});
 async function call(path,{actor='A',body={},params={id:'s1'},query={}}={}){
  const reply={status:200,code(v){this.status=v;return this},header(){return this},send(v){return v}};
  const fn=routes.get(path);assert.ok(fn,`missing ${path}`);
  const response=await fn({actor,body,params,query},reply);return {status:reply.status,response};
 }
 const request=(actor='A')=>call('POST /api/admin/vault/secrets/:id/rotation-requests',{actor,body:{expectedRevision:secret.revision,reason:'Expected integration credential change'}});
 const decide=(id,actor='B',decision='approve')=>call('POST /api/admin/vault/rotation-reviews/:id/decision',{actor,params:{id},body:{decision,reason:'Independently reviewed'}});
 const commit=(id,actor='A',value='new')=>call('POST /api/admin/vault/rotation-reviews/:id/commit',{actor,params:{id},body:{value,expectedRevision:1,externalStatus:'pending_external_update',externalNote:'External provider update still pending'}});
 return {request,decide,commit,call,secret,reviews,audit,setAuditFailure:(value)=>{injectedAuditFailure=value;}};
}
await test('unauthorized states and self-review are not permitted',()=>{
 const base={status:'pending',requesterId:'A',actorId:'A',expectedRevision:1,currentRevision:1,revokedAt:null,expiresAt:new Date(Date.now()+10000),now:new Date()};
 assert.equal(vaultRotationDecision(base,'review'),'INDEPENDENT_REVIEW_REQUIRED');
 assert.equal(vaultRotationDecision({...base,actorId:'B'},'review'),null);
 assert.equal(vaultRotationDecision({...base,status:'approved',actorId:'B'},'commit'),'ROTATION_REQUESTER_REQUIRED');
 assert.equal(vaultRotationDecision({...base,status:'approved'},'commit'),null);
 assert.equal(vaultRotationDecision({...base,currentRevision:2},'review'),'VAULT_ROTATION_STALE');
 assert.equal(vaultRotationDecision({...base,revokedAt:new Date()},'commit'),'VAULT_ROTATION_STALE');
 assert.equal(vaultRotationDecision({...base,expiresAt:new Date(0)},'review'),'VAULT_ROTATION_EXPIRED');
});
await test('pending review records only reasons and actor metadata, never replacement value',async()=>{
 const h=harness(),r=await h.request();assert.equal(r.status,201);assert.equal(r.response.review.status,'pending');
 assert.ok(!Object.keys(h.reviews[0]).some(k=>/ciphertext|plaintext|encryptedValue|value/i.test(k)));
 const pending=await h.call('GET /api/admin/vault/rotation-reviews');assert.equal(pending.response.containsSecrets,false);
 const duplicate=await h.request();assert.equal(duplicate.response.code,'VAULT_ROTATION_ALREADY_OPEN');
});
await test('requester cannot approve own rotation; second admin can',async()=>{
 const h=harness(),r=await h.request(),id=r.response.review.id;
 assert.equal((await h.decide(id,'A')).response.code,'INDEPENDENT_REVIEW_REQUIRED');
 assert.equal((await h.decide(id,'B')).response.review.status,'approved');
 assert.equal((await h.decide(id,'C')).response.code,'VAULT_REVIEW_ALREADY_RESOLVED');
});
await test('requester may commit once after review, with no plaintext in review record',async()=>{
 const h=harness(),r=await h.request(),id=r.response.review.id;
 await h.decide(id,'B');
 assert.equal((await h.commit(id,'B')).response.code,'ROTATION_REQUESTER_REQUIRED');
 assert.equal((await h.commit(id,'A','old')).response.code,'VAULT_REPLACEMENT_UNCHANGED');
 const success=await h.commit(id,'A');assert.equal(success.response.status,'completed');
 assert.equal(success.response.externalProviderIndependentlyVerified,false);
 assert.equal(h.secret.encryptedValue,'sealed:new');assert.equal(h.secret.revision,2);
 assert.equal(h.reviews[0].status,'completed');assert.equal(h.reviews[0].externalStatus,'pending_external_update');
 assert.equal((await h.commit(id,'A','another')).response.code,'VAULT_ROTATION_STALE');
 assert.ok(!JSON.stringify(h.reviews[0]).includes('sealed:new'));
});
await test('rejection, revoked records, expiry and stale revisions fail closed',async()=>{
 const a=harness(),id=(await a.request()).response.review.id;
 await a.decide(id,'B','reject');assert.equal((await a.commit(id)).response.code,'VAULT_ROTATION_NOT_APPROVED');
 const b=harness(),id2=(await b.request()).response.review.id;b.secret.revision++;
 assert.equal((await b.decide(id2)).response.code,'VAULT_ROTATION_STALE');
 const c=harness(),id3=(await c.request()).response.review.id;c.secret.revokedAt=new Date();
 assert.equal((await c.decide(id3)).response.code,'VAULT_ROTATION_STALE');
 const d=harness(),id4=(await d.request()).response.review.id;d.reviews[0].expiresAt=new Date(0);
 assert.equal((await d.decide(id4)).response.code,'VAULT_ROTATION_EXPIRED');
});
await test('request audit failure rolls back review creation and allows retry',async()=>{
 const h=harness({auditFailure:'vault.rotation_requested'});const r=await h.request();
 assert.equal(r.status,503);assert.equal(r.response.code,'VAULT_AUDIT_UNAVAILABLE');
 assert.equal(h.reviews.length,0);assert.equal(h.audit.length,0);
});
await test('decision audit failure rolls back independent approval',async()=>{
 const h=harness();const id=(await h.request()).response.review.id;
 // Reconfigure the transaction writer to throw for the decision only.
 h.setAuditFailure('vault.rotation_approved');
 const r=await h.decide(id,'B');
 assert.equal(r.status,503);assert.equal(h.reviews[0].status,'pending');
 assert.deepEqual(h.audit.map(e=>e.event),['vault.rotation_requested']);
});
await test('replacement audit failure rolls back ciphertext and review completion',async()=>{
 const h=harness();const id=(await h.request()).response.review.id;
 await h.decide(id,'B');h.setAuditFailure('vault.rotation_completed');
 const r=await h.commit(id);assert.equal(r.status,503);
 assert.equal(r.response.code,'VAULT_AUDIT_UNAVAILABLE');
 assert.equal(h.secret.revision,1);assert.equal(h.secret.encryptedValue,'sealed:old');
 assert.equal(h.reviews[0].status,'approved');assert.equal(h.reviews[0].completedAt,null);
 assert.ok(!JSON.stringify(h.audit).includes('sealed:'));
});
await test('missing confirmation from transactional audit writer also aborts commit',async()=>{
 const h=harness({auditFailure:'ack-false'});const r=await h.request();
 assert.equal(r.status,503);assert.equal(h.reviews.length,0);
});
await test('successful review sequence commits three scrubbed audit events',async()=>{
 const h=harness();const id=(await h.request()).response.review.id;
 await h.decide(id,'B');await h.commit(id);
 assert.deepEqual(h.audit.map(e=>e.event),['vault.rotation_requested','vault.rotation_approved','vault.rotation_completed']);
 assert.ok(!JSON.stringify(h.audit).includes('sealed:new'));
});
await test('old one-step route refuses mutations and review path is wired',()=>{
 const code=readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
 assert.match(code,/"VAULT_INDEPENDENT_REVIEW_REQUIRED"/);assert.match(code,/registerVaultReviewedRotationRoutes/);
 assert.doesNotMatch(code,/secretUpdate\.parse/);
});
await test('Prisma migration and UI require independent rotation',()=>{
 const schema=readFileSync('apps/server/prisma/schema.prisma','utf8');
 const sql=readFileSync('apps/server/prisma/migrations/20261103000000_td6_g26_reviewed_vault_rotation/migration.sql','utf8');
 const ui=readFileSync('packages/renderer/src/features/inventory/VaultManager.tsx','utf8');
 assert.match(schema,/model StudioVaultRotationReview/);assert.match(sql,/CREATE TABLE "StudioVaultRotationReview"/);
 for(const s of ['rotation-requests','rotation-reviews','Independent rotation review','Commit reviewed replacement'])assert.ok(ui.includes(s),s);
});
console.log(`G26 reviewed Vault rotation: ${checks}/${checks} passed`);
