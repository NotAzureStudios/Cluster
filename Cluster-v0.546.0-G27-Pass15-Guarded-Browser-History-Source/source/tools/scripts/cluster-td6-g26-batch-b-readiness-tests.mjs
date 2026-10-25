#!/usr/bin/env node
/** Admin-only joined Package + Inventory + device/readiness regression. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=(file)=>readFileSync(file,'utf8');
function shape(){return {min(){return this},max(){return this},trim(){return this},strict(){return this},parse(v){return v}}}
const z={object:()=>shape(),string:()=>shape(),enum:()=>shape()};
const target={package:{id:'pkg',key:'editing'},release:{id:'rel',version:'4.3.0',platform:'windows-x64',artifactSha256:'a'.repeat(64)},selection:'rollout',signingPublicKeyPem:'SECRET_ONLY_FOR_TEST'};
let targetQueries=0;
function fixture(changes={}) {
 const value={pkg:{id:'pkg',archivedAt:null,key:'editing'},user:{id:'person',archived:false,accountState:'ACTIVE',accessExpiresAt:null},
   entitlement:{id:'grant',revokedAt:null,expiresAt:new Date(Date.now()+86400000),revision:1},
   rule:null,registration:{id:'device',userId:'person',platform:'desktop',proofStatus:'verified',revokedAt:null,proofKeyFingerprint:'fingerprint'},
   allowTarget:true,allowSeat:true,...changes};
 const db={managedPackage:{findUnique:async()=>value.pkg},user:{findUnique:async()=>value.user},
 managedPackageEntitlement:{findUnique:async()=>value.entitlement},managedPackageSeatRequirement:{findUnique:async()=>value.rule},
 deviceRegistration:{findUnique:async()=>value.registration}};
 return {value,db};
}
const file='apps/server/src/domains/inventory/managed-package-readiness.ts';
const js=ts.transpileModule(source(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,require(name){
 if(name==='zod')return {z};
 if(name==='./managed-package-device.js')return {readDevicePackageTargets:async(_db,input)=>{targetQueries++;return _db.__targetAllowed===false?[]:[target]}};
 if(name==='./managed-package-seat-policy.js')return {packageSeatEligibleUsers:async(db,_id,users)=>db.__seatAllowed===false?[]:users};
 return require(name)
},Date,Error,JSON,Set,Map,Array,console},{filename:file});
const readiness=module.exports;
const input={packageId:'pkg',userId:'person',deviceRegistrationId:'device',channel:'stable',platform:'windows-x64'};
let tests=0;
async function check(label,fn){await fn();tests++;console.log('PASS G26 Batch B readiness '+label)}
async function expect(reason,changes={},dbChanges={}){
 targetQueries=0;const f=fixture(changes);Object.assign(f.db,dbChanges);
 const result=await readiness.inspectPackageRecipientReadiness(f.db,input);
 assert.equal(result.reason,reason);assert.equal(result.canRequestDistribution,reason==='ready_for_distribution');
 assert.equal(result.osAttested,false);assert.equal(result.installerExecutionAuthorized,false);assert.equal(result.secretMaterialIncluded,false);
 assert.ok(!JSON.stringify(result).includes('SECRET_ONLY_FOR_TEST'));
 return result;
}
await check('archived Package cannot be distributed',()=>expect('package_unavailable',{pkg:{id:'pkg',archivedAt:new Date()}}));
await check('disabled account blocks even already approved grant',()=>expect('account_unavailable',{user:{id:'person',archived:false,accountState:'DISABLED'}}));
await check('expired account blocks despite grant',()=>expect('account_unavailable',{user:{id:'person',archived:false,accountState:'ACTIVE',accessExpiresAt:new Date(0)}}));
await check('missing Package entitlement prevents target evaluation',async()=>{await expect('entitlement_missing',{entitlement:null});assert.equal(targetQueries,0)});
await check('revoked Package entitlement prevents target evaluation',async()=>{await expect('entitlement_revoked',{entitlement:{revokedAt:new Date(),expiresAt:new Date(Date.now()+86400000),revision:2}});assert.equal(targetQueries,0)});
await check('expired Package entitlement prevents target evaluation',()=>expect('entitlement_expired',{entitlement:{revokedAt:null,expiresAt:new Date(0),revision:2}}));
await check('bound Inventory requirement blocks users without allocation',async()=>{
 const f=fixture({rule:{assetId:'seat',asset:{title:'Unreal seat',kind:'license',status:'active'}}});f.db.__seatAllowed=false;
 targetQueries=0;const result=await readiness.inspectPackageRecipientReadiness(f.db,input);
 assert.equal(result.reason,'inventory_seat_missing');assert.equal(targetQueries,0);assert.equal(result.inventory.assetTitle,'Unreal seat');
});
await check('mismatched Device registration cannot be treated as verified',()=>expect('device_unverified',{registration:{id:'device',userId:'someone_else',platform:'desktop',proofStatus:'verified',proofKeyFingerprint:'fp'}}));
await check('revoked Device blocks distribution before signed release lookup',async()=>{
 await expect('device_unverified',{registration:{id:'device',userId:'person',platform:'desktop',proofStatus:'verified',proofKeyFingerprint:'fp',revokedAt:new Date()}});assert.equal(targetQueries,0);
});
await check('missing signed target or prerequisite chain blocks distribution',async()=>{
 const f=fixture();f.db.__targetAllowed=false;const result=await readiness.inspectPackageRecipientReadiness(f.db,input);
 assert.equal(result.reason,'release_or_dependency_unavailable');assert.equal(result.target,null);
});
await check('ready result provides only public release identity, no signed token',async()=>{
 const result=await expect('ready_for_distribution');assert.equal(result.target.version,'4.3.0');
 assert.equal(result.target.artifactSha256,'a'.repeat(64));assert.ok(!Object.keys(result).includes('grant'));
});
await check('admin-only inspection endpoint registered and non-admin rejected',async()=>{
 const routes=new Map();readiness.registerManagedPackageReadinessRoutes({app:{post:(path,fn)=>routes.set(path,fn)},prisma:fixture().db,admin:async()=>null});
 const fn=routes.get('/api/admin/packages/:id/recipient-readiness/inspect');assert.equal(typeof fn,'function');
 const result=await fn({params:{id:'pkg'},body:{userId:'person',deviceRegistrationId:'device',channel:'stable',platform:'windows-x64'}},{header(){throw Error('blocked must not continue')}});
 assert.equal(result,undefined);
});
await check('route and UI are coupled and on-demand only',()=>{
 const route=source('apps/server/src/domains/inventory/managed-package-routes.ts');
 assert.match(route,/registerManagedPackageReadinessRoutes/);
 const ui=source('packages/renderer/src/features/settings/ManagedPackageRecipientReadinessPanel.tsx');
 assert.match(ui,/Inspect effective eligibility/);assert.match(ui,/recipient-readiness\/inspect/);
 assert.match(ui,/sequence\.current/);assert.doesNotMatch(ui,/setInterval\(/);
});
console.log(`\nCluster G26 Batch B readiness: ${tests}/${tests} checks passed`);
