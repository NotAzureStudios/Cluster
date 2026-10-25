/** TD4 closure regression: a committed Library version must retain its bytes even if Activity fails. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/domains/library/library-routes.ts';
const sourceText = fs.readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
let route = null;
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.post' && node.arguments[0]?.text === '/api/library/:itemId/versions') route = node.arguments[1];
  ts.forEachChild(node, walk);
}
walk(source);
assert.ok(route && ts.isArrowFunction(route), 'actual Library version route must be found');
const compiled = ts.transpileModule(`module.exports = ${route.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(compiled.diagnostics?.length || 0, 0);
const schema = new Proxy(function () { return schema; }, { get(_target, prop) { return prop === 'parse' ? input => input : schema; } });
const z = new Proxy({}, { get() { return schema; } });
let checks = 0;
async function run(label, { dbFails = false, activityFails = false } = {}) {
  const removed = []; const warnings = []; const activities = []; let committed = false; let saved = false;
  const tx = {
    libraryItem: {
      findUnique: async () => ({ id: 'file-1', revision: 5, projectId: null }),
      update: async () => ({ id: 'file-1', title: 'New version', projectId: null, revision: 6 }),
    },
  };
  const ctx = {
    module: { exports: {} }, Date, Promise, JSON, Buffer, Error, path,
    z, getCurrentUser: async () => ({ id: 'user-1', isAdmin: true }),
    findAccessibleItem: async () => ({ item: { id: 'file-1', revision: 5, parentId: null, type: 'file' } }),
    libraryFolderRelativePath: async () => '',
    dataLayout: { libraryFilesRoot: '/library' },
    storeCompletedUpload: async () => ({ fullPath: '/library/candidate', actualSize: 400_000, detectedMime: 'application/octet-stream' }),
    sha256File: async () => 'a'.repeat(64),
    fs: { rm: async candidate => { removed.push(candidate); }, readFile: async () => Buffer.from('') },
    libraryFileExtension: () => 'bin', makeLibraryPreviewText: () => '',
    prisma: { $transaction: async fn => {
      if (dbFails) throw new Error('transaction rolled back');
      const result = await fn(tx); committed = true; return result;
    } },
    createLibraryVersionSnapshot: async () => ({ versionNumber: 1 }),
    consumeUploadSession: async () => { saved = true; },
    logActivity: async payload => { activities.push(payload); if (activityFails) throw new Error('activity queue unavailable'); },
    clearLibraryContextCache: () => {}, serializeLibraryItem: item => item, itemInclude: {},
    createHttpError: (_code, reason) => new Error(reason),
  };
  vm.runInNewContext(compiled.outputText, ctx, { filename: file });
  const handler = ctx.module.exports;
  const request = { params: { itemId: 'file-1' }, body: { uploadId: '00000000-0000-0000-0000-000000000001', originalName: 'new.bin' }, log: { warn: payload => warnings.push(payload) } };
  const reply = { code(status) { return { send(body) { return { status, ...body }; } }; } };
  if (dbFails) {
    await assert.rejects(handler(request, reply), /transaction rolled back/);
    assert.equal(committed, false);
    assert.deepEqual(removed, ['/library/candidate'], 'only uncommitted private staging bytes may be cleaned up');
    assert.equal(saved, false);
  } else {
    const result = await handler(request, reply);
    assert.equal(result.ok, true, 'committed version returns success regardless of Activity failure');
    assert.equal(result.versionNumber, 2);
    assert.equal(committed, true);
    assert.deepEqual(removed, [], 'cannot unlink bytes referenced by a committed version');
    assert.equal(saved, true);
    assert.equal(warnings.length, activityFails ? 1 : 0);
    assert.equal(activities.length, 1);
  }
  console.log('PASS', label); checks++;
}
await run('normal version upload commits and preserves bytes');
await run('Activity failure after commit returns success and retains bytes', { activityFails: true });
await run('transaction rollback cleans only the private uncommitted candidate', { dbFails: true });
console.log(`TD4 Library committed-file safety: ${checks}/${checks} checks passed`);
