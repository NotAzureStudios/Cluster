import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
import crypto from 'node:crypto';
const source=fs.readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const ui=fs.readFileSync('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const zChain={trim(){return this},min(){return this},max(){return this},int(){return this},positive(){return this},default(){return this},optional(){return this},nullable(){return this},datetime(){return this},strict(){return this},extend(){return Object.create(this)},parse(v){return v}};
const z={object(){return Object.create(zChain)},string(){return Object.create(zChain)},number(){return Object.create(zChain)},enum(){return Object.create(zChain)},array(){return Object.create(zChain)}};
const requireMock=(name)=>{if(name==='node:crypto')return crypto;if(name==='zod')return {z};if(name.endsWith('crypto-service.js'))return {clusterSecretFingerprint:()=> 'fingerprint'};if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
  if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};if(name.endsWith('setting-crypto.js'))return {decryptSecuritySecret:()=>'',encryptSecuritySecret:()=>'',encryptionKeyConfigured:()=>true};throw Error(name)};
const ctx={module:{exports:{}},require:requireMock,process,Buffer,Date,console};ctx.exports=ctx.module.exports;vm.runInNewContext(js,ctx);
let asset={id:'asset-1',title:'Unreal licenses',kind:'license',provider:'Vendor',reference:'LIC-2026',capacity:3,status:'active',revision:1};
let allocations=[{id:'allocation-1',assetId:asset.id,userId:'person-a',quantity:2,status:'active',reason:'Developer',assignedAt:new Date(),revokedAt:null}];
const users={ 'person-a':{id:'person-a',archived:false,accountState:'ACTIVE',accessExpiresAt:null}, 'person-b':{id:'person-b',archived:false,accountState:'ACTIVE',accessExpiresAt:null}, 'person-c':{id:'person-c',archived:true,accountState:'ACTIVE',accessExpiresAt:null} };
const routes=new Map(),events=[];let adminAllowed=true,confirmAllowed=true,seq=1;
let assetListOverride=null;
const db={
  studioInventoryAsset:{
    findMany:async({where={},cursor,skip=0,take=101})=>{
      if(!assetListOverride)return [structuredClone(asset)];
      let records=assetListOverride;
      if(where.OR?.length){const q=where.OR[0].title.contains.toLowerCase();records=records.filter(row=>`${row.title} ${row.provider||''} ${row.reference||''} ${row.kind}`.toLowerCase().includes(q));}
      const start=cursor?records.findIndex(row=>row.id===cursor.id)+skip:0;
      return records.slice(Math.max(start,0),Math.max(start,0)+take);
    },findUnique:async({where})=>asset?.id===where.id?structuredClone(asset):null,
    create:async({data})=>{asset={id:'asset-2',revision:1,status:'active',...data};return structuredClone(asset)},
    updateMany:async({where,data})=>{if(asset?.id!==where.id||asset.revision!==where.revision)return {count:0};asset={...asset,...data,revision:asset.revision+Number(data.revision?.increment||0)};return {count:1}}
  },
  studioInventoryAllocation:{
    findMany:async({where})=>allocations.filter(a=>a.assetId===where.assetId && (!where.status||a.status===where.status)).map(a=>({...a})),
    findUnique:async({where})=>allocations.find(a=>a.id===where.id)||null,
    findFirst:async({where})=>allocations.find(a=>a.assetId===where.assetId&&a.userId===where.userId&&a.status===where.status)||null,
    aggregate:async({where})=>({_sum:{quantity:allocations.filter(a=>a.assetId===where.assetId&&a.status===where.status).reduce((sum,a)=>sum+a.quantity,0)}}),
    count:async({where})=>allocations.filter(a=>a.assetId===where.assetId&&a.status===where.status).length,
    updateMany:async({where,data})=>{let count=0;for(const a of allocations){if(a.id===where.id&&a.status===where.status){Object.assign(a,data);count++}}return {count}},
    create:async({data})=>{const row={id:`allocation-${++seq}`,status:'active',assignedAt:new Date(),revokedAt:null,...data};allocations.push(row);return {...row}}
  },
  user:{findUnique:async({where})=>users[where.id]||null},
  studioVaultSecret:{findMany:async()=>[],create:async()=>{},findUnique:async()=>null,updateMany:async()=>({count:0})},
  $queryRaw:async()=>asset?[{id:asset.id}]:[],
  $transaction:async fn=>fn(db)
};
const app={get:(p,f)=>routes.set('GET '+p,f),post:(p,f)=>routes.set('POST '+p,f),patch:(p,f)=>routes.set('PATCH '+p,f)};
ctx.module.exports.registerStudioInventoryVaultRoutes({app,prisma:db,authorization:{requireAdmin:async()=>adminAllowed?{id:'admin-1'}:null},requireConfirmation:()=>confirmAllowed,logSecurityEvent:async row=>events.push(row)});
const invoke=async(method,path,body={},params={},query={})=>{const fn=routes.get(`${method} ${path}`);assert.ok(fn,`${method} ${path} is registered`);const reply={status:200,code(value){this.status=value;return this},header(){return this},send(value){return value}};const res=await fn({body,params,query},reply);return {status:reply.status,res}};
let passed=0;
const check=(assertion,name)=>{assertion();passed++;console.log('PASS',name)};
check(()=>assert.equal(routes.size,29),'Inventory/Vault and recipient routes are registered');
let result=await invoke('GET','/api/admin/inventory/assets/:id/allocations',{}, {id:asset.id},{history:'true'});
check(()=>{assert.equal(result.res.allocated,2);assert.equal(result.res.allocations.length,1)},'History endpoint counts only active capacity');
result=await invoke('PATCH','/api/admin/inventory/assets/:id',{title:'Updated',kind:'license',provider:'Vendor',reference:'LIC',capacity:1,expectedRevision:1},{id:asset.id});
check(()=>{assert.equal(result.status,409);assert.equal(result.res.code,'CAPACITY_BELOW_ALLOCATED');assert.equal(asset.revision,1)},'Capacity cannot shrink under currently assigned seats');
result=await invoke('PATCH','/api/admin/inventory/assets/:id',{title:'Updated',kind:'physical',provider:'Vendor',reference:'LIC',capacity:3,expectedRevision:1},{id:asset.id});
check(()=>{assert.equal(result.res.code,'KIND_CHANGE_WITH_ALLOCATIONS');assert.equal(asset.kind,'license')},'Asset kind cannot change with active assignments');
result=await invoke('PATCH','/api/admin/inventory/assets/:id',{title:'Updated',kind:'license',provider:'Vendor',reference:'LIC',capacity:5,expectedRevision:1},{id:asset.id});
check(()=>{assert.equal(result.res.asset.revision,2);assert.equal(asset.title,'Updated');assert.equal(asset.capacity,5)},'Valid asset edit persists and increments revision');
result=await invoke('PATCH','/api/admin/inventory/assets/:id',{title:'Stale',kind:'license',provider:'Vendor',reference:'LIC',capacity:5,expectedRevision:1},{id:asset.id});
check(()=>{assert.equal(result.status,409);assert.equal(asset.title,'Updated')},'Stale asset edit rejected');
result=await invoke('POST','/api/admin/inventory/assets/:id/lifecycle',{status:'retired',expectedRevision:2},{id:asset.id});
check(()=>{assert.equal(result.res.code,'INVENTORY_ACTIVE_ALLOCATIONS');assert.equal(asset.status,'active')},'Cannot retire an assigned asset');
asset.kind='physical'; // Transfers below exercise physical custody; digital transfers need a fresh reviewed grant.
result=await invoke('POST','/api/admin/inventory/allocations/:id/transfer',{toUserId:'person-c',reason:'Not eligible'},{id:'allocation-1'});
check(()=>{assert.equal(result.res.code,'RECIPIENT_INACTIVE');assert.equal(allocations.length,1)},'Transfer rejects inactive recipient');
result=await invoke('POST','/api/admin/inventory/allocations/:id/transfer',{toUserId:'person-a',reason:''},{id:'allocation-1'});
check(()=>assert.equal(result.res.code,'TRANSFER_SAME_RECIPIENT'),'Transfer rejects same recipient');
result=await invoke('POST','/api/admin/inventory/allocations/:id/transfer',{toUserId:'person-b',reason:'Reassignment'},{id:'allocation-1'});
check(()=>{assert.equal(result.status,201);assert.equal(allocations[0].status,'transferred');assert.equal(allocations[1].status,'active');assert.equal(allocations[1].quantity,2)},'Transfer transaction retires source and creates equal-capacity target');
result=await invoke('POST','/api/admin/inventory/allocations/:id/transfer',{toUserId:'person-c',reason:''},{id:'allocation-1'});
check(()=>{assert.equal(result.res.code,'ALLOCATION_NOT_ACTIVE');assert.equal(allocations.length,2)},'Consumed allocation cannot be transferred again');
result=await invoke('GET','/api/admin/inventory/assets/:id/allocations',{}, {id:asset.id},{history:'true'});
check(()=>{assert.equal(result.res.allocations.length,2);assert.equal(result.res.allocated,2)},'History shows transfer while current capacity stays correct');
asset.kind='license'; // Revoke remains valid for digital seats, not physical return.
result=await invoke('POST','/api/admin/inventory/allocations/:id/revoke',{}, {id:allocations[1].id});
check(()=>{assert.equal(result.res.ok,true);assert.equal(allocations[1].status,'revoked')},'Destination allocation can be returned or revoked');
result=await invoke('POST','/api/admin/inventory/assets/:id/lifecycle',{status:'retired',expectedRevision:2},{id:asset.id});
check(()=>{assert.equal(result.res.asset.status,'retired');assert.equal(asset.revision,3)},'Unallocated asset can be retired');
result=await invoke('POST','/api/admin/inventory/assets/:id/allocations',{userId:'person-a',quantity:1,reason:'Bad'},{id:asset.id});
check(()=>assert.equal(result.res.code,'INVENTORY_REVIEW_REQUIRED'),'Retired digital asset cannot bypass issuance review');
result=await invoke('POST','/api/admin/inventory/assets/:id/lifecycle',{status:'active',expectedRevision:2},{id:asset.id});
check(()=>{assert.equal(result.res.code,'INVENTORY_REVISION_CONFLICT');assert.equal(asset.status,'retired')},'Stale reactivation cannot alter asset');
result=await invoke('POST','/api/admin/inventory/assets/:id/lifecycle',{status:'active',expectedRevision:3},{id:asset.id});
check(()=>{assert.equal(result.res.asset.status,'active');assert.equal(asset.revision,4)},'Asset can be reactivated at correct revision');
// Physical assets have distinct custody disposition; generic license revocation is forbidden.
result=await invoke('PATCH','/api/admin/inventory/assets/:id',{title:'Office laptop',kind:'physical',provider:'Studio',reference:'ASSET-X',capacity:1,expectedRevision:4},{id:asset.id});
check(()=>{assert.equal(result.res.asset.kind,'physical');assert.equal(result.res.asset.revision,5)},'Unallocated license record may be reclassified as physical equipment');
result=await invoke('POST','/api/admin/inventory/assets/:id/allocations',{userId:'person-a',quantity:1,reason:'Loaned laptop'},{id:asset.id});
check(()=>assert.equal(result.status,201),'Physical asset can be issued to a person');
const physicalAllocationId = result.res.allocation.id;
result=await invoke('POST','/api/admin/inventory/allocations/:id/revoke',{}, {id:physicalAllocationId});
check(()=>{assert.equal(result.res.code,'EQUIPMENT_REQUIRES_DISPOSITION');assert.equal(allocations.at(-1).status,'active')},'Generic revoke cannot fake physical equipment return');
result=await invoke('POST','/api/admin/inventory/allocations/:id/disposition',{disposition:'returned',reason:'Returned with charger'},{id:physicalAllocationId});
check(()=>{assert.equal(result.res.ok,true);assert.equal(allocations.at(-1).status,'returned');assert.equal(allocations.at(-1).closedReason,'Returned with charger')},'Physical return records a reason and clears active custody');
result=await invoke('POST','/api/admin/inventory/assets/:id/allocations',{userId:'person-b',quantity:1,reason:'Replacement loan'},{id:asset.id});
const secondPhysicalId=result.res.allocation.id;
result=await invoke('POST','/api/admin/inventory/allocations/:id/disposition',{disposition:'written_off',reason:'Device broken and scrapped'},{id:secondPhysicalId});
check(()=>{assert.equal(result.res.ok,true);assert.equal(allocations.at(-1).status,'written_off');assert.equal(asset.status,'retired')},'Written-off physical equipment has a separate disposition');
result=await invoke('GET','/api/admin/inventory/assets/:id/allocations',{}, {id:asset.id},{history:'true'});
check(()=>{assert.equal(result.res.allocated,0);assert.equal(result.res.allocations.length,4)},'History retains transfers, revocations, returns and write-offs without consuming capacity');
assetListOverride=Array.from({length:205},(_,i)=>({...asset,id:`paged-${String(i).padStart(3,'0')}`,title:i===203?'Studio Camera':'License seat'}));
result=await invoke('GET','/api/admin/inventory/assets',{}, {},{});
check(()=>{assert.equal(result.res.assets.length,100);assert.equal(result.res.nextCursor,'paged-099')},'Inventory first page returns 100 and a bounded cursor');
const page2=await invoke('GET','/api/admin/inventory/assets',{}, {},{cursor:result.res.nextCursor});
check(()=>{assert.equal(page2.res.assets.length,100);assert.equal(page2.res.nextCursor,'paged-199')},'Inventory second page does not truncate at the initial cap');
const page3=await invoke('GET','/api/admin/inventory/assets',{}, {},{cursor:page2.res.nextCursor});
check(()=>{assert.equal(page3.res.assets.length,5);assert.equal(page3.res.nextCursor,null)},'Final page terminates without a phantom cursor');
const searchPage=await invoke('GET','/api/admin/inventory/assets',{}, {},{q:'camera'});
check(()=>{assert.equal(searchPage.res.assets.length,1);assert.equal(searchPage.res.assets[0].id,'paged-203')},'Server-side Inventory search reaches beyond unloaded pages');
assetListOverride=null;
adminAllowed=false;
result=await invoke('GET','/api/admin/inventory/assets');
check(()=>assert.equal(result.res,undefined),'Non-admin cannot enumerate assets');
adminAllowed=true;confirmAllowed=false;
result=await invoke('POST','/api/admin/inventory/assets/:id/lifecycle',{status:'retired',expectedRevision:4},{id:asset.id});
check(()=>assert.equal(result.res,undefined),'Lifecycle transition requires explicit confirmation');
confirmAllowed=true;
check(()=>assert.ok(events.some(x=>x.event==='inventory.allocation_transferred') && events.some(x=>x.event==='inventory.asset_retired')),'Sensitive Inventory mutations are audited');
check(()=>{for(const literal of ['Save changes','Confirm transfer','Confirm disposition','Show allocation history','Retire asset','Reactivate asset','expectedRevision','inFlight.current'])assert.ok(ui.includes(literal),`Inventory UI missing ${literal}`)},'Inventory UI exposes complete asset and assignment workflow');
console.log(`${passed}/${passed} Inventory behavioral and integration assertions passed`);
