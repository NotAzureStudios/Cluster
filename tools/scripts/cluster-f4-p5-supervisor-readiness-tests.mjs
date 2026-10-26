import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'apps/server/src/core/operations-supervisor-readiness.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p5-'));
let n=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};const ok=(v,m)=>{assert.ok(v,m);n++};
try {
 fs.writeFileSync(path.join(dir,'supervisor.cjs'),compiled.outputText);
 const {supervisorReadiness:check}=require(path.join(dir,'supervisor.cjs'));
 const base=(o={})=>({serverReady:true,draining:false,mode:'normal',database:{ok:true},storage:{ok:true},...o});
 for(const mode of ['normal','maintenance','read-only','recovery']){
  const r=check(base({mode}));
  eq(r.ready,true,mode+' healthy service');
  eq(r.ok,true,mode+' ok');
  eq(r.state,mode,mode+' state');
  eq(r.mode,mode,mode+' mode');
  eq(r.acceptsMutations,mode==='normal',mode+' write availability');
  eq(r.workspaceAvailable,mode==='normal'||mode==='read-only',mode+' workspace admission');
  eq(r.dependencies,{database:true,storage:true},mode+' independent dependencies');
  eq(r.contract,'cluster-supervisor-readiness-v1',mode+' contract');
 }
 for(const [o,code] of [
  [{draining:true},'draining'],[{serverReady:false},'starting'],
  [{database:{ok:false}},'dependency-unavailable'],[{storage:{ok:false}},'dependency-unavailable'],
  [{database:null},'dependency-unavailable'],[{storage:null},'dependency-unavailable'],
  [{database:undefined},'dependency-unavailable'],[{storage:undefined},'dependency-unavailable'],
 ]){
  for(const mode of ['normal','maintenance','recovery']){
   const r=check(base({...o,mode}));
   eq(r.ready,false,code+' '+mode+' blocked');
   eq(r.state,code,code+' '+mode+' state');
   eq(r.workspaceAvailable,false,code+' '+mode+' workspace false');
   eq(r.acceptsMutations,false,code+' '+mode+' mutating false');
  }
 }
 const routes=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-health-operations.ts'),'utf8');
 const loc=routes.indexOf('app.get("/health/supervisor"');
 ok(loc>0,'supervisor route exists');
 const route=routes.slice(loc,routes.indexOf('app.get("/health/ready"',loc));
 for(const needle of ['Cache-Control", "no-store"','Promise.allSettled','supervisorReadiness(','deps.getRuntimeMode()','deps.serverDraining','deps.serverReady','reply.code(503)'])ok(route.includes(needle),'supervisor route '+needle);
 const infra=fs.readFileSync(path.join(root,'apps/server/src/core/runtime-access-state.ts'),'utf8');
 ok(infra.includes('path.startsWith("/health/")'),'held-server allows supervisor route');
 const hostProbe=fs.readFileSync(path.join(root,'apps/host-go/api_process.go'),'utf8');
 const watch=fs.readFileSync(path.join(root,'apps/host-go/native_readiness_watch.go'),'utf8');
 const launcher=fs.readFileSync(path.join(root,'apps/server-launcher-go/network_preflight.go'),'utf8');
 ok(hostProbe.includes('h.apiOrigin+"/health/supervisor"'),'Host boot checks supervisor');
 ok(watch.includes('origin+"/health/supervisor"'),'watch uses supervisor');
 ok(launcher.includes('"/health/ready"'),'panel still distinguishes workspace readiness');
 const original=routes.slice(routes.indexOf('app.get("/health/ready"'),routes.indexOf('app.get("/api/admin/operations/maintenance/preflight"'));
 ok(original.includes('reply.code(503)'),'workspace readiness still returns 503 under hold');
 console.log(`${n}/${n} F4 P5 supervisor readiness and maintenance boot tests passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
