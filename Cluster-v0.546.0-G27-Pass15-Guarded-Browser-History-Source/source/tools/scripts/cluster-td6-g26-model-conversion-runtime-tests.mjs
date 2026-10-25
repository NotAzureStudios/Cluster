import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

let checks = 0;
async function check(label, fn) {
  await fn();
  checks += 1;
  console.log(`PASS model conversion runtime: ${label}`);
}
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = mkdtempSync(join(tmpdir(), 'cluster-g26-model-runtime-'));
try {
  const work = join(fixture, 'runtime');
  const nodeModules = join(work, 'node_modules', 'assimpjs');
  mkdirSync(nodeModules, { recursive: true });
  // An isolated deterministic native-converter stand-in. No application
  // dependency install is needed to exercise queueing, snapshots and caching.
  copyFileSync(join(sourceRoot, 'apps/server/src/core/blender-preview.ts'), join(work, 'blender-preview.ts'));
  writeFileSync(join(nodeModules, 'index.js'), `
module.exports = async () => {
  await new Promise(resolve => setTimeout(resolve, 15));
  return {
    FileList: class { constructor(){this.entries=[];} AddFile(name, data){this.entries.push({name,data});} delete(){} },
    ConvertFileList(files){
      globalThis.__clusterG26AssimpCalls = (globalThis.__clusterG26AssimpCalls || 0) + 1;
      const bytes = Buffer.alloc(112);
      bytes.write('glTF', 0, 'ascii'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(112, 8);
      return {
        IsSuccess:()=>true, GetErrorCode:()=>0, FileCount:()=>1,
        GetFile:()=>({GetPath:()=> 'preview.glb', GetContent:()=> bytes, delete(){} }), delete(){}
      };
    }
  };
};
`);
  const runtime = await import(pathToFileURL(join(work,'blender-preview.ts')).href);
  const {readModelPreviewInput, validModelGlbHeader, createBlendPreview, createModelGlbDerivative, modelPreviewAdmission, ModelPreviewBusyError} = runtime;
  const source = join(fixture, 'model.blend');
  const texture = join(fixture, 'texture.png');
  writeFileSync(source, 'mesh content fixture');
  writeFileSync(texture, 'texture content');
  await check('a single regular source is read through a descriptor', async () => assert.equal(Buffer.from(await readModelPreviewInput(source, 64)).toString(), 'mesh content fixture'));
  await check('size limit is enforced before loading bytes', async () => await assert.rejects(readModelPreviewInput(source, 3), /limit/));
  await check('zero and invalid size budgets fail closed', async () => await assert.rejects(readModelPreviewInput(source, 0), /limit/));
  const link = join(fixture, 'link.blend');
  symlinkSync(source, link);
  await check('symlinked model source is rejected', async () => await assert.rejects(readModelPreviewInput(link, 64), /unsafe/));
  const hardlink = join(fixture, 'hardlink.blend');
  linkSync(source, hardlink);
  await check('hard-linked model source is rejected', async () => await assert.rejects(readModelPreviewInput(source, 64), /unsafe/));
  rmSync(hardlink);
  const empty = join(fixture, 'empty.blend');
  writeFileSync(empty, '');
  await check('empty model source is rejected', async () => await assert.rejects(readModelPreviewInput(empty, 64), /limit/));
  const valid = Buffer.alloc(112);
  valid.write('glTF'); valid.writeUInt32LE(2, 4); valid.writeUInt32LE(112, 8);
  await check('GLB v2 header and length verified', async () => assert.equal(validModelGlbHeader(valid, 112), true));
  await check('bad GLB version rejected', async () => { const invalid = Buffer.from(valid); invalid.writeUInt32LE(1, 4); assert.equal(validModelGlbHeader(invalid, 112), false); });
  await check('truncated GLB header rejected', async () => assert.equal(validModelGlbHeader(valid.subarray(0, 8), 112), false));
  await check('declared GLB length mismatch rejected', async () => assert.equal(validModelGlbHeader(valid, 113), false));
  const cache = join(fixture, 'cache');
  const options = {sourcePath:source,sourceRelativeName:'model.blend',companions:[{sourcePath:texture,relativeName:'textures/a.png'}],cacheRoot:cache,cacheKey:'f'.repeat(64),maxSourceBytes:1024};
  await check('same-preview requests coalesce to one conversion', async () => {
    const result = await Promise.all(Array.from({length:3},()=>createBlendPreview(options)));
    assert.equal(new Set(result).size, 1);
    assert.equal(globalThis.__clusterG26AssimpCalls, 1);
  });
  await check('valid cached GLB avoids redundant conversion', async () => {
    await createBlendPreview(options);
    assert.equal(globalThis.__clusterG26AssimpCalls, 1);
  });
  await check('invalid cached header is regenerated', async () => {
    const cached = join(cache, `${options.cacheKey}.glb`);
    writeFileSync(cached, Buffer.alloc(112));
    await createBlendPreview(options);
    assert.equal(globalThis.__clusterG26AssimpCalls, 2);
  });
  await check('explicit missing texture cannot be silently omitted', async () => {
    await assert.rejects(createBlendPreview({...options,cacheKey:'a'.repeat(64),companions:[{sourcePath:join(fixture, 'missing.png'),relativeName:'x.png'}]}));
  });
  await check('relative-name collisions reject two distinct companion assets', async () => {
    await assert.rejects(createBlendPreview({...options,cacheKey:'b'.repeat(64),companions:[{sourcePath:texture,relativeName:'X.png'},{sourcePath:texture,relativeName:'x.png'}]}), /collide/);
  });
  await check('companion cannot shadow primary model relative path', async () => {
    await assert.rejects(createBlendPreview({...options,cacheKey:'c'.repeat(64),companions:[{sourcePath:texture,relativeName:'model.blend'}]}), /collide/);
  });
  await check('companion total-size cap fails before reading too many bytes', async () => {
    await assert.rejects(createBlendPreview({...options,cacheKey:'d'.repeat(64),maxSourceBytes:18}), /limit/);
  });
  await check('cache-key traversal is rejected', async () => await assert.rejects(createBlendPreview({...options,cacheKey:'../bad'}), /identity/));
  const linkedCache = join(fixture,'bad-cache');
  symlinkSync(cache, linkedCache, 'dir');
  await check('symlinked cache root is rejected', async () => await assert.rejects(createBlendPreview({...options,cacheRoot:linkedCache}), /unsafe/));
  const symlinkCache = join(cache, `${'e'.repeat(64)}.glb`);
  symlinkSync(source, symlinkCache);
  await check('symlinked cache candidate is rejected', async () => await assert.rejects(createBlendPreview({...options,cacheKey:'e'.repeat(64)}), /unsafe/));
  await check('bounded queue rejects excess independent conversions', async () => {
    const attempts = Array.from({length:4},(_,i) => createModelGlbDerivative({sourcePath:source,sourceRelativeName:'model.blend',outputPath:join(fixture,`queued-${i}.glb`),maxSourceBytes:1024}));
    assert.equal(modelPreviewAdmission().queued, 4);
    await assert.rejects(createModelGlbDerivative({sourcePath:source,sourceRelativeName:'model.blend',outputPath:join(fixture,'overflow.glb')}), (error) => error instanceof ModelPreviewBusyError);
    await Promise.all(attempts);
    assert.equal(modelPreviewAdmission().queued, 0);
  });
  await check('errors do not poison the conversion queue', async () => {
    const p = await createModelGlbDerivative({sourcePath:source,sourceRelativeName:'model.blend',outputPath:join(fixture,'recovered.glb'),maxSourceBytes:1024});
    assert.equal(readFileSync(p).subarray(0,4).toString(), 'glTF');
  });
  const {modelPreviewAuthorizationSnapshot} = await import(pathToFileURL(join(sourceRoot,'apps/server/src/domains/library/library-model-preview-security.ts')).href);
  const sourceRecord = {id:'source',revision:1,updatedAt:new Date('2026-01-01T00:00:00.000Z'),status:'active',metadata:'{}',ownerId:'person-a',fileName:'source.blend'};
  const companionRecord = {id:'companion',revision:1,status:'active',fileName:'texture.png',projectId:'project-a'};
  const authorizedRefs = [{reference:{id:'companion',name:'texture.png'},record:companionRecord}];
  const policyHash = modelPreviewAuthorizationSnapshot(sourceRecord,authorizedRefs);
  await check('unchanged delivery authority snapshot is stable', async () => assert.equal(policyHash,modelPreviewAuthorizationSnapshot({...sourceRecord}, authorizedRefs)));
  await check('revoked source owner invalidates delivery snapshot', async () => assert.notEqual(policyHash,modelPreviewAuthorizationSnapshot({...sourceRecord,ownerId:'person-b'}, authorizedRefs)));
  await check('companion moved to another Project invalidates delivery snapshot', async () => assert.notEqual(policyHash,modelPreviewAuthorizationSnapshot(sourceRecord,[{...authorizedRefs[0],record:{...companionRecord,projectId:'project-b'}}])));
  await check('companion archived while queued invalidates delivery snapshot', async () => assert.notEqual(policyHash,modelPreviewAuthorizationSnapshot(sourceRecord,[{...authorizedRefs[0],record:{...companionRecord,status:'archived'}}])));
  await check('source bundle edits invalidate delivery snapshot', async () => assert.notEqual(policyHash,modelPreviewAuthorizationSnapshot({...sourceRecord,metadata:'{"modelBundle":[]}'},authorizedRefs)));
  await check('companion name substitution invalidates delivery snapshot', async () => assert.notEqual(policyHash,modelPreviewAuthorizationSnapshot(sourceRecord,[{...authorizedRefs[0],reference:{...authorizedRefs[0].reference,name:'different.png'}}])));
  const routes = readFileSync(join(sourceRoot,'apps/server/src/domains/library/library-routes.ts'),'utf8');
  await check('delivery re-reads canonical ACL and Library items', async () => {
    assert.match(routes,/freshContext = await contextForUser\(freshUser, prisma, \{ strict: true \}\)/);
    assert.match(routes,/MODEL_PREVIEW_ACCESS_CHANGED/);
    assert.match(routes,/modelPreviewAuthorizationSnapshot\(freshSource, freshCompanions\) !== authorizationSnapshot/);
    assert.match(routes,/current.stat.ctimeMs !== previous.ctimeMs/);
  });
  await check('busy conversion returns retryable API response', async () => {
    assert.match(routes,/error instanceof ModelPreviewBusyError/);
    assert.match(routes,/Retry-After/);
    assert.match(routes,/MODEL_PREVIEW_BUSY/);
  });
  console.log(`G26 model preview conversion runtime: ${checks}/${checks} passed`);
} finally {
  rmSync(fixture, {recursive:true,force:true});
}
