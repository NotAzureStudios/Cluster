#!/usr/bin/env node
/** Grouped G26 B: independently entitled Package x Inventory seat custody. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const src = (path) => readFileSync(path, 'utf8');
function shape() { return {min(){return this},max(){return this},trim(){return this},regex(){return this},int(){return this},strict(){return this},extend(){return this},parse(value){return value}}; }
const z = {object:()=>shape(),string:()=>shape()};
function load(file, mocks = {}) {
  const code = ts.transpileModule(src(file), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require(name){return Object.hasOwn(mocks,name)?mocks[name]:require(name)},Date,Error,Buffer,Set,Map,Number,console},{filename:file});
  return module.exports;
}
const path = 'apps/server/src/domains/inventory/managed-package-seat-policy.ts';
const seat = load(path, {'zod':{z}});
let passed=0;
const check=async(label,fn)=>{await fn();passed++;console.log('PASS G26 Batch B '+label)};
const now = new Date('2026-11-01T00:00:00.000Z');
const future = new Date(now.getTime()+86400000), past = new Date(now.getTime()-86400000);
function fixture(opts={}) {
  const state = {asset:{id:'seat1',title:'Unreal seat',kind:'license',status:'active',revision:1},
    requirement:opts.binding?{packageId:'pkg',assetId:'seat1',revision:1,reason:'Required',createdAt:now}:null,
    grants:opts.grants||[{id:'e1',userId:'a',revision:1,expiresAt:future,revokedAt:null},{id:'e2',userId:'b',revision:1,expiresAt:future,revokedAt:null}],
    allocations:opts.allocations||[{id:'seat-a',userId:'a',assetId:'seat1',revision:1,quantity:1,status:'active',expiresAt:null}],
    pkg:{id:'pkg',archivedAt:null},audit:[],log:[]};
  const delegate = {
    managedPackageSeatRequirement:{findUnique:async()=>state.requirement,findMany:async({where})=>state.requirement&&where.packageId.in.includes('pkg')?[state.requirement]:[],create:async({data})=>(state.requirement={...data,createdAt:new Date(),revision:1})},
    studioInventoryAsset:{findUnique:async()=>state.asset},
    studioInventoryAllocation:{findMany:async({where})=>state.allocations.filter(a=>
      (Array.isArray(where.assetId?.in)?where.assetId.in.includes(a.assetId):where.assetId===a.assetId)
      && (where.userId?.in?where.userId.in.includes(a.userId):a.userId===where.userId)
      && a.status==='active' && a.quantity>=1 && (!a.expiresAt || a.expiresAt>now)
      && (!where.asset || state.asset.kind==='license'&&state.asset.status==='active'))
        .map(({id,userId,revision,expiresAt,assetId})=>({id,userId,revision,expiresAt,assetId}))},
    managedPackageEntitlement:{findMany:async({where,take})=>state.grants.filter(e=>e.revokedAt===null&&e.expiresAt>now).slice(0,take)},
    managedPackage:{findUnique:async()=>state.pkg},
    $queryRaw:async()=>[{id:'pkg'}],
    $transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');return fn(delegate)},
  };
  return {state,db:delegate};
}
await check('unbound Package still requires its separate entitlement but adds no seat condition',async()=>{
  const f=fixture();assert.deepEqual(Array.from(await seat.packageSeatEligibleIds(f.db,['pkg','other'],'a',now)),['pkg','other']);
});
await check('bound Package blocks a recipient with no separately allocated seat',async()=>{
  const f=fixture({binding:true});assert.deepEqual(Array.from(await seat.packageSeatEligibleIds(f.db,['pkg'],'b',now)),[]);
});
await check('active allocation restores only the matching recipient target',async()=>{
  const f=fixture({binding:true});assert.deepEqual(Array.from(await seat.packageSeatEligibleIds(f.db,['pkg','other'],'a',now)),['pkg','other']);
  assert.deepEqual(Array.from(await seat.packageSeatEligibleUsers(f.db,'pkg',['a','b'],now)),['a']);
});
await check('expired seats cannot confer Package delivery',async()=>{
  const f=fixture({binding:true,allocations:[{id:'expired',assetId:'seat1',userId:'a',status:'active',quantity:1,expiresAt:past,revision:1}]});
  assert.deepEqual(Array.from(await seat.packageSeatEligibleIds(f.db,['pkg'],'a',now)),[]);
});
await check('revoked allocations cannot confer Package delivery',async()=>{
  const f=fixture({binding:true,allocations:[{id:'revoked',assetId:'seat1',userId:'a',status:'returned',quantity:1,expiresAt:null,revision:1}]});
  assert.deepEqual(Array.from(await seat.packageSeatEligibleUsers(f.db,'pkg',['a'],now)),[]);
});
await check('retired assets and non-digital assets block even otherwise active allocations',async()=>{
  for(const change of [{status:'retired'},{kind:'physical'}]){
    const f=fixture({binding:true});Object.assign(f.state.asset,change);
    assert.deepEqual(Array.from(await seat.packageSeatEligibleIds(f.db,['pkg'],'a',now)),[]);
  }
});
await check('preview counts grants and matching seats, not downloads or secrets',async()=>{
  const f=fixture(),impact=await seat.packageSeatImpact(f.db,'pkg','seat1',now);
  assert.equal(impact.activeGrants,2);assert.equal(impact.alreadyCovered,1);assert.equal(impact.accessWouldPause,1);
  assert.equal(impact.secretsIncluded,false);assert.equal(impact.existingPackageGrantsRemainUnchanged,true);
});
await check('preview hash changes when an allocation revision changes',async()=>{
  const f=fixture(),first=await seat.packageSeatImpact(f.db,'pkg','seat1',now);
  f.state.allocations[0].revision++;
  assert.notEqual(first.fingerprint,(await seat.packageSeatImpact(f.db,'pkg','seat1',now)).fingerprint);
});
await check('preview hash changes when an entitlement revision changes',async()=>{
  const f=fixture(),first=await seat.packageSeatImpact(f.db,'pkg','seat1',now);
  f.state.grants[0].revision++;
  assert.notEqual(first.fingerprint,(await seat.packageSeatImpact(f.db,'pkg','seat1',now)).fingerprint);
});
await check('preview denies disabled asset',async()=>{
  const f=fixture();f.state.asset.status='retired';await assert.rejects(seat.packageSeatImpact(f.db,'pkg','seat1',now),/PACKAGE_SEAT_ASSET_UNAVAILABLE/);
});
await check('preview refuses incompletely enumerated recipient scopes',async()=>{
  const grants=Array.from({length:501},(_,i)=>({id:'g'+i,userId:'user'+i,revision:1,expiresAt:future,revokedAt:null}));
  const f=fixture({grants});await assert.rejects(seat.packageSeatImpact(f.db,'pkg','seat1',now),/PACKAGE_SEAT_IMPACT_SCOPE_EXCEEDED/);
});
await check('target resolver bounds exceptional package-grant sets without silent truncation',async()=>{
  assert.match(src('apps/server/src/domains/inventory/managed-package-device.ts'),/take:\s*501/);
  assert.match(src('apps/server/src/domains/inventory/managed-package-device.ts'),/entitlements.length > 500/);
});
await check('target, grant, download and receipt routes share current seat evaluation',async()=>{
  assert.match(src('apps/server/src/domains/inventory/managed-package-device.ts'),/await packageSeatEligibleIds\(db, rawIds, input.userId, now\)/);
  const routes=src('apps/server/src/domains/inventory/managed-package-routes.ts');
  for(const key of ['download','download/resume','download/recover','authorize-content','receipts']) assert.ok(routes.includes(key));
  assert.match(routes,/const seatEligible = await packageSeatEligibleUsers/);
  assert.ok((routes.match(/await readDevicePackageTargets\(tx,/g)||[]).length>=5);
});
await check('schema uses separate relation and additive-only migration',async()=>{
  assert.match(src('apps/server/prisma/schema.prisma'),/model ManagedPackageSeatRequirement/);
  const migration=src('apps/server/prisma/migrations/20261101000000_td6_g26_package_inventory_seat_binding/migration.sql');
  assert.match(migration,/FOREIGN KEY \("assetId"\)/);assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|ON DELETE CASCADE/);
});
function routeFixture({isAdmin=true,confirmed=true,binding=false}={}) {
  const {db,state}=fixture({binding});const handlers=new Map();
  const app={get:(p,fn)=>handlers.set('GET '+p,fn),post:(p,fn)=>handlers.set('POST '+p,fn)};
  seat.registerManagedPackageSeatRoutes({app,prisma:db,admin:async()=>isAdmin?{id:'admin1'}:null,
    requireConfirmation:()=>confirmed,audit:async(db,actor,action,subject,id,details)=>state.audit.push({action,details}),
    securityAudit:async(_req,_actor,action)=>state.log.push(action)});
  async function invoke(method,route,body={}){const reply={status:200,value:null,headers:{},code(n){this.status=n;return this},send(v){this.value=v;return this},header(k,v){this.headers[k]=v;return this}};
    const returned=await handlers.get(method+' '+route)({params:{id:'pkg'},body},reply);
    return {status:reply.status,result:reply.value??returned};}
  return {invoke,state};
}
const previewRoute='/api/admin/packages/:id/seat-requirement/preview',bindRoute='/api/admin/packages/:id/seat-requirement';
await check('admin preview provides hashed snapshot and no recipient identities',async()=>{
  const f=routeFixture(),r=await f.invoke('POST',previewRoute,{assetId:'seat1'});
  assert.equal(r.status,200);assert.equal(r.result.impact.accessWouldPause,1);assert.ok(!JSON.stringify(r.result).includes('userId'));
});
await check('binding atomically applies reviewed fingerprint, reason and audit',async()=>{
  const f=routeFixture();const r=await f.invoke('POST',previewRoute,{assetId:'seat1'});
  const result=await f.invoke('POST',bindRoute,{assetId:'seat1',reason:'Mandatory editing license',expectedFingerprint:r.result.impact.fingerprint});
  assert.equal(result.status,201);assert.equal(f.state.requirement.assetId,'seat1');
  assert.equal(f.state.audit[0].action,'inventory_seat_requirement_bound');assert.equal(f.state.log.length,1);
});
await check('preview goes stale after a seat revision and no mutation occurs',async()=>{
  const f=routeFixture();const r=await f.invoke('POST',previewRoute,{assetId:'seat1'});f.state.allocations[0].revision++;
  const result=await f.invoke('POST',bindRoute,{assetId:'seat1',reason:'Mandatory editing license',expectedFingerprint:r.result.impact.fingerprint});
  assert.equal(result.status,409);assert.equal(result.result.code,'PACKAGE_SEAT_IMPACT_STALE');assert.equal(f.state.requirement,null);
});
await check('binding is additive-only and cannot be replaced via this route',async()=>{
  const f=routeFixture({binding:true});const result=await f.invoke('POST',previewRoute,{assetId:'seat1'});
  assert.equal(result.status,409);assert.equal(result.result.code,'PACKAGE_SEAT_REQUIREMENT_ALREADY_BOUND');
});
await check('authorization and typed confirmation must precede writes',async()=>{
  for(const props of [{isAdmin:false},{confirmed:false}]){
    const f=routeFixture(props),r=await f.invoke('POST',bindRoute,{assetId:'seat1',reason:'Mandatory editing license',expectedFingerprint:'a'.repeat(64)});
    assert.notEqual(r.status,201);assert.equal(f.state.requirement,null);
  }
});
await check('UI requires impact preview and typed deliberate confirmation',async()=>{
  const ui=src('packages/renderer/src/features/settings/ManagedPackageSeatRequirementPanel.tsx');
  assert.match(ui,/Preview recipient impact/);assert.match(ui,/REQUIRE INVENTORY SEAT/);
  assert.match(ui,/expectedFingerprint: preview.fingerprint/);
  assert.match(src('packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx'),/ManagedPackageSeatRequirementPanel/);
});
console.log(`\nCluster G26 Batch B package/Inventory: ${passed}/${passed} checks passed`);
