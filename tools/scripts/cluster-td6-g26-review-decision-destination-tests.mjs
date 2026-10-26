#!/usr/bin/env node
/** G26 WS2: version-bound media approval and deliberate review-to-work conversion. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let passed = 0;
async function test(title,fn) { await fn(); passed++; console.log(`PASS G26 WS2 ${title}`); }
function load(file,mocks={}){
 const text=readFileSync(file,'utf8');
 const code=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const mod={exports:{}}; const fallback=new Proxy({}, {get(_o,key){if(key==='__esModule')return false;return (...args)=>({});}});
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require(name){return name in mocks?mocks[name]:name.startsWith('node:')?require(name):fallback;},Date,JSON,Map,Set,Array,Number,Object,Error,Promise,console,Buffer}, {filename:file});
 return mod.exports;
}
const helper=load('apps/server/src/domains/media/review-decision.ts');
const base={id:'asset1',projectId:'p1',versionNumber:3,updatedAt:new Date('2026-10-21T04:05:00Z'),reviewerId:'reviewer',supersededById:null,approvalState:'pending',status:'review',checksumSha256:'a'.repeat(64)};
const requestBody={decision:'approved',expectedVersionNumber:3,expectedUpdatedAt:base.updatedAt.toISOString()};
await test('assigned viewer can decide only their assigned version',()=>assert.equal(helper.reviewDecisionEligibility(base,requestBody,'reviewer',false).ok,true));
await test('unassigned user cannot decide an asset',()=>assert.equal(helper.reviewDecisionEligibility(base,requestBody,'intruder',false).code,'REVIEW_DECISION_NOT_ASSIGNED'));
await test('authorized manager may decide unassigned version',()=>assert.equal(helper.reviewDecisionEligibility({...base,reviewerId:null},requestBody,'manager',true).ok,true));
await test('stale revision fails closed',()=>assert.equal(helper.reviewDecisionEligibility(base,{...requestBody,expectedUpdatedAt:'2026-10-20T04:05:00Z'},'reviewer',false).code,'REVIEW_DECISION_STALE'));
await test('mismatched version number fails closed',()=>assert.equal(helper.reviewDecisionEligibility(base,{...requestBody,expectedVersionNumber:2},'reviewer',false).code,'REVIEW_DECISION_STALE'));
await test('superseded and archived versions never accept new decisions',()=>{for(const extra of [{supersededById:'newer'},{approvalState:'superseded'},{status:'archived'}])assert.equal(helper.reviewDecisionEligibility({...base,...extra},requestBody,'manager',true).code,'REVIEW_VERSION_SUPERSEDED');});
await test('changes-requested requires meaningful review notes',()=>assert.equal(helper.reviewDecisionEligibility(base,{...requestBody,decision:'changes',reason:'  '},'reviewer',false).code,'REVIEW_REASON_REQUIRED'));
await test('database CAS includes author assignment, version and revision',()=>{const guard=helper.reviewDecisionGuard(base);assert.equal(guard.reviewerId,'reviewer');assert.equal(guard.versionNumber,3);assert.equal(guard.updatedAt.getTime(),base.updatedAt.getTime());assert.equal(guard.supersededById,null);});
const zpart={ parse(value){return value;},strict(){return this;},default(){return this;},optional(){return this;},nullable(){return this;},min(){return this;},max(){return this;},trim(){return this;},datetime(){return this;},positive(){return this;},nonnegative(){return this;},int(){return this;},finite(){return this;},refine(){return this;} };
const z=new Proxy({}, {get(){return (...args)=>zpart;}});
const app={handlers:new Map(), get(url,fn){this.handlers.set('GET '+url,fn);},post(url,fn){this.handlers.set('POST '+url,fn);},patch(url,fn){this.handlers.set('PATCH '+url,fn);},delete(url,fn){this.handlers.set('DELETE '+url,fn);}};
const events=[];let user={id:'reviewer'}, canView=true,canManage=false,forceUpdateRace=false,forceFailure=false, lastUpdatedWhere=null;
let asset={...base}, decisionRows=[], board={id:'board1',projectId:'p1',archived:false},list={id:'list1',boardId:'board1',archived:false};
let linkedComment={id:'comment1',workEntityId:null,workEntityType:null,body:'Fix the lighting',reviewAsset:{...base,title:'Clip',versionLabel:'v3'},priority:'high',category:'visual',assigneeId:null,locator:'{"type":"media_time","timeSeconds":12}'};
let cards=[],relations=[],createdId=0,forceRelationFailure=false,forceClaimRace=false;
const prisma={
 project:{findUnique:async()=>({id:'p1'})},
 reviewAsset:{findUnique:async()=>asset?.id==='asset1'?asset:null,findUniqueOrThrow:async()=>asset,updateMany:async({where,data})=>{lastUpdatedWhere=where;if(forceUpdateRace||asset.updatedAt.getTime()!==where.updatedAt.getTime())return{count:0};asset={...asset,...data,updatedAt:new Date(asset.updatedAt.getTime()+1000)};return{count:1};}},
 reviewAssetDecision:{count:async()=>decisionRows.length,create:async({data})=>{if(forceFailure)throw Error('injected failure');const row={...data,id:'decision'+(decisionRows.length+1)};decisionRows.push(row);return row;},findMany:async()=>decisionRows},
 reviewComment:{findUnique:async()=>linkedComment,updateMany:async({where,data})=>{if(linkedComment.workEntityId!==null||forceClaimRace)return{count:0};linkedComment={...linkedComment,...data};return{count:1};}},
 board:{findFirst:async({where})=>board&&!board.archived&&where.id===board.id?board:null},
 boardList:{findFirst:async({where})=>list&&!list.archived&&where.id===list.id&&where.boardId===list.boardId?list:null},
 card:{findFirst:async()=>cards[cards.length-1]||null,create:async({data})=>{const row={...data,id:'card'+(++createdId)};cards.push(row);return row;}},
 projectRelationship:{upsert:async({create})=>{if(forceRelationFailure)throw Error('related-link insertion failed');relations.push(create);return create;}},
 async $transaction(fn){const original={asset,decisions:[...decisionRows],comment:linkedComment,cards:[...cards],relations:[...relations]};try{return await fn(this);}catch(e){asset=original.asset;decisionRows=original.decisions;linkedComment=original.comment;cards=original.cards;relations=original.relations;throw e;}},
};
const routes=load('apps/server/src/domains/media/review-routes.ts',{
 'zod':{z},'@cluster/shared':{REVIEW_MEDIA:['video','image'],ASSET_ARTIFACT_KINDS:[],ASSET_PROCESSING_JOBS:[],METADATA_EXPORT_POLICIES:[],SENSITIVE_METADATA_CATEGORIES:[]},
 './review-decision.js':helper,'./review-capabilities.js':{resolveReviewAssetCapabilities:async()=>({viewAsset:true,approve:canManage})},
 './viewable-resource.js':{reviewAssetViewableResource:()=>({})},
 './review-export-routes.js':{registerReviewAssetExportRoutes(){}},
 '../notifications/video-review-notification.js':new Proxy({}, {get:()=>()=>({})}),
});
const authorization={requireTarget:async(_req,reply,type,id,project,level)=>{const allowed=type==='board'?canManage||user?.id==='reviewer':canView;if(!allowed)reply.code(403).send({code:'ACCESS_DENIED'});return allowed;},requestCanTarget:async()=>canManage,requireProjectResource:async()=>true};
routes.registerReviewAssetRoutes({app,prisma,authorization,getCurrentUser:async()=>user,serializeReviewAsset:(value)=>value,logActivity:async(value)=>events.push(value),jobQueue:{},consumeUploadSession:async()=>{},resolveProjectStoredFile:async()=>'',serializeUserLite:(value)=>value}, {parseObject:(text)=>typeof text==='string'?JSON.parse(text):text||{},parseArray:()=>[]});
function reply(){return{statusCode:200,body:null,headers:{},code(v){this.statusCode=v;return this;},send(v){this.body=v;return this;},header(k,v){this.headers[k]=v;return this;}};}
const decide=app.handlers.get('POST /api/review-assets/:assetId/decision');
const history=app.handlers.get('GET /api/review-assets/:assetId/decisions');
const removeAsset=app.handlers.get('DELETE /api/review-assets/:assetId');
const convert=app.handlers.get('POST /api/review-comments/:commentId/materialize');
assert.ok(decide&&history&&convert);
await test('authenticated reviewer decision records immutable evidence and source identity',async()=>{
 const r=reply();const result=await decide({params:{assetId:'asset1'},body:requestBody},r);
 assert.equal(r.statusCode,200);assert.equal(result.ok,true);assert.equal(asset.approvalState,'approved');assert.equal(asset.approvedById,'reviewer');assert.equal(decisionRows.length,1);assert.equal(decisionRows[0].versionNumber,3);assert.equal(decisionRows[0].sourceChecksumSha256,base.checksumSha256);assert.equal(lastUpdatedWhere.reviewerId,'reviewer');
});
await test('stale decision cannot overwrite committed approval',async()=>{const r=reply();await decide({params:{assetId:'asset1'},body:requestBody},r);assert.equal(r.statusCode,409);assert.equal(decisionRows.length,1);});
await test('forged decision actor is not accepted as assignment',async()=>{user={id:'other'};const r=reply();await decide({params:{assetId:'asset1'},body:{...requestBody,expectedUpdatedAt:asset.updatedAt.toISOString(),decision:'changes',reason:'Please adjust the cut.'}},r);assert.equal(r.statusCode,403);assert.equal(decisionRows.length,1);user={id:'reviewer'};});
await test('CAS lost update returns 409 without decision record',async()=>{forceUpdateRace=true;const r=reply();await decide({params:{assetId:'asset1'},body:{...requestBody,expectedUpdatedAt:asset.updatedAt.toISOString(),decision:'changes',reason:'Please adjust the cut.'}},r);assert.equal(r.statusCode,409);assert.equal(decisionRows.length,1);forceUpdateRace=false;});
await test('failed decision evidence insert rolls back approval',async()=>{forceFailure=true;const before=asset.approvalState,at=asset.updatedAt.toISOString();await assert.rejects(()=>decide({params:{assetId:'asset1'},body:{...requestBody,expectedUpdatedAt:at,decision:'changes',reason:'Please adjust the cut.'}},reply()));assert.equal(asset.approvalState,before);forceFailure=false;});
await test('committed review evidence prevents destructive deletion',async()=>{const r=reply();await removeAsset({params:{assetId:'asset1'}},r);assert.equal(r.statusCode,409);assert.equal(r.body.code,'REVIEW_DECISION_RETENTION');});
await test('review decisions have view-authorized minimal evidence endpoint',async()=>{const r=reply();const result=await history({params:{assetId:'asset1'}},r);assert.equal(result.decisions.length,1);assert.equal(r.headers['Cache-Control'],'private, no-store');canView=false;const denied=reply();await history({params:{assetId:'asset1'}},denied);assert.equal(denied.statusCode,403);canView=true;});
const selected={target:'ticket',destinationBoardId:'board1',destinationListId:'list1'};
await test('review comment creates no project Board automatically and requires an explicit destination',async()=>{const r=reply();await convert({params:{commentId:'comment1'},body:{...selected,destinationBoardId:'missing'}},r);assert.equal(r.statusCode,409);assert.equal(cards.length,0);});
await test('archived List is rejected before creating any work',async()=>{list.archived=true;const r=reply();await convert({params:{commentId:'comment1'},body:selected},r);assert.equal(r.statusCode,409);assert.equal(cards.length,0);list.archived=false;});
await test('review note CAS race rolls back speculative Card creation',async()=>{forceClaimRace=true;const r=reply();await convert({params:{commentId:'comment1'},body:selected},r);assert.equal(r.statusCode,409);assert.equal(cards.length,0);assert.equal(linkedComment.workEntityId,null);forceClaimRace=false;});
await test('failed provenance relationship rolls back both Ticket and review linkage',async()=>{forceRelationFailure=true;await assert.rejects(()=>convert({params:{commentId:'comment1'},body:selected},reply()));assert.equal(cards.length,0);assert.equal(linkedComment.workEntityId,null);assert.equal(relations.length,0);forceRelationFailure=false;});
await test('Board authorization is checked before creating review work',async()=>{canView=false;const r=reply();await convert({params:{commentId:'comment1'},body:selected},r);assert.equal(r.statusCode,403);assert.equal(cards.length,0);canView=true;});
await test('authorized destination materializes explicit new-stage Ticket with version-origin relations',async()=>{const r=reply();const result=await convert({params:{commentId:'comment1'},body:selected},r);assert.equal(r.statusCode,200);assert.equal(result.entity.workItemKind,'ticket');assert.equal(result.entity.ticketStage,'new');assert.equal(result.origin.versionNumber,3);assert.equal(relations.length,2);assert.equal(linkedComment.workEntityId,result.entity.id);assert.equal(cards.length,1);});
await test('duplicate review-to-work request returns original Ticket without creating a second',async()=>{const result=await convert({params:{commentId:'comment1'},body:selected},reply());assert.equal(result.duplicate,true);assert.equal(result.entityId,cards[0].id);assert.equal(cards.length,1);});
const source=readFileSync('apps/server/src/domains/media/review-routes.ts','utf8');
await test('metadata PATCH no longer accepts claimed approval actors or source version rewrites',()=>{const patch=source.slice(source.indexOf('app.patch("/api/review-assets/:assetId"'),source.indexOf('app.post("/api/review-assets/:assetId/decision"'));for(const field of ['approvalState: z.enum','approvedAt: z.string','approvedById: z.string','versionNumber: z.number','supersededById: z.string']) assert.equal(patch.includes(field),false,field);assert.ok(patch.includes('}).strict()'));});
await test('review decisions preserve committed change reason and do not accept blank reasons',async()=>{
 const before=decisionRows.length;const invalid=reply();await decide({params:{assetId:'asset1'},body:{decision:'changes',expectedVersionNumber:asset.versionNumber,expectedUpdatedAt:asset.updatedAt.toISOString(),reason:'   '}},invalid);
 assert.equal(invalid.statusCode,400);assert.equal(decisionRows.length,before);
 const accepted=reply();await decide({params:{assetId:'asset1'},body:{decision:'changes',expectedVersionNumber:asset.versionNumber,expectedUpdatedAt:asset.updatedAt.toISOString(),reason:'Raise shadow detail'}},accepted);
 assert.equal(accepted.statusCode,200);assert.equal(decisionRows[before].reason,'Raise shadow detail');
});
await test('new uploads cannot start in an approved decision state',()=>assert.ok(source.includes('approvalState: "pending"')));
const viewer=readFileSync('packages/renderer/src/features/viewer/ViewerReviewPanel.tsx','utf8'),projects=readFileSync('packages/renderer/src/features/projects/ProjectVideoWorkspace.tsx','utf8');
await test('both review UIs submit version-bound decisions and use explicit work destinations',()=>{assert.ok(viewer.includes('expectedVersionNumber'));assert.ok(viewer.includes('/decision'));assert.ok(projects.includes('/decision'));assert.ok(projects.includes('...destination'));});
console.log(`G26 Workstream 2: ${passed}/${passed} passed`);
