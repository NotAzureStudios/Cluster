/** SQL boundary contracts for durable lease/attempt recovery. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
const load=(file,stubs)=>{
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)((name)=>{
    if(Object.hasOwn(stubs,name))return stubs[name];if(name.startsWith('node:'))return require(name);throw Error(`Unexpected import ${name}`);
  },mod,mod.exports);return mod.exports;
};
const types=load('apps/server/src/domains/jobs/job-types.ts',{'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
const {BackgroundJobQueue}=load('apps/server/src/domains/jobs/job-queue-service.ts',{
  '../../core/reliability-context.js':{currentReliabilityContext:()=>null},
  '../../core/cursor-pagination.js':{encodeCursor:()=>'',decodeCursor:()=>null},
  './job-types.js':types,
  '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
});
function testDB({reclaim=true,exhausted=false}={}){
  const statements=[];let withinTransaction=false;let attempt=exhausted?5:1;
  const db={
    async $transaction(fn){withinTransaction=true;try{return await fn(this);}finally{withinTransaction=false;}},
    async $executeRawUnsafe(sql,...values){
      assert(withinTransaction,'queue recovery writes must be transactional');
      statements.push({kind:'execute',sql,values});
      if(sql.includes('), exhausted AS (')){
        assert.match(sql,/FOR UPDATE SKIP LOCKED/);
        assert.match(sql,/LIMIT \$1/);
        assert.deepEqual(values,[64]);
        assert.match(sql,/RETURNING job\."id"/);
        assert.match(sql,/UPDATE "BackgroundJobAttempt" AS attempt/);
        assert.match(sql,/attempt\."status" = 'RUNNING'/);
      }
      if(sql.includes('UPDATE "BackgroundJobAttempt"')&&!sql.includes('), exhausted AS (')){
        assert.match(sql,/"attempt" < \$2 AND "status" = 'RUNNING'/);
        assert.equal(values[0],'job-1');assert.equal(values[1],2);
      }
      return 1;
    },
    async $queryRawUnsafe(sql,...values){
      assert(withinTransaction,'claim query must be in same transaction');
      statements.push({kind:'query',sql,values});
      if(sql.includes('WITH workspace_load') && sql.includes('SELECT job."id", job."workspaceId"'))
        return reclaim?[{id:'job-1',workspaceId:null}]:[];
      if(sql.includes('WITH workspace_load') && sql.includes('UPDATE "BackgroundJob"')){
        assert.match(sql,/job\."id" = \$8/);assert.equal(values[7],'job-1');
        return reclaim?[{id:'job-1',type:'test.work',leaseOwner:'new-claim-token',attempts:2,status:'RUNNING'}]:[];
      }
      if(sql.includes('INSERT INTO "BackgroundJobAttempt"')){
        assert.equal(values[1],'job-1');assert.equal(values[2],2);
        return [{jobId:'job-1',attempt:2,status:'RUNNING'}];
      }
      return [];
    },
  };
  return {db,statements};
}
let count=0;
async function check(label,fn){await fn();count++;console.log('PASS',label);}
await check('reclaimed lease finalizes orphan attempt in transaction before recording new attempt',async()=>{
  const {db,statements}=testDB();const queue=new BackgroundJobQueue(db);
  const job=await queue.claim('worker-a');assert.equal(job.attempts,2);
  assert.equal(statements.length,5);
  assert.match(statements[0].sql,/WITH stale AS/);
  assert.match(statements[1].sql,/FOR UPDATE OF job SKIP LOCKED/);
  assert.match(statements[2].sql,/UPDATE "BackgroundJob"/);
  assert.match(statements[3].sql,/UPDATE "BackgroundJobAttempt"/);
  assert.match(statements[4].sql,/INSERT INTO "BackgroundJobAttempt"/);
});
await check('no claim never attempts to finalize a nonexistent lease or create attempt',async()=>{
  const {db,statements}=testDB({reclaim:false});const queue=new BackgroundJobQueue(db);
  assert.equal(await queue.claim('worker-a'),null);
  assert.equal(statements.length,2);
});
await check('dead-letter exhaustion reconciles attempt status in one SQL statement',async()=>{
  const {db,statements}=testDB({reclaim:false,exhausted:true});const queue=new BackgroundJobQueue(db);
  await queue.claim('worker-a');
  assert.match(statements[0].sql,/WHEN exhausted\."status" = 'CANCELLED' THEN 'CANCELLED' ELSE 'FAILED'/);
  assert.match(statements[0].sql,/WHEN job\."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' ELSE 'DEAD_LETTER'/);
  assert.match(statements[0].sql,/Worker lease expired; retry budget exhausted/);
  assert.match(statements[0].sql,/"attempts" >= "maxAttempts"/);
});
await check('claim still filters disabled job types before attempt or lease is changed',async()=>{
  const {db,statements}=testDB({reclaim:false});const queue=new BackgroundJobQueue(db);
  await queue.claim('worker-a',60000,['default'],2,64,['library.transfer.finalize']);
  assert.match(statements[1].sql,/NOT \(job\."type" = ANY\(\$2::text\[\]\)\)/);
  assert.deepEqual(statements[1].values[1],['library.transfer.finalize']);
});
console.log(`${count}/${count} TD2 attempted-lease recovery SQL boundary checks passed`);
