import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const hash = value => createHash('sha256').update(value).digest('hex');
function load(file, injected={}) {
  const src=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
  assert.equal(src.diagnostics?.length,0);
  const module={exports:{}};
  vm.runInNewContext(src.outputText,{module,exports:module.exports,Buffer,TextDecoder,Map,Set,JSON,Number,Date,Error,Math,Uint32Array,require:name=>injected[name]??require(name)},{filename:file});
  return module.exports;
}
const zChain={min(){return this;},max(){return this;},int(){return this;},default(){return this;},optional(){return this;}};
const z={object:()=>({parse:value=>({limit:50,...value,...(value?.position!==undefined?{position:Number(value.position)}:{})})}),string:()=>zChain,boolean:()=>zChain,coerce:{number:()=>zChain}};
const pub=load('apps/server/src/domains/library/packet-publication.ts');
const bundle=load('apps/server/src/domains/library/packet-bundle.ts',{'./packet-publication.js':pub});
const issuance=load('apps/server/src/domains/library/packet-delivery-issuance.ts');
const route=load('apps/server/src/domains/library/packet-routes.ts',{
  './packet-delivery-issuance.js': issuance,
  zod:{z},'./packet-publication.js':pub,'./packet-bundle.js':bundle,
  './packet-pdf-derivative.js':{buildPacketNotePdfDerivatives:async()=>[],renderPacketTextPdfDerivatives:async()=>[]},
  './packet-file-text-derivative.js':{buildPacketFileTextDerivatives:async()=>[]},
  './packet-file-image-derivative.js':{buildPacketFileImageDerivatives:async()=>[]},
  './packet-file-pdf-derivative.js':{buildPacketFilePdfDerivatives:async()=>[]},
  './packet-file-audio-derivative.js':{buildPacketFileAudioDerivatives:async()=>[]},
  '@cluster/shared':{packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}},
  '../access/studio-audience.js':{studioAudienceMatchesUser:async(_db,audience,user)=>audience===JSON.stringify({mode:'users',targets:['member']})&&user.id==='member',loadStudioAudienceUserContext:async(_db,user)=>({id:user.id}),studioAudienceMatchesContext:(audience,userId)=>audience===JSON.stringify({mode:'users',targets:['member']})&&userId==='member'},
  '../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},
  '../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}},
});
const audience=JSON.stringify({mode:'users',targets:['member']});
const content=Buffer.from('Safe detached note\n');
const originalHash='f'.repeat(64);
const manifest=JSON.stringify({schema:1,versionLabel:'2.1',distributionPolicy:'derived_only',audienceJson:audience,sourceItems:[{sourceId:'original-sensitive-file',kind:'note',title:'Staff note',checksumSha256:originalHash}]});
const release={id:'release1',packetDefinitionId:'definition',versionLabel:'2.1',manifestJson:manifest,manifestSha256:hash(manifest),publishedAt:new Date('2026-10-18T00:00:00Z'),revokedAt:null};
const artifact={releaseId:'release1',position:1,content,format:'txt',sizeBytes:content.byteLength,sha256:hash(content)};
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
function harness({user='member',admin=false,visible=true,toolAllowed=true,recordFails=false,revoked=false,corrupt=false,activityFails=false}={}){
  const rows=[], activities=[], handlers=new Map();let next=1;
  const prisma={libraryItem:{findFirst:async()=>({id:'packet',type:'folder',source:'packet',packetDefinition:{id:'definition'}})},
    packetRelease:{findFirst:async()=>({...release,revokedAt:revoked?new Date():null})},
    packetReleaseDerivative:{findUnique:async()=>corrupt?{...artifact,content:Buffer.from('damaged')} : artifact,findMany:async()=>corrupt?[{...artifact,content:Buffer.from('damaged')}]:[artifact]},
    packetDeliveryReceipt:{
      create:async({data})=>{if(recordFails)throw new Error('receipt storage down');const row={id:'receipt'+next++,issuedAt:new Date('2026-10-18T12:00:00Z'),...data};rows.push(row);return row;},
      findFirst:async({where})=>rows.find(x=>x.id===where.id&&x.releaseId===where.releaseId) || null,
      findMany:async({where,cursor,skip,take})=>{let result=rows.filter(x=>x.releaseId===where.releaseId).reverse();if(cursor){const n=result.findIndex(x=>x.id===cursor.id);result=result.slice(n+skip)}return result.slice(0,take);},
      count:async({where})=>rows.filter(x=>x.releaseId===where.releaseId&&(!where.kind||x.kind===where.kind)).length,
    },user:{findMany:async()=>[{id:'member',username:'demo',displayName:'Demo Member'}],findFirst:async({where})=>({id:where.id})},
    $transaction:async callback=>callback(prisma),
    $queryRaw:async()=>[{...release,revokedAt:revoked?new Date():null}],
  };
  const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:()=>{},patch:()=>{}};
  route.registerPacketRoutes({app,prisma,libraryFilesRoot:'/PRIVATE_SOURCE_NOT_AVAILABLE',readSettings:async()=>({packetsEnabled:true}),
    accessContext:async()=>({user:{id:user},decorated:{isAdmin:admin}}),hasToolPermission:(_user,_role,_tool,minimum)=>toolAllowed && (admin || minimum !== "edit"),
    visibleFor:()=>visible,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},
    serializeLibraryItem:x=>x,clearLibraryContextCache:()=>{},logActivity:async event=>{if(activityFails)throw new Error('activity storage failed');activities.push(event)}});
  const reply=()=>({status:200,headers:{},body:null,code(n){this.status=n;return this;},type(n){this.headers['Content-Type']=n;return this;},header(k,v){this.headers[k]=v;return this;},send(x){this.body=x;return this;}});
  async function call(suffix,params={packetId:'packet',releaseId:'release1',position:'1'},query={}){
    const fn=handlers.get('GET /api/packets/:packetId/'+suffix);assert.ok(fn,suffix);
    const response=reply();const result=await fn({params,query,log:{warn(){}}},response);
    return {status:response.status,body:response.body??result,headers:response.headers};
  }
  return {call,rows,activities};
}
const artifactRoute='deliveries/:releaseId/artifacts/:position',bundleRoute='deliveries/:releaseId/bundle',evidenceRoute='releases/:releaseId/delivery-evidence';
await test('detached derivative issuance creates durable receipt without source identity',async()=>{
  const h=harness();const r=await h.call(artifactRoute);
  assert.equal(r.status,200);assert.deepEqual(r.body,content);assert.equal(h.rows.length,1);
  assert.equal(h.rows[0].kind,'artifact');assert.equal(h.rows[0].position,1);assert.equal(h.rows[0].recipientId,'member');
  assert.equal(h.rows[0].derivativeHash,hash(content));assert.ok(!JSON.stringify(h.rows).includes(originalHash));
  assert.equal(h.activities.length,1);
});
await test('ZIP bundle records separate issued hash and size',async()=>{
  const h=harness();const r=await h.call(bundleRoute);assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'application/zip');
  assert.equal(h.rows[0].kind,'bundle');assert.equal(h.rows[0].position,null);
  assert.equal(h.rows[0].derivativeHash,hash(r.body));assert.equal(h.rows[0].sizeBytes,r.body.byteLength);
});
await test('failed evidence storage prevents bytes being sent',async()=>{
  const h=harness({recordFails:true});for(const endpoint of [artifactRoute,bundleRoute]) {
    await assert.rejects(h.call(endpoint),/receipt storage down/);assert.equal(h.rows.length,0);
  }
});
await test('Activity projection failure does not erase authoritative receipt',async()=>{
  const h=harness({activityFails:true});const r=await h.call(artifactRoute);assert.equal(r.status,200);assert.equal(h.rows.length,1);assert.equal(h.activities.length,0);
});
await test('revoked release, unauthorized audience or tampered bytes leave no receipt',async()=>{
  for(const options of [{revoked:true},{user:'intruder'},{visible:false},{corrupt:true},{toolAllowed:false}]) {
    const h=harness(options);const r=await h.call(artifactRoute);
    assert.ok(r.status>=400,JSON.stringify(options));assert.equal(h.rows.length,0);
  }
});
await test('recipient cannot query history, even their own receipt',async()=>{
  const h=harness();await h.call(artifactRoute);const r=await h.call(evidenceRoute);assert.equal(r.status,403);
});
await test('author report requires both Packet edit authority and Library item edit visibility',async()=>{
  for(const options of [{user:'admin',admin:true,visible:false},{user:'editor',toolAllowed:false}]) {
    const h=harness(options);assert.equal((await h.call(evidenceRoute)).status,options.visible===false?404:403);
  }
});
await test('authorized admin sees immutable issuance counts and recipient name',async()=>{
  const h=harness({user:'admin',admin:true});const x=await h.call(evidenceRoute);
  assert.equal(x.status,200);assert.equal(x.body.total,0);
  // Write an authorized recipient receipt in the shared mocked database.
  h.rows.push({id:'issued1',releaseId:'release1',recipientId:'member',kind:'bundle',position:null,derivativeHash:hash(Buffer.from('zip')),sizeBytes:3,issuedAt:new Date()});
  const r=await h.call(evidenceRoute);assert.equal(r.body.total,1);assert.equal(r.body.bundleCount,1);
  assert.equal(r.body.receipts[0].recipient.displayName,'Demo Member');
  assert.equal(r.body.evidenceType,'authorized_issuance_not_confirmed_download');
  assert.ok(!JSON.stringify(r.body).includes('original-sensitive-file'));
});
await test('revocation preserves historic manager evidence but denies new downloads',async()=>{
  const h=harness({user:'admin',admin:true,revoked:true});h.rows.push({id:'old',releaseId:'release1',recipientId:'member',kind:'artifact',position:1,derivativeHash:hash(content),sizeBytes:content.length,issuedAt:new Date()});
  assert.equal((await h.call(artifactRoute)).status,404);
  const r=await h.call(evidenceRoute);assert.equal(r.body.revoked,true);assert.equal(r.body.total,1);
});
await test('bounded evidence pages resume with a verified in-release cursor',async()=>{
  const h=harness({user:'admin',admin:true});
  for(let i=1;i<=5;i++)h.rows.push({id:'r'+i,releaseId:'release1',recipientId:'member',kind:'artifact',position:1,derivativeHash:hash(content),sizeBytes:content.length,issuedAt:new Date('2026-10-18T12:00:00Z')});
  const first=await h.call(evidenceRoute,undefined,{limit:2});
  assert.equal(first.body.receipts.length,2);assert.equal(first.body.total,5);assert.ok(first.body.nextCursor);
  const second=await h.call(evidenceRoute,undefined,{limit:2,cursor:first.body.nextCursor});
  assert.equal(second.body.receipts.length,2);assert.equal(second.body.total,5);
  assert.ok(!new Set(first.body.receipts.map(x=>x.id)).has(second.body.receipts[0].id));
  const third=await h.call(evidenceRoute,undefined,{limit:2,cursor:second.body.nextCursor});
  assert.equal(third.body.receipts.length,1);assert.equal(third.body.nextCursor,null);
});
await test('invalid cursor is rejected rather than mixing other release history',async()=>{
  const h=harness({user:'admin',admin:true});const r=await h.call(evidenceRoute,undefined,{cursor:'another-release'});assert.equal(r.status,400);
});
await test('Packet list explicitly separates recipient catalogue and Library author mode',async()=>{
  async function list(admin) {
    const handlers=new Map();
    const packet={id:'packet',parentId:'root',type:'folder',source:'packet',packetDefinition:{id:'definition',audienceJson:audience,kind:'training',versionLabel:'2.1',completionMode:'none'}};
    const root={id:'root',type:'folder'};
    const db={libraryItem:{findMany:async args=>args.where?.parentId==='root'?[packet]:[{id:'secret',parentId:'packet',type:'file',extension:'pdf',updatedAt:new Date()}]},
      packetCompletion:{findMany:async()=>[]},studioForm:{findMany:async()=>[]},studioFormSubmission:{findMany:async()=>[]}};
    const app={get:(path,fn)=>handlers.set(path,fn),post(){},patch(){}};
    route.registerPacketRoutes({app,prisma:db,readSettings:async()=>({packetsEnabled:true}),
      accessContext:async()=>({user:{id:'member'},decorated:{isAdmin:admin}}),
      hasToolPermission:(_user,_role,_tool,level)=>level!=='edit',
      visibleFor:(_ctx,_item,verb)=>verb!=='edit'||admin,ensurePacketsRoot:async()=>root,
      serializeLibraryItem:x=>x,itemInclude:{},clearLibraryContextCache(){},logActivity:async()=>{}});
    return handlers.get('/api/packets')({}, {code(){return this},send(){return this}});
  }
  const recipient=await list(false);assert.equal(recipient.packets[0].canAuthor,false);
  assert.equal(recipient.packets[0].packetStats.total,0);
  const author=await list(true);assert.equal(author.packets[0].canAuthor,true);
  assert.equal(author.packets[0].packetStats.total,1);
});
await test('recipient UI renders detached releases without fetching Library sources',async()=>{
  const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
  assert.match(ui,/if \(!packets\.find\(\(entry\) => entry\.id === packetId\)\?\.canAuthor\)/);
  assert.match(ui,/activePacket\.canAuthor \? <>/);
  assert.match(ui,/Published delivery only/);
  assert.match(ui,/activePacket\?\.canAuthor && activeItem/);
});
await test('schema and UI have a real reporting contract',async()=>{
  const schema=readFileSync('apps/server/prisma/schema.prisma','utf8');
  const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
  const sql=readFileSync('apps/server/prisma/migrations/20261019161500_td6_g03_packet_delivery_receipts/migration.sql','utf8');
  assert.match(schema,/model PacketDeliveryReceipt/);assert.match(sql,/PacketDeliveryReceipt_releaseId_fkey/);
  for(const marker of ['Delivery issuance history','inspectDeliveryEvidence','authorized_issuance_not_confirmed_download','Load earlier issuances'])assert.ok(ui.includes(marker),marker);
});
console.log(`TD6 G03 Packet delivery evidence: ${checks}/${checks} executable checks passed`);
