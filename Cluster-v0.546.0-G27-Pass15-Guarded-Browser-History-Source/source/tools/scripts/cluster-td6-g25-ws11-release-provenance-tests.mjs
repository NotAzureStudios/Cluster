#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
let passed=0;
async function test(label,run){ await run(); console.log(`PASS ${label}`); passed++; }
function load(file, imports={}) {
  const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},reportDiagnostics:true});
  assert.equal(output.diagnostics?.length,0);
  const module={exports:{}};
  vm.runInNewContext(output.outputText,{module,exports:module.exports,require:(id)=>imports[id]??require(id),Buffer,Date,Promise,Map,Set,Array,String,Boolean,Number,JSON,Math,Error,console,process},{filename:file});
  return module.exports;
}
const lifecyclePath='apps/server/src/domains/projects/project-delivery-lifecycle-service.ts';
const servicePath='apps/server/src/domains/projects/project-delivery-service.ts';
const releaseTime=new Date('2026-10-20T12:00:00Z');
const project={id:'P1',name:'Project',projectType:'game',updatedAt:releaseTime};
const baseBuild={id:'BUILD',projectId:'P1',version:'0.546.0',title:'Candidate',sourceRepositoryId:'REPO',sourceRevision:'merged-sha',channel:'internal',qaStatus:'passed',approval:'approved',signed:true,revision:4,createdAt:releaseTime,updatedAt:releaseTime};
function fixture({sourceReviewId=null,capturedReviewId=null,review=null,qa=[],related=[]}={}) {
 const build={...baseBuild,sourceReviewId,provenance:{reviewId:capturedReviewId}};
 const db={
   project:{findFirst:async()=>project},
   clusterPersistenceRecord:{findMany:async()=>[]},
   deliveryQaPlan:{count:async()=>0},
   projectRelationship:{findMany:async()=>related},
   card:{findMany:async()=>[]},calendarEvent:{findMany:async()=>[]},scheduleBlock:{findMany:async()=>[]},
   sourceReview:{findFirst:async({where})=> review?.id===where.id && where.projectId==='P1' && review?.repositoryId===where.repositoryId ? review : null },
 };
 const deliveryStub={createProjectDeliveryService:()=>({list:async(_ids,kind)=>({build:[build],release:[], 'qa-session':qa}[kind]??[])})};
 const {createProjectDeliveryLifecycleService}=load(lifecyclePath,{'./project-delivery-service.js':deliveryStub});
 return {snapshot:()=>createProjectDeliveryLifecycleService(db).snapshot('P1'),db,build};
}
function sourceGate(result){return result.readiness.gates.find(row=>row.id==='source_review');}
await test('an unlinked Build has no invented Source review requirement',async()=>{
 const result=await fixture().snapshot();assert.equal(sourceGate(result).required,false);assert.equal(result.releaseReady,true);
});
await test('a merged and exact-revision review passes its mandatory gate',async()=>{
 const result=await fixture({sourceReviewId:'RV',capturedReviewId:'RV',review:{id:'RV',repositoryId:'REPO',status:'merged',mergedRevision:'merged-sha'}}).snapshot();
 assert.equal(sourceGate(result).required,true);assert.equal(sourceGate(result).passed,true);assert.equal(result.releaseReady,true);
});
await test('an approved but unmerged Source review cannot clear provenance',async()=>{
 const result=await fixture({sourceReviewId:'RV',review:{id:'RV',repositoryId:'REPO',status:'open',mergedRevision:'merged-sha'}}).snapshot();
 assert.equal(result.releaseReady,false);assert.match(sourceGate(result).detail,/not been merged/);
});
await test('a Source review merged at another revision is insufficient',async()=>{
 const result=await fixture({sourceReviewId:'RV',review:{id:'RV',repositoryId:'REPO',status:'merged',mergedRevision:'different-sha'}}).snapshot();
 assert.equal(sourceGate(result).passed,false);assert.match(sourceGate(result).detail,/does not match/);
});
await test('a missing live Source review fails closed',async()=>{
 const result=await fixture({sourceReviewId:'RV'}).snapshot();assert.equal(sourceGate(result).passed,false);assert.equal(result.releaseReady,false);
});
await test('review moved to another repository cannot satisfy a Build',async()=>{
 const result=await fixture({sourceReviewId:'RV',review:{id:'RV',repositoryId:'OTHER',status:'merged',mergedRevision:'merged-sha'}}).snapshot();
 assert.equal(sourceGate(result).passed,false);
});
await test('deleted FK cannot erase a captured historical Source review requirement',async()=>{
 const result=await fixture({capturedReviewId:'DELETED'}).snapshot();assert.equal(sourceGate(result).required,true);assert.equal(sourceGate(result).passed,false);
});
await test('a changed Source review ID versus captured provenance fails closed',async()=>{
 const result=await fixture({sourceReviewId:'NEW',capturedReviewId:'ORIGINAL',review:{id:'NEW',repositoryId:'REPO',status:'merged',mergedRevision:'merged-sha'}}).snapshot();
 assert.equal(sourceGate(result).passed,false);assert.match(sourceGate(result).detail,/no longer matches/);
});
await test('a legacy contradictory QA pass/no-go is never considered passing evidence',async()=>{
 const result=await fixture({qa:[{id:'QA',buildId:'BUILD',status:'passed',decision:'no-go',failed:0,blocked:0}]}).snapshot();
 assert.equal(result.qa.failed,1);assert.equal(result.qa.passed,0);assert.equal(result.releaseReady,false);
});
await test('QA failed and blocked case counts override nominal passed status',async()=>{
 for (const counts of [{failed:2,blocked:0},{failed:0,blocked:1}]) {
  const result=await fixture({qa:[{id:'QA',buildId:'BUILD',status:'passed',decision:'go',...counts}]}).snapshot();
  assert.equal(result.qa.passed,0);assert.equal(result.qa.failed,1);assert.equal(result.releaseReady,false);
 }
});
await test('release publication independently checks positive QA case-count blockers',async()=>{
 const errors={createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,status})};
 const zSchemas={deliveryBuildInputSchema:{parse:x=>x},deliveryBuildPatchSchema:{parse:x=>x},deliveryQaPlanInputSchema:{parse:x=>x},deliveryQaSessionInputSchema:{parse:x=>x},deliveryReleaseInputSchema:{parse:x=>x}};
 const {createProjectDeliveryService}=load(servicePath,{'../../core/http-errors.js':errors,'@cluster/shared':zSchemas,'./project-delivery-lifecycle-service.js':{createProjectDeliveryLifecycleService:()=>({snapshot:async()=>{throw new Error('should not reach readiness')} })}});
 let writes=0;
 const prisma={project:{findUnique:async()=>project},deliveryBuild:{findFirst:async()=>({id:'BUILD',qaStatus:'passed',approval:'approved'})},
  deliveryQaSession:{findFirst:async({where})=>{
   assert.equal(where.OR.some(cond=>cond.failed?.gt===0),true);assert.equal(where.OR.some(cond=>cond.blocked?.gt===0),true);
   return {id:'QA'};
  }},deliveryRelease:{findFirst:async()=>({id:'REL',revision:1,status:'review',buildId:'BUILD'}),update:async()=>{writes++}}};
 await assert.rejects(createProjectDeliveryService(prisma).put('P1','release','REL',{buildId:'BUILD',status:'published',features:[],fixes:[],knownIssues:[],body:'Notes'},1),e=>e.code==='DELIVERY_RELEASE_QA_BLOCKED');
 assert.equal(writes,0);
});
await test('provenance gate is displayed through the existing delivery UI, not an alternate view',()=>{
 const ui=readFileSync('packages/renderer/src/features/projects/ProjectDeliveryLifecycle.tsx','utf8');
 assert.match(ui,/readiness\.gates\.filter\(\(gate\) => gate\.required && !gate\.passed\)/);
 const source=readFileSync(lifecyclePath,'utf8');
 assert.match(source,/Source review provenance/);
 assert.match(source,/sourceReviewId \? \["source_review"\]/);
});
await test('saved Card server history is paused during queued/conflicted/offline writes',()=>{
 const code=readFileSync('packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx','utf8');
 assert.match(code,/getOfflineResourceSyncState\("card", card\?\.id\)/);
 assert.match(code,/resourceSyncState\.state !== "synced"/);
 assert.match(code,/savedHistoryBusy \|\| savedHistoryBlocked \|\| editorDirty/);
 assert.match(code,/Resolve \$\{resourceSyncState.state\} Card sync work/);
});
await test('saved Card history keyboard owner is active editor only',()=>{
 const code=readFileSync('packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx','utf8');
 assert.match(code,/target\?\.closest\?\.\('.card-editor-fullscreen-v254'\)/);
 assert.match(code,/boardHistoryTargetContext\(event.target/);
});
await test('Whiteboard keyboard shortcuts cannot commandeer unrelated modal controls',()=>{
 const code=readFileSync('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx','utf8');
 assert.match(code,/whiteboardHistoryTargetContext\(target\)/);
 assert.match(code,/focus.inDialog \|\| !focus.inWorkspace/);
});
await test('release widget gives blocked gates priority over misleading zero-open-fixes label',()=>{
 const code=readFileSync('packages/renderer/src/features/projects/ProjectDeliveryLifecycle.tsx','utf8');
 assert.match(code,/snapshot.readiness\?\.blocked \? .*blocked gate/);
});
await test('QA aggregation uses failed and blocked case evidence',()=>{
 const code=readFileSync(servicePath,'utf8');
 assert.match(code,/select: \{ status: true, decision: true, failed: true, blocked: true \}/);
 assert.match(code,/Number\(row.failed \|\| 0\) > 0/);
});
console.log(`${passed}/${passed} G25 Workstream 11 release/provenance checks passed`);
