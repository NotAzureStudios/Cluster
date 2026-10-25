/** TD6 G24 source-level route tests: transaction harness, not PostgreSQL certification. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, db, records, projects, drafts, readStates } from './cluster-td6-g23-collaboration-closeout-tests.mjs';
const root = resolve(import.meta.dirname,'../..');
const text = f=>readFileSync(resolve(root,f),'utf8');
const q = {entityType:'project',entityId:'p1',slotKey:'root'};
const get = (who='member',params=q)=>call('GET','/api/entity-comments/draft',who,params);
const put = (who='member',fields={})=>call('PUT','/api/entity-comments/draft',who,{}, {...q,body:'Work in progress',expectedRevision:null,...fields});
const del = (who='member',revision=1,params=q)=>call('DELETE','/api/entity-comments/draft',who,{}, {...params,expectedRevision:revision});
const read = (who='member',entityId='p1')=>call('GET','/api/entity-comments/read-state',who,{entityType:'project',entityId});
const mark = (who='member',through=new Date().toISOString(),entityId='p1')=>call('POST','/api/entity-comments/read-state',who,{}, {entityType:'project',entityId,through});
let passed=0;
async function check(name,test) {await test();passed++;console.log('PASS G24 '+name)}
await check('schema uses private normalized per-user identities and migration constraints',()=>{
 const schema=text('apps/server/prisma/schema.prisma');const sql=text('apps/server/prisma/migrations/20261021233000_td6_g24_discussion_drafts_read_state/migration.sql');
 assert.match(schema,/model EntityCommentDraft/);assert.match(schema,/model EntityCommentReadState/);
 assert.match(schema,/@@unique\(\[userId, entityType, entityId, slotKey\]/);
 assert.match(sql,/REFERENCES "User"\("id"\) ON DELETE CASCADE/);
 assert.match(text('packages/renderer/src/components/CollaborationPanel.tsx'),/rootDraft\.flush\(\)/);
});
await check('drafts require contribution and return only the current author',async()=>{
 assert.equal((await get('outsider')).status,403);
 assert.equal((await put('viewer')).status,403);
 const created=await put();assert.equal(created.status,200);assert.equal(created.body.revision,1);
 assert.equal((await get('member')).body.body,'Work in progress');
 assert.equal((await get('teammate')).body.body,'');
 assert.equal((await get('no-tool')).status,403);
});
await check('same user opening two editors cannot silently overwrite',async()=>{
 const stale=await put('member',{expectedRevision:1,body:'First editor'});
 assert.equal(stale.status,200);assert.equal(stale.body.revision,2);
 const bad=await put('member',{expectedRevision:1,body:'Lost update'});assert.equal(bad.status,409);
 assert.equal((await get()).body.body,'First editor');
 const second=await put('member',{expectedRevision:2,body:'After review'});assert.equal(second.body.revision,3);
 assert.equal((await put('member',{expectedRevision:null})).status,409);
});
await check('stale delete cannot discard newer draft; current revision can',async()=>{
 assert.equal((await del('member',2)).status,409);
 assert.equal((await get()).body.body,'After review');
 assert.equal((await del('member',3)).status,200);
 assert.equal((await get()).body.revision,null);
});
await check('reply drafts are scoped to same resource and existing parent',async()=>{
 const rootComment=records.find(r=>r.entityId==='p1'&&r.parentCommentId===null);
 assert.ok(rootComment);
 const scoped={...q,slotKey:'reply:'+rootComment.id};
 assert.equal((await call('PUT','/api/entity-comments/draft','member',{}, {...scoped,body:'Reply work',expectedRevision:null})).status,200);
 assert.equal((await get('member',scoped)).body.body,'Reply work');
 assert.equal((await get('teammate',scoped)).body.body,'');
 assert.equal((await get('member',{...q,slotKey:'reply:does-not-exist'})).status,404);
 assert.equal((await get('outsider',scoped)).status,403);
 assert.equal((await get('member',{...scoped,entityId:'p2'})).status,404);
});
await check('comment and matching draft cleanup commit atomically',async()=>{
 const created=await put('member',{body:'Published with CAS'});assert.equal(created.status,200);
 const posted=await call('POST','/api/entity-comments','member',{}, {entityType:'project',entityId:'p1',body:'Published with CAS',mentionedUserIds:[],draftRevision:created.body.revision});
 assert.equal(posted.status,200);assert.equal(posted.body.draftCleared,true);assert.equal((await get()).body.revision,null);
});
await check('newer draft survives stale posted comment (no overwrite)',async()=>{
 const a=await put('member',{body:'Original draft'});assert.equal(a.status,200);
 assert.equal((await put('member',{body:'Newer draft',expectedRevision:a.body.revision})).status,200);
 const posted=await call('POST','/api/entity-comments','member',{}, {entityType:'project',entityId:'p1',body:'Original draft',mentionedUserIds:[],draftRevision:a.body.revision});
 assert.equal(posted.status,200);assert.equal(posted.body.draftCleared,false);
 assert.equal((await get()).body.body,'Newer draft');
});
await check('read state is per-user and requires view authority',async()=>{
 assert.equal((await read('outsider')).status,403);assert.equal((await read('no-tool')).status,403);
 const before=await read('member');assert.equal(before.status,200);assert.ok(before.body.unreadCount>=0);
 assert.equal((await mark('outsider')).status,403);
 const marked=await mark('member',before.body.snapshotAt);assert.equal(marked.status,200);
 const after=await read('member');assert.equal(after.body.unreadCount,0);
 const teammate=await read('teammate');assert.equal(teammate.body.lastReadAt,null);
});
await check('monotonic watermark cannot move backward in another tab',async()=>{
 const newer=new Date().toISOString();assert.equal((await mark('member',newer)).status,200);
 const old=new Date(Date.now()-86400000).toISOString();assert.equal((await mark('member',old)).status,200);
 const row=readStates.find(r=>r.userId==='member'&&r.entityId==='p1');
 assert.equal(row.lastReadAt.toISOString(),newer);
});
await check('other entity read watermark is isolated and unauthorized resource hides state',async()=>{
 const x=await read('member','p2');assert.equal(x.body.lastReadAt,null);
 assert.equal((await mark('member',new Date(Date.now()+60000).toISOString())).status,400);
 projects.get('p1').archived=true;
 assert.equal((await get()).status,404);assert.equal((await read()).status,404);
 projects.get('p1').archived=false;
});
await check('reversible metadata actions use CAS and reject a stale inverse',async()=>{
 const root=records.find(r=>r.entityId==='p1'&&r.parentCommentId===null&&!r.deletedAt);
 assert.ok(root);
 const before=root.revision;
 const patch=await call('PATCH','/api/entity-comments/:commentId','member',{}, {pinned:true,expectedRevision:before},{commentId:root.id});
 assert.equal(patch.status,200);assert.equal(patch.body.pinned,true);
 const undo=await call('PATCH','/api/entity-comments/:commentId','member',{}, {pinned:false,expectedRevision:patch.body.revision},{commentId:root.id});
 assert.equal(undo.status,200);assert.equal(undo.body.pinned,false);
 const stale=await call('PATCH','/api/entity-comments/:commentId','member',{}, {pinned:true,expectedRevision:before},{commentId:root.id});
 assert.equal(stale.status,409);
 const redo=await call('PATCH','/api/entity-comments/:commentId','member',{}, {pinned:true,expectedRevision:undo.body.revision},{commentId:root.id});
 assert.equal(redo.status,200);
 assert.equal((await call('PATCH','/api/entity-comments/:commentId','viewer',{}, {pinned:false,expectedRevision:redo.body.revision},{commentId:root.id})).status,403);
 const ui=text('packages/renderer/src/components/CollaborationPanel.tsx');
 assert.match(ui,/traverseHistory\(direction: "undo" \| "redo"\)/);assert.match(ui,/expectedRevision: entry\.expectedRevision/);
});
await check('personal-data export, summary and erasure include private draft authority',()=>{
 const privacy=text('apps/server/src/domains/legal/privacy-data-routes.ts');const erasure=text('apps/server/src/core/privacy-erasure.ts');
 for(const token of ['prisma.entityCommentDraft.count','prisma.entityCommentDraft.findMany','prisma.entityCommentReadState.findMany'])assert.ok(privacy.includes(token),token);
 for(const token of ['prisma.entityCommentDraft.count','["entityCommentDrafts", "entityCommentDraft"','["entityCommentReadStates", "entityCommentReadState"'])assert.ok(erasure.includes(token),token);
 assert.match(text('apps/server/src/core/privacy-data-control.ts'),/PRIVACY_EXPORT_SCHEMA_VERSION = 11/);
});
console.log(`TD6 G24 private discussion draft + read-state: ${passed}/${passed} passed`);
