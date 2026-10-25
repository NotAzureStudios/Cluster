import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
function load(file, mocks={}) {
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require:(name)=>name in mocks?mocks[name]:require(name),Buffer,Date,JSON,String,Number,Set,Map,Math,Uint32Array},{filename:file});
 return module.exports;
}
const pub=load('apps/server/src/domains/library/packet-publication.ts');
const bundle=load('apps/server/src/domains/library/packet-bundle.ts',{'./packet-publication.js':pub});
const note={id:'source-internal',title:'Approved',type:'note',body:'Hello',classification:'internal',status:'active',revision:1};
const definition={id:'definition',audienceJson:'{"mode":"users","targets":["member"]}',kind:'training',versionLabel:'3.0',completionMode:'read'};
const manifest=pub.buildPacketReleaseManifest({id:'packet'},definition,[note]);
const initialRelease={id:'release',packetDefinitionId:'definition',publishedAt:new Date(),...manifest,versionLabel:'3.0',revokedAt:null};
const [artifact]=pub.buildPacketTextDerivatives(manifest.manifestJson,[note]);
const chain={min(){return this},max(){return this},int(){return this},trim(){return this},regex(){return this},default(){return this}};
const z={object:()=>({strict(){return this},parse:x=>x}),string:()=>chain,literal:()=>chain,boolean:()=>chain,coerce:{number:()=>chain}};
const shared={packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}};
const routes=load('apps/server/src/domains/library/packet-routes.ts',{'zod':{z},'./packet-publication.js':pub,'./packet-pdf-derivative.js':{buildPacketNotePdfDerivatives:async()=>[]},'./packet-file-text-derivative.js':{buildPacketFileTextDerivatives:async()=>[]},'./packet-file-image-derivative.js':{buildPacketFileImageDerivatives:async()=>[]},'./packet-file-audio-derivative.js':{buildPacketFileAudioDerivatives:async()=>[]},'./packet-file-pdf-derivative.js':{buildPacketFilePdfDerivatives:async()=>[]},'./packet-bundle.js':bundle,'@cluster/shared':shared,'../access/studio-audience.js':{studioAudienceMatchesUser:async(_db,_,user)=>user.id==='member'},'../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},'../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}}});
let checks=0;
const test=async(label,fn)=>{await fn();checks++;console.log('PASS',label)};
function harness({admin=true,member='member',canSee=true,fingerprint=manifest.manifestSha256,auditFail=false,revoked=false}={}) {
 const handlers=new Map();
 let release={...initialRelease,revokedAt:revoked?new Date():null};
 const audit=[];
 const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),patch:(path,fn)=>handlers.set('PATCH '+path,fn)};
 const db={
  libraryItem:{findFirst:async()=>({id:'packet',type:'folder',packetDefinition:definition})},
  packetRelease:{findFirst:async()=>release,updateMany:async({where,data})=>{
   if(release.revokedAt || where.manifestSha256!==release.manifestSha256)return {count:0};
   release={...release,...data};return {count:1};
  }},
  packetReleaseDerivative:{findMany:async()=>[artifact],findUnique:async()=>artifact},
  activityEvent:{create:async({data})=>{if(auditFail)throw new Error('audit unavailable');audit.push(data);return data}},
  async $transaction(work){const prior={...release};try{return await work(db)}catch(error){release=prior;throw error}},
 };
 routes.registerPacketRoutes({app,prisma:db,readSettings:async()=>({packetsEnabled:true}),accessContext:async()=>({user:{id:member},decorated:{isAdmin:admin}}),hasToolPermission:()=>true,visibleFor:()=>canSee,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},serializeLibraryItem:x=>x,clearLibraryContextCache:()=>{},logActivity:async()=>{}});
 const response=()=>({status:200,body:null,headers:{},code(n){this.status=n;return this},send(value){this.body=value;return this},type(v){this.headers['Content-Type']=v;return this},header(k,v){this.headers[k]=v;return this}});
 const call=async(method,path,body={})=>{const handler=handlers.get(method+' '+path);assert.ok(handler,path);const reply=response();const params={packetId:'packet',releaseId:'release',position:'1'};const value=await handler({params,body},reply);reply.body=reply.body??value;return reply;};
 const revokeBody={confirmation:'REVOKE RELEASE',reason:'The published files were incorrect',expectedManifestSha256:fingerprint};
 return {call,release:()=>release,audit,revokeBody};
}
const revoke='/api/packets/:packetId/releases/:releaseId/revoke';
const catalog='/api/packets/:packetId/deliveries/:releaseId/catalog';
const artifactRoute='/api/packets/:packetId/deliveries/:releaseId/artifacts/:position';
const zipRoute='/api/packets/:packetId/deliveries/:releaseId/bundle';
await test('Administrator can revoke a specific manifest fingerprint',async()=>{const h=harness();const response=await h.call('POST',revoke,h.revokeBody);assert.equal(response.body.ok,true);assert.ok(h.release().revokedAt);assert.equal(h.audit.length,1);assert.match(h.audit[0].metadata,/The published files/);});
await test('Non-admin cannot revoke',async()=>{const h=harness({admin:false});assert.equal((await h.call('POST',revoke,h.revokeBody)).status,403);assert.equal(h.release().revokedAt,null);});
await test('Fingerprint mismatch blocks the mutation',async()=>{const h=harness({fingerprint:'0'.repeat(64)});assert.equal((await h.call('POST',revoke,h.revokeBody)).status,409);assert.equal(h.audit.length,0);});
await test('Failed audit rolls back revocation',async()=>{const h=harness({auditFail:true});await assert.rejects(()=>h.call('POST',revoke,h.revokeBody),/audit unavailable/);assert.equal(h.release().revokedAt,null);});
await test('Repeated revocation does not create a second event',async()=>{const h=harness();await h.call('POST',revoke,h.revokeBody);assert.equal((await h.call('POST',revoke,h.revokeBody)).status,409);assert.equal(h.audit.length,1);});
await test('Revoked catalogue, single file and ZIP URLs all fail closed',async()=>{const h=harness({revoked:true});for(const path of [catalog,artifactRoute,zipRoute]){const result=await h.call('GET',path);assert.equal(result.status,404,path)}});
await test('Revoked release has no audience match even before a route',async()=>assert.equal(pub.publishedPacketAudience({...initialRelease,revokedAt:new Date()}),null));
await test('Revoked release is rejected by integrity projection',async()=>assert.throws(()=>pub.packetRecipientCatalog({...initialRelease,revokedAt:new Date()}),/REVOKED/));
await test('Migration and schema preserve immutable evidence',async()=>{const schema=fs.readFileSync('apps/server/prisma/schema.prisma','utf8');const sql=fs.readFileSync('apps/server/prisma/migrations/20261009001500_packet_release_revocation/migration.sql','utf8');assert.match(schema,/revokedById\s+String\?/);assert.match(sql,/ALTER TABLE "PacketRelease"/);assert.doesNotMatch(sql,/DELETE FROM/);});
await test('Admin editor requires typed confirmation and reason',async()=>{const ui=fs.readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');assert.match(ui,/REVOKE RELEASE/);assert.match(ui,/revokeReason\.trim\(\)\.length < 10/);});
console.log(`${checks}/${checks} Packet release revocation checks passed`);
