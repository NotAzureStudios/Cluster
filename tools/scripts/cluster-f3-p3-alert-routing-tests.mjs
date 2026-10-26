import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript')); }
const root = new URL('../../',import.meta.url);
const read = (name) => fs.readFileSync(new URL(name,root),'utf8');
function load(name) {
  const compiled = ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(compiled.diagnostics?.length||0,0,`TypeScript diagnostics for ${name}`);
  const exports={};
  vm.runInNewContext(compiled.outputText,{exports,Date,Math,Number,String,Boolean,JSON,Set,Map,Error,Promise,Object}, {filename:name});
  return exports;
}
const engine=load('apps/server/src/core/operations-incident-alert-routing.ts');
const {defaultAlertPolicy,validateAlertPolicy,eligibleAlertAdminIds,resolveAlertRecipients,alertStageForIncident,deliverIncidentAlert,reconcileIncidentEscalations}=engine;
let n=0;
const eq=(a,b,label)=>{assert.equal(a,b,label);n++;};
const check=(value,label)=>{assert.ok(value,label);n++;};
const same=(a,b,label)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),b,label);n++;};
const now=new Date('2026-10-23T15:00:00Z');
const storage='cluster:dependency:storage';
const def=defaultAlertPolicy(storage);
check(validateAlertPolicy(def),'valid default route');
check(!validateAlertPolicy({...def,key:'custom:web-url'}),'reject untrusted keys');
check(!validateAlertPolicy({...def,recipientType:'user',recipientId:null}),'required owner target');
check(!validateAlertPolicy({...def,escalationType:'team',escalationId:null}),'required escalation target');
check(!validateAlertPolicy({...def,reminderMinutes:0}),'reject zero wait');
check(!validateAlertPolicy({...def,acknowledgeMinutes:1441}),'reject unbounded wait');
const personIds=['admin01','admin02'];
let membershipCount=0;
const tx={
 workspaceMember:{findMany:async opts=>{membershipCount++;check(opts.where.user.accountState.notIn.includes('SUSPENDED'),'active state filter');check(opts.where.user.OR[1].accessExpiresAt.gt instanceof Date,'expiry filter');return personIds.map(userId=>({userId}));}},
 studioTeam:{findFirst:async ()=>({leadUserId:'admin01',members:[{userId:'admin02'},{userId:'not-admin'}]})},
 department:{findFirst:async ()=>({leadUserId:'admin01'})},
 employment:{findMany:async ()=>[{userId:'admin02'},{userId:'not-admin'}]},
};
same(await eligibleAlertAdminIds(tx,now),personIds,'eligible admins unique');
same(await resolveAlertRecipients(tx,def,'initial',now),personIds,'default recipients');
same(await resolveAlertRecipients(tx,{...def,recipientType:'user',recipientId:'admin01'},'initial',now),['admin01'],'individual route');
same(await resolveAlertRecipients(tx,{...def,recipientType:'user',recipientId:'not-admin'},'initial',now),personIds,'ineligible target falls back to admins');
same(await resolveAlertRecipients(tx,{...def,recipientType:'team',recipientId:'team01'},'initial',now),personIds,'team assigned and non-admin excluded');
same(await resolveAlertRecipients(tx,{...def,recipientType:'department',recipientId:'department01'},'initial',now),personIds,'department assigned and non-admin excluded');
same(await resolveAlertRecipients(tx,{...def,recipientType:'user',recipientId:'admin01',escalationType:'user',escalationId:'admin02'},'escalation-1',now),['admin02'],'escalation ownership independent');
const overflow={...tx,workspaceMember:{findMany:async()=>Array.from({length:65},(_,i)=>({userId:String(i)}))}};
await assert.rejects(()=>eligibleAlertAdminIds(overflow,now),/SCOPE_EXCEEDED/);n++;
const incident=(age,ack=null,status='open')=>({openedAt:new Date(now.getTime()-age*60000),acknowledgedAt:ack,status});
eq(alertStageForIncident(incident(1),def,now),null,'too early for reminder');
eq(alertStageForIncident(incident(10),def,now),'reminder-1','first reminder');
eq(alertStageForIncident(incident(14),def,now),'reminder-1','same reminder bucket');
eq(alertStageForIncident(incident(15),def,now),'escalation-1','escalation takes priority');
eq(alertStageForIncident(incident(30),def,now),'escalation-2','later escalation');
eq(alertStageForIncident(incident(0,new Date()),def,now),null,'acknowledged stops escalation');
eq(alertStageForIncident(incident(30,null,'resolved'),def,now),null,'resolved stops escalation');
eq(alertStageForIncident(incident(30),{...def,enabled:false},now),null,'disabled routing suppresses');
eq(alertStageForIncident(incident(-2),def,now),null,'future incident does not escalate');
const notices=[];const receipts=new Set();const timeline=[];let row={id:'i1',title:'Storage unavailable',summary:'Contains sensitive info, do not echo',severity:'critical',status:'open',automationKey:storage,alertCycle:1,openedAt:incident(12).openedAt,acknowledgedAt:null};
const routeTx={...tx,
 operationsAlertPolicy:{findUnique:async()=>null},
 operationsIncidentAlertDispatch:{findFirst:async ({where})=>[...receipts].some(k=>k.startsWith([where.incidentId,where.cycle,where.stage].join(':')+':'))?{id:'found'}:null,createMany:async ({data})=>{const d=data[0];const k=[d.incidentId,d.cycle,d.stage,d.userId].join(':');if(receipts.has(k))return {count:0};receipts.add(k);return {count:1};}},
 notificationInboxItem:{create:async ({data})=>{const value={...data,id:`n${notices.length+1}`};notices.push(value);return value;}},
 operationsIncidentTimeline:{create:async({data})=>{timeline.push(data);return data;}},
 operationsIncident:{findUnique:async()=>row,findMany:async()=>[row],updateMany:async({where})=>({count:row.acknowledgedAt===null&&row.alertCycle===where.alertCycle?1:0})},
};
let delivered=await deliverIncidentAlert(routeTx,row,'initial',now);
eq(delivered.length,2,'initial fanout bounded');
check(delivered.every(x=>x.category==='system'&&x.entityId==='i1'),'notifications reference authoritative incident');
check(delivered.every(x=>!x.message.includes('sensitive info')),'notification body redacts diagnostic summary');
eq(receipts.size,2,'initial unique receipts');
eq((await deliverIncidentAlert(routeTx,row,'initial',now)).length,0,'same stage idempotent');
eq(receipts.size,2,'no duplicate dispatch');
eq((await deliverIncidentAlert(routeTx,row,'reminder-1',now)).length,2,'new stage delivers new receipts');
eq(receipts.size,4,'new stage stores receipts');
row={...row,alertCycle:2};
eq((await deliverIncidentAlert(routeTx,row,'initial',now)).length,2,'reopen cycle re-notifies');
eq(receipts.size,6,'reopen fenced by cycle');
let published=[];
const prisma={...routeTx,$transaction:async fn=>fn(routeTx)};
row={...row,openedAt:incident(16).openedAt};
let result=await reconcileIncidentEscalations({prisma,now,onCommitted:(records)=>published.push(...records)});
eq(result.scanned,1,'one incident scanned');
eq(result.delivered,2,'escalation delivered');
eq(published.length,2,'publish after commit');
eq((await reconcileIncidentEscalations({prisma,now})).delivered,0,'repeated sweep deduplicated');
row.acknowledgedAt=now;
eq((await reconcileIncidentEscalations({prisma,now})).delivered,0,'acknowledged incident not escalated');
row.acknowledgedAt=null;row.status='mitigating';row.openedAt=incident(35).openedAt;
eq((await reconcileIncidentEscalations({prisma,now})).delivered,2,'later bounded escalation');
row.status='closed';
eq((await reconcileIncidentEscalations({prisma,now})).delivered,0,'closed incident not alerted');
const noAdmins={...routeTx,workspaceMember:{findMany:async()=>[]}};
eq((await deliverIncidentAlert(noAdmins,{...row,alertCycle:3},'initial',now)).length,0,'empty admin list does not leak privileged notices');
const policyCode=read('apps/server/src/domains/operations/operations-incident-routes.ts');
check(policyCode.includes('await deps.verifyUserPin(admin, body.securityPin'), 'protected routing changes require PIN');
check(policyCode.includes('expectedRevision')&&read('apps/server/src/core/operations-incident-alert-policies.ts').includes('revision: { increment: 1 }'), 'configuration edits revision guarded');
check(policyCode.includes('/acknowledge')&&policyCode.includes('acknowledgedAt: null'), 'incident acknowledgement separate from inbox ack');
check(policyCode.includes('requireAdminUserForRequest'), 'admin-only route');
check(read('apps/server/src/app/cluster-server.ts').includes('operations-incident-alert-escalation'),'one server scheduler executes sweeps');
check(read('apps/server/src/app/cluster-server.ts').includes('verifyUserPin });'),'production routes receive PIN verification dependency');
const schema=read('apps/server/prisma/schema.prisma');
check(schema.includes('model OperationsIncidentAlertDispatch')&&schema.includes('@@unique([incidentId, cycle, stage, userId])'),'durable receipt uniqueness in Prisma');
check(schema.includes('model OperationsAlertPolicy')&&schema.includes('acknowledgedById String?'),'policy and acknowledgement persisted');
check(read('apps/server/prisma/migrations/20261109000000_f4_incident_alert_routing/migration.sql').includes('CREATE UNIQUE INDEX'),'matching migration supplied');
check(read('packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx').includes('Save all alert settings'),'one-PIN batch UI exists');
check(policyCode.includes('batchPolicyMutationSchema')&&policyCode.includes('commitOperationsAlertPolicyBatch'),'batch settings route present');
check(policyCode.includes('new Set(body.policies.map')&&policyCode.includes('policyMutationSchema.omit'),'duplicate keys and batch field validation');
console.log(`Cluster F3 P3 Alert Routing & Escalation: ${n}/${n} assertions passed`);
