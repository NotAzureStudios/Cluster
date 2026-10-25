import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const http={createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,status})};
const chain={trim(){return this},min(){return this},max(){return this},optional(){return this},nullable(){return this},default(){return this},int(){return this},datetime(){return this}};
const z={object:()=>({parse:v=>v}),string:()=>chain,enum:()=>chain,array:()=>chain};
function load(path,imports={}){
 const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
 assert.equal(js.diagnostics?.length,0);
 const module={exports:{}};
 vm.runInNewContext(js.outputText,{module,exports:module.exports,require:id=>imports[id]??require(id),Buffer,Date,Map,Set,Promise,JSON,Number,Boolean,Math,Error,Array,String,console,process},{filename:path});
 return module.exports;
}
const lifecycleFile='apps/server/src/domains/projects/project-delivery-lifecycle-service.ts';
const build={id:'B1',projectId:'P1',version:'1.0',title:'Release',channel:'internal',qaStatus:'passed',approval:'approved',revision:3,signed:false,createdAt:new Date('2026-10-11'),updatedAt:new Date('2026-10-12'),ownerId:'builder',createdById:'builder'};
const project={id:'P1',name:'Demo',projectType:'game',archived:false,updatedAt:new Date('2026-10-01')};
const now=new Date('2026-10-17');
const createPayload=x=>({id:x.id,entityId:x.entityId||x.id,projectId:'P1',createdAt:now,updatedAt:now,payload:JSON.stringify(x)});
function fixture({cards=[],relationships=[],qa=[],decisions=[],policy=null,limits={}}={}){
 const persisted=[...(policy?[createPayload({id:'policy',kind:'deliveryPolicy',channel:'internal',...policy})]:[]),...decisions.map((x,i)=>createPayload({id:'decision'+i,gateId:x.gateId,buildId:x.buildId||'B1',...x}))];
 const db={project:{findFirst:async()=>project,findUnique:async()=>project},clusterPersistenceRecord:{findMany:async()=>persisted.map(x=>({...x,kind:JSON.parse(x.payload).kind||'deliveryApproval'}))},
  deliveryQaPlan:{count:async()=>0},projectRelationship:{findMany:async()=>relationships},card:{findMany:async()=>cards},calendarEvent:{findMany:async()=>[]},scheduleBlock:{findMany:async()=>[]}};
 const items={build:[build,...Array.from({length:limits.build||0},(_,i)=>({...build,id:'old'+i,createdAt:new Date('2020-01-01')}))], 'qa-session':qa,release:[]};
 const deliveryStub={createProjectDeliveryService:()=>({list:async(_ids,kind)=>items[kind]||[]})};
 const lifecycle=load(lifecycleFile,{'./project-delivery-service.js':deliveryStub});
 return {db,lifecycle};
}
await check('core QA/fix/rebuild/build/hold gates always required, even with empty project policy',async()=>{
 const {db,lifecycle}=fixture({policy:{requiredGateIds:[],optionalGateIds:[]}});
 const x=await lifecycle.createProjectDeliveryLifecycleService(db).snapshot('P1');
 assert.equal(x.releaseReady,true);assert.ok(['qa_pass','fixes_clear','rebuild_clear','build_approval','no_active_hold'].every(id=>x.readiness.policy.requiredGateIds.includes(id)));
});
await check('open Board fix linked to Build blocks readiness and provides card navigation',async()=>{
 const card={id:'C1',title:'Fix crash',priority:'high',workItemKind:'card',updatedAt:now, list:{isDone:false,title:'Doing',id:'L1',board:{id:'BOARD',name:'Issues'}}};
 const {db,lifecycle}=fixture({cards:[card],relationships:[{sourceType:'build',sourceId:'B1',targetType:'card',targetId:'C1',relationship:'tracks'}]});
 const x=await lifecycle.createProjectDeliveryLifecycleService(db).snapshot('P1');assert.equal(x.releaseReady,false);assert.equal(x.issues.open,1);assert.equal(x.readiness.gates.find(g=>g.id==='fixes_clear').resource.id,'C1');
});
await check('Ticket in a Done List does not clear a Build fix while triage remains open',async()=>{
 const ticket={id:'T1',title:'Regression',priority:'high',workItemKind:'ticket',ticketStage:'in_progress',updatedAt:now,list:{isDone:true,title:'Done',id:'L1',board:{id:'BOARD',name:'QA fixes'}}};
 const f=fixture({cards:[ticket],relationships:[{sourceType:'build',sourceId:'B1',targetType:'ticket',targetId:'T1',relationship:'tracks'}]});
 const result=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(result.releaseReady,false);assert.equal(result.issues.open,1);assert.equal(result.issues.items[0].ticketStage,'in_progress');
 assert.equal(result.readiness.gates.find(g=>g.id==='fixes_clear').passed,false);
});
await check('a resolved Ticket clears the fix even in an unfinished Board List',async()=>{
 const ticket={id:'T1',title:'Regression',priority:'high',workItemKind:'ticket',ticketStage:'resolved',updatedAt:now,list:{isDone:false,title:'Intake',id:'L1',board:{id:'BOARD',name:'QA fixes'}}};
 const f=fixture({cards:[ticket],relationships:[{sourceType:'build',sourceId:'B1',targetType:'ticket',targetId:'T1',relationship:'tracks'}]});
 const result=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(result.issues.open,0);assert.equal(result.issues.resolved,1);assert.equal(result.readiness.gates.find(g=>g.id==='fixes_clear').passed,true);
});
await check('rejected or unstaged Tickets fail closed irrespective of Board List completion',async()=>{
 for (const stage of ['rejected',undefined]) {
  const ticket={id:'T1',title:'Unresolved',priority:'urgent',workItemKind:'ticket',ticketStage:stage,updatedAt:now,list:{isDone:true,title:'Done',id:'L1',board:{id:'BOARD',name:'QA fixes'}}};
  const f=fixture({cards:[ticket],relationships:[{sourceType:'qa_session',sourceId:'Q1',targetType:'ticket',targetId:'T1',relationship:'tracks'}],qa:[{id:'Q1',buildId:'B1',status:'passed',decision:'go'}]});
  const result=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
  assert.equal(result.issues.open,1,String(stage));assert.equal(result.releaseReady,false,String(stage));
 }
});
await check('ordinary Board Card completion still obeys its own List status',async()=>{
 const make=isDone=>({id:'C2',title:'Ordinary card',priority:'low',workItemKind:'card',updatedAt:now,list:{isDone,title:isDone?'Done':'Doing',id:'L1',board:{id:'BOARD',name:'Work'}}});
 for (const isDone of [true,false]) {
  const f=fixture({cards:[make(isDone)],relationships:[{sourceType:'build',sourceId:'B1',targetType:'card',targetId:'C2'}]});
  const x=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
  assert.equal(x.issues.items[0].done,isDone);
 }
});
await check('external channels retain reviewer and signing gates in project policy defaults',async()=>{
 const f=fixture({policy:{requiredGateIds:[]}});
 build.channel='release';build.signed=false;
 const x=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(x.releaseReady,false);
 assert.ok(['reviewer_approval','signed_artifact','launch_window'].every(id=>x.readiness.policy.requiredGateIds.includes(id)));
 build.channel='internal';
});
await check('an older exception cannot waive core fix work',async()=>{
 const card={id:'C1',title:'Fix crash',priority:'high',workItemKind:'ticket',updatedAt:now,list:{isDone:false,id:'L1',title:'Open',board:{id:'BOARD',name:'Issues'}}};
 const x=fixture({cards:[card],relationships:[{sourceType:'build',sourceId:'B1',targetType:'ticket',targetId:'C1'}],decisions:[{gateId:'fixes_clear',decision:'exception',reason:'please ignore'}]});
 const res=await x.lifecycle.createProjectDeliveryLifecycleService(x.db).snapshot('P1');assert.equal(res.releaseReady,false);assert.equal(res.readiness.gates.find(g=>g.id==='fixes_clear').passed,false);
});
await check('release hold blocks publication, even when build is QA passed',async()=>{
 const f=fixture({decisions:[{gateId:'no_active_hold',decision:'hold',reason:'Missing review'}]});
 const x=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');assert.equal(x.releaseReady,false);assert.ok(x.readiness.activeHold);
});
await check('bounded history fails closed rather than certifying incomplete evidence',async()=>{
 const f=fixture({limits:{build:249}}),x=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(x.releaseReady,false);assert.equal(x.readiness.evidenceComplete,false);assert.ok(x.readiness.incompleteEvidence.includes('Build history'));
});
await check('reviewer approval is bound to exact build revision and separate editor',async()=>{
 const approved={gateId:'reviewer_approval',decision:'approved',reviewerId:'peer',reviewedBuildRevision:3};
 const f=fixture({decisions:[approved],policy:{requiredGateIds:['reviewer_approval']}});
 const current=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(current.readiness.gates.find(g=>g.id==='reviewer_approval').passed,true);
 build.revision=4;
 const stale=await f.lifecycle.createProjectDeliveryLifecycleService(f.db).snapshot('P1');
 assert.equal(stale.readiness.gates.find(g=>g.id==='reviewer_approval').passed,false);
 build.revision=3;
});
const routeFile='apps/server/src/domains/projects/project-delivery-lifecycle-routes.ts';
function routeHarness({actor='peer',creator='builder',owner='builder'}={}){
 let writes=0,handlers={};const f=fixture();
 const prisma={...f.db,deliveryBuild:{findFirst:async()=>({revision:3,createdById:creator,ownerId:owner})},clusterPersistenceRecord:{...f.db.clusterPersistenceRecord,create:async()=>{writes++;return {id:'event'}}}};
 const routes=load(routeFile,{'zod':{z},'../../core/http-errors.js':http,'./project-delivery-lifecycle-service.js':f.lifecycle,
 '../../core/http-cache.js':{sendPrivateRevalidated:(_req,_reply,x)=>x}});
 routes.registerProjectDeliveryLifecycleRoutes({app:{get:(p,h)=>handlers['GET '+p]=h,post:(p,h)=>handlers['POST '+p]=h,put:(p,h)=>handlers['PUT '+p]=h},prisma,
  enforceTargetAccess:async()=>true,getCurrentUser:async()=>({id:actor,displayName:'Reviewer'}),buildPersistenceStorageData:()=>({}),logActivity:async()=>{},projectReadModels:null});
 const call=(body,route='POST /api/projects/:projectId/delivery-lifecycle/decisions')=>handlers[route]({params:{projectId:'P1'},body},{});
 return {call,getWrites:()=>writes};
}
await check('build creator cannot self-approve reviewer decision',async()=>{
 const h=routeHarness({actor:'builder'});await assert.rejects(h.call({buildId:'B1',gateId:'reviewer_approval',decision:'approved'}),e=>e.code==='DELIVERY_INDEPENDENT_REVIEW');assert.equal(h.getWrites(),0);
});
await check('independent reviewer may approve, with unique durable decision identity',async()=>{
 const h=routeHarness();await h.call({buildId:'B1',gateId:'reviewer_approval',decision:'approved'});assert.equal(h.getWrites(),1);
});
await check('a core exception and invalid decision type are rejected before storage',async()=>{
 const h=routeHarness();for(const b of [
  {buildId:'B1',gateId:'qa_pass',decision:'exception',reason:'skip'},
  {buildId:'B1',gateId:'build_approval',decision:'exception',reason:'skip'},
  {buildId:'B1',gateId:'qa_pass',decision:'approved'},
  {buildId:'B1',gateId:'reviewer_approval',decision:'hold',reason:'skip'},
  {buildId:'MISSING',gateId:'reviewer_approval',decision:'approved'},
 ])await assert.rejects(h.call(b));assert.equal(h.getWrites(),0);
});
const deliveryFile='apps/server/src/domains/projects/project-delivery-service.ts';
function serviceHarness({ready=true,qaStatus='passed',approval='approved'}={}){
 let writes=0,qaWrites=0;
 const schemas={deliveryBuildInputSchema:{parse:x=>x},deliveryBuildPatchSchema:{parse:x=>x},deliveryQaPlanInputSchema:{parse:x=>x},deliveryQaSessionInputSchema:{parse:x=>x},deliveryReleaseInputSchema:{parse:x=>x}};
 const readiness=()=>({latestBuild:{id:'B1'},releaseReady:ready,readiness:{gates:ready?[]:[{id:'fixes_clear',required:true,passed:false,label:'Fix work clear'}]}});
 const module=load(deliveryFile,{'../../core/http-errors.js':http,'@cluster/shared':schemas,
  './project-delivery-lifecycle-service.js':{createProjectDeliveryLifecycleService:()=>({snapshot:readiness})}});
 const prisma={project:{findUnique:async()=>project},deliveryBuild:{findFirst:async()=>({id:'B1',qaStatus,approval})},deliveryQaSession:{findFirst:async()=>null},deliveryRelease:{findFirst:async()=>({id:'R1',projectId:'P1',buildId:'B1',revision:2,status:'review'}),update:async({data})=>{writes++;return {id:'R1',projectId:'P1',buildId:'B1',title:data.title,status:data.status,revision:3,build:{version:'1.0',qaStatus:'passed'}}}}};
 return {service:module.createProjectDeliveryService(prisma),writes:()=>writes};
}
const releasePayload={title:'Ship notes',buildId:'B1',status:'published',features:[],fixes:[],knownIssues:[],body:'Details'};
await check('publication invokes authoritative Project/Board/QA readiness and refuses blocked gates',async()=>{
 const x=serviceHarness({ready:false});await assert.rejects(x.service.put('P1','release','R1',releasePayload,2),e=>e.code==='DELIVERY_RELEASE_GATES_BLOCKED'&&e.message.includes('Fix work clear'));assert.equal(x.writes(),0);
});
await check('eligible reviewed release publishes through canonical guarded service',async()=>{
 const x=serviceHarness({ready:true});const record=await x.service.put('P1','release','R1',releasePayload,2);
 assert.equal(record.status,'published');assert.equal(x.writes(),1);
});
await check('publication still blocks an unapproved build before creating a release',async()=>{
 const x=serviceHarness({approval:'draft'});await assert.rejects(x.service.put('P1','release','R1',releasePayload,2),e=>e.code==='DELIVERY_RELEASE_APPROVAL_BLOCKED');assert.equal(x.writes(),0);
});
await check('contradictory QA go/failed cases are rejected before DB writes',async()=>{
 const x=serviceHarness();const input={buildId:'B1',status:'passed',decision:'go',failed:3,blocked:0};
 await assert.rejects(x.service.put('P1','qa-session','QA1',input),e=>e.code==='DELIVERY_QA_EVIDENCE_CONFLICT');
 await assert.rejects(x.service.put('P1','qa-session','QA1',{...input,status:'running',decision:'go',failed:0}),e=>e.code==='DELIVERY_QA_EVIDENCE_CONFLICT');
});
await check('publish and QA UI expose the same authoritative release requirements',()=>{
 const pub=readFileSync(deliveryFile,'utf8'),cmd=readFileSync('packages/renderer/src/features/projects/ProjectDeliveryCommandCenter.tsx','utf8');
 const lifecycleUI=readFileSync('packages/renderer/src/features/projects/ProjectDeliveryLifecycle.tsx','utf8');
 assert.ok(pub.includes('createProjectDeliveryLifecycleService(prisma).snapshot(projectId, input.buildId)'));
 assert.ok(cmd.includes('Independent review is required'));
 assert.ok(lifecycleUI.includes('Blocking delivery gates'));
});
console.log(`${passed}/${passed} G04 Project / QA / release checks passed`);
