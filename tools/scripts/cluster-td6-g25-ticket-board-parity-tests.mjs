#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(resolve(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const root=resolve(import.meta.dirname,'../..');
const source=f=>readFileSync(resolve(root,f),'utf8');
function load(file,stubs={}) {
 const output=ts.transpileModule(source(file),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',output)(id=>{
  if (Object.hasOwn(stubs,id)) return stubs[id];
  if (id.startsWith('node:')) return require(id);
  throw new Error(`Unmocked ${id} in ${file}`);
 },module,module.exports);
 return module.exports;
}
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS G25 Ticket/Board '+name)}
const {createBoardService}=load('apps/server/src/domains/boards/board-service.ts');
await check('unspecified columns create genuinely blank Board, selected defaults opt in',async()=>{
 const seen=[]; const repo={countActiveBoards:async()=>0,createBoard:async (_p,body,columns)=>{seen.push(columns);return {id:'b',name:body.name}}};
 const service=createBoardService({repository:repo,defaultBoardColumnsForProjectType:()=>['Backlog','Done'],logActivity:async()=>{},logInfo:()=>{},scheduleBroadcast:()=>{}});
 await service.create({id:'p',projectType:'general'},{name:'Blank'});
 await service.create({id:'p',projectType:'general'},{name:'Explicit empty',columns:[]});
 await service.create({id:'p',projectType:'general'},{name:'Template',template:'project-default'});
 await service.create({id:'p',projectType:'general'},{name:'Manual',columns:['Design','Review']});
 assert.deepEqual(seen,[[],[],['Backlog','Done'],['Design','Review']]);
});
await check('both board creation surfaces select blank and opt-in templates explicitly',()=>{
 const t=source('packages/renderer/src/features/boards/board-templates.ts');
 assert.match(t,/id: "blank", label: "Blank board"/);
 const d=source('packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx');
 const p=source('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');
 assert.match(d,/useState<BoardTemplateId>\("blank"\)/);
 assert.match(p,/useState<BoardTemplateId>\("blank"\)/);
 assert.match(p,/template: boardTemplate === "project-default"/);
 assert.match(d,/template: newBoardTemplate === "project-default"/);
 const schema=source('apps/server/src/domains/boards/board-schemas.ts');
 assert.match(schema,/\.max\(20\)\.optional\(\)/);
});
const {createTicketDestinationService}=load('apps/server/src/domains/tickets/ticket-service.ts');
function reply(){return {status:200,sent:false,code(n){this.status=n;return this},send(value){this.sent=true;this.payload=value;return value}}}
const project={id:'project-a',archived:false,source:'unreal'};
const other={id:'project-b',archived:false,source:'generic'};
const studio={id:'studio-project',workspaceId:'workspace',archived:false,source:'system-tickets'};
function fixture({denied=false,studioBoard=null}={}){
 const changes={boards:0,lists:0,projects:0};
 const boards=[{id:'blank',projectId:project.id,project,archived:false,lists:[]},{id:'b1',projectId:project.id,project,archived:false,lists:[{id:'new',boardId:'b1',title:'New',isDone:false},{id:'done',boardId:'b1',title:'Done',isDone:true}]},{id:'b2',projectId:other.id,project:other,archived:false,lists:[{id:'other',boardId:'b2',title:'Other',isDone:false}]}];
 const projects=[project,other,studio];
 const prisma={
  project:{findUnique:async({where})=>projects.find(p=>p.id===where.id)||null,findFirst:async({where})=>projects.find(p=>p.workspaceId===where.workspaceId&&p.source===where.source)||null,create:async({data})=>{changes.projects++;return{id:'studio-project',...data}}},
  workspace:{findFirstOrThrow:async()=>({id:'workspace'})},
  board:{findUnique:async({where})=>boards.find(b=>b.id===where.id)||null,findFirst:async({where})=>where.name==='Tickets'?studioBoard:null,create:async({data})=>{changes.boards++;return{id:'studio-board',...data,lists:data.lists.create.map((l,i)=>({...l,id:`studio-list-${i}`}))}}},
  boardList:{createMany:async()=>{changes.lists++}},
 };
 const access=async (_req,rep,id)=>{if(denied){rep.code(403).send({code:'ACCESS_DENIED'});return null};const b=boards.find(b=>b.lists.some(l=>l.id===id));return b?.lists.find(l=>l.id===id) ? {...b.lists.find(l=>l.id===id),board:b} : null};
 const svc=createTicketDestinationService({prisma,enforceTargetAccess:async(_req,rep)=>{if(denied){rep.code(403).send({code:'ACCESS_DENIED'});return null}return true},enforceListAccess:access});
 return {svc,changes,boards};
}
const req={};const ticket=(part={})=>({title:'Ticket',priority:'medium',labels:[],...part});
await check('project-only Ticket rejects instead of changing first available/empty Board',async()=>{
 const {svc,changes}=fixture();const rep=reply();await svc.resolveTicketDestination(req,rep,ticket({projectId:project.id}));
 assert.equal(rep.status,409);assert.equal(rep.payload.code,'TICKET_DESTINATION_REQUIRED');assert.deepEqual(changes,{boards:0,lists:0,projects:0});
});
await check('Board-only Ticket requires explicit List without mutating a blank Board',async()=>{
 const {svc,changes}=fixture();const rep=reply();await svc.resolveTicketDestination(req,rep,ticket({projectId:project.id,boardId:'blank'}));
 assert.equal(rep.payload.code,'TICKET_LIST_REQUIRED');assert.deepEqual(changes,{boards:0,lists:0,projects:0});
});
await check('valid explicit Board/List route retains exact Project scope',async()=>{
 const {svc,changes}=fixture();const rep=reply();const dest=await svc.resolveTicketDestination(req,rep,ticket({projectId:project.id,boardId:'b1',listId:'new'}));
 assert.deepEqual(dest,{boardId:'b1',listId:'new',projectId:project.id});assert.deepEqual(changes,{boards:0,lists:0,projects:0});
});
for(const [title,body,code] of [
 ['mismatched list and board',{projectId:project.id,boardId:'blank',listId:'new'},'TICKET_DESTINATION_MISMATCH'],
 ['mismatched list and project',{projectId:other.id,boardId:'b1',listId:'new'},'TICKET_DESTINATION_MISMATCH'],
 ['done-only destination',{projectId:project.id,boardId:'b1',listId:'done'},'TICKET_DESTINATION_UNAVAILABLE'],
 ['cross-project board',{projectId:other.id,boardId:'b1'},'TICKET_DESTINATION_MISMATCH'],
 ]) await check(`${title} is rejected`,async()=>{
  const {svc,changes}=fixture();const rep=reply();await svc.resolveTicketDestination(req,rep,ticket(body));assert.equal(rep.payload.code,code);assert.deepEqual(changes,{boards:0,lists:0,projects:0});
 });
await check('denied access never causes Board or List writes',async()=>{
 const {svc,changes}=fixture({denied:true});const rep=reply();await svc.resolveTicketDestination(req,rep,ticket({projectId:project.id,boardId:'b1',listId:'new'}));assert.equal(rep.status,403);assert.deepEqual(changes,{boards:0,lists:0,projects:0});
});
await check('Studio-only Ticket creates dedicated queue rather than commandeering Projects',async()=>{
 const {svc,changes}=fixture();const rep=reply();const dest=await svc.resolveTicketDestination(req,rep,ticket());
 assert.equal(dest.boardId,'studio-board');assert.equal(dest.listId,'studio-list-0');assert.equal(dest.projectId,studio.id);assert.deepEqual(changes,{boards:1,lists:0,projects:0});
});
await check('Studio queue intentionally emptied does not recreate Lists',async()=>{
 const {svc,changes}=fixture({studioBoard:{id:'studio-board',lists:[]}});const rep=reply();await svc.resolveTicketDestination(req,rep,ticket());
 assert.equal(rep.payload.code,'STUDIO_TICKET_INBOX_UNAVAILABLE');assert.deepEqual(changes,{boards:0,lists:0,projects:0});
});
await check('all ticket UI surfaces require explicit project destination',()=>{
 const main=source('packages/renderer/src/features/tickets/TicketSystemPage.tsx');
 assert.doesNotMatch(main,/\|\| visibleBoards\[0\]/);
 assert.match(main,/Choose the Project's destination Board/);
 const quick=source('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 assert.match(quick,/ticketDraft\.listId/);
 const create=source('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
 assert.match(create,/ticketTargetListId/);
});
const {createStudioAutomationService}=load('apps/server/src/domains/automation/studio-automation-service.ts',{
 '../jobs/job-types.js':{BackgroundJobDeferredError:class BackgroundJobDeferredError extends Error{}},
 '../jobs/job-tool-ownership.js':{automationJobRequiredToolOwners:()=>[]},
 '../decisions/decision-service.js':{createDecisionService:()=>({})},
});
await check('persisted intentionally-empty automation stays empty after read/restart',async()=>{
 let record=null;
 const prisma={clientStateRecord:{findUnique:async()=>record,create:async({data})=>(record={id:'r1',...data}),updateMany:async({where,data})=>{if(record.revision!==where.revision)return{count:0};record={...record,payload:data.payload,revision:record.revision+1};return{count:1}}}};
 const deps={prisma,logActivity:async()=>{},jobQueue:{},logger:{}};
 const a=createStudioAutomationService(deps);
 assert.ok((await a.readRules()).rules.length>0,'initial server setup may show starter rules');
 const written=await a.saveRules([],0);assert.equal(written.conflict,false);
 assert.deepEqual((await a.readRules()).rules,[]);
 const restarted=createStudioAutomationService(deps);
 assert.deepEqual((await restarted.readRules()).rules,[]);
 assert.equal((await restarted.readRules()).revision,1);
});
await check('Ticket creation and copy have explicit new stage, not a List-derived status',()=>{
 const create=source('apps/server/src/domains/tickets/ticket-routes.ts');
 assert.match(create,/workItemKind: "ticket",\s*ticketStage: "new"/);
 const repo=source('apps/server/src/domains/cards/card-repository.ts');
 assert.match(repo,/ticketStage: source.workItemKind === "ticket" \? "new" : null/);
 const db=source('apps/server/prisma/schema.prisma');
 assert.match(db,/ticketStage\s+String\?/);
 assert.match(source('apps/server/prisma/migrations/20261023100000_td6_g25_ticket_explicit_stage/migration.sql'),/ADD COLUMN "ticketStage"/);
});
const ticketQuery=load('apps/server/src/domains/tickets/ticket-data-query.ts',{
 '@cluster/shared':{TICKET_DATA_FIELDS:[]},
 '../../core/data-query-analytics.js':{},
 '../../core/prisma-semantic-query.js':{createPrismaSemanticAdapters:()=>({})},
});
await check('Ticket triage query respects explicit stage, not arbitrary List name',()=>{
 const {ticketQueueLaneWhere}=ticketQuery;
 assert.deepEqual(ticketQueueLaneWhere('resolved'),{ticketStage:'resolved'});
 assert.deepEqual(ticketQueueLaneWhere('rejected'),{ticketStage:'rejected'});
 assert.deepEqual(ticketQueueLaneWhere('closed'),{ticketStage:{in:['resolved','rejected']}});
 assert.deepEqual(ticketQueueLaneWhere('review'),{ticketStage:'review'});
 assert.deepEqual(ticketQueueLaneWhere('waiting'),{ticketStage:'waiting'});
 assert.deepEqual(ticketQueueLaneWhere('triage'),{OR:[{ticketStage:'new'},{ticketStage:null}]});
 assert.doesNotMatch(JSON.stringify(ticketQueueLaneWhere('open')),/list/);
});
const history=load('apps/server/src/domains/cards/card-saved-history.ts');
await check('Ticket stage participates in revision-guarded Undo/Redo and refuses stale edits',async()=>{
 let card={id:'t1',revision:1,ticketStage:'new',workItemKind:'ticket'};const rows=[];
 const tx={card:{
   findUnique:async()=>({...card}),findUniqueOrThrow:async()=>({...card}),
   updateMany:async({where,data})=>{if(where.revision!==card.revision)return{count:0};card={...card,...data,revision:card.revision+1};return{count:1}}},
   cardSavedOperation:{create:async({data})=>{const row={id:`op-${rows.length+1}`,...data};rows.push(row);return row},findFirst:async()=>rows.at(-1)}
 };
 const db={...tx,$transaction:async(fn)=>fn(tx)};
 assert.equal((await history.commitSavedCardUpdate(db,'t1',1,{ticketStage:'review'},'alice')).count,1);
 assert.equal(card.ticketStage,'review');
 assert.equal(rows[0].fields,'["ticketStage"]');
 assert.equal((await history.commitSavedCardUpdate(db,'t1',1,{ticketStage:'resolved'},'bob')).count,0);
 await assert.rejects(()=>history.reverseSavedCardOperation(db,{cardId:'t1',actorUserId:'bob',action:'undo',expectedRevision:2,operationId:'op-1'}),/latest uninterrupted saved Card edit/);
 await history.reverseSavedCardOperation(db,{cardId:'t1',actorUserId:'alice',action:'undo',expectedRevision:2,operationId:'op-1'});
 assert.equal(card.ticketStage,'new');
 await history.reverseSavedCardOperation(db,{cardId:'t1',actorUserId:'alice',action:'redo',expectedRevision:3,operationId:'op-2'});
 assert.equal(card.ticketStage,'review');
});
await check('only Ticket cards may change stage; renderer presents explicit triage controls',()=>{
 assert.match(source('apps/server/src/domains/cards/card-routes.ts'),/TICKET_STAGE_ONLY/);
 const ui=source('packages/renderer/src/features/tickets/TicketSystemPage.tsx');
 assert.match(ui,/aria-label="Ticket triage stage"/);
 assert.match(ui,/ticketStage: NonNullable<TicketCard\["ticketStage"\]>/);
 assert.match(source('packages/renderer/src/features/application/modules/application-foundation.tsx'),/card.ticketStage/);
});
await check('all Ticket mutation entry points enforce edit authorization and Studio policy',()=>{
 const routes=source('apps/server/src/domains/tickets/ticket-routes.ts');
 assert.match(routes,/hasToolPermission\(user, decoratedUser\?\.workspaceRole, "tickets", "edit"\)/);
 assert.match(routes,/ticketSettings\.ticketsRequireProject\) \{/);
 assert.match(routes,/targetProject\.source === "system-tickets"/);
});
await check('Discord intake cannot create or populate a Project Board',()=>{
 const discord=source('apps/server/src/domains/integrations/discord-production-service.ts');
 const section=discord.slice(discord.indexOf('async function ensureTicketBoard'),discord.indexOf('async function projectRouteForChannel'));
 assert.doesNotMatch(section,/board\.create|boardList\.create/);
 assert.match(section,/name: "Project tickets"/);
 assert.match(discord,/DISCORD_TICKET_BOARD_DENIED/);
 assert.match(discord,/workItemKind: "ticket", ticketStage: "new"/);
});
console.log(`G25 Ticket/Board + automation parity: ${count}/${count} passed`);
