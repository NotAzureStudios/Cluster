#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(resolve(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const root = resolve(import.meta.dirname, '../..');
const source = path => readFileSync(resolve(root, path), 'utf8');
function load(file, dependencies = {}) {
 const output = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
 const module = { exports: {} };
 new Function('require', 'module', 'exports', output)((id) => {
  if (Object.hasOwn(dependencies, id)) return dependencies[id];
  if (id.startsWith('node:')) return require(id);
  throw Error(`Unmocked dependency ${id} for ${file}`);
 }, module, module.exports);
 return module.exports;
}
const serviceModule = load('apps/server/src/domains/projects/project-automation-service.ts', {
 '@cluster/shared': { CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded' } }, CLUSTER_WORKFLOW_RELATIONSHIPS: ['implements'], CLUSTER_WORK_SOURCE_KINDS: ['card', 'ticket', 'automation'] },
 '../jobs/job-types.js': { BackgroundJobDeferredError: class BackgroundJobDeferredError extends Error {}, BackgroundJobRetryError: class BackgroundJobRetryError extends Error {} },
 '../jobs/job-tool-ownership.js': { automationJobRequiredToolOwners: () => [], automationActionToolOwners: actions => actions.some(x => x.type === 'create_ticket') ? ['tickets'] : [] },
 './project-control-service.js': { serializeProjectControlRecord: row => row },
});
const linkModule = load('apps/server/src/domains/projects/project-control-link-service.ts', {
 './project-control-service.js': { serializeProjectControlRecord: row => row },
});
const workModule = load('apps/server/src/domains/projects/project-workflow-link-service.ts', {
 '@cluster/shared': { CLUSTER_WORK_SOURCE_KINDS: ['card', 'ticket'] },
});
let passed=0;
async function check(label, fn) { await fn(); passed++; console.log('PASS', label); }
const baseContext = { trigger: 'manual', projectId: 'p', sourceType: 'card', sourceId: 'original', actorUserId: 'alice', source: { id: 'original', title: 'Origin' } };
function fixture(action, { boardExists = true, listDone = false, listExists = true, boardProject = 'p' } = {}) {
 const writes = { boards: 0, lists: 0, cards: [], relationships: [], activity: [], runs: [] };
 const rule = { id: 'r', projectId: 'p', title: 'Automated Ticket', status: 'active', ownerId: 'alice', payload: JSON.stringify({ enabled: true, actions: [action] }) };
 const board = { id: 'board-1', projectId: boardProject, archived: false, name: 'Work Board', lists: listExists ? [{ id: 'list-1', title: 'Intake', isDone: listDone }] : [] };
 const prisma = {
  board: { findFirst: async ({ where }) => boardExists && where.id === board.id && where.projectId === board.projectId ? board : null, create: async () => { writes.boards++; throw Error('Board must not be created'); } },
  boardList: { create: async () => { writes.lists++; throw Error('List must not be created'); } },
  card: { findFirst: async () => null, create: async ({ data }) => { writes.cards.push(data); return { id: 'ticket-1', ...data }; } },
  projectRelationship: { upsert: async ({ create }) => { writes.relationships.push(create); return { id: 'rel-1' }; } },
  projectControlRecord: { findFirst: async () => rule, update: async () => rule },
  clusterPersistenceRecord: { findUnique: async () => null, upsert: async data => { writes.runs.push(data); return {}; }, update: async () => ({}) },
 };
 const service = serviceModule.createProjectAutomationService({ prisma, events: { subscribe: () => {} }, logActivity: async row => { writes.activity.push(row); }, jobQueue: { enqueue: async () => ({ id: 'job' }) }, isTicketsEnabled: async () => true });
 return { service, writes, rule };
}
for (const [label, action, opts, expected] of [
 ['no configured target', { type: 'create_ticket', title: 'Problem' }, {}, /TICKET_AUTOMATION_DESTINATION_REQUIRED/],
 ['Board only', { type: 'create_ticket', targetBoardId: 'board-1' }, {}, /TICKET_AUTOMATION_DESTINATION_REQUIRED/],
 ['cross-Project Board', { type: 'create_ticket', targetBoardId: 'board-1', targetListId: 'list-1' }, { boardProject: 'other' }, /TICKET_AUTOMATION_BOARD_UNAVAILABLE/],
 ['missing Board', { type: 'create_ticket', targetBoardId: 'board-1', targetListId: 'list-1' }, { boardExists: false }, /TICKET_AUTOMATION_BOARD_UNAVAILABLE/],
 ['empty Board', { type: 'create_ticket', targetBoardId: 'board-1', targetListId: 'list-1' }, { listExists: false }, /TICKET_AUTOMATION_LIST_UNAVAILABLE/],
 ['done List', { type: 'create_ticket', targetBoardId: 'board-1', targetListId: 'list-1' }, { listDone: true }, /TICKET_AUTOMATION_LIST_UNAVAILABLE/],
 ['wrong List', { type: 'create_ticket', targetBoardId: 'board-1', targetListId: 'wrong' }, {}, /TICKET_AUTOMATION_LIST_UNAVAILABLE/],
]) await check(label+' produces a recorded failure, never new Board/List/Card', async () => {
 const {service,writes} = fixture(action,opts);
 await assert.rejects(service.executeRule('r',{ context: baseContext }), expected);
 assert.deepEqual([writes.boards,writes.lists,writes.cards.length],[0,0,0]);
 assert.equal(writes.runs.length,1);
});
await check('explicit active destination creates Ticket with new stage and source relationship',async () => {
 const {service,writes} = fixture({ type:'create_ticket', title:'Follow up', targetBoardId:'board-1', targetListId:'list-1' });
 const result = await service.executeRule('r',{context:baseContext,idempotencyKey:'one'});
 assert.equal(result.ok,true);
 assert.deepEqual([writes.boards,writes.lists,writes.cards.length],[0,0,1]);
 assert.equal(writes.cards[0].ticketStage,'new');
 assert.equal(writes.cards[0].listId,'list-1');
 assert.equal(writes.relationships.length,1);
 assert.deepEqual([writes.relationships[0].sourceType,writes.relationships[0].targetType],['card','ticket']);
 assert.equal(result.results[0].id,'ticket-1');
});
await check('branch-created Tickets honor the same configured destination',async () => {
 const {service,writes} = fixture({type:'branch',conditionTree:{operator:'all',conditions:[]},thenActions:[{type:'create_ticket',targetBoardId:'board-1',targetListId:'list-1'}]});
 await service.executeRule('r',{context:baseContext});
 assert.equal(writes.cards.length,1);
 assert.equal(writes.cards[0].ticketStage,'new');
});
await check('dry run exposes exact Ticket destination without writes',async () => {
 const {service,writes} = fixture({ type:'create_ticket', targetBoardId:'board-1', targetListId:'list-1' });
 const result = await service.executeRule('r',{context:baseContext,dryRun:true});
 assert.deepEqual(result.actions[0].ticketDestination,{boardId:'board-1',listId:'list-1',configured:true});
 assert.equal(writes.cards.length,0);
});
await check('Project control candidates count terminal Ticket stages independent of List labels',async () => {
 const prisma = {
  board:{findMany:async()=>[{id:'b1',projectId:'p',name:'QA Board',updatedAt:new Date(),lists:[{id:'l1',title:'Done',isDone:true,cards:[
   {id:'t-new',workItemKind:'ticket',ticketStage:'new',title:'Unresolved ticket',priority:'medium'},
   {id:'t-reject',workItemKind:'ticket',ticketStage:'rejected',title:'Rejected ticket',priority:'medium'},
   {id:'t-resolve',workItemKind:'ticket',ticketStage:'resolved',title:'Resolved ticket',priority:'medium'},
   {id:'c',workItemKind:'card',title:'Ordinary Card',priority:'medium'},
  ]},{id:'l2',title:'Ideas',isDone:false,cards:[]}]}]},
  timelineItem:{findMany:async()=>[]},libraryItem:{findMany:async()=>[]},deliveryBuild:{findMany:async()=>[]},deliveryQaSession:{findMany:async()=>[]},reviewAsset:{findMany:async()=>[]},projectFile:{findMany:async()=>[]},
 };
 const c = await linkModule.listProjectControlLinkCandidates(prisma,'p');
 const newTicket = c.find(x=>x.id==='t-new'), rejected=c.find(x=>x.id==='t-reject'), resolved=c.find(x=>x.id==='t-resolve');
 assert.equal(newTicket.status,'new');assert.equal(newTicket.progress,0);
 assert.equal(rejected.status,'rejected'); assert.equal(rejected.progress,0);
 assert.equal(resolved.status,'resolved'); assert.equal(resolved.progress,100);
 assert.equal(c.find(x=>x.id==='b1').progress,50);
 assert.deepEqual(c.find(x=>x.id==='b1').destinationLists,[{id:'l2',title:'Ideas'}]);
 const stale=[
  {id:'pc-new',linkedEntityType:'ticket',linkedEntityId:'t-new',status:'completed',progress:100,payload:'{}'},
  {id:'pc-reject',linkedEntityType:'ticket',linkedEntityId:'t-reject',status:'completed',progress:100,payload:'{}'},
  {id:'pc-resolve',linkedEntityType:'ticket',linkedEntityId:'t-resolve',status:'open',progress:0,payload:'{}'},
 ];
 const reconciled=await linkModule.enrichProjectControlRecords(prisma,'p',stale);
 assert.deepEqual(reconciled.records.map(row=>[row.status,row.progress]),[['open',0],['blocked',0],['completed',100]]);
});
await check('Project workflow hydration never projects ordinary Card as a Ticket or vice versa', async () => {
 const project={id:'p'};
 const prisma={card:{findMany:async()=>[{id:'t',title:'Ticket',workItemKind:'ticket',list:{title:'Incoming',board:{id:'b',name:'Board',projectId:'p'}}},{id:'c',title:'Card',workItemKind:'card',list:{title:'Backlog',board:{id:'b',name:'Board',projectId:'p'}}}]}};
 const sources=[{kind:'card',id:'t'},{kind:'ticket',id:'c'},{kind:'ticket',id:'t'},{kind:'card',id:'c'}];
 const hydrated = await workModule.hydrateProjectWorkflowSources(prisma,project,sources);
 const views = hydrated instanceof Map ? hydrated : hydrated.views || hydrated;
 assert.equal(views.has('ticket:t'),true);assert.equal(views.has('card:c'),true);
 assert.notEqual(views.get('card:t').label,'Ticket'); assert.notEqual(views.get('ticket:c').label,'Card');
});
await check('editor selects configured active Board/List and checks nested branches before save',()=>{
 const text=source('packages/renderer/src/features/projects/ProjectControlRecordEditor.tsx');
 assert.match(text,/ticketDestination\(action/);
 assert.match(text,/ticketDestination\(child/);
 assert.match(text,/invalidTicket\(/);
 assert.match(text,/Ticket automations need an existing Project Board and active destination List/);
});
console.log(`G25 Workstream 5 automation + Ticket integrity: ${passed}/${passed} passed`);
