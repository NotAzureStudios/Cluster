import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  commitSavedCardUpdate, listSavedCardHistory, reverseSavedCardOperation,
  snapshotCardFields, cardSavedChangedFields, savedCardHistoryCapabilities, SavedCardHistoryError,
} from '../../apps/server/src/domains/cards/card-saved-history.ts';

const card0 = () => ({ id: 'card-1', revision: 1, title: 'Initial', description: 'Description', priority: 'medium',
  archived: false, labels: '[]', memberIds: '["a"]', watcherIds: '[]', listId: 'list-1',
  dueDate: null, startDate: null, deferredUntil: null, completionCriteria: null, category: null,
  coverColor: null, coverImage: null, estimatePoints: 2, assigneeId: null, externalUrl: null });
function fakeDb() {
  let state = { card: card0(), operations: [] }; let txQueue = Promise.resolve(); let nextId = 0;
  const dbOps = (get, put) => ({
    card: {
      findUnique: async ({ where }) => get().card?.id === where.id ? structuredClone(get().card) : null,
      findUniqueOrThrow: async ({ where }) => { const result = get().card?.id === where.id ? structuredClone(get().card) : null; if (!result) throw Error('missing card'); return result; },
      updateMany: async ({ where, data }) => {
        if (!get().card || get().card.id !== where.id || get().card.revision !== where.revision) return { count: 0 };
        const changed = structuredClone(get().card);
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) continue;
          changed[key] = key === 'revision' && typeof value === 'object' ? changed[key] + value.increment : structuredClone(value);
        }
        put({ ...get(), card: changed }); return { count: 1 };
      },
    },
    cardSavedOperation: {
      findFirst: async ({ where }) => [...get().operations].filter((op) => op.cardId === where.cardId).sort((a, b) => b.appliedRevision - a.appliedRevision)[0] || null,
      findMany: async ({ where, take }) => [...get().operations].filter((op) => op.cardId === where.cardId).sort((a, b) => b.appliedRevision - a.appliedRevision).slice(0, take),
      create: async ({ data }) => {
        if (get().operations.some((op) => op.cardId === data.cardId && op.appliedRevision === data.appliedRevision)) throw Error('unique revision');
        const op = { id: `op-${++nextId}`, createdAt: new Date('2026-10-17T00:00:00Z'), ...structuredClone(data) };
        put({ ...get(), operations: [...get().operations, op] }); return op;
      },
    },
  });
  const external = dbOps(() => state, (next) => { state = next; });
  return {
    ...external,
    async $transaction(fn) {
      const started = txQueue;
      let release; txQueue = new Promise((resolve) => { release = resolve; });
      await started;
      let staged = structuredClone(state);
      const tx = dbOps(() => staged, (next) => { staged = next; });
      try { const result = await fn(tx); state = staged; return result; }
      finally { release(); }
    },
    get state() { return state; },
    mutate(fn) { fn(state); },
  };
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
async function rejectCode(work, code) { await assert.rejects(work, (error) => error instanceof SavedCardHistoryError && error.code === code); }
await check('Snapshots normalize date and JSON arrays without modifying source', () => {
  const raw = card0(); raw.dueDate = new Date('2026-10-17T10:00:00Z');
  const snap = snapshotCardFields(raw, ['dueDate','labels','memberIds']);
  assert.equal(snap.dueDate, '2026-10-17T10:00:00.000Z'); assert.deepEqual(snap.memberIds, ['a']);
  snap.memberIds.push('b'); assert.equal(raw.memberIds, '["a"]');
});
await check('Changed fields compare by stable normalized values', () => {
  assert.deepEqual(cardSavedChangedFields({title:'a', memberIds:['a']},{title:'b',memberIds:['a']}, ['title','memberIds']),['title']);
});
const db = fakeDb();
await check('First save commits the Card revision and history as one transaction', async () => {
  assert.equal((await commitSavedCardUpdate(db,'card-1',1,{title:'Edited', priority:'urgent'},'alice')).count,1);
  assert.equal(db.state.card.revision, 2); assert.equal(db.state.card.title,'Edited');
  assert.equal(db.state.operations.length,1);
  assert.deepEqual(JSON.parse(db.state.operations[0].fields),['title','priority']);
  assert.deepEqual(JSON.parse(db.state.operations[0].before), {title:'Initial',priority:'medium'});
});
await check('Fresh read exposes field names only, never previous or new Card values', async () => {
  const history = await listSavedCardHistory(db,'card-1','alice');
  assert.equal(history.canUndo,true); assert.equal(history.canRedo,false);
  assert.equal(history.operations[0].actorUserId,'alice');
  assert.ok(!JSON.stringify(history).includes('Initial') && !JSON.stringify(history).includes('Edited'));
});
await check('Another editor cannot undo someone else\'s save', async () => {
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'bob',action:'undo',expectedRevision:2,operationId:'op-1'}),'CARD_HISTORY_NOT_REVERSIBLE');
  assert.equal(db.state.card.title,'Edited');
});
await check('Explicit operation identifier must match most recent history', async () => {
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:2,operationId:'fake'}),'CARD_HISTORY_NOT_REVERSIBLE');
});
await check('Undo changes only the original fields and creates an inverse operation', async () => {
  const undo = await reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:2,operationId:'op-1'});
  assert.equal(undo.revision,3); assert.equal(db.state.card.title,'Initial'); assert.equal(db.state.card.priority,'medium');
  assert.equal(db.state.operations[1].action,'undo'); assert.equal(db.state.operations[1].sourceOperationId,'op-1');
  assert.equal((await listSavedCardHistory(db,'card-1','alice')).canRedo,true);
});
await check('Undo cannot be repeated; redo reapplies the original saved change', async () => {
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:3,operationId:'op-2'}),'CARD_HISTORY_WRONG_DIRECTION');
  const redo = await reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'redo',expectedRevision:3,operationId:'op-2'});
  assert.equal(redo.revision,4); assert.equal(db.state.card.title,'Edited'); assert.equal(db.state.card.priority,'urgent');
  assert.equal((await listSavedCardHistory(db,'card-1','alice')).canUndo,true);
});
await check('Redo can itself be undone, keeping immutable operation evidence', async () => {
  await reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:4,operationId:'op-3'});
  assert.equal(db.state.card.title,'Initial'); assert.equal(db.state.operations.length,4);
});
await check('Concurrent stale metadata saves cannot both win', async () => {
  const result=await Promise.all([commitSavedCardUpdate(db,'card-1',5,{description:'Alice'},'alice'),commitSavedCardUpdate(db,'card-1',5,{description:'Bob'},'bob')]);
  assert.deepEqual(result.map((entry) => entry.count).sort(),[0,1]);
  assert.equal(db.state.operations.length,5);
});
await check('Another editor\'s latest save blocks the former actor\'s Undo', async () => {
  const history=await listSavedCardHistory(db,'card-1','alice');
  if (history.operations[0].actorUserId === 'alice') {
    await commitSavedCardUpdate(db,'card-1',db.state.card.revision,{category:'Other editor'},'bob');
  }
  const previous=db.state.operations.at(-2);
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:db.state.card.revision,operationId:previous.id}),'CARD_HISTORY_NOT_REVERSIBLE');
});
await check('Card moves/external revisions disable saved Undo, even if values match', async () => {
  const editor=db.state.operations.at(-1).actorUserId;
  const previous=db.state.operations.at(-1);
  db.mutate((state) => { state.card.revision++; state.card.listId='list-2'; });
  assert.equal((await listSavedCardHistory(db,'card-1',editor)).canUndo,false);
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:editor,action:'undo',expectedRevision:db.state.card.revision,operationId:previous.id}),'CARD_HISTORY_NOT_REVERSIBLE');
});
await check('Stale revision fails before applying a saved history command', async () => {
  await rejectCode(() => reverseSavedCardOperation(db,{cardId:'card-1',actorUserId:'bob',action:'undo',expectedRevision:1,operationId:'op-5'}),'CARD_HISTORY_STALE');
});
await check('Direct out-of-band mutations cannot be overwritten even with unchanged revision', async () => {
  const x=fakeDb(); await commitSavedCardUpdate(x,'card-1',1,{title:'X'},'alice');
  x.mutate((state)=>{state.card.title='out of band';});
  await rejectCode(() => reverseSavedCardOperation(x,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:2,operationId:'op-1'}),'CARD_HISTORY_DIVERGED');
  assert.equal(x.state.card.title,'out of band');
});
await check('Transaction failure rolls back Card mutation and history together', async () => {
  const x=fakeDb(); const create=x.cardSavedOperation.create;
  x.$transaction=async (fn)=>{ const saved=structuredClone(x.state); try{ const tx={...x,cardSavedOperation:{...x.cardSavedOperation,create: async()=>{throw Error('storage failed');}}}; return await fn(tx); } catch(err){ x.mutate((state)=>Object.assign(state,saved)); throw err; } };
  await assert.rejects(()=>commitSavedCardUpdate(x,'card-1',1,{title:'New'},'alice'),/storage failed/);
  assert.equal(x.state.card.title,'Initial'); assert.equal(x.state.operations.length,0);
});
await check('Missing Card produces clean not-found and history remains inaccessible', async () => {
  const x=fakeDb(); x.mutate((s)=>{s.card=null;});
  await rejectCode(()=>reverseSavedCardOperation(x,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:1,operationId:'op-1'}),'CARD_NOT_FOUND');
  await rejectCode(()=>listSavedCardHistory(x,'card-1','alice'),'CARD_NOT_FOUND');
});
await check('Megabyte cover-image edits create a non-reversible history barrier without copying source image', async () => {
  const x = fakeDb(); const original = 'data:image/png;base64,' + 'A'.repeat(250_000);
  await commitSavedCardUpdate(x,'card-1',1,{coverImage: original, title:'Renamed'},'alice');
  const row = x.state.operations[0];
  assert.equal(row.action,'barrier'); assert.equal(row.before,'{}'); assert.equal(row.after,'{}');
  assert.deepEqual(JSON.parse(row.fields),['title','coverImage']);
  assert.equal((await listSavedCardHistory(x,'card-1','alice')).canUndo,false);
  assert.equal(x.state.card.coverImage,original);
  await rejectCode(()=>reverseSavedCardOperation(x,{cardId:'card-1',actorUserId:'alice',action:'undo',expectedRevision:2,operationId:row.id}),'CARD_HISTORY_WRONG_DIRECTION');
});
await check('No-op save does not invent a reversible history action', async () => {
  const x=fakeDb(); await commitSavedCardUpdate(x,'card-1',1,{title:'Initial'},'alice');
  assert.equal(x.state.card.revision,2); assert.equal(x.state.operations.length,0);
});
const source=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
await check('Prisma migration owns history and cascade cleanup', () => {
  const s=source('apps/server/prisma/schema.prisma'); const m=source('apps/server/prisma/migrations/20261017210000_td6_card_saved_history/migration.sql');
  assert.match(s,/model CardSavedOperation/); assert.match(m,/ON DELETE CASCADE/); assert.match(m,/UNIQUE INDEX/);
});
await check('Both history commands are permission checked and require explicit intent', () => {
  const route=source('apps/server/src/domains/cards/card-routes.ts');
  assert.match(route,/saved-history\/\$\{direction\}/); assert.match(route,/requireCard\(request, reply, cardId, "contribute"\)/);
  assert.match(route,/savedCardHistoryCommandSchema\.parse/); assert.match(route,/"private, no-store"/);
});
await check('Card service persists actor-scoped edit history through its repository', () => {
  const repo=source('apps/server/src/domains/cards/card-repository.ts'); const svc=source('apps/server/src/domains/cards/card-service.ts');
  assert.match(repo,/commitSavedCardUpdate\(prisma, cardId, revision/);assert.match(svc,/repository\.updateCard\(existing\.id, existing\.revision, body, userId\)/);
});
await check('Saved history UI never auto-replays on stale or dirty local drafts', () => {
  const ui=source('packages/renderer/src/features/boards/BoardWorkspaceDialogs.tsx');
  assert.match(ui,/savedHistory\.currentRevision !== openedRevision/);assert.match(ui,/editorDirty \|\| conflictCard/);
  assert.match(ui,/Undo saved/);assert.match(ui,/Redo saved/);assert.match(ui,/Saved edit history/);
});
console.log(`TD6 F03 saved Card history: ${passed}/${passed} checks passed`);
