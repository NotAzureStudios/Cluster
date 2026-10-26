#!/usr/bin/env node
/** G26 WS6: execute real Packet release requirement handlers in controlled DB transactions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const digest=s=>createHash('sha256').update(s).digest('hex');
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS G26 WS6 '+name);}
function schema(kind='other',shape={}){return {kind,shape, min(){return this},max(){return this},trim(){return this},regex(){return this},int(){return this},datetime(){return this},nullable(){return this},optional(){return this},default(){return this},strict(){return this},parse(v){if(kind==='object'&&'limit'in shape)return {...v,limit:Number(v?.limit||50)};return v},safeParse(v){if(kind==='object'&&'recipientIds'in shape){const allowed=['recipientIds','expectedManifestSha256','dueAt'];const valid=v&&typeof v==='object'&&Object.keys(v).every(k=>allowed.includes(k))&&Array.isArray(v.recipientIds)&&v.recipientIds.length>=1&&v.recipientIds.length<=100&&v.recipientIds.every(x=>typeof x==='string'&&x.length>0&&x.length<=240)&&/^[a-f0-9]{64}$/i.test(v.expectedManifestSha256)&&(v.dueAt==null||!Number.isNaN(new Date(v.dueAt).getTime()));return valid?{success:true,data:v}:{success:false};}return {success:true,data:v}}};}
const z={string:()=>schema(),literal:()=>schema(),array:()=>schema(),object:shape=>schema('object',shape),coerce:{number:()=>schema()},enum:()=>schema()};
function load(file,mocks={}){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require(name){return name in mocks?mocks[name]:require(name)},Buffer,Date,Map,Set,JSON,Number,Error,console},{filename:file});return module.exports;}
const pub=load('apps/server/src/domains/library/packet-publication.ts');
const bundle=load('apps/server/src/domains/library/packet-bundle.ts',{'./packet-publication.js':pub});
const issuance = load('apps/server/src/domains/library/packet-delivery-issuance.ts');
const route=load('apps/server/src/domains/library/packet-routes.ts',{
 zod:{z},'./packet-publication.js':pub,'./packet-bundle.js':bundle, './packet-delivery-issuance.js':issuance,
 './packet-pdf-derivative.js':{},'./packet-file-text-derivative.js':{},'./packet-file-image-derivative.js':{},
 './packet-file-pdf-derivative.js':{},'./packet-file-audio-derivative.js':{},
 '@cluster/shared':{packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}},
 '../access/studio-audience.js':{studioAudienceMatchesUser:async(_db,_audience,user)=>user.id==='member'||user.id==='manager',loadStudioAudienceUserContext:async(_db,user,opts)=>{assert.equal(opts.strict,true);return {id:user.id}},studioAudienceMatchesContext:(_audience,id,ctx)=>id===ctx.id&&(id==='member'||id==='manager')},
 '../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},
 '../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}}
});
const audience=JSON.stringify({mode:'all',targets:[]}),manifestJson=JSON.stringify({schema:1,versionLabel:'5',distributionPolicy:'derived_only',audienceJson:audience,sourceItems:[{sourceId:'private-original',kind:'note',title:'Training',checksumSha256:'e'.repeat(64)}]});
const manifest=digest(manifestJson),base={id:'release',packetDefinitionId:'definition',versionLabel:'5',manifestJson,manifestSha256:manifest,revokedAt:null};
const endpoint='releases/:releaseId/requirements';
function fixture({admin=true,editable=true,visible=true,revoked=false,lockRevoked=false,failAudit=false,user='manager'}={}){
 const handlers=new Map();let release={...base,revokedAt:revoked?new Date():null},requirements=[],acks=[],audit=[],lockCount=0;
 const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),patch:()=>{}};
 const users=[{id:'member',username:'member',displayName:'Member'},{id:'manager',username:'manager',displayName:'Manager'}];
 const db={
  libraryItem:{findFirst:async()=>({id:'packet',packetDefinition:{id:'definition'}})},
  packetRelease:{findFirst:async()=>release,findMany:async()=>[release]},
  packetReleaseDerivative:{findMany:async()=>[]},
  packetReleaseRequirement:{
   createMany:async({data})=>{let created=0;for(const row of data){if(!requirements.some(x=>x.releaseId===row.releaseId&&x.recipientId===row.recipientId)){requirements.push({...row,id:'requirement-'+(++created),assignedAt:new Date()});}}return {count:created};},
   findMany:async({where,cursor,skip=0,take=100})=>{let list=requirements.filter(x=>typeof where.releaseId==='string'?x.releaseId===where.releaseId:where.releaseId?.in?.includes(x.releaseId));if(where.recipientId)list=list.filter(x=>x.recipientId===where.recipientId);if(where.releaseId?.in)list=list.filter(x=>where.releaseId.in.includes(x.releaseId));if(cursor){const i=list.findIndex(x=>x.id===cursor.id);list=list.slice(i+skip);}return list.slice(0,take);},
   findFirst:async({where})=>requirements.find(x=>x.id===where.id&&x.releaseId===where.releaseId)||null,
   count:async({where})=>requirements.filter(x=>x.releaseId===where.releaseId).length,
  },
  packetReleaseReminderDelivery:{groupBy:async()=>[]},
  packetReleaseAcknowledgment:{findMany:async({where})=>acks.filter(x=>(typeof where.releaseId==='string'?x.releaseId===where.releaseId:where.releaseId?.in?.includes(x.releaseId)) && (!where.recipientId?.in||where.recipientId.in.includes(x.recipientId)))},
  user:{findMany:async({where})=>users.filter(x=>!where.id?.in ||where.id.in.includes(x.id))},
  activityEvent:{create:async({data})=>{if(failAudit)throw Error('audit unavailable');audit.push(data)}},
  async $transaction(callback){const saved=requirements.slice(),events=audit.slice();try{return await callback({...this,$queryRaw:async()=>{lockCount++;return [{...release,revokedAt:lockRevoked?new Date():release.revokedAt}];}})}catch(error){requirements=saved;audit=events;throw error;}}
 };
 route.registerPacketRoutes({app,prisma:db,accessContext:async()=>({user:user?{id:user}:null,decorated:{isAdmin:admin}}),readSettings:async()=>({packetsEnabled:true}),hasToolPermission:(_u,_role,_tool,level)=>level==='view'||editable,visibleFor:()=>visible,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},serializeLibraryItem:x=>x,logActivity:async()=>{},clearLibraryContextCache:()=>{}});
 async function call(method,suffix,{body={},query={}}={}){const handler=handlers.get(`${method} /api/packets/:packetId/${suffix}`);assert.ok(handler);const reply={status:200,body:null,headers:{},code(n){this.status=n;return this},send(obj){this.body=obj;return this},header(k,v){this.headers[k]=v;return this}};const answer=await handler({params:{packetId:'packet',releaseId:'release'},body,query},reply);return {status:reply.status,value:reply.body??answer,headers:reply.headers};}
 return {call,requirements:()=>requirements,audit:()=>audit,acks,users,get lockCount(){return lockCount}};
}
const body={recipientIds:['member'],expectedManifestSha256:manifest,dueAt:'2026-11-01T23:59:59.000Z'};
await test('author assigns named frozen-release recipient with manifest and due date',async()=>{const f=fixture();const r=await f.call('POST',endpoint,{body});assert.equal(r.status,200);assert.equal(r.value.created,1);assert.equal(f.requirements()[0].manifestSha256,manifest);assert.equal(f.requirements()[0].recipientId,'member');assert.equal(f.lockCount,1);assert.equal(f.audit().length,1);});
await test('repeat assignment preserves first due date and is idempotent',async()=>{const f=fixture();await f.call('POST',endpoint,{body});const r=await f.call('POST',endpoint,{body:{...body,dueAt:null}});assert.equal(r.value.created,0);assert.equal(r.value.alreadyAssigned,1);assert.equal(f.requirements().length,1);assert.equal(f.requirements()[0].dueAt.getTime(),new Date(body.dueAt).getTime());});
await test('unknown and ineligible recipients are not silently accepted',async()=>{for(const id of ['other','deleted']){const f=fixture();const r=await f.call('POST',endpoint,{body:{...body,recipientIds:[id]}});assert.equal(r.status,409);assert.equal(f.requirements().length,0);}});
await test('duplicates, empty recipient sets, arbitrary fields and hash formats are rejected',async()=>{for(const change of [{recipientIds:[]},{recipientIds:['member','member']},{expectedManifestSha256:'bad'},{other:'forged'}]){const f=fixture();const r=await f.call('POST',endpoint,{body:{...body,...change}});assert.equal(r.status,400);assert.equal(f.requirements().length,0);}});
await test('stale hash rejects before transaction',async()=>{const f=fixture();const r=await f.call('POST',endpoint,{body:{...body,expectedManifestSha256:'a'.repeat(64)}});assert.equal(r.status,409);assert.equal(f.lockCount,0);});
await test('revoked before or during lock cannot receive requirements',async()=>{for(const args of [{revoked:true},{lockRevoked:true}]){const f=fixture(args);const r=await f.call('POST',endpoint,{body});assert.ok(r.status===404||r.status===409);assert.equal(f.requirements().length,0);}});
await test('non-editor or unauthorized source access is blocked',async()=>{for(const args of [{editable:false,admin:false},{visible:false},{user:null}]){const f=fixture(args);const r=await f.call('POST',endpoint,{body});assert.ok(r.status>=400);assert.equal(f.requirements().length,0);}});
await test('failed audit rolls back all assignment writes',async()=>{const f=fixture({failAudit:true});await assert.rejects(f.call('POST',endpoint,{body}),/audit unavailable/);assert.equal(f.requirements().length,0);});
await test('manager report joins only release scoped acknowledgments',async()=>{const f=fixture();await f.call('POST',endpoint,{body});f.acks.push({releaseId:'release',recipientId:'member',manifestSha256:manifest,acknowledgedAt:new Date()},{releaseId:'other',recipientId:'member',manifestSha256:manifest,acknowledgedAt:new Date()});const r=await f.call('GET',endpoint);assert.equal(r.value.total,1);assert.ok(r.value.requirements[0].acknowledgedAt);assert.equal(r.value.requirements[0].recipient.displayName,'Member');assert.equal(r.headers['Cache-Control'],'private, no-store');});
await test('invalid report cursor rejected rather than reading another release',async()=>{const f=fixture();assert.equal((await f.call('GET',endpoint,{query:{cursor:'other'}})).status,400);});
await test('candidate discovery excludes users outside frozen audience',async()=>{const f=fixture();const r=await f.call('GET','releases/:releaseId/requirement-candidates');assert.equal(r.value.candidates.length,2);assert.ok(!JSON.stringify(r.value).includes('private-original'));});
await test('recipient catalog signals exact-version requirement and acknowledgment separately',async()=>{const f=fixture({user:'member'});await f.call('POST',endpoint,{body});const r=await f.call('GET','deliveries');assert.equal(r.value.releases[0].requiredAcknowledgment.acknowledgedAt,null);f.acks.push({releaseId:'release',recipientId:'member',manifestSha256:manifest,acknowledgedAt:new Date()});const rr=await f.call('GET','deliveries');assert.ok(rr.value.releases[0].requiredAcknowledgment.acknowledgedAt);});
await test('privacy export, erasure plan and migration declare requirements',()=>{const p=readFileSync('apps/server/src/domains/legal/privacy-data-routes.ts','utf8');assert.match(p,/packetReleaseRequirement\.findMany\(\{ where: \{ recipientId: user\.id \}/);assert.match(p,/packetReleaseRequirements/);const erasure=readFileSync('apps/server/src/core/privacy-erasure.ts','utf8');assert.match(erasure,/preservedCounts: \{ packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders \}/);const migration=readFileSync('apps/server/prisma/migrations/20261030000000_td6_g26_packet_required_release_delivery/migration.sql','utf8');assert.match(migration,/ON DELETE RESTRICT/);assert.match(migration,/UNIQUE INDEX/);});
await test('UI exposes required selection, due date, and outstanding evidence',()=>{const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');assert.match(ui,/Assign required acknowledgments/);assert.match(ui,/Awaiting your acknowledgment/);assert.match(ui,/requirementReport\?\.requirements/);});
console.log(`G26 WS6 required Packet delivery: ${checks}/${checks} passed`);
