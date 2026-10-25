import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadServer(file, imports = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (id) => imports[id] ?? require(id), Date, Buffer, JSON, Set, Map, Error }, { filename: file });
  return mod.exports;
}
const listHistory = loadServer('../../apps/server/src/domains/boards/board-list-saved-history.ts');
const { createBoardRepository } = loadServer('../../apps/server/src/domains/boards/board-repository.ts', { './board-list-saved-history.js': listHistory, './board-list-lifecycle.js': { permanentlyDeleteUnusedList: async (_db, input) => ({ ok: true, guarded: input }) } });
import { startBoardCardDraftHistory, recordBoardCardDraft, traverseBoardCardDraft } from '../../packages/renderer/src/features/boards/board-card-draft-history.ts';
const modal = readFileSync(new URL('../../packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../packages/renderer/src/features/boards/BoardWorkspacePage.tsx', import.meta.url), 'utf8');
const boardRoute = readFileSync(new URL('../../apps/server/src/domains/boards/board-routes.ts', import.meta.url), 'utf8');
const boardService = readFileSync(new URL('../../apps/server/src/domains/boards/board-service.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../apps/server/src/domains/cards/card-routes.ts', import.meta.url), 'utf8');
const repo = readFileSync(new URL('../../apps/server/src/domains/cards/card-repository.ts', import.meta.url), 'utf8');
let tests=0;
const pending=[];
function test(label, cb){const result=cb();if(result&&typeof result.then==='function')pending.push(result.then(()=>console.log('PASS',label)));else console.log('PASS',label);tests++;}
const draft = (title='Initial', memberIds=['a'])=>({title,description:'description',priority:'medium',assigneeId:'',dueDate:'',startDate:'',deferredUntil:'',completionCriteria:'',category:'',coverColor:'',coverImage:'',estimatePoints:'',memberIds,watching:false,labels:'',externalUrl:''});
test('draft initial history is blank',()=>{const x=startBoardCardDraftHistory(draft()); assert.equal(x.present.title,'Initial'); assert.equal(x.undo.length,0);});
test('first edit records original state',()=>{const a=recordBoardCardDraft(startBoardCardDraftHistory(draft()),draft('Changed')); assert.deepEqual(a.undo.map(x=>x.title),['Initial']);});
test('repeat unchanged state does not expand history',()=>{const x=startBoardCardDraftHistory(draft());assert.strictEqual(recordBoardCardDraft(x,draft()),x);});
test('multiple changes support multi-step undo',()=>{let x=startBoardCardDraftHistory(draft());for(const name of ['A','B','C']) x=recordBoardCardDraft(x,draft(name));for(const expect of ['B','A','Initial']){x=traverseBoardCardDraft(x,'undo');assert.equal(x.present.title,expect);}assert.equal(x.undo.length,0);});
test('redo restores changes',()=>{let x=recordBoardCardDraft(startBoardCardDraftHistory(draft()),draft('B'));x=traverseBoardCardDraft(x,'undo');x=traverseBoardCardDraft(x,'redo');assert.equal(x.present.title,'B');assert.equal(x.redo.length,0);});
test('new branch discards redo',()=>{let x=recordBoardCardDraft(startBoardCardDraftHistory(draft()),draft('A'));x=traverseBoardCardDraft(x,'undo');x=recordBoardCardDraft(x,draft('B'));assert.equal(x.redo.length,0);assert.equal(x.present.title,'B');});
test('undo with no entry is a no-op',()=>{const x=startBoardCardDraftHistory(draft());assert.strictEqual(traverseBoardCardDraft(x,'undo'),x);});
test('redo with no entry is a no-op',()=>{const x=startBoardCardDraftHistory(draft());assert.strictEqual(traverseBoardCardDraft(x,'redo'),x);});
test('history is capped for large editing sessions',()=>{let x=startBoardCardDraftHistory(draft());for(let i=0;i<100;i++) x=recordBoardCardDraft(x,draft('v'+i));assert.equal(x.undo.length,40);assert.equal(x.present.title,'v99');});
test('input arrays are cloned and future mutations do not change history',()=>{let members=['a'];let x=startBoardCardDraftHistory(draft('A',members));members.push('b');assert.deepEqual(x.present.memberIds,['a']);x=recordBoardCardDraft(x,draft('B'));x.present.memberIds.push('c');assert.deepEqual(x.undo[0].memberIds,['a']);});
test('nested member selections restore correctly',()=>{let x=recordBoardCardDraft(startBoardCardDraftHistory(draft('A',['a'])),draft('A',['a','b']));x=traverseBoardCardDraft(x,'undo');assert.deepEqual(x.present.memberIds,['a']);});
test('card Save carries original revision to mutation payload',()=>{assert.match(modal,/body:\s*\{\s*\.\.\.cardMetadata, expectedRevision: openedRevision\s*\}/);assert.match(modal,/Number\.isSafeInteger\(openedRevision\)/);});
test('card repository uses conditional revision increment',()=>{assert.match(repo,/where:\s*\{ id: cardId, revision \}/);assert.match(repo,/revision:\s*\{ increment: 1 \}/);});
test('card route returns 409 on stale data',()=>{assert.match(route,/body\.expectedRevision !== existing\.revision/);assert.match(route,/sendRevisionConflict\(reply, "card"/);});
test('editor prevents duplicate submissions before React render',()=>{assert.match(modal,/if \(savePendingRef\.current\) return;/);assert.match(modal,/savePendingRef\.current = true;/);assert.match(modal,/savePendingRef\.current = false;/);});
test('draft undo/redo are visible and disabled during save',()=>{assert.match(modal,/Undo draft \(\{draftHistory\.undo\.length\}\)/);assert.match(modal,/disabled=\{saving \|\| !draftHistory\.redo\.length\}/);});
test('editing text retains native undo behavior',()=>{assert.match(modal,/boardHistoryTargetContext\(event\.target/);const keyboard=readFileSync(new URL('../../packages/renderer/src/features/boards/board-history-shortcuts.ts',import.meta.url),'utf8');assert.match(keyboard,/\[contenteditable\]/);assert.match(keyboard,/\[role=\"textbox\"\]/);});
test('secondary edits refresh card without closing the modal',()=>{assert.match(modal,/if \(refreshed\) setCard\(refreshed\)/);assert.match(page,/onActivitySaved=\{async \(\) => \{/);assert.match(page,/return refreshed\.lists\.flatMap/);});
test('Card revision only advances after explicit three-way conflict review, not comments refresh',()=>{assert.match(modal,/const \[openedRevision, setOpenedRevision\] = useState\(initialCard\?\.revision\)/);assert.match(modal,/setOpenedRevision\(conflictCard\.revision\)/);assert.match(modal,/setReviewBaseline\(serverBaseline\)/);});
test('Board rename uses observed revision and blocks repeated action',()=>{assert.match(modal,/boardRevisionRef\.current/);assert.match(modal,/name: renameBoardName\.trim\(\), expectedRevision: revision/);assert.match(modal,/if \(actionInFlight\.current\) return;/);});
test('Column rename uses observed revision and confirms new revision',()=>{assert.match(modal,/listRevisionRef\.current\[listId\]/);assert.match(modal,/JSON\.stringify\(\{ title, expectedRevision: revision \}\)/);});
test('Card detail keyed so switching Card remounts editor state',()=>{assert.match(page,/key=\{selectedCard\.id\}/);});
test('Board disposal no longer cascades through work',()=>{
 const text=readFileSync(new URL('../../apps/server/src/domains/boards/board-repository.ts',import.meta.url),'utf8');
 assert.match(text,/tx\.card\.count\(\{ where: \{ list: \{ boardId: board\.id \}/);
 assert.match(text,/BOARD_DELETE_BLOCKED/);
});
test('Column disposal delegates to guarded no-cascade helper',()=>{
 const repo=createBoardRepository({});
 const list={id:'list-1',revision:5,boardId:'b1',board:{projectId:'p1',project:{workspaceId:'ws'}},cards:[{id:'c1'}]};
 return repo.deleteList(list).then(result=>{
  assert.equal(result.guarded.listId,'list-1');assert.equal(result.guarded.expectedRevision,5);
 });
});
test('stale deletion Prisma record error surfaces as revision conflict rather than 500',()=>{
 assert.match(boardService,/if \(\(error as any\)\?\.code === "P2025"\) return \{ conflict: await repository\.findBoardForMutation/);
 assert.match(boardService,/if \(\(error as any\)\?\.code === "P2025"\) return \{ conflict: await repository\.findListForMutation/);
 assert.match(boardRoute,/if \("conflict" in result\) return sendRevisionConflict\(reply, "board"/);
 assert.match(boardRoute,/if \("conflict" in result\) return sendRevisionConflict\(reply, "column"/);
});
test('destructive Board management actions send expected revision',()=>{
 assert.match(modal,/\/api\/boards\/\$\{boardToDeleteId\}[^\n]+JSON\.stringify\(\{ expectedRevision \}\)/);
 assert.match(modal,/\/api\/lists\/\$\{list\.id\}[^\n]+JSON\.stringify\(\{ expectedRevision \}\)/);
});
await Promise.all(pending);
console.log(`Cluster 0.534 Board closeout: ${tests}/${tests} passed`);
