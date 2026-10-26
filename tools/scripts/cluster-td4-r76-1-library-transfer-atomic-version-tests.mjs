/** TD4 closure regression: resumable transfer version publication is atomic. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/domains/library/library-9e2-jobs.ts';
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, reportDiagnostics: true });
assert.equal(code.diagnostics?.length || 0, 0);
const schema = new Proxy(function () { return schema; }, { get(_target, prop) { return prop === 'parse' ? input => input : schema; } });
const z = new Proxy({}, { get() { return schema; } });
const mocks = {
  'node:crypto': { createHash: () => { throw Error('hashFile should not execute'); } },
  'node:fs': { createReadStream: () => { throw Error('read stream should not execute'); } },
  'node:fs/promises': { mkdir: async () => {}, rm: async () => {} },
  'node:path': path,
  'node:child_process': { spawn: () => { throw Error('spawn should not execute'); } },
  'zod': { z },
  '../../core/data-layout.js': { libraryFolderRelativePath: async () => '' },
  '../../core/library.js': { libraryDisplayTitle: name => name, libraryFileExtension: () => 'bin', makeLibraryPreviewText: () => '' },
  '../../core/media-processing.js': { inspectMediaTools: async () => null },
  '../../core/managed-subprocess.js': { runManagedSubprocess: async () => ({stdout:'',stderr:''}) },
  '../../core/library-pdf-snapshot.js': { readLibraryPdfSnapshot: async () => new Uint8Array(0) },
  '../../core/uploads.js': { safeFileName: name => name },
  '../jobs/job-types.js': { BackgroundJobDeferredError: class extends Error {} },
  './library-governance.js': { createLibraryVersionSnapshot: async (tx, item) => tx.libraryVersion.create({ itemId: item.id }) },
  './library-platform-9e2.js': {
    sanitizeLibraryRelativePath: name => ({ directories: [], fileName: name }),
    LIBRARY_TRANSFER_CONFLICT_POLICIES: ['rename', 'version', 'reject', 'reuse-identical'],
    derivativeCachePath: () => '', libraryDerivativeIdentity: () => '', libraryDerivativePlan: () => [],
  },
};
const module = { exports: {} };
vm.runInNewContext(code.outputText, {
  module, exports: module.exports, require: id => { if (!(id in mocks)) throw Error(`Unexpected import: ${id}`); return mocks[id]; },
  Buffer, JSON, Date, String, Number, Array, Math, Map, Set, Error, Promise, process, setTimeout, clearTimeout, console,
}, { filename: file });
const { registerLibrary9E2JobHandlers } = module.exports;
let checks = 0;
async function check(label, { stale = false, updateFailure = false } = {}) {
  let snapshots = 0, itemRevision = stale ? 6 : 5, committed = false;
  const existing = { id: 'file-1', revision: 5, type: 'file', status: 'active', lifecycleState: 'active', originalName: 'asset.bin', metadata: '{}', ownerId: 'user-1' };
  const tx = () => {
    let pendingSnapshots = 0, pendingRevision = itemRevision;
    return {
      libraryVersion: { create: async () => { pendingSnapshots++; return { id: 'snapshot-1' }; } },
      libraryItem: {
        findUnique: async () => ({ ...existing, revision: pendingRevision }),
        updateMany: async () => { if (updateFailure) throw Error('simulated database update failure'); pendingRevision++; return { count: 1 }; },
        findUniqueOrThrow: async () => ({ ...existing, revision: pendingRevision }),
      },
      commit: () => { snapshots += pendingSnapshots; itemRevision = pendingRevision; committed = true; },
    };
  };
  const prisma = {
    uploadSession: { findUnique: async () => ({ ownerId: 'user-1', status: 'COMPLETED', checksumSha256: 'a'.repeat(64) }) },
    libraryItem: { findFirst: async () => existing, update: async () => { throw Error('nontransactional version update must not run'); } },
    libraryVersion: { create: async () => { snapshots++; } },
    $transaction: async (fn, options) => {
      assert.equal(options?.isolationLevel, 'Serializable');
      const work = tx();
      const result = await fn(work);
      work.commit();
      return result;
    },
  };
  const handlers = {};
  registerLibrary9E2JobHandlers({
    worker: { register: (kind, callback) => { handlers[kind] = callback; } },
    prisma,
    dataLayout: { libraryFilesRoot: '/library', runtimeRoot: '/runtime' },
    storeCompletedUpload: async () => ({ fullPath: '/library/new.bin', checksumSha256: 'a'.repeat(64), actualSize: 400_000, detectedMime: 'application/octet-stream', storedName: 'new.bin' }),
    consumeUploadSession: async () => {},
    logActivity: async () => {},
  });
  const context = {
    job: { id: 'job-1' },
    payload: { uploadId: '00000000-0000-0000-0000-000000000001', actorId: 'user-1', originalName: 'asset.bin', mimeType: 'application/octet-stream', conflictPolicy: 'version', classification: 'internal', tags: [] },
    updateProgress: async () => {}, throwIfCancelled: async () => {}, throwIfToolUnavailable: async () => {},
    enqueue: async () => ({ id: 'derivative-1' }),
  };
  if (stale || updateFailure) {
    await assert.rejects(handlers['library.transfer.finalize'](context), /Library version changed|simulated database update failure/);
    assert.equal(snapshots, 0, 'a failed publication cannot leave a historical snapshot');
    assert.equal(committed, false);
  } else {
    const result = await handlers['library.transfer.finalize'](context);
    assert.equal(result.receipt.itemId, 'file-1');
    assert.equal(committed, true);
    assert.equal(snapshots, 1, 'a successful publication snapshots exactly once');
    assert.equal(itemRevision, 6);
  }
  console.log('PASS', label); checks++;
}
await check('successful resumable transfer snapshots and updates in one transaction');
await check('stale transfer cannot replace a concurrently edited version', { stale: true });
await check('failed transactional update rolls back its version snapshot', { updateFailure: true });
console.log(`TD4 transfer atomic version: ${checks}/${checks} checks passed`);
