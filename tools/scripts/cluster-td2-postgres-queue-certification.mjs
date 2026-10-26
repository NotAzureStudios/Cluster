/**
 * Opt-in real PostgreSQL 17/18 queue integration certification.
 * Uses the actual BackgroundJobQueue SQL with two independent connections and
 * temporary isolated tables matching the Prisma job models. Does not touch
 * Cluster production tables or certify complete server/Windows operation.
 *
 * TD2_CERT_DISPOSABLE=I_UNDERSTAND TD2_CERT_DATABASE_URL=postgresql://... \
 *   node tools/scripts/cluster-td2-postgres-queue-certification.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const databaseUrl=process.env.TD2_CERT_DATABASE_URL || '';
if (process.env.TD2_CERT_DISPOSABLE!=='I_UNDERSTAND' || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
  console.error('BLOCKED: explicitly authorize a disposable PostgreSQL 17/18 database with TD2_CERT_DISPOSABLE=I_UNDERSTAND and TD2_CERT_DATABASE_URL.');
  process.exitCode=2;
} else {
  let Client;
  try { ({Client}=await import('pg')); } catch {
    console.error('BLOCKED: pg driver not installed. Restore workspace dependencies before running PostgreSQL certification.');
    process.exitCode=2;
  }
  if (Client) {
    const schema=`td2_cert_${randomBytes(8).toString('hex')}`;
    const clients=[new Client({connectionString:databaseUrl}),new Client({connectionString:databaseUrl})];
    let created=false, checks=0;
    const check=async(label,fn)=>{await fn();checks++;console.log('PASS',label);};
    const adapter=(client)=>{
      const raw={
        $queryRawUnsafe:async(query,...values)=>(await client.query(query,values)).rows,
        $executeRawUnsafe:async(query,...values)=>(await client.query(query,values)).rowCount,
      };
      return {...raw,$transaction:async(fn)=>{
        await client.query('BEGIN');
        try {const result=await fn(raw);await client.query('COMMIT');return result;}
        catch(error){await client.query('ROLLBACK');throw error;}
      }};
    };
    function queueType() {
      const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
      const compile=(file,stubs)=>{
        const code=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
        const mod={exports:{}};
        new Function('require','module','exports',code)((name)=>{
          if(Object.hasOwn(stubs,name))return stubs[name];
          if(name.startsWith('node:'))return require(name);
          throw Error(`Unmocked dependency ${name}`);
        },mod,mod.exports);
        return mod.exports;
      };
      const types=compile('apps/server/src/domains/jobs/job-types.ts',{'../../core/state-machine.js':{lifecycleTransitionMap:()=>({}),assertLifecycleTransition:()=>{}}});
      return compile('apps/server/src/domains/jobs/job-queue-service.ts',{
        '../../core/reliability-context.js':{currentReliabilityContext:()=>null},
        '../../core/cursor-pagination.js':{encodeCursor:()=>'',decodeCursor:()=>null},
        './job-types.js':types,
        '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
      }).BackgroundJobQueue;
    }
    try {
      await Promise.all(clients.map(c=>c.connect()));
      await Promise.all(clients.map(async c=>{
        await c.query("SET statement_timeout TO '15s'");
        await c.query("SET lock_timeout TO '10s'");
      }));
      const [a,b]=clients;
      const v=await a.query('SHOW server_version_num');
      const major=Math.floor(Number(v.rows[0]?.server_version_num)/10000);
      assert([17,18].includes(major),`PostgreSQL 17/18 is required; got ${major}`);
      await a.query(`CREATE SCHEMA "${schema}"`);created=true;
      await Promise.all(clients.map(c=>c.query(`SET search_path TO "${schema}"`)));
      await a.query(`CREATE TABLE "BackgroundJob" (
        "id" text PRIMARY KEY, "queue" text NOT NULL DEFAULT 'default', "type" text NOT NULL,
        "workspaceId" text, "correlationId" text, "causationId" text,
        "status" text NOT NULL DEFAULT 'QUEUED', "priority" integer NOT NULL DEFAULT 0,
        "costUnits" integer NOT NULL DEFAULT 1, "payload" text NOT NULL DEFAULT '{}',
        "result" text, "attempts" integer NOT NULL DEFAULT 0, "maxAttempts" integer NOT NULL DEFAULT 5,
        "runAfter" timestamptz NOT NULL DEFAULT NOW(), "leaseOwner" text,
        "leaseExpiresAt" timestamptz, "cancelRequestedAt" timestamptz,
        "progress" integer NOT NULL DEFAULT 0, "progressMessage" text, "lastError" text,
        "dedupeKey" text, "createdById" text, "startedAt" timestamptz,
        "finishedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT NOW(),
        "updatedAt" timestamptz NOT NULL DEFAULT NOW()
      )`);
      await a.query(`CREATE TABLE "BackgroundJobAttempt" (
        "id" text PRIMARY KEY, "jobId" text NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE CASCADE,
        "attempt" integer NOT NULL, "workerId" text NOT NULL,
        "status" text NOT NULL DEFAULT 'RUNNING', "startedAt" timestamptz NOT NULL DEFAULT NOW(),
        "finishedAt" timestamptz, "durationMs" integer, "error" text,
        UNIQUE ("jobId","attempt")
      )`);
      const Queue=queueType(); const qa=new Queue(adapter(a)),qb=new Queue(adapter(b));
      const j1=await qa.enqueue({type:'test.shared',payload:{id:'a'}});
      const j2=await qa.enqueue({type:'test.shared',payload:{id:'b'}});
      await check('two competing PostgreSQL sessions cannot claim the same ready job',async()=>{
        const [x,y]=await Promise.all([qa.claim('worker-a'),qb.claim('worker-b')]);
        assert(x&&y&&x.id!==y.id);
        assert(x.leaseOwner!==y.leaseOwner);
      });
      await check('claim tokens fence stale heartbeats and finalization',async()=>{
        const x=await qa.get(j1.id);const current=x.job||x;
        assert.equal(await qa.heartbeat({...current,leaseOwner:'stale:token'}),false);
        assert.equal(await qa.succeed({...current,leaseOwner:'stale:token'},'worker-a',{}),null);
      });
      await a.query('UPDATE "BackgroundJob" SET "leaseExpiresAt"=NOW()-interval \'1 second\' WHERE "id"=$1',[j1.id]);
      await check('lease reclamation finalizes old RUNNING attempt and retains new live attempt',async()=>{
        const reclaimed=await qb.claim('worker-b-reclaim');
        assert.equal(reclaimed?.id,j1.id);assert.equal(reclaimed.attempts,2);
        const rows=await b.query('SELECT "attempt","status","finishedAt","error" FROM "BackgroundJobAttempt" WHERE "jobId"=$1 ORDER BY "attempt"',[j1.id]);
        assert.deepEqual(rows.rows.map(x=>x.status),['FAILED','RUNNING']);
        assert(rows.rows[0].finishedAt&&rows.rows[0].error);
        assert.equal(await qa.heartbeat({...reclaimed,leaseOwner:'stale:token'}),false);
        assert.equal(await qb.deferDisabled(reclaimed,'worker-b-reclaim',1000),'DEFERRED');
      });
      await check('disable deferral returns attempt allowance without leaving a ghost RUNNING row',async()=>{
        const row=await a.query('SELECT "attempts","status" FROM "BackgroundJob" WHERE "id"=$1',[j1.id]);
        assert.equal(row.rows[0].attempts,1);assert.equal(row.rows[0].status,'QUEUED');
        const history=await b.query('SELECT "attempt","status" FROM "BackgroundJobAttempt" WHERE "jobId"=$1',[j1.id]);
        assert.deepEqual(history.rows.map(x=>x.status),['FAILED']);
      });
      await check('exhausted expired lease atomically closes final attempt and dead-letters',async()=>{
        await a.query('UPDATE "BackgroundJob" SET "leaseExpiresAt"=NOW()-interval \'1 second\', "attempts"="maxAttempts" WHERE "id"=$1',[j2.id]);
        await a.query('UPDATE "BackgroundJobAttempt" SET "attempt"=(SELECT "maxAttempts" FROM "BackgroundJob" WHERE "id"=$1) WHERE "jobId"=$1',[j2.id]);
        await qa.claim('worker-a-final');
        const state=await a.query('SELECT "status" FROM "BackgroundJob" WHERE "id"=$1',[j2.id]);
        assert.equal(state.rows[0].status,'DEAD_LETTER');
        const attempts=await a.query('SELECT "status","finishedAt" FROM "BackgroundJobAttempt" WHERE "jobId"=$1',[j2.id]);
        assert.equal(attempts.rows[0].status,'FAILED');assert(attempts.rows[0].finishedAt);
      });
      // TD2 Pass 22: exercise the actual bounded reconciliation SQL against
      // large expired backlogs. The old version updated every expired job on
      // every unrelated claim; the new behavior is limited to 64 per claim,
      // with transactionally matched attempt records.
      await check('bounded expired-lease cleanup makes incremental progress using real SQL',async()=>{
        const prefix=`td2-batch-${randomBytes(6).toString('hex')}`;
        await a.query(`INSERT INTO "BackgroundJob"
          ("id","queue","type","status","attempts","maxAttempts","runAfter","leaseExpiresAt","createdAt","updatedAt")
          SELECT $1 || '-' || g::text,'cert-exhausted','test.exhausted',
            CASE WHEN g<=135 THEN 'RUNNING' ELSE 'QUEUED' END,
            3,3,NOW()-interval '10 minutes',
            CASE WHEN g<=135 THEN NOW()-interval '10 minutes' ELSE NULL END,
            NOW()-interval '10 minutes',NOW()-interval '10 minutes'
          FROM generate_series(1,150) AS g`,[prefix]);
        await a.query(`INSERT INTO "BackgroundJobAttempt" ("id","jobId","attempt","workerId","status","startedAt")
          SELECT 'attempt-' || "id","id",3,'lost-worker','RUNNING',NOW()-interval '10 minutes'
          FROM "BackgroundJob" WHERE "id" LIKE $1 AND "status"='RUNNING'`,[`${prefix}-%`]);
        const done=async()=>{
          const rows=await a.query(`SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER(WHERE "status"='DEAD_LETTER')::int AS done
            FROM "BackgroundJob" WHERE "id" LIKE $1`,[`${prefix}-%`]);
          return rows.rows[0];
        };
        for (const [index,expected] of [64,128,150].entries()){
          const queue=index%2?qb:qa;
          assert.equal(await queue.claim(`cleanup-${index}`,60000,['cert-nonexistent']),null);
          const progress=await done();
          assert.equal(progress.total,150);
          assert.equal(progress.done,expected,`cleanup batch ${index+1} must not write beyond its cap`);
        }
        const attempts=await a.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER(WHERE "status"='FAILED' AND "finishedAt" IS NOT NULL)::int AS closed
          FROM "BackgroundJobAttempt" WHERE "jobId" LIKE $1`,[`${prefix}-%`]);
        assert.deepEqual(attempts.rows[0],{total:135,closed:135});
        assert.equal(await qa.claim('cleanup-idle',60000,['cert-nonexistent']),null);
        assert.equal((await done()).done,150,'completed cleanup cannot rewrite terminal jobs');
      });
      // TD2 Pass 23: crash-after-cancellation must never strand a job in
      // RUNNING permanently. Exercise the actual production reconciliation
      // SQL (not an in-memory substitute) and verify attempts and unaffected
      // leases across multiple bounded cleanup transactions.
      await check('real SQL recovers orphaned cancellations and preserves valid leases',async()=>{
        const prefix=`td2-orphan-${randomBytes(6).toString('hex')}`;
        await a.query(`INSERT INTO "BackgroundJob"
          ("id","queue","type","status","attempts","maxAttempts","runAfter",
           "leaseOwner","leaseExpiresAt","cancelRequestedAt","createdAt","updatedAt")
          SELECT $1 || '-' || g::text,'cert-orphans','test.orphan',
            CASE WHEN g BETWEEN 91 AND 100 THEN 'QUEUED' ELSE 'RUNNING' END,
            CASE WHEN g % 2 = 0 OR g >= 101 THEN 1 ELSE 3 END,3,
            CASE WHEN g BETWEEN 91 AND 100 THEN NOW()+interval '1 hour' ELSE NOW()-interval '10 minutes' END,
            CASE WHEN g BETWEEN 91 AND 100 THEN NULL ELSE 'worker-crashed' END,
            CASE WHEN g BETWEEN 81 AND 90 THEN NOW()+interval '1 hour'
                 WHEN g BETWEEN 91 AND 100 THEN NULL ELSE NOW()-interval '10 minutes' END,
            CASE WHEN g % 2 = 0 AND g <= 90 OR g BETWEEN 91 AND 95 THEN NOW()-interval '5 minutes'
                 ELSE NULL END,
            NOW()-interval '15 minutes',NOW()-interval '15 minutes' + g * interval '1 millisecond'
          FROM generate_series(1,105) AS g`,[prefix]);
        await a.query(`INSERT INTO "BackgroundJobAttempt" ("id","jobId","attempt","workerId","status","startedAt")
          SELECT 'orphan-attempt-' || "id","id","attempts",'worker-crashed','RUNNING',NOW()-interval '10 minutes'
          FROM "BackgroundJob" WHERE "id" LIKE $1 AND "status"='RUNNING'`,[`${prefix}-%`]);
        const progress=async()=>{
          const rows=await a.query(`SELECT "status", COUNT(*)::int AS count
            FROM "BackgroundJob" WHERE "id" LIKE $1 GROUP BY "status"`,[`${prefix}-%`]);
          return Object.fromEntries(rows.rows.map(row=>[row.status,row.count]));
        };
        assert.equal(await qa.claim('orphan-recovery-1',60000,['cert-nonexistent']),null);
        assert.deepEqual(await progress(),{CANCELLED:32,DEAD_LETTER:32,RUNNING:31,QUEUED:10});
        assert.equal(await qb.claim('orphan-recovery-2',60000,['cert-nonexistent']),null);
        assert.deepEqual(await progress(),{CANCELLED:45,DEAD_LETTER:40,RUNNING:15,QUEUED:5});
        const attempts=await a.query(`SELECT "status", COUNT(*)::int AS count
          FROM "BackgroundJobAttempt" WHERE "jobId" LIKE $1 GROUP BY "status"`,[`${prefix}-%`]);
        assert.deepEqual(Object.fromEntries(attempts.rows.map(row=>[row.status,row.count])),
          {CANCELLED:40,FAILED:40,RUNNING:15});
        // Unexpired cancelled jobs cannot be touched by orphan cleanup.
        await a.query(`UPDATE "BackgroundJob" SET "leaseExpiresAt"=NOW()-interval '1 second'
          WHERE "id" LIKE $1 AND "cancelRequestedAt" IS NOT NULL AND "status"='RUNNING'`,[`${prefix}-%`]);
        assert.equal(await qa.claim('orphan-recovery-3',60000,['cert-nonexistent']),null);
        assert.deepEqual(await progress(),{CANCELLED:50,DEAD_LETTER:40,RUNNING:10,QUEUED:5});
        // Non-cancelled leases with remaining attempts still use normal reclaim.
        const reclaimed=await qa.claim('orphan-reclaimer',60000,['cert-orphans']);
        assert(reclaimed && reclaimed.type==='test.orphan' && reclaimed.attempts===2);
        assert.equal(await qa.succeed(reclaimed,'orphan-reclaimer',{}),'SUCCEEDED');
      });
      // Isolation must be READ COMMITTED: the capacity query must obtain a
      // NEW snapshot after its workspace advisory lock is acquired.
      await check('certification transactions use READ COMMITTED snapshots', async()=>{
        const isolation=await a.query('SHOW default_transaction_isolation');
        assert.equal(isolation.rows[0]?.default_transaction_isolation, 'read committed');
      });
      const workspaceCases = async (queueA, queueB, concurrency, costBudget, costA, costB) => {
        const space=`shared-${randomBytes(5).toString('hex')}`;
        await qa.enqueue({type:'test.workspace',queue:queueA,workspaceId:space,costUnits:costA,payload:{}});
        await qb.enqueue({type:'test.workspace',queue:queueB,workspaceId:space,costUnits:costB,payload:{}});
        const [claimedA,claimedB]=await Promise.all([
          qa.claim('worker-a',60000,[queueA],concurrency,costBudget),
          qb.claim('worker-b',60000,[queueB],concurrency,costBudget),
        ]);
        const claimed=[claimedA,claimedB].filter(Boolean);
        assert.equal(claimed.length,1,'only one workspace job may be running');
        const snapshot=await a.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM("costUnits"),0)::int AS cost FROM "BackgroundJob" WHERE "workspaceId"=$1 AND "status"='RUNNING'`,[space]);
        assert.equal(snapshot.rows[0]?.count,1);
        assert(snapshot.rows[0]?.cost <= costBudget);
        const winner=claimedA?qa:qb;
        const workerId=claimedA?'worker-a':'worker-b';
        assert.equal(await winner.succeed(claimed[0],workerId,{ok:true}),'SUCCEEDED');
        const second=await qa.claim('worker-a-followup',60000,[queueA,queueB],concurrency,costBudget);
        assert(second && second.id!==claimed[0].id,'the remaining workspace job must be eligible after finalization');
        assert.equal(await qa.succeed(second,'worker-a-followup',{ok:true}),'SUCCEEDED');
      };
      await check('two PostgreSQL sessions respect workspace count=1 across different job queues', async()=>{
        await workspaceCases('cert-ws-a','cert-ws-b',1,20,1,1);
      });
      await check('two PostgreSQL sessions respect workspace running-cost budget', async()=>{
        await workspaceCases('cert-cost-a','cert-cost-b',4,5,3,3);
      });
      await check('independent PostgreSQL workspaces admit jobs concurrently',async()=>{
        const ws1=`ws1-${randomBytes(5).toString('hex')}`;
        const ws2=`ws2-${randomBytes(5).toString('hex')}`;
        await qa.enqueue({type:'test.workspace',queue:'cert-independent',workspaceId:ws1,payload:{}});
        await qa.enqueue({type:'test.workspace',queue:'cert-independent',workspaceId:ws2,payload:{}});
        const [x,y]=await Promise.all([
          qa.claim('worker-a',60000,['cert-independent'],1,2),
          qb.claim('worker-b',60000,['cert-independent'],1,2),
        ]);
        assert(x&&y&&x.workspaceId!==y.workspaceId);
        assert.equal(await qa.succeed(x,'worker-a',{}),'SUCCEEDED');
        assert.equal(await qb.succeed(y,'worker-b',{}),'SUCCEEDED');
      });
      console.log(`${checks}/${checks} TD2 real PostgreSQL queue checks passed (${major}, disposable schema dropped)`);
    } catch(error) {
      const message=String(error?.message||error).replaceAll(databaseUrl,'[redacted]');
      console.error('FAIL TD2 PostgreSQL certification:',message);
      process.exitCode=1;
    } finally {
      if(created){try{await clients[0].query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}catch{console.error('WARNING: temporary schema cleanup failed:',schema);process.exitCode=1;}}
      await Promise.all(clients.map(async c=>{try{await c.end();}catch{}}));
    }
  }
}
