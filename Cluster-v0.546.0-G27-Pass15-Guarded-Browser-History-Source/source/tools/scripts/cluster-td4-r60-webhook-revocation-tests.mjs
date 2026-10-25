/** TD4 R60: webhook endpoint revocation/reconfiguration during async preparation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'));}})();
const file='apps/server/src/domains/integrations/webhook-service.ts';
const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(output.diagnostics?.length||0,0);
let sends=0;
const mocks={
 'node:crypto':{default:crypto,randomUUID:crypto.randomUUID},
 '../../core/circuit-breaker.js':{CircuitBreaker:class{async execute(_key,fn){return fn();}},CircuitOpenError:class extends Error{}},
 '../../core/reliability-context.js':{currentReliabilityContext:()=>({workspaceId:'studio'})},
 '../../core/outbound-http.js':{secureOutboundFetch:async()=>{sends++;return {status:204};},validateOutboundUrl:(url)=>new URL(url)},
 '../../core/setting-crypto.js':{encryptSecuritySecret:(_key,value)=>value,decryptSecuritySecret:(_key,value)=>value},
};
const mod={exports:{}};
vm.runInNewContext(output.outputText,{module:mod,exports:mod.exports,require:id=>{if(!(id in mocks))throw Error('Unexpected import '+id);return mocks[id];},Buffer,Date,JSON,String,Number,Math,Set,Map,Array,Error,Promise,console,URL,performance}, {filename:file});
const create=mod.exports.createWebhookIntegrationService;
const payload=JSON.stringify({schemaVersion:1,id:'event-1',type:'activity.recorded',workspaceId:'studio',projectId:null,payload:{id:'source-activity'}});
const signature=crypto.createHash('sha256').update(payload,'utf8').digest('hex');
let checks=0;
async function test(label,fn){await fn();checks++;console.log('PASS',label);}
function harness(onCredentialRead=()=>{},onEndpointLoad=()=>{}){
 const endpoint={id:'endpoint-1',enabled:true,workspaceId:'studio',projectId:null,eventTypes:'["activity.recorded"]',signingCredentialId:'credential-1',
  encryptedUrl:'https://example.com/webhook',timeoutMs:5000,allowPrivateNetwork:false,allowHttpPrivateNetwork:false};
 const record={id:'delivery-1',endpointId:endpoint.id,eventId:'event-1',eventType:'activity.recorded',encryptedPayload:payload,payloadHash:signature,status:'PENDING',attempts:0,endpoint:null};
 const prisma={
  integrationWebhookDelivery:{
   findUnique:async ({where,include})=>{if(where.id!==record.id)return null; if(include)onEndpointLoad(endpoint,record); return {...record,...(include?{endpoint:{...endpoint}}:{})};},
   updateMany:async ({where,data})=>{if(record.id!==where.id||!where.status.in.includes(record.status))return {count:0};Object.assign(record,data);return {count:1};},
   update:async ({where,data})=>{assert.equal(where.id,record.id);Object.assign(record,data);return {...record};},
  },
  integrationWebhookEndpoint:{
   findUnique:async ({where})=>where.id===endpoint.id&&!endpoint.deleted?{...endpoint}:null,
   update:async ({data})=>{Object.assign(endpoint,Object.fromEntries(Object.entries(data).filter(([,v])=>typeof v!=='object'||v instanceof Date)));return {...endpoint};},
  },
  $transaction:async parts=>Promise.all(parts),
 };
 const service=create({prisma,queue:{enqueue:async()=>{}},events:{subscribe:()=>()=>{}},credentials:{webhookSecret:async()=>{onCredentialRead(endpoint);return 'shared-secret';}}});
 return {service,record,endpoint};
}
await test('unchanged enabled endpoint sends once and marks delivery successful',async()=>{
 const {service,record}=harness(); sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.delivered,true);assert.equal(record.status,'SUCCEEDED');assert.equal(sends,1);
});
await test('disable during async credential resolution cancels delivery before network dispatch',async()=>{
 const {service,record}=harness(endpoint=>{endpoint.enabled=false;});sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.skipped,true);assert.equal(result.reason,'endpoint_disabled');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('endpoint deleted during asynchronous preparation cannot receive queued webhook',async()=>{
 // A deleted endpoint becomes a null authority read even when the included
 // delivery snapshot was valid at the start of the attempt.
 const {service,record}=harness(e=>{e.deleted=true;});sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.reason,'endpoint_disabled');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('URL change during credential resolution forces retry with new endpoint policy',async()=>{
 const {service,record}=harness(endpoint=>{endpoint.encryptedUrl='https://different.example.com/hook';});sends=0;
 await assert.rejects(service.deliver(record.id,1,7),/configuration changed during delivery preparation/);
 assert.equal(record.status,'RETRYING');assert.equal(sends,0);
});
await test('event scope and subscriptions cannot silently change during outbound preparation',async()=>{
 const {service,record}=harness(endpoint=>{endpoint.projectId='project-new';endpoint.eventTypes='["different.event"]';});sends=0;
 await assert.rejects(service.deliver(record.id,1,7),/configuration changed during delivery preparation/);
 assert.equal(record.status,'RETRYING');assert.equal(sends,0);
});
await test('signing credential rotation cannot send a stale signature',async()=>{
 const {service,record}=harness(endpoint=>{endpoint.signingCredentialId='credential-2';});sends=0;
 await assert.rejects(service.deliver(record.id,1,7),/configuration changed during delivery preparation/);
 assert.equal(record.status,'RETRYING');assert.equal(sends,0);
});
await test('network policy change cannot dispatch under stale private-network allowance',async()=>{
 const {service,record}=harness(endpoint=>{endpoint.allowPrivateNetwork=true;});sends=0;
 await assert.rejects(service.deliver(record.id,1,7),/configuration changed during delivery preparation/);
 assert.equal(record.status,'RETRYING');assert.equal(sends,0);
});
await test('disabled at initial load is cancelled without credential or network access',async()=>{
 const {service,record,endpoint}=harness(()=>{throw Error('should not call credentials');});endpoint.enabled=false;sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.reason,'endpoint_disabled');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('removing an event subscription cancels an already queued delivery',async()=>{
 const {service,record}=harness(()=>{},endpoint=>{endpoint.eventTypes='["different.event"]';});sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.reason,'endpoint_audience_changed');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('re-scoping an endpoint cancels pending deliveries from its former Project',async()=>{
 const {service,record}=harness(()=>{},endpoint=>{endpoint.projectId='project-2';});sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.reason,'endpoint_audience_changed');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('moving endpoint to another Studio blocks old Workspace deliveries',async()=>{
 const {service,record}=harness(()=>{},endpoint=>{endpoint.workspaceId='other-studio';});sends=0;
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.reason,'endpoint_audience_changed');assert.equal(record.status,'CANCELLED');assert.equal(sends,0);
});
await test('manual endpoint test bypasses the normal event filters only with matching test identity',async()=>{
 const {service,record,endpoint}=harness(()=>{},entry=>{entry.eventTypes='["another.event"]';entry.projectId='project-2';});sends=0;
 const testPayload=JSON.stringify({id:'event-1',type:'integration.webhook.test',workspaceId:'studio',projectId:'project-2',payload:{test:true,endpointId:endpoint.id}});
 record.eventType='integration.webhook.test';record.encryptedPayload=testPayload;
 record.payloadHash=crypto.createHash('sha256').update(testPayload,'utf8').digest('hex');
 const result=await service.deliver(record.id,1,7);
 assert.equal(result.delivered,true);assert.equal(record.status,'SUCCEEDED');assert.equal(sends,1);
});
await test('tampered stored event identity cannot be dispatched even with matching content checksum',async()=>{
 const {service,record}=harness();sends=0;
 record.encryptedPayload=JSON.stringify({id:'different-event',type:'activity.recorded',workspaceId:'studio',payload:{}});
 record.payloadHash=crypto.createHash('sha256').update(record.encryptedPayload,'utf8').digest('hex');
 await assert.rejects(service.deliver(record.id,1,7),/envelope identity does not match/);
 assert.equal(record.status,'RETRYING');assert.equal(sends,0);
});
console.log(`R60 webhook endpoint revocation: ${checks}/${checks} checks passed`);
