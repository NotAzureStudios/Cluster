import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBoardRepository } from '../../apps/server/src/domains/boards/board-repository.ts';

let passed=0;
async function check(label, body) { await body(); passed++; console.log('PASS '+label); }
const baseline=[{id:'left',boardId:'board',revision:1,position:0},{id:'right',boardId:'board',revision:1,position:1}];
let rows=structuredClone(baseline);
let failSecond=false;
const prisma={
  async $transaction(callback,options) {
    assert.equal(options.isolationLevel,'Serializable');
    const draft=structuredClone(rows);
    let updates=0;
    const tx={boardList:{async updateMany({where,data}) {
      updates++;
      if(failSecond && updates === 2) return {count:0};
      const match=draft.find(r=>Object.keys(where).every(k=>r[k]===where[k]));
      if(!match)return {count:0};
      match.position=data.position;
      match.revision+=data.revision.increment;
      return {count:1};
    }}};
    const result=await callback(tx);
    rows=draft;
    return result;
  },
};
const repository=createBoardRepository(prisma);
await check('swap persists both positions and revisions',async()=>{
  const result=await repository.swapListPositions(rows[0],rows[1]);
  assert.equal(result,true);
  assert.deepEqual(rows.map(r=>r.position),[1,0]);
  assert.deepEqual(rows.map(r=>r.revision),[2,2]);
});
await check('stale mover cannot silently reorder',async()=>{
  const result=await repository.swapListPositions(baseline[0],baseline[1]);
  assert.equal(result,false);
  assert.deepEqual(rows.map(r=>r.position),[1,0]);
});
await check('second-row conflict rolls back first mutation',async()=>{
  rows=structuredClone(baseline); failSecond=true;
  const result=await repository.swapListPositions(rows[0],rows[1]);
  assert.equal(result,false);
  assert.deepEqual(rows,baseline);
  failSecond=false;
});
await check('database serialization conflicts are surfaced',async()=>{
  const broken={...prisma, async $transaction(){throw Object.assign(new Error('serialization'),{code:'P2034'});}};
  assert.equal(await createBoardRepository(broken).swapListPositions(rows[0],rows[1]),false);
});
await check('unexpected database failures are not swallowed',async()=>{
  const broken={...prisma, async $transaction(){throw new Error('disk failed');}};
  await assert.rejects(()=>createBoardRepository(broken).swapListPositions(rows[0],rows[1]),/disk failed/);
});
await check('route and renderer require observed revision',async()=>{
  const route=fs.readFileSync('apps/server/src/domains/boards/board-routes.ts','utf8');
  const client=fs.readFileSync('packages/renderer/src/features/boards/BoardWorkspacePage.tsx','utf8');
  const schema=fs.readFileSync('apps/server/src/domains/boards/board-schemas.ts','utf8');
  assert.match(schema,/reorderListSchema = z\.object\(\{ direction:[^\n]+expectedRevision/);
  assert.match(route,/expectedRevision !== list.revision/);
  assert.match(route,/sendRevisionConflict\(reply, "column", await repository\.findListForReorder/);
  assert.match(client,/JSON\.stringify\(\{ direction, expectedRevision: list.revision \}\)/);
});
console.log(`${passed}/${passed} v0.509 atomic reorder assertions passed`);
