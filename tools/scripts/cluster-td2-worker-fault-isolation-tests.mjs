/** Focused fault tests for fire-and-forget execution, DB uncertainty and poll coalescing. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loadTs = (file, stubs) => {
  const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)((name)=>{
    if(Object.hasOwn(stubs,name)) return stubs[name];
    if(name.startsWith('node:')) return require(name);
    throw Error(`Unmocked dependency ${name}`);
  },mod,mod.exports);
  return mod.exports;
};
const types=loadTs('apps/server/src/domains/jobs/job-types.ts', {'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
const {DurableJobWorker}=loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js':{runWithReliabilityContext:(_ctx,fn)=>fn()},
  './job-types.js':types,
  './job-queue-service.js':{BackgroundJobQueue:class{}},
});
const job=(id='job',type='test.work',payload='{}')=>({id,type,payload,leaseOwner:'token',attempts:1,maxAttempts:5,correlationId:null,workspaceId:null,createdById:null});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const wait=async(fn,why)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error(`Timeout ${why}`);};
let passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS',label);}
async function runWithQueue(record,overrides={},type='test.work',handler=async()=>({})) {
  let claims=0, failed=0, success=0, warnings=0;
  const queue={
    claim:async()=>++claims===1?record:null,
    heartbeat:async()=>true,cancellationRequested:async()=>false,
    succeed:async()=>{success++;return 'SUCCEEDED';},fail:async()=>{failed++;return 'QUEUED';},
    deferDisabled:async()=>'DEFERRED',updateProgress:async()=>true,
    ...overrides,
  };
  const worker=new DurableJobWorker(queue,{concurrency:1,logger:{warn:()=>{warnings++;}}});
  if(handler) worker.register(type,handler);
  await worker.runBatch();
  await worker.drain();
  return {snapshot:worker.snapshot(),claims,failed,success,warnings};
}
await check('success acknowledgement exception does not become a conflicting FAIL write',async()=>{
  const r=await runWithQueue(job(),{succeed:async()=>{throw Error('connection reset after possible commit');}});
  assert.equal(r.failed,0);assert.equal(r.success,0);
  assert.equal(r.snapshot.failed,0);assert.equal(r.snapshot.succeeded,0);
  assert.equal(r.snapshot.unacknowledgedErrors,1);assert.equal(r.warnings,1);
});
await check('unexpected failure acknowledgement rejection is observed, not unhandled',async()=>{
  const r=await runWithQueue(job(),{fail:async()=>{throw Error('temporary write outage');}},'test.work',async()=>{throw Error('handler failed');});
  assert.equal(r.snapshot.failed,0);assert.equal(r.snapshot.unacknowledgedErrors,1);assert.equal(r.warnings,1);
});
await check('malformed job cannot be acknowledged: no process-level rejection or false failure count',async()=>{
  const r=await runWithQueue(job('invalid','test.work','{broken'),{fail:async()=>{throw Error('transaction aborted');}});
  assert.equal(r.snapshot.failed,0);assert.equal(r.snapshot.unacknowledgedErrors,1);
});
await check('unknown type with lost lease is not counted as successfully failed',async()=>{
  const r=await runWithQueue(job('unknown','test.missing'),{fail:async()=>null},'test.work');
  assert.equal(r.snapshot.unknownTypes,1);assert.equal(r.snapshot.failed,0);assert.equal(r.snapshot.leaseLost,1);
});
await check('invalid JSON with lost lease is not counted as successfully failed',async()=>{
  const r=await runWithQueue(job('bad','test.work','{broken'),{fail:async()=>null});
  assert.equal(r.snapshot.failed,0);assert.equal(r.snapshot.leaseLost,1);
});
await check('heartbeat and cancellation polling remain single-flight under a slow database',async()=>{
  const origSet=globalThis.setInterval,origClear=globalThis.clearInterval;
  const timers=[];const firstRenew=deferred(),slowRenew=deferred(),slowCancel=deferred(),running=deferred();
  let heartbeatCalls=0,cancellationCalls=0,handlerEntered=false;
  globalThis.setInterval=(fn,ms)=>{const timer={fn,ms,unref(){},closed:false};timers.push(timer);return timer;};
  globalThis.clearInterval=(timer)=>{timer.closed=true;};
  try {
    const queue={claim:async()=>{if(queue.claimed)return null;queue.claimed=true;return job();},
      heartbeat:async()=>{heartbeatCalls++;return heartbeatCalls===1?firstRenew.promise:slowRenew.promise;},
      cancellationRequested:async()=>{cancellationCalls++;return cancellationCalls<=3?false:slowCancel.promise;},
      succeed:async()=>'SUCCEEDED',fail:async()=>'QUEUED',deferDisabled:async()=>'DEFERRED',
    };
    const worker=new DurableJobWorker(queue,{concurrency:1,cancellationPollMs:500});
    worker.register('test.work',async()=>{handlerEntered=true;await running.promise;return{};});
    await worker.runBatch();await wait(()=>heartbeatCalls===1,'first preflight heartbeat');
    firstRenew.resolve(true);await wait(()=>handlerEntered,'handler started');
    assert.equal(timers.length,2);
    const heartbeatTimer=timers.find(t=>t.ms>1000);
    const cancellationTimer=timers.find(t=>t.ms<=1000);
    assert(heartbeatTimer&&cancellationTimer);
    for(let i=0;i<20;i++){heartbeatTimer.fn();cancellationTimer.fn();}
    await flush();
    assert.equal(heartbeatCalls,2,'all periodic renewals coalesce into one DB query');
    assert.equal(cancellationCalls,4,'all cancellation polls coalesce into one DB query');
    slowRenew.resolve(true);slowCancel.resolve(false);
    await flush();running.resolve();await worker.drain();
    assert.equal(worker.snapshot().succeeded,1);assert.equal(worker.snapshot().unacknowledgedErrors,0);
    assert(timers.every(t=>t.closed),'periodic timers closed before drain returns');
  } finally {globalThis.setInterval=origSet;globalThis.clearInterval=origClear;}
});
console.log(`${passed}/${passed} TD2 worker fault isolation checks passed`);
