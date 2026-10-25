#!/usr/bin/env node
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const stub=()=>new Proxy(function(){},{apply(){return stub()},get(_t,k){return k==='parse'?(value)=>value:stub()}});
const z=new Proxy({},{get:()=>stub()});
let board=null, existing=null, recordsCreated=0, boardCreated=0, access=true, user='U1', relationships=0, logCount=0, boardsQueried=0;
const project={id:'P1',name:'Alpha',workspaceId:'W1',sourceBindings:[],integrationBindings:[]};const control={id:'R1',projectId:'P1',title:'Resolve issue',kind:'risk',ownerId:null,priority:'high',description:'Investigate',dueDate:null,startDate:null};
const prisma={project:{findUnique:async()=>project},projectControlRecord:{findFirst:async()=>control,update:async()=>control},
 board:{findFirst:async()=>{boardsQueried++;return board},create:async()=>{boardCreated++;throw Error('must never provision Board');}},
 card:{findFirst:async()=>existing,create:async({data})=>{recordsCreated++;return {id:'T'+recordsCreated,...data}}},projectRelationship:{upsert:async()=>{relationships++}},
};
const endpoints=new Map();const app={get:(p,fn)=>endpoints.set('GET '+p,fn),post:(p,fn)=>endpoints.set('POST '+p,fn),put:(p,fn)=>endpoints.set('PUT '+p,fn),delete:(p,fn)=>endpoints.set('DELETE '+p,fn),patch:(p,fn)=>endpoints.set('PATCH '+p,fn)};
const mocks={
 'zod':{z},'../../core/http-errors.js':{createHttpError:(code,message,status)=>Object.assign(new Error(message),{code,status})},
 './project-control-link-service.js':{listProjectControlLinkCandidates:async()=>[],reconcileProjectControlLinks:async()=>({})},
 './project-control-service.js':{serializeProjectControlRecord:x=>x},
};
const code=ts.transpileModule(readFileSync('apps/server/src/domains/projects/project-control-integration-routes.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>mocks[id]??require(id),Date,JSON,URL,Error,Set,Map},{filename:'project-control-integration-routes.ts'});
mod.exports.registerProjectControlIntegrationRoutes({app,prisma,getCurrentUser:async()=>user?{id:user}:null,enforceTargetAccess:async(_req,_reply,_kind)=>access,logActivity:async()=>{logCount++},readSettings:async()=>({}),fetchWithTimeout:async()=>({}),sourceProvider:{}});
const route=endpoints.get('POST /api/projects/:projectId/control-records/:recordId/materialize');assert.equal(typeof route,'function');
const r=(data={})=>({params:{projectId:'P1',recordId:'R1'},body:{target:'ticket',attach:true,...data}});
const reply=()=>({status:200,code(v){this.status=v;return this},send(x){this.body=x;return this}});
let passed=0;async function test(name,fn){await fn();console.log('PASS '+name);passed++}
const expectFailure=async(data,code)=>{const n=recordsCreated;await assert.rejects(route(r(data),reply()),e=>e.code===code);assert.equal(recordsCreated,n);assert.equal(boardCreated,0)};
await test('no default Board provisioning when Ticket destination omitted',()=>expectFailure({},'PROJECT_TICKET_DESTINATION_REQUIRED'));
await test('only Board ID does not silently choose a List',()=>expectFailure({destinationBoardId:'B1'},'PROJECT_TICKET_DESTINATION_REQUIRED'));
await test('only List ID does not search for arbitrary Board',()=>expectFailure({destinationListId:'L1'},'PROJECT_TICKET_DESTINATION_REQUIRED'));
await test('missing configured Board rejected',()=>expectFailure({destinationBoardId:'B1',destinationListId:'L1'},'PROJECT_TICKET_BOARD_UNAVAILABLE'));
board={id:'B1',projectId:'P1',archived:false,lists:[{id:'L1',title:'Intake',archived:false,isDone:false}]};
await test('List from other Board rejected',()=>expectFailure({destinationBoardId:'B1',destinationListId:'Lother'},'PROJECT_TICKET_LIST_UNAVAILABLE'));
await test('completed List rejected',async()=>{board.lists[0].isDone=true;await expectFailure({destinationBoardId:'B1',destinationListId:'L1'},'PROJECT_TICKET_LIST_UNAVAILABLE');board.lists[0].isDone=false;});
await test('archived List rejected',async()=>{board.lists=[];await expectFailure({destinationBoardId:'B1',destinationListId:'L1'},'PROJECT_TICKET_LIST_UNAVAILABLE');board.lists=[{id:'L1',title:'Intake',isDone:false,archived:false}];});
await test('revoked Board access blocks creation',async()=>{access=false;const n=recordsCreated;await route(r({destinationBoardId:'B1',destinationListId:'L1'}),reply());assert.equal(recordsCreated,n);access=true;});
await test('valid explicit destination creates a new-stage Ticket with linked provenance',async()=>{const result=await route(r({destinationBoardId:'B1',destinationListId:'L1'}),reply());assert.equal(result.entity.ticketStage,'new');assert.equal(result.entity.listId,'L1');assert.equal(result.entity.workItemKind,'ticket');assert.equal(relationships,1);assert.equal(logCount,1);});
await test('duplicate in another List fails instead of cloning Project follow-up',async()=>{existing={id:'T-existing',listId:'L2',title:'Prior'};await expectFailure({destinationBoardId:'B1',destinationListId:'L1'},'PROJECT_TICKET_ALREADY_LINKED');existing=null;});
await test('Project Control flow cannot create Boards or Lists implicitly',()=>{assert.equal(boardCreated,0);assert.equal(prisma.boardList,undefined)});
await test('Admin resolved metric is Ticket-stage driven',()=>{const code=readFileSync('apps/server/src/domains/admin/admin-tool-routes.ts','utf8');assert.match(code,/ticketStage: "resolved"/);assert.doesNotMatch(code,/doneListIds/);});
await test('Search status resolves Ticket stage independently of Board columns',()=>{const code=readFileSync('apps/server/src/domains/search/search-index-builder.ts','utf8');assert.match(code,/card\.workItemKind === "ticket" \? String\(card\.ticketStage \|\| "new"\)/);});
await test('all three relevant Project surfaces expose explicit selectors',()=>{for(const file of ['ProjectControlCenterPanel.tsx','ProjectTypeProductionWorkspace.tsx','ProjectVideoWorkspace.tsx']) {const content=readFileSync('packages/renderer/src/features/projects/'+file,'utf8');assert.match(content,/ProjectTicketDestinationPicker/);assert.match(content,/projectTicketDestinationIds/);}});
console.log(`G25 WS16 cross-tool authority ${passed}/${passed} passed`);
