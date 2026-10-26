/** TD5 P2: executable isolated local filesystem checks; not Windows/SMB/NAS certification. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(`${require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript/lib/typescript.js`); }
})();
const modulePath = path.resolve(import.meta.dirname, '../../apps/server/src/core/storage/local-storage-provider.ts');
const actualSource = readFileSync(modulePath, 'utf8');
const compiled = ts.transpileModule(actualSource, {
  fileName: modulePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function providerClass(fsPromises = require('node:fs/promises')) {
  const mod = { exports: {} };
  vm.runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require(id) {
      if (id === 'node:fs/promises') return fsPromises;
      if (id === '../operation-cancellation.js') return { throwIfAborted(signal) { if (signal?.aborted) throw signal.reason || new Error('aborted'); } };
      if (id.startsWith('node:')) return require(id);
      throw Error(`Unexpected import ${id}`);
    },
    process, Buffer, console, Promise, Error, AbortController,
  }, { filename: modulePath });
  return mod.exports.LocalStorageProvider;
}
const LocalStorageProvider = providerClass();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'cluster-td5-p2-'));
  const { rm } = await import('node:fs/promises');
  return { root: path.join(home, 'blobs'), project: path.join(home, 'project'), cleanup: () => rm(home, { recursive: true, force: true }) };
}

test('materialized Project file uses independent bytes/inode, even on same filesystem', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    const expected = 'canonical source must survive edits';
    const blob = path.join(f.root, 'source', 'one.bin');
    await mkdir(path.dirname(blob), { recursive: true });
    await writeFile(blob, expected);
    const dest = path.join(f.project, 'editable.bin');
    const result = await p.materializeToFile('source/one.bin', dest);
    assert.equal(result.method, 'copy');
    assert.notEqual((await stat(blob)).ino, (await stat(dest)).ino);
    await writeFile(dest, 'edited in project workspace');
    assert.equal(await readFile(blob, 'utf8'), expected);
  } finally { await f.cleanup(); }
});

test('materialization refuses replacing managed file with itself', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    const blob = path.join(f.root, 'source.bin');
    await mkdir(f.root, { recursive: true });
    await writeFile(blob, 'canonical');
    await assert.rejects(p.materializeToFile('source.bin', blob), /over itself/);
    assert.equal(await readFile(blob, 'utf8'), 'canonical');
  } finally { await f.cleanup(); }
});

test('materialization rejects symlink source rather than copying redirected bytes', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    await mkdir(f.root, { recursive: true });
    const secret = path.join(f.project, 'secret.txt');
    await mkdir(f.project, { recursive: true });
    await writeFile(secret, 'not part of managed storage');
    await symlink(secret, path.join(f.root, 'redirect.bin'));
    await assert.rejects(p.materializeToFile('redirect.bin', path.join(f.project, 'copy')), /not a regular file/);
  } finally { await f.cleanup(); }
});

test('streaming upload checks supplied SHA-256 and returns measured hash', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    const payload = 'stream bytes are authentic';
    const result = await p.putStream('source/hash.txt', Readable.from([payload]), { size: Buffer.byteLength(payload), checksumSha256: sha256(payload).toUpperCase() });
    assert.equal(result.checksumSha256, sha256(payload));
    assert.equal(await readFile(path.join(f.root, 'source/hash.txt'), 'utf8'), payload);
  } finally { await f.cleanup(); }
});

test('streaming upload computes hash when caller omitted checksum', async () => {
  const f = await fixture();
  try {
    const result = await new LocalStorageProvider(f.root).putStream('one.bin', Readable.from(['alpha', 'beta']), { size: 9 });
    assert.equal(result.checksumSha256, sha256('alphabeta'));
  } finally { await f.cleanup(); }
});

test('wrong checksum cannot publish new object or replace an existing one', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    await p.putStream('existing.bin', Readable.from(['original']), { size: 8 });
    await assert.rejects(p.putStream('existing.bin', Readable.from(['wrong']), { size: 5, checksumSha256: sha256('other') }), /checksum mismatch/);
    assert.equal(await readFile(path.join(f.root, 'existing.bin'), 'utf8'), 'original');
    assert.deepEqual((await readdir(f.root)).sort(), ['existing.bin']);
  } finally { await f.cleanup(); }
});

test('incorrect stream size fails before publishing and cleans partial bytes', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    await assert.rejects(p.putStream('invalid.bin', Readable.from(['123']), { size: 9 }), /length mismatch/);
    assert.deepEqual(await readdir(f.root), []);
  } finally { await f.cleanup(); }
});

test('invalid digest rejected without opening a target', async () => {
  const f = await fixture();
  try {
    const p = new LocalStorageProvider(f.root);
    await assert.rejects(p.putStream('invalid.bin', Readable.from(['abc']), { size: 3, checksumSha256: 'wrong' }), /Invalid expected SHA-256/);
  } finally { await f.cleanup(); }
});

test('inventory errors other than ENOENT fail closed', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, 'blobs'), { recursive: true });
    const brokenFs = { ...require('node:fs/promises'), readdir: async () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; } };
    const Provider = providerClass(brokenFs);
    await assert.rejects(new Provider(f.root).list('blobs'), /permission denied/);
  } finally { await f.cleanup(); }
});

test('missing inventory prefix can still represent an empty set', async () => {
  const brokenFs = { ...require('node:fs/promises'), readdir: async () => { const e = new Error('not found'); e.code = 'ENOENT'; throw e; } };
  const Provider = providerClass(brokenFs);
  assert.deepEqual(Array.from(await new Provider('/arbitrary').list('blobs')), []);
});


test('inventory rejects symlinked prefix even if directory is otherwise readable', async () => {
  const f = await fixture();
  try {
    await mkdir(f.root, { recursive: true });
    await mkdir(f.project, { recursive: true });
    await writeFile(path.join(f.project, 'private.bin'), 'secret');
    await symlink(f.project, path.join(f.root, 'redirect'));
    await assert.rejects(new LocalStorageProvider(f.root).list('redirect'), /symbolic link/);
  } finally { await f.cleanup(); }
});

test('inventory fails closed if a child directory disappears midway through traversal', async () => {
  const f = await fixture();
  try {
    const { rm } = await import('node:fs/promises');
    await mkdir(path.join(f.root, 'tree', 'child'), { recursive: true });
    const liveFs = require('node:fs/promises');
    const unstableFs = { ...liveFs, readdir: async (directory, opts) => {
      if (directory.endsWith('/child')) {
        await rm(directory, { recursive: true, force: true });
      }
      return liveFs.readdir(directory, opts);
    } };
    const Provider = providerClass(unstableFs);
    await assert.rejects(new Provider(f.root).list('tree'), /inventory changed during traversal/);
  } finally { await f.cleanup(); }
});
