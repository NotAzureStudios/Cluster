import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(base,file),'utf8');
const sourcePath = 'apps/server/src/domains/uploads/upload-session-runtime.ts';
const source = read(sourcePath);
const compiled = ts.transpileModule(source,{fileName:sourcePath,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
const mod = {exports:{}};
const deferredEvidence = [];
let failDeferredId = null;
const localRequire = (name) => {
  if (name === '../../core/uploads.js') return {safeFileName: s=>String(s)};
  if (name === '../../core/efficiency-metrics.js') return {recordEfficiencyMetric:()=>{}};
  if (name === './deferred-direct-upload-journal.js') return {recordDeferredDirectUpload:async ({session,reason})=>{
    if(session.id === failDeferredId) throw Error('deferred journal unavailable');
    deferredEvidence.push({uploadId:session.id,reason});return true;
  }};
  if (name.startsWith('node:')) return require(name);
  throw Error(`Unexpected runtime import: ${name}`);
};
new Function('require','module','exports',compiled.outputText)(localRequire,mod,mod.exports);
const {pruneExpiredUploads} = mod.exports;
let checks=0;
async function check(label,fn){await fn(); checks++; console.log('PASS',label);}
const expired = () => new Date(Date.now()-1000*3600*24*10);
const makeSession = (id,status='COMPLETED',mode='cluster',extra={}) => ({id,status,mode,expiresAt:expired(),ownerId:'owner',...extra});
const activeJob = (id,status='QUEUED') => ({type:'library.transfer.finalize',status,dedupeKey:`library-transfer:${id}`});
async function fixture(inputSessions, jobs=[], options={}) {
  const root = await mkdtemp(path.join(os.tmpdir(),'cluster-td2-retention-'));
  const sessions = new Map(inputSessions.map(s=>[s.id,s]));
  deferredEvidence.length = 0;
  failDeferredId = options.failJournalFor || null;
  const deleted=[]; const objectDeleted=[]; const aborted=[]; const jobQueries=[]; const sessionQueries=[];
  for(const s of inputSessions.filter(s=>s.mode!=='direct')){
    const dir=path.join(root,'uploads',s.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'payload.bin'),s.id);
  }
  const deps={
    dataLayout:{runtimeRoot:root},
    storageRuntime:{delete:async locator=>{objectDeleted.push(locator.key);},abortMultipartUpload:async (_loc,id)=>{aborted.push(id);}},
    prisma:{
      uploadSession:{
        findMany:async args=>{
          sessionQueries.push(args);
          const cursorClause=args.where.OR;
          return [...sessions.values()]
            .filter(s=>s.expiresAt<args.where.expiresAt.lt)
            .filter(s=>!cursorClause || cursorClause.some(clause=>clause.id ? s.expiresAt.getTime()===clause.expiresAt.getTime() && s.id>clause.id.gt : s.expiresAt>clause.expiresAt.gt))
            .sort((a,b)=>a.expiresAt-b.expiresAt||a.id.localeCompare(b.id)).slice(0,args.take);
        },
        findUnique:async({where})=>sessions.get(where.id)||null,
        updateMany:async({where,data})=>{const current=sessions.get(where.id);if(!current||current.status!==where.status)return {count:0};sessions.set(where.id,{...current,...data});return {count:1};},
        deleteMany:async({where})=>{const current=sessions.get(where.id);if(!current||current.status!==where.status)return {count:0};deleted.push(where.id);sessions.delete(where.id);return {count:1};},
        delete:async ({where})=>{deleted.push(where.id);sessions.delete(where.id);},
      },
      backgroundJob:{findMany:async ({where})=>{
        jobQueries.push(where);
        if(options.failLookup) throw Error('database lookup failed');
        return jobs.filter(j=>where.type===j.type && where.status.in.includes(j.status) && where.dedupeKey.in.includes(j.dedupeKey)).map(j=>({dedupeKey:j.dedupeKey}));
      }},
    },
  };
  return {root, deps,sessions,deleted,objectDeleted,aborted,jobQueries,sessionQueries,deferredEvidence,cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function useFixture(sessions,jobs,fn,options){ const f=await fixture(sessions,jobs,options);try{await fn(f);}finally{await f.cleanup();}}
await check('queued transfer keeps completed staged upload beyond TTL',()=>useFixture([makeSession('a')],[activeJob('a')],async f=>{
  assert.deepEqual(await pruneExpiredUploads(f.deps),{removed:0,protectedByJob:1,scanned:1});
  assert.deepEqual(f.deleted,[]); await access(path.join(f.root,'uploads','a','payload.bin'));
  assert.deepEqual(f.jobQueries[0].dedupeKey.in,['library-transfer:a']);
}));
await check('running transfer holds bytes until terminal state',()=>useFixture([makeSession('a')],[activeJob('a','RUNNING')],async f=>{
  await pruneExpiredUploads(f.deps);assert.equal(f.deleted.length,0);
}));
await check('completed/failed/cancelled transfers release their retention hold',()=>useFixture([makeSession('a'),makeSession('b'),makeSession('c')],[activeJob('a','SUCCEEDED'),activeJob('b','DEAD_LETTER'),activeJob('c','CANCELLED')],async f=>{
  const result=await pruneExpiredUploads(f.deps);
  assert.equal(result.removed,3);assert.deepEqual(f.deleted.sort(),['a','b','c']);
}));
await check('unowned completed direct upload is removed, held direct upload is not',()=>useFixture([
  makeSession('a','COMPLETED','direct',{storageProvider:'s3',storageTier:'warm',storageKey:'a'}),
  makeSession('b','COMPLETED','direct',{storageProvider:'s3',storageTier:'warm',storageKey:'b'}),
],[activeJob('a')],async f=>{
  const result=await pruneExpiredUploads(f.deps);assert.equal(result.protectedByJob,1);
  assert.deepEqual(f.objectDeleted,[]);assert.deepEqual(f.deleted,['b']);
  assert.deepEqual(f.deferredEvidence,[{uploadId:'b',reason:'expired'}]);
}));
await check('failed deferred evidence preserves a completed direct upload session',()=>useFixture([
  makeSession('b','COMPLETED','direct',{storageProvider:'s3',storageTier:'warm',storageKey:'b'}),
],[],async f=>{
  await assert.rejects(pruneExpiredUploads(f.deps),/deferred journal unavailable/);
  assert.deepEqual(f.deleted,[]); assert.deepEqual(f.objectDeleted,[]);
  assert.equal(f.sessions.has('b'),true);
},{failJournalFor:'b'}));
await check('non-completed uploads need no background-job lookup',()=>useFixture([makeSession('a','OPEN')],[],async f=>{
  await pruneExpiredUploads(f.deps);assert.deepEqual(f.jobQueries,[]);assert.deepEqual(f.deleted,['a']);
}));
await check('database failure fails closed without deleting staged files',()=>useFixture([makeSession('a')],[activeJob('a')],async f=>{
  await assert.rejects(pruneExpiredUploads(f.deps),/database lookup failed/);
  assert.deepEqual(f.deleted,[]);await access(path.join(f.root,'uploads','a','payload.bin'));
},{failLookup:true}));
await check('pagination skips 100 protected uploads and still cleans later expired sessions',()=>useFixture([
  ...Array.from({length:100},(_,i)=>makeSession(`a${String(i).padStart(3,'0')}`)),makeSession('z000'),
],Array.from({length:100},(_,i)=>activeJob(`a${String(i).padStart(3,'0')}`)),async f=>{
  const result=await pruneExpiredUploads(f.deps,1);
  assert.equal(result.removed,1);assert.equal(result.protectedByJob,100);assert.deepEqual(f.deleted,['z000']);
  assert.ok(f.sessionQueries.length>=2);
}));
await check('job types unrelated to Library never protect uploads',()=>useFixture([makeSession('a')],[{...activeJob('a'),type:'automation.calendar-scan'}],async f=>{
  const result=await pruneExpiredUploads(f.deps);assert.equal(result.removed,1);
}));
await check('producer and cleanup agree on Library job dedupe key and statuses',async()=>{
  const route=read('apps/server/src/domains/library/library-9e2-routes.ts');
  const queue=read('apps/server/src/domains/jobs/job-queue-service.ts');
  assert.match(route,/dedupeKey: `library-transfer:\$\{body\.uploadId\}`/);
  assert.match(queue,/const ACTIVE_STATUSES = \["QUEUED", "RUNNING"\]/);
  assert.match(source,/type: "library\.transfer\.finalize"/);
});
console.log(`PASS ${checks}/${checks} TD2 upload-retention checks`);
