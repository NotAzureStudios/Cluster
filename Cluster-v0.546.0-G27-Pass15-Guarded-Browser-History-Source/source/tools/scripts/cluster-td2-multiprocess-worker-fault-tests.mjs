/**
 * Two real Node child processes run the production DurableJobWorker against one
 * deterministic IPC queue authority. Exercises process isolation, claim tokens,
 * tool toggles, lease recovery and failed acknowledgements without PostgreSQL.
 * This is a protocol fault-injection harness, NOT PostgreSQL certification.
 */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const tick = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function workerClass() {
  const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding:'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
  function compile(file, stubs) {
    const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module = {exports:{}};
    new Function('require','module','exports', code)((name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith('node:')) return require(name);
      throw Error(`Unmocked worker dependency: ${name}`);
    }, module, module.exports);
    return module.exports;
  }
  const types = compile('apps/server/src/domains/jobs/job-types.ts', {
    '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
  });
  return compile('apps/server/src/domains/jobs/job-worker.ts', {
    '../../core/reliability-context.js': {runWithReliabilityContext: (_ctx, fn) => fn()},
    './job-types.js': types,
    './job-queue-service.js': {BackgroundJobQueue: class {}},
  }).DurableJobWorker;
}

if (process.argv[2] === '--worker') {
  const DurableJobWorker = workerClass();
  const workerId = process.argv[3];
  let enabled = true, stopped = false, next = 0;
  const waiters = new Map();
  function rpc(method, ...args) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      waiters.set(id, { resolve, reject });
      process.send({rpc:id,method,args,workerId});
    });
  }
  const queue = Object.fromEntries(['claim','heartbeat','succeed','fail','updateProgress','deferDisabled','cancellationRequested'].map(method => [method, (...args) => rpc(method, ...args)]));
  const issues = [];
  const runtime = new DurableJobWorker(queue, {
    workerId, concurrency:1, leaseMs:60000, cancellationPollMs:1000,
    blockedTypes:() => enabled ? [] : ['test.library'],
    verifyExecutionAvailability:async (type) => type !== 'test.library' || await rpc('enabled'),
    logger:{warn:({error}, msg) => issues.push(`${msg}: ${error?.message || ''}`)},
  });
  let loops = 0;
  for (const type of ['test.shared','test.library','test.flaky']) {
    runtime.register(type, async ({job,throwIfToolUnavailable,updateProgress}) => {
      process.send({event:'started',jobId:job.id,token:job.leaseOwner,type,workerId});
      try {
        await tick(type === 'test.library' ? 70 : 15);
        await throwIfToolUnavailable();
        await updateProgress(75);
        return {id:job.id,workerId};
      } finally {
        process.send({event:'finished',jobId:job.id,token:job.leaseOwner,workerId});
      }
    });
  }
  process.on('message', async m => {
    if (m.reply) {
      const entry = waiters.get(m.reply);
      if (!entry) return;
      waiters.delete(m.reply);
      m.error ? entry.reject(new Error(m.error)) : entry.resolve(m.value);
    } else if (m.owner === 'library') {
      enabled = m.enabled;
    } else if (m.stop) {
      stopped = true;
      clearInterval(timer);
      await runtime.drain();
      process.send({event:'stopped', workerId, snapshot:runtime.snapshot(), issues, loops}, () => process.exit(0));
    }
  });
  const timer = setInterval(() => {
    if (stopped) return;
    loops++;
    void runtime.runBatch().catch(error => process.send({event:'claimError', workerId, detail:error.message}));
  }, 12);
  process.send({event:'ready',workerId});
} else {
  const job = (id,type,payload='{}') => ({id,type,payload,queue:'default',workspaceId:null,correlationId:null,createdById:null,attempts:0,maxAttempts:5,status:'QUEUED',runAfter:0,leaseOwner:null,leaseExpiresAt:null});
  const jobs = [
    job('library-a','test.library'), job('shared-a','test.shared'),job('flaky','test.flaky'),
    job('unknown','test.unregistered'), job('malformed','test.shared','{not valid json'),
    job('library-b','test.library'),job('shared-b','test.shared'),
  ];
  const byId = new Map(jobs.map(j => [j.id,j]));
  let ownersEnabled = true, disabledOnce=false, failedSucceedOnce=false, failedFailOnce=false;
  let maxLeases = 0, inFlight = 0, leaseNumber = 0;
  const activeHandlers = new Map(); let maxHandlers = 0;
  const starts = [], events=[], snapshots=[], exits=[];
  let unsafeStarts=0;
  const children = ['worker-A','worker-B'].map(id => fork(fileURLToPath(import.meta.url), ['--worker',id], {cwd:root,stdio:['ignore','ignore','pipe','ipc']}));
  const stderr=[];
  for (const child of children) child.stderr.on('data', b => stderr.push(String(b)));
  const owner = enabled => {
    ownersEnabled=enabled;
    children.forEach(c => c.send({owner:'library',enabled}));
    events.push(enabled ? 'enabled' : 'disabled');
  };
  function owned(j, token) {return j && j.status==='RUNNING' && j.leaseOwner===token && j.leaseExpiresAt>Date.now();}
  async function serve(m) {
    const [a,b,c] = m.args;
    switch (m.method) {
      case 'claim': {
        const blocked = m.args[5] || []; 
        const chosen = jobs.find(j => (j.status==='QUEUED' && j.runAfter<=Date.now() || j.status==='RUNNING' && j.leaseExpiresAt<=Date.now()) && !blocked.includes(j.type));
        if (!chosen) return null;
        if (chosen.status==='RUNNING') inFlight--; // reclaim of an expired lease
        chosen.status='RUNNING'; chosen.attempts++; chosen.leaseOwner=`${m.workerId}:claim:${++leaseNumber}`;chosen.leaseExpiresAt=Date.now()+350;
        inFlight++; maxLeases=Math.max(maxLeases,inFlight);
        return {...chosen};
      }
      case 'enabled': return ownersEnabled;
      case 'heartbeat': {
        const j=byId.get(a.id);
        if (!owned(j,a.leaseOwner)) return false;
        j.leaseExpiresAt=Date.now()+350;
        return true;
      }
      case 'cancellationRequested': return false;
      case 'updateProgress': return owned(byId.get(a.id),a.leaseOwner);
      case 'succeed': {
        const j=byId.get(a.id);
        if (!owned(j,a.leaseOwner)) return false;
        if (j.id==='flaky' && !failedSucceedOnce) {failedSucceedOnce=true;throw Error('simulated PostgreSQL commit outage');}
        j.status='SUCCEEDED'; j.leaseOwner=null; inFlight--; events.push(`success:${j.id}`);return true;
      }
      case 'fail': {
        const j=byId.get(a.id);
        if (!owned(j,a.leaseOwner)) return false;
        if (j.id==='malformed' && !failedFailOnce) {failedFailOnce=true;throw Error('simulated PostgreSQL failure acknowledgement outage');}
        j.status='DEAD_LETTER';j.leaseOwner=null;inFlight--;events.push(`dead:${j.id}`);return true;
      }
      case 'deferDisabled': {
        const j=byId.get(a.id);
        if (!owned(j,a.leaseOwner)) return false;
        j.status='QUEUED';j.runAfter=Date.now()+50;j.attempts=Math.max(0,j.attempts-1);j.leaseOwner=null;inFlight--;events.push(`deferred:${j.id}`);return true;
      }
      default: throw Error(`Unsupported queue call ${m.method}`);
    }
  }
  let ready = 0, stopping = false;
  try {
    await Promise.all(children.map(child => new Promise((resolve,reject) => {
      let settled=false;
      child.on('exit',(code, signal) => {exits.push({code,signal}); if (!stopping && !settled) reject(Error(`worker exited early ${code}: ${stderr.join('')}`));});
      child.on('error', reject);
      child.on('message', m => {
        if (m.event === 'ready') {ready++;settled=true;resolve();}
        if (m.event === 'started') {
          starts.push(m);
          const count = (activeHandlers.get(m.workerId)||0)+1;
          activeHandlers.set(m.workerId,count);
          maxHandlers = Math.max(maxHandlers,[...activeHandlers.values()].reduce((a,b)=>a+b,0));
          assert(count<=1,`worker ${m.workerId} exceeded its concurrency limit`);
          if (m.type==='test.library' && !disabledOnce) {
            disabledOnce=true;
            owner(false);
            setTimeout(() => owner(true), 220);
          }
          if (m.type==='test.library' && !ownersEnabled && m.jobId !== 'library-a') unsafeStarts++;
        }
        if (m.event === 'finished') activeHandlers.set(m.workerId,(activeHandlers.get(m.workerId)||0)-1);
        if (m.event === 'stopped') snapshots.push(m);
        if (m.event === 'claimError') events.push(`claimError:${m.detail}`);
        if (m.rpc) {
          void serve(m).then(value=>{if(child.connected) child.send({reply:m.rpc,value});},error=>{if(child.connected)child.send({reply:m.rpc,error:error.message});});
        }
      });
    })));
    assert.equal(ready,2);
    const start=Date.now();
    while (jobs.some(j=>j.status!=='SUCCEEDED'&&j.status!=='DEAD_LETTER') && Date.now()-start<5000) {
      // Recover expired leases in our simulated transactional authority. A
      // production PostgreSQL claim does this within the SQL claim operation.
      for (const j of jobs) if (j.status==='RUNNING' && j.leaseExpiresAt<=Date.now()) {j.status='QUEUED';j.leaseOwner=null;inFlight--;events.push(`expired:${j.id}`);}
      await tick(15);
    }
    assert.deepEqual(jobs.map(j=>[j.id,j.status]),[
      ['library-a','SUCCEEDED'],['shared-a','SUCCEEDED'],['flaky','SUCCEEDED'],
      ['unknown','DEAD_LETTER'],['malformed','DEAD_LETTER'],
      ['library-b','SUCCEEDED'],['shared-b','SUCCEEDED']
    ],`unfinished IPC queue: ${JSON.stringify(jobs)}; ${stderr.join('')}`);
    assert(events.includes('disabled') && events.includes('enabled'));
    assert(events.some(e=>e.startsWith('deferred:library-')),'in-flight Library work deferred');
    assert.equal(jobs.find(j=>j.id==='library-a').attempts,1,'tool holds preserve retry allowance');
    assert.equal(jobs.find(j=>j.id==='flaky').attempts,2,'unacknowledged commit must lease-recover');
    assert.equal(jobs.find(j=>j.id==='malformed').attempts,2,'unacknowledged failure must lease-recover');
    assert.equal(unsafeStarts,0,'new Library handlers must not start during disabled interval');
    assert.equal(maxHandlers,2,'both processes execute concurrently within each process limit');
    assert(starts.some(s=>s.workerId==='worker-A')&&starts.some(s=>s.workerId==='worker-B'));
    stopping=true;
    await Promise.all(children.map(c=>new Promise(resolve=>{if(c.exitCode!==null) return resolve();c.once('exit',resolve);c.send({stop:true});})));
    assert.equal(snapshots.length,2);
    assert(snapshots.reduce((n,s)=>n+s.snapshot.unacknowledgedErrors,0)>=2,'outcome failures observed and counted');
    assert(snapshots.every(s=>s.snapshot.pendingClaimBatches===0&&s.snapshot.running===0));
    assert(exits.every(e=>e.code===0),`unexpected worker exit: ${JSON.stringify(exits)}`);
    console.log(`PASS 2 independent Node worker processes; ${starts.length} starts; max ${maxHandlers} concurrent handlers, ${maxLeases} outstanding leases (including uncertain acknowledgements)`);
    console.log('PASS disabled tool defers in-flight work; shared work still completes; re-enable resumes without retry loss');
    console.log('PASS two independent database acknowledgement outages recovered via lease expiry; no unhandled rejection crash');
    console.log('PASS malformed and unknown job failures isolated; all seven jobs reach terminal state');
    console.log('PASS controlled drain of both child processes; no active claims; zero nonzero exits');
    console.log('5/5 TD2 multi-process IPC fault scenarios passed (not a PostgreSQL integration test)');
  } finally {
    for (const c of children) if (c.exitCode===null && !c.killed) c.kill('SIGKILL');
  }
}
