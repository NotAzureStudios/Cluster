#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);const ts=require('typescript');
const read=p=>readFileSync(p,'utf8');
function load(file){const code=ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,Date,Object,Promise,Error,Set,console},{filename:file});return module.exports;}
const base='apps/server/src/domains/inventory/';
const {settleOffboardingCredentials}=load(base+'offboarding-credential-settlement.ts');
const {inspectOffboardingCredentialClosure}=load(base+'offboarding-credential-reconciliation.ts');
let checks=0;
async function test(label,fn){await fn();console.log('PASS G26 Batch H',label);checks++}
const now=new Date('2026-11-12T10:30:00Z');
function fixture(){
 const keys=[{id:'keyA',vaultSecretId:'vaultA',userId:'u1',status:'assigned',firstRevealedAt:now,revision:1},
             {id:'keyB',vaultSecretId:'vaultB',userId:'u1',status:'assigned',firstRevealedAt:null,revision:1},
             {id:'keyOther',vaultSecretId:'vaultOther',userId:'u2',status:'assigned',firstRevealedAt:null,revision:1}];
 const vaults=[{id:'vaultA',revokedAt:null,revision:1},{id:'vaultB',revokedAt:null,revision:1},{id:'vaultOther',revokedAt:null,revision:1}];
 const pkg=[{id:'pkgA',userId:'u1',revokedAt:null,revision:1},{id:'pkgOther',userId:'u2',revokedAt:null,revision:1}];
 const inventory=[{id:'request1',userId:'u1',status:'pending'},{id:'requestOther',userId:'u2',status:'pending'}];
 const packages=[{id:'request2',userId:'u1',status:'pending'}];
 const notices=[{groupKey:'inventory-approval:request1',requiresAction:true},{groupKey:'package-entitlement:request2',requiresAction:true}];
 const evidence=[];
 let fail=false, mutate=()=>{};
 function apply(rows,where,data) {let count=0;for(const r of rows){if(where.userId&&r.userId!==where.userId)continue;if(where.status&&r.status!==where.status)continue;
  if(where.revokedAt===null&&r.revokedAt!==null)continue;
  if(where.id?.in&&!where.id.in.includes(r.id))continue;
  if(where.groupKey?.in&&!where.groupKey.in.includes(r.groupKey))continue;
  if(where.requiresAction&&r.requiresAction!==where.requiresAction)continue;
  if(data.status)r.status=data.status;
  if(data.revokedAt!==undefined)r.revokedAt=data.revokedAt;
  if(data.closedAt)r.closedAt=data.closedAt;
  if(data.reviewReason)r.reviewReason=data.reviewReason;
  if(data.requiresAction!==undefined)r.requiresAction=data.requiresAction;
  if(data.revokedReason)r.revokedReason=data.revokedReason;
  if(data.revision?.increment)r.revision=(r.revision||0)+data.revision.increment;
  count++;
 } return {count}; }
 const d={
   studioInventoryKey:{findMany:async({where,take})=>keys.filter(r=>r.userId===where.userId&&r.status===where.status).slice(0,take),
     updateMany:async({where,data})=>{mutate();return apply(keys,where,data)}},
   studioVaultSecret:{updateMany:async({where,data})=>{if(fail)throw Error('vault transaction unavailable');return apply(vaults,where,data)}},
   managedPackageEntitlement:{updateMany:async({where,data})=>apply(pkg,where,data)},
   studioInventoryAccessRequest:{findMany:async({where,take})=>inventory.filter(r=>r.userId===where.userId&&r.status===where.status).slice(0,take),
     updateMany:async({where,data})=>apply(inventory,where,data)},
   managedPackageEntitlementRequest:{findMany:async({where,take})=>packages.filter(r=>r.userId===where.userId&&r.status===where.status).slice(0,take),
     updateMany:async({where,data})=>apply(packages,where,data)},
   workspaceMember:{findMany:async()=>[{userId:"admin1"},{userId:"admin2"}]},
   notificationInboxItem:{createMany:async({data})=>{evidence.push(...data);return {count:data.length}},updateMany:async({where,data})=>apply(notices,where,data)},
 };
 return {db:d, keys,vaults,pkg,inventory,packages,notices,evidence,
   setFail(v){fail=v},onKeyUpdate(fn){mutate=fn}};
}
const input={subjectUserId:'u1',caseId:'case1',actorId:'admin1',now};
await test('assigned keys, Vault key access, Package grants, two approval types settle together',async()=>{
 const f=fixture(),result=await settleOffboardingCredentials(f.db,input);
 assert.equal(result.assignedKeysRevoked,2);assert.equal(result.keyVaultSecretsRevoked,2);
 assert.equal(result.packageEntitlementsRevoked,1);assert.equal(result.pendingInventoryRequestsCancelled,1);
 assert.equal(result.pendingPackageRequestsCancelled,1);assert.equal(result.exposedKeysRequireExternalReview,1);
 assert.equal(result.externalProviderRevocationVerified,false);assert.equal(result.standaloneVaultCredentialsAutomaticallyRotated,false);
 assert.equal(f.keys.find(k=>k.id==='keyOther').status,'assigned');assert.equal(f.vaults.find(v=>v.id==='vaultOther').revokedAt,null);
 assert.equal(f.pkg.find(p=>p.id==='pkgOther').revokedAt,null);assert.equal(f.inventory.find(x=>x.id==='requestOther').status,'pending');
});
await test('revealed-key rotation remains an actionable admin task with no secret identifiers',async()=>{
 const f=fixture();await settleOffboardingCredentials(f.db,input);assert.equal(f.evidence.length,2);
 const notice=f.evidence[0];assert.equal(notice.userId,'admin1');assert.equal(notice.requiresAction,true);
 assert.doesNotMatch(JSON.stringify(notice),/keyA|keyB|vaultA|vaultB|ciphertext|fingerprint/);
});
await test('closed access approvals no longer appear as actionable Inbox review tasks',async()=>{
 const f=fixture();await settleOffboardingCredentials(f.db,input);
 assert.deepEqual(f.notices.map(n=>n.requiresAction),[false,false]);
});
await test('idempotent repeat does not create duplicate dispositions or rotation alerts',async()=>{
 const f=fixture();await settleOffboardingCredentials(f.db,input);
 const result=await settleOffboardingCredentials(f.db,input);
 assert.equal(result.assignedKeysRevoked,0);assert.equal(result.packageEntitlementsRevoked,0);
 assert.equal(result.pendingInventoryRequestsCancelled,0);assert.equal(f.evidence.length,2);
});
await test('unrevealed-only keys never generate a rotation alert',async()=>{
 const f=fixture();f.keys[0].firstRevealedAt=null;
 const result=await settleOffboardingCredentials(f.db,input);
 assert.equal(result.exposedKeysRequireExternalReview,0);assert.equal(f.evidence.length,0);
});
await test('self-offboarding routes obligations to surviving active administrators',async()=>{
 const f=fixture();await settleOffboardingCredentials(f.db,{...input,actorId:'u1'});
 assert.deepEqual(f.evidence.map(x=>x.userId),['admin1','admin2']);
});
await test('malformed/larger-than-bound key scopes fail before modifying access',async()=>{
 const f=fixture();for(let i=0;i<1000;i++)f.keys.push({id:'extra'+i,vaultSecretId:'v'+i,userId:'u1',status:'assigned'});
 await assert.rejects(settleOffboardingCredentials(f.db,input),/Too many assigned keys/);
 assert.equal(f.keys.find(k=>k.id==='keyA').status,'assigned');assert.equal(f.pkg[0].revokedAt,null);
});
await test('oversize pending approval scopes fail before modifying any grant',async()=>{
 const f=fixture();for(let i=0;i<1000;i++)f.inventory.push({id:'pending'+i,userId:'u1',status:'pending'});
 await assert.rejects(settleOffboardingCredentials(f.db,input),/Too many pending credential reviews/);
 assert.equal(f.keys[0].status,'assigned');assert.equal(f.pkg[0].revokedAt,null);
});
await test('changed custody fails closed instead of silently accepting partial key revocation',async()=>{
 const f=fixture();f.onKeyUpdate(()=>{f.keys.find(k=>k.id==='keyB').status='redeemed'});
 await assert.rejects(settleOffboardingCredentials(f.db,input),/custody changed during offboarding/);
});
await test('database failures propagate; caller must roll back offboarding transaction',async()=>{
 const f=fixture();f.setFail(true);
 await assert.rejects(settleOffboardingCredentials(f.db,input),/vault transaction unavailable/);
});
function scanDb({residual=false,many=false}={}){
 const calls=[];
 const db={deviceRegistration:{findMany:async(x)=>{calls.push(['devices',x]);return many?Array.from({length:1001},(_,i)=>({id:'d'+i})):[{id:'d1'}]}},
  studioInventoryAllocation:{count:async(x)=>{calls.push(['seat',x]);return residual?1:0}},
  studioInventoryKey:{count:async()=>0},managedPackageEntitlement:{count:async()=>0},
  studioInventoryAccessRequest:{count:async()=>0},managedPackageEntitlementRequest:{count:async()=>0},
  managedPackagePin:{count:async(x)=>{calls.push(['pin',x]);return 0}}};return {db,calls};
}
await test('clean post-closeout reconciliation reports zero remaining grants',async()=>{
 const {db,calls}=scanDb();const outcome={assignedKeysRevoked:2,packageEntitlementsRevoked:1};
 const r=await inspectOffboardingCredentialClosure(db,{subjectUserId:'u1',caseId:'case1',outcome});
 assert.equal(r.operatorReviewRequired,false);assert.equal(r.residualAccessDetected,false);
 assert.equal(r.secretValuesIncluded,false);assert.equal(r.providerSideKeyRotationVerified,false);
 assert.deepEqual(calls.find(c=>c[0]==='pin')[1].where.deviceId.in,['d1']);
});
await test('remaining digital access is reported as outstanding rather than corrected silently',async()=>{
 const {db}=scanDb({residual:true});const r=await inspectOffboardingCredentialClosure(db,{subjectUserId:'u1',caseId:'case1',outcome:{assignedKeysRevoked:1,packageEntitlementsRevoked:1}});
 assert.equal(r.remaining.digitalSeats,1);assert.equal(r.residualAccessDetected,true);assert.equal(r.operatorReviewRequired,true);
});
await test('historical exposed keys remain flagged even after all Cluster access ends',async()=>{
 const {db}=scanDb();const r=await inspectOffboardingCredentialClosure(db,{subjectUserId:'u1',caseId:'case1',outcome:{assignedKeysRevoked:1,packageEntitlementsRevoked:1,exposedKeysRequireExternalReview:3}});
 assert.equal(r.operatorReviewRequired,true);assert.equal(r.exposedPreviouslyRevealedKeys,3);
});
await test('older cases without credential settlement evidence remain review-required',async()=>{
 const {db}=scanDb();const r=await inspectOffboardingCredentialClosure(db,{subjectUserId:'u1',caseId:'case1',outcome:{}});
 assert.equal(r.legacySettlementEvidenceMissing,true);assert.equal(r.operatorReviewRequired,true);
});
await test('unbounded device inventories fail rather than report false clean state',async()=>{
 const {db}=scanDb({many:true});await assert.rejects(inspectOffboardingCredentialClosure(db,{subjectUserId:'u1',caseId:'case1',outcome:{}}),/bounded inspection scope/);
});
await test('real route locks User before credential settlement and retains physical custody',()=>{
 const s=read('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts');
 assert.match(s,/claimOffboardingRevision\(tx, current, "active"\);[\s\S]*SELECT "id" FROM "User"[\s\S]*settleOffboardingCredentials\(tx/);
 assert.match(s,/physicalCustodyOutstanding/);assert.match(s,/inventoryAllocationsRevoked/);
 assert.match(s,/credentialSettlement,[\s\S]*physicalCustodyOutstanding/);
});
await test('Inventory and Package grant/review paths lock recipient before eligibility',()=>{
 const a=read('apps/server/src/domains/inventory/studio-inventory-approvals.ts');
 assert.match(a,/validateTarget\([\s\S]*SELECT "id" FROM "User"[\s\S]*tx\.user\.findUnique/);
 const b=read('apps/server/src/domains/inventory/managed-package-entitlements.ts');
 assert.match(b,/async function recipient\([\s\S]*SELECT "id" FROM "User"[\s\S]*tx\.user\.findUnique/);
 assert.match(b,/const user = await recipient\(tx, pending\.userId\)/);
});
await test('credential rotation tasks are hidden after administrator role loss',()=>{
 const s=read('apps/server/src/domains/notifications/notification-visibility.ts');
 assert.match(s,/item\?\.signal === "offboarding_key_rotation_review"/);
});
await test('credential inspection is gated and only available after completed offboarding',()=>{
 const s=read('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts');
 assert.match(s,/credential-review"[\s\S]*authorization\.requireAdmin\(request, reply\)[\s\S]*requireAdmin\(request, reply\)/);
 assert.match(s,/row\.status !== "completed"/);
 assert.match(s,/Cache-Control", "no-store"/);
});
await test('UI advertises key and Package disposition and post-closure reconciliation',()=>{
 const s=read('packages/renderer/src/features/settings/StudioOffboardingPanel.tsx');
 for(const x of ['Commercial keys to revoke','Package entitlements to revoke','Previously revealed keys','Inspect credential closure','external provider'])assert.ok(s.includes(x),x);
});
await test('Prisma scope uses exact actual models and never selects encryptedValue for settlement',()=>{
 const schema=read('apps/server/prisma/schema.prisma');
 for(const model of ['StudioInventoryKey','StudioVaultSecret','ManagedPackageEntitlement','StudioInventoryAccessRequest','ManagedPackageEntitlementRequest'])assert.ok(schema.includes('model '+model+' {'));
 const source=read(base+'offboarding-credential-settlement.ts')+read(base+'offboarding-credential-reconciliation.ts');
 assert.doesNotMatch(source,/select:\s*\{[^}]*encryptedValue:/);
 assert.match(source,/externalProviderRevocationVerified: false/);
});
console.log(`G26 Batch H offboarding lifecycle: ${checks}/${checks} passed`);
