import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', { paths: [root, join(dirname(process.execPath), '../lib/node_modules'), '/usr/local/lib/node_modules'] }));
const src = rel => readFileSync(join(root, rel), 'utf8');
const helper = {};
vm.runInNewContext(ts.transpileModule(src('apps/server/src/domains/library/library-storage-scheduling.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, {exports:helper});
const enqueue = helper.scheduleCommittedLibraryStorageRepair;
assert.equal(typeof enqueue, 'function');
let passed=0;
async function test(name, fn) { await fn(); console.log(`PASS ${name}`); passed++; }
function queue(response={id:'repair-1',status:'QUEUED'}) {
 const calls=[];
 return { calls, enqueue:async input=>{calls.push(input); return response;} };
}
await test('Committed item move schedules worker with precise owner and schema',async()=>{
 const q=queue(); const result=await enqueue(q,'alice','item-move');
 assert.equal(result.committed,true);assert.equal(result.reconciled,false);assert.equal(result.reconciliationQueued,true);
 assert.equal(result.reconciliationJobId,'repair-1');assert.equal(result.reconciliationJobStatus,'QUEUED');
 assert.equal(q.calls.length,1);assert.equal(q.calls[0].createdById,'alice');
 assert.equal(q.calls[0].type,'library.storage.reconcile');assert.equal(q.calls[0].payload.scope,'library');
 assert.equal(q.calls[0].payload.reason,'item-move');assert.equal(q.calls[0].dedupeKey,undefined);
});
await test('A running existing job status is preserved (not fabricated as queued)',async()=>{
 const result=await enqueue(queue({id:'existing',status:'RUNNING'}),'alice','mounted-folder-rename');
 assert.equal(result.reconciliationJobId,'existing');assert.equal(result.reconciliationJobStatus,'RUNNING');
});
await test('Two committed mutations never reuse a blind active-job deduplication key',async()=>{
 const q=queue();await enqueue(q,'alice','folder-rename');await enqueue(q,'alice','bulk-move');
 assert.equal(q.calls.length,2);assert.equal(q.calls[0].dedupeKey,undefined);assert.equal(q.calls[1].dedupeKey,undefined);
});
await test('Different actors retain separate job ownership for private status reads',async()=>{
 const q=queue();await enqueue(q,'alice','bulk-move');await enqueue(q,'bob','bulk-move');
 assert.equal(q.calls.length,2);assert.notEqual(q.calls[0].createdById,q.calls[1].createdById);
});
await test('Failed enqueue reports committed but requiring administrator repair, not a failed edit',async()=>{
 const result=await enqueue({enqueue:async()=>{throw new Error('PostgreSQL temporarily unavailable');}},'alice','folder-rename');
 assert.equal(result.committed,true);assert.equal(result.reconciled,false);assert.equal(result.reconciliationQueued,false);
 assert.equal(result.reconciliationJobId,undefined);assert.match(result.warning,/saved.*could not be queued/i);
});
const routes=src('apps/server/src/domains/library/library-routes.ts');
const mounted=src('apps/server/src/domains/library/mounted-library-routes.ts');
const ui=src('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
await test('Normal Library item PATCH queues only true hierarchy/path changes after committed update',async()=>{
 const block=routes.slice(routes.indexOf('app.patch("/api/library/:itemId"'),routes.indexOf('app.get("/api/library/',routes.indexOf('app.patch("/api/library/:itemId"')));
 assert.match(block,/const storageChange = .*body\.parentId/s);
 assert.match(block,/body\.title !== existing\.title/);
 assert.ok(block.indexOf('await prisma.libraryItem.updateMany(')<block.indexOf('scheduleCommittedLibraryStorageRepair('));
 assert.doesNotMatch(block,/await reconcileLibraryStoredFiles\(/);
 assert.match(block,/reply\.code\(202\)/);
 assert.match(block,/\.\.\.serializeLibraryItem\(item, true\), \.\.\.repair/);
});
await test('Mounted rename queues only folders whose actual title changes',async()=>{
 const block=mounted.slice(mounted.indexOf('app.patch("/api/desktop-libraries/:itemId/rename"'),mounted.indexOf('app.post("/api/desktop-libraries/from-upload"'));
 assert.match(block,/existing\.type === "folder" && existing\.title !== safeName/);
 assert.ok(block.indexOf('await prisma.libraryItem.updateMany(')<block.indexOf('scheduleCommittedLibraryStorageRepair('));
 assert.doesNotMatch(block,/await reconcileLibraryStoredFiles\(/);
 assert.match(block,/reply\.code\(202\)/);
 assert.match(block,/item: serializeLibraryItem\(item, true\)/); // native mount compatibility
});
await test('Bulk move and admin repair now share one scheduling owner',async()=>{
 assert.match(routes,/scheduleCommittedLibraryStorageRepair\(jobQueue, context\.user\.id, "bulk-move"\)/);
 assert.match(routes,/scheduleCommittedLibraryStorageRepair\(jobQueue, authenticated\.user\.id, "admin-repair"\)/);
 assert.match(routes,/LIBRARY_RECONCILIATION_QUEUE_UNAVAILABLE/);
});
await test('One route injects one job authority into mounted Library',async()=>{
 const block=routes.slice(routes.indexOf('registerMountedLibraryRoutes({'),routes.indexOf('});',routes.indexOf('registerMountedLibraryRoutes({')));
 assert.match(block,/jobQueue/);
 assert.match(mounted,/sha256File, jobQueue/);
});
await test('Library inspector preserves partial outcome, stores repair job and shows progress',async()=>{
 assert.match(ui,/repair\.reconciled === false/);
 assert.match(ui,/cluster\.library\.storageRepairJob/);
 assert.match(ui,/setStorageRepair\(\{ id: repair\.reconciliationJobId/);
 assert.match(ui,/repair\.warning/);
 assert.match(ui,/setMessage\(result\.queued/);
});
await test('No remaining synchronous repair call in request-side Library edits',async()=>{
 assert.doesNotMatch(routes,/await reconcileLibraryStoredFiles\(/);
 assert.doesNotMatch(mounted,/await reconcileLibraryStoredFiles\(/);
 assert.match(src('apps/server/src/domains/library/library-storage-jobs.ts'),/await reconcileLibraryStoredFiles/);
});
console.log(`${passed}/${passed} TD4 R39 queue integration checks passed`);
