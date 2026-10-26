import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', { paths: [process.cwd(), path.join(dirname(process.execPath), '../lib/node_modules'), '/usr/local/lib/node_modules'] }));
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { relocateLibraryStoredFile } = await import(pathToFileURL(path.join(root,'apps/server/src/core/library-storage-relocation.ts')).href);
const temp = mkdtempSync(path.join(os.tmpdir(), 'cluster-td4-r38-'));
let passed = 0;
async function check(name, test) { await test(); console.log(`PASS ${name}`); passed++; }
function digest(data) { return createHash('sha256').update(data).digest('hex'); }
async function fixture(name='original.dat', bytes='original bytes') {
  const dir = await fs.mkdtemp(path.join(temp, 'case-'));
  await fs.mkdir(path.join(dir,'before'), { recursive:true });
  await fs.writeFile(path.join(dir,'before',name), bytes);
  const item = { id:'id-1', parentId:'folder-new', fileName:`before/${name}`, checksumSha256:digest(bytes) };
  let persisted = {...item};
  let claims = 0, owned = false;
  return { root:dir, item, source:path.join(dir,item.fileName), target:path.join(dir,'after',name),
    get persisted() {return persisted;}, get claims(){return claims;}, set owned(value){owned=value;},
    callbacks: {
      ownedByOther: async () => owned,
      claim: async (current,next,parent) => { claims++; if (persisted.fileName!==current || persisted.parentId!==parent) return false; persisted={...persisted,fileName:next}; return true; }
    }
  };
}
async function relocate(f, more={}) { return relocateLibraryStoredFile({ root:f.root, item:f.item, directory:'after', ...f.callbacks, ...more }); }
await check('Exclusive complete copy updates DB pointer while keeping old bytes recoverable', async()=> {
 const f=await fixture(); assert.equal(await relocate(f),'normalized'); assert.equal(f.persisted.fileName, 'after/original.dat');
 assert.equal(await fs.readFile(f.target,'utf8'), 'original bytes'); assert.equal(await fs.readFile(f.source,'utf8'), 'original bytes');
});
await check('Destination is an independent copy and old bytes are retained for recovery', async()=> {
 const f=await fixture(); await relocate(f); await fs.writeFile(f.source,'changed outside Cluster');
 assert.equal(await fs.readFile(f.target,'utf8'),'original bytes');
});
await check('Existing destination with different bytes is never overwritten or adopted', async()=> {
 const f=await fixture(); await fs.mkdir(path.dirname(f.target),{recursive:true}); await fs.writeFile(f.target,'a separate file');
 assert.equal(await relocate(f),'unresolved'); assert.equal(await fs.readFile(f.target,'utf8'),'a separate file'); assert.equal(f.persisted.fileName,f.item.fileName); assert.equal(f.claims,0);
});
await check('DB ownership collision denies relocation even if destination is absent', async()=> {
 const f=await fixture(); f.owned=true; assert.equal(await relocate(f),'unresolved'); assert.equal(f.claims,0); assert.equal(await fs.readFile(f.source,'utf8'),'original bytes');
});
await check('CAS conflict cleans an exclusively created destination without losing original', async()=> {
 const f=await fixture(); assert.equal(await relocate(f, {claim:async()=>false}),'unresolved');
 assert.equal(await fs.readFile(f.source,'utf8'),'original bytes'); await assert.rejects(fs.stat(f.target), {code:'ENOENT'});
});
await check('Uncertain CAS leaves both copies and safe retry adopts matching content', async()=> {
 const f=await fixture(); assert.equal(await relocate(f, {claim:async()=>{throw Error('uncertain commit');}}),'unresolved');
 assert.equal(await fs.readFile(f.source,'utf8'),'original bytes'); assert.equal(await fs.readFile(f.target,'utf8'),'original bytes');
 assert.equal(await relocate(f),'normalized'); assert.equal(f.persisted.fileName,'after/original.dat');
});
await check('Recovered historical rename with missing origin requires stored checksum', async()=> {
 const f=await fixture(); await fs.mkdir(path.dirname(f.target),{recursive:true}); await fs.rename(f.source,f.target);
 assert.equal(await relocate(f),'normalized'); assert.equal(f.persisted.fileName,'after/original.dat');
});
await check('Orphan destination with incorrect checksum cannot be adopted', async()=> {
 const f=await fixture(); await fs.mkdir(path.dirname(f.target),{recursive:true}); await fs.rename(f.source,f.target);
 await fs.writeFile(f.target,'tampered bytes'); assert.equal(await relocate(f),'unresolved'); assert.equal(f.persisted.fileName,f.item.fileName);
});
await check('Rejects symlink escape on destination parent', async()=> {
 const f=await fixture(); const outside=await fs.mkdtemp(path.join(temp,'outside-')); await fs.symlink(outside,path.join(f.root,'after'),'dir');
 assert.equal(await relocate(f),'unresolved'); assert.equal(await fs.readFile(f.source,'utf8'),'original bytes');
});
await check('Rejects source path escaping library root', async()=> {
 const f=await fixture(); f.item.fileName='../outside-secret'; assert.equal(await relocate(f),'unresolved');
});
await check('Rejects source through a symlink ancestor', async()=> {
 const f=await fixture(); const outside=await fs.mkdtemp(path.join(temp,'outside-')); await fs.writeFile(path.join(outside,'original.dat'),'secret');
 f.item.fileName='external/original.dat'; await fs.symlink(outside,path.join(f.root,'external'),'dir');
 assert.equal(await relocate(f),'unresolved');
});
await check('Rejects symlink source file', async()=> {
 const f=await fixture(); await fs.unlink(f.source); await fs.symlink(path.join(f.root,'before','other'),f.source);
 assert.equal(await relocate(f),'unresolved');
});
await check('Re-running with canonical pointer is a no-op', async()=> {
 const f=await fixture(); await relocate(f); assert.equal(await relocateLibraryStoredFile({root:f.root,item:f.persisted,directory:'after',...f.callbacks}),'already');
});
await check('Background worker scans in pages with authorization/disable/cancellation fences',async()=>{
 const code=readFileSync(path.join(root,'apps/server/src/domains/library/library-storage-jobs.ts'),'utf8');
 const scope={}; let registered=null; let batches=0; let progress=0; let fences=0; const records=Array.from({length:123},(_,i)=>({id:`item-${String(i).padStart(3,'0')}`,fileName:`f${i}`}));
 const prisma={libraryItem:{count:async()=>records.length,findMany:async({where,take})=>records.filter(v=>!where.id || v.id>where.id.gt).slice(0,take)}};
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:scope,require(spec){if(spec==='../../core/data-layout.js') return {reconcileLibraryStoredFiles:async(_p,_l,rows)=>{batches++;return {inspected:rows.length, normalized:rows.length,unresolved:0};}};throw Error(spec);}
 });
 scope.registerLibraryStorageReconciliationJob({worker:{register(_type,fn){registered=fn;}},prisma,dataLayout:{}});
 const answer=await registered({payload:{scope:'library'},updateProgress:async(n)=>{progress=n;},throwIfCancelled:async()=>{fences++;},throwIfToolUnavailable:async()=>{fences++;}});
 assert.equal(batches,3);assert.equal(answer.inspected,123);assert.equal(answer.normalized,123);assert.equal(answer.unresolved,0);assert.equal(fences,8);assert.ok(progress>0);
});
await check('Worker rejects forged scope and returns unresolved counts in job result',async()=>{
 const code=readFileSync(path.join(root,'apps/server/src/domains/library/library-storage-jobs.ts'),'utf8');
 const scope={}; let fn; vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports:scope,require(spec){if(spec==='../../core/data-layout.js')return {reconcileLibraryStoredFiles:async()=>({inspected:1,normalized:0,unresolved:1})};throw Error(spec);}
 });
 scope.registerLibraryStorageReconciliationJob({worker:{register(_t,f){fn=f;}},prisma:{libraryItem:{count:async()=>1,findMany:async({where})=>where.id?[]:[{id:'a',fileName:'a'}]}},dataLayout:{}});
 await assert.rejects(fn({payload:{scope:'other'}}));
 const answer=await fn({payload:{scope:'library'},updateProgress:async()=>{},throwIfCancelled:async()=>{},throwIfToolUnavailable:async()=>{}});
 assert.equal(answer.needsAttention,true);assert.equal(answer.unresolved,1);
});
await check('Job registered in tool-disable ownership and no synchronous bulk-move repair',async()=>{
 const routes=readFileSync(path.join(root,'apps/server/src/domains/library/library-routes.ts'),'utf8');
 const ownership=readFileSync(path.join(root,'apps/server/src/domains/jobs/job-tool-ownership.ts'),'utf8');
 const server=readFileSync(path.join(root,'apps/server/src/app/cluster-server.ts'),'utf8');
 const scheduler=readFileSync(path.join(root,'apps/server/src/domains/library/library-storage-scheduling.ts'),'utf8');
 assert.match(scheduler,/type: "library\.storage\.reconcile"/); assert.match(routes,/LIBRARY_BULK_MOVE_RECONCILIATION_QUEUED/);
 assert.match(routes,/scheduleCommittedLibraryStorageRepair\(jobQueue, context\.user\.id, "bulk-move"\)/);
 assert.match(routes,/\/api\/library\/storage\/reconciliation/); assert.match(routes,/ADMIN_REQUIRED/);
 assert.doesNotMatch(routes.slice(routes.indexOf('if (body.action === "move") {', routes.indexOf('    // The hierarchy mutation has committed.')), routes.indexOf('    if (!["move"')),/await reconcileLibraryStoredFiles\(/);
 assert.match(ownership,/"library\.storage\.reconcile"/); assert.match(server,/registerLibraryStorageReconciliationJob/);
});
await fs.rm(temp,{recursive:true,force:true});
console.log(`${passed}/${passed} R38 storage reconciliation checks passed`);
