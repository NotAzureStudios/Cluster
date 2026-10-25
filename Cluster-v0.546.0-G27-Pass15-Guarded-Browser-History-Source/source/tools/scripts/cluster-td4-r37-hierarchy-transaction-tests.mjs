import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { relocateLibraryStoredFile } = await import('../../apps/server/src/core/library-storage-relocation.ts');
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', {paths: [root, path.join(path.dirname(process.execPath), '../lib/node_modules'), '/usr/local/lib/node_modules']}));
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
const scope = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root, 'apps/server/src/domains/library/library-bulk-scope.ts'),'utf8')), {exports: scope});
const helper = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-bulk-transaction-guard.ts'),'utf8')), {
  exports: helper, require(spec) {
    if (spec === './library-bulk-scope.js') return scope;
    if (spec === './library-platform-9e2.js') return {libraryLockIsActive: lock => Boolean(lock.active)};
    throw new Error('Unexpected dependency: ' + spec);
  },
});
const routes = fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-routes.ts'),'utf8');
const renderer = fs.readFileSync(path.join(root,'packages/renderer/src/features/library/LibraryWorkspacePage.tsx'),'utf8');
let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); passed++; }
const item = (id, type='file', parentId=null) => ({id, type, parentId, status:'active', lifecycleState:'active', revision:1, deletedAt:null});
function fixture() {
  const rows = new Map([
    item('source'), item('folder','folder'), item('subfolder','folder','folder'), item('other','file','folder'), item('root-folder','folder'),
  ].map(row => [row.id,row]));
  const denied = new Set(), records = new Set(), locks = new Set();
  let account = {id:'alice', accountState:'ACTIVE', archived:false};
  const tx = {
    user: {findUnique: async () => account},
    libraryItem: {
      findMany: async ({where}) => {
        if (where.id?.in) return [...rows.values()].filter(row => where.id.in.includes(row.id));
        if (where.parentId?.in) return [...rows.values()].filter(row => where.parentId.in.includes(row.parentId));
        throw Error('unexpected query');
      },
      findUnique: async ({where}) => rows.get(where.id) || null,
    },
    personnelRecordAttachment: {findMany: async ({where}) => [...records].filter(id => where.libraryItemId.in.includes(id)).map(id => ({libraryItemId:id})).slice(0,1)},
    libraryAssetLock: {findMany: async ({where}) => [...locks].filter(id => where.itemId.in.includes(id)).map(id => ({itemId:id,active:true}))},
  };
  const access = {contextForUser: async actor => ({actor}), visibleFor: (_ctx,row) => !denied.has(row.id)};
  const request = (ids,action='move',parentId=null) => ({ tx, actorId:'alice', ids, action, parentId, expectedRevisions: Object.fromEntries(ids.map(id => [id,1])), itemInclude:{project:{}}, access, isManagedFolder: row => row.source === 'project-folder' });
  return {rows, denied, records, locks, tx, request, setAccount: value => {account=value;}};
}
async function fails(promise, code) {
  await assert.rejects(promise, err => { assert.equal(err.code,code); return true; });
}
await test('Accepts an authorized standalone file move', async () => { const f=fixture(); await helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')); });
await test('Accepts a bounded folder tree move', async () => { const f=fixture(); await helper.revalidateLibraryBulkTreeWrite(f.request(['root-folder'],'move','folder')); });
await test('Rejects a cycle through destination ancestry', async () => { const f=fixture(); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['folder'],'move','subfolder')), 'LIBRARY_BULK_CYCLE'); });
await test('Rejects destination without edit access', async () => { const f=fixture(); f.denied.add('folder'); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_DESTINATION_DENIED'); });
await test('Rejects unavailable destination ancestor', async () => { const f=fixture(); f.rows.get('folder').status='trashed'; await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','subfolder')), 'LIBRARY_BULK_DESTINATION_DENIED'); });
await test('Rejects stale selected revisions', async () => { const f=fixture(); f.rows.get('source').revision=2; await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_STALE_ACCESS'); });
await test('Rejects revoked source permissions', async () => { const f=fixture(); f.denied.add('source'); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_STALE_ACCESS'); });
await test('Rejects a newly restricted nested child', async () => { const f=fixture(); f.denied.add('other'); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['folder'],'archive')), 'LIBRARY_BULK_NESTED_ACCESS'); });
await test('Rejects protected Personnel Records even nested in normal folder', async () => { const f=fixture(); f.records.add('other'); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['folder'],'trash')), 'PERSONNEL_RECORD_POLICY_REQUIRED'); });
await test('Rejects nested active locks', async () => { const f=fixture(); f.locks.add('other'); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['folder'],'move','root-folder')), 'LIBRARY_BULK_LOCK_CONFLICT'); });
await test('Rejects managed folders selected or nested', async () => { const f=fixture(); f.rows.get('subfolder').source='project-folder'; await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['folder'],'move','root-folder')), 'LIBRARY_BULK_NESTED_ACCESS'); });
await test('Rejects inactive or expired initiating accounts', async () => { const f=fixture(); f.setAccount({id:'alice',accountState:'SUSPENDED'}); await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_ACTOR_INACTIVE'); });
await test('Rejects corrupted destination parent cycles', async () => { const f=fixture(); f.rows.get('folder').parentId='subfolder'; await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_TREE_INVALID'); });
await test('Rejects an active archived-source move', async () => { const f=fixture(); f.rows.get('source').status='trashed'; await fails(helper.revalidateLibraryBulkTreeWrite(f.request(['source'],'move','folder')), 'LIBRARY_BULK_LIFECYCLE_CONFLICT'); });
await test('Transactional guard is invoked before write loop and audit record commits inside the transaction', async () => {
  const start=routes.indexOf('app.post("/api/library/bulk",');
  const block=routes.slice(start,routes.indexOf('app.delete("/api/library/:itemId"',start));
  assert.ok(block.indexOf('await revalidateLibraryBulkTreeWrite(') > 0);
  assert.ok(block.indexOf('await revalidateLibraryBulkTreeWrite(') < block.indexOf('tx.libraryItem.updateMany('));
  assert.ok(block.indexOf('tx.activityEvent.create(') > block.indexOf('tx.libraryItem.updateMany('));
  assert.match(block,/LIBRARY_BULK_MOVE_RECONCILE_REQUIRED/);
  assert.match(block,/scheduleCommittedLibraryStorageRepair\(jobQueue, context\.user\.id, "bulk-move"\)/);
  assert.match(fs.readFileSync(path.join(root,'apps/server/src/domains/library/library-storage-scheduling.ts'),'utf8'),/committed: true, reconciled: false/);
});

// Exercise the actual reconciliation function with real temporary files. The
// original fileName must remain recoverable when the filesystem move fails.
const layoutSource = fs.readFileSync(path.join(root, 'apps/server/src/core/data-layout.ts'), 'utf8');
const start = layoutSource.indexOf('export async function reconcileLibraryStoredFiles(');
const end = layoutSource.indexOf('export async function libraryFolderRelativePath(', start);
assert.ok(start > 0 && end > start);
const layoutExports = {};
const safeRoot = (base, candidate) => candidate === base || candidate.startsWith(base + path.sep);
vm.runInNewContext(transpile(layoutSource.slice(start,end).replace('export async function', 'async function')) + '\nexports.reconcileLibraryStoredFiles = reconcileLibraryStoredFiles;', {
  exports:layoutExports, fs:fsPromises, path, pathInsideRoot:safeRoot,
  ensureClusterDataLayout:async ()=>{},
  libraryFolderRelativePath:async(_prisma,parentId)=>parentId||'',
  relocateLibraryStoredFile,
});
await test('Physical file move reconciles persisted fileName', async () => {
  const rootPath=await fsPromises.mkdtemp(path.join(os.tmpdir(),'cluster-r37-storage-'));
  try {
    await fsPromises.writeFile(path.join(rootPath,'stored.bin'),'content');
    const rows=[{id:'f1',parentId:'newfolder',fileName:'stored.bin'}];
    const prisma={libraryItem:{findMany:async()=>rows,findFirst:async()=>null,updateMany:async({data})=>{rows[0].fileName=data.fileName;return {count:1};}}};
    const result=await layoutExports.reconcileLibraryStoredFiles(prisma,{libraryRoot:rootPath});
    assert.equal(result.normalized,1);
    assert.equal(result.unresolved,0);
    assert.equal(await fsPromises.readFile(path.join(rootPath,'newfolder','stored.bin'),'utf8'),'content');
    assert.equal(rows[0].fileName,path.join('newfolder','stored.bin'));
  } finally {await fsPromises.rm(rootPath,{recursive:true,force:true});}
});
await test('Missing source is reported unresolved without corrupting its fileName', async () => {
  const rootPath=await fsPromises.mkdtemp(path.join(os.tmpdir(),'cluster-r37-missing-'));
  try {
    const rows=[{id:'f1',parentId:'newfolder',fileName:'missing.bin'}];
    const prisma={libraryItem:{findMany:async()=>rows,findFirst:async()=>null,updateMany:async()=>{throw new Error('must not update');}}};
    const result=await layoutExports.reconcileLibraryStoredFiles(prisma,{libraryRoot:rootPath});
    assert.equal(result.normalized,0);
    assert.equal(result.unresolved,1);
    assert.equal(rows[0].fileName,'missing.bin');
  } finally {await fsPromises.rm(rootPath,{recursive:true,force:true});}
});
await test('UI explicitly distinguishes committed move with unfinished reconciliation', async () => {
  assert.match(renderer,/result\.reconciled === false/);
  assert.match(renderer,/Do not retry the move/);
});
console.log(`${passed}/${passed} TD4 R37 hierarchy transaction guards passed`);
