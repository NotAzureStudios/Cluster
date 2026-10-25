import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url), base=path.resolve(import.meta.dirname,'../..');
let ts;try{ts=require('typescript')}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}
const read=f=>fs.readFileSync(path.join(base,f),'utf8');
function load(relative){const source=read(relative);const {outputText,diagnostics}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(diagnostics?.length||0,0,relative);const exports={};vm.runInNewContext(outputText,{exports,require:s=>s.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(relative),s.replace(/\.js$/,'.ts')))):require(s),Buffer,Date,Math,Number,String,Boolean,JSON,Set,Map,Error,Promise,Object,console},{filename:relative});return exports;}
let count=0;function ok(cond,message){assert.ok(cond,message);count++}function eq(a,b,message){assert.equal(JSON.stringify(a),JSON.stringify(b),message);count++}
const { NATIVE_EVENT_DEFINITIONS,validateNativeJournalEvent,readNativeJournal,nativeEventKey } = load('apps/server/src/core/operations-native-alert-reader.ts');
const { reconcileNativeEmergencyEvents,findUnreconciledNativeEvents } = load('apps/server/src/core/operations-native-alert-reconciliation.ts');
const codes=Object.keys(NATIVE_EVENT_DEFINITIONS);
eq(codes.length,14,'fourteen allowlisted native event codes including network rollback');
const go=read('apps/native-alerts-go/alerts.go');
for(const [code,desc] of Object.entries(NATIVE_EVENT_DEFINITIONS)){
  ok(go.includes(`Code = "${code}"`),`${code} exactly supported by native Go`);
  ok(go.includes(JSON.stringify(desc.message)),`${code} message byte-equivalent to native Go`);
  ok(go.includes(`{"${desc.severity}", ${JSON.stringify(desc.message)}}`),`${code} severity byte-equivalent to native Go`);
}
const now=new Date('2026-10-23T20:00:00Z');
function event(code,id='a'.repeat(32), occurredAt='2026-10-23T19:00:00Z') {const def=NATIVE_EVENT_DEFINITIONS[code];return {version:1,id,code,severity:def.severity,message:def.message,occurredAt};}
const valid=event('api_start_failed');ok(validateNativeJournalEvent(valid,now),'valid known event');
for(const corrupt of [{...valid,message:'inject sensitive URL'}, {...valid, code:'rogue'}, {...valid, severity:'info'}, {...valid,id:'../x'}, {...valid,unexpected:'x'}, {...valid,version:9}, {...valid,occurredAt:'2026-10-24T00:00:00Z'}, {...valid,occurredAt:'not a time'}, {...valid,occurredAt:'2026-10-23T19:00:00+00:00'}])eq(validateNativeJournalEvent(corrupt,now),null,'untrusted event rejected');
const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'cluster-native-p4-'));const dir=path.join(temp,'data/system/operations/native-alerts');await fsp.mkdir(dir,{recursive:true});
function name(id,extension,seq='20261023T190000.000000000Z'){return `${seq}-${id}.${extension}`}
await fsp.writeFile(path.join(dir,name(valid.id,'pending')),JSON.stringify(valid));
await fsp.writeFile(path.join(dir,name('b'.repeat(32),'sent','20261023T190000.123000000Z')),JSON.stringify(event('api_recovered','b'.repeat(32),'2026-10-23T19:00:00.123Z')));
await fsp.writeFile(path.join(dir,name('c'.repeat(32),'pending','20261023T190000.100000000Z')),JSON.stringify(event('api_process_exited','c'.repeat(32),'2026-10-23T19:00:00.1Z')));
await fsp.writeFile(path.join(dir,name('d'.repeat(32),'sent')),JSON.stringify({...valid,id:'d'.repeat(32),message:'evil'}));
await fsp.writeFile(path.join(dir,name('e'.repeat(32),'sent')),'x'.repeat(5000));
await fsp.writeFile(path.join(dir,name('f'.repeat(32),'writing')),JSON.stringify(event('gateway_bind_failed','f'.repeat(32))));
await fsp.symlink(path.join(dir,name(valid.id,'pending')),path.join(dir,name('f'.repeat(32),'sent')));
const journal=await readNativeJournal(temp,now);eq(journal.events.length,3,'pending and sent read, bad inputs not used');eq(journal.invalid,2,'malformed and oversized entries reported');
eq(journal.events.map(e=>e.id),[valid.id,'c'.repeat(32),'b'.repeat(32)],'chronological order including mixed fractional timestamps');eq((await readNativeJournal(path.join(temp,'nonexistent'),now)).missing,true,'missing journal not a fatal error');
const incidents=new Map(),receipts=new Map(),timeline=[],resources=[],notices=[],dispatches=new Set();let incNo=0,noticeNo=0,published=[];
const tx={
  operationsNativeAlertReceipt:{findFirst:async ({where})=> [...receipts.values()].filter(r=>r.category===where.category).sort((a,b)=>b.occurredAtOrdinal.localeCompare(a.occurredAtOrdinal)||b.id.localeCompare(a.id))[0]||null,create:async({data})=>{if(receipts.has(data.id))throw Object.assign(Error('duplicate'),{code:'P2002'});receipts.set(data.id,{...data});},update:async({where,data})=>{Object.assign(receipts.get(where.id),data)}},
  operationsIncident:{findUnique:async({where})=>where.automationKey?incidents.get(where.automationKey)||null:[...incidents.values()].find(r=>r.id===where.id)||null,create:async({data})=>{if(incidents.has(data.automationKey))throw Object.assign(Error('dup'),{code:'P2002'});const row={id:`inc${++incNo}`,...data,acknowledgedAt:null,ownerUserId:null};incidents.set(row.automationKey,row);return row},updateMany:async({where,data})=>{const row=[...incidents.values()].find(r=>r.id===where.id);if(!row||where.status&&!where.status.in.includes(row.status)||where.alertCycle!==undefined&&where.alertCycle!==row.alertCycle||where.severity?.not===row.severity)return {count:0};Object.assign(row,data,{alertCycle:typeof data.alertCycle==='object'?row.alertCycle+data.alertCycle.increment:row.alertCycle});return {count:1}}},
  operationsIncidentResource:{create:async({data})=>{resources.push(data)}},operationsIncidentTimeline:{create:async({data})=>{timeline.push(data)}},
  operationsAlertPolicy:{findUnique:async()=>null},workspaceMember:{findMany:async()=>[{userId:'admin'}]},
  operationsIncidentAlertDispatch:{createMany:async({data})=>{let n=0;for(const d of data){const key=`${d.incidentId}:${d.cycle}:${d.stage}:${d.userId}`;if(!dispatches.has(key)){dispatches.add(key);n++}}return {count:n}}},
  notificationInboxItem:{create:async({data})=>{const row={id:`inbox${++noticeNo}`,...data};notices.push(row);return row}},
};
const prisma={$transaction:async fn=>fn(tx),operationsNativeAlertReceipt:{findMany:async({where})=>where.id.in.filter(id=>receipts.has(id)).map(id=>({id}))}};
const onCommitted=rows=>published.push(...rows);
eq((await findUnreconciledNativeEvents(prisma,[])).length,0,'empty spool has no DB read');
const historical=Array.from({length:40},(_,i)=>event('api_start_failed',i.toString(16).padStart(32,'0'),'2026-10-23T19:00:00Z'));
for(const entry of historical.slice(0,32)) receipts.set(entry.id,{id:entry.id,occurredAt:new Date(entry.occurredAt),category:'api-process',occurredAtOrdinal:'2026-10-23T19:00:00.000000000Z'});
eq((await findUnreconciledNativeEvents(prisma,historical)).length,8,'completed historical receipts cannot starve newer events');
for(const entry of historical.slice(0,32)) receipts.delete(entry.id);
let r=await reconcileNativeEmergencyEvents({prisma,events:[valid],now,onCommitted});
eq(r.created,1,'first verified supervisor failure opens incident');eq(r.notified,1,'uses canonical authorized inbox');eq(incidents.size,1,'only canonical incident persisted');eq(receipts.size,1,'native event receipt committed');ok(notices[0].entityType==='operations_incident','native notice navigates to canonical incident');
eq(incidents.get(nativeEventKey('api-process')).ownerUserId,'admin','selected responder owns incident');
r=await reconcileNativeEmergencyEvents({prisma,events:[valid],now,onCommitted});eq(r.duplicates,1,'repeat event has no secondary incident transaction');eq(notices.length,1,'retry no duplicate Inbox');
r=await reconcileNativeEmergencyEvents({prisma,events:[event('api_process_exited','c'.repeat(32),'2026-10-23T19:00:00.1Z')],now,onCommitted});eq(r.evidence,1,'later failures add evidence to same incident');eq(notices.length,1,'no repeated initial notification');
let held=incidents.get(nativeEventKey('api-process'));held.status='investigating';
r=await reconcileNativeEmergencyEvents({prisma,events:[event('api_recovered','b'.repeat(32),'2026-10-23T19:00:00.123Z')],now,onCommitted});eq(r.ignored,1,'operator investigation not automatically resolved');eq(held.status,'investigating','human investigation preserved');
const more=event('api_recovered','e'.repeat(32),'2026-10-23T19:01:00Z');held.status='monitoring';r=await reconcileNativeEmergencyEvents({prisma,events:[more],now,onCommitted});eq(r.resolved,1,'later confirmed recovery resolves monitored incident');eq(held.status,'resolved','canonical status resolved');
r=await reconcileNativeEmergencyEvents({prisma,events:[event('api_start_failed','d'.repeat(32),'2026-10-23T19:00:59Z')],now,onCommitted});eq(r.ignored,1,'late failure cannot reopen after newer recovery');eq(held.status,'resolved','no regressed health state');
r=await reconcileNativeEmergencyEvents({prisma,events:[event('api_start_failed','f'.repeat(32),'2026-10-23T19:10:00Z')],now,onCommitted});eq(r.reopened,1,'new verified failure reopens once');eq(held.alertCycle,2,'fresh incident alert cycle');eq(notices.length,2,'reopen sends one fresh notification');
// A noncritical process crash followed by exhausted recovery must become
// critical and issue a fresh priority-critical notification without duplicates.
held.severity='high';
r=await reconcileNativeEmergencyEvents({prisma,events:[event('api_recovery_exhausted','2'.repeat(32),'2026-10-23T19:10:01Z')],now,onCommitted});
eq(r.escalated,1,'confirmed recovery exhaustion upgrades existing incident');
eq(held.severity,'critical','canonical severity upgraded');
eq(notices.length,3,'critical upgrade issues fresh deduplicated notice');
eq(notices[2].priority,'critical','severity upgrade pages as critical');

for(const code of ['gateway_bind_failed','api_runtime_readiness_lost','host_unexpected_exit']){
  const id=String.fromCharCode(103+receipts.size).repeat(32);r=await reconcileNativeEmergencyEvents({prisma,events:[event(code,id,'2026-10-23T19:11:00Z')],now,onCommitted});eq(r.created,1,`${code} category separate incident`);
}
eq(incidents.size,4,'four native incident categories');
const badDB={$transaction:async()=>{throw Error('DATABASE_UNAVAILABLE')}};
await assert.rejects(reconcileNativeEmergencyEvents({prisma:badDB,events:[event('api_recovered','1'.repeat(32),'2026-10-23T19:12:00Z')],now}),/DATABASE_UNAVAILABLE/);count++;
ok(read('apps/server/src/core/operations-native-alert-reader.ts').includes('nativeEventOrdinal'), 'nanosecond native ordering retained');
const schema=read('apps/server/prisma/schema.prisma');ok(schema.includes('model OperationsNativeAlertReceipt'),'native event receipt model');
ok(read('apps/server/prisma/migrations/20261110000000_f2_native_emergency_incident_receipts/migration.sql').includes('CREATE TABLE "OperationsNativeAlertReceipt"'),'DB migration exists');
const server=read('apps/server/src/app/cluster-server.ts');ok(server.includes('native-emergency-incident-reconcile'),'production scheduler connected');ok(server.includes('readNativeJournal(BOOT_WORKSPACE_ROOT)'),'uses only trusted workspace path');ok(server.includes('notificationService.publishRecords(records)'),'inbox publish reused');
ok(read('apps/server/src/core/operations-incident-alert-routing.ts').includes('cluster:native:api-dependencies'),'native routing configured');ok(read('packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx').includes('Native Windows host'),'native routing UI labels');
const routes=read('apps/server/src/domains/operations/operations-incident-routes.ts');
ok(routes.includes('/api/admin/operations/native-emergency-history'),'read-only admin history route wired');
ok(routes.includes('const admin = await requireAdminUserForRequest(request, reply);'),'native history bound to existing admin authorization');
ok(routes.includes('select: { id: true, code: true, category: true, outcome: true'),'history returns a bounded allowlist, not raw journal files');
const ui=read('packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx');
ok(ui.includes('onClick={() => void loadNativeHistory()}'),'native history fetched only upon user click');
ok(ui.includes('Native supervisor recovery evidence'),'history visibly integrated into Operations');
ok(server.includes('findUnreconciledNativeEvents(prisma, journal.events)'),'scheduler prevents old receipt starvation');
console.log(`Cluster F2 P4 Native Incident Reconciliation: ${count}/${count} assertions passed`);
await fsp.rm(temp,{recursive:true,force:true});
