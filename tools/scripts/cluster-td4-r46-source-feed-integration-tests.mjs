import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
function load(file,importer) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:importer,Map,Set,Promise,Error,String,Array,Boolean,Date,Number,BigInt,JSON,Math,console,process,setInterval,clearInterval},{filename:file});
  return mod.exports;
}
const providers=load('apps/server/src/domains/changes/resource-change-providers.ts',(id)=> {
  if(id==='../access/studio-audience.js')return {studioAudienceMatchesContext:()=>false};
  throw Error('Unexpected provider module '+id);
});
const string={regex(){return this},optional(){return this}};
const routes=load('apps/server/src/domains/changes/resource-change-routes.ts',(id)=>{
  if(id==='zod')return {z:{object:()=>({parse:q=>q}),coerce:{string:()=>string}}};
  if(id==='@cluster/shared')return {CLUSTER_ACCESS_TARGET_KINDS:['project','board','library'],clusterResourceChangesQuerySchema:{parse:q=>({after:String(q.after||0),limit:250})}};
  if(id==='../../core/api-response.js')return {apiError:(_req,reply,status,code)=>{reply.code(status);return {ok:false,code}}};
  if(id==='../../core/resource-change-runtime.js')return {
    resourceChangeWindow:async()=>({floor:0n,latest:100n}),readResourceChanges:async()=>feed,
    resourceChangeSequenceIdentity: async (_db, sequence) => sequence > 0n ? `test-${sequence.toString()}` : null, latestResourceChangeSequence:async()=>100n,
  };
  if (id==='./resource-change-tool-lifecycle.js') return {enabledResourceChanges:(changes,isEnabled)=>changes,resourceChangeToolAvailabilityFingerprint:()=>"all-enabled"};
    if(id==='./resource-change-providers.js')return providers;
  if(id==='../planning/calendar-access.js')return {canAccessCalendarEvent:async()=>false};
  if(id==='../access/studio-audience.js')return {loadStudioAudienceUserContext:async()=>({})};
  if(id==='../workforce/workforce-user-authority.js')return {WORKFORCE_USER_AUTHORITY_INCLUDE:{}};
  throw Error('Unexpected route module '+id);
});
let feed=[];let failRules=false;let denied=[];let permittedProjects=['P1','P2'];let linkedProjects=['P1','P2'];let toolEnabled=true;let suspended=false;
let archivedRepo=false;let actorRole='member';let readPairs=[];
const user={id:'U1',authenticationGeneration:1};
const projectRows=[{id:'P1',archived:false},{id:'P2',archived:false}];
const prisma={
  session:{findUnique:async()=>({id:'S1',userId:'U1',authenticationGeneration:1,expiresAt:new Date(Date.now()+60_000),revokedAt:null,user:{...user,accountState:suspended?'SUSPENDED':'ACTIVE'}})},
  sourceRepository:{findMany:async({where})=>archivedRepo?[]:where.id.in.includes('R1')?[{id:'R1',projects:linkedProjects.map(projectId=>({projectId}))}]:[]},
  sourceReview:{findMany:async({where})=>archivedRepo?[]:where.id.in.includes('V1')?[{id:'V1',projectId:'P2',repository:{projects:linkedProjects.map(projectId=>({projectId}))}}]:[]},
  sourceCommit:{findMany:async({where})=>archivedRepo?[]:where.id.in.includes('C1')?[{id:'C1',repository:{projects:linkedProjects.map(projectId=>({projectId}))}}]:[]},
  accessRule:{findMany:async({where})=>{if(failRules)throw Error('Access Rule storage unavailable');readPairs=where.OR;return denied.map(targetId=>({targetKind:'project',targetId,effect:'deny',status:'active'}))}},
  project:{findMany:async({where})=>projectRows.filter(p=>where.id.in.includes(p.id)&&permittedProjects.includes(p.id))},
};
const authorization={
  hasToolPermission:(_user,_role,key)=>key==='sourceControl'&&toolEnabled,
  hasTargetAccess:(_user,_role,kind,id,project,rules)=>kind==='project'&&project?.id===id&&permittedProjects.includes(id)&&!rules.some(r=>r.effect==='deny'&&r.targetId===id),
};
const requests=new Map();
routes.registerResourceChangeRoutes({
  app:{get:(route,handler)=>requests.set(route,handler)},prisma,authorization,
  libraryAccess:{contextForUser:async()=>({}),visibleFor:()=>false},
  getCurrentSession:async()=>({id:'S1',userId:'U1'}),
  decorateUserForClient:async()=>({workspaceRole:actorRole,isAdmin:actorRole==='admin'}),
  isConfigurableToolEnabled:()=>true,changeRuntime:{subscribe:()=>()=>{}},
});
const entry=(kind,id,projectId,sequence)=>({sequence:String(sequence),eventType:'source.changed',resource:{kind,id,...(projectId===undefined?{}:{projectId})},occurredAt:new Date().toISOString()});
async function pull(entries){feed=entries;const reply={status:200,headers:{},code(code){this.status=code;return this},header(key,v){this.headers[key]=v;return this}};return {reply,body:await requests.get('/api/changes')({query:{after:'0'},raw:{}},reply)}}
let count=0;
async function test(label,action){try{await action();count++;console.log('PASS',label)}catch(e){console.error('FAIL',label,e);process.exitCode=1}}
await test('canonical review resolves Project access rules when event scope omitted',async()=>{
  const result=await pull([entry('source_review','V1',undefined,1)]);
  assert.equal(result.body.changes.length,1);
  assert.ok(readPairs.some(r=>r.targetId==='P2'));
});
await test('repository linked to two Projects restricts events to the explicit scope',async()=>{
  denied=['P2'];const result=await pull([entry('source_repository','R1','P1',1),entry('source_repository','R1','P2',2)]);
  assert.deepEqual(result.body.changes.map(c=>c.resource.projectId).join(','),'P1');
  assert.equal(result.body.cursor,'2');denied=[];
});
await test('unscoped repository invalidation honors one permitted binding',async()=>{
  denied=['P1'];const {body}=await pull([entry('source_repository','R1',undefined,1)]);
  assert.equal(body.changes.length,1);denied=[];
});
await test('unscoped commit denied when all linked Projects are forbidden',async()=>{
  denied=['P1','P2'];const {body}=await pull([entry('source_commit','C1',undefined,1)]);
  assert.equal(body.changes.length,0);denied=[];
});
await test('source review never inherits permission from the wrong binding',async()=>{
  denied=['P2'];const {body}=await pull([entry('source_review','V1','P2',1)]);
  assert.equal(body.changes.length,0);denied=[];
});
await test('invalid Project scope fails even when another binding is authorized',async()=>{
  const {body}=await pull([entry('source_repository','R1','P999',1)]);assert.equal(body.changes.length,0);
});
await test('revoked Project membership removes live stream visibility',async()=>{
  permittedProjects=[];const {body}=await pull([entry('source_repository','R1',undefined,1)]);assert.equal(body.changes.length,0);permittedProjects=['P1','P2'];
});
await test('source tool disabled removes all provider visibility',async()=>{
  toolEnabled=false;const {body}=await pull([entry('source_commit','C1','P1',1)]);assert.equal(body.changes.length,0);toolEnabled=true;
});
await test('archived repository suppresses all source records',async()=>{
  archivedRepo=true;const {body}=await pull([entry('source_commit','C1','P1',1),entry('source_review','V1','P2',2)]);assert.equal(body.changes.length,0);archivedRepo=false;
});
await test('Access Rule query failure rejects instead of granting event access',async()=>{
  failRules=true;await assert.rejects(pull([entry('source_review','V1','P2',1)]),/Access Rule storage unavailable/);failRules=false;
});
await test('suspended account cannot receive source events',async()=>{
  suspended=true;const {reply,body}=await pull([entry('source_commit','C1','P1',1)]);assert.equal(reply.status,401);assert.equal(body.code,'AUTH_REQUIRED');suspended=false;
});
await test('admin cannot bypass fabricated source record or Project binding',async()=>{
  actorRole='admin';const {body}=await pull([entry('source_review','MISSING','P2',1),entry('source_repository','R1','P9',2)]);assert.equal(body.changes.length,0);actorRole='member';
});
if(process.exitCode)process.exit(process.exitCode);
console.log(`${count}/${count} R46 HTTP feed integration checks passed`);
