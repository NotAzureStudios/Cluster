#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(file, imports={}) {
 const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(js,{module:mod,exports:mod.exports,require:(id)=>imports[id]??require(id),Buffer,Date,Array,Set,Map,Object,String,Number,JSON,Math,Error},{filename:file});
 return mod.exports;
}
const history=load('apps/server/src/domains/boards/board-list-saved-history.ts');
let passed=0;async function test(label,cb){await cb();console.log('PASS '+label);passed++;}
function fixture(initial={}) {
 let list={id:'L1',boardId:'B1',title:'Ideas',description:null,color:null,wipLimit:null,isDone:false,collapsed:false,assignedUserIds:'["a"]',revision:3,...initial};
 let ops=[],cards=0, writes=0, failAfterSave=false, raceAtWrite=false;
 const clone=o=>structuredClone(o);
 const tx={boardList:{
  findUnique:async()=>list ? clone(list):null,
  findUniqueOrThrow:async()=>{if(!list)throw Error('missing');return clone(list);},
  updateMany:async({where,data})=>{writes++;if(raceAtWrite||!list||where.id!==list.id||where.revision!==list.revision)return {count:0};
   for(const [key,value] of Object.entries(data)){list[key]=key==='revision' ? list.revision+1:value;}
   return {count:1};},
 },card:{updateMany:async()=>{cards++;return {count:1};}},boardListSavedOperation:{
  create:async({data})=>{if(failAfterSave)throw Error('insert failed');const row={id:`OP${ops.length+1}`,...clone(data)};ops.push(row);return row;},
  findFirst:async()=>ops.at(-1)??null,
 }};
 const db={...tx,boardListSavedOperation:{...tx.boardListSavedOperation,findMany:async()=>clone(ops.slice().reverse())},
  $transaction:async(callback,settings)=>{assert.equal(settings.isolationLevel,'Serializable');const old=clone({list,ops,cards,writes});try{return await callback(tx)}catch(e){list=old.list;ops=old.ops;cards=old.cards;writes=old.writes;throw e;}}};
 return {db,read:()=>({list:clone(list),ops:clone(ops),cards,writes}),setFail:x=>failAfterSave=x,setRace:x=>raceAtWrite=x,
  mutate:patch=>Object.assign(list,patch)};
}
const command=(action,operationId,expectedRevision,actorUserId='U1')=>({action,operationId,expectedRevision,actorUserId,listId:'L1'});
await test('settings update writes snapshots and CAS together in a serializable transaction',async()=>{
 const f=fixture();assert.equal((await history.saveListWithHistory(f.db,'L1',3,{title:'Backlog',assignedUserIds:['a','b']},'U1')).count,1);
 const r=f.read();assert.equal(r.list.title,'Backlog');assert.equal(r.list.revision,4);assert.equal(r.ops[0].action,'update');assert.deepEqual(JSON.parse(r.ops[0].fields),['title','assignedUserIds']);
});
await test('stale mutation cannot write history',async()=>{
 const f=fixture();assert.equal((await history.saveListWithHistory(f.db,'L1',2,{title:'Bad'},'U1')).count,0);assert.equal(f.read().ops.length,0);
});
await test('concurrent write CAS failure leaves no history',async()=>{
 const f=fixture();f.setRace(true);assert.equal((await history.saveListWithHistory(f.db,'L1',3,{title:'Bad'},'U1')).count,0);assert.equal(f.read().ops.length,0);
});
await test('failed history insert rolls the List mutation back',async()=>{
 const f=fixture();f.setFail(true);await assert.rejects(history.saveListWithHistory(f.db,'L1',3,{title:'New'},'U1'),/insert failed/);assert.equal(f.read().list.title,'Ideas');assert.equal(f.read().list.revision,3);
});
await test('isDone update updates Cards, writes a barrier and cannot be undone as metadata',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{isDone:true,title:'Done'},'U1');assert.equal(f.read().cards,1);assert.equal(f.read().ops[0].action,'barrier');
 const info=await history.listBoardListSavedHistory(f.db,'L1','U1');assert.equal(info.canUndo,false);
});
await test('a no-op metadata value does not fabricate a history entry',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'Ideas'},'U1');assert.equal(f.read().ops.length,0);
});
await test('large snapshot gets a barrier rather than an unbounded history payload',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{description:'x'.repeat(34000)},'U1');assert.equal(f.read().ops[0].action,'barrier');assert.equal(f.read().ops[0].before,'{}');
});
await test('only the authenticated latest author can undo',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');
 const foreign=await history.listBoardListSavedHistory(f.db,'L1','U2');assert.equal(foreign.canUndo,false);
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','OP1',4,'U2')),e=>e.code==='LIST_HISTORY_NOT_REVERSIBLE');
});
await test('revisions and operation identifiers must match for undo',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','OP1',3)),e=>e.code==='LIST_HISTORY_STALE');
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','UNKNOWN',4)),e=>e.code==='LIST_HISTORY_NOT_REVERSIBLE');
});
await test('undo reverses only changed fields while retaining other List metadata',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B',assignedUserIds:['a','b']},'U1');
 const done=await history.reverseListSavedOperation(f.db,command('undo','OP1',4));const r=f.read();assert.equal(r.list.title,'Ideas');assert.equal(r.list.assignedUserIds,'["a"]');assert.equal(r.list.revision,5);
 assert.equal(done.action,'undo');assert.equal(r.ops.at(-1).sourceOperationId,'OP1');
});
await test('redo replays an Undo against the exact next revision only',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');await history.reverseListSavedOperation(f.db,command('undo','OP1',4));
 const info=await history.listBoardListSavedHistory(f.db,'L1','U1');assert.equal(info.canRedo,true);
 await history.reverseListSavedOperation(f.db,command('redo','OP2',5));assert.equal(f.read().list.title,'B');assert.equal(f.read().list.revision,6);
});
await test('an intervening collaborator write fences old Undo',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');f.mutate({title:'C',revision:5});
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','OP1',5)),e=>e.code==='LIST_HISTORY_NOT_REVERSIBLE');assert.equal(f.read().list.title,'C');
});
await test('diverged data with matching revision cannot be overwritten',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');f.mutate({title:'A manually written difference'});
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','OP1',4)),e=>e.code==='LIST_HISTORY_DIVERGED');
});
await test('replayed Undo with stale operation identifier does not run twice',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{title:'B'},'U1');await history.reverseListSavedOperation(f.db,command('undo','OP1',4));
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','OP1',5)),e=>e.code==='LIST_HISTORY_NOT_REVERSIBLE');
});
await test('metadata history preserves privacy: GET omits snapshot payloads and is bounded',async()=>{
 const f=fixture();await history.saveListWithHistory(f.db,'L1',3,{description:'private'},'U1');const info=await history.listBoardListSavedHistory(f.db,'L1','U1');
 assert.equal(info.canUndo,true);assert.equal('before' in info.operations[0],false);assert.equal('after' in info.operations[0],false);
});
await test('API requires List permission on read and manage permission on Undo/Redo',async()=>{
 const code=readFileSync('apps/server/src/domains/boards/board-routes.ts','utf8');
 assert.match(code,/requireList\(request, reply, listId, "view"\)/);assert.match(code,/requireList\(request, reply, listId, "manage"\)/);assert.match(code,/Cache-Control", "private, no-store"/);
});
await test('UI fetches history lazily and gates offline actions',async()=>{
 const code=readFileSync('packages/renderer/src/features/boards/BoardWorkspacePage.tsx','utf8');
 assert.match(code,/async function restoreColumnSettings/);assert.match(code,/if \(!boardSavedMoveAllowed\)/);assert.match(code,/only your latest uninterrupted saved column edit/i);assert.match(code,/disabled: !boardSavedMoveAllowed/);
});
await test('migration establishes cascading delete and revision uniqueness',()=>{
 const migration=readFileSync('apps/server/prisma/migrations/20261025000000_td6_g25_board_list_saved_history/migration.sql','utf8');
 assert.match(migration,/BoardListSavedOperation_listId_appliedRevision_key/);assert.match(migration,/ON DELETE CASCADE/);
});
function reorderFixture() {
 const lists={L1:{id:'L1',boardId:'B1',position:0,revision:3},L2:{id:'L2',boardId:'B1',position:1,revision:7}};
 let records=[],failInsert=false,failNeighbor=false;
 const copy=v=>structuredClone(v);
 const db={boardList:{findUnique:async({where})=>copy(lists[where.id]??null),updateMany:async({where,data})=>{
  const list=lists[where.id];if(!list || (where.boardId&&where.boardId!==list.boardId) || where.revision!==list.revision || where.position!==undefined&&where.position!==list.position || failNeighbor&&where.id==='L2')return {count:0};
  list.position=data.position;list.revision++;return {count:1};
 }},boardListSavedOperation:{create:async({data})=>{if(failInsert)throw Error('history insert unavailable');const row={id:`R${records.length+1}`,...copy(data)};records.push(row);return row;},findFirst:async()=>copy(records.at(-1)??null),findMany:async()=>copy(records.slice().reverse())},
 $transaction:async(cb,{isolationLevel})=>{assert.equal(isolationLevel,'Serializable');const old=copy({lists,records});try{return await cb(db)}catch(err){Object.assign(lists,old.lists);records=old.records;throw err;}}
 };
 return {db,lists,read:()=>copy({lists,records}),setInsert:x=>failInsert=x,setNeighbor:x=>failNeighbor=x};
}
await test('moving a column records an atomic pair of revisions',async()=>{
 const f=reorderFixture();assert.equal(await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1'),true);
 assert.equal(f.lists.L1.position,1);assert.equal(f.lists.L2.position,0);assert.equal(f.lists.L1.revision,4);assert.equal(f.lists.L2.revision,8);
 assert.equal(f.read().records[0].action,'reorder');
});
await test('failed adjacent-column CAS rolls back first column and history',async()=>{
 const f=reorderFixture();f.setNeighbor(true);
 assert.equal(await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1'),false);
 assert.equal(f.lists.L1.position,0);assert.equal(f.read().records.length,0);
});
await test('history persistence failure rolls back both column moves',async()=>{
 const f=reorderFixture();f.setInsert(true);
 await assert.rejects(history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1'),/insert unavailable/);
 assert.equal(f.lists.L1.position,0);assert.equal(f.lists.L2.position,1);
});
await test('cross-board reorder is refused without touching either row',async()=>{
 const f=reorderFixture();assert.equal(await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2,boardId:'OTHER'},'U1'),false);assert.equal(f.read().records.length,0);
});
await test('reorder Undo atomically restores both List positions',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');
 assert.equal((await history.listBoardListSavedHistory(f.db,'L1','U1')).canUndo,true);
 await history.reverseListSavedOperation(f.db,command('undo','R1',4));
 assert.equal(f.lists.L1.position,0);assert.equal(f.lists.L2.position,1);assert.equal(f.read().records.at(-1).action,'undo_reorder');
});
await test('reorder Redo atomically restores moved order',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');await history.reverseListSavedOperation(f.db,command('undo','R1',4));
 assert.equal((await history.listBoardListSavedHistory(f.db,'L1','U1')).canRedo,true);
 await history.reverseListSavedOperation(f.db,command('redo','R2',5));
 assert.equal(f.lists.L1.position,1);assert.equal(f.lists.L2.position,0);
});
await test('other actor cannot undo an authored reorder',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','R1',4,'U2')),e=>e.code==='LIST_HISTORY_NOT_REVERSIBLE');
});
await test('edited neighboring column blocks reorder history',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');f.lists.L2.revision++;
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','R1',4)),e=>e.code==='LIST_HISTORY_DIVERGED');
});
await test('concurrent reorder race fails without losing the earlier positions',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');
 assert.equal(await history.swapBoardListsWithHistory(f.db,{id:'L1',boardId:'B1',revision:3,position:0},{id:'L2',boardId:'B1',revision:7,position:1},'U2'),false);
 assert.equal(f.lists.L1.position,1);assert.equal(f.lists.L2.position,0);
});
await test('reorder Undo fails closed if second-column CAS fails',async()=>{
 const f=reorderFixture();await history.swapBoardListsWithHistory(f.db,{...f.lists.L1},{...f.lists.L2},'U1');f.setNeighbor(true);
 await assert.rejects(history.reverseListSavedOperation(f.db,command('undo','R1',4)),e=>e.code==='LIST_HISTORY_RACE');
 assert.equal(f.lists.L1.position,1);assert.equal(f.lists.L2.position,0);
});

await test('serialization retries are surfaced as revision conflicts for saved settings',async()=>{
 const f=fixture();const db={...f.db,$transaction:async()=>{throw Object.assign(new Error('serialization conflict'),{code:'P2034'})}};
 assert.equal((await history.saveListWithHistory(db,'L1',3,{title:'new'},'U1')).count,0);
});
await test('serialization retry on history reversal is an actionable 409 conflict',async()=>{
 const f=fixture();const db={...f.db,$transaction:async()=>{throw Object.assign(new Error('serialization conflict'),{code:'P2034'})}};
 await assert.rejects(history.reverseListSavedOperation(db,command('undo','OP1',3)),err=>err.code==='LIST_HISTORY_RACE'&&err.status===409);
});
await test('serialization collision on reorder is a non-success result',async()=>{
 const f=reorderFixture();const db={...f.db,$transaction:async()=>{throw Object.assign(new Error('serialization conflict'),{code:'P2034'})}};
 assert.equal(await history.swapBoardListsWithHistory(db,{...f.lists.L1},{...f.lists.L2},'U1'),false);
});
console.log(`G25 Workstream 15 column history tests ${passed}/${passed} passed`);
