import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url);
const ts=require(require.resolve('typescript',{paths:[root,'/opt/nvm/versions/node/v22.16.0/lib/node_modules','/usr/local/lib/node_modules']}));
const source=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const audit=await import(pathToFileURL(path.join(root,'apps/server/src/domains/library/library-orphan-audit.ts')).href);
const reviewModule={};
const compiled=ts.transpileModule(source('apps/server/src/domains/library/library-orphan-review.ts'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(compiled,{exports:reviewModule,require(spec){if(spec==='./library-orphan-audit.js')return audit;return require(spec);},Date,console});
const {reviewLibraryOrphanCandidate}=reviewModule;
let cases=0;
async function test(label,fn){await fn();cases++;console.log('PASS '+label);}
const rootPath=await fsp.mkdtemp(path.join(os.tmpdir(),'cluster-r41-'));
const library=path.join(rootPath,'Library');await fsp.mkdir(library);
const old=new Date(Date.now()-14*86400000);
const filename=path.join(library,'unreferenced.dat');
await fsp.writeFile(filename,'source that must never be removed');await fsp.utimes(filename,old,old);
const stat=await fsp.stat(filename);
const sample={relativePath:'unreferenced.dat',sizeBytes:stat.size,modifiedAt:stat.mtime.toISOString()};
const base={root:library,sample,references:new Set(),activeLibraryJobs:0};
try {
 await test('Clean candidate remains read-only, without deletion authorization',async()=>{
  const reviewed=await reviewLibraryOrphanCandidate(base);
  assert.equal(reviewed.status,'requires_governance_review');assert.equal(reviewed.readOnly,true);
  assert.equal(reviewed.dispositionAllowed,false);assert.deepEqual([...reviewed.blockers],['RETENTION_AND_PROVENANCE_UNVERIFIED']);
  assert.equal(await fsp.readFile(filename,'utf8'),'source that must never be removed');
 });
 await test('Version/current/derivative references block a candidate even if its previous audit was clean',async()=>{
  const reviewed=await reviewLibraryOrphanCandidate({...base,references:new Set(['unreferenced.dat'])});
  assert.ok(reviewed.blockers.includes('LIBRARY_REFERENCE_APPEARED'));assert.equal(reviewed.status,'blocked');
 });
 await test('Queued/running Library writers prevent a clean evidence result',async()=>{
  const reviewed=await reviewLibraryOrphanCandidate({...base,activeLibraryJobs:1});
  assert.ok(reviewed.blockers.includes('LIBRARY_WORK_IN_PROGRESS'));
 });
 await test('Replaced file is detected and cannot be treated as the original audit sample',async()=>{
  await fsp.appendFile(filename,'changed');
  const reviewed=await reviewLibraryOrphanCandidate(base);
  assert.ok(reviewed.blockers.includes('FILE_CHANGED_SINCE_AUDIT'));
  await fsp.writeFile(filename,'source that must never be removed');await fsp.utimes(filename,old,old);
 });
 await test('Missing and symlink-replaced files are not trusted',async()=>{
  await fsp.rename(filename,`${filename}.saved`);
  assert.ok((await reviewLibraryOrphanCandidate(base)).blockers.includes('FILE_MISSING_OR_REDIRECTED'));
  await fsp.symlink(path.join(rootPath,'outside.txt'),filename);
  assert.ok((await reviewLibraryOrphanCandidate(base)).blockers.includes('FILE_MISSING_OR_REDIRECTED'));
  await fsp.rm(filename);await fsp.rename(`${filename}.saved`,filename);
 });
 await test('Newly modified candidates fail the minimum-age check',async()=>{
  const fresh=new Date();await fsp.utimes(filename,fresh,fresh);
  assert.ok((await reviewLibraryOrphanCandidate({...base,sample:{...sample,modifiedAt:fresh.toISOString()}})).blockers.includes('FILE_TOO_RECENT'));
  await fsp.utimes(filename,old,old);
 });
 await test('Sample path injection and parent symlinks are rejected',async()=>{
  assert.ok((await reviewLibraryOrphanCandidate({...base,sample:{...sample,relativePath:'../outside'}})).blockers.includes('INVALID_SAMPLE_PATH'));
  assert.ok((await reviewLibraryOrphanCandidate({...base,sample:{...sample,relativePath:'/tmp/outside'}})).blockers.includes('INVALID_SAMPLE_PATH'));
  await fsp.mkdir(path.join(rootPath,'external'));
  await fsp.symlink(path.join(rootPath,'external'),path.join(library,'linked'),'dir');
  assert.ok((await reviewLibraryOrphanCandidate({...base,sample:{...sample,relativePath:'linked/item'}})).blockers.includes('UNSAFE_OR_CHANGED_DIRECTORY'));
 });
 await test('Legacy destruction primitive is fail-closed and cannot delete metadata',async()=>{
  const {prepareLibraryDestruction}=await import(pathToFileURL(path.join(root,'apps/server/src/domains/library/library-destruction.ts')).href);
  const tx={libraryItem:{deleteMany:async()=>{throw Error('unsafe deletion');}},activityEvent:{create:async()=>{throw Error('unsafe evidence');}}};
  const result=await prepareLibraryDestruction(tx,'item',8,'Test',false,'administrator',()=>({eligible:true,code:'ELIGIBLE'}));
  assert.equal(result.error.code,'LIBRARY_DISPOSITION_REVIEW_REQUIRED');
  assert.equal(fs.existsSync(filename),true);
 });
 await test('Route restricts reviews to admins and completed audited sample IDs, not arbitrary paths',async()=>{
  const routes=source('apps/server/src/domains/library/library-routes.ts');
  const start=routes.indexOf('app.post("/api/library/storage/orphans/audit/:jobId/review"');
  const end=routes.indexOf('app.post("/api/library/bulk/preview"',start);
  const block=routes.slice(start,end);
  assert.ok(start>0);assert.match(block,/authenticated\.decorated\?\.isAdmin/);
  assert.match(block,/job\.status !== "SUCCEEDED"/);assert.match(block,/CANDIDATE_NOT_IN_AUDIT/);
  assert.match(block,/collectLibraryStorageReferences/);assert.match(block,/activeLibraryJobs/);
  assert.doesNotMatch(block,/fs\.(?:unlink|rm|rename)\(/);
  assert.doesNotMatch(routes,/app.delete\("\/api\/library\/:itemId\/permanent"/);
  assert.match(routes,/app.post\("\/api\/library\/:itemId\/disposition"/);
 });
 await test('Library UI exposes candidate recheck, never destructive controls',async()=>{
  const ui=source('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
  assert.match(ui,/reviewOrphanSample/);assert.match(ui,/Recheck evidence/);assert.match(ui,/no deletion or quarantine is authorized/);
 });
} finally {await fsp.rm(rootPath,{force:true,recursive:true});}
console.log(`${cases}/${cases} R41 disposition-review checks passed`);
