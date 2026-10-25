// Execute with node --experimental-strip-types: source-only interaction tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeBoardBulk, describeBoardBulkOutcome } from '../../packages/renderer/src/features/boards/board-bulk-runner.ts';
import { recordBoardCardMove, completeBoardCardMove, discardConflictedBoardCard, EMPTY_BOARD_MOVE_HISTORY } from '../../packages/renderer/src/features/boards/board-card-move-history.ts';
import { describeLibraryBulkImpact, captureLibraryBulkRevisions, MAX_LIBRARY_BULK_IDS } from '../../packages/renderer/src/features/library/library-bulk-impact.ts';
let checks = 0;
const check = (name, action) => { action(); checks++; console.log(`PASS ${name}`); };
const move = (id, revision, to = 'done') => ({ cardId: id, title: id, fromListId: 'todo', fromIndex: 0, toListId: to, toIndex: 1, revision });
check('Board records ordered moves and drops redo on a new operation', () => {
  let h = recordBoardCardMove(EMPTY_BOARD_MOVE_HISTORY, move('a', 2));
  h = completeBoardCardMove(h, 'undo', 'a', 3);
  assert.equal(h.redo.length, 1);
  h = recordBoardCardMove(h, move('b', 2));
  assert.deepEqual(h.redo, []);
  assert.equal(h.undo.length, 1);
});
check('Board replays consecutive same-card operations with own new revisions', () => {
  let h = recordBoardCardMove(EMPTY_BOARD_MOVE_HISTORY, move('a', 2));
  h = recordBoardCardMove(h, { ...move('a', 3, 'review'), fromListId: 'done' });
  h = completeBoardCardMove(h, 'undo', 'a', 4);
  assert.equal(h.undo.at(-1)?.revision, 4);
  h = completeBoardCardMove(h, 'undo', 'a', 5);
  assert.equal(h.redo.length, 2);
  h = completeBoardCardMove(h, 'redo', 'a', 6);
  assert.equal(h.redo.at(-1)?.revision, 6);
  h = completeBoardCardMove(h, 'redo', 'a', 7);
  assert.equal(h.undo.length, 2);
  assert.equal(h.redo.length, 0);
});
check('Board does not adopt stale or unchanged server revisions', () => {
  const h = recordBoardCardMove(EMPTY_BOARD_MOVE_HISTORY, move('a', 4));
  assert.equal(completeBoardCardMove(h, 'undo', 'a', 4), h);
  assert.equal(completeBoardCardMove(h, 'undo', 'b', 9), h);
  assert.equal(completeBoardCardMove(h, 'undo', 'a', 0), h);
});
check('Board conflict only clears impacted card history', () => {
  let h = recordBoardCardMove(EMPTY_BOARD_MOVE_HISTORY, move('a', 2));
  h = recordBoardCardMove(h, move('b', 3));
  h = discardConflictedBoardCard(h, 'a');
  assert.equal(h.undo.length, 1);
  assert.equal(h.undo[0].cardId, 'b');
});
check('Board session history is bounded', () => {
  let h = EMPTY_BOARD_MOVE_HISTORY;
  for (let i=0; i<45; i++) h = recordBoardCardMove(h, move(String(i), 2));
  assert.equal(h.undo.length, 30);
  assert.equal(h.undo[0].cardId, '15');
});
// Board bulk mutations remain individually authorized; failures are explicitly partial.
await (async () => {
  const rows = [{id:'a',title:'A'}, {id:'b',title:'B'}, {id:'c',title:'C'}, {id:'d',title:'D'}];
  const progress=[];
  const result = await executeBoardBulk(rows, async (row) => {
    if (row.id === 'a') return { queued: false };
    if (row.id === 'b') return { queued: true };
    if (row.id === 'c') return 'skip';
    throw new Error('Revision conflict');
  }, (done,total)=>progress.push(`${done}/${total}`));
  check('Board bulk distinguishes applied, queued, skipped and failed per-card results', () => {
    assert.deepEqual([result.applied,result.queued,result.skipped,result.failures.length],[1,1,1,1]);
    assert.deepEqual(progress,['1/4','2/4','3/4','4/4']);
    assert.equal(result.failures[0].id,'d');
    assert.match(describeBoardBulkOutcome(result),/Revision conflict/);
  });
  const empty = await executeBoardBulk([],async()=>({}));
  check('Board bulk accepts an empty selection without mutation',()=>assert.deepEqual([empty.applied,empty.queued,empty.failures.length],[0,0,0]));
})();
const loaded = [{id:'folder',title:'References',type:'folder',revision:3},{id:'asset',title:'Logo.png',type:'file',revision:6}];
check('Library describes selected folders and their descendant uncertainty', () => {
  const impact = describeLibraryBulkImpact('move',['folder','asset'],loaded,'Marketing');
  assert.equal(impact.count,2);
  assert.match(impact.message,/descendants/);
  assert.match(impact.message,/Marketing/);
  assert.equal(impact.needsConfirmation,true);
});
check('Library always previews Trash and Restore, large non-destructive batches', () => {
  assert.equal(describeLibraryBulkImpact('trash',['asset'],loaded).needsConfirmation,true);
  assert.equal(describeLibraryBulkImpact('restore',['asset'],loaded).needsConfirmation,true);
  assert.equal(describeLibraryBulkImpact('pin',['asset'],loaded).needsConfirmation,false);
  assert.equal(describeLibraryBulkImpact('pin',Array.from({length:30},(_,i)=>String(i)),[]).needsConfirmation,true);
});
check('Library enforces same 200-item cap as server', () => {
  assert.equal(MAX_LIBRARY_BULK_IDS,200);
  assert.throws(()=>describeLibraryBulkImpact('pin',[],[]),/between 1 and 200/);
  assert.throws(()=>describeLibraryBulkImpact('pin',Array.from({length:201},(_,i)=>String(i)),[]),/between 1 and 200/);
  assert.throws(()=>describeLibraryBulkImpact('pin',['asset','asset'],loaded),/distinct/);
});
check('Library snapshots authoritative revisions and rejects missing revision', () => {
  assert.deepEqual({...captureLibraryBulkRevisions(['asset','folder'],loaded)},{asset:6,folder:3});
  assert.throws(()=>captureLibraryBulkRevisions(['missing'],loaded),/reliable revision/);
  assert.throws(()=>captureLibraryBulkRevisions(['asset'],[{id:'asset',title:'x',type:'file',revision:0}]),/reliable revision/);
});
const code = (name)=>readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const board=code('packages/renderer/src/features/boards/BoardWorkspacePage.tsx');
const library=code('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const routes=code('apps/server/src/domains/library/library-routes.ts');
const dialog=code('packages/renderer/src/components/ClusterDialogHost.tsx');
check('Board invokes revision-checked mutations for undo/redo and refuses queued replay',()=>{
  assert.match(board,/expectedRevision: entry\.revision/);
  assert.match(board,/setMoveHistory\(EMPTY_BOARD_MOVE_HISTORY\);\s*setCategoryStatus\(`\$\{direction/);
  assert.match(board,/discardConflictedBoardCard\(history, entry\.cardId\)/);
  assert.match(board,/handleMoveHistoryShortcuts/);
  assert.match(board,/executeBoardBulk\(snapshot, mutation/);
  assert.match(board,/setSelectedCardIds\(new Set\(\[\.\.\.outcome\.failures\.map/);
  assert.match(board,/bulkOperationBusyRef\.current = true/);
});
check('Library confirms impact, prevents duplicate submissions and captures source revisions',()=>{
  assert.match(library,/bulkPendingRef\.current = true/);
  assert.match(library,/confirmCluster\(\{ title: impact\.title, message: impact\.message/);
  assert.match(library,/captureLibraryBulkRevisions\(ids, items\)/);
  assert.match(library,/JSON\.stringify\(\{ ids, action, expectedRevisions/);
});
check('Library server enforces revision CAS in one database transaction',()=>{
  assert.match(routes,/expectedRevisions: z\.record\(z\.number\(\)\.int\(\)\.positive\(\)\)/);
  assert.match(routes,/await prisma\.\$transaction\(async \(tx: any\)/);
  assert.match(routes,/tx\.libraryItem\.updateMany\(\{ where: \{ id: item\.id, revision: body\.expectedRevisions\[item\.id\] \}/);
  assert.match(routes,/if \(updated\.count !== 1\) throw new BulkRevisionConflict/);
  assert.match(routes,/LIBRARY_BULK_REVISION_CONFLICT/);
});
check('Library confirmation renders multiline impact previews legibly',()=>{
  assert.match(dialog,/whiteSpace: "pre-line"/);
});
console.log(`${checks}/${checks} WIP528 Board/Library interaction assertions passed`);
