#!/usr/bin/env node
/** G25 closeout acceptance: Ticket stage, analytics delegate, and PostgreSQL admission fence.
 * The SQL lock protocol still needs a real concurrent-transaction PostgreSQL test in certification.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
let passed=0;
async function test(name,callback){await callback();passed++;console.log('PASS G25 Closeout '+name)}
function load(path, mocks){
  const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(output,{module:mod,exports:mod.exports,require:(name)=>{if(name in mocks)return mocks[name];throw Error('Unexpected import '+name)},Date,JSON,Number,Set,Map,Object,Array,Error},{filename:path});
  return mod.exports;
}
const query=load('apps/server/src/domains/tickets/ticket-data-query.ts',{
 '@cluster/shared':{TICKET_DATA_FIELDS:[]},
 '../../core/data-query-analytics.js':{
  runPrismaScalarAnalytics:async()=>({total:3,facets:[],aggregations:{}}),
  clusterDataCountProjectionRollups:()=>({}),
  runPrismaGroupedProjections:async()=>[],clusterDataGroupSummaryProjections:()=>[],clusterDataProjectionGroupSummaries:()=>[],
 },
 '../../core/prisma-semantic-query.js':{createPrismaSemanticAdapters:()=>({}),compilePrismaDataFilterGroup:()=>null},
});
await test('resolved and rejected are independent queues',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(query.ticketQueueLaneWhere('resolved'))),{ticketStage:'resolved'});
 assert.deepEqual(JSON.parse(JSON.stringify(query.ticketQueueLaneWhere('rejected'))),{ticketStage:'rejected'});
 assert.deepEqual(JSON.parse(JSON.stringify(query.ticketQueueLaneWhere('closed'))),{ticketStage:{in:['resolved','rejected']}});
});
await test('Ticket facet and projected grouping resolve canonical BoardList delegate',async()=>{
 const requested=[];
 const prisma={
  boardList:{findMany:async({where})=>{requested.push(where);return [{id:'L1',title:'Bugs',board:{name:'Production',project:{name:'Alpha'}}}]}},
  card:{groupBy:async()=>[{listId:'L1',_count:{_all:3}}],count:async()=>1},
 };
 const response=await query.ticketDataQueryAnalytics(prisma,{}, {
  facets:['listTitle','projectName','queueLane'],projections:[{id:'by-project',kind:'group',dimensions:['projectName'],measures:[{id:'count',kind:'count'}],limit:20}],aggregations:[],groups:[],filters:null,
 },['B1']);
 assert.equal(response.facets.find(x=>x.fieldId==='listTitle').buckets[0].value,'Bugs');
 assert.equal(response.facets.find(x=>x.fieldId==='projectName').buckets[0].value,'Alpha');
 assert.equal(response.projections[0].rows[0].keys[0],'Alpha');
 assert.equal(requested.length,3);
 assert.ok(response.facets.find(x=>x.fieldId==='queueLane').buckets.some(x=>x.value==='rejected'));
});
await test('Ticket UI and semantic field contract display separate rejected queue',()=>{
 const ui=readFileSync('packages/renderer/src/features/tickets/TicketSystemPage.tsx','utf8');
 const fields=readFileSync('packages/shared/src/domain-data-fields.ts','utf8');
 assert.match(ui,/Rejected <strong>\{ticketQueueCounts\.rejected\}<\/strong>/);
 assert.match(ui,/queue === "rejected" \? rejectedTickets/);
 assert.match(ui,/ticketStage === "resolved"/);
 assert.match(ui,/ticketStage === "rejected"/);
 assert.match(fields,/"queueLane"[^\n]+"rejected"/);
});
const migration=readFileSync('apps/server/prisma/migrations/20261027000000_td6_g25_active_card_admission/migration.sql','utf8');
await test('database admission protects all active Card insertions and unarchives',()=>{
 assert.match(migration,/BEFORE INSERT OR UPDATE OF "listId", "archived" ON "Card"/);
 assert.match(migration,/NEW\."archived" IS NOT TRUE/);
 assert.match(migration,/FOR SHARE OF l, b/);
 assert.match(migration,/list_archived OR board_archived/);
 assert.match(migration,/Card_active_destination_unarchived/);
 assert.match(readFileSync('apps/server/src/domains/boards/board-list-lifecycle.ts','utf8'),/isolationLevel: "Serializable"/);
});
const http=load('apps/server/src/core/http-errors.ts',{
 'zod':{z:{ZodError:class extends Error {}}},'@cluster/shared':{clusterErrorCodeForStatus:()=> 'REQUEST_FAILED',clusterErrorDefinition:()=>null},
});
await test('trigger conflict is mapped into actionable 409 without exposing SQL internals',()=>{
 const normalized=http.normalizeHttpError({code:'P2004',meta:{constraint:'Card_active_destination_unarchived'}},'req1');
 assert.equal(normalized.statusCode,409);assert.equal(normalized.body.code,'CARD_DESTINATION_ARCHIVED');
 assert.match(normalized.body.error,/No Card or Ticket was created/);assert.equal(normalized.body.requestId,'req1');
});
await test('transaction serialization contention is retryable conflict, not a 500',()=>{
 const result=http.normalizeHttpError({code:'P2034'},'req2');
 assert.equal(result.statusCode,409);assert.equal(result.body.code,'CONCURRENT_WRITE_CONFLICT');
});
await test('unrelated database constraint errors retain existing handling',()=>{
 const result=http.normalizeHttpError({code:'P2004',meta:{constraint:'unrelated_constraint'}},'req3');
 assert.equal(result.statusCode,500);
});
console.log(`${passed}/${passed} G25 WS17 integration checks passed`);
