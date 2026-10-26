#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), ts=require('typescript');
function load(file, imports={}){
 const transpiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};vm.runInNewContext(transpiled,{module:mod,exports:mod.exports,require:id=>imports[id]??require(id),Date,JSON,Object,Math,Array,Error,Set,Map,Promise},{filename:file});return mod.exports;
}
const lifecycle=load('apps/server/src/domains/boards/board-list-lifecycle.ts');
let passed=0;async function test(name,run){await run();console.log('PASS '+name);passed++;}
function fixture({archived=false,activeCards=0,archivedCards=0,history=0,revision=7,boardArchived=false}={}){
 let row={id:'L1',boardId:'B1',title:'QA',revision,archived,board:{id:'B1',archived:boardArchived}},cards=activeCards+archivedCards,ops=history,deleted=false,barriers=[],tombs=[],rollback=false,forceRace=false,failHistory=false;
 const clone=x=>structuredClone(x);
 const tx={
  boardList:{findUnique:async()=>deleted?null:clone(row),findUniqueOrThrow:async()=>clone(row),updateMany:async({where,data})=>{if(forceRace||deleted||where.revision!==row.revision||where.archived!==undefined&&where.archived!==row.archived)return {count:0}; row.archived=data.archived;row.revision++;return {count:1};},deleteMany:async({where})=>{if(forceRace||deleted||where.revision!==row.revision)return {count:0};deleted=true;return {count:1};}},
  card:{count:async({where})=>where.archived===false?activeCards:cards},
  boardListSavedOperation:{count:async()=>ops,create:async({data})=>{if(failHistory)throw Error('history unavailable');barriers.push(clone(data));ops++;}},
  syncTombstone:{create:async({data})=>{tombs.push(data)}}
 };
 const db={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');const original=clone({row,cards,ops,deleted,barriers,tombs});try{return await fn(tx)}catch(e){({row,cards,ops,deleted,barriers,tombs}=original);rollback=true;throw e;}}};
 return {db,get:()=>({row:clone(row),cards,ops,deleted,barriers:clone(barriers),tombs:clone(tombs),rollback}),race:()=>forceRace=true,failHistory:()=>failHistory=true};
}
const cmd=(action,revision=7)=>({listId:'L1',expectedRevision:revision,action,actorUserId:'U1'});
const deleteCmd={listId:'L1',boardId:'B1',projectId:'P1',workspaceId:'W1',expectedRevision:7};
await test('archive unused List with revision CAS and durable barrier',async()=>{const f=fixture();const result=await lifecycle.transitionBoardListLifecycle(f.db,cmd('archive'));assert.equal(result.archived,true);assert.equal(f.get().row.revision,8);assert.equal(f.get().barriers[0].action,'barrier');assert.equal(f.get().barriers[0].appliedRevision,8);});
await test('archive retains existing archived Cards and Tickets',async()=>{const f=fixture({archivedCards:4});await lifecycle.transitionBoardListLifecycle(f.db,cmd('archive'));assert.equal(f.get().cards,4);assert.equal(f.get().deleted,false);});
await test('active work blocks archival and changes nothing',async()=>{const f=fixture({activeCards:1});await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),e=>e.code==='LIST_HAS_ACTIVE_WORK');assert.equal(f.get().row.archived,false);assert.equal(f.get().barriers.length,0);});
await test('multiple active Tickets never cascade on archival',async()=>{const f=fixture({activeCards:12,archivedCards:1});await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),e=>e.code==='LIST_HAS_ACTIVE_WORK');assert.equal(f.get().cards,13);});
await test('archived List restores without regenerating identifiers',async()=>{const f=fixture({archived:true,archivedCards:2});const r=await lifecycle.transitionBoardListLifecycle(f.db,cmd('restore'));assert.equal(r.id,'L1');assert.equal(r.archived,false);assert.equal(f.get().cards,2);});
await test('stale revision archive fails before updating',async()=>{const f=fixture();await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive',6)),e=>e.code==='LIST_REVISION_CONFLICT');assert.equal(f.get().ops,0);});
await test('stale revision restoration fails',async()=>{const f=fixture({archived:true});await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('restore',6)),e=>e.code==='LIST_REVISION_CONFLICT');});
await test('duplicate state transition fails visibly',async()=>{const f=fixture({archived:true});await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),e=>e.code==='LIST_ALREADY_IN_STATE');});
await test('archived Board cannot change columns',async()=>{const f=fixture({boardArchived:true});await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),e=>e.code==='BOARD_ARCHIVED');});
await test('write contention prevents state transition',async()=>{const f=fixture();f.race();await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),e=>e.code==='LIST_REVISION_CONFLICT');});
await test('history write failure rolls back archival',async()=>{const f=fixture();f.failHistory();await assert.rejects(lifecycle.transitionBoardListLifecycle(f.db,cmd('archive')),/history unavailable/);assert.equal(f.get().row.archived,false);assert.equal(f.get().rollback,true);});
await test('serializable race errors produce a retryable conflict code',async()=>{const f={$transaction:async()=>{throw {code:'P2034'}}};await assert.rejects(lifecycle.transitionBoardListLifecycle(f,cmd('archive')),e=>e.code==='LIST_REVISION_CONFLICT');});
await test('empty never-edited List may be permanently removed with tombstone',async()=>{const f=fixture();assert.equal((await lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd)).ok,true);assert.equal(f.get().deleted,true);assert.equal(f.get().tombs[0].entityType,'list');});
await test('archived Card history blocks permanent deletion',async()=>{const f=fixture({archived:true,archivedCards:1});await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd),e=>e.code==='LIST_DELETE_BLOCKED');assert.equal(f.get().deleted,false);});
await test('active Ticket blocks permanent deletion',async()=>{const f=fixture({activeCards:1});await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd),e=>e.code==='LIST_DELETE_BLOCKED');});
await test('metadata/ordering history blocks permanent deletion',async()=>{const f=fixture({history:2});await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd),e=>e.code==='LIST_DELETE_BLOCKED');});
await test('stale revision prevents permanent delete',async()=>{const f=fixture();await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,{...deleteCmd,expectedRevision:2}),e=>e.code==='LIST_REVISION_CONFLICT');});
await test('deletion conflict does not publish a tombstone',async()=>{const f=fixture();f.race();await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd),e=>e.code==='LIST_REVISION_CONFLICT');assert.equal(f.get().tombs.length,0);});
await test('failed tombstone write rolls back delete',async()=>{const f=fixture();const tx=f.db.$transaction;f.db.$transaction=(fn,opt)=>tx(async t=>{t.syncTombstone.create=async()=>{throw Error('tombstone failed')};return fn(t)},opt);await assert.rejects(lifecycle.permanentlyDeleteUnusedList(f.db,deleteCmd),/tombstone failed/);assert.equal(f.get().deleted,false);});
await test('archive route, permission and restore endpoint are present',async()=>{const s=readFileSync('apps/server/src/domains/boards/board-routes.ts','utf8');assert.match(s,/post\("\/api\/lists\/:listId\/lifecycle"/);assert.match(s,/requireList\(request, reply, listId, "manage"\)/);assert.match(s,/get\("\/api\/boards\/:boardId\/archived-lists"/);assert.match(s,/Cache-Control", "private, no-store"/);});
await test('default Board projection hides archived columns without deleting them',async()=>{const s=readFileSync('apps/server/src/domains/boards/board-repository.ts','utf8');assert.match(s,/where: \{ archived: false \},\s*orderBy: \{ position: "asc" \}/);assert.match(s,/findArchivedLists/);});
await test('Ticket, Project automation and Discord intake reject archived columns',async()=>{for(const p of ['tickets/ticket-service.ts','projects/project-automation-service.ts','integrations/discord-production-service.ts']){assert.match(readFileSync('apps/server/src/domains/'+p,'utf8'),/list\.archived|row\.archived/);}});
await test('Board manager exposes archive and restore instead of destructive default',async()=>{const s=readFileSync('packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx','utf8');assert.match(s,/Archived columns/);assert.match(s,/async function restoreList/);assert.match(s,/async function archiveList/);assert.match(s,/Delete unused/);});
await test('Card create and indexed move paths check archived destination',async()=>{const s=readFileSync('apps/server/src/domains/cards/card-repository.ts','utf8');assert.match(s,/targetList\.archived/);assert.match(s,/targetList\.board\?\.archived/);});
console.log(`G25 WS16 List lifecycle ${passed}/${passed} passed`);
