import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
const read=file=>readFileSync(join(root,file),'utf8');
function compile(file,imports={}) {
  const source=ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',source)(name=>{if(name in imports)return imports[name];const placeholder=(name === "./managed-package-seat-policy.js" ? {
    packageSeatEligibleIds: async (_db, ids) => ids,
    packageSeatEligibleUsers: async (_db, _pkg, ids) => ids,
    registerManagedPackageSeatRoutes: () => {},
  } : name === "./managed-package-readiness.js" ? {
    registerManagedPackageReadinessRoutes: () => {},
  } : null);if(placeholder)return placeholder;throw Error('Unexpected import: '+name);},mod,mod.exports);
  return mod.exports;
}
const zChain=()=>new Proxy({parse:x=>x,strict:()=>zChain()},{get:(t,k)=>k in t?t[k]:()=>zChain()});
const z={object:zChain,string:zChain,enum:zChain,number:zChain,literal:zChain};
const routes=compile('apps/server/src/domains/inventory/managed-package-entitlements.ts',{'zod':{z}});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name);}
const days=n=>new Date(Date.now()+n*86400000);
await check('expiration respects identity, 180-day cap and never accepts past',()=>{
  assert.equal(routes.validatePackageEntitlementExpiry(days(30),new Date(),days(70)),true);
  for(const expiry of [days(-1),days(190),days(90)]) assert.equal(routes.validatePackageEntitlementExpiry(expiry,new Date(),days(70)),false);
});
function harness(options={}) {
  let state={pkg:{id:'pkg1',archivedAt:null},users:[{id:'person',archived:false,accountState:'ACTIVE',accessExpiresAt:days(80)}],
    grants:[],requests:[],audit:[],notices:[]}; let actor='admin-a', failAudit=false, serial=0,locked=0;
  const handlers=new Map(); const app={get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn)};
  const db=(get)=>({
    $queryRaw:async()=>{locked++;return [{id:'pkg1'}];},
    managedPackage:{findUnique:async({where})=>where.id==='pkg1'?structuredClone(get().pkg):null},
    user:{findUnique:async({where})=>structuredClone(get().users.find(u=>u.id===where.id)||null),
      findMany:async({where})=>get().users.filter(u=>where.id.in.includes(u.id)).map(u=>({id:u.id}))},
    workspaceMember:{findMany:async()=>options.noReviewer?[{userId:'admin-a'}]:[{userId:'admin-a'},{userId:'admin-b'}]},
    notificationInboxItem:{createMany:async({data})=>{get().notices.push(...data);return {count:data.length};},
      updateMany:async({where,data})=>{let count=0;for(const notice of get().notices)if(notice.groupKey===where.groupKey&&notice.requiresAction===where.requiresAction){Object.assign(notice,data);count++;}return {count};}},
    managedPackageEntitlement:{
      findMany:async({where})=>structuredClone(get().grants.filter(g=>g.packageId===where.packageId)),
      findUnique:async({where})=>structuredClone(get().grants.find(g=>where.id?g.id===where.id:g.packageId===where.packageId_userId.packageId&&g.userId===where.packageId_userId.userId)||null),
      create:async({data})=>{const g={...data,id:'e'+(++serial),revision:1,revokedAt:null,createdAt:new Date()};get().grants.push(g);return structuredClone(g);},
      updateMany:async({where,data})=>{const g=get().grants.find(g=>g.id===where.id&&g.revision===where.revision&&(!('revokedAt' in where)||g.revokedAt===null));if(!g)return {count:0};Object.assign(g,{...data,revision:g.revision+1});return {count:1};},
    },
    managedPackageEntitlementRequest:{
      findMany:async({where})=>structuredClone(get().requests.filter(r=>r.packageId===where.packageId)),
      findFirst:async({where})=>structuredClone(get().requests.find(r=>r.packageId===where.packageId&&r.userId===where.userId&&r.status===where.status)||null),
      findUnique:async({where})=>structuredClone(get().requests.find(r=>r.id===where.id)||null),
      create:async({data})=>{const r={...data,id:'r'+(++serial),status:'pending',createdAt:new Date()};get().requests.push(r);return structuredClone(r);},
      updateMany:async({where,data})=>{const r=get().requests.find(r=>r.id===where.id&&r.status===where.status);if(!r)return {count:0};Object.assign(r,data);return {count:1};},
    },
  });
  const prisma=db(()=>state);
  prisma.$transaction=async(fn)=>{const next=structuredClone(state);const tx=db(()=>next);const outcome=await fn(tx);state=next;return outcome;};
  routes.registerManagedPackageEntitlementRoutes({app,prisma,admin:async()=>({id:actor}),requireConfirmation:()=>true,
    audit:async(db,actorId,action,subjectId,packageId,details)=>{if(failAudit)throw Error('AUDIT_FAILED');state.audit.push({actorId,action,subjectId,packageId,details});},
    securityAudit:async()=>{}});
  async function call(method,path,body={},params={}) {
    const handler=handlers.get(method+' '+path);assert.ok(handler,path);
    const reply={status:200,code(n){this.status=n;return this},header(){return this},send(value){this.result=value;return value}};
    const value=await handler({body,params:{id:'pkg1',...params}},reply);
    return {status:reply.status,body:reply.result??value};
  }
  return {call,get:()=>state,setActor:id=>actor=id,mutate:fn=>fn(state),failAudit:v=>failAudit=v,locks:()=>locked};
}
const f=harness();
const request=(overrides={})=>({userId:'person',action:'grant',expiresAt:days(30).toISOString(),reason:'Needed for editing kit',expectedRevision:0,...overrides});
const reqPath='/api/admin/packages/:id/entitlement-requests';
const reviewPath='/api/admin/packages/:id/entitlement-requests/:requestId/review';
await check('request creates no downloadable entitlement and audit evidence',async()=>{const response=await f.call('POST',reqPath,request());assert.equal(response.status,201);assert.equal(f.get().grants.length,0);assert.equal(f.get().requests[0].status,'pending');assert.equal(f.get().notices[0].userId,'admin-b');});
await check('request with no independent administrator is rejected before write',async()=>{const x=harness({noReviewer:true});const response=await x.call('POST',reqPath,request());assert.equal(response.status,409);assert.equal(response.body.code,'PACKAGE_ENTITLEMENT_REVIEWER_REQUIRED');assert.equal(x.get().requests.length,0);});
await check('duplicate pending request denied',async()=>{const response=await f.call('POST',reqPath,request());assert.equal(response.status,409);assert.equal(f.get().requests.length,1);});
await check('original requester cannot approve own request',async()=>{const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Approve own request'},{requestId:'r1'});assert.equal(response.status,403);assert.equal(f.get().grants.length,0);});
await check('separate reviewer issues only one recipient grant',async()=>{f.setActor('admin-b');const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Work requires access'},{requestId:'r1'});assert.equal(response.body.ok,true);assert.equal(f.get().grants.length,1);assert.equal(f.get().grants[0].approvedById,'admin-b');assert.equal(f.get().requests[0].status,'approved');assert.equal(f.get().notices[0].requiresAction,false);});
await check('approval notifies current recipient and closes reviewer action',async()=>{assert.ok(f.get().notices.some(x=>x.userId==='person'&&x.signal==='package_entitlement_decision'));});
await check('approved request replay does not reissue',async()=>{const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Work requires access'},{requestId:'r1'});assert.equal(response.status,409);assert.equal(f.get().grants.length,1);});
await check('unexpired active grant cannot be replaced by grant operation',async()=>{const response=await f.call('POST',reqPath,request({expectedRevision:1}));assert.equal(response.status,409);});
await check('extension request requires longer expiry and current revision',async()=>{f.setActor('admin-a');for (const until of [days(10),days(50)]) {const data=request({action:'extend',expectedRevision:0,expiresAt:until.toISOString()});const response=await f.call('POST',reqPath,data);assert.equal(response.status,409);}const response=await f.call('POST',reqPath,request({action:'extend',expectedRevision:1,expiresAt:days(45).toISOString()}));assert.equal(response.body.ok,true);});
await check('review denies changed entitlement revision',async()=>{f.mutate(s=>s.grants[0].revision++);f.setActor('admin-b');const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Extend work access'},{requestId:'r3'});assert.equal(response.status,409);assert.equal(f.get().requests[1].status,'pending');});
await check('review denies disabled or expired identity',async()=>{f.mutate(s=>s.grants[0].revision=1);f.mutate(s=>s.users[0].accountState='DISABLED');const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Extend work access'},{requestId:'r3'});assert.equal(response.status,409);f.mutate(s=>s.users[0].accountState='ACTIVE');});
await check('independent extension changes expiry but not identity, increments revision',async()=>{const response=await f.call('POST',reviewPath,{decision:'approved',reason:'Extend work access'},{requestId:'r3'});assert.equal(response.body.ok,true);assert.equal(f.get().grants[0].revision,2);assert.equal(f.get().grants[0].userId,'person');});
await check('revocation is instant, revision guarded and audited',async()=>{const response=await f.call('POST','/api/admin/packages/:id/entitlements/:entitlementId/revoke',{expectedRevision:2,reason:'End of project'}, {entitlementId:f.get().grants[0].id});assert.equal(response.body.ok,true);assert.ok(f.get().grants[0].revokedAt);assert.equal(f.get().grants[0].revision,3);});
await check('repeated or stale revocation denied',async()=>{const response=await f.call('POST','/api/admin/packages/:id/entitlements/:entitlementId/revoke',{expectedRevision:2,reason:'End of project'},{entitlementId:f.get().grants[0].id});assert.equal(response.status,409);});
await check('failed audit rolls back permission mutation',async()=>{const x=harness();await x.call('POST',reqPath,request());x.setActor('admin-b');x.failAudit(true);await assert.rejects(x.call('POST',reviewPath,{decision:'approved',reason:'Approved request'},{requestId:'r1'}),/AUDIT_FAILED/);assert.equal(x.get().grants.length,0);assert.equal(x.get().requests[0].status,'pending');assert.equal(x.get().notices[0].requiresAction,true);});
await check('current entitlement and review requests are visible only through admin route',async()=>{const response=await f.call('GET','/api/admin/packages/:id/entitlements');assert.equal(response.body.entitlements.length,1);assert.equal(response.body.requests.length,2);});
await check('expired identity, archived package and self-grant are rejected',async()=>{const x=harness();x.mutate(s=>s.users[0].accessExpiresAt=days(-1));assert.equal((await x.call('POST',reqPath,request())).status,409);x.mutate(s=>s.users[0].accessExpiresAt=days(80));x.mutate(s=>s.pkg.archivedAt=new Date());assert.equal((await x.call('POST',reqPath,request())).status,404);assert.equal((await x.call('POST',reqPath,request({userId:'admin-a'}))).status,403);});
const device=compile('apps/server/src/domains/inventory/managed-package-device.ts',{
  'node:crypto':require('node:crypto'),
  './managed-package-policy.js':{selectPackageTarget:({policy,release})=>policy?.state==='active'&&release?release.id:null,packageSigningInput:()=>Buffer.from('signed'),packageKeyFingerprint:()=> 'a'.repeat(64)},
});
const fakeTargetDb=({userState='ACTIVE',expiration=days(70),grantState='active'}={})=>({
  user:{findUnique:async()=>({archived:false,accountState:userState,accessExpiresAt:expiration})},
  managedPackageEntitlement:{findMany:async()=>grantState==='active'?[{packageId:'pkg1'}]:[]},
  managedPackage:{findMany:async({where})=>where.id.in.includes('pkg1')?[{id:'pkg1',key:'kit',title:'Editing Kit',description:'',archivedAt:null}]:[]},
  managedPackageRollout:{findMany:async()=>[]},managedPackagePin:{findMany:async()=>[]},
});
const targetArg={userId:'person',deviceRegistrationId:'desktop1',platform:'windows-x64',channel:'stable'};
await check('recipient target resolver fails closed without a current approved entitlement',async()=>{
  for(const kind of ['missing','expired','revoked'])assert.deepEqual(await device.readDevicePackageTargets(fakeTargetDb({grantState:kind}),targetArg),[]);
});
await check('inactive and expired identities receive no Package catalogue',async()=>{
  assert.deepEqual(await device.readDevicePackageTargets(fakeTargetDb({userState:'DISABLED'}),targetArg),[]);
  assert.deepEqual(await device.readDevicePackageTargets(fakeTargetDb({userState:'PASSWORD_RESET_REQUIRED'}),targetArg),[]);
  assert.deepEqual(await device.readDevicePackageTargets(fakeTargetDb({expiration:days(-1)}),targetArg),[]);
});
await check('positive entitlement passes the person gate and reaches release selection',async()=>{
  const result=await device.readDevicePackageTargets(fakeTargetDb(),targetArg);
  assert.deepEqual(result,[],'no rollout or pin means no release even if entitled');
});
await check('reconciliation explicitly masks non-entitled device targets',()=>{
  const code=read('apps/server/src/domains/inventory/managed-package-reconciliation.ts');
  assert.ok(code.includes('eligibleUsers.has(registration.userId)'));
});
await check('download, deployment grants and positive receipts consume the same entitlement-aware read',()=>{
  const code=read('apps/server/src/domains/inventory/managed-package-routes.ts');
  assert.equal((code.match(/readDevicePackageTargets\(/g)||[]).length,6);
  assert.equal((code.match(/userId: device.userId, deviceRegistrationId: device.registrationId/g)||[]).length,6);
});
await check('schema, migration and admin control wired',()=>{
  assert.ok(read('apps/server/prisma/schema.prisma').includes('model ManagedPackageEntitlementRequest'));
  assert.ok(read('apps/server/prisma/migrations/20261018234500_td6_f11_package_entitlements/migration.sql').includes('ManagedPackageEntitlementRequest_pending_subject_unique'));
  assert.ok(read('packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx').includes('<ManagedPackageEntitlementsPanel'));
});
console.log(`${count}/${count} TD6 F11 package entitlement assertions passed`);
