import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[root,path.join(dirname(process.execPath),'../lib/node_modules'),'/usr/local/lib/node_modules']}));
const source=p=>readFileSync(path.join(root,p),'utf8');
const {auditLibraryOrphanFiles,canonicalLibraryStorageReference,LIBRARY_ORPHAN_AUDIT_LIMITS}=await import(pathToFileURL(path.join(root,'apps/server/src/domains/library/library-orphan-audit.ts')).href);
let total=0;async function test(name,fn){await fn();console.log('PASS '+name);total++;}
const base=mkdtempSync(path.join(os.tmpdir(),'cluster-r40-orphans-'));
const library=path.join(base,'Library');await fsp.mkdir(library);
const now=Date.now();const old=new Date(now-12*86400000);
async function file(name,age=old,bytes='bytes') {const target=path.join(library,name);await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.writeFile(target,bytes);await fsp.utimes(target,age,age);return target;}
try {
 await file('Library Index.json');await file('owned/current.dat');await file('version/old.dat');await file('derivatives/preview.dat');
 await file('unowned/aged.bin');await file('unowned/recent.bin',new Date(now-86400000));
 await file('unowned/.cluster-reconcile-abcd.tmp');
 const outside=await fsp.mkdtemp(path.join(base,'outside-'));await fsp.writeFile(path.join(outside,'secret'),'secret');
 await fsp.symlink(outside,path.join(library,'external'),'dir');
 const refs=new Set(['owned/current.dat','version/old.dat','derivatives/preview.dat'].map(v=>canonicalLibraryStorageReference(library,v)));
 await test('Read-only audit protects current, historical and derivative references; samples only aged candidates',async()=>{
   const result=await auditLibraryOrphanFiles({root:library,references:refs,now});
   assert.equal(result.protectedReferences,3);assert.equal(result.agedUnreferenced,1);assert.equal(result.recentUnreferenced,1);
   assert.equal(result.internalSkipped,2);assert.equal(result.symlinksSkipped,1);
   assert.equal(result.sample.length,1);assert.equal(result.sample[0].relativePath,'unowned/aged.bin');
   assert.equal(result.readOnly,true);assert.equal(result.destructiveActionsEnabled,false);assert.ok(result.warning.includes('not safe-to-delete'));
   assert.equal(fs.existsSync(path.join(library,'unowned/aged.bin')),true);
 });
 await test('Root containment denies traversal, absolute external paths and null bytes',async()=>{
   assert.equal(canonicalLibraryStorageReference(library,'../secret'),null);
   assert.equal(canonicalLibraryStorageReference(library,path.join(outside,'secret')),null);
   assert.equal(canonicalLibraryStorageReference(library,'bad\u0000name'),null);
 });
 await test('Audit fails closed when cancellation is requested',async()=>{
   await assert.rejects(auditLibraryOrphanFiles({root:library,references:refs,check:async()=>{throw Error('cancelled');}}),/cancelled/);
 });
 await test('Audit fails closed on excessive depth and never reports a partial inventory',async()=>{
   const pathChain=Array.from({length:LIBRARY_ORPHAN_AUDIT_LIMITS.depthLimit+2},()=> 'd').join('/');
   await file(`${pathChain}/nested.txt`);
   await assert.rejects(auditLibraryOrphanFiles({root:library,references:refs}),/maximum folder depth/);
   await fsp.rm(path.join(library,'d'),{recursive:true,force:true});
 });
 const compiled={};
 const jobs=source('apps/server/src/domains/library/library-orphan-jobs.ts');
 vm.runInNewContext(ts.transpileModule(jobs,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports:compiled,require(spec){if(spec==='./library-orphan-audit.js')return {auditLibraryOrphanFiles,canonicalLibraryStorageReference,LIBRARY_ORPHAN_AUDIT_LIMITS};throw Error(spec);}
 });
 function rows(values){return values.map((value,i)=>({id:`${String(i).padStart(4,'0')}`,value}));}
 function prisma(items,versions,derivatives){
  const result={};for(const [model,field,values] of [['libraryItem','fileName',items],['libraryVersion','fileName',versions],['libraryDerivative','storagePath',derivatives]]) {
   const data=rows(values);
   result[model]={findMany:async({where,take})=>data.filter(x=>!where.id||x.id>where.id.gt).slice(0,take).map(x=>({id:x.id,[field]:x.value}))};
  }return result;
 }
 await test('Reference collector paginates all three authoritative owner models',async()=>{
   const p=prisma(Array.from({length:1001},(_,i)=>`source/a${i}`),['versions/old'],['derivatives/p1']);
   const result=await compiled.collectLibraryStorageReferences(p,library,async()=>{});
   assert.equal(result.observed,1003);assert.equal(result.references.size,1003);
 });
 await test('Reference collector rejects oversize inventory rather than truncating',async()=>{
   const p=prisma([],[],[]);p.libraryItem.findMany=async()=>Array.from({length:LIBRARY_ORPHAN_AUDIT_LIMITS.referenceLimit+1},(_,i)=>({id:String(i),fileName:'one'}));
   await assert.rejects(compiled.collectLibraryStorageReferences(p,library,async()=>{}),/reference limit/);
 });
 await test('Background handler enforces cancellation/tool ownership and returns no deletion authority',async()=>{
   let handler;let checks=0;const p=prisma(['owned/current.dat'],['version/old.dat'],['derivatives/preview.dat']);
   compiled.registerLibraryOrphanAuditJob({worker:{register(type,fn){assert.equal(type,'library.storage.orphan-audit');handler=fn;}},prisma:p,dataLayout:{libraryRoot:library}});
   await assert.rejects(handler({payload:{scope:'wrong'}}),/Invalid Library/);
   const result=await handler({payload:{scope:'library'},throwIfCancelled:async()=>{checks++;},throwIfToolUnavailable:async()=>{checks++;},updateProgress:async()=>{}});
   assert.equal(result.readOnly,true);assert.equal(result.destructiveActionsEnabled,false);assert.equal(result.databaseReferencesInspected,3);assert.ok(checks>=4);
 });
 await test('Server routes gate audit submission and results behind administrator access',async()=>{
  const code=source('apps/server/src/domains/library/library-routes.ts');
  const endpoint=code.slice(code.indexOf('app.post("/api/library/storage/orphans/audit"'),code.indexOf('app.post("/api/library/bulk/preview"'));
  assert.match(endpoint,/requireLibraryTool\(request, reply, "edit"\)/);assert.match(endpoint,/requireLibraryTool\(request, reply, "view"\)/);
  assert.equal((endpoint.match(/authenticated\.decorated\?\.isAdmin/g)||[]).length,3); // R41 adds sampled-candidate review with the same admin fence
  assert.match(endpoint,/detail\.job\.type !== "library\.storage\.orphan-audit"/);
  assert.doesNotMatch(endpoint,/\b(?:unlink|rm|rmdir|deleteMany)\s*\(/);
 });
 await test('Registered as Library-owned durable job, wired into existing Worker, and surfaced to admins',async()=>{
   const ownership=source('apps/server/src/domains/jobs/job-tool-ownership.ts');
   const server=source('apps/server/src/app/cluster-server.ts');
   const ui=source('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
   assert.match(ownership,/"library\.storage\.orphan-audit"/);assert.match(server,/registerLibraryOrphanAuditJob\(/);
   assert.match(ui,/currentUser\.isAdmin \? <ClusterButton/);assert.match(ui,/storage\/orphans\/audit/);
   assert.doesNotMatch(ui,/Delete audit candidates/); // no destructive UI
 });
} finally {await fsp.rm(base,{recursive:true,force:true});}
console.log(`${total}/${total} TD4 R40 orphan-audit checks passed`);
