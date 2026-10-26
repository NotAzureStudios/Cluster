/**
 * Production BackgroundJobQueue with a deterministic READ COMMITTED transaction
 * simulator and advisory/row locks. This exercises real queue orchestration,
 * but is NOT a substitute for the opt-in live PostgreSQL 17/18 harness.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const load=(file,stubs={})=>{
  const code=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{
    if(Object.hasOwn(stubs,name))return stubs[name];
    if(name.startsWith('node:'))return require(name);
    throw Error('unexpected import: '+name);
  },module,module.exports);
  return module.exports;
};
const types=load('apps/server/src/domains/jobs/job-types.ts',{'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
let currentTx=null;
const {BackgroundJobQueue}=load('apps/server/src/domains/jobs/job-queue-service.ts',{
  '../../core/reliability-context.js':{currentReliabilityContext:()=>null},
  '../../core/cursor-pagination.js':{encodeCursor:()=>'',decodeCursor:()=>null},
  './job-types.js':types,
  '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async (tx,key)=>tx.lockWorkspace(key)},
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function simulator(items,{pauseBeforeLock=5,failFirstAdvisoryLock=false}={}) {
  let pendingLockFailure=failFirstAdvisoryLock;
  const state=items.map((job,i)=>({id:`job-${i}`,type:'test.work',queue:'default',workspaceId:null,costUnits:1,attempts:0,maxAttempts:5,priority:0,runAfter:new Date(0),createdAt:new Date(i+1),status:'QUEUED',...job}));
  const rowOwners=new Map(), advisoryOwners=new Map(), waiters=new Map();
  const diagnostics={locks:[],checks:[],claims:[],transactions:0};
  let txId=0;
  function adapter() {return {$transaction:async fn=>{
    const id=++txId;diagnostics.transactions++;
    const rows=new Set(),workspaces=new Set(),pending=new Map();
    const tx={
      async lockWorkspace(key){
        assert(key.startsWith('cluster-job-workspace-running:'));
        if (pendingLockFailure) { pendingLockFailure=false; throw Error('injected advisory lock outage'); }
        // The real pg_advisory_xact_lock blocks until the previous claimant commits.
        while (advisoryOwners.has(key) && advisoryOwners.get(key)!==id) {
          await new Promise(resolve=>{const w=waiters.get(key)||[];w.push(resolve);waiters.set(key,w);});
        }
        advisoryOwners.set(key,id);workspaces.add(key);diagnostics.locks.push([id,key]);
      },
      async $executeRawUnsafe(sql){
        if(sql.includes('), exhausted AS ('))return 0;
        if(sql.includes('UPDATE "BackgroundJobAttempt"'))return 1;
        throw Error('Unexpected write '+sql.slice(0,110));
      },
      async $queryRawUnsafe(sql,...args){
        if(sql.includes('SELECT job."id", job."workspaceId"')){
          assert.match(sql,/FOR UPDATE OF job SKIP LOCKED/);
          const [queues,blocked,concurrency,costBudget]=args;
          const eligible=state.filter(job=>
            !rowOwners.has(job.id) && (job.status==='QUEUED'||job.status==='RUNNING'&&job.leaseExpiresAt<new Date()) &&
            queues.includes(job.queue) && !blocked.includes(job.type) && job.attempts<job.maxAttempts &&
            (!job.workspaceId || (state.filter(x=>x.status==='RUNNING'&&x.workspaceId===job.workspaceId).length<concurrency &&
               state.filter(x=>x.status==='RUNNING'&&x.workspaceId===job.workspaceId).reduce((sum,x)=>sum+x.costUnits,0)+job.costUnits<=costBudget))
          );
          eligible.sort((a,b)=>b.priority-a.priority||a.createdAt-b.createdAt);
          const candidate=eligible[0];
          if(!candidate)return [];
          rows.add(candidate.id);rowOwners.set(candidate.id,id);
          await sleep(pauseBeforeLock); // force two workers to select different rows first
          return [{id:candidate.id,workspaceId:candidate.workspaceId}];
        }
        if(sql.includes('UPDATE "BackgroundJob" AS job')){
          const [queues,worker,leaseMs,concurrency,costBudget,blocked,claimToken,jobId]=args;
          assert.match(sql,/job\."id" = \$8/);
          const job=state.find(j=>j.id===jobId);
          assert(job && rows.has(jobId));
          if(job.workspaceId)assert(workspaces.has(`cluster-job-workspace-running:${job.workspaceId}`), 'claim MUST hold same-workspace advisory lock');
          const running=state.filter(x=>x.status==='RUNNING'&&x.workspaceId===job.workspaceId&&job.workspaceId);
          const cost=running.reduce((sum,x)=>sum+x.costUnits,0);
          diagnostics.checks.push({id,jobId,workspace:job.workspaceId,running:running.length,cost});
          if(!queues.includes(job.queue)||blocked.includes(job.type)||job.attempts>=job.maxAttempts||
             (job.workspaceId&&(running.length>=concurrency||cost+job.costUnits>costBudget)))return [];
          const result={...job,status:'RUNNING',leaseOwner:claimToken,attempts:job.attempts+1,leaseExpiresAt:new Date(Date.now()+leaseMs)};
          pending.set(jobId,result);diagnostics.claims.push([id,jobId]);
          return [result];
        }
        if(sql.includes('INSERT INTO "BackgroundJobAttempt"'))return [{}];
        return [];
      },
    };
    try {const result=await fn(tx);for(const [key,value] of pending){Object.assign(state.find(j=>j.id===key),value);}return result;}
    finally {for(const key of rows)rowOwners.delete(key);
      for(const key of workspaces){advisoryOwners.delete(key);for(const wake of waiters.get(key)||[])wake();waiters.delete(key);}
    }
  }};}
  return {state,adapter,diagnostics};
}
let passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS',label);}
await check('two competing workers cannot claim two jobs over concurrency=1 for same workspace',async()=>{
  const {adapter,state,diagnostics}=simulator([{workspaceId:'W'},{workspaceId:'W'}]);
  const a=new BackgroundJobQueue(adapter()),b=new BackgroundJobQueue(adapter());
  const [x,y]=await Promise.all([a.claim('a',60000,['default'],1,20),b.claim('b',60000,['default'],1,20)]);
  assert.equal([x,y].filter(Boolean).length,1);
  assert.equal(state.filter(job=>job.status==='RUNNING').length,1);
  assert.equal(diagnostics.locks.length,2);
  assert.deepEqual(diagnostics.checks.map(x=>x.running).sort(),[0,1]);
});
await check('two competing workers cannot exceed workspace running-cost budget',async()=>{
  const {adapter,state}=simulator([{workspaceId:'W',costUnits:3},{workspaceId:'W',costUnits:3}]);
  const [x,y]=await Promise.all([new BackgroundJobQueue(adapter()).claim('a',60000,['default'],4,5),new BackgroundJobQueue(adapter()).claim('b',60000,['default'],4,5)]);
  assert.equal([x,y].filter(Boolean).length,1);
  assert.equal(state.filter(job=>job.status==='RUNNING').reduce((sum,j)=>sum+j.costUnits,0),3);
});
await check('a workspace is eligible again after the previous claimed job completes',async()=>{
  const {adapter,state}=simulator([{workspaceId:'W'},{workspaceId:'W'}]);
  const queue=new BackgroundJobQueue(adapter());
  const first=await queue.claim('worker-first',60000,['default'],1,20);
  assert(first);
  assert.equal(await queue.claim('worker-second',60000,['default'],1,20),null);
  state.find(job=>job.id===first.id).status='SUCCEEDED';
  const second=await queue.claim('worker-second',60000,['default'],1,20);
  assert(second&&second.id!==first.id);
  assert.equal(second.attempts,1,'waiting for workspace capacity must not spend retry allowance');
});
await check('failed workspace advisory lock rolls back admission and releases candidate row lock',async()=>{
  const {adapter,state}=simulator([{workspaceId:'W'}],{failFirstAdvisoryLock:true});
  const queue=new BackgroundJobQueue(adapter());
  await assert.rejects(queue.claim('worker-first'),/injected advisory lock outage/);
  assert.equal(state[0].attempts,0);
  const recovered=await queue.claim('worker-second');
  assert(recovered&&recovered.attempts===1);
});
await check('different queue names cannot evade a shared workspace concurrency budget',async()=>{
  const {adapter}=simulator([{workspaceId:'W',queue:'a'},{workspaceId:'W',queue:'b'}]);
  const [x,y]=await Promise.all([new BackgroundJobQueue(adapter()).claim('a',60000,['a'],1,20),new BackgroundJobQueue(adapter()).claim('b',60000,['b'],1,20)]);
  assert.equal([x,y].filter(Boolean).length,1);
});
await check('independent workspaces run concurrently under per-workspace limit',async()=>{
  const {adapter,diagnostics}=simulator([{workspaceId:'W1'},{workspaceId:'W2'}]);
  const [x,y]=await Promise.all([new BackgroundJobQueue(adapter()).claim('a',60000,['default'],1,20),new BackgroundJobQueue(adapter()).claim('b',60000,['default'],1,20)]);
  assert(x&&y&&x.id!==y.id);
  assert.equal(diagnostics.locks.length,2);
  assert.notEqual(diagnostics.locks[0][1],diagnostics.locks[1][1]);
});
await check('jobs without workspace bypass workspace advisory locks',async()=>{
  const {adapter,diagnostics}=simulator([{},{}]);
  const [x,y]=await Promise.all([new BackgroundJobQueue(adapter()).claim('a'),new BackgroundJobQueue(adapter()).claim('b')]);
  assert(x&&y&&x.id!==y.id);
  assert.equal(diagnostics.locks.length,0);
});
await check('disabled jobs do not reach admission or consume retry attempts',async()=>{
  const {adapter,state,diagnostics}=simulator([{workspaceId:'W',type:'library.transfer.finalize'}]);
  const result=await new BackgroundJobQueue(adapter()).claim('a',60000,['default'],1,20,['library.transfer.finalize']);
  assert.equal(result,null);assert.equal(state[0].attempts,0);assert.equal(diagnostics.locks.length,0);
});
console.log(`${passed}/${passed} TD2 workspace claim transaction contention scenarios passed (simulated PostgreSQL locks)`);
