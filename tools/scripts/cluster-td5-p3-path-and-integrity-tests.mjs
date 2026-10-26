/** TD5 P3: local filesystem and Project asset audit failure-injection tests.
 * Runs using the project's actual provider/scan source on temp disk fixtures.
 * This does not certify NTFS, SMB, PostgreSQL, or provider-generation fencing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(`${require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript/lib/typescript.js`); }
})();
const providerPath = path.resolve(import.meta.dirname, '../../apps/server/src/core/storage/local-storage-provider.ts');
const providerCode = ts.transpileModule(readFileSync(providerPath,'utf8'), {
  fileName: providerPath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function providerClass(overrides = {}) {
  const mod={exports:{}};
  vm.runInNewContext(providerCode,{
    module:mod,exports:mod.exports,process,Buffer,Promise,Error,AbortController,
    require(id){
      if(id === 'node:fs/promises')return {...require(id),...overrides};
      if(id==='../operation-cancellation.js')return {throwIfAborted(signal){if(signal?.aborted)throw signal.reason || Error('aborted');}};
      if(id.startsWith('node:'))return require(id);
      throw Error(`Unexpected import ${id}`);
    },
  },{filename:providerPath});
  return mod.exports.LocalStorageProvider;
}
const Provider=providerClass();
async function fixture(){
  const home=await mkdtemp(path.join(tmpdir(),'cluster-td5-p3-'));
  return { home, root:path.join(home,'storage'), external:path.join(home,'external'), dest:path.join(home,'project','asset.bin'), cleanup:()=>require('node:fs/promises').rm(home,{recursive:true,force:true}) };
}
async function put(p,key,bytes){return p.putStream(key,Readable.from([bytes]),{size:Buffer.byteLength(bytes)});}

test('stream write rejects a symlinked managed parent and does not create files outside root',async()=>{
  const f=await fixture();try{
    await mkdir(f.root,{recursive:true}); await mkdir(f.external,{recursive:true});
    await symlink(f.external,path.join(f.root,'escape'));
    await assert.rejects(put(new Provider(f.root),'escape/stolen.txt','private'),/symbolic-link|junction/);
    await assert.rejects(stat(path.join(f.external,'stolen.txt')),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
test('putFile rejects redirected managed parent before copying',async()=>{
  const f=await fixture();try{
    await mkdir(f.root,{recursive:true});await mkdir(f.external,{recursive:true});
    await symlink(f.external,path.join(f.root,'escape'));
    const source=path.join(f.home,'upload');await writeFile(source,'payload');
    await assert.rejects(new Provider(f.root).putFile('escape/out',source),/symbolic-link|junction/);
    await assert.rejects(stat(path.join(f.external,'out')),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
test('provider refuses roots redirected through a symlink and reports unhealthy',async()=>{
  const f=await fixture();try{
    await mkdir(f.external,{recursive:true});await symlink(f.external,f.root);
    const p=new Provider(f.root);
    await assert.rejects(put(p,'one.bin','x'),/symbolic-link|junction/);
    assert.equal((await p.health()).ok,false);
  }finally{await f.cleanup();}
});
test('reads, stat and delete reject symlinked leaf without touching external bytes',async()=>{
  const f=await fixture();try{
    await mkdir(f.root,{recursive:true});await mkdir(f.external,{recursive:true});
    const outside=path.join(f.external,'secret');await writeFile(outside,'secret');
    await symlink(outside,path.join(f.root,'alias.bin'));
    const p=new Provider(f.root);
    await assert.rejects(p.openRead('alias.bin'),/regular file/);
    await assert.rejects(p.stat('alias.bin'),/regular file/);
    await assert.rejects(p.delete('alias.bin'),/regular file/);
    assert.equal(await readFile(outside,'utf8'),'secret');
  }finally{await f.cleanup();}
});
test('managed parent symlink blocks reads, metadata and delete',async()=>{
  const f=await fixture();try{
    await mkdir(f.root,{recursive:true});await mkdir(f.external,{recursive:true});
    await writeFile(path.join(f.external,'payload'),'protected');await symlink(f.external,path.join(f.root,'alias'));
    const p=new Provider(f.root);
    await assert.rejects(p.stat('alias/payload'),/symbolic-link|junction/);
    await assert.rejects(p.openRead('alias/payload'),/symbolic-link|junction/);
    await assert.rejects(p.delete('alias/payload'),/symbolic-link|junction/);
    assert.equal(await readFile(path.join(f.external,'payload'),'utf8'),'protected');
  }finally{await f.cleanup();}
});
test('materialization refuses a symlinked destination directory',async()=>{
  const f=await fixture();try{
    const p=new Provider(f.root);await put(p,'one.bin','canonical');await mkdir(f.external,{recursive:true});
    await mkdir(path.dirname(f.dest),{recursive:true});
    const redir=path.join(path.dirname(f.dest),'redir');await symlink(f.external,redir);
    await assert.rejects(p.materializeToFile('one.bin',path.join(redir,'asset.bin')), /symbolic-link|junction/);
    await assert.rejects(stat(path.join(f.external,'asset.bin')),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
test('materialized copy rejects mid-open source replacement by checking handle identity',async()=>{
  const f=await fixture();try{
    const base=providerClass(); const normal=new base(f.root);await put(normal,'one.bin','canonical');
    const real=require('node:fs/promises');
    const Injected=providerClass({ open:async(file,...args)=>{
      if(file===path.join(f.root,'one.bin')){
        await real.rename(file,`${file}.old`);await real.writeFile(file,'different bytes');
      }
      return real.open(file,...args);
    }});
    await assert.rejects(new Injected(f.root).materializeToFile('one.bin',f.dest),/changed before materialization/);
    await assert.rejects(stat(f.dest),{code:'ENOENT'});
  }finally{await f.cleanup();}
});
test('inventory rejects symlink entries, not just symlinked prefixes',async()=>{
  const f=await fixture();try{
    await mkdir(path.join(f.root,'tree'),{recursive:true});await mkdir(f.external,{recursive:true});
    await symlink(f.external,path.join(f.root,'tree','redirect'));
    await assert.rejects(new Provider(f.root).list('tree'),/symbolic link/);
  }finally{await f.cleanup();}
});
test('inventory rejects a symlinked ancestor to a nested prefix',async()=>{
  const f=await fixture();try{
    await mkdir(f.root,{recursive:true});await mkdir(path.join(f.external,'nested'),{recursive:true});
    await symlink(f.external,path.join(f.root,'alias'));
    await assert.rejects(new Provider(f.root).list('alias/nested'),/symbolic-link|junction/);
  }finally{await f.cleanup();}
});
test('ordinary upload, range read, isolated materialization and inventory still work',async()=>{
  const f=await fixture();try{
    const p=new Provider(f.root);await put(p,'bucket/source.bin','hello world');
    const s=await p.openRead('bucket/source.bin',{start:6,end:10});
    let data='';for await(const part of s)data+=part.toString();assert.equal(data,'world');
    await p.materializeToFile('bucket/source.bin',f.dest);
    await writeFile(f.dest,'edited');assert.equal(await readFile(path.join(f.root,'bucket','source.bin'),'utf8'),'hello world');
    assert.deepEqual(Array.from(await p.list('bucket')),['bucket/source.bin']);
  }finally{await f.cleanup();}
});

const routeSource=readFileSync(path.resolve(import.meta.dirname,'../../apps/server/src/domains/projects/project-asset-routes.ts'),'utf8');
const start=routeSource.indexOf('async function mapConcurrent<');
const end=routeSource.indexOf('export function registerProjectAssetRoutes',start);
assert(start>0 && end>start,'Expected to extract the real integrity scanner');
const extract=`const MAX_INTEGRITY_ROWS=10000;const LINEAGE_FIELDS=['derivedFromId','proxyOfId','exportOfId','supersededById'];\n${routeSource.slice(start,end)}\n globalThis.__scan=scanAssetIntegrity;`;
const scanContext={managedProjectStorageKey:()=> 'project/assets', Date, Promise, Set, Map};
vm.runInNewContext(ts.transpileModule(extract,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scanContext);
async function scanFixture({statError=null,listError=null,provider='local',limit=1}={}){
 const files=Array.from({length:limit},(_,i)=>({id:`asset-${i}`,title:'Work file', originalName:'work.bin',sizeBytes:4,archived:false, revision:1}));
 const deps={
  prisma:{projectFile:{findMany:async()=>files}},
  authorization:{filterTargetsForRequest:async(_req,rows)=>rows},
  projectFileStorageLocator:(f)=>({provider,key:`project/assets/${f.id}`}),
  storageRuntime:{
   stat:async()=>{if(statError)throw statError;return {size:4}},
   place:()=>({provider,key:'project/assets'}),
   list:async()=>{if(listError)throw listError;return files.map(f=>`project/assets/${f.id}`);},
  },
 };
 return scanContext.__scan(deps, {}, {id:'project',workspaceId:'workspace'});
}
const error=(code,message)=>Object.assign(Error(message),{code});
test('asset scan never reports EACCES as a missing file',async()=>{
 const scan=await scanFixture({statError:error('EACCES','permission denied')});
 assert.equal(scan.complete,false);assert.equal(scan.ok,false);assert.equal(scan.missing.length,0);assert.equal(scan.unavailable.length,1);
});
test('local ENOENT is an explicitly missing asset and is not a clean scan',async()=>{
 const scan=await scanFixture({statError:error('ENOENT','not found')});
 assert.equal(scan.complete,true);assert.equal(scan.ok,false);assert.equal(scan.missing.length,1);
});
test('shared-filesystem ENOENT remains unverified until provider recovery is certified',async()=>{
 const scan=await scanFixture({statError:error('ENOENT','not found'),provider:'shared'});
 assert.equal(scan.missing.length,0);assert.equal(scan.unavailable.length,1);assert.equal(scan.complete,false);
});
test('remote 404 is unverified rather than evidence of physical deletion',async()=>{
 const scan=await scanFixture({statError:Error('S3 HEAD failed with HTTP 404'),provider:'object'});
 assert.equal(scan.missing.length,0);assert.equal(scan.unavailable.length,1);assert.equal(scan.ok,false);
});
test('storage listing failures prevent a clean bill of health',async()=>{
 const scan=await scanFixture({listError:error('ETIMEDOUT','storage unavailable')});
 assert.equal(scan.inventoryFailed,true);assert.equal(scan.orphanScanSkipped,true);assert.equal(scan.complete,false);assert.equal(scan.ok,false);
});
test('complete audit does not report false storage problems',async()=>{
 const scan=await scanFixture();assert.equal(scan.complete,true);assert.equal(scan.ok,true);assert.equal(scan.orphanCount,0);
});
test('record limit makes a truncated audit incomplete',async()=>{
 const scan=await scanFixture({limit:10001});assert.equal(scan.truncated,true);assert.equal(scan.complete,false);assert.equal(scan.ok,false);
});
test('repair handler explicitly denies incomplete integrity scans',()=>{
 assert.match(routeSource,/if \(!scan\.complete\) return reply\.code\(409\)\.send\(\{ code: "INTEGRITY_SCAN_INCOMPLETE"/);
});
test('single-asset verification reports provider failures as unavailable rather than missing',()=>{
  const section=routeSource.slice(routeSource.indexOf('app.post("/api/project-files/:fileId/verify"'),routeSource.indexOf('app.get("/api/projects/:projectId/assets/integrity"'));
  assert.match(section,/reply\.code\(503\)\.send\(\{ code: "ASSET_VERIFICATION_UNAVAILABLE"/);
  assert.match(section,/if \(!isConfirmedLocalMissing\(error, locator\)\)/);
});
test('checksum repair keeps the committed result when Activity projection fails',()=>{
  const section=routeSource.slice(routeSource.indexOf('app.post("/api/project-files/:fileId/verify"'),routeSource.indexOf('app.get("/api/projects/:projectId/assets/integrity"'));
  assert.match(section,/repaired = true;[\s\S]*?try \{[\s\S]*?await logActivity\([\s\S]*?\} catch \{/);
});
