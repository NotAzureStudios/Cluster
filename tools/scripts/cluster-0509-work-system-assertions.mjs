import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateCommentAtRevision, deleteCommentAtRevision, nextCommentReactions } from '../../apps/server/src/domains/comments/comment-revisions.ts';
import { timelineWeekStart, projectBoardTimelineRows } from '../../packages/renderer/src/features/boards/board-timeline-projection.ts';

let passed = 0;
async function check(label, callback) { await callback(); passed++; console.log(`PASS ${label}`); }
const initial = { id: 'c1', revision: 1, body: 'initial', reactions: '{}', resolved: false };
let record = { ...initial };
const store = { entityComment: {
  async updateMany({where,data}) {
    if (!record || where.id !== record.id || where.revision !== record.revision) return {count:0};
    const { revision, ...changes } = data;
    record = {...record, ...changes, revision:record.revision + revision.increment};
    return {count:1};
  },
  async deleteMany({where}) {
    if (!record || where.id !== record.id || where.revision !== record.revision) return {count:0};
    record=null; return {count:1};
  },
}};
await check('revision CAS accepts first mutation', async () => { assert.equal(await updateCommentAtRevision(store,'c1',1,{body:'editor 1'}),true); assert.equal(record.body,'editor 1'); assert.equal(record.revision,2); });
await check('stale editor cannot overwrite body', async () => { assert.equal(await updateCommentAtRevision(store,'c1',1,{body:'editor 2'}),false); assert.equal(record.body,'editor 1'); });
await check('atomic race has one winner', async () => { const both=await Promise.all([updateCommentAtRevision(store,'c1',2,{pinned:true}),updateCommentAtRevision(store,'c1',2,{resolved:true})]); assert.deepEqual(both.sort(),[false,true]); assert.equal(record.revision,3); });
await check('stale delete does not remove new work', async () => { assert.equal(await deleteCommentAtRevision(store,'c1',1),false); assert.ok(record); });
await check('current revision can delete', async () => { assert.equal(await deleteCommentAtRevision(store,'c1',3),true); assert.equal(record,null); });
await check('invalid revisions never write', async () => { assert.equal(await updateCommentAtRevision(store,'c1',0,{body:'bad'}),false); assert.equal(await deleteCommentAtRevision(store,'c1',NaN),false); });
await check('reactions merge different people without data loss', async () => { let state=nextCommentReactions({},'👍','u1',true); state=nextCommentReactions(state,'👍','u2',true); assert.deepEqual(state['👍'],['u1','u2']); });
await check('reaction retries are idempotent', async () => { let state=nextCommentReactions({},'✅','u1',true); state=nextCommentReactions(state,'✅','u1',true); assert.deepEqual(state['✅'],['u1']); state=nextCommentReactions(state,'✅','u1',false); assert.equal(state['✅'],undefined); });
await check('prototype keys rejected', async () => { for (const key of ['__proto__','constructor','prototype']) assert.throws(()=>nextCommentReactions({},key,'u',true)); });
await check('weeks begin Monday in local calendar', async () => { assert.equal(timelineWeekStart(new Date(2026,9,8)).getDay(),1); });
const row=(id,startDate,dueDate)=>({card:{id,title:id,startDate,dueDate},list:{id:'l',title:'Todo'}});
const anchor=new Date(2026,9,5);
await check('UTC-midnight Card dates preserve assigned calendar day', async () => { const r=projectBoardTimelineRows([row('a','2026-10-05T00:00:00.000Z','2026-10-05T00:00:00.000Z')],anchor); assert.equal(r.scheduled[0].left,0); });
await check('timeline retains canonical card identity', async () => { const r=projectBoardTimelineRows([row('a','2026-10-05','2026-10-12')],anchor); assert.equal(r.scheduled.length,1); assert.equal(r.scheduled[0].card.id,'a'); assert.ok(r.scheduled[0].width>0); });
await check('timeline distinguishes undated and offscreen', async () => { const r=projectBoardTimelineRows([row('a',null,null),row('b','2020-01-01','2020-01-02')],anchor); assert.equal(r.undated.length,1); assert.equal(r.outOfRange,1); });
await check('reversed ranges are visible and flagged', async () => { const r=projectBoardTimelineRows([row('a','2026-10-10','2026-10-06')],anchor); assert.equal(r.scheduled.length,1); assert.equal(r.scheduled[0].reversed,true); });
const src=(path)=>fs.readFileSync(path,'utf8');
await check('revision migration and Prisma agree', async () => { const schema=src('apps/server/prisma/schema.prisma'); const migration=src('apps/server/prisma/migrations/20261008210000_entity_comment_revisions/migration.sql'); assert.match(schema,/model EntityComment {[\s\S]*?revision\s+Int\s+@default\(1\)/); assert.match(migration,/ALTER TABLE "EntityComment" ADD COLUMN "revision"/); });
await check('server rejects stale comment mutations and merges reactions with CAS', async () => {const route=src('apps/server/src/domains/comments/entity-comment-routes.ts'); assert.match(route,/COMMENT_REVISION_CONFLICT/); assert.match(route,/updateCommentAtRevision\(prisma/); assert.match(route,/deleteCommentAtRevision\(prisma/); assert.match(route,/nextCommentReactions\(parseReactionMap/); assert.match(route,/for \(let attempt = 0; attempt < 6; attempt\+\+\)/); });
await check('client submits observed revisions and reloads after conflicts',async()=>{const c=src('packages/renderer/src/components/CollaborationPanel.tsx'); assert.match(c,/expectedRevision: comment.revision/); assert.match(c,/expectedRevision=\$\{comment.revision\}/); assert.match(c,/await loadRemote\(true\)/); });
await check('Board has five views and retains saved timeline mode',async()=>{const c=src('packages/renderer/src/features/boards/BoardWorkspacePage.tsx'); assert.match(c,/\["timeline", "Timeline"\]/); assert.match(c,/viewMode === "timeline"/); assert.match(c,/"table", "timeline", "calendar"/); });
console.log(`${passed}/${passed} v0.509 Work System assertions passed`);
