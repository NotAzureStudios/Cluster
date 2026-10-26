import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const hash = (x) => createHash('sha256').update(x).digest('hex');
function load(file, injected={}) {
  const source = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
  assert.equal(source.diagnostics?.length,0);
  const module={exports:{}};
  vm.runInNewContext(source.outputText,{module,exports:module.exports,Buffer,TextDecoder,Map,Set,JSON,Number,Date,Error,Math,Uint32Array,require:(name)=>injected[name]??require(name)},{filename:file});
  return module.exports;
}
const fileApi = load('apps/server/src/domains/library/packet-verified-file.ts');
const audio = load('apps/server/src/domains/library/packet-file-audio-derivative.ts',{'./packet-verified-file.js':fileApi});
const publication = load('apps/server/src/domains/library/packet-publication.ts');
const bundle = load('apps/server/src/domains/library/packet-bundle.ts',{'./packet-publication.js':publication});
let checks=0;
async function test(name,action) {await action();checks++;console.log(`PASS ${name}`);}
function chunk(name,bytes) {
  const pad=bytes.length%2;
  const data=Buffer.alloc(bytes.length+8+pad);
  data.write(name,0,'ascii');data.writeUInt32LE(bytes.length,4);bytes.copy(data,8);
  return data;
}
function sourceWave({seconds=8.5,rate=16_000,channels=2,bits=16,format=1,metadata=true}={}) {
  const fmt=Buffer.alloc(16);
  fmt.writeUInt16LE(format,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(rate,4);
  fmt.writeUInt32LE(rate*channels*bits/8,8);fmt.writeUInt16LE(channels*bits/8,12);fmt.writeUInt16LE(bits,14);
  const count=Math.ceil(rate*seconds);
  const data=Buffer.alloc(count*channels*bits/8);
  for(let i=0;i<count;i++)for(let c=0;c<channels;c++) {
    const value=Math.sin(i*2*Math.PI*440/rate)*0.35;
    if(bits===16)data.writeInt16LE(Math.round(value*32767),i*channels*2+c*2);
    else data[i*channels+c]=Math.round(128+value*127);
  }
  const chunks=[chunk('fmt ',fmt),...(metadata?[chunk('LIST',Buffer.from('SECRET_AUTHOR_METADATA'))]:[]),chunk('data',data)];
  const out=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),...chunks]);
  out.writeUInt32LE(out.length-8,4);
  return out;
}
const root=mkdtempSync(join(tmpdir(),'cluster-packet-audio-'));
const library=join(root,'library');mkdirSync(library);
const original=sourceWave();writeFileSync(join(library,'approved.wav'),original);
const item={id:'audio1',parentId:'packet',type:'file',fileName:'approved.wav',extension:'wav',mimeType:'audio/wav',sizeBytes:original.length,checksumSha256:hash(original),title:'Staff rehearsal',classification:'internal',revision:4,status:'active'};
const manifest=JSON.stringify({schema:1,sourceItems:[{sourceId:'audio1',checksumSha256:item.checksumSha256,revision:4,title:item.title,kind:item.type}]});
const releaseManifest=JSON.stringify({schema:1,versionLabel:'1.0',distributionPolicy:'derived_only',sourceItems:[{sourceId:'audio1',title:item.title,kind:'file',checksumSha256:item.checksumSha256,revision:4}]});
const release={id:'release1',versionLabel:'1.0',manifestJson:releaseManifest,manifestSha256:hash(releaseManifest),publishedAt:new Date('2026-10-01T00:00:00Z')};
try {
  let created;
  await test('PCM WAV is detached, downmixed and bounded to eight seconds', async()=> {
    created=await audio.buildPacketFileAudioDerivatives(manifest,[item],library);
    assert.equal(created.length,1);
    const [entry]=created;
    assert.equal(entry.position,1);assert.equal(entry.format,'wav');
    assert.equal(entry.content.length,96_044);
    assert.equal(entry.content.readUInt32LE(24),12_000);
    assert.equal(entry.content.readUInt16LE(22),1);
    assert.equal(entry.content.readUInt16LE(34),8);
    assert.equal(entry.content.readUInt32LE(40),96_000);
    assert.equal(entry.sha256,hash(entry.content));
    assert.ok(!entry.content.includes('SECRET_AUTHOR_METADATA'));
    assert.notDeepEqual(entry.content,original);
  });
  await test('exactly the same preview can be reconstructed deterministically', async()=> {
    assert.equal(hash(audio.renderPacketPcmWavPreview(original)),created[0].sha256);
  });
  await test('8-bit and mono PCM is also supported without native codec dependencies', async()=> {
    const wav=sourceWave({rate:8_000,channels:1,bits:8,seconds:2,metadata:false});
    const out=audio.renderPacketPcmWavPreview(wav);
    assert.equal(out.length,24_044);assert.equal(out.readUInt32LE(24),12_000);
  });
  await test('WAVEFORMATEX compressed codecs fail closed',async()=> {
    assert.throws(()=>audio.renderPacketPcmWavPreview(sourceWave({format:3})),/PACKET_AUDIO_UNSUPPORTED/);
  });
  await test('corrupted RIFF size and trailing data are rejected',async()=> {
    const corrupted=Buffer.concat([original,Buffer.from('stale data')]);
    assert.throws(()=>audio.renderPacketPcmWavPreview(corrupted),/PACKET_AUDIO_INVALID/);
  });
  await test('truncated chunk and invalid channel alignment are rejected',async()=> {
    const malformed=Buffer.from(original);malformed.writeUInt32LE(999999,16);
    assert.throws(()=>audio.renderPacketPcmWavPreview(malformed),/PACKET_AUDIO_INVALID/);
    const alignment=Buffer.from(original);alignment.writeUInt16LE(12,32);
    assert.throws(()=>audio.renderPacketPcmWavPreview(alignment),/PACKET_AUDIO_UNSUPPORTED/);
  });
  await test('invalid duplicate fmt and too many arbitrary chunks are blocked',async()=> {
    const extra=chunk('fmt ',Buffer.alloc(16));
    const duplicate=Buffer.concat([original,extra]);duplicate.writeUInt32LE(duplicate.length-8,4);
    assert.throws(()=>audio.renderPacketPcmWavPreview(duplicate),/PACKET_AUDIO_UNSUPPORTED/);
    const many=Buffer.concat([original,...Array.from({length:65},()=>chunk('JUNK',Buffer.alloc(0)))]);many.writeUInt32LE(many.length-8,4);
    assert.throws(()=>audio.renderPacketPcmWavPreview(many),/PACKET_AUDIO_INVALID/);
  });
  await test('classification, extension and MIME boundaries deny unauthorized sources',async()=> {
    for(const patch of [{classification:'restricted'},{extension:'mp3'},{mimeType:'audio/mpeg'},{mimeType:'video/mp4'}])
      assert.equal((await audio.buildPacketFileAudioDerivatives(manifest,[{...item,...patch}],library)).length,0);
  });
  await test('changed revision or checksum is rejected',async()=> {
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[{...item,revision:5}],library),/SOURCE_CHANGED/);
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[{...item,checksumSha256:'f'.repeat(64)}],library),/SOURCE_CHANGED/);
  });
  await test('filesystem path traversal and symlink source are rejected',async()=> {
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[{...item,fileName:'../approved.wav'}],library),/PATH_UNSAFE/);
    symlinkSync(join(library,'approved.wav'),join(library,'linked.wav'));
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[{...item,fileName:'linked.wav'}],library),/PATH_UNSAFE/);
  });
  await test('tampered source bytes are never silently returned',async()=> {
    writeFileSync(join(library,'approved.wav'),Buffer.alloc(original.length,0));
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[item],library),/SOURCE_CHANGED/);
    writeFileSync(join(library,'approved.wav'),original);
  });
  await test('total published derivative budget includes previous adapters',async()=> {
    await assert.rejects(audio.buildPacketFileAudioDerivatives(manifest,[item],library,[{position:99,sizeBytes:1_000_000}]),/TOO_LARGE/);
  });
  await test('recipient catalogue marks WAV as excerpt without revealing source details',async()=> {
    const catalog=publication.packetRecipientCatalog(release,new Map([[1,'wav']]));
    assert.equal(catalog.contents[0].previewOnly,true);
    assert.equal(catalog.contents[0].format,'wav');
    assert.ok(!('sourceId' in catalog.contents[0]));
    assert.ok(!JSON.stringify(catalog).includes(item.checksumSha256));
  });
  await test('artifact verifier rejects damaged or deceptive WAV content',async()=> {
    const good=publication.verifyPacketDerivative(created[0]);assert.deepEqual(good,created[0].content);
    assert.throws(()=>publication.verifyPacketDerivative({...created[0],content:Buffer.alloc(created[0].content.length)}),/INTEGRITY/);
    const forged=Buffer.from(created[0].content);forged.writeUInt32LE(1,24);
    assert.throws(()=>publication.verifyPacketDerivative({...created[0],content:forged,sha256:hash(forged)}),/FORMAT_INVALID/);
  });
  await test('ZIP includes detached WAV and does not include original source metadata',async()=> {
    const zip=bundle.buildPacketDerivativeBundle(release,created);
    assert.ok(zip.bytes.includes(Buffer.from('media/preview-0001.wav')));
    assert.ok(!zip.bytes.includes(Buffer.from('SECRET_AUTHOR_METADATA')));
    assert.ok(zip.bytes.includes(Buffer.from('"deliveryKind": "excerpt"')));
    assert.equal(zip.count,1);
  });
  await test('publication and recipient endpoints explicitly wire the audio format',async()=> {
    const routes=readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8');
    const ui=readFileSync('packages/renderer/src/features/packets/PacketsPage.tsx','utf8');
    for(const marker of ['audioDerivatives','buildPacketFileAudioDerivatives','audio/wav','eligibleAudioPreviews'])assert.ok(routes.includes(marker),marker);
    for(const marker of ['Publish + audio previews','eligibleAudioPreviews','previewOnly','packet-deliveries.zip','Audio preview (up to 8 sec, reduced quality)'])assert.ok(ui.includes(marker),marker);
    const artifactRoute=routes.split('app.get("/api/packets/:packetId/deliveries/:releaseId/artifacts/:position"')[1].split('app.get("/api/packets/:packetId/deliveries/:releaseId/bundle"')[0];
    for(const marker of ['packetRecipientCatalog(release)','publishedPacketAudience(release)','studioAudienceMatchesUser','verifyPacketDerivative(artifact)','audio/wav'])assert.ok(artifactRoute.includes(marker),marker);
    assert.ok(!artifactRoute.includes('readPacketVerifiedSourceFile'));
    assert.ok(!artifactRoute.includes('libraryFilesRoot'));
  });
  // Exercise the same registered Fastify handler bodies used by production.
  // No source-file read API is injected into recipient delivery handlers.
  const zChain={min(){return this;},max(){return this;},int(){return this;},default(){return this;}};
  const z={object:()=>({parse:value=>({...value,position:value?.position!==undefined?Number(value.position):undefined})}),string:()=>zChain,boolean:()=>zChain,coerce:{number:()=>zChain}};
  const audience=JSON.stringify({mode:'users',targets:['member']});
  const sealedManifest=JSON.stringify({...JSON.parse(releaseManifest),audienceJson:audience});
  const sealed={...release,manifestJson:sealedManifest,manifestSha256:hash(sealedManifest)};
  const issuance=load('apps/server/src/domains/library/packet-delivery-issuance.ts');
  const mockModules={
    './packet-delivery-issuance.js':issuance,
    zod:{z},'./packet-publication.js':publication,'./packet-bundle.js':bundle,
    './packet-file-audio-derivative.js':audio,
    './packet-pdf-derivative.js':{buildPacketNotePdfDerivatives:async()=>[],renderPacketTextPdfDerivatives:async()=>[]},
    './packet-file-text-derivative.js':{buildPacketFileTextDerivatives:async()=>[]},
    './packet-file-image-derivative.js':{buildPacketFileImageDerivatives:async()=>[]},
    './packet-file-pdf-derivative.js':{buildPacketFilePdfDerivatives:async()=>[]},
    '@cluster/shared':{packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}},
    '../access/studio-audience.js':{studioAudienceMatchesUser:async(_,frozen,user)=>frozen===audience&&user.id==='member',loadStudioAudienceUserContext:async(_db,user)=>({id:user.id}),studioAudienceMatchesContext:(frozen,userId)=>frozen===audience&&userId==='member'},
    '../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},
    '../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}},
  };
  const routeModule=load('apps/server/src/domains/library/packet-routes.ts',mockModules);
  async function deliver({route='artifact',userId='member',revoked=false,valid=true,packetVisible=true,authorized=true}={}) {
    const map=new Map(),audit=[];
    const app={get:(path,fn)=>map.set(`GET ${path}`,fn),post:()=>{},patch:()=>{}};
    const packet={id:'packet',type:'folder',source:'packet',packetDefinition:{id:'definition'}};
    const prisma={libraryItem:{findFirst:async()=>packet},packetRelease:{findFirst:async()=>({...sealed,revokedAt:revoked?new Date():null})},
      packetReleaseDerivative:{findUnique:async()=>valid?created[0]:{...created[0],content:Buffer.from('corrupt')},findMany:async()=>valid?created:[{...created[0],content:Buffer.from('corrupt')}]}, packetDeliveryReceipt:{create:async()=>({id:'receipt1'})},user:{findFirst:async({where})=>({id:where.id})},
      $transaction:async callback=>callback(prisma),$queryRaw:async()=>[{...sealed,revokedAt:revoked?new Date():null}]};
    routeModule.registerPacketRoutes({app,prisma,libraryFilesRoot:'/definitely-not-a-library',readSettings:async()=>({packetsEnabled:true}),
      accessContext:async()=>({user:{id:userId},decorated:{isAdmin:false}}),hasToolPermission:()=>authorized,
      visibleFor:()=>packetVisible,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},
      serializeLibraryItem:x=>x,clearLibraryContextCache:()=>{},logActivity:async record=>{audit.push(record)}});
    const endpoint=map.get(`GET /api/packets/:packetId/deliveries/:releaseId/${route==='bundle'?'bundle':'artifacts/:position'}`);
    assert.ok(endpoint);
    const reply={status:200,headers:{},body:null,code(v){this.status=v;return this;},header(k,v){this.headers[k]=v;return this;},type(v){this.headers['Content-Type']=v;return this;},send(v){this.body=v;return this;}};
    await endpoint({params:{packetId:'packet',releaseId:'release1',position:'1'}},reply);
    return {reply,audit};
  }
  await test('real audio artifact endpoint serves detached WAV to the frozen audience',async()=>{
    const {reply,audit}=await deliver();
    assert.equal(reply.status,200);assert.equal(reply.headers['Content-Type'],'audio/wav');
    assert.equal(reply.headers['Cache-Control'],'private, no-store');
    assert.equal(reply.headers['X-Content-Type-Options'],'nosniff');
    assert.equal(reply.headers['Content-Length'],String(created[0].sizeBytes));
    assert.deepEqual(reply.body,created[0].content);assert.equal(audit.length,1);
  });
  await test('real bundle endpoint delivers WAV with no access to raw Library root',async()=>{
    const {reply,audit}=await deliver({route:'bundle'});
    assert.equal(reply.status,200);assert.equal(reply.headers['Content-Type'],'application/zip');
    assert.ok(reply.body.includes(Buffer.from('media/preview-0001.wav')));
    assert.equal(audit.length,1);
  });
  await test('real endpoints deny revoked release and revoked audience',async()=>{
    for(const route of ['artifact','bundle']){
      assert.equal((await deliver({route,revoked:true})).reply.status,404);
      assert.equal((await deliver({route,userId:'stranger'})).reply.status,404);
    }
  });
  await test('real endpoints deny missing Packet permission or visibility',async()=>{
    assert.equal((await deliver({packetVisible:false})).reply.status,404);
    assert.equal((await deliver({authorized:false})).reply.status,403);
  });
  await test('real endpoints reject corrupted artifacts without activity evidence',async()=>{
    for(const route of ['artifact','bundle']){
      const {reply,audit}=await deliver({route,valid:false});
      assert.equal(reply.status,409);assert.equal(audit.length,0);
    }
  });
  console.log(`${checks}/${checks} TD6 F05 Packet audio preview checks passed`);
}finally{rmSync(root,{recursive:true,force:true});}
