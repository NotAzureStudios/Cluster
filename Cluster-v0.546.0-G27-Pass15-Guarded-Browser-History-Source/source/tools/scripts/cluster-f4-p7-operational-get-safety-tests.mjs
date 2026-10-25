import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
let count=0;const yes=(v,m)=>{assert.ok(v,m);count++};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);count++};
const source=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-health-operations.ts'),'utf8');
const render=fs.readFileSync(path.join(root,'packages/renderer/src/features/operations/modules/operations-admin.tsx'),'utf8');
const runtime=fs.readFileSync(path.join(root,'apps/server/src/core/runtime-access-state.ts'),'utf8');
const compiled=ts.transpileModule(runtime,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p7-'));
try {
 fs.writeFileSync(path.join(tmp,'runtime.cjs'),compiled.outputText);
 const {runtimeRequestDecision:decide}=require(path.join(tmp,'runtime.cjs'));
 for(const mode of ['normal','maintenance','read-only','recovery']) {
  for(const p of ['/api/admin/operations/storage-lifecycle','/api/admin/operations/integrity']) {
   eq(decide({mode,method:'GET',pathname:p}).allowed,true,`${mode} diagnostic read ${p}`);
  }
  for(const p of ['/api/admin/operations/storage-lifecycle/run','/api/admin/operations/integrity/refresh']){
   eq(decide({mode,method:'POST',pathname:p}).allowed,mode==='normal',`${mode} explicitly mutating ${p}`);
  }
 }
 const lifecycleGET=source.slice(source.indexOf('app.get("/api/admin/operations/storage-lifecycle"'),source.indexOf('app.post("/api/admin/operations/storage-lifecycle/run"'));
 const integrityGET=source.slice(source.indexOf('app.get("/api/admin/operations/integrity"'),source.indexOf('app.post("/api/admin/operations/integrity/refresh"'));
 const lifecyclePOST=source.slice(source.indexOf('app.post("/api/admin/operations/storage-lifecycle/run"'),source.indexOf('app.get("/api/admin/operations/integrity"'));
 const integrityPOST=source.slice(source.indexOf('app.post("/api/admin/operations/integrity/refresh"'),source.indexOf('app.get("/api/admin/operations/health-transitions"'));
 for(const [name,span,unsafe] of [['lifecycle',lifecycleGET,'storageLifecycleRuntime.run()'],['integrity',integrityGET,'dataIntegrityRuntime.scan(']]){
  yes(span.length>200,`${name} GET registered`);
  yes(span.includes('requireAdminUserForRequest(request, reply)'),`${name} GET admin only`);
  yes(span.includes('z.object({}).strict().parse(request.query || {})'),`${name} GET rejects query-trigger flags`);
  yes(span.includes('Cache-Control", "no-store"'),`${name} no-store`);
  eq(span.includes(unsafe),false,`${name} GET no hidden mutator`);
 }
 for(const [name,span,confirmation,unsafe] of [['lifecycle',lifecyclePOST,'RUN STORAGE LIFECYCLE','storageLifecycleRuntime.run()'],['integrity',integrityPOST,'REFRESH INTEGRITY EVIDENCE','dataIntegrityRuntime.scan(true)']]){
  yes(span.length>250,`${name} POST registered`);
  yes(span.includes('requireAdminUserForRequest(request, reply)'),`${name} POST admin only`);
  yes(span.includes(`z.literal("${confirmation}")`),`${name} confirmation required`);
  yes(span.includes(unsafe),`${name} explicit mutator preserved`);
  yes(span.includes('Cache-Control", "no-store"'),`${name} no-store`);
 }
 yes(render.includes('/api/admin/operations/storage-lifecycle/run'), 'Storage UI calls new POST');
 yes(render.includes('confirmation: "RUN STORAGE LIFECYCLE"'), 'Storage UI confirmation matches server');
 yes(render.includes('confirmCluster({ title: "Run storage lifecycle check?"'), 'Storage UI asks before mutation');
 yes(render.includes('/api/admin/operations/integrity/refresh'), 'Integrity UI calls POST');
 yes(render.includes('confirmation: "REFRESH INTEGRITY EVIDENCE"'), 'Integrity UI confirmation matches server');
 eq(render.includes('operations/storage-lifecycle?run=true'),false,'No unsafe GET in UI');
 eq(render.includes('operations/integrity?refresh=true'),false,'No mutating scan GET in UI');
 console.log(`${count}/${count} F4 P7 held-mode GET safety assertions passed`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
