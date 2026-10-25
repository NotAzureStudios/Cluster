import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, linkSync, readdirSync, rmSync, renameSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = mkdtempSync(join(tmpdir(), 'cluster-g26-managed-previews-'));
let checks = 0;
const check = async (label, run) => { await run(); checks++; console.log(`PASS managed previews: ${label}`); };
try {
  // Keep the exercised helper production-identical, replacing only the .js
  // import with .mjs for Node 22's lean source test runner.
  const helperDir = join(fixture, 'compiled');
  mkdirSync(helperDir);
  const safeSrc = readFileSync(join(root, 'apps/server/src/domains/library/library-derivative-file-safety.ts'), 'utf8');
  writeFileSync(join(helperDir, 'library-derivative-file-safety.ts'), safeSrc);
  const ioSrc = readFileSync(join(root, 'apps/server/src/domains/library/library-managed-preview-io.ts'), 'utf8');
  writeFileSync(join(helperDir, 'library-managed-preview-io.ts'), ioSrc.replace('./library-derivative-file-safety.js', './library-derivative-file-safety.ts'));
  const {openManagedPreviewStream, saveManagedModelThumbnail, ManagedPreviewIOError} = await import(pathToFileURL(join(helperDir, 'library-managed-preview-io.ts')).href);
  const store = join(fixture, 'store'); mkdirSync(store);
  const bytes = Buffer.alloc(128, 0x4e);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const webp = Buffer.alloc(256,0x57);
  webp.write('RIFF',0,'ascii'); webp.write('WEBP',8,'ascii');
  await check('thumbnail is stored via unique temporary file and sync/rename', async()=>{
    const destination = await saveManagedModelThumbnail(store,'abc','png',bytes);
    assert.equal(destination, join(store,'abc.png'));
    assert.deepEqual(readFileSync(destination),bytes);
    assert.deepEqual(readdirSync(store),['abc.png']);
    assert.equal(lstatSync(destination).nlink,1);
  });
  await check('switching format removes previous variant without orphan lock', async()=>{
    await saveManagedModelThumbnail(store,'abc','webp',webp);
    assert.equal(existsSync(join(store,'abc.png')),false);
    assert.equal(existsSync(join(store,'abc.webp')),true);
    assert.deepEqual(readdirSync(store),['abc.webp']);
  });
  await check('filesystem lock blocks simultaneous or interrupted writers',async()=>{
    mkdirSync(join(store,'abc.thumbnail.lock'));
    await assert.rejects(saveManagedModelThumbnail(store,'abc','png',bytes), e=>e instanceof ManagedPreviewIOError && e.code==='THUMBNAIL_BUSY');
    assert.equal(readFileSync(join(store,'abc.webp')).length,256);
    rmSync(join(store,'abc.thumbnail.lock'),{recursive:true});
  });
  await check('existing symlink cannot become replacement target',async()=>{
    const privateFile=join(fixture,'private'); writeFileSync(privateFile,'private content');
    symlinkSync(privateFile, join(store,'abc.jpg'));
    await assert.rejects(saveManagedModelThumbnail(store,'abc','png',bytes),e=>e instanceof ManagedPreviewIOError && e.code==='PREVIEW_UNSAFE');
    assert.equal(readFileSync(privateFile,'utf8'),'private content');
    assert.deepEqual(readdirSync(store).sort(),['abc.jpg','abc.webp']);
    rmSync(join(store,'abc.jpg'));
  });
  await check('existing hardlink blocks replacement',async()=>{
    const existing=join(fixture,'owned'); writeFileSync(existing,'owned');
    linkSync(existing,join(store,'abc.jpg'));
    await assert.rejects(saveManagedModelThumbnail(store,'abc','png',bytes),/administrator repair/);
    assert.equal(readFileSync(existing,'utf8'),'owned');
    rmSync(join(store,'abc.jpg'));
  });
  await check('unsafe IDs, extensions and sizes fail without filesystem writes',async()=>{
    for(const [id, ext, data] of [['../bad','png',bytes],['abc','exe',bytes],['abc','png',Buffer.alloc(63)],['abc','png',Buffer.alloc(4*1024*1024+1)]]){
      await assert.rejects(saveManagedModelThumbnail(store,id,ext,data),e=>e instanceof ManagedPreviewIOError && e.code==='PREVIEW_UNSAFE');
    }
    assert.deepEqual(readdirSync(store),['abc.webp']);
  });
  await check('symlinked thumbnail root is rejected',async()=>{
    const alias=join(fixture,'alias'); symlinkSync(store,alias,'dir');
    await assert.rejects(saveManagedModelThumbnail(alias,'abc','png',bytes),/administrator repair/);
  });
  await check('descriptor-backed stream holds original bytes after rename replacement',async()=>{
    const original=join(store,'abc.webp');
    const opened=await openManagedPreviewStream(store,original,1024,'webp');
    assert.equal(opened.size,256);
    renameSync(original,join(store,'previous.webp'));
    writeFileSync(original,Buffer.alloc(256,0x41));
    const chunks=[]; for await(const chunk of opened.stream)chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),webp);
    rmSync(join(store,'previous.webp'));
  });
  await check('read rejects symlink, hardlink, traversal and oversized file',async()=>{
    const file=join(store,'abc.webp');
    symlinkSync(file,join(store,'alias.webp'));
    assert.equal(await openManagedPreviewStream(store,join(store,'alias.webp')),null);
    rmSync(join(store,'alias.webp'));
    const foreign=join(fixture,'foreign');writeFileSync(foreign,'foreign');
    assert.equal(await openManagedPreviewStream(store,foreign),null);
    linkSync(file,join(store,'extra.webp'));
    assert.equal(await openManagedPreviewStream(store,file),null);
    rmSync(join(store,'extra.webp'));
    assert.equal(await openManagedPreviewStream(store,file,16),null);
  });
  await check('read refuses symlinked ancestor directory',async()=>{
    const directory=join(store,'subdir');mkdirSync(directory);
    writeFileSync(join(directory,'preview.glb'),'glTF');
    symlinkSync(directory,join(store,'linkdir'),'dir');
    assert.equal(await openManagedPreviewStream(store,join(store,'linkdir','preview.glb')),null);
  });
  await check('wrong thumbnail magic cannot be served under another extension',async()=>{
    const file=join(store,'abc.webp');
    writeFileSync(file,webp);
    assert.equal(await openManagedPreviewStream(store,file,1024,'png'),null);
    const opened=await openManagedPreviewStream(store,file,1024,'webp');
    assert.ok(opened); opened.stream.destroy();
    await assert.rejects(saveManagedModelThumbnail(store,'other','webp',bytes), /Invalid model thumbnail request/);
  });
  await check('valid GLB v2 header and length are required before delivery',async()=>{
    const file=join(store,'trusted.glb');
    const valid=Buffer.alloc(112);
    valid.write('glTF',0,'ascii'); valid.writeUInt32LE(2,4); valid.writeUInt32LE(112,8);
    writeFileSync(file,valid);
    const opened=await openManagedPreviewStream(store,file,1024,'glb');
    assert.ok(opened); opened.stream.destroy();
    valid.writeUInt32LE(111,8); writeFileSync(file,valid);
    assert.equal(await openManagedPreviewStream(store,file,1024,'glb'),null);
    valid.writeUInt32LE(112,8); valid.writeUInt32LE(1,4); writeFileSync(file,valid);
    assert.equal(await openManagedPreviewStream(store,file,1024,'glb'),null);
  });
  const route = readFileSync(join(root,'apps/server/src/domains/library/library-routes.ts'),'utf8');
  await check('thumbnail and GLB responses use opened descriptor streams',async()=>{
    assert.match(route,/findModelThumbnail[\s\S]*?openManagedPreviewStream\(modelThumbnailRoot, candidate, 4 \* 1024 \* 1024, extension\)/);
    assert.match(route,/return reply\.send\(thumbnail\.stream\)/);
    assert.match(route,/saveManagedModelThumbnail\(modelThumbnailRoot, params\.itemId, extension, bytes\)/);
    assert.match(route,/openManagedPreviewStream\(managedPreviewRoot, previewPath, Number\.MAX_SAFE_INTEGER, \"glb\"\)/);
    assert.match(route,/return reply\.send\(openedPreview\.stream\)/);
    assert.doesNotMatch(route,/createReadStream\(verifiedPreview\)|createReadStream\(thumbnail\.candidate\)/);
  });
  console.log(`G26 managed derivative descriptor and write safety: ${checks}/${checks} passed`);
} finally { rmSync(fixture,{recursive:true,force:true}); }
