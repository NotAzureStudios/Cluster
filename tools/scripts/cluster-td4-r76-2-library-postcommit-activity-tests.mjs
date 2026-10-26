/** TD4 corrective verification: Activity outages cannot turn committed Library writes into failed requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const schema = new Proxy(function () { return schema; }, { get(_target, prop) { return prop === 'parse' ? value => value : schema; } });
const z = new Proxy({}, { get() { return schema; } });
function actualRoute(file, method, endpoint) {
  const code = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let route;
  const walk = n => {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === `app.${method}` && n.arguments[0]?.text === endpoint) route = n.arguments[1];
    ts.forEachChild(n, walk);
  };
  walk(ast); assert.ok(route && ts.isArrowFunction(route), `${method} ${endpoint} found`);
  const output = ts.transpileModule(`module.exports = ${route.getText(ast)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(output.diagnostics?.length || 0, 0);
  return output.outputText;
}
const root = 'apps/server/src/domains/library/';
const uploadRoute = actualRoute(root + 'library-routes.ts', 'post', '/api/library/upload');
const restoreRoute = actualRoute(root + 'library-routes.ts', 'post', '/api/library/:itemId/versions/:versionId/restore');
const mountRoute = actualRoute(root + 'mounted-library-routes.ts', 'post', '/api/desktop-libraries/from-upload');
function handler(compiled, values) {
  const ctx = { module: { exports: {} }, z, metadataSchema: schema, Date, Promise, JSON, Buffer, Error, String, Number, path, ...values };
  vm.runInNewContext(compiled, ctx);
  return ctx.module.exports;
}
const reply = { code(status) { return { send(body) { return { status, ...body }; } }; } };
let passed = 0;
async function check(label, thunk) { await thunk(); passed++; console.log('PASS', label); }
for (const activityFails of [false, true]) {
  await check(`ordinary Library upload returns committed result (Activity ${activityFails ? 'unavailable' : 'healthy'})`, async () => {
    const state = { commits: 0, invalidations: 0, warnings: 0, removed: 0 };
    const item = { id: 'new-file', title: 'Demo', projectId: null, sizeBytes: 400000, mimeType: 'application/octet-stream' };
    const h = handler(uploadRoute, {
      getCurrentUser: async () => ({ id: 'user', isAdmin: true }), assertValidParent: async () => {},
      libraryFolderRelativePath: async () => '', dataLayout: { libraryFilesRoot: '/lib' },
      storeCompletedUpload: async () => ({ fullPath: '/lib/new', actualSize: 400000, detectedMime: 'application/octet-stream' }),
      readSettings: async () => ({ libraryMaxUploadMb: 20 }),
      sha256File: async () => 'a'.repeat(64), fs: { readFile: async () => Buffer.alloc(0), rm: async () => { state.removed++; } },
      libraryFileExtension: () => 'bin', makeLibraryPreviewText: () => null, libraryDisplayTitle: n => n,
      normalizeLibraryClassification: s => s, normalizeLibraryMetadata: value => value, unique: s => s,
      prisma: { libraryItem: { create: async () => { state.commits++; return item; } } },
      consumeUploadSession: async () => {}, logActivity: async () => { if (activityFails) throw Error('Activity unavailable'); },
      clearLibraryContextCache: () => { state.invalidations++; }, serializeLibraryItem: x => x, itemInclude: {},
    });
    const result = await h({ body: { uploadId: 'x', originalName: 'file.bin', mimeType: 'application/octet-stream', tags: [], metadata: {} }, log: { warn: () => { state.warnings++; } } }, reply);
    assert.equal(result.id, 'new-file'); assert.equal(state.commits, 1); assert.equal(state.invalidations, 1);
    assert.equal(state.warnings, activityFails ? 1 : 0); assert.equal(state.removed, 0);
  });
}
for (const activityFails of [false, true]) {
  await check(`historical Library version restore reports committed revision (Activity ${activityFails ? 'unavailable' : 'healthy'})`, async () => {
    const state = { commits: 0, invalidations: 0, warnings: 0 };
    const target = { id: 'version-1', itemId: 'file-1', fileName: 'historic.bin', versionNumber: 1, checksumSha256: 'b'.repeat(64) };
    const h = handler(restoreRoute, {
      getCurrentUser: async () => ({ id: 'user-1' }),
      findAccessibleItem: async () => ({ item: { id: 'file-1', revision: 5, type: 'file' } }),
      prisma: {
        libraryVersion: { findFirst: async () => target },
        $transaction: async (fn, opts) => {
          assert.equal(opts.isolationLevel, 'Serializable');
          const result = await fn({ libraryItem: {
            findUnique: async () => ({ id: 'file-1', revision: 5, title: 'File', projectId: null }),
            updateMany: async () => ({ count: 1 }),
            findUniqueOrThrow: async () => ({ id: 'file-1', title: 'File', projectId: null, revision: 6 }),
          } });
          state.commits++; return result;
        },
      },
      dataLayout: { libraryFilesRoot: '/lib' }, pathInsideRoot: () => true,
      fs: { access: async () => {} }, createLibraryVersionSnapshot: async () => ({ versionNumber: 5 }),
      createHttpError: (_code, message) => Error(message),
      logActivity: async () => { if (activityFails) throw Error('Activity unavailable'); },
      clearLibraryContextCache: () => { state.invalidations++; }, serializeLibraryItem: x => x, itemInclude: {},
    });
    const result = await h({ params: { itemId: 'file-1', versionId: 'version-1' }, body: { expectedRevision: 5 }, log: { warn: () => { state.warnings++; } } }, reply);
    assert.equal(result.ok, true); assert.equal(result.versionNumber, 6); assert.equal(state.commits, 1);
    assert.equal(state.invalidations, 1); assert.equal(state.warnings, activityFails ? 1 : 0);
  });
}
for (const replacement of [false, true]) {
  for (const activityFails of [false, true]) {
    await check(`mounted Library ${replacement ? 'version update' : 'file creation'} reports committed result (Activity ${activityFails ? 'unavailable' : 'healthy'})`, async () => {
      const state = { commits: 0, invalidations: 0, warnings: 0, removed: 0, consumed: 0 };
      const existing = { id: 'file-1', revision: 5, parentId: null, type: 'file', projectId: null };
      const resultItem = { id: replacement ? 'file-1' : 'file-new', revision: replacement ? 6 : 1, title: 'Mounted', projectId: null, sizeBytes: 400000 };
      const h = handler(mountRoute, {
        requireLibraryTool: async () => ({ user: { id: 'user', isAdmin: true } }), readSettings: async () => ({}),
        resolveCompletedUpload: async () => ({ metadata: { totalBytes: 400000, checksumSha256: 'a'.repeat(64) } }),
        findAccessibleItem: async () => ({ item: existing }), rejectMountedWriteWhenLocked: async () => false,
        libraryFolderRelativePath: async () => '', dataLayout: { libraryFilesRoot: '/lib' }, storageRuntime: {},
        fs: { mkdir: async () => {}, rm: async () => { state.removed++; } },
        copyCompletedUploadToFile: async () => {}, safeFileName: name => name, libraryFileExtension: () => 'bin', sha256File: async () => 'a'.repeat(64),
        createLibraryVersionSnapshot: async () => ({ versionNumber: 5 }),
        prisma: {
          libraryItem: { create: async () => { state.commits++; return resultItem; } },
          $transaction: async fn => {
            const output = await fn({ libraryItem: { findUnique: async () => existing, update: async () => resultItem } });
            state.commits++; return output;
          },
        },
        libraryDisplayTitle: name => name, createHttpError: (_code, message) => Error(message),
        consumeCompletedUpload: async () => { state.consumed++; },
        logActivity: async () => { if (activityFails) throw Error('Activity unavailable'); },
        clearLibraryContextCache: () => { state.invalidations++; }, serializeLibraryItem: x => x, itemInclude: {},
      });
      const result = await h({ body: { uploadId: 'x', itemId: replacement ? 'file-1' : null, originalName: 'mounted.bin', mimeType: 'application/octet-stream' }, log: { warn: () => { state.warnings++; } } }, reply);
      assert.equal(result.ok, true); assert.equal(result.item.id, resultItem.id); assert.equal(state.commits, 1);
      assert.equal(state.invalidations, 1); assert.equal(state.consumed, 1); assert.equal(state.removed, 0);
      assert.equal(state.warnings, activityFails ? 1 : 0);
    });
  }
}
console.log(`TD4 Library post-commit Activity boundaries: ${passed}/${passed} passed`);
