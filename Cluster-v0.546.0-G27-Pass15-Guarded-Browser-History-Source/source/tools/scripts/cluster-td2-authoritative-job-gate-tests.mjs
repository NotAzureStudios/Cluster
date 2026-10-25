import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');
function loadTs(file, stubs = {}) {
  const compiled = ts.transpileModule(read(file), {fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const mod={exports:{}};
  new Function('require','module','exports',compiled.outputText)((name) => {
    if (Object.hasOwn(stubs,name)) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw Error('Unmocked '+name+' in '+file);
  },mod,mod.exports);
  return mod.exports;
}
const types = loadTs('apps/server/src/domains/jobs/job-types.ts', {'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js':{runWithReliabilityContext:(_ctx,work)=>work()},
  './job-types.js':types,
  './job-queue-service.js':{ BackgroundJobQueue:class{} },
});
const policy = loadTs('apps/server/src/domains/jobs/job-tool-ownership.ts');
const {TOOL_AVAILABILITY} = loadTs('apps/server/src/domains/access/configurable-tool-availability.ts');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const job = type => ({id:'j1',type,payload:'{}',attempts:1,maxAttempts:5,workspaceId:null,correlationId:null,createdById:null});
async function scenario(type, verify, setup = {}) {
  let claims=0, executed=0, deferred=0, failed=0, succeeded=0, verified=0;
  const queue={
    claim:async()=>++claims===1?job(type):null,
    cancellationRequested:async()=>false,
    deferDisabled:async()=>{deferred++;return true;},
    updateProgress:async()=>{}, heartbeat:async()=>true,
    succeed:async()=>{succeeded++;}, fail:async()=>{failed++;},
  };
  const worker = new DurableJobWorker(queue,{concurrency:1, leaseMs:60_000, blockedTypes:()=>[],
    verifyExecutionAvailability: async (name)=>{verified++;return verify(name);}});
  worker.register(type,async()=>{executed++;});
  if(setup.authorizer) {
    worker.setExecutionAuthorizer(async()=>({allowed:true}));
    queue.claim=async()=>++claims===1?{...job(type),payload:JSON.stringify({[types.BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY]:{actorUserId:'tester'}})}:null;
  }
  await worker.runBatch();
  for(let i=0;i<40 && worker.snapshot().running;i++) await sleep(5);
  assert.equal(worker.snapshot().running,0);
  worker.stop();
  return {claims,executed,deferred,failed,succeeded,verified};
}
let checks=0;
async function check(label,fn){await fn();checks++;console.log('PASS',label)}
await check('policy uses canonical tool availability keys and only enrolled job types', async()=>{
  assert.equal(TOOL_AVAILABILITY.library.flag,'libraryEnabled');
  assert.equal(TOOL_AVAILABILITY.calendar.flag,'calendarEnabled');
  assert.equal(policy.studioToolForDurableJobType('library.transfer.finalize'),'library');
  assert.equal(policy.studioToolForDurableJobType('automation.calendar-scan'),'calendar');
  assert.equal(policy.studioToolForDurableJobType('system.job-history-prune'),null);
});
for (const type of ['automation.calendar-scan','library.transfer.finalize','library.derivative.build']) {
  await check(`stale process-local enabled state defers freshly disabled ${type}`, async()=>{
    const result=await scenario(type,async()=>false);
    assert.deepEqual({executed:result.executed,deferred:result.deferred,failed:result.failed,succeeded:result.succeeded,verified:result.verified},
      {executed:0,deferred:1,failed:0,succeeded:0,verified:1});
  });
}
await check('fresh available tool runs a preserved job successfully',async()=>{
  const result=await scenario('library.derivative.build',async()=>true);
  assert.equal(result.executed,1);assert.equal(result.succeeded,1);assert.equal(result.deferred,0);
});
await check('async authorization runs before the fresh availability gate',async()=>{
  const result=await scenario('library.derivative.build',async()=>false,{authorizer:true});
  assert.equal(result.verified,1);assert.equal(result.executed,0);assert.equal(result.deferred,1);
});
await check('runtime receives DB-backed read callback instead of reading stale cached settings',async()=>{
  const runtime=read('apps/server/src/app/server-job-runtime.ts');
  const composition=read('apps/server/src/app/server-automation-job-runtime.ts');
  const server=read('apps/server/src/app/cluster-server.ts');
  assert.match(runtime,/studioToolForDurableJobType\(type\)/);
  assert.match(runtime,/await input\.readSettings\(true\)/);
  assert.match(runtime,/current\[TOOL_AVAILABILITY\[owner\]\.flag\] !== false/);
  assert.match(runtime,/return false; \/\/ Uncertain policy/);
  assert.match(composition,/readSettings: input\.readSettings/);
  assert.match(server,/readSettings: \(force\) => readSettings\(force\)/);
  assert.match(read('apps/server/src/domains/jobs/job-worker.ts'),/verifyExecutionAvailability\(job\.type\)/);
});
await check('server runtime gate reads authoritative DB truth and fails closed without blocking shared maintenance',async()=>{
  let workerOptions;
  class StubWorker {
    constructor(_queue,options){workerOptions=options;}
    register(){return this;}
  }
  const {createServerJobRuntime}=loadTs('apps/server/src/app/server-job-runtime.ts',{
    '../domains/jobs/job-queue-service.js':{BackgroundJobQueue:class{},subscribeBackgroundJobQueueWake:()=>()=>{}},
    '../domains/jobs/job-worker.js':{DurableJobWorker:StubWorker},
    '../domains/jobs/job-types.js':types,
    '../domains/jobs/job-tool-ownership.js':policy,
    '../domains/access/configurable-tool-availability.js':{TOOL_AVAILABILITY},
  });
  const requests=[];
  let settings={calendarEnabled:false,libraryEnabled:false};
  const logs=[];
  createServerJobRuntime({
    prisma:{},logger:{info:()=>{},warn:(...args)=>logs.push(args),error:()=>{}},
    backgroundTasks:{isOwnerEnabled:()=>true},
    readSettings:async(force)=>{requests.push(force);if(settings instanceof Error)throw settings;return settings;},
    projectAutomation:{},studioAutomation:{},
    queue:{},
  });
  const gate=workerOptions.verifyExecutionAvailability;
  assert.equal(await gate('automation.calendar-scan'),false);
  assert.equal(await gate('library.derivative.build'),false);
  assert.equal(await gate('library.transfer.finalize'),false);
  assert.deepEqual(requests,[true,true,true]);
  // No DB query for critical shared jobs; they have no Tool Configuration owner.
  assert.equal(await gate('notifications.digest-scan'),true);
  assert.equal(await gate('system.job-history-prune'),true);
  assert.equal(requests.length,3);
  settings={calendarEnabled:true,libraryEnabled:true};
  assert.equal(await gate('automation.calendar-scan'),true);
  assert.equal(await gate('library.transfer.finalize'),true);
  settings=new Error('Database unavailable');
  assert.equal(await gate('library.derivative.build'),false);
  assert.ok(logs.some(([payload])=>payload.owner==='library'));
  assert.ok(requests.every(Boolean));
});
await check('non-tool jobs remain unowned and are not blocked by tool availability',async()=>{
  assert.equal(policy.studioToolForDurableJobType('notifications.digest-scan'),null);
  assert.equal(policy.studioToolForDurableJobType('system.job-history-prune'),null);
});
console.log(`${checks}/${checks} TD2 authoritative execution gate checks passed`);
