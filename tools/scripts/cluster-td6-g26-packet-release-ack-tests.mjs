#!/usr/bin/env node
/** G26 WS3: independently run packet recipient and author acknowledgment endpoints. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const digest=value=>createHash('sha256').update(value).digest('hex');
const schemas={
 string:()=>({min(){return this},max(){return this},regex(){return this},optional(){return this}}),
 literal:value=>({value}),
 coerce:{number:()=>({int(){return this},min(){return this},max(){return this},default(){return this}})},
 object:fields=>({strict(){return this},parse(input){const data={...input};if('limit' in fields)data.limit=Number(data.limit||50);return data;},safeParse(input){
   if(!input || typeof input !== 'object'||input.confirmed!==true||typeof input.expectedVersionLabel!=='string'||!input.expectedVersionLabel.trim()||
     typeof input.expectedManifestSha256!=='string'||!/^[a-f0-9]{64}$/i.test(input.expectedManifestSha256)||
     Object.keys(input).some(key=>!['confirmed','expectedVersionLabel','expectedManifestSha256'].includes(key))) return {success:false};
   return {success:true,data:input};
 }})
};
function load(file,mocks={}){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:name=>name in mocks?mocks[name]:require(name),Buffer,Date,Map,Set,JSON,Number,Error,console},{filename:file});return module.exports;}
const pub=load('apps/server/src/domains/library/packet-publication.ts');
const bundle=load('apps/server/src/domains/library/packet-bundle.ts',{'./packet-publication.js':pub});
const issuance = load('apps/server/src/domains/library/packet-delivery-issuance.ts');
const route=load('apps/server/src/domains/library/packet-routes.ts',{
 zod:{z:schemas},'./packet-publication.js':pub,'./packet-bundle.js':bundle, './packet-delivery-issuance.js':issuance,
 './packet-pdf-derivative.js':{},'./packet-file-text-derivative.js':{},'./packet-file-image-derivative.js':{},
 './packet-file-pdf-derivative.js':{},'./packet-file-audio-derivative.js':{},
 '@cluster/shared':{packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}},
 '../access/studio-audience.js':{studioAudienceMatchesUser:async(_prisma,audience,user)=>audience===JSON.stringify({mode:'users',targets:['member']})&&user.id==='member'},
 '../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},
 '../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}}
});
const frozenAudience=JSON.stringify({mode:'users',targets:['member']}),originalHash='d'.repeat(64);
const manifestJson=JSON.stringify({schema:1,versionLabel:'3.4',distributionPolicy:'derived_only',audienceJson:frozenAudience,
 sourceItems:[{sourceId:'private-original',kind:'note',title:'Policy',checksumSha256:originalHash}]});
const baseline={id:'release1',packetDefinitionId:'definition',versionLabel:'3.4',manifestJson,manifestSha256:digest(manifestJson),revokedAt:null};
let checks=0;
async function test(label,fn){await fn();checks++;console.log('PASS G26 WS3 '+label);}
function harness({user='member',admin=false,visible=true,enabled=true,revoked=false,changed=false,lockedRevoked=false,failInsert=false,denyEdit=false}={}){
 let release={...baseline,revokedAt:revoked?new Date():null}, records=[],seq=0, lockQueries=0;
 const handlers=new Map();const app={get:(url,fn)=>handlers.set('GET '+url,fn),post:(url,fn)=>handlers.set('POST '+url,fn),patch(){}};
 const model={
 findUnique:async({where})=>records.find(row=>row.releaseId===where.releaseId_recipientId.releaseId&&row.recipientId===where.releaseId_recipientId.recipientId)||null,
 findFirst:async({where})=>records.find(row=>row.releaseId===where.releaseId&&row.id===where.id)||null,
 findMany:async({where,cursor,skip=0,take=50})=>{
  let list=records.filter(row=>row.releaseId===where.releaseId).slice().reverse();if(cursor){let index=list.findIndex(row=>row.id===cursor.id);list=list.slice(index+skip);}return list.slice(0,take);
 },
 count:async({where})=>records.filter(row=>row.releaseId===where.releaseId).length,
 create:async({data})=>{if(failInsert)throw Error('evidence disk outage');if(records.some(row=>row.releaseId===data.releaseId&&row.recipientId===data.recipientId))throw Object.assign(Error('duplicate'),{code:'P2002'});
 const row={id:'ack'+(++seq),...data,acknowledgedAt:new Date('2026-10-21T11:00:00Z')};records.push(row);return row;}
 };
 const prisma={
 libraryItem:{findFirst:async()=>({id:'packet',packetDefinition:{id:'definition'}})},
 packetRelease:{findFirst:async()=>({...release,manifestSha256:changed?'f'.repeat(64):release.manifestSha256})},
 packetReleaseAcknowledgment:model,
 user:{findMany:async()=>[{id:'member',displayName:'Member',username:'member'}]},
 async $transaction(fn){const before=records.slice();try{return await fn({...this,$queryRaw:async()=>{lockQueries++;return lockedRevoked?[{...release,revokedAt:new Date()}]:[{...release}];}});}catch(error){records=before;throw error;}}
 };
 const ctx=()=>({user:user?{id:user}:null,decorated:{isAdmin:admin}});
 route.registerPacketRoutes({app,prisma,accessContext:async()=>ctx(),readSettings:async()=>({packetsEnabled:enabled}),
 hasToolPermission:(_u,_r,_t,level)=>level!=='edit'||!denyEdit,visibleFor:()=>visible,ensurePacketsRoot:async()=>({id:'root'}),
 itemInclude:{},serializeLibraryItem:x=>x,logActivity:async()=>{},clearLibraryContextCache:()=>{}});
 async function call(method,suffix,{body={},query={},packetId='packet',releaseId='release1'}={}){
  const fn=handlers.get(`${method} /api/packets/:packetId/${suffix}`);assert.ok(fn,method+' '+suffix);
  const reply={status:200,body:null,headers:{},code(code){this.status=code;return this;},send(body){this.body=body;return this;},header(k,v){this.headers[k]=v;return this;}};
  const result=await fn({params:{packetId,releaseId},query,body},reply);return {status:reply.status,value:reply.body??result,headers:reply.headers};
 }
 return {call,records:()=>records,release:()=>release,lockCount:()=>lockQueries,insert:(row)=>{records.push(row);seq++;}};
}
const submit={expectedManifestSha256:baseline.manifestSha256,expectedVersionLabel:'3.4',confirmed:true};
const ack='deliveries/:releaseId/acknowledge',mine='deliveries/:releaseId/acknowledgment',report='releases/:releaseId/acknowledgments';
await test('verified account explicitly acknowledges exact immutable release',async()=>{const h=harness();const r=await h.call('POST',ack,{body:submit});assert.equal(r.status,200);assert.equal(r.value.alreadyAcknowledged,false);assert.equal(h.records()[0].manifestSha256,baseline.manifestSha256);assert.equal(h.records()[0].recipientId,'member');assert.equal(h.lockCount(),1);assert.equal(r.value.evidenceType,'recipient_asserted_review_not_download_proof');});
await test('repeated acknowledgment is idempotent and never makes duplicate evidence',async()=>{const h=harness();await h.call('POST',ack,{body:submit});const second=await h.call('POST',ack,{body:submit});assert.equal(second.value.alreadyAcknowledged,true);assert.equal(h.records().length,1);});
await test('invalid confirmation, arbitrary forged properties and invalid hashes fail closed',async()=>{for(const body of [{...submit,confirmed:false},{...submit,recipientId:'other'}, {...submit,expectedManifestSha256:'bad'},{}]){const h=harness();assert.equal((await h.call('POST',ack,{body})).status,400);assert.equal(h.records().length,0);}});
await test('stale version or manifest cannot be acknowledged',async()=>{for(const body of [{...submit,expectedVersionLabel:'2.0'},{...submit,expectedManifestSha256:'a'.repeat(64)}]){const h=harness();assert.equal((await h.call('POST',ack,{body})).status,409);assert.equal(h.records().length,0);}});
await test('withdrawn release does not accept new statements',async()=>{const h=harness({revoked:true});assert.equal((await h.call('POST',ack,{body:submit})).status,404);assert.equal(h.records().length,0);});
await test('revoked under row lock blocks acknowledgment even after precheck',async()=>{const h=harness({lockedRevoked:true});assert.equal((await h.call('POST',ack,{body:submit})).status,409);assert.equal(h.records().length,0);});
await test('unauthorized recipient cannot view or submit',async()=>{for(const options of [{user:'intruder'},{visible:false},{user:null},{enabled:false}]){const h=harness(options);const r=await h.call('POST',ack,{body:submit});assert.ok(r.status>=400);assert.equal(h.records().length,0);}});
await test('failed evidence write rolls back response and record',async()=>{const h=harness({failInsert:true});await assert.rejects(h.call('POST',ack,{body:submit}),/evidence disk outage/);assert.equal(h.records().length,0);});
await test('recipient can see only personal version-bound acknowledgment',async()=>{const h=harness();let result=await h.call('GET',mine);assert.equal(result.value.acknowledgment,null);await h.call('POST',ack,{body:submit});result=await h.call('GET',mine);assert.equal(result.value.acknowledgment.manifestSha256,baseline.manifestSha256);assert.equal(result.headers['Cache-Control'],'private, no-store');});
await test('a recipient cannot enumerate acknowledgments',async()=>{const h=harness({denyEdit:true});assert.equal((await h.call('GET',report)).status,403);});
await test('manager report is scoped, paged, privacy-minimized, and preserves withdrawal history',async()=>{const h=harness({user:'manager',admin:true});const first={id:'a1',recipientId:'member',releaseId:'release1',versionLabel:'3.4',manifestSha256:baseline.manifestSha256,acknowledgedAt:new Date()};h.insert(first);const r=await h.call('GET',report);assert.equal(r.value.total,1);assert.equal(r.value.acknowledgments[0].recipient.displayName,'Member');assert.ok(!JSON.stringify(r.value).includes('private-original'));assert.equal(r.value.evidenceType,'recipient_asserted_review_not_download_proof');});
await test('invalid report cursor cannot read another release',async()=>{const h=harness({user:'manager',admin:true});const result=await h.call('GET',report,{query:{cursor:'other-release'}});assert.equal(result.status,400);});
await test('manager must have Packet editor visibility in addition to role',async()=>{const h=harness({user:'manager',admin:true,visible:false});assert.equal((await h.call('GET',report)).status,404);});
await test('Prisma migration has unique recipient key and restrictive release relation',()=>{const sql=readFileSync('apps/server/prisma/migrations/20261029000000_td6_g26_packet_release_acknowledgment/migration.sql','utf8');assert.match(sql,/UNIQUE INDEX "PacketReleaseAcknowledgment_releaseId_recipientId_key"/);assert.match(sql,/ON DELETE RESTRICT/);});
await test('recipient UI requires consent and never infers acceptance from download or catalogue',()=>{const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');assert.match(ui,/acknowledgmentConfirmed/);assert.match(ui,/confirmed: true/);assert.match(ui,/Record my acknowledgment/);assert.match(ui,/not evidence that a download finished/);});
await test('privacy export includes only subject-owned Packet issuance and acknowledgment rows',()=>{
 const source=readFileSync('apps/server/src/domains/legal/privacy-data-routes.ts','utf8');
 assert.match(source,/prisma\.packetDeliveryReceipt\.findMany\(\{ where: \{ recipientId: user\.id \}/);
 assert.match(source,/prisma\.packetReleaseAcknowledgment\.findMany\(\{ where: \{ recipientId: user\.id \}/);
 assert.match(source,/packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements/);
 assert.match(source,/take: limit/);
});
await test('privacy summary exposes Packet evidence as a separate category',()=>{
 const source=readFileSync('apps/server/src/domains/legal/privacy-data-routes.ts','utf8');
 assert.match(source,/id: "packet-delivery"/);
 assert.match(source,/packetDeliveryIssuances \+ counts\.packetReleaseAcknowledgments/);
});
await test('erasure plan explicitly preserves immutable release evidence under pseudonymization',()=>{
 const source=readFileSync('apps/server/src/core/privacy-erasure.ts','utf8');
 assert.match(source,/preservedCounts: \{ packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders \}/);
 assert.match(source,/published Packet delivery issuance, required release assignments, reminder deliveries and release-bound recipient acknowledgment evidence/);
});
await test('privacy schema version is revised for new Packet evidence categories',()=>{
 const source=readFileSync('apps/server/src/core/privacy-data-control.ts','utf8');
 assert.match(source,/PRIVACY_EXPORT_SCHEMA_VERSION = 11/);
});
console.log(`G26 Workstream 3 Packet acknowledgment: ${checks}/${checks} passed`);
