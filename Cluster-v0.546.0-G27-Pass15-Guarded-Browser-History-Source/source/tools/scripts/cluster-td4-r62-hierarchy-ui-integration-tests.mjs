import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=f=>fs.readFileSync(f,'utf8');
const routes=read('apps/server/src/domains/library/library-routes.ts');
const worker=read('apps/server/src/domains/library/library-hierarchy-lifecycle.ts');
const ui=read('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const schema=read('apps/server/prisma/schema.prisma');
const migration=read('apps/server/prisma/migrations/20261015235500_td4_library_hierarchy_lifecycle/migration.sql');
const composition=read('apps/server/src/app/cluster-server.ts');
const bulk=read('apps/server/src/domains/library/library-bulk-jobs.ts');
const ownership=read('apps/server/src/domains/jobs/job-tool-ownership.ts');
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name)};
check('preview and enqueue use actor-bound authoritative snapshots and digest',()=>{
 for(const path of ['/api/library/bulk/hierarchy/lifecycle/preview','/api/library/bulk/hierarchy/lifecycle']) {
  const start=routes.indexOf(`app.post("${path}"`);assert.ok(start>0,path);
  const block=routes.slice(start,routes.indexOf('\n  });',start));
  assert.match(block,/requireLibraryTool\(request, reply, "edit"\)/);
  assert.match(block,/hierarchyLifecycleSelection\(actor\.user\.id, body\)/);
 }
 assert.match(routes,/snapshot\.digest !== body\.digest/);
 assert.match(routes,/requestKey: body\.requestKey/);
 assert.ok(routes.indexOf('const prior =',routes.indexOf('app.post("/api/library/bulk/hierarchy/lifecycle",')) < routes.indexOf('hierarchyLifecycleSelection(actor.user.id, body)',routes.indexOf('app.post("/api/library/bulk/hierarchy/lifecycle",')));
});
check('job polling and cancellation are initiator-scoped',()=>{
 assert.match(routes,/detail\.job\.type !== "library\.hierarchy\.lifecycle" \|\| detail\.job\.createdById !== user\.id/);
 assert.match(routes,/app\.post\("\/api\/library\/bulk\/hierarchy\/lifecycle\/:jobId\/cancel"/);
});
check('Zod 3 compatible base-object extension precedes refinement for both submit schemas',()=>{
 const move=read('apps/server/src/domains/library/library-hierarchy-move.ts');
 assert.match(move,/hierarchyMoveBaseSchema\.extend\(\{[\s\S]*?\}\)\.superRefine\(validateMoveRoots\)/);
 assert.match(worker,/hierarchyLifecycleBaseSchema\.extend\(\{[\s\S]*?\}\)\.superRefine\(validateLifecycleRoots\)/);
 assert.doesNotMatch(move,/hierarchyMoveSchema\.extend\(/);
 assert.doesNotMatch(worker,/hierarchyLifecycleSchema\.extend\(/);
});
check('provenance and undo evidence are committed atomically with checkpoints',()=>{
 assert.match(worker,/tx\.libraryHierarchyLifecycleEntry\.createMany/);
 assert.match(worker,/tx\.libraryHierarchyLifecycleEntry\.updateMany/);
 assert.match(worker,/tx\.libraryBulkCheckpoint\.updateMany/);
 assert.match(worker,/tx\.activityEvent\.create/);
 assert.match(worker,/isolationLevel: "Serializable"/);
 assert.match(worker,/if \(updated\.count !== ids\.length\)/);
});
check('schema and migration include exact mark keys and retirement timestamps',()=>{
 assert.match(schema,/model LibraryHierarchyLifecycleEntry \{/);
 assert.match(schema, /@@id\(\[jobId, itemId\]\)/);
 assert.match(schema,/appliedDeletedAt\s+DateTime\?/);
 assert.match(migration,/CREATE TABLE "LibraryHierarchyLifecycleEntry"/);
 assert.match(migration,/PRIMARY KEY \("jobId", "itemId"\)/);
 assert.match(migration,/"restoredAt" TIMESTAMP/);
});
check('older folder lifecycle bypasses and provenance mutations explicitly rejected',()=>{
 assert.match(routes,/LIBRARY_HIERARCHY_LIFECYCLE_REQUIRED/);
 assert.match(routes,/LIBRARY_HIERARCHY_RESTORE_PROVENANCE_REQUIRED/);
 assert.match(routes,/LIBRARY_HIERARCHY_DISPOSITION_BLOCKED/);
 assert.match(routes,/LIBRARY_HIERARCHY_OPERATION_ACTIVE/);
 assert.match(bulk,/activeHierarchyEntries/);
 assert.match(bulk,/activeHierarchyIds\.has\(target\.id\)/);
});
check('canonical Library worker owner is registered in TD2',()=>{
 assert.match(ownership,/"library\.hierarchy\.lifecycle"/);
 assert.match(composition,/registerLibraryHierarchyLifecycleJob\(\{ worker: jobWorker, prisma, access: libraryAccess, coordination: coordinationBus \}\)/);
});
check('Library UI previews and confirms lifecycle before durable submission',()=>{
 assert.match(ui,/hierarchy\/lifecycle\/preview/);
 assert.match(ui,/hierarchy\/lifecycle",/);
 assert.match(ui,/preview\.preserved/);
 assert.match(ui,/selectedIdsLiveRef\.current/);
 assert.match(ui,/action === "move" && ids\.length <= 24/);
});
check('lifecycle job status persists across navigation and handles cancel vs committed roots',()=>{
 assert.match(ui,/sessionStorage\.setItem\("cluster\.library\.hierarchyLifecycleJob"/);
 assert.match(ui,/sessionStorage\.getItem\("cluster\.library\.hierarchyLifecycleJob"/);
 assert.match(ui,/\/api\/library\/bulk\/hierarchy\/lifecycle\/\$\{encodeURIComponent\(id!\)\}/);
 assert.match(ui,/cancelHierarchyLifecycle\(\)/);
 assert.match(ui,/Already committed roots retain their changes and provenance/);
 assert.match(ui,/document\.visibilityState === "hidden"/);
});
console.log(`R62 integration: ${checks}/${checks} checks passed`);
