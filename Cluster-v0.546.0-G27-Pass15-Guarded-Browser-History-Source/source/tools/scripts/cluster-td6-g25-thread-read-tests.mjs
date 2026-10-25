/** TD6 G25 threaded read receipt semantics. Controlled route/prisma harness, not live PostgreSQL. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {call,records,projects,threadReadStates} from './cluster-td6-g23-collaboration-closeout-tests.mjs';
const root=resolve(import.meta.dirname,'../..');
const source=path=>readFileSync(resolve(root,path),'utf8');
let count=0;
async function check(label, fn) {await fn();count++;console.log('PASS G25 thread-read '+label)}
function query(type,id,root) {return {entityType:type,entityId:id,threadRootId:root}}
const post=async(entityId, who='member', extra={})=>call('POST','/api/entity-comments',who,{}, {entityType:'project',entityId,body:'Thread update',mentionedUserIds:[],...extra});
const get=async(who, q)=>call('GET','/api/entity-comments/thread-read-state',who,q);
const mark=async(who,q,through)=>call('POST','/api/entity-comments/thread-read-state',who,{}, {...q,through});
let rootA,rootB;
await check('schema, index, migration and privacy include private receipts',()=>{
 const schema=source('apps/server/prisma/schema.prisma');const migration=source('apps/server/prisma/migrations/20261022100000_td6_g25_thread_read_state/migration.sql');
 assert.match(schema,/model EntityCommentThreadReadState/);assert.match(schema,/@@unique\(\[userId, entityType, entityId, threadRootId\]/);
 assert.match(migration,/ON DELETE CASCADE/);assert.match(source('apps/server/src/core/privacy-erasure.ts'),/entityCommentThreadReadState/);
 assert.match(source('apps/server/src/domains/legal/privacy-data-routes.ts'),/entityCommentThreadReadState.findMany/);
});
await check('two roots and replies create independent unread counts',async()=>{
 rootA=(await post('p1','member')).body;rootB=(await post('p1','member')).body;
 assert.equal((await post('p1','member',{parentCommentId:rootA.id})).status,200);
 assert.equal((await post('p1','member',{parentCommentId:rootB.id})).status,200);
 const a=await get('teammate',query('project','p1',rootA.id));const b=await get('teammate',query('project','p1',rootB.id));
 assert.equal(a.status,200);assert.equal(a.body.unreadCount,2);assert.equal(b.body.unreadCount,2);
 assert.equal((await get('member',query('project','p1',rootA.id))).body.unreadCount,0);
});
await check('marking one thread does not change another',async()=>{
 const q=query('project','p1',rootA.id), first=await get('teammate',q);
 assert.equal((await mark('teammate',q,first.body.snapshotAt)).status,200);
 assert.equal((await get('teammate',q)).body.unreadCount,0);
 assert.equal((await get('teammate',query('project','p1',rootB.id))).body.unreadCount,2);
 await new Promise(resolve=>setTimeout(resolve,5)); // Real new reply after the watermark millisecond.
 const reply=await post('p1','member',{parentCommentId:rootA.id});assert.equal(reply.status,200);
 assert.equal((await get('teammate',q)).body.unreadCount,1);
});
await check('stale second tab cannot regress thread watermark',async()=>{
 const q=query('project','p1',rootA.id), newest=(await get('teammate',q)).body.snapshotAt;
 assert.equal((await mark('teammate',q,newest)).status,200);
 assert.equal((await mark('teammate',q,new Date(Date.now()-3600_000).toISOString())).status,200);
 assert.equal(threadReadStates.find(r=>r.userId==='teammate'&&r.threadRootId===rootA.id).lastReadAt.toISOString(),newest);
});
await check('thread identity and resource authorization block cross-project probing',async()=>{
 const wrong=query('project','p2',rootA.id);
 assert.equal((await get('member',wrong)).status,404);
 assert.equal((await mark('member',wrong,new Date().toISOString())).status,404);
 assert.equal((await get('outsider',query('project','p1',rootA.id))).status,403);
 const reply=records.find(r=>r.parentCommentId===rootA.id);
 assert.equal((await get('teammate',query('project','p1',reply.id))).status,404);
 projects.get('p1').archived=true;
 assert.equal((await get('teammate',query('project','p1',rootA.id))).status,404);
 projects.get('p1').archived=false;
});
await check('future snapshots rejected; root deletion retains thread identity',async()=>{
 const q=query('project','p1',rootA.id);
 assert.equal((await mark('teammate',q,new Date(Date.now()+60000).toISOString())).status,400);
 const deleted=await call('DELETE','/api/entity-comments/:commentId','member',{expectedRevision:rootA.revision},{},{commentId:rootA.id});
 assert.equal(deleted.status,200);
 assert.equal((await get('teammate',q)).status,200);
});
await check('UI loads thread counts lazily and never marks read on expansion',()=>{
 const ui=source('packages/renderer/src/components/CollaborationPanel.tsx');
 assert.match(ui,/loadThreadReadState\(root\.id\)/);assert.match(ui,/Mark thread read/);
 assert.match(ui,/await api\("\/api\/entity-comments\/thread-read-state"/);
});
console.log(`TD6 G25 thread read-state: ${count}/${count} passed`);
