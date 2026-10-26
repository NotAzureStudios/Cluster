import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
const source=readFileSync(join(root,'apps/server/src/domains/inventory/studio-inventory-approvals.ts'),'utf8');
const nested={parse(x){return x},strict(){return this},default(){return this},min(){return this},max(){return this},trim(){return this},int(){return this},positive(){return this},datetime(){return this},nullable(){return this},optional(){return this}};
const z={object:()=>nested,string:()=>nested,number:()=>nested,enum:()=>nested};
const module={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>{if(name==='zod')return {z};throw Error('Unexpected mock '+name)},module,module.exports);
const {registerStudioInventoryApprovalRoutes}=module.exports;
const days=n=>new Date(Date.now()+n*86400000);
const recordMatches=(row,where={})=>Object.entries(where).every(([k,v])=>{
 if(k==='OR')return v.some(w=>recordMatches(row,w));
 if(k==='AND')return v.every(w=>recordMatches(row,w));
 if(k==='asset'||k==='user')return recordMatches(row[k],v);
 if(v&&typeof v==='object'&&!(v instanceof Date)){
  if('in'in v)return v.in.includes(row[k]);
  if('lte'in v)return row[k]!==null&&row[k]!==undefined&&new Date(row[k])<=v.lte;
  if('gt'in v)return row[k]!==null&&row[k]!==undefined&&new Date(row[k])>v.gt;
  if('not'in v)return row[k]!==v.not;
 }
 return row[k]===v;
});
function harness(){
 let seq=0,acting='adminA',roster=true,failNotification=false,allowed=true;
 let state={asset:{id:'seat',kind:'license',status:'active',capacity:2,revision:1},pool:{id:'pool',status:'active'},key:{id:'key',poolId:'pool',status:'available',revision:1},
 allocations:[],requests:[],notifications:[],users:{
 adminA:{id:'adminA',username:'a',accountState:'ACTIVE',archived:false,profileRevision:1},
 adminB:{id:'adminB',username:'b',accountState:'ACTIVE',archived:false,profileRevision:1},
 employee:{id:'employee',username:'employee',accountState:'ACTIVE',archived:false,profileRevision:1,accessExpiresAt:days(80)},
 disabled:{id:'disabled',username:'disabled',accountState:'DISABLED',archived:false,profileRevision:1}},
 workspace:[{id:'a',role:'admin',userId:'adminA'},{id:'b',role:'admin',userId:'adminB'}]};
 const repo=()=>({
  $queryRaw:async()=>[{id:'locked'}],
  user:{findUnique:async({where})=>state.users[where.id] ? structuredClone(state.users[where.id]):null,findMany:async()=>Object.values(state.users)},
  workspaceMember:{findMany:async()=>roster?state.workspace.map(x=>({...x})):[],findFirst:async({where})=>roster ? state.workspace.find(x=>x.userId===where.userId)||null:null},
  studioInventoryAsset:{findUnique:async({where})=>where.id===state.asset.id?structuredClone(state.asset):null},
  studioInventoryAllocation:{
   findMany:async({where})=>state.allocations.filter(a=>recordMatches(a,where)).map(a=>structuredClone({...a,asset:state.asset})),
   findUnique:async({where})=>{const row=state.allocations.find(x=>x.id===where.id);return row?structuredClone({...row,asset:state.asset}):null},
   findFirst:async({where})=>state.allocations.find(x=>recordMatches(x,where))||null,
   aggregate:async({where})=>({_sum:{quantity:state.allocations.filter(x=>recordMatches(x,where)).reduce((n,x)=>n+x.quantity,0)}}),
   updateMany:async({where,data})=>{const rows=state.allocations.filter(x=>recordMatches(x,where));for(const x of rows)for(const [k,v]of Object.entries(data))x[k]=typeof v==='object'&&v?.increment ? (x[k]||0)+v.increment : v;return {count:rows.length}},
   create:async({data})=>{const row={id:`alloc-${++seq}`,status:'active',revision:1,...data};state.allocations.push(row);return structuredClone(row)},
  },
  studioInventoryKey:{
   findMany:async({where})=>recordMatches(state.key,where)?[structuredClone({...state.key,pool:state.pool})]:[],
   findUnique:async({where})=>where.id===state.key.id ? structuredClone({...state.key,pool:state.pool}):null,
   updateMany:async({where,data})=>{if(!recordMatches(state.key,where))return {count:0};for(const [k,v]of Object.entries(data))state.key[k]=typeof v==='object'&&v?.increment?(state.key[k]||0)+v.increment:v;return {count:1}},
  },
  studioInventoryAccessRequest:{
   findUnique:async({where})=>state.requests.find(r=>r.id===where.id)||null,
   findFirst:async({where})=>state.requests.find(r=>recordMatches(r,where))||null,
   findMany:async()=>[...state.requests].reverse(),
   create:async({data})=>{const row={id:`request-${++seq}`,status:'pending',requestedAt:new Date(),reviewedAt:null,resultId:null,...data};state.requests.push(row);return structuredClone(row)},
   updateMany:async({where,data})=>{const rows=state.requests.filter(r=>recordMatches(r,where));for(const row of rows)Object.assign(row,data);return {count:rows.length}},
  },
  notificationInboxItem:{
   createMany:async({data})=>{if(failNotification)throw Error('notification storage unavailable');state.notifications.push(...structuredClone(data));return {count:data.length}},
   updateMany:async({where,data})=>{const rows=state.notifications.filter(x=>recordMatches(x,where));for(const row of rows)Object.assign(row,data);return {count:rows.length}},
  },
  studioOffboardingCase:{findMany:async()=>[]},
  managedPackageEntitlement:{findMany:async()=>[{id:'pkg-grant',packageId:'pkg',expiresAt:days(20)}]},
  accessRule:{findMany:async()=>[{id:'project-rule',targetId:'project',level:'view',expiresAt:days(20)}]},
 });
 const prisma=repo();prisma.$transaction=async callback=>{const snapshot=structuredClone(state);try{return await callback(repo())}catch(e){state=snapshot;throw e}};
 const routes=new Map(),events=[];
 const app={get:(url,fn)=>routes.set('GET '+url,fn),post:(url,fn)=>routes.set('POST '+url,fn)};
 registerStudioInventoryApprovalRoutes({app,prisma,authorization:{requireAdmin:async()=>allowed ? {id:acting}:null},getCurrentUser:async()=>state.users[acting],logSecurityEvent:async e=>events.push(e)},
  {inventoryLeaseDeadline:(value,now,userExpiry)=>{const end=new Date(value);if(!(end>now)||end>new Date(now.getTime()+180*86400000)||(userExpiry&&end>new Date(userExpiry)))throw Object.assign(new Error('invalid lease'),{code:'INVALID_INVENTORY_LEASE',statusCode:409});return end},
   assertInventoryCapacity:(limit,occupied,requested)=>limit>=occupied+requested,
   expireDigitalSeats:async(tx,id,kind,now)=>{const r=await tx.studioInventoryAllocation.updateMany({where:{assetId:id,status:'active',expiresAt:{lte:now}},data:{status:'expired',revision:{increment:1}}});return r.count}});
 async function call(method,url,body={},params={}){
  const fn=routes.get(method+' '+url);assert.ok(fn,method+' '+url);
  const reply={status:200,code(n){this.status=n;return this},header(){return this},send(v){this.sent=v;return v}};
  const data=await fn({body,params,query:{}},reply);return {status:reply.status,data:reply.sent??data};
 }
 return {call,get:()=>state,as:who=>{acting=who},disableRoster:()=>{roster=false},failNotification:()=>{failNotification=true},setUser:(id,fn)=>fn(state.users[id]),setAllocation:fn=>fn(state.allocations),setAsset:fn=>fn(state.asset),setKey:fn=>fn(state.key),events,deny:()=>{allowed=false}};
}
let checks=0;async function test(label,fn){await fn();console.log('PASS '+label);checks++}
const endpoint='/api/admin/inventory/access-requests';
const reviewRoute=endpoint+'/:id/review';
const issue=(kind,targetId,override={})=>({operation:kind,targetId,userId:'employee',expectedRevision:1,expectedProfileRevision:1,quantity:1,expiresAt:days(30).toISOString(),reason:'Developer entitlement for production work',...override});
const f=harness();let req;
await test('Digital seat request stores no allocation and sends review notifications',async()=>{const r=await f.call('POST',endpoint,issue('seat_issue','seat'));assert.equal(r.status,201);req=r.data.request.id;assert.equal(f.get().allocations.length,0);assert.equal(f.get().notifications.filter(n=>n.requiresAction).length,1)});
await test('Duplicate pending request rejected',async()=>{const r=await f.call('POST',endpoint,issue('seat_issue','seat'));assert.equal(r.status,409);assert.equal(r.data.code,'INVENTORY_REQUEST_PENDING')});
await test('Requester cannot approve own grant',async()=>{const r=await f.call('POST',reviewRoute,{decision:'approved',reason:'Confirmed working need'},{id:req});assert.equal(r.status,409);assert.equal(r.data.code,'INVENTORY_SELF_APPROVAL')});
await test('Independent reviewer issues bounded seat and resolves Inbox action',async()=>{f.as('adminB');const r=await f.call('POST',reviewRoute,{decision:'approved',reason:'Confirmed project need'},{id:req});assert.equal(r.data.ok,true);assert.equal(f.get().allocations.length,1);assert.equal(f.get().requests[0].status,'approved');assert.equal(f.get().notifications.filter(n=>n.requiresAction).length,0)});
await test('Repeat decision cannot issue another seat',async()=>{const r=await f.call('POST',reviewRoute,{decision:'approved',reason:'Repeated replay attempt'},{id:req});assert.equal(r.status,409);assert.equal(f.get().allocations.length,1)});
await test('Seat capacity and reviewer-time revisions are rechecked',async()=>{f.as('adminA');f.setAsset(a=>{a.revision++});const denied=await f.call('POST',endpoint,issue('seat_issue','seat'));assert.equal(denied.data.code,'INVENTORY_REVISION_CONFLICT');f.setAsset(a=>{a.revision--});});
await test('Seat extension is reviewed and never shortens its lease',async()=>{const first=f.get().allocations[0];const r=await f.call('POST',endpoint,issue('seat_extend',first.id,{expectedRevision:first.revision,expiresAt:days(50).toISOString()}));assert.equal(r.status,201);f.as('adminB');const approved=await f.call('POST',reviewRoute,{decision:'approved',reason:'Extend for final sprint'},{id:r.data.request.id});assert.equal(approved.data.ok,true);assert.equal(f.get().allocations[0].revision,2)});
await test('Stale recipient revision prevents approved mutation',async()=>{f.as('adminA');const r=await f.call('POST',endpoint,issue('key_issue','key'));assert.equal(r.status,201);f.setUser('employee',x=>{x.profileRevision++});f.as('adminB');const reject=await f.call('POST',reviewRoute,{decision:'approved',reason:'Reviewed and eligible'},{id:r.data.request.id});assert.equal(reject.status,409);assert.equal(f.get().key.status,'available');f.setUser('employee',x=>{x.profileRevision--});});
await test('Independent approval issues a key without exposing its secret',async()=>{const pending=f.get().requests.find(r=>r.operation==='key_issue');const r=await f.call('POST',reviewRoute,{decision:'approved',reason:'Need verified QA key'},{id:pending.id});assert.equal(r.data.ok,true);assert.equal(f.get().key.status,'assigned');assert.equal(f.get().key.userId,'employee');assert.ok(!JSON.stringify(r).includes('vaultSecretId'))});
await test('Cross-tool admin summary distinguishes effective custody from access grants',async()=>{
 const result=await f.call('GET','/api/admin/inventory/person-access/:id',{}, {id:'employee'});
 assert.equal(result.data.ok,true);
 assert.equal(result.data.allocations.length,1);
 assert.equal(result.data.allocations[0].effectiveStatus,'active');
 assert.equal(result.data.keys.length,1);
 assert.equal(result.data.packageEntitlements.length,1);
 assert.equal(result.data.directProjectAllowRules.length,1);
 assert.match(result.data.note,/not effective permission decisions/);
 assert.ok(!JSON.stringify(result.data).includes('vaultSecretId'));
});
await test('Admin access summary does not present disabled recipients as eligible',async()=>{
 f.setUser('employee',x=>{x.accountState='DISABLED'});
 const response=await f.call('GET','/api/admin/inventory/person-access/:id',{}, {id:'employee'});
 assert.equal(response.data.eligible,false);
 assert.equal(response.data.allocations[0].effectiveStatus,'identity_blocked');
 f.setUser('employee',x=>{x.accountState='ACTIVE'});
});
await test('Approval rechecks seat capacity after intervening issuance',async()=>{
 const h=harness(); const response=await h.call('POST',endpoint,issue('seat_issue','seat'));
 h.setAllocation(rows=>rows.push({id:'external',status:'active',assetId:'seat',userId:'other',quantity:2,revision:1}));
 h.as('adminB');const rejected=await h.call('POST',reviewRoute,{decision:'approved',reason:'Requested but now full'},{id:response.data.request.id});
 assert.equal(rejected.status,409);assert.equal(rejected.data.code,'INVENTORY_NO_CAPACITY');
 assert.equal(h.get().requests[0].status,'pending');
});
await test('Key entitlement expires with recipient if updated before approval',async()=>{
 const h=harness();const response=await h.call('POST',endpoint,issue('key_issue','key'));
 h.setUser('employee',x=>{x.accessExpiresAt=days(-1)});h.as('adminB');
 const result=await h.call('POST',reviewRoute,{decision:'approved',reason:'No longer eligible'},{id:response.data.request.id});
 assert.equal(result.data.code,'INVENTORY_RECIPIENT_INACTIVE');assert.equal(h.get().key.status,'available');
});
await test('Already-issued key cannot be reissued',async()=>{f.as('adminA');const r=await f.call('POST',endpoint,issue('key_issue','key',{expectedRevision:2}));assert.equal(r.status,409);assert.equal(r.data.code,'INVENTORY_KEY_STALE')});
await test('Request with no independent reviewer fails closed',async()=>{const h=harness();h.disableRoster();const r=await h.call('POST',endpoint,issue('seat_issue','seat'));assert.equal(r.status,409);assert.equal(h.get().requests.length,0)});
await test('Failed notification write rolls back request creation',async()=>{const h=harness();h.failNotification();await assert.rejects(h.call('POST',endpoint,issue('seat_issue','seat')),/notification storage unavailable/);assert.equal(h.get().requests.length,0)});
await test('Expired identity never receives a grant',async()=>{const h=harness();h.setUser('employee',u=>{u.accessExpiresAt=days(-1)});const r=await h.call('POST',endpoint,issue('key_issue','key'));assert.equal(r.status,409);assert.equal(r.data.code,'INVENTORY_RECIPIENT_INACTIVE')});
await test('No unauthorized reviewer access',async()=>{const h=harness();h.deny();const r=await h.call('GET',endpoint);assert.equal(r.data,undefined)});
await test('Reviewed rejection leaves stock unchanged and notifies requester',async()=>{const h=harness();const r=await h.call('POST',endpoint,issue('key_issue','key'));h.as('adminB');const decision=await h.call('POST',reviewRoute,{decision:'rejected',reason:'Not approved for this project'},{id:r.data.request.id});assert.equal(decision.data.decision,'rejected');assert.equal(h.get().key.status,'available');assert.equal(h.get().notifications.filter(n=>n.signal==='inventory_review_decision').length,2)});
const main=readFileSync(join(root,'apps/server/src/domains/inventory/studio-inventory-vault-routes.ts'),'utf8');
const ui=readFileSync(join(root,'packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx'),'utf8');
const schema=readFileSync(join(root,'apps/server/prisma/schema.prisma'),'utf8');
const migration=readFileSync(join(root,'apps/server/prisma/migrations/20261019014500_td6_g02_inventory_reviewed_issuance/migration.sql'),'utf8');
await test('Direct seat, key and renewal endpoints fail closed',()=>{assert.match(main,/kindForApproval.*inventoryDigitalKind/);assert.match(main,/if \(inventoryDigitalKind\(asset.kind\)\) return \{ code: "INVENTORY_REVIEW_REQUIRED"/);assert.match(main,/Request a reviewed seat extension through Inventory access reviews./);assert.match(main,/Request independent approval before issuing a commercial key./)});
await test('UI requests reviewed inventory mutations, not direct key/seat writes',()=>{assert.match(ui,/operation: "seat_issue"/);assert.match(ui,/operation: "seat_extend"/);assert.match(ui,/operation: "key_issue"/);assert.match(ui,/independent approval/);assert.match(schema,/model StudioInventoryAccessRequest/);assert.match(migration,/pending_key_unique/)});
console.log(`TD6 G02 Inventory approvals: ${checks}/${checks} checks passed`);
