/** TD6 G25 Project closeout integration tests: registered Fastify routes with controlled Prisma. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);const ts=require('typescript');
const source='apps/server/src/domains/projects/project-closeout-routes.ts';
const policyFile='apps/server/src/domains/projects/project-closeout-policy.ts';
const http={createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,status})};
const shape={parse:x=>x,optional(){return this},nullable(){return this},default(){return this},int(){return this},positive(){return this},max(){return this},strict(){return this}};
const z={object:()=>shape,string:()=>shape,number:()=>shape,boolean:()=>shape,enum:()=>shape};
function load(file,imports){
 const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.equal(js.diagnostics?.length,0);
 const mod={exports:{}};
 vm.runInNewContext(js.outputText,{module:mod,exports:mod.exports,require:id=>{if(id in imports)return imports[id];throw Error('Unexpected import '+id)},Date,Array,Boolean,JSON,Map,Set,Promise,String,Number,Object,Error,console},{filename:file});
 return mod.exports;
}
const policy=load(policyFile,{});
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS G25 Closeout '+name)}
function fixture({hasBuild=false,sourceLinked=true,deliveryReady=false,incomplete=false,status='draft',hasOpenCard=false,openMilestone=false,ticketStage=undefined,ticketInDone=true}={}){
 let lifecycleCalls=0,projectUpdates=0,revisionConflicts=0,activities=0,permission=true;
 const project={id:'P1',name:'Demo',status:'active',projectType:'game',archived:false,clientName:null,revision:1};
 const record={id:'CO1',projectId:'P1',status,revision:1,payload:JSON.stringify({checklist:{backupExportCreated:true}}),description:null,createdAt:new Date(),updatedAt:new Date()};
 const prisma={
  project:{findUnique:async()=>project,update:async({data})=>{projectUpdates++;Object.assign(project,{status:data.status??project.status,archived:data.archived??project.archived});return project}},
  projectControlRecord:{findFirst:async()=>record,findUnique:async()=>record,count:async()=>openMilestone?1:0,updateMany:async({where,data})=>{if(record.revision!==where.revision||record.status!==where.status)return {count:0};record.revision++;record.status=data.status??record.status;record.payload=data.payload??record.payload;return {count:1}}},
  card:{count:async({where})=>{
   if(where.workItemKind==='ticket'){
     if(ticketStage===undefined)return 0;
     if(where.OR)return ticketStage==='resolved'?0:1;
     return 1;
   }
   // Ordinary Cards keep their Board-column completion behavior.
   if(where.workItemKind?.not==='ticket')return hasOpenCard && (where.list?.isDone===false || !('isDone' in (where.list||{})))?1:0;
   throw Error('Mixed Ticket/Card closeout query is forbidden');
  }},
  libraryItem:{count:async()=>0},
  deliveryBuild:{findFirst:async()=>hasBuild?{id:'B1'}:null},
  projectShareLink:{findMany:async()=>[],updateMany:async()=>({count:0})},
  timeEntry:{findFirst:async()=>null},clusterPersistenceRecord:{findMany:async()=>[]},
  projectSourceBinding:{findFirst:async()=>sourceLinked?{id:'REPO1'}:null},
  accessRule:{updateMany:async()=>({count:0})},
  $transaction:async(fn)=>fn(prisma),
 };
 const gate={id:'qa_pass',required:true,passed:false,label:'QA passed'};
 const lifecycle={createProjectDeliveryLifecycleService:()=>({snapshot:async()=>{
   lifecycleCalls++;
   return {latestBuild:{id:'B1',version:'2.0'},releaseReady:deliveryReady&&!incomplete,readiness:{evidenceComplete:!incomplete,incompleteEvidence:incomplete?['QA history']:[],gates:deliveryReady?[]:[gate]}};
 }})};
 const routes=load(source,{'zod':{z},'../../core/http-errors.js':http,'../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},'./project-closeout-policy.js':policy,'./project-delivery-lifecycle-service.js':lifecycle});
 const handlers=new Map(),app={get:(p,h)=>handlers.set('GET '+p,h),put:(p,h)=>handlers.set('PUT '+p,h),post:(p,h)=>handlers.set('POST '+p,h)};
 routes.registerProjectCloseoutRoutes({app,prisma,getCurrentUser:async()=>({id:'admin'}),decorateUserForClient:async()=>({username:'Admin'}),enforceTargetAccess:async()=>permission,
  authorization:{requestCanTarget:async()=>true},sendRevisionConflict:(_r,_t,_state)=>{revisionConflicts++;return {conflict:true}},logActivity:async()=>{activities++},verifyUserPin:async()=>{},});
 async function call(method='GET',body={}){const handler=handlers.get(method+' /api/projects/:projectId/closeout'+(method==='POST'?'/actions':''));assert.ok(handler);return handler({params:{projectId:'P1'},body},{header(){return this}})}
 return {call,project,record,prisma,setPermission:b=>{permission=b},get updates(){return projectUpdates},get activity(){return activities},get lifecycleCalls(){return lifecycleCalls},get conflicts(){return revisionConflicts}};
}
await test('repository-only Projects remain supported without unnecessary Build lifecycle scan',async()=>{
 const f=fixture();const x=await f.call();assert.equal(x.submissionReady,true);assert.equal(f.lifecycleCalls,0);assert.equal(x.evaluations.find(g=>g.key==='deliveryQaClear').done,true);
});
await test('a release-channel or promoted Build never bypasses failed QA merely because a repo is linked',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false});const x=await f.call();assert.equal(x.submissionReady,false);assert.equal(x.evaluations.find(g=>g.key==='finalBuildLinked').done,true);assert.equal(x.evaluations.find(g=>g.key==='deliveryQaClear').done,false);assert.match(x.evaluations.find(g=>g.key==='deliveryQaClear').evidence,/QA passed/);assert.equal(f.lifecycleCalls,1);
});
await test('latest Build with all authoritative gates passing clears delivery gate',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:true});const x=await f.call();assert.equal(x.submissionReady,true);assert.match(x.evaluations.find(g=>g.key==='deliveryQaClear').evidence,/passed delivery gates/);
});
await test('incomplete delivery evidence fails closed even when source repo exists',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:true,incomplete:true});const x=await f.call();assert.equal(x.submissionReady,false);assert.match(x.evaluations.find(g=>g.key==='deliveryQaClear').evidence,/incomplete.*QA history/i);
});
await test('unauthorized requests do not expose QA readiness or query delivery lifecycle',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false});f.setPermission(false);await f.call();assert.equal(f.lifecycleCalls,0);
});
await test('submit refuses blocked QA inside the status-write transaction and does not create activity',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false});await assert.rejects(f.call('POST',{action:'submit',expectedRevision:1,pin:'1234'}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');assert.equal(f.record.status,'draft');assert.equal(f.updates,0);assert.equal(f.activity,0);
});
await test('verify rechecks QA rather than accepting an earlier submitted checklist',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false,status:'submitted'});await assert.rejects(f.call('POST',{action:'verify',expectedRevision:1}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');assert.equal(f.record.status,'submitted');assert.equal(f.updates,0);
});
await test('archive rechecks QA after verification and cannot revoke external access on an unsafe project',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false,status:'verified'});await assert.rejects(f.call('POST',{action:'archive',expectedRevision:1,pin:'1234'}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');assert.equal(f.record.status,'verified');assert.equal(f.project.archived,false);assert.equal(f.updates,0);
});
await test('a compliant Project can submit, verify, and archive using actual versioned transitions',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:true});for(const action of ['submit','verify','archive']){const x=await f.call('POST',{action,expectedRevision:f.record.revision,pin:'1234'});assert.equal(x.record.status,{submit:'submitted',verify:'verified',archive:'archived'}[action])};assert.equal(f.project.archived,true);assert.equal(f.activity,3);
});
await test('completed project status does not conceal a newly reopened milestone',async()=>{
 const f=fixture({status:'verified',openMilestone:true});f.project.status='completed';const x=await f.call();assert.equal(x.submissionReady,false);assert.equal(x.evaluations.find(g=>g.key==='timelineComplete').done,false);await assert.rejects(f.call('POST',{action:'archive',expectedRevision:1,pin:'1234'}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');
});
await test('an archived Project retains its recorded completion evidence without querying an archived lifecycle',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:false,status:'archived'});f.project.archived=true;const x=await f.call();assert.equal(x.evaluations.find(g=>g.key==='deliveryQaClear').done,true);assert.equal(f.lifecycleCalls,0);assert.match(x.evaluations.find(g=>g.key==='deliveryQaClear').evidence,/historical delivery approval/);
});
await test('verification and archive controls respect new server closeout blockers',()=>{
 const ui=readFileSync('packages/renderer/src/features/projects/CloseoutPortalPanel.tsx','utf8');assert.ok(ui.includes('disabled={busy || !state.submissionReady} onClick={() => void runAction("verify")}'));assert.ok(ui.includes('disabled={busy || !state.submissionReady} onClick={() => void runAction("archive")}'));
});
await test('open Board work remains an independent closeout blocker',async()=>{
 const f=fixture({hasBuild:true,deliveryReady:true,hasOpenCard:true});const x=await f.call();assert.equal(x.submissionReady,false);assert.equal(x.evaluations.find(g=>g.key==='cardsClosed').done,false);assert.equal(x.evaluations.find(g=>g.key==='deliveryQaClear').done,true);
});

await test('unresolved Ticket on a Done column blocks Project closeout',async()=>{
 const f=fixture({ticketStage:'new',ticketInDone:true,deliveryReady:true,hasBuild:true});
 const x=await f.call();assert.equal(x.evaluations.find(g=>g.key==='cardsClosed').done,true);
 assert.equal(x.evaluations.find(g=>g.key==='ticketsResolved').done,false);
 assert.match(x.evaluations.find(g=>g.key==='ticketsResolved').evidence,/1 not resolved \/ 1 Tickets/);
 assert.equal(x.submissionReady,false);
 await assert.rejects(f.call('POST',{action:'submit',expectedRevision:1,pin:'1234'}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');
 assert.equal(f.activity,0);
});
await test('rejected Ticket never masquerades as resolved completion',async()=>{
 const f=fixture({ticketStage:'rejected'});const x=await f.call();
 assert.equal(x.evaluations.find(g=>g.key==='ticketsResolved').done,false);
 assert.equal(x.submissionReady,false);
});
await test('resolved Ticket does not block closeout just because its column remains open',async()=>{
 const f=fixture({ticketStage:'resolved'});const x=await f.call();
 assert.equal(x.evaluations.find(g=>g.key==='ticketsResolved').done,true);
 assert.equal(x.evaluations.find(g=>g.key==='cardsClosed').done,true);
 assert.equal(x.submissionReady,true);
});
await test('reopened Ticket blocks previously verified closeout archival',async()=>{
 const f=fixture({ticketStage:'review',status:'verified'});
 await assert.rejects(f.call('POST',{action:'archive',expectedRevision:1,pin:'1234'}),e=>e.code==='PROJECT_CLOSEOUT_NOT_READY');
 assert.equal(f.project.archived,false);assert.equal(f.activity,0);
});
await test('ordinary unfinished Card remains independent of resolved Ticket',async()=>{
 const f=fixture({hasOpenCard:true,ticketStage:'resolved'});const x=await f.call();
 assert.equal(x.evaluations.find(g=>g.key==='cardsClosed').done,false);
 assert.equal(x.evaluations.find(g=>g.key==='ticketsResolved').done,true);
 assert.equal(x.submissionReady,false);
});
console.log(`${checks}/${checks} G25 Project closeout checks passed`);
