import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const text=fs.readFileSync(path.join(root,'apps/server/src/core/operations-background-mode.ts'),'utf8');
const result=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p6-'));
let n=0;
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};const ok=(b,m)=>{assert.ok(b,m);n++};
try {
 fs.writeFileSync(path.join(temp,'gate.cjs'),result.outputText);
 const {mayRunBackgroundMutation:gate}=require(path.join(temp,'gate.cjs'));
 for(const mode of ['normal','read-only','maintenance','recovery']){
  for(const ready of [true,false]){
   for(const draining of [true,false]){
    eq(gate({mode,ready,draining}),mode==='normal' && ready && !draining,`${mode}/${ready}/${draining}`);
   }
  }
 }
 const server=fs.readFileSync(path.join(root,'apps/server/src/app/cluster-server.ts'),'utf8');
 ok(server.includes('import { mayRunBackgroundMutation }'),'core gate imported');
 ok(server.includes('function backgroundMutationPermitted()'),'real centralized gate');
 for(const name of ['distributed-rate-limit-prune','data-integrity-reconcile','storage-lifecycle','storage-browser-upload-probe']){
  const start=server.indexOf(`backgroundTasks.scheduleAdaptive("${name}"`);
  ok(start>0,`existing task ${name} remains registered`);
  const section=server.slice(start,start+650);
  ok(section.includes('if (!backgroundMutationPermitted()) return { nextDelayMs'),`task ${name} held-mode gate`);
  const guard=section.indexOf('if (!backgroundMutationPermitted())');
  const action=(name==='distributed-rate-limit-prune'?'distributedRateLimiter.prune()':name==='data-integrity-reconcile'?'dataIntegrityRuntime.scan()':name==='storage-lifecycle'?'storageLifecycleRuntime.run()':'storageRuntime.browserDirectUploadCapability(WEB_ORIGIN)');
  ok(section.includes(action),`${name} unchanged implementation`);
  ok(guard>=0 && guard<section.indexOf(action),`${name} guarded BEFORE write`);
 }
 ok(server.includes('if (backgroundMutationPermitted()) {'),'dependency incident writes gated');
 ok((server.match(/if \(!backgroundMutationPermitted\(\)\) return \{ nextDelayMs \};/g)||[]).length>=3,'incident and integrity recurring loops gated');
 const original=fs.readFileSync(path.join(root,'apps/server/src/core/runtime-access-state.ts'),'utf8');
 ok(original.includes('if (input.mode === "maintenance")'),'request fence preserved');
 ok(original.includes('if (input.mode === "read-only")'),'readonly request fence preserved');
 console.log(`${n}/${n} F4 P6 held-background-mutation fence tests passed`);
} finally{fs.rmSync(temp,{recursive:true,force:true})}
