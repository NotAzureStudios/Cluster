import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(), 'typescript','lib','typescript.js')); } })();
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
function loadTs(file, stubs = {}) {
  const compiled = ts.transpileModule(read(file), {fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const module = {exports:{}};
  const localRequire = name => name in stubs ? stubs[name] : name.startsWith('node:') ? require(name) : (() => { throw Error(`Unmocked import ${name} from ${file}`); })();
  new Function('require','module','exports',compiled.outputText)(localRequire,module,module.exports);
  return module.exports;
}
const policy = loadTs('apps/server/src/domains/jobs/job-tool-ownership.ts');
const jobTypes = loadTs('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': {lifecycleTransitionMap: () => ({}),assertLifecycleTransition:()=>{}},
});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': {runWithReliabilityContext: (_ctx, fn) => fn()},
  './job-types.js': jobTypes,
  './job-queue-service.js': {BackgroundJobQueue: class {}},
});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const job = (type,id='job-1') => ({id,type,payload:'{}',attempts:1,maxAttempts:5,correlationId:null,causationId:null,workspaceId:null,createdById:null});
let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log('PASS',label); }

await check('only explicitly owned Calendar and Library durable jobs are paused', () => {
  assert.deepEqual(Object.keys(policy.STUDIO_TOOL_DURABLE_JOB_TYPES).sort(), ['calendar','library']);
  const disabled = new Set(['library']);
  assert.deepEqual(policy.disabledStudioToolJobTypes(owner => !disabled.has(owner)).sort(), ['library.bulk.metadata','library.derivative.build','library.hierarchy.lifecycle','library.hierarchy.move','library.storage.orphan-audit','library.storage.reconcile','library.transfer.finalize']);
  disabled.add('calendar');
  assert.deepEqual(policy.disabledStudioToolJobTypes(owner => !disabled.has(owner)).sort(), ['automation.calendar-scan','library.bulk.metadata','library.derivative.build','library.hierarchy.lifecycle','library.hierarchy.move','library.storage.orphan-audit','library.storage.reconcile','library.transfer.finalize','studio.calendar-owner-reminders']);
  assert.equal(policy.studioToolForDurableJobType('studio.calendar-owner-reminders'), 'calendar');
  assert.equal(policy.studioToolForDurableJobType('library.transfer.finalize'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.derivative.build'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.bulk.metadata'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.hierarchy.move'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.hierarchy.lifecycle'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.storage.orphan-audit'), 'library');
  assert.equal(policy.studioToolForDurableJobType('library.storage.reconcile'), 'library');
  assert.equal(policy.studioToolForDurableJobType('system.job-history-prune'), null);
  assert.equal(policy.studioToolForDurableJobType('studio.knowledge-lifecycle'), null);
});
await check('all Library job type handlers actually exist and use the registered ownership names', () => {
  const source = read('apps/server/src/domains/library/library-9e2-jobs.ts') + read('apps/server/src/domains/library/library-bulk-jobs.ts') + read('apps/server/src/domains/library/library-hierarchy-move.ts') + read('apps/server/src/domains/library/library-hierarchy-lifecycle.ts') + read('apps/server/src/domains/library/library-storage-jobs.ts') + read('apps/server/src/domains/library/library-orphan-jobs.ts');
  for (const type of policy.STUDIO_TOOL_DURABLE_JOB_TYPES.library) assert.ok(source.includes(`register("${type}"`),type);
  assert.match(read('apps/server/src/app/server-job-runtime.ts'),/disabledStudioToolJobTypes\(\(tool\) => input\.backgroundTasks\.isOwnerEnabled\(tool\)\)/);
  assert.match(read('apps/server/src/app/cluster-server.ts'),/reconcileToolAvailability\(bootToolSettings\)/);
  assert.match(read('apps/server/src/app/server-job-runtime.ts'),/pausedOwnedJobTypes: blockedOwnedTypes\(\)/);
});
await check('disabled Library jobs are excluded by queue claim before any attempt is started', async () => {
  let excluded;
  const queue = {claim:async (_worker,_lease,_queues,_concurrency,_budget,blocked) => {excluded=blocked;return null;}};
  const worker = new DurableJobWorker(queue,{concurrency:1,blockedTypes:()=>policy.disabledStudioToolJobTypes(tool => tool!=='library')});
  await worker.runBatch();
  assert.deepEqual(worker.snapshot().blockedTypes.slice().sort(), ['library.bulk.metadata','library.derivative.build','library.hierarchy.lifecycle','library.hierarchy.move','library.storage.orphan-audit','library.storage.reconcile','library.transfer.finalize']);
  assert.deepEqual(excluded.sort(), ['library.bulk.metadata','library.derivative.build','library.hierarchy.lifecycle','library.hierarchy.move','library.storage.orphan-audit','library.storage.reconcile','library.transfer.finalize']);
  worker.stop();
});
for (const type of policy.STUDIO_TOOL_DURABLE_JOB_TYPES.library) {
  await check(`${type} claimed just before disable is deferred without running its handler`, async () => {
    let disabled = false, claims = 0, deferred = 0, executed = 0;
    const queue = {
      claim:async()=>{claims++;if(claims>1)return null;disabled=true;return job(type);},
      deferDisabled:async()=>{deferred++;return 'DEFERRED';},
    };
    const worker = new DurableJobWorker(queue,{concurrency:1,blockedTypes:()=>policy.disabledStudioToolJobTypes(tool=>!(tool==='library'&&disabled))});
    worker.register(type, async()=>{executed++;});
    assert.equal(await worker.runBatch(),1);
    await wait(10);
    assert.equal(executed,0);
    assert.equal(deferred,1);
    assert.equal(worker.snapshot().deferred,1);
    worker.stop();
  });
}
await check('disable during async pre-handler authorization defers Library job without executing handler', async () => {
  let disabled = false, claims=0, executed=0, deferred=0, succeeded=0, failed=0;
  const queue={
    claim:async()=>++claims===1?job('library.derivative.build'):null,
    cancellationRequested:async()=>false,
    deferDisabled:async()=>{deferred++;return 'DEFERRED';},
    updateProgress:async()=>{},
    heartbeat:async()=>true,
    succeed:async()=>{succeeded++;},
    fail:async()=>{failed++;},
  };
  const worker=new DurableJobWorker(queue,{concurrency:1,blockedTypes:()=>policy.disabledStudioToolJobTypes(tool=>!(tool==='library'&&disabled))});
  worker.setExecutionAuthorizer(async()=>{disabled=true;return {allowed:true};});
  worker.register('library.derivative.build',async()=>{executed++;});
  const authorizedPayload = {[jobTypes.BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY]:{actorUserId:'a',action:'view',tool:'library',resource:{kind:'target',targetKind:'library',targetId:'item',projectId:null}}};
  queue.claim=async()=>++claims===1?{...job('library.derivative.build'),payload:JSON.stringify(authorizedPayload)}:null;
  await worker.runBatch();await wait(20);
  assert.deepEqual({executed,deferred,succeeded,failed},{executed:0,deferred:1,succeeded:0,failed:0});
  worker.stop();
});
await check('re-enabled Library claims and executes preserved work, independent work remains runnable',async()=>{
  let disabled=true,claimCount=0,ran=0,succeeded=0;
  const queue={claim:async (_w,_lease,_queues,_wc,_budget,blocked)=>{
    assert.equal(blocked.includes('library.derivative.build'),disabled);
    return ++claimCount===1?job('library.derivative.build'):null;
  }, cancellationRequested:async()=>false,heartbeat:async()=>true,succeed:async()=>{succeeded++;},fail:async error=>{throw error;}};
  const worker=new DurableJobWorker(queue,{concurrency:1,blockedTypes:()=>policy.disabledStudioToolJobTypes(tool=>!(tool==='library'&&disabled))});
  worker.register('library.derivative.build',async()=>{ran++;});
  disabled=false;
  await worker.runBatch(); await wait(20);
  assert.equal(ran,1);assert.equal(succeeded,1);
  worker.stop();
});
console.log(`${checks}/${checks} TD2 Library ownership checks passed`);
