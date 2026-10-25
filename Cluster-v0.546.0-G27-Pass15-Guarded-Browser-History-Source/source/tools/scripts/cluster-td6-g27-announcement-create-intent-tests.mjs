#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
function load(file,imports={}) {
  const compiled=ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('module','exports','require',compiled)(module,module.exports, name=>{
    if(name in imports)return imports[name];
    throw Error(`unexpected import ${name}`);
  });
  return module.exports;
}
const intents=load('apps/server/src/domains/studio-systems/studio-announcement-create-intents.ts',{'node:crypto':require('node:crypto')});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name)}
const data={title:'Studio briefing',body:'Schedule update',audience:{mode:'all',targets:[]},priority:'normal',requiresAcknowledgement:false,discordDeliveryRequested:false,scheduledAt:null};
await check('digest stable across equivalent validated intent',()=>assert.equal(intents.announcementCreateDigest(data),intents.announcementCreateDigest({...data})));
await check('digest binds content and publication schedule',()=>{assert.notEqual(intents.announcementCreateDigest(data),intents.announcementCreateDigest({...data,body:'revised'}));assert.notEqual(intents.announcementCreateDigest(data),intents.announcementCreateDigest({...data,scheduledAt:new Date('2026-10-25T20:00:00Z')}))});
const parser={parse:value=>value};
const chain={uuid(){return this},min(){return this},max(){return this},trim(){return this},int(){return this},optional(){return this},default(){return this},parse:value=>value};
const z={object:()=>chain,string:()=>chain,coerce:{number:()=>chain}};
const shared={studioAnnouncementCreateSchema:parser};
const cursor={buildCursorPage:()=>({items:[],nextCursor:null,hasMore:false}),decodeCursor:()=>null,cursorWhere:()=>null};
const app={post:new Map(),get:new Map(),put:new Map(),patch:new Map(),delete:new Map()};
for(const method of ['post','get','put','patch','delete'])app[method+'Register']=(path,fn)=>app[method].set(path,fn);
const registry={post:(...a)=>app.postRegister(...a),get:(...a)=>app.getRegister(...a),put:(...a)=>app.putRegister(...a),patch:(...a)=>app.patchRegister(...a),delete:(...a)=>app.deleteRegister(...a)};
let allowed=true,userId='owner',next=0,failCreate=false,records=[],simulateConcurrent=false;
const prisma={studioAnnouncement:{
 findFirst:async({where})=>records.find(r=>r.createdById===where.createdById&&r.createIntentId===where.createIntentId)||null,
 create:async({data})=>{
  if(failCreate) throw Error('storage offline');
  const conflict=records.find(r=>r.createdById===data.createdById && data.createIntentId && r.createIntentId===data.createIntentId);
  if(conflict)throw Object.assign(new Error('Unique constraint'),{code:'P2002'});
  const created={id:`a${++next}`,revision:1,createdAt:new Date(),...data};records.push(created);
  if(simulateConcurrent) { simulateConcurrent=false;throw Object.assign(new Error('Concurrent insert committed'),{code:'P2002'}); }
  return created;
 },
}};
const imports={
 '@cluster/shared':shared,'zod':{z},'../../core/cursor-pagination.js':cursor,
 '../access/studio-audience.js':{parseStudioAudience:(raw)=>JSON.parse(raw)},
 './studio-form-runtime.js':{},'./studio-onboarding-runtime.js':{},'../workforce/workforce-normalization.js':{},
 './studio-announcement-delivery.js':{createStudioAnnouncementDelivery:()=>({})},
 './studio-application-revisions.js':{},'../../core/security-audit-store.js':{},'./studio-application-profile.js':{},
 './studio-announcement-create-intents.js':intents,
};
const workflow=load('apps/server/src/domains/studio-systems/studio-workflow-routes.ts',imports);
workflow.registerStudioWorkflowRoutes({app:registry,prisma,authorization:{requireTool:async()=>allowed},getCurrentUser:async()=>({id:userId}),events:{}});
const create=app.post.get('/api/studio-systems/announcements');
const response=()=>({status:200,headers:{},code(n){this.status=n;return this},header(k,v){this.headers[k]=v;return this},send(v){return v}});
const id='8d2a39cd-701d-4876-97fe-42e911a60000';
const send=(input={...data,createIntentId:id},reply=response())=>create({body:input},reply).then(value=>({value,reply}));
await check('first authenticated create persists intent and returns 201 without internal fingerprints',async()=>{
 const {value,reply}=await send();assert.equal(reply.status,201);assert.equal(records.length,1);assert.equal(value.createIntentId,undefined);assert.equal(value.createPayloadSha256,undefined);assert.match(records[0].createPayloadSha256,/^[a-f0-9]{64}$/);
});
await check('same actor reuses intent after an unknown network outcome',async()=>{const {value,reply}=await send();assert.equal(value.id,'a1');assert.equal(reply.status,200);assert.equal(reply.headers['X-Cluster-Create-Replayed'],'true');assert.equal(records.length,1)});
await check('same key with changed body fails rather than falsely replaying',async()=>{const {value,reply}=await send({...data,body:'not the same',createIntentId:id});assert.equal(reply.status,409);assert.equal(value.code,'ANNOUNCEMENT_CREATE_INTENT_CONFLICT');assert.equal(records.length,1)});
await check('concurrent unique conflict recovers the committed record',async()=>{
 simulateConcurrent=true;const newId='d90034d0-02fa-475a-aac7-d27bfe8c5e60';const {value,reply}=await send({...data,createIntentId:newId});assert.equal(reply.status,200);assert.equal(value.id,'a2');assert.equal(records.length,2);
});
await check('a different actor cannot read another creator’s intent and can create separately',async()=>{userId='owner2';const {value,reply}=await send();assert.equal(reply.status,201);assert.equal(value.id,'a3');assert.equal(records.length,3);userId='owner'});
await check('permissions rechecked on replay before database access',async()=>{allowed=false;const {value}=await send();assert.equal(value,undefined);assert.equal(records.length,3);allowed=true});
await check('new intent creates a deliberate additional copy',async()=>{const {reply}=await send({...data,createIntentId:'5364bcb7-2587-4e44-9ecb-313327cdf186'});assert.equal(reply.status,201);assert.equal(records.length,4)});
await check('legacy clients without intent remain compatible',async()=>{const {reply}=await send(data);assert.equal(reply.status,201);assert.equal(records.length,5)});
await check('unavailable storage never reports a successful creation',async()=>{failCreate=true;await assert.rejects(send({...data,createIntentId:'c532e8ce-6c36-4c75-babc-1bca5bff37e4'}),/storage offline/);failCreate=false;assert.equal(records.length,5)});
await check('replay works after scheduled time has passed and original record is updated',async()=>{
 const scheduledId='ca26bbec-28a7-42b1-b355-cc1f72d3b5f4';const scheduled={...data,scheduledAt:new Date(Date.now()+120000),createIntentId:scheduledId};
 const first=await send(scheduled);assert.equal(first.reply.status,201);records[5].status='published';records[5].revision=5;
 const second=await send(scheduled);assert.equal(second.reply.status,200);assert.equal(second.value.status,'published');assert.equal(second.value.revision,5);
});
await check('schema declares unique per-actor intent and a migration',()=>{const schema=readFileSync('apps/server/prisma/schema.prisma','utf8');assert.match(schema,/@@unique\(\[createdById, createIntentId\]\)/);const migration=readFileSync('apps/server/prisma/migrations/20261104000000_td6_g27_announcement_create_intents/migration.sql','utf8');assert.match(migration,/CREATE UNIQUE INDEX/)});
await check('client persists stable create/copy intents until success',()=>{const source=readFileSync('packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx','utf8');assert.match(source,/pendingCreateIntent\.current\?\.payload !== payload/);assert.match(source,/pendingCopyIntent\.current\?\.payload !== payload/);assert.match(source,/createIntentId: intentId/);assert.match(source,/savePendingAnnouncementIntent/);assert.doesNotMatch(source,/queryApi<AnnouncementPage>/)});
const recover=app.get.get('/api/studio-systems/announcements/create-intents/:intentId');
const recoverIntent=(intentId,reply=response())=>recover({params:{intentId}},reply).then(value=>({value,reply}));
await check('read-only lookup recovers a committed create after tab reload without publishing',async()=>{
  const countBefore=records.length;
  const {value,reply}=await recoverIntent(id);
  assert.equal(reply.status,200);assert.equal(value.announcement.id,'a1');
  assert.equal(value.announcement.createIntentId,undefined);assert.equal(value.announcement.createPayloadSha256,undefined);
  assert.equal(reply.headers['Cache-Control'],'private, no-store');assert.equal(records.length,countBefore);
});
await check('read-only lookup is scoped to the current author',async()=>{
  userId='other-admin';const {reply,value}=await recoverIntent(id);assert.equal(reply.status,404);assert.equal(value.code,'ANNOUNCEMENT_INTENT_UNRESOLVED');userId='owner';
});
await check('read-only lookup enforces fresh settings authorization',async()=>{
  allowed=false;const {value}=await recoverIntent(id);assert.equal(value,undefined);allowed=true;
});
await check('uncommitted intent is not mistaken for successful create',async()=>{
  const {reply,value}=await recoverIntent('b3a1f2c5-54ee-4b9b-9b8e-925461a3b4bb');assert.equal(reply.status,404);assert.equal(value.code,'ANNOUNCEMENT_INTENT_UNRESOLVED');
});
await check('recovery route rejects malformed identities and does not introduce a mutation',()=>{
  const text=readFileSync('apps/server/src/domains/studio-systems/studio-workflow-routes.ts','utf8');
  assert.match(text,/announcements\/create-intents\/:intentId/);assert.match(text,/intentId: z\.string\(\)\.uuid\(\)/);assert.doesNotMatch(text,/app\.post\("\/api\/studio-systems\/announcements\/create-intents/);
});
console.log(`G27 durable announcement creation: ${count}/${count} passed`);
