import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
const root = new URL('../../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
function load(name) {
 const parsed = ts.transpileModule(read(name), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(parsed.diagnostics?.length||0,0,`${name} has no syntax diagnostics`);
 const exports={};vm.runInNewContext(parsed.outputText,{exports,require:(specifier)=>{
   if(!specifier.startsWith('.'))throw Error(`Unexpected module ${specifier}`);
   return load(path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier.replace(/\.js$/,'.ts'))));
 },Date,Math,Number,String,Boolean,JSON,Set,Map,Error,Promise,Object}, {filename:name});return exports;
}
let n=0;const check=(v,m)=>{assert.ok(v,m);n++;};const eq=(a,b,m)=>{assert.equal(a,b,m);n++;};
const { SustainedDependencyIncidentDetector, reconcileDependencyIncidents } = load('apps/server/src/core/operations-dependency-incidents.ts');
const bad = (key,status) => ({stale:false,sampledAt:'2026-10-23T12:00:00Z',signals:[{key,status,detail:'Failure without credentials.'}]});
const detector=new SustainedDependencyIncidentDetector(2);
eq(detector.evaluate(bad('storage','fail')).length,0,'one failure insufficient');
let candidates=detector.evaluate(bad('storage','fail'));
eq(candidates.length,1,'two failures established');
eq(candidates[0].status,'failed','failure event type');
eq(candidates[0].key,'storage','storage failure mapped');
eq(detector.evaluate({...bad('storage','fail'),stale:true}).length,0,'stale probe ignored');
eq(detector.evaluate(bad('storage','unknown')).length,0,'unknown probe resets streak');
eq(detector.evaluate(bad('storage','fail')).length,0,'streak reset after gap');
candidates=detector.evaluate(bad('storage','fail'));
eq(candidates.length,1,'confirmed again');
eq(detector.evaluate(bad('storage','pass')).length,0,'one pass insufficient');
candidates=detector.evaluate(bad('storage','pass'));
eq(candidates[0].status,'recovered','two passes confirm recovery');
eq(detector.evaluate(bad('database','fail')).length,0,'database first fail not incident');
eq(detector.evaluate(bad('database','fail')).length,0,'DB outage not falsely persisted through DB-only path');
eq(detector.evaluate(bad('lifecycle','fail')).length,0,'intentional maintenance not automatically an incident');
const records = new Map(); const timelines=[]; const resources=[]; const notices=[]; const receipts=new Set(); let newId=0;let txCalls=0;
const tx={
 operationsIncident:{
  findUnique:async ({where}) => where.automationKey ? records.get(where.automationKey)||null : [...records.values()].find(x=>x.id===where.id)||null,
  create:async ({data})=> {if(records.has(data.automationKey)) throw Object.assign(Error('unique'),{code:'P2002'}); const row={...data,id:`inc${++newId}`,openedAt:new Date('2026-10-23T12:00:00Z')}; records.set(data.automationKey,row);return row;},
  updateMany:async ({where,data})=> {const row=[...records.values()].find(x=>x.id===where.id);if(!row||(where.status&&!where.status.in.includes(row.status)))return {count:0};Object.assign(row,data,{alertCycle: typeof data.alertCycle === "object" ? row.alertCycle+data.alertCycle.increment : (data.alertCycle??row.alertCycle)});return {count:1};},
 },
 operationsAlertPolicy:{findUnique:async ()=>null},
 operationsIncidentAlertDispatch:{createMany:async ({data})=>{let count=0;for(const d of data){const k=`${d.incidentId}:${d.cycle}:${d.stage}:${d.userId}`;if(!receipts.has(k)){receipts.add(k);count++}}return {count};}},
 operationsIncidentResource:{create:async ({data})=>{resources.push(data);return data;}},
 operationsIncidentTimeline:{create:async ({data})=>{timelines.push(data);return data;}},
 workspaceMember:{findMany:async ()=>[{userId:'admin01'},{userId:'admin02'},{userId:'admin01'}]},
 notificationInboxItem:{create:async ({data})=>{const row={...data,id:`notice${notices.length+1}`};notices.push(row);return row;}},
};
const prisma={$transaction:async f=>{txCalls++;return f(tx);}};
let published=[];
const commit=rows=>{published.push(...rows)};
const fail=[{key:'storage',status:'failed',summary:'Writable storage is unavailable'}];
let result=await reconcileDependencyIncidents({prisma,candidates:fail,onCommitted:commit});
eq(result.created,1,'one persisted incident opened');
eq(result.notified,2,'two unique admin recipients');
eq(published.length,2,'inbox delivered to live stream only after commit');
eq(resources.length,1,'canonical resource linkage');
check(timelines.some(x=>x.kind==='status'),'canonical status timeline');
check(records.get('cluster:dependency:storage').ownerUserId==='admin01','owned by responsible admin fallback');
check(notices.every(x=>x.entityType==='operations_incident'&&x.requiresAction),'notices link to real actionable incidents');
check(notices.every(x=>x.category==='system'&&x.priority==='critical'),'critical storage alert');
result=await reconcileDependencyIncidents({prisma,candidates:fail,onCommitted:commit});
eq(result.unchanged,1,'repeat failure idempotent');
eq(notices.length,2,'no notification storms');
eq(timelines.filter(x=>x.kind==='status').length,1,'no duplicate status event');
result=await reconcileDependencyIncidents({prisma,candidates:[{key:'storage',status:'recovered',summary:'OK'}],onCommitted:commit});
eq(result.resolved,1,'recovered auto incident resolved');
eq(timelines.filter(x=>x.kind==='resolution').length,1,'resolution recorded');
eq(records.get('cluster:dependency:storage').status,'resolved','canonical incident status updated');
result=await reconcileDependencyIncidents({prisma,candidates:[{key:'storage',status:'recovered',summary:'OK'}],onCommitted:commit});
eq(result.unchanged,1,'repeat recovery idempotent');
eq(timelines.filter(x=>x.kind==='resolution').length,1,'no repeat resolution events');
result=await reconcileDependencyIncidents({prisma,candidates:fail,onCommitted:commit,now:new Date('2026-10-23T13:00:00Z')});
eq(result.reopened,1,'new failure reopens same correlated incident');
eq(notices.length,4,'reopened incident delivers new assigned alert');
eq(records.size,1,'no duplicate incident rows');
eq(resources.length,1,'resource link not duplicated');
records.get('cluster:dependency:storage').status='investigating';
result=await reconcileDependencyIncidents({prisma,candidates:[{key:'storage',status:'recovered',summary:'OK'}],onCommitted:commit});
eq(result.unchanged,1,'active human investigation preserved');
eq(records.get('cluster:dependency:storage').status,'investigating','human operator control respected');
let other=await reconcileDependencyIncidents({prisma,candidates:[{key:'background-tasks',status:'failed',summary:'Many workers failing'}],onCommitted:commit});
eq(other.created,1,'background task creates distinct canonical incident');
eq(records.get('cluster:dependency:background-tasks').severity,'high','background task severity bounded');
check(notices.slice(-2).every(x=>x.priority==='high'),'background incident correct priority');
const schema=read('apps/server/prisma/schema.prisma');
check(/model OperationsIncident\s*\{\s*automationKey String\?\s+@unique/.test(schema),'canonical incident schema adds nullable unique automation key');
check(read('apps/server/prisma/migrations/20261108000000_f3_api_dependency_incident_automation/migration.sql').includes('CREATE UNIQUE INDEX'),'replayable schema migration exists');
const server=read('apps/server/src/app/cluster-server.ts');
check(server.includes('reconcileDependencyIncidents({ prisma, candidates'),'production scheduler wired to canonical database');
check(server.includes('notificationService.publishRecords(records)'),'live updates reuse canonical notification service');
check(server.includes('if (backgroundMutationPermitted()) {') && server.includes('mayRunBackgroundMutation({ mode: SERVER_RUNTIME_MODE, ready: serverReady, draining: serverDraining })'),'no incident mutation during maintenance/drain');
const bridge=read('apps/server/src/core/operations-dependency-incidents.ts');
check(read('apps/server/src/core/operations-incident-alert-routing.ts').includes('if (memberships.length > 64) throw'),'recipient overflow fails closed');
check(bridge.includes('if (error?.code === "P2002")'),'cross-process insert race deduplicated');
check(!bridge.includes('fetch('),'no user supplied network calls');
console.log(`Cluster F3 P2 Durable Dependency Incidents: ${n}/${n} assertions passed`);
