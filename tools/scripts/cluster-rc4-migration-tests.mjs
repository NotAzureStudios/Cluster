import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryDecision, BROKEN_MIGRATION } from './migration-recovery.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationRoot = path.join(root, 'apps/server/prisma/migrations');
const file = fs.readFileSync(path.join(migrationRoot, BROKEN_MIGRATION, 'migration.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root,'apps/server/prisma/schema.prisma'),'utf8');
let passed=0;
function check(name,fn){fn();console.log('PASS',name);passed++;}
const indexNames=[];
for(const entry of fs.readdirSync(migrationRoot,{withFileTypes:true})) {
 if(!entry.isDirectory())continue;
 const f=path.join(migrationRoot,entry.name,'migration.sql');if(!fs.existsSync(f))continue;
 const sql=fs.readFileSync(f,'utf8');
 const pattern=/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"\r\n]+)"|([A-Za-z_][\w$]*))/gi;
 for(const match of sql.matchAll(pattern))indexNames.push({full:match[1]||match[2],migration:entry.name});
}
const indexMap=new Map();for(const row of indexNames){const key=Buffer.from(row.full).subarray(0,63).toString();const prev=indexMap.get(key);assert.equal(prev,undefined,`PostgreSQL 63-byte index collision: ${prev?.full} and ${row.full}`);indexMap.set(key,row);}
check('all migration CREATE INDEX names remain collision free at 63 PostgreSQL bytes',()=>assert.ok(indexNames.length>700));
check('G21 migration retains per-user unique index and foreign key',()=>{
 assert.match(file,/CREATE UNIQUE INDEX "CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceStartsAt_userId_key"/);
 assert.match(file,/CalendarMeetingOccurrenceResponse_calendarEventId_fkey/);
 assert.doesNotMatch(file,/CREATE INDEX "CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceStartsAt_idx"/);
});
check('Prisma model relies on unique B-tree prefix rather than redundant index',()=>{
 const model=schema.match(/model CalendarMeetingOccurrenceResponse \{([\s\S]*?)\n\}/)?.[1];assert.ok(model);
 assert.match(model,/@@unique\(\[calendarEventId, occurrenceStartsAt, userId\]\)/);
 assert.doesNotMatch(model,/@@index\(\[calendarEventId, occurrenceStartsAt\]\)/);
});
const failed=[{migration_name:BROKEN_MIGRATION, logs:'Database error code: 42P07: relation "CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceSta" already exists'}];
const pkey='CalendarMeetingOccurrenceResponse_pkey';
const index='CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceSta';
const columns=['id','calendarEventId','occurrenceStartsAt','userId','rsvpStatus','attendanceStatus','revision','updatedByUserId','updatedAt'];
const partial={failed,tableExists:true,columns,indexes:[{indexname:pkey,indexdef:'CREATE UNIQUE INDEX "'+pkey+'" ON public...'}, {indexname:index,indexdef:'CREATE UNIQUE INDEX "'+index+'" ON public."CalendarMeetingOccurrenceResponse" USING btree ("calendarEventId", "occurrenceStartsAt", "userId")'}],constraints:[{conname:pkey,contype:'p'}],rowCount:0};
check('known empty partial RC3 G21 table is recoverable',()=>assert.equal(recoveryDecision(partial).action,'drop-empty-partial-and-resolve'));
check('known failed migration with no committed table is recoverable',()=>assert.equal(recoveryDecision({...partial,tableExists:false}).action,'resolve-only'));
check('completed migrations require no repair',()=>assert.equal(recoveryDecision({...partial,failed:[]}).action,'none'));
check('table with user data is never dropped',()=>assert.equal(recoveryDecision({...partial,rowCount:1}).action,'refuse'));
check('unrelated failed migrations are never resolved',()=>assert.equal(recoveryDecision({...partial,failed:[{...failed[0],migration_name:'unrelated'}]}).action,'refuse'));
check('unexpected extra failed migrations are never resolved',()=>assert.equal(recoveryDecision({...partial,failed:[...failed,...failed]}).action,'refuse'));
check('unknown failure log is never resolved',()=>assert.equal(recoveryDecision({...partial,failed:[{...failed[0],logs:'disk was full'}]}).action,'refuse'));
check('modified table schema is never dropped',()=>assert.equal(recoveryDecision({...partial,columns:[...columns,'extraField']}).action,'refuse'));
check('additional indexes prevent automatic drop',()=>assert.equal(recoveryDecision({...partial,indexes:[...partial.indexes,{indexname:'some_other_index',indexdef:'...'}]}).action,'refuse'));
check('additional constraints prevent automatic drop',()=>assert.equal(recoveryDecision({...partial,constraints:[...partial.constraints,{conname:'unexpected',contype:'f'}]}).action,'refuse'));
console.log(`${passed}/${passed} RC4 migration safety checks passed, scanned ${indexNames.length} index declarations`);
// End-to-end fake-PostgreSQL interaction tests. These exercise the real
// recovery query flow without needing a database in the source-check phase.
import { recoverRc3MeetingOccurrenceMigration } from './migration-recovery.mjs';
const mkDatabase = ({ exists, count = 0, fakeIndexes = partial.indexes, fakeColumns = columns, fakeConstraints = partial.constraints, fakeFailures = failed }) => {
 const statements = [];
 class Client {
  async connect(){statements.push('CONNECT');}
  async end(){statements.push('END');}
  async query(sql) {
   statements.push(sql);
   if(sql.includes('FROM public."_prisma_migrations"'))return {rows:fakeFailures};
   if(sql.includes('to_regclass'))return {rows:[{table_name:exists ? TABLE_NAME : null}]};
   if(sql.includes('information_schema.columns'))return {rows:fakeColumns.map(column_name=>({column_name}))};
   if(sql.includes('FROM pg_indexes'))return {rows:fakeIndexes};
   if(sql.includes('FROM pg_constraint'))return {rows:fakeConstraints};
   if(sql.includes('count(*)::integer'))return {rows:[{n:count}]};
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('LOCK TABLE')||sql.includes('pg_advisory_xact_lock')||sql.includes('DROP TABLE'))return {rows:[]};
   throw new Error('Unexpected recovery SQL: '+sql);
  }
 }
 return {Client,statements};
};
const TABLE_NAME = 'CalendarMeetingOccurrenceResponse';
const cfg={root:'/portable/Cluster', config:{portable:false,directUrl:'postgresql://unused@127.0.0.1/fake'}};
const absent=mkDatabase({exists:false});let resolved=0;
assert.equal(await recoverRc3MeetingOccurrenceMigration({...cfg,makeClient:absent.Client,resolveRolledBack:async()=>{resolved++;}}),true);
check('rollback-only recovery uses Prisma resolve and never drops absent table',()=>{
 assert.equal(resolved,1);assert.ok(!absent.statements.some(s=>s.includes('DROP TABLE')));
});
const empty=mkDatabase({exists:true});
assert.equal(await recoverRc3MeetingOccurrenceMigration({...cfg,makeClient:empty.Client,resolveRolledBack:async()=>{resolved++;}}),true);
check('known partial empty G21 table is locked then dropped before Prisma resolve',()=>{
 assert.equal(resolved,2);
 const joined=empty.statements;
 assert.ok(joined.findIndex(s=>s.includes('LOCK TABLE'))<joined.findIndex(s=>s.includes('DROP TABLE')));
 assert.ok(joined.findIndex(s=>s.includes('DROP TABLE'))<joined.indexOf('COMMIT'));
});
const populated=mkDatabase({exists:true,count:2});
await assert.rejects(()=>recoverRc3MeetingOccurrenceMigration({...cfg,makeClient:populated.Client,resolveRolledBack:async()=>{resolved++;}}),/contains data/);
check('populated G21 fails closed, sends ROLLBACK and never resolves migration',()=>{
 assert.ok(!populated.statements.some(s=>s.includes('DROP TABLE')));
 assert.ok(populated.statements.includes('ROLLBACK'));assert.equal(resolved,2);
});
console.log(`${passed}/${passed} RC4 checks passed including mocked PostgreSQL recovery`);
