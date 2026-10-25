import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
const read=path=>readFileSync(join(root,path),'utf8');
const factory=()=>new Proxy({parse:x=>x,strict(){return this},extend(){return this}},{get:(o,k)=>k in o?o[k]:()=>factory()});
const z={object:factory,string:factory,number:factory,array:factory,enum:factory};
const js=ts.transpileModule(read('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
new Function('require','module','exports',js)(name=>{
 if(name==='zod')return {z};
 if(name==='node:crypto')return require('node:crypto');
 if(name.endsWith('crypto-service.js'))return {clusterSecretFingerprint:()=> 'safe-fingerprint'};
 if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
 if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};
 if(name.endsWith('vault-reviewed-rotation.js'))return {registerVaultReviewedRotationRoutes:()=>{}};
 if(name.endsWith('setting-crypto.js'))return {decryptSecuritySecret:()=> 'key-value', encryptSecuritySecret:()=> 'encrypted', encryptionKeyConfigured:()=>true};
 throw Error(`Unhandled mock import ${name}`);
},module,module.exports);
const {registerStudioInventoryVaultRoutes,inventoryDigitalKind,inventoryLeaseDeadline,effectiveDigitalAllocations}=module.exports;
let tests=0;const test=async(label,fn)=>{await fn();console.log('PASS',label);tests++;};
const days=(n)=>new Date(Date.now()+n*86400000);
await test('Digital and physical custody are distinct',()=>{assert.equal(inventoryDigitalKind('license'),true);assert.equal(inventoryDigitalKind('equipment'),false);});
await test('Digital leases cannot outlive identity or 180 days',()=>{
 assert.ok(inventoryLeaseDeadline(days(20).toISOString(),new Date(),days(30)));
 assert.equal(inventoryLeaseDeadline(null,new Date(),null),null);
 for(const expiration of [days(-1),days(181),days(31)])assert.throws(()=>inventoryLeaseDeadline(expiration.toISOString(),new Date(),days(30)),/Lease must expire/);
 assert.equal(effectiveDigitalAllocations(new Date()).status,'active');
});
function harness(kind='license'){
 const state={asset:{id:'asset',kind,capacity:2,status:'active',revision:1},allocations:[],keys:[],keyPool:{id:'pool',status:'active'},vault:{id:'sec',encryptedValue:'sealed',revokedAt:null,expiresAt:null},users:{one:{id:'one',accountState:'ACTIVE',archived:false,accessExpiresAt:days(80)},two:{id:'two',accountState:'ACTIVE',archived:false,accessExpiresAt:days(80)}},audit:[]};
 let inState=state,serial=0;
 function match(value,match){if(match===undefined)return true;if(match===null)return value===null||value===undefined;if(typeof match==='object'&&!(match instanceof Date)){if('lte'in match)return value!=null&&new Date(value)<=new Date(match.lte);if('gt'in match)return value!=null&&new Date(value)>new Date(match.gt);if('not'in match)return value!==match.not;}return value===match;}
 function matches(record,where={}){return Object.entries(where).every(([k,v])=>k==='OR'?v.some(x=>matches(record,x)):match(record[k],v));}
 const db=()=>({
 $queryRaw:async()=>[{id:'asset'}],
 user:{findUnique:async({where})=>structuredClone(inState.users[where.id]||null)},
 studioInventoryAsset:{findUnique:async({where})=>where.id===inState.asset.id?structuredClone(inState.asset):null},
 studioInventoryAllocation:{
 findUnique:async({where})=>structuredClone(inState.allocations.find(a=>a.id===where.id)||null),
 findFirst:async({where})=>structuredClone(inState.allocations.find(a=>matches(a,where))||null),
 findMany:async({where})=>structuredClone(inState.allocations.filter(a=>matches(a,where))),
 count:async({where})=>inState.allocations.filter(a=>matches(a,where)).length,
 aggregate:async({where})=>({_sum:{quantity:inState.allocations.filter(a=>matches(a,where)).reduce((n,a)=>n+a.quantity,0)}}),
 updateMany:async({where,data})=>{let count=0;for(const row of inState.allocations){if(!matches(row,where))continue;for(const [k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?Number(row[k]||0)+v.increment:v;count++;}return {count}},
 create:async({data})=>{const row={id:`allocation-${++serial}`,revision:1,status:'active',assignedAt:new Date(),...data};inState.allocations.push(row);return structuredClone(row)},
 },
 studioInventoryKeyPool:{findUnique:async()=>structuredClone(inState.keyPool)},
 studioInventoryKey:{
 findFirst:async({where})=>{const key=inState.keys.find(k=>matches(k,where));return key?{...structuredClone(key),pool:structuredClone(inState.keyPool)}:null;},
 updateMany:async({where,data})=>{let count=0;for(const key of inState.keys){if(!matches(key,where))continue;for(const [k,v]of Object.entries(data))key[k]=v&&typeof v==='object'&&'increment'in v?Number(key[k]||0)+v.increment:v;count++;}return {count}},
 },
 studioVaultSecret:{findUnique:async()=>structuredClone(inState.vault)},
 });
 const prisma=db();prisma.$transaction=async(fn)=>{const before=structuredClone(inState);inState=structuredClone(inState);try {return await fn(db());}catch(e){inState=before;throw e}};
 const handlers=new Map();const app={post:(p,f)=>handlers.set(`POST ${p}`,f),get:(p,f)=>handlers.set(`GET ${p}`,f),patch:(p,f)=>handlers.set(`PATCH ${p}`,f)};
 registerStudioInventoryVaultRoutes({app,prisma,authorization:{requireAdmin:async()=>({id:'admin'})},requireConfirmation:()=>true,
 logSecurityEvent:async e=>inState.audit.push(e),getCurrentUser:async()=>inState.users.one,verifyUserPin:async()=>{},auditService:{recordSecurity:async()=>({ok:true})}});
 async function call(method,path,body={},params={}){
  const fn=handlers.get(`${method} ${path}`);assert.ok(fn,`${method} ${path}`);
  const reply={status:200,code(n){this.status=n;return this},header(){return this},send(v){this.body=v;return v}};
  const output=await fn({body,params,query:{}},reply);
  return {status:reply.status,data:reply.body??output};
 }
 return {call,get:()=>inState,set:fn=>fn(inState)};
}
const lease=days(20).toISOString();
const f=harness();const assignPath='/api/admin/inventory/assets/:id/allocations';
await test('Digital seats require reviewed issuance and renewal',async()=>{
 const response=await f.call('POST',assignPath,{userId:'one',quantity:2,reason:'Studio license',expiresAt:lease},{id:'asset'});
 assert.equal(response.status,409);assert.equal(response.data.code,'INVENTORY_REVIEW_REQUIRED');
 assert.equal(f.get().allocations.length,0);
 const renew=await f.call('POST','/api/admin/inventory/allocations/:id/renew',{expectedRevision:1,expiresAt:days(40).toISOString(),reason:'Extended sprint'},{id:'unowned'});
 assert.equal(renew.status,409);assert.equal(renew.data.code,'INVENTORY_REVIEW_REQUIRED');
});
await test('Capacity/expiry helper still counts only effective active leases',async()=>{
 f.set(s=>s.allocations.push({id:'prior',assetId:'asset',userId:'one',quantity:2,status:'active',revision:1,expiresAt:days(-1)}));
 const listing=await f.call('GET','/api/admin/inventory/assets/:id/allocations',{}, {id:'asset'});
 assert.equal(listing.data.allocated,0);
 const blocked=await f.call('POST',assignPath,{userId:'two',quantity:2,reason:'New seats',expiresAt:days(20).toISOString()},{id:'asset'});
 assert.equal(blocked.data.code,'INVENTORY_REVIEW_REQUIRED');
 assert.equal(f.get().allocations.length,1);
});
await test('Physical custody cannot be given synthetic expiration and requires disposition',async()=>{
 const physical=harness('equipment');
 const denied=await physical.call('POST',assignPath,{userId:'one',expiresAt:days(4).toISOString(),quantity:1},{id:'asset'});
 assert.equal(denied.status,409);assert.equal(denied.data.code,'PHYSICAL_CUSTODY_CANNOT_EXPIRE');
 const assigned=await physical.call('POST',assignPath,{userId:'one',quantity:1},{id:'asset'});assert.equal(assigned.status,201);
 const id=physical.get().allocations[0].id;
 assert.equal((await physical.call('POST','/api/admin/inventory/allocations/:id/revoke',{}, {id})).data.code,'EQUIPMENT_REQUIRES_DISPOSITION');
 assert.equal(physical.get().allocations[0].status,'active');
});
await test('Timed key access blocks administrative and recipient disclosure after expiry',async()=>{
 const keys=harness('license');
 keys.set(s=>s.keys.push({id:'key',poolId:'pool',vaultSecretId:'sec',status:'assigned',userId:'one',revision:2,expiresAt:days(-1),firstRevealedAt:null}));
 const endpoint='/api/admin/inventory/key-pools/:id/keys/:keyId';
 const bypass=await keys.call('POST',endpoint+'/assign',{expectedRevision:2,userId:'one',expiresAt:days(3).toISOString()},{id:'pool',keyId:'key'});
 assert.equal(bypass.data.code,'INVENTORY_REVIEW_REQUIRED');
 const admin=await keys.call('POST',endpoint+'/reveal',{expectedRevision:2},{id:'pool',keyId:'key'});
 assert.equal(admin.status,404);assert.equal(admin.data.code,'KEY_NOT_REVEALABLE');
 const self=await keys.call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1111'},{id:'key'});
 assert.equal(self.status,404);assert.equal(keys.get().keys[0].status,'assigned');
});
await test('Reviewed key issuance never recycles disclosed or redeemed stock',()=>{
 const src=read('apps/server/src/domains/inventory/studio-inventory-approvals.ts');
 assert.match(src,/status: "available", revision: body.expectedRevision/);
 assert.match(src,/status: "assigned", userId: body.userId/);
 assert.match(read('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts'),/firstRevealedAt: null/);
 assert.ok(!src.includes('status: "available", userId: null'));
});
await test('Offboarding ends digital access but retains physical custody and evidence',()=>{
 const src=read('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts');
 assert.match(src,/asset: \{ kind: \{ in: \["digital", "license"\] \} \}/);
 assert.match(src,/physicalCustodyOutstanding/);
 assert.ok(!src.includes('where: { userId: current.subjectUserId, status: "active" }, data: { status: "revoked"'));
 assert.match(read('packages/renderer/src/features/settings/StudioOffboardingPanel.tsx'),/physical allocations still awaiting custody disposition/);
});
await test('Inventory provides on-demand, secret-free deadline and custody summary',()=>{
 const route=read('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts');
 assert.match(route,/app\.get\("\/api\/admin\/inventory\/attention"/);
 assert.match(route,/digitalSeatsPastDue, physicalCustodyOpen, keysExpiring, keysPastDue/);
 assert.ok(!route.includes('encryptedValue: true, firstRevealedAt'));
 assert.match(read('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx'),/Refresh inventory attention/);
});
await test('Prisma migration and editor panels expose new lease/custody contracts',()=>{
 const schema=read('apps/server/prisma/schema.prisma');const mig=read('apps/server/prisma/migrations/20261019001500_td6_grouped_inventory_custody_leases/migration.sql');
 assert.ok(mig.includes('firstRevealedAt')&&mig.includes('expiresAt'));
 assert.match(schema,/model StudioInventoryAllocation \{/);
 assert.match(read('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx'),/Extend seat lease/);
});
console.log(`${tests}/${tests} TD6 grouped Inventory/People/Key lifecycle checks passed`);
