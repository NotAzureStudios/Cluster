/**
 * TD2 orphan/cancellation/exhaustion recovery, real BackgroundJobQueue orchestration + a controlled
 * transaction/row-lock simulator. Tests bounded work, competing claims, and
 * atomic job/attempt status. NOT live PostgreSQL certification.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
const load=(file,stubs)=>{
  const output=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',output)(name=>{if(Object.hasOwn(stubs,name))return stubs[name];if(name.startsWith('node:'))return require(name);throw Error(`unexpected import ${name}`);},mod,mod.exports);
  return mod.exports;
};
const types=load('apps/server/src/domains/jobs/job-types.ts',{'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
const {BackgroundJobQueue}=load('apps/server/src/domains/jobs/job-queue-service.ts',{
  '../../core/reliability-context.js':{currentReliabilityContext:()=>null},
  '../../core/cursor-pagination.js':{encodeCursor:()=>'',decodeCursor:()=>null},
  './job-types.js':types,
  '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
});
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function database(count,{holdFirst=false,throwOnSweep=false,overrides=()=>({})}={}) {
  const jobs=Array.from({length:count},(_,i)=>({id:`j${String(i).padStart(4,'0')}`,status:'RUNNING',attempts:5,maxAttempts:5,expired:true,ready:true,cancel:false,updatedAt:i,...overrides(i)}));
  const attempts=new Map(jobs.map(j=>[j.id,{status:'RUNNING',finishedAt:null}]));
  const locks=new Set();const commits=[];const sweeps=[];
  let pendingGate,releaseFirst;
  const firstEntered=new Promise(resolve=>{pendingGate=resolve});
  const firstResume=new Promise(resolve=>{releaseFirst=resolve});
  let transactions=0;
  const db={
    $transaction:async(fn)=>{
      const id=++transactions,held=[];
      let staged=[];
      const tx={
        $executeRawUnsafe:async(sql,...args)=>{
          assert.match(sql,/WITH stale AS \(/);
          assert.match(sql,/FOR UPDATE SKIP LOCKED/);
          assert.match(sql,/ORDER BY "updatedAt", "id"/);
          assert.match(sql,/LIMIT \$1/);
          assert.match(sql,/"cancelRequestedAt" IS NOT NULL/);
          assert.match(sql,/WHEN job\."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED'/);
          assert.match(sql,/RETURNING job\."id", job\."status"/);
          assert.match(sql,/WHEN exhausted\."status" = 'CANCELLED' THEN 'CANCELLED'/);
          assert.match(sql,/attempt\."jobId" = exhausted\."id" AND attempt\."status" = 'RUNNING'/);
          assert.equal(args.length,1);assert.equal(args[0],64);
          if(throwOnSweep)throw Error('simulated write outage');
          staged=jobs.filter(j=>!locks.has(j.id)&&(
            (j.status==='QUEUED'&&(j.cancel||(j.attempts>=j.maxAttempts&&j.ready)))||
            (j.status==='RUNNING'&&j.expired&&(j.cancel||j.attempts>=j.maxAttempts))
          )).slice(0,args[0]);
          for(const j of staged){locks.add(j.id);held.push(j.id)}
          sweeps.push({id,rows:staged.map(j=>j.id)});
          if(holdFirst&&id===1){pendingGate();await firstResume;}
          return staged.length;
        },
        $queryRawUnsafe:async(sql)=>{
          assert.match(sql,/SELECT job\."id", job\."workspaceId"/);
          return [];
        },
      };
      try{
        const result=await fn(tx);
        for(const j of staged){j.status=j.cancel?'CANCELLED':'DEAD_LETTER';const attempt=attempts.get(j.id);if(attempt.status==='RUNNING'){attempt.status=j.cancel?'CANCELLED':'FAILED';attempt.finishedAt=new Date();}}
        commits.push(id);
        return result;
      }finally{for(const key of held)locks.delete(key);}
    },
  };
  return {db,jobs,attempts,sweeps,commits,firstEntered,releaseFirst};
}
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name)};
await check('one empty claim bounds backlog reconciliation to 64 expired jobs',async()=>{
  const env=database(300);assert.equal(await new BackgroundJobQueue(env.db).claim('w'),null);
  assert.equal(env.sweeps[0].rows.length,64);
  assert.equal(env.jobs.filter(x=>x.status==='DEAD_LETTER').length,64);
  assert.equal([...env.attempts.values()].filter(x=>x.status==='FAILED'&&x.finishedAt).length,64);
});
await check('repeated idle claims eventually reconcile all 300 jobs with no duplicate row writes',async()=>{
  const env=database(300);const queue=new BackgroundJobQueue(env.db);
  for(let i=0;i<5;i++)assert.equal(await queue.claim('w'),null);
  assert.deepEqual(env.sweeps.map(x=>x.rows.length),[64,64,64,64,44]);
  const ids=env.sweeps.flatMap(x=>x.rows);assert.equal(new Set(ids).size,300);
  assert(env.jobs.every(x=>x.status==='DEAD_LETTER'));
  assert([...env.attempts.values()].every(x=>x.status==='FAILED'&&x.finishedAt));
});
await check('two concurrent claimers use SKIP LOCKED to reconcile disjoint stale rows',async()=>{
  const env=database(200,{holdFirst:true});const qa=new BackgroundJobQueue(env.db),qb=new BackgroundJobQueue(env.db);
  const a=qa.claim('a');await env.firstEntered;
  const b=qb.claim('b');await pause();env.releaseFirst();await Promise.all([a,b]);
  assert.equal(env.sweeps.length,2);
  assert.equal(env.sweeps[0].rows.length,64);assert.equal(env.sweeps[1].rows.length,64);
  assert.equal(new Set(env.sweeps.flatMap(x=>x.rows)).size,128);
  assert.equal(env.jobs.filter(x=>x.status==='DEAD_LETTER').length,128);
});
await check('failed reconciliation rolls back and does not dead-letter or consume attempts',async()=>{
  const env=database(5,{throwOnSweep:true});
  await assert.rejects(()=>new BackgroundJobQueue(env.db).claim('w'),/simulated write outage/);
  assert(env.jobs.every(j=>j.status==='RUNNING'));
  assert([...env.attempts.values()].every(a=>a.status==='RUNNING'));
});
await check('idle claims reconcile exhausted entries independently of requested queue',async()=>{
  const env=database(70);const q=new BackgroundJobQueue(env.db);
  await q.claim('w',60000,['some-other-queue']);
  assert.equal(env.jobs.filter(x=>x.status==='DEAD_LETTER').length,64);
});
await check('once backlog is gone an idle claim performs zero recovery writes',async()=>{
  const env=database(1);const q=new BackgroundJobQueue(env.db);
  await q.claim('w');await q.claim('w');assert.equal(env.sweeps[1].rows.length,0);
});
await check('abandoned cancellation with retries left becomes CANCELLED, not permanently RUNNING',async()=>{
  const env=database(1,{overrides:()=>({attempts:1,maxAttempts:5,cancel:true})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'CANCELLED');
  assert.equal(env.attempts.get(env.jobs[0].id).status,'CANCELLED');
  assert(env.attempts.get(env.jobs[0].id).finishedAt);
});
await check('cancellation takes precedence on a retry-exhausted lease',async()=>{
  const env=database(1,{overrides:()=>({cancel:true})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'CANCELLED');
  assert.equal(env.attempts.get(env.jobs[0].id).status,'CANCELLED');
});
await check('future scheduled QUEUED cancellations finalize without waiting for runAfter',async()=>{
  const env=database(1,{overrides:()=>({status:'QUEUED',attempts:0,ready:false,cancel:true})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'CANCELLED');
});
await check('unexpired RUNNING cancellation waits for current lease holder',async()=>{
  const env=database(1,{overrides:()=>({attempts:1,maxAttempts:5,cancel:true,expired:false})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'RUNNING');
  assert.equal(env.attempts.get(env.jobs[0].id).status,'RUNNING');
});
await check('ordinary nonexhausted expired leases remain eligible for normal reclaim',async()=>{
  const env=database(1,{overrides:()=>({attempts:1,maxAttempts:5,cancel:false})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'RUNNING');
});
await check('unready QUEUED jobs remain queued unless cancellation was requested',async()=>{
  const env=database(1,{overrides:()=>({status:'QUEUED',ready:false,cancel:false})});
  await new BackgroundJobQueue(env.db).claim('recovery');
  assert.equal(env.jobs[0].status,'QUEUED');
});
await check('mixed cancellations and exhausted leases stay bounded and settle correctly',async()=>{
  const env=database(150,{overrides:i=>({cancel:i%3===0,attempts:i%3===0?1:5})});
  const q=new BackgroundJobQueue(env.db);
  for(let i=0;i<3;i++)await q.claim('recovery');
  assert.deepEqual(env.sweeps.map(x=>x.rows.length),[64,64,22]);
  for(let i=0;i<env.jobs.length;i++){
    assert.equal(env.jobs[i].status,i%3===0?'CANCELLED':'DEAD_LETTER');
    assert.equal(env.attempts.get(env.jobs[i].id).status,i%3===0?'CANCELLED':'FAILED');
  }
});
await check('two workers recover disjoint cancelled and exhausted jobs without duplicate writes',async()=>{
  const env=database(180,{holdFirst:true,overrides:i=>({cancel:i%2===0,attempts:i%2===0?1:5})});
  const a=new BackgroundJobQueue(env.db).claim('a');await env.firstEntered;
  const b=new BackgroundJobQueue(env.db).claim('b');await pause();env.releaseFirst();await Promise.all([a,b]);
  assert.equal(new Set(env.sweeps.flatMap(s=>s.rows)).size,128);
  assert.equal(env.jobs.filter(j=>j.status==='CANCELLED').length,64);
  assert.equal(env.jobs.filter(j=>j.status==='DEAD_LETTER').length,64);
});
await check('synchronous external wake failure cannot turn a committed enqueue into a thrown error',async()=>{
  let committed=0;let warnings=0;
  const row={id:'saved-job',status:'QUEUED'};
  const db={$transaction:async fn=>fn({$queryRawUnsafe:async sql=>{assert.match(sql,/INSERT INTO "BackgroundJob"/);committed++;return [row]}})};
  const q=new BackgroundJobQueue(db,{warn:()=>{warnings++}},{wakePublisher:()=>{throw Error('external wake unavailable')}});
  assert.equal((await q.enqueue({type:'test.wake',payload:{}})).id,'saved-job');
  assert.equal(committed,1);assert.equal(warnings,1);
});
await check('asynchronous wake rejection and throwing logger cannot reject an already committed enqueue',async()=>{
  let committed=0;
  const db={$transaction:async fn=>fn({$queryRawUnsafe:async()=>{committed++;return [{id:'saved-job'}]}})};
  const q=new BackgroundJobQueue(db,{warn:()=>{throw Error('broken logger')}},{wakePublisher:()=>Promise.reject(Error('network down'))});
  assert.equal((await q.enqueue({type:'test.wake',payload:{}})).id,'saved-job');
  await pause();assert.equal(committed,1);
});
console.log(`${checks}/${checks} bounded recovery / cancellation / enqueue-fault scenarios passed (transaction simulator, not live PostgreSQL)`);
