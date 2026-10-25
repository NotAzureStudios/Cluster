/** TD5 P4: real journal filesystem tests + extracted production mirror implementation. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, symlink, writeFile, link, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try {return require('typescript');} catch {return require(`${require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`);} })();
const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../apps/server/src/app/server-services-operations.ts');
const helperPath = path.resolve(here, '../../apps/server/src/core/storage/backup-mirror-retention.ts');
const server = readFileSync(serverPath, 'utf8');
const helper = readFileSync(helperPath,'utf8');
function compile(src, fileName) {
 return ts.transpileModule(src,{fileName,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
}
function loadHelper(overrides = {}) {
 const mod={exports:{}};
 vm.runInNewContext(compile(helper,helperPath),{
  module:mod,exports:mod.exports,process,Buffer,Date,Set,Error,Promise,
  require(id){if(id==='node:fs/promises')return {...require(id),...overrides};if(id==='./local-storage-provider.js')return loadLocalGuards();if(id.startsWith('node:'))return require(id);throw Error(`Unexpected import ${id}`);},
 },{filename:helperPath});
 return mod.exports;
}
const {recordDeferredBackupMirrors, DEFERRED_BACKUP_MIRROR_JOURNAL} = loadHelper();
const plan = () => ({provider:'object',objects:[
 {fileName:'cluster-backup-2026.dump',key:'system/backups/cluster-backup-2026/cluster-backup-2026.dump'},
 {fileName:'cluster-backup-2026.json',key:'system/backups/cluster-backup-2026/cluster-backup-2026.json'},
]});
const rootFixture=async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cluster-td5-p4-'));
 return {dir,cleanup:()=>rm(dir,{recursive:true,force:true})};
};
const record=(dir,patch={})=>recordDeferredBackupMirrors({backupsRoot:dir,generationId:'cluster-backup-2026',reason:'retention-expired',plan:plan(),...patch});
const rows=async(dir)=>(await readFile(path.join(dir,DEFERRED_BACKUP_MIRROR_JOURNAL),'utf8')).trim().split('\n').map(JSON.parse);

test('remote cleanup is evidence-only and append-durable across calls', async()=>{
 const {dir,cleanup}=await rootFixture();try{
  assert.equal(await record(dir),true);
  assert.equal(await record(dir,{reason:'manual-backup-removal'}),true);
  const all=await rows(dir);
  assert.equal(all.length,2);assert.equal(all[0].reason,'retention-expired');assert.equal(all[1].reason,'manual-backup-removal');
  assert.equal(all[0].provider,'object');assert.equal(all[0].objects.length,2);
  assert.match(all[0].outcome,/no deletion attempted/);
  assert.notEqual(all[0].eventId,all[1].eventId);
 }finally{await cleanup();}
});
test('null plan is a no-op without creating evidence',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  assert.equal(await record(dir,{plan:null}),false);
  assert.deepEqual(await readdir(dir),[]);
 }finally{await cleanup();}
});
test('unsafe provider identity fails closed',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  await assert.rejects(record(dir,{plan:{...plan(),provider:'../object'}}),/Invalid deferred/);
  assert.deepEqual(await readdir(dir),[]);
 }finally{await cleanup();}
});
test('unsafe storage keys and duplicate pointers reject without journaling',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  for(const bad of ['../escape','system//key','system/../key','system/\\escape','system/\0key']){
   await assert.rejects(record(dir,{plan:{provider:'object',objects:[{fileName:'safe.dump',key:bad}]}}),/Invalid or duplicate/);
  }
  const p=plan();p.objects.push({...p.objects[0]});
  await assert.rejects(record(dir,{plan:p}),/Invalid or duplicate/);
  assert.deepEqual(await readdir(dir),[]);
 }finally{await cleanup();}
});
test('invalid generation and fileName fail before creating journal',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  await assert.rejects(record(dir,{generationId:'../wrong'}),/generation identity/);
  await assert.rejects(record(dir,{plan:{provider:'object',objects:[{fileName:'../secret',key:'safe/file'}]}}),/Invalid or duplicate/);
  assert.deepEqual(await readdir(dir),[]);
 }finally{await cleanup();}
});
test('missing backup journal directory prevents cleanup evidence',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  await assert.rejects(record(path.join(dir,'missing')),{code:'ENOENT'});
 }finally{await cleanup();}
});
test('symlinked journal file is rejected and target is unmodified',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const external=path.join(dir,'external');await writeFile(external,'do not touch');
  await symlink(external,path.join(dir,DEFERRED_BACKUP_MIRROR_JOURNAL));
  await assert.rejects(record(dir));
  assert.equal(await readFile(external,'utf8'),'do not touch');
 }finally{await cleanup();}
});
test('hard-linked journal is rejected and linked bytes remain intact',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const external=path.join(dir,'external');await writeFile(external,'do not touch');
  await link(external,path.join(dir,DEFERRED_BACKUP_MIRROR_JOURNAL));
  await assert.rejects(record(dir),/exclusive regular file/);
  assert.equal(await readFile(external,'utf8'),'do not touch');
 }finally{await cleanup();}
});
test('symlinked backup-root is rejected',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const external=path.join(dir,'external');await mkdir(external);
  const alias=path.join(dir,'alias');await symlink(external,alias);
  await assert.rejects(record(alias),/not a real directory|symbolic-link|junction/);
  assert.deepEqual(await readdir(external),[]);
 }finally{await cleanup();}
});

test('production mirror function preserves every remote object after a copy failure',async()=>{
 const start=server.indexOf('  async function mirrorBackupGeneration(');
 const end=server.indexOf('  async function deferMirroredBackup(',start);
 assert(start>0 && end>start);
 let copied=0;let deleted=0;
 const storageRuntime={
  async putFile(){copied++;if(copied===2)throw Error('remote storage error');return {size:3};},
  async delete(){deleted++;throw Error('should never delete');},
 };
 const ctx={storageRuntime,fs:{stat:async()=>({size:3})},path,throwIfAborted:()=>{},Error};
 vm.runInNewContext(compile(`${server.slice(start,end)}\n globalThis.runMirror=mirrorBackupGeneration;`,serverPath),ctx);
 await assert.rejects(ctx.runMirror(plan(),[
  {fileName:'cluster-backup-2026.dump',filePath:'/tmp/one'},
  {fileName:'cluster-backup-2026.json',filePath:'/tmp/two'},
 ]),/remote storage error/);
 assert.equal(copied,2);assert.equal(deleted,0);
});

test('backup manifest is published only after remote mirror completes',()=>{
 const mirror=server.indexOf('await mirrorBackupGeneration(mirrorPlan, generationPaths.map(');
 const publish=server.indexOf('await fs.rename(tempManifestPath, manifestPath);',mirror);
 const priorPublish=server.lastIndexOf('await fs.rename(tempManifestPath, manifestPath);', mirror);
 assert(mirror>0 && publish>mirror && priorPublish<0);
 assert.match(server,/await deferMirroredBackup\(manifest, "retention-expired"\)/);
 assert.match(server,/await deferMirroredBackup\(manifest, "manual-backup-removal"\)/);
 assert.doesNotMatch(server,/storageRuntime\.delete\(\{ provider: plan\.provider, tier: "archive"/);
});

test('journal write errors prevent a successful deferral result',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const broken=loadHelper({open:async()=>({
   stat:async()=>({isFile:()=>true,nlink:1}),
   write:async()=>{const e=Error('backup volume failed');e.code='EIO';throw e;},
   close:async()=>{},
  })});
  await assert.rejects(broken.recordDeferredBackupMirrors({
   backupsRoot:dir,generationId:'cluster-backup-2026',reason:'failed-generation',plan:plan(),
  }),/backup volume failed/);
 }finally{await cleanup();}
});

test('failed mirrors and manual deletion require durable deferral before local cleanup',async()=>{
 const start=server.indexOf('  async function deferMirroredBackup(');
 const end=server.indexOf('  async function materializeManifestArtifact(',start);
 assert(start>0 && end>start);
 const ctx={DATA_LAYOUT:{backupsRoot:'/fake'},recordDeferredBackupMirrors:async()=>{throw Error('journal unavailable');},String,Error};
 vm.runInNewContext(compile(`${server.slice(start,end)}\n globalThis.defer=deferMirroredBackup;`,serverPath),ctx);
 await assert.rejects(ctx.defer({generationId:'cluster-backup-2026',storageMirror:plan()},'failed-generation'),/journal unavailable/);
 const manual=server.slice(server.indexOf('  async function deleteBackupGeneration('),server.indexOf('  async function listBackupManifests('));
 assert(manual.indexOf('await deferMirroredBackup(')<manual.indexOf('await fs.rm('));
 const prune=server.slice(server.indexOf('  async function pruneOldBackups('),server.indexOf('  async function runBackupSchedulerTick('));
 assert(prune.indexOf('await deferMirroredBackup(manifest, "retention-expired")')<prune.indexOf('await fs.rm(manifestPath'));
});

test('mirror size mismatch does not trigger unfenced remote cleanup',async()=>{
 const start=server.indexOf('  async function mirrorBackupGeneration(');
 const end=server.indexOf('  async function deferMirroredBackup(',start);
 let deleted=0;
 const ctx={storageRuntime:{putFile:async()=>({size:2}),delete:async()=>{deleted++;}},fs:{stat:async()=>({size:3})},path,throwIfAborted:()=>{},Error};
 vm.runInNewContext(compile(`${server.slice(start,end)}\n globalThis.runMirror=mirrorBackupGeneration;`,serverPath),ctx);
 await assert.rejects(ctx.runMirror(plan(),[{fileName:'cluster-backup-2026.dump',filePath:'/tmp/a'}]),/verification failed/);
 assert.equal(deleted,0);
});

// Exercise the actual remote-provider fallback with a real temporary filesystem.
// This deliberately does not stand in for Windows reparse-point or NAS testing.
const runtimePath=path.resolve(here,'../../apps/server/src/core/storage/storage-runtime.ts');
const runtimeCode=readFileSync(runtimePath,'utf8');
function loadLocalGuards(){
 const file=path.resolve(here,'../../apps/server/src/core/storage/local-storage-provider.ts');
 const mod={exports:{}};
 vm.runInNewContext(compile(readFileSync(file,'utf8'),file),{
  module:mod,exports:mod.exports,process,Buffer,Promise,Error,AbortController,
  require(id){if(id==='../operation-cancellation.js')return {throwIfAborted(signal){if(signal?.aborted)throw Error('aborted');}};if(id.startsWith('node:'))return require(id);throw Error(id);},
 },{filename:file});
 return mod.exports;
}
const localGuards=loadLocalGuards();
function materializationFallback(provider){
 const start=runtimeCode.indexOf('  async materializeToFile(locator: StorageLocator,');
 const end=runtimeCode.indexOf('  async stat(locator: StorageLocator)',start);
 assert(start>0 && end>start,'Expected source fallback method');
 const ctx={
  fs:require('node:fs/promises'), path, process, Promise, Error, Buffer,
  createWriteStream:require('node:fs').createWriteStream,
  pipeline:require('node:stream/promises').pipeline,
  randomUUID:require('node:crypto').randomUUID,
  prepareRealDirectory:localGuards.prepareRealDirectory,
  assertRealDirectoryChain:localGuards.assertRealDirectoryChain,
 };
 vm.runInNewContext(compile(`class Shim {${runtimeCode.slice(start,end)}}\nglobalThis.Shim=Shim`,runtimePath),ctx);
 const instance=new ctx.Shim();
 instance.provider=()=>provider;
 instance.providerKey=(locator)=>`${locator.tier}/${locator.key}`;
 return (dest,signal)=>instance.materializeToFile({provider:'remote',tier:'standard',key:'one.bin'},dest,signal);
}
const stableRemote=(data='remote bytes')=>({
 async stat(){return {size:Buffer.byteLength(data),modifiedAt:new Date('2026-01-01T00:00:00Z')};},
 async openRead(){const {Readable}=await import('node:stream');return Readable.from([data]);},
});
test('remote materialization refuses a symlinked destination ancestor',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const remote=stableRemote();const outside=path.join(dir,'outside');await mkdir(outside);
  await symlink(outside,path.join(dir,'redirect'));
  await assert.rejects(materializationFallback(remote)(path.join(dir,'redirect','asset.bin')),/symbolic-link|junction/);
  assert.deepEqual(await readdir(outside),[]);
 }finally{await cleanup();}
});
test('remote materialization publishes an independent copy on a normal directory',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const source='remote bytes';const dest=path.join(dir,'project','copy.bin');
  const result=await materializationFallback(stableRemote(source))(dest);
  assert.equal(result.method,'copy');assert.equal(await readFile(dest,'utf8'),source);
 }finally{await cleanup();}
});
test('remote source revision drift blocks publication and cleans temp file',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  let probes=0;const remote={...stableRemote(),async stat(){probes++;return {size:12,modifiedAt:new Date(probes===1?'2026-01-01T00:00:00Z':'2026-02-01T00:00:00Z')};}};
  const dest=path.join(dir,'project','copy.bin');
  await assert.rejects(materializationFallback(remote)(dest),/Remote storage source changed/);
  assert.deepEqual(await readdir(path.dirname(dest)),[]);
 }finally{await cleanup();}
});
test('remote size discrepancy blocks publication and cleans temp file',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const remote={...stableRemote(),async stat(){return {size:999,modifiedAt:new Date('2026-01-01T00:00:00Z')};}};
  const dest=path.join(dir,'project','copy.bin');
  await assert.rejects(materializationFallback(remote)(dest),/length mismatch/);
  assert.deepEqual(await readdir(path.dirname(dest)),[]);
 }finally{await cleanup();}
});

test('deferred cleanup journal refuses a symlinked ancestor',async()=>{
 const {dir,cleanup}=await rootFixture();try{
  const actual=path.join(dir,'actual');await mkdir(actual);
  const alias=path.join(dir,'alias');await symlink(actual,alias);
  await assert.rejects(record(path.join(alias,'backups')),/symbolic-link|junction/);
  assert.deepEqual(await readdir(actual),[]);
 }finally{await cleanup();}
});
