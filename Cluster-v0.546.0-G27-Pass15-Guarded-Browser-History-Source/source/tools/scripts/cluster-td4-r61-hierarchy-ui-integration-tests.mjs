/** R61 integration contract checks for the real route, renderer and tool registry.
 * These assertions complement the executable handler fixture, not replace it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server = fs.readFileSync('apps/server/src/domains/library/library-routes.ts','utf8');
const ui = fs.readFileSync('packages/renderer/src/features/library/LibraryWorkspacePage.tsx','utf8');
const runtime = fs.readFileSync('apps/server/src/app/cluster-server.ts','utf8');
const worker = fs.readFileSync('apps/server/src/domains/library/library-hierarchy-move.ts','utf8');
const ownership = fs.readFileSync('apps/server/src/domains/jobs/job-tool-ownership.ts','utf8');
let checks=0;
function check(label,fn){fn();checks++;console.log('PASS',label)}
check('preview and queue both use authoritative hierarchy selection and tool edit gate',()=>{
 for(const path of ['/api/library/bulk/hierarchy/move/preview','/api/library/bulk/hierarchy/move']) {
  const start=server.indexOf(`app.post("${path}"`);assert.ok(start>0,path);
  const end=server.indexOf('\n  });',start);const block=server.slice(start,end);
  assert.match(block,/requireLibraryTool\(request, reply, "edit"\)/);
  assert.match(block,/hierarchyMoveSelection\(actor\.user\.id, body\)/);
 }
});
check('preview digest never becomes durable authorization',()=>{
 assert.match(server,/selection\.digest !== body\.digest/);
 assert.match(worker,/inspectLibraryHierarchyMove\(\{/);
 assert.match(worker,/revalidateLibraryBulkTreeWrite\(\{/);
 assert.match(worker,/strict: true/);
});
check('retry is resolved before resnapshot and queue is actor-bound',()=>{
 const path=server.slice(server.indexOf('app.post("/api/library/bulk/hierarchy/move",'),server.indexOf('async function ownHierarchyMove('));
 assert.ok(path.indexOf('const prior =')<path.indexOf('hierarchyMoveSelection(actor.user.id, body)'));
 assert.match(path,/dedupeKey/);assert.match(path,/createdById: actor\.user\.id/);
 assert.match(path,/actorUserId: actor\.user\.id/);
});
check('job polling and cancellation are owner-scoped',()=>{
 assert.match(server,/detail\.job\.type !== "library\.hierarchy\.move" \|\| detail\.job\.createdById !== user\.id/);
 assert.match(server,/jobQueue\.cancel\(jobId\)/);
 assert.match(server,/serializeBackgroundJob\(detail\.job\)/);
});
check('hierarchy worker is classified as Library-owned and registered at composition',()=>{
 assert.match(ownership,/"library\.hierarchy\.move"/);
 assert.match(runtime,/registerLibraryHierarchyMoveJob\(\{ worker: jobWorker, prisma, access: libraryAccess, coordination: coordinationBus \}\)/);
 assert.match(worker,/tx\.backgroundJob\.create/);
 assert.match(worker,/tx\.libraryBulkCheckpoint\.updateMany/);
 assert.match(worker,/tx\.activityEvent\.create/);
});
check('UI uses reviewed durable path for folder hierarchy and preserves flat moves',()=>{
 const start=ui.indexOf('async function runBulk(');const end=ui.indexOf('function editBulkRenameRule(',start);
 const block=ui.slice(start,end);
 assert.match(block,/action === "move" && ids\.length <= 24/);
 assert.match(block,/item\.type === "folder"/);
 assert.match(block,/hierarchy\/move\/preview/);
 assert.match(block,/confirmCluster/);
 assert.match(block,/hierarchy\/move",/);
 assert.match(block,/"\/api\/library\/bulk",/);
});
check('visible job progress and cancelled partial outcome are not falsely rolled back',()=>{
 assert.match(ui,/sessionStorage\.setItem\("cluster\.library\.hierarchyMoveJob"/);
 assert.match(ui,/sessionStorage\.getItem\("cluster\.library\.hierarchyMoveJob"/);
 assert.match(ui,/previously committed roots stay moved/i);
 assert.match(ui,/storage-repair jobs for those roots remain queued/i);
 assert.match(ui,/document\.visibilityState === "hidden"/);
 assert.match(ui,/selectedIdsLiveRef\.current/);
});
console.log(`R61 route/UI integration: ${checks}/${checks} checks passed`);
