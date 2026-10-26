import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.CLUSTER_TYPESCRIPT_PATH || 'typescript');
const helpers = (() => {
  const src=ts.transpileModule(fs.readFileSync('apps/server/src/domains/library/packet-publication.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};vm.runInNewContext(src,{module,exports:module.exports,require,Buffer,Map,Set,JSON,String,Number,Date},{filename:'packet-publication.ts'});
  return module.exports;
})();
// Production route now also imports the detached ZIP adapter. Execute that
// adapter with the same mocked publication helpers as the route under test.
const packetBundleHelpers = (() => {
  const source = ts.transpileModule(fs.readFileSync('apps/server/src/domains/library/packet-bundle.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:(name)=>name==='./packet-publication.js'?helpers:require(name),Buffer,Uint32Array,Set,Map,JSON,String,Number,Date,Math},{filename:'packet-bundle.ts'});
  return module.exports;
})();
const note = {id:'hidden-source',title:'Note',type:'note',body:'Approved published content',classification:'internal',revision:1,status:'active'};
const definition={id:'def',versionLabel:'2.0',kind:'training',audienceJson:'{"mode":"users","targets":["member"]}',completionMode:'read'};
const manifest=helpers.buildPacketReleaseManifest({id:'packet'},definition,[note]);
const release={id:'release',versionLabel:'2.0',...manifest};
const [derived]=helpers.buildPacketTextDerivatives(manifest.manifestJson,[note]);
const zChain={min(){return this;},max(){return this;},int(){return this;},default(){return this;}};
const z={object:()=>({parse:(input)=>({...input,position:input?.position!==undefined?Number(input.position):undefined})}),string:()=>zChain,boolean:()=>zChain,coerce:{number:()=>zChain}};
const shared={packetCompletionInputSchema:{parse:x=>x},packetDefinitionInputSchema:{parse:x=>x},packetDefinitionPatchSchema:{parse:x=>x},studioAudienceSchema:{parse:x=>x}};
const getMock=(isAllowed)=>({studioAudienceMatchesUser:async (_p, frozen, user)=>isAllowed && frozen===definition.audienceJson && user.id==='member'});
const routesSource=ts.transpileModule(fs.readFileSync('apps/server/src/domains/library/packet-routes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let checks=0;
async function execute({userId='member',canAudience=true,canSee=true,manifestValid=true,artifactValid=true,artifactExists=true}={}) {
  const routeMap=new Map();const audit=[];
  const packet={id:'packet',packetDefinition:definition,type:'folder',source:'packet'};
  const app={get:(path,fn)=>routeMap.set(`GET ${path}`,fn),post:(path,fn)=>routeMap.set(`POST ${path}`,fn),patch:(path,fn)=>routeMap.set(`PATCH ${path}`,fn)};
  const prisma={libraryItem:{findFirst:async()=>packet},packetRelease:{findFirst:async()=>manifestValid?release:{...release,manifestJson:'{}'}},packetReleaseDerivative:{findUnique:async()=>artifactExists?{...derived,content:artifactValid?derived.content:Buffer.from('broken')} : null}};
  const mocks={zod:{z},'./packet-publication.js':helpers,'./packet-pdf-derivative.js':{buildPacketNotePdfDerivatives:async()=>[]},'./packet-file-text-derivative.js':{buildPacketFileTextDerivatives:async()=>[]},'./packet-file-image-derivative.js':{buildPacketFileImageDerivatives:async()=>[]},'./packet-file-audio-derivative.js':{buildPacketFileAudioDerivatives:async()=>[]},'./packet-file-pdf-derivative.js':{buildPacketFilePdfDerivatives:async()=>[]},'./packet-bundle.js':packetBundleHelpers,'@cluster/shared':shared,'../access/studio-audience.js':getMock(canAudience),'../studio-systems/studio-knowledge-runtime.js':{packetCompletionState:()=>({}),reconcileStudioKnowledgeAssignments:async()=>{}},'../studio-systems/studio-knowledge-evidence.js':{ensureStudioKnowledgePersonnelRecord:async()=>{}}};
  const module={exports:{}};vm.runInNewContext(routesSource,{module,exports:module.exports,require:(name)=>name in mocks?mocks[name]:require(name),Buffer,Date,JSON,String,Number,Set,Map,console},{filename:'packet-routes.ts'});
  module.exports.registerPacketRoutes({app,prisma,readSettings:async()=>({packetsEnabled:true}),accessContext:async()=>({user:{id:userId},decorated:{isAdmin:false}}),hasToolPermission:()=>true,visibleFor:()=>canSee,ensurePacketsRoot:async()=>({id:'root'}),itemInclude:{},serializeLibraryItem:x=>x,clearLibraryContextCache:()=>{},logActivity:async(event)=>{audit.push(event)}});
  const endpoint=routeMap.get('GET /api/packets/:packetId/deliveries/:releaseId/artifacts/:position');assert.ok(endpoint);
  const response={status:200,headers:{},body:null,code(number){this.status=number;return this;},header(k,v){this.headers[k]=v;return this;},type(value){this.headers['Content-Type']=value;return this;},send(value){this.body=value;return this;}};
  await endpoint({params:{packetId:'packet',releaseId:'release',position:'1'}},response);
  return {response,audit};
}
const test=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
await test('Authorized member receives immutable detached bytes',async()=>{const {response,audit}=await execute();assert.equal(response.status,200);assert.equal(response.body.toString(),derived.content.toString());assert.equal(audit.length,1);assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.equal(response.headers['Cache-Control'],'private, no-store');});
await test('Frozen audience denial returns 404 without leaking artifact',async()=>{const {response,audit}=await execute({canAudience:false});assert.equal(response.status,404);assert.equal(audit.length,0);});
await test('Packet visibility denial returns 404',async()=>{const {response}=await execute({canSee:false});assert.equal(response.status,404);});
await test('Tampered published manifest blocks download',async()=>{const {response}=await execute({manifestValid:false});assert.equal(response.status,409);});
await test('Corrupted published derivative blocks download',async()=>{const {response,audit}=await execute({artifactValid:false});assert.equal(response.status,409);assert.equal(audit.length,0);});
await test('Missing derivative never falls back to source',async()=>{const {response}=await execute({artifactExists:false});assert.equal(response.status,404);});
await test('Unauthorized user outside frozen audience cannot download',async()=>{const {response}=await execute({userId:'stranger'});assert.equal(response.status,404);});
console.log(`${checks}/${checks} Packet detached delivery endpoint checks passed`);
