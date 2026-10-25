import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateManagedDerivativePath } from '../../apps/server/src/domains/library/library-derivative-file-safety.ts';
import { requestWorkPolicy } from '../../apps/server/src/core/request-workload.ts';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { resolveAuthorizedModelCompanions, modelPreviewFingerprint, LibraryModelPreviewError } from '../../apps/server/src/domains/library/library-model-preview-security.ts';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const routes = readFileSync(resolve(sourceRoot, 'apps/server/src/domains/library/library-routes.ts'), 'utf8');
const workload = readFileSync(resolve(sourceRoot, 'apps/server/src/core/request-workload.ts'), 'utf8');
let passed = 0;
async function asyncTest(title, fn) {
  try { await fn(); passed++; console.log(`PASS G26 Library media: ${title}`); }
  catch (error) { console.error(`FAIL G26 Library media: ${title}`); throw error; }
}
function test(title, fn) {
  try { fn(); passed++; console.log(`PASS G26 Library media: ${title}`); }
  catch (error) { console.error(`FAIL G26 Library media: ${title}`); throw error; }
}
const records = [
  { id: 'texture', type: 'file', fileName: 'textures/a.png', status: 'active', lifecycleState: 'active', revision: 1, checksumSha256: 'ab'.repeat(32) },
  { id: 'hidden', type: 'file', fileName: 'private/secret.png', status: 'active', lifecycleState: 'active' },
  { id: 'trash', type: 'file', fileName: 'old.png', status: 'trashed', lifecycleState: 'trashed' },
  { id: 'archive', type: 'file', fileName: 'old.png', status: 'archived', lifecycleState: 'active' },
  { id: 'folder', type: 'folder', fileName: 'folder', status: 'active' },
  { id: 'no-file', type: 'file', fileName: null },
  { id: 'record', type: 'file', fileName: 'records/abc.bin' },
  { id: 'deleted', type: 'file', fileName: 'deleted.bin', deletedAt: new Date() },
];
const reference = (id, name = 'a.png') => [{ id, name }];
const visible = (item) => item.id !== 'hidden';
const recordGoverned = (id) => id === 'record';
function denied(ref, rows=records, canRead=visible, recordsCheck=recordGoverned) {
  assert.throws(() => resolveAuthorizedModelCompanions(ref, rows, canRead, recordsCheck),
    (error) => error instanceof LibraryModelPreviewError && error.code === 'MODEL_PREVIEW_DEPENDENCY_DENIED' && !/hidden|record|trash/.test(error.message));
}
test('authorized linked textures pass', () => assert.equal(resolveAuthorizedModelCompanions(reference('texture'), records, visible, recordGoverned)[0].record.id, 'texture'));
test('unlisted model dependencies are denied', () => denied(reference('missing')));
test('private dependency denies even if primary model is readable', () => denied(reference('hidden')));
test('read-only Records dependency cannot enter model converter', () => denied(reference('record')));
test('trashed dependency cannot enter preview', () => denied(reference('trash')));
test('archived dependency cannot enter preview', () => denied(reference('archive')));
test('deleted dependency cannot enter preview', () => denied(reference('deleted')));
test('folder is never an eligible companion', () => denied(reference('folder')));
test('dependency must own a file', () => denied(reference('no-file')));
test('more than 128 inputs are rejected', () => denied(Array.from({length:129},()=>({id:'texture',name:'a.png'}))));
test('mixed visible and hidden dependencies deny the entire render', () => denied([...reference('texture'),...reference('hidden')]));
test('all visible separate dependencies are supported', () => assert.equal(resolveAuthorizedModelCompanions([ ...reference('texture'), ...reference('record') ], records, ()=>true, ()=>false).length, 2));
const source = { id: 'model', revision:1, checksumSha256:'a'.repeat(64), fileName:'m.blend', size: 80, modifiedMs:1 };
const companion = { id:'texture', revision:1, checksumSha256:'b'.repeat(64), fileName:'a.png', size:16, modifiedMs:2, name:'a.png' };
const base = modelPreviewFingerprint(source,[companion],'m.blend',100);
test('cache fingerprint is SHA256 and deterministic', () => assert.match(base, /^[0-9a-f]{64}$/));
test('cache changes when a companion revision changes', () => assert.notEqual(base, modelPreviewFingerprint(source,[{...companion, revision:2}], 'm.blend',100)));
test('cache changes when a companion is removed', () => assert.notEqual(base, modelPreviewFingerprint(source,[], 'm.blend',100)));
test('cache changes when a companion is renamed', () => assert.notEqual(base, modelPreviewFingerprint(source,[{...companion,name:'b.png'}], 'm.blend',100)));
test('cache changes when file metadata is modified in place', () => assert.notEqual(base, modelPreviewFingerprint(source,[{...companion,modifiedMs:3}], 'm.blend',100)));
test('cache changes when source revision changes', () => assert.notEqual(base, modelPreviewFingerprint({...source,revision:2},[companion],'m.blend',100)));
test('cache changes when conversion limits change', () => assert.notEqual(base, modelPreviewFingerprint(source,[companion],'m.blend',200)));
test('cache changes when conversion source-relative path changes', () => assert.notEqual(base, modelPreviewFingerprint(source,[companion],'new.blend',100)));
test('thumbnail write requires contribute', () => assert.match(routes, /app\.put\("\/api\/library\/:itemId\/model-thumbnail"[\s\S]{0,400}?findAccessibleItem\(request, reply, params\.itemId, "contribute"\)/));
test('companion ACL uses request actor context', () => assert.match(routes, /visibleFor\(result\.context, companion, "view"\)/));
test('Personnel Records and copyright are checked separately', () => { assert.match(routes,/personnelRecordAttachment\.findMany/); assert.match(routes,/copyrightResourceRestriction\.findMany/); assert.match(routes,/copyrightDisabledIds\.has\(record\.id\)/); });
test('blob paths reject managed symlink traversal', () => assert.match(routes, /validateManagedDerivativePath\(dataLayout\.libraryFilesRoot, currentPath\)/));
test('derivative stream ETag includes companion identity', () => assert.match(routes, /reply\.header\("ETag", `"blend-\$\{cacheKey\}"`\)/));
test('thumbnail writes use shared fail-closed managed storage', () => { assert.match(routes, /saveManagedModelThumbnail\(modelThumbnailRoot/); assert.match(readFileSync(resolve(sourceRoot, 'apps/server/src/domains/library/library-managed-preview-io.ts'),'utf8'), /assertManagedThumbnailRoot/); });
test('companion copyright review is bounded to one query', () => assert.match(routes, /resourceId: \{ in: \[item\.id, \.\.\.companionIds\] \}/));
test('thumbnail request policy admits bounded 6 MiB upload as heavy work', () => {
  const policy = requestWorkPolicy({ pathname:'/api/library/abc/model-thumbnail', method:'PUT', globalBodyLimitBytes: 16*1024*1024, uploadLimitBytes: 16*1024*1024, avatarUploadLimitBytes: 2*1024*1024 });
  assert.equal(policy.workClass, 'heavy');
  assert.equal(policy.bodyLimitBytes, 8*1024*1024);
  assert.equal(policy.cost, 4);
});
test('other Library mutations retain normal upload budgets', () => {
  const policy = requestWorkPolicy({ pathname:'/api/library/abc', method:'PATCH', globalBodyLimitBytes: 16*1024*1024, uploadLimitBytes: 16*1024*1024, avatarUploadLimitBytes: 2*1024*1024 });
  assert.equal(policy.workClass, 'normal');
  assert.equal(policy.bodyLimitBytes, 2*1024*1024);
});
test('thumbnail work admission uses canonical Library route', () => { assert.match(workload, /\\\/api\\\/library\\\//); assert.doesNotMatch(workload, /\\\/api\\\/knowledge\\\/\[\^\/\]\+\\\/model-thumbnail/); });
test('cached GLB streams are validated inside the managed preview root', () => assert.match(routes, /validateManagedDerivativePath\(managedPreviewRoot, previewPath\)/));
const fixture = mkdtempSync(resolve(tmpdir(), 'cluster-model-security-'));
try {
  const safeRoot = resolve(fixture, 'root');
  mkdirSync(resolve(safeRoot,'models'), { recursive:true });
  const safeFile = resolve(safeRoot,'models','a.blend');
  writeFileSync(safeFile, 'blender');
  await asyncTest('local managed source path resolves normally', async () => assert.equal(await validateManagedDerivativePath(safeRoot,safeFile),safeFile));
  symlinkSync(resolve(fixture,'external'),resolve(safeRoot,'redirect'), 'dir');
  await asyncTest('symlinked directory is rejected', async () => assert.equal(await validateManagedDerivativePath(safeRoot,resolve(safeRoot,'redirect','secret.glb')),null));
  symlinkSync(safeFile, resolve(safeRoot,'alias.blend'));
  await asyncTest('symlinked file is rejected', async () => assert.equal(await validateManagedDerivativePath(safeRoot,resolve(safeRoot,'alias.blend')),null));
  const outsideFile = resolve(fixture, 'outside.blend');
  writeFileSync(outsideFile, 'secret');
  await asyncTest('relative traversal outside root is rejected', async () => assert.equal(await validateManagedDerivativePath(safeRoot,outsideFile),null));
  linkSync(safeFile,resolve(safeRoot,'hardlink.blend'));
  test('source resolver checks hardlink count', () => assert.match(routes,/stat\.nlink === 1/));
} finally { rmSync(fixture,{recursive:true,force:true}); }
console.log(`G26 Library media preview authority: ${passed}/${passed} passed`);
