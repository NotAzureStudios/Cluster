import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root = path.resolve(import.meta.dirname, '../..');
const source = fs.readFileSync(path.join(root,'apps/server/src/core/operations-maintenance-preflight.ts'),'utf8');
const t = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(t.diagnostics.filter(d=>d.category === ts.DiagnosticCategory.Error).length,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p4-'));
let assertions=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);assertions++;};
const yes=(actual,message)=>{assert.ok(actual,message);assertions++;};
try {
 fs.writeFileSync(path.join(dir,'preflight.cjs'),t.outputText);
 const {evaluateMaintenancePreflight: check}=require(path.join(dir,'preflight.cjs'));
 const now=Date.parse('2026-10-23T17:00:00.000Z');
 const baseline=(changes={})=>({intent:'restart',mode:'normal',ready:true,draining:false,
   database:{ok:true,checkedAt:new Date(now).toISOString()},storage:{ok:true,checkedAt:new Date(now).toISOString()},
   tasks:[],jobs:{running:0},work:{heavyInFlight:0,criticalInFlight:0},window:{enabled:false,active:false,nextStartAt:null},recovery:{ok:true,state:'ready',generatedAt:new Date(now).toISOString(),checks:{instanceIdentityPresent:true,generationPresent:true,generationMatchesInstance:true,completeSchema:true,verificationPassed:true,restoreDrillPassed:true,latestGenerationVerified:true,backupFresh:true,drillFresh:true,secretKeyAvailable:true}},now,...changes});
 for(const intent of ['enter-maintenance','enter-read-only','restart','update']){
   const result=check(baseline({intent}));
   eq(result.ok,true,`${intent} clean evidence`);
   eq(result.executable,false,`${intent} cannot authorize execution`);
   eq(result.intent,intent,`${intent} preserved`);
   eq(result.blockers.length,0,`${intent} no blockers`);
   yes(result.warnings.length>0,`${intent} warning`);
   yes(result.note.includes('No mode change'),`${intent} no side effects documented`);
   eq(result.checkedAt,new Date(now).toISOString(),`${intent} time`);
 }
 const failures=[
   [{draining:true},'ALREADY_DRAINING'],
   [{ready:false},'NOT_READY'],
   [{mode:'maintenance'},'RUNTIME_HELD'],
   [{mode:'read-only'},'RUNTIME_HELD'],
   [{mode:'recovery'},'RUNTIME_HELD'],
   [{database:null},'DATABASE_UNVERIFIED'],
   [{storage:null},'STORAGE_UNVERIFIED'],
   [{database:{ok:false,checkedAt:new Date(now).toISOString()}},'DATABASE_UNHEALTHY'],
   [{storage:{ok:false,checkedAt:new Date(now).toISOString()}},'STORAGE_UNHEALTHY'],
   [{database:{ok:true}},'DATABASE_STALE'],
   [{storage:{ok:true}},'STORAGE_STALE'],
   [{database:{ok:true,checkedAt:new Date(now-60001).toISOString()}},'DATABASE_STALE'],
   [{storage:{ok:true,checkedAt:new Date(now-60001).toISOString()}},'STORAGE_STALE'],
   [{database:{ok:true,checkedAt:new Date(now+5001).toISOString()}},'DATABASE_STALE'],
   [{storage:{ok:true,checkedAt:new Date(now+5001).toISOString()}},'STORAGE_STALE'],
   [{tasks:null},'TASKS_UNVERIFIED'],
   [{tasks:Array.from({length:2001},(_,i)=>({name:'task-'+i,running:false,workloadClass:'maintenance'}))},'TASKS_UNBOUNDED'],
   [{tasks:[{name:'backup',running:true,workloadClass:'maintenance'}]},'TASKS_RUNNING'],
   [{jobs:null},'JOBS_UNVERIFIED'],
   [{jobs:{running:-1}},'JOBS_UNVERIFIED'],
   [{jobs:{running:NaN}},'JOBS_UNVERIFIED'],
   [{jobs:{running:1.2}},'JOBS_UNVERIFIED'],
   [{jobs:{running:2}},'JOBS_RUNNING'],
   [{work:null},'WORK_UNVERIFIED'],
   [{work:{heavyInFlight:-1,criticalInFlight:0}},'WORK_UNVERIFIED'],
   [{work:{heavyInFlight:0.2,criticalInFlight:0}},'WORK_UNVERIFIED'],
   [{work:{heavyInFlight:1,criticalInFlight:0}},'REQUESTS_IN_FLIGHT'],
   [{work:{heavyInFlight:0,criticalInFlight:1}},'REQUESTS_IN_FLIGHT'],
 ];
 for(const [change,code] of failures){
  const result=check(baseline(change));
  eq(result.ok,false,`${code} must block`);
  yes(result.blockers.some(b=>b.code===code),`${code} explanation`);
 }
 const active=check(baseline({tasks:Array.from({length:15},(_,i)=>({name:'x-'+i,running:true,workloadClass:'background'}))}));
 eq(active.observed.runningTasks,15,'running tasks count untruncated');
 yes(active.blockers.some(x=>x.code==='TASKS_RUNNING'),'running tasks block');
 yes(active.warnings.some(x=>x.code==='BACKGROUND_WORKERS'),'worker warning');
 yes(active.blockers.find(x=>x.code==='TASKS_RUNNING').detail.includes('10+'),'bounded task evidence');
 const limit=check(baseline({database:{ok:true,checkedAt:new Date(now-60000).toISOString()},storage:{ok:true,checkedAt:new Date(now+5000).toISOString()}}));
 eq(limit.ok,true,'boundary freshness accepted');
 const multi=check(baseline({database:null,storage:null,jobs:null,work:null,tasks:null,draining:true}));
 yes(multi.blockers.length>=6,'missing evidence collects multiple independent blockers');
 eq(multi.executable,false,'missing evidence never executable');
 assert.throws(()=>check(baseline({now:NaN})),/clock/);assertions++;
 // Real integration contracts. Keep only fixed local preflight inputs; no arbitrary
 // URLs, remote fetching, job cancellation or mode mutation in the endpoint.
 const endpoint=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-health-operations.ts'),'utf8');
 const route=endpoint.slice(endpoint.indexOf('app.get("/api/admin/operations/maintenance/preflight"'),endpoint.indexOf('app.get("/api/admin/operations/health"'));
 for(const part of [
  'requireAdminUserForRequest(request, reply)','z.enum(["enter-maintenance", "enter-read-only", "restart", "update"])',
  'Cache-Control", "no-store"', 'Promise.allSettled','readinessProbe.check(true)',
  'deps.writableStorageProbe.check(true)','deps.jobQueue.counts(true)',
  'backgroundTasks.snapshots()','concurrentWorkLimiter.stats()','evaluateMaintenancePreflight('
 ])yes(route.includes(part),`endpoint contract: ${part}`);
 for(const bad of ['fetchWithTimeout(','.stopAll(','.shutdown(','.restart(','.update(','.executeRaw('])eq(route.includes(bad),false,`preflight must not ${bad}`);
 const server=fs.readFileSync(path.join(root,'apps/server/src/app/cluster-server.ts'),'utf8');
 yes(server.includes('getRuntimeMode: () => SERVER_RUNTIME_MODE'),'real server passes runtime mode');
 const ui=fs.readFileSync(path.join(root,'packages/renderer/src/features/settings/ServerConfigPage.tsx'),'utf8');
 for(const phrase of ['Maintenance transition preflight','previewMaintenance()','maintenance/preflight?intent=', 'executable: false', 'does not initiate a restart or mode change'])yes(ui.includes(phrase),`UI uses preview only ${phrase}`);
 console.log(`${assertions}/${assertions} F4 P4 maintenance preflight tests passed`);
} finally{fs.rmSync(dir,{recursive:true,force:true});}
