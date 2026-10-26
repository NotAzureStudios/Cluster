import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const ts = req('typescript');
const root = path.resolve(import.meta.dirname, '../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, imports={}) {
  const js = ts.transpileModule(source(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:name=>Object.hasOwn(imports,name)?imports[name]:req(name),
    Date,Promise,Error,Set,Map,Object,Array,String,Boolean,Number,JSON,Buffer,console},{filename:file});
  return module.exports;
}
const lifecycle=load('apps/server/src/domains/users/studio-access-expiry-lifecycle.ts',{
  './people-governance.js':{lockPeopleProfile:async()=>{}},
});
const {closePendingAccessRenewals,resolveAccessExpiryActions}=load('apps/server/src/domains/users/studio-access-renewal-closeout.ts');
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS G27 People',name);}
const now=new Date('2026-11-10T12:00:00Z');
const day=86400000;
function fixture(count=520,admins=2) {
  const users=Array.from({length:count},(_,i)=>({id:`u${String(i).padStart(4,'0')}`,
    username:`user${i}`,displayName:`User ${i}`, accountState:'ACTIVE',archived:false,
    accessExpiresAt:new Date(now.getTime()+day*(i%3===0?-1:i%3===1?0.5:5)),}));
  const reviewerIds=Array.from({length:admins},(_,i)=>`admin${String(i).padStart(4,'0')}`);
  const delivered=new Set(), inbox=[]; const revoked=new Set();
  let failNotifications=false;
  const db={
    workspaceMember:{findMany:async ({where,take})=>reviewerIds.filter(id=>!where.userId?.gt || id>where.userId.gt).slice(0,take).map(userId=>({userId}))},
    user:{findMany:async ({where,take})=>{
      const after=where.AND?.[1]?.OR;
      return users.filter(u=>u.accessExpiresAt<=where.AND[0].accessExpiresAt.lte)
        .filter(u=>!after || u.accessExpiresAt>after[0].accessExpiresAt.gt ||
          (u.accessExpiresAt.getTime()===after[1].accessExpiresAt.getTime()&&u.id>after[1].id.gt))
        .sort((a,b)=>a.accessExpiresAt-b.accessExpiresAt||a.id.localeCompare(b.id)).slice(0,take).map(u=>({id:u.id,accessExpiresAt:u.accessExpiresAt}));
    },findUnique:async ({where})=>users.find(u=>u.id===where.id)},
    session:{updateMany:async ({where})=>{if(revoked.has(where.userId))return {count:0};revoked.add(where.userId);return {count:1};}},
    studioAccessExpiryNotice:{createMany:async ({data})=>{const [row]=data;const key=`${row.userId}:${row.expiresAt.toISOString()}:${row.stage}`;
      if(delivered.has(key))return {count:0};delivered.add(key);return {count:1};}},
    notificationInboxItem:{createMany:async ({data})=>{if(failNotifications)throw new Error('INBOX_DOWN');inbox.push(...data);return {count:data.length};}},
    $transaction:async fn=>{
      // Stand-in for transaction rollback: snapshot mutable fixture state.
      const oldDelivered=new Set(delivered),oldRevoked=new Set(revoked),oldInbox=[...inbox];
      try{return await fn(db)}catch(e){delivered.clear();oldDelivered.forEach(k=>delivered.add(k));
        revoked.clear();oldRevoked.forEach(k=>revoked.add(k));inbox.splice(0,inbox.length,...oldInbox);throw e;}
    },
  };
  return {db,users,delivered,inbox,revoked,setFail:value=>{failNotifications=value}};
}
await check('access expiry stages use strict boundaries',()=>{
  assert.equal(lifecycle.accessNoticeStage(new Date(now.getTime()+9*day),now),null);
  assert.equal(lifecycle.accessNoticeStage(new Date(now.getTime()+5*day),now),'seven_days');
  assert.equal(lifecycle.accessNoticeStage(new Date(now.getTime()+day/2),now),'one_day');
  assert.equal(lifecycle.accessNoticeStage(new Date(now.getTime()-day),now),'expired');
});
await check('keyset pages all 520 expiring accounts without 500-identity ceiling',async()=>{
  const f=fixture();const r=await lifecycle.runStudioAccessExpiryTick({prisma:f.db,now,limit:75});
  assert.equal(r.inspected,520);assert.equal(r.delivered,520);assert.equal(f.delivered.size,520);
  assert.equal(f.inbox.length,1040);
  assert.equal(f.revoked.size,174);
  const rerun=await lifecycle.runStudioAccessExpiryTick({prisma:f.db,now,limit:91});
  assert.equal(rerun.inspected,520);assert.equal(rerun.delivered,0);assert.equal(f.inbox.length,1040);
});
await check('administrator recipient pagination supports more than 500 active administrators',async()=>{
  const f=fixture(3,526);const r=await lifecycle.runStudioAccessExpiryTick({prisma:f.db,now,limit:88});
  assert.equal(r.delivered,3);assert.equal(f.inbox.length,3*526);
});
await check('no active administrator fails closed before writing evidence',async()=>{
  const f=fixture(2,0);await assert.rejects(()=>lifecycle.runStudioAccessExpiryTick({prisma:f.db,now,limit:1}),/No active Studio administrator/);
  assert.equal(f.delivered.size,0);
});
await check('notification persistence failure does not commit expiry evidence or session revocation',async()=>{
  const f=fixture(1);f.setFail(true);
  await assert.rejects(()=>lifecycle.runStudioAccessExpiryTick({prisma:f.db,now,limit:1}),/INBOX_DOWN/);
  assert.equal(f.delivered.size,0);assert.equal(f.revoked.size,0);
});
await check('pending renewals close and their review actions resolve in the offboarding transaction',async()=>{
  const updated=[];const inbox=[];
  const result=await closePendingAccessRenewals({
    studioAccessRenewal:{findMany:async()=>[{id:'req1'},{id:'req2'}],updateMany:async payload=>{updated.push(payload);return {count:2}}},
    notificationInboxItem:{updateMany:async payload=>{inbox.push(payload);return {count:2}}},
  },{userId:'u1',actorId:'admin1',now});
  assert.equal(result.count,2);assert.equal(updated[0].data.status,'cancelled');
  assert.deepEqual(Array.from(updated[0].where.id.in),['req1','req2']);
  assert.deepEqual(Array.from(inbox[0].where.groupKey.in),['access-renewal:req1','access-renewal:req2']);
  assert.equal(inbox[0].data.requiresAction,false);
  assert.equal(inbox[1].where.signal,'access_expiration');
});
await check('concurrent renewal decision invalidates offboarding closeout',async()=>{
  await assert.rejects(()=>closePendingAccessRenewals({
    studioAccessRenewal:{findMany:async()=>[{id:'req1'}],updateMany:async()=>({count:0})},
    notificationInboxItem:{updateMany:async()=>{throw Error('must not reach')}},
  },{userId:'u1',actorId:'admin',now}),/changed during offboarding/);
});
await check('excess pending renewals fail closed without running updates',async()=>{
  const pending=Array.from({length:1001},(_,i)=>({id:`req${i}`}));
  await assert.rejects(()=>closePendingAccessRenewals({studioAccessRenewal:{findMany:async()=>pending,
    updateMany:async()=>{throw Error('must not mutate')}}},{userId:'u1',actorId:'admin',now}),/Too many pending/);
});
await check('idempotent closeout skips writes when nothing is pending',async()=>{
  const result=await closePendingAccessRenewals({studioAccessRenewal:{findMany:async()=>[],updateMany:async()=>{throw Error('unexpected')}},
    notificationInboxItem:{updateMany:async({where})=>{assert.equal(where.signal,'access_expiration');return {count:0}}}},{userId:'u1',actorId:'admin',now});
  assert.equal(result.count,0);
});
await check('renewed account closes obsolete expiry actions without deleting history',async()=>{
  const observed=[];
  await resolveAccessExpiryActions({notificationInboxItem:{updateMany:async args=>{observed.push(args);return {count:1}}}},'u1',now);
  assert.equal(observed[0].where.resourceId,'u1');
  assert.equal(observed[0].where.requiresAction,true);
  assert.equal(observed[0].data.requiresAction,false);
});
const schema=new Proxy({}, {get(_t,key){if(key==='parse')return value=>value;return ()=>schema;}});
const z=new Proxy({}, {get(){return ()=>schema;}});
const handlers=new Map();
const {registerStudioAccessRenewalRoutes}=load('apps/server/src/domains/users/studio-access-renewal-routes.ts',{
  zod:{z}, './people-governance.js':{lockPeopleProfile:async()=>{},PeopleGovernanceError:class extends Error{}},
  './studio-access-renewal-policy.js':{requireRenewableAccount:()=>{},requireRenewalFresh:()=>{},validateRenewalWindow:()=>{}},
  './studio-access-renewal-closeout.js':{resolveAccessExpiryActions:async()=>{}},
});
let lastWhere;
const people=Array.from({length:131},(_,i)=>({id:`u${String(i).padStart(3,'0')}`,username:`person${i}`,
  displayName:`Name ${i}`,accountType:'contractor',accountState:'ACTIVE',profileRevision:1,
  accessExpiresAt:new Date(now.getTime()+4*day)}));
registerStudioAccessRenewalRoutes({app:{get:(route,handler)=>handlers.set(`GET ${route}`,handler),post:()=>{}},
  authorization:{requireTool:async()=>true},prisma:{studioAccessRenewal:{findMany:async()=>[]},
  user:{findMany:async({where,take})=>{lastWhere=where;return people.filter(u=>!where.OR || where.OR.some(q=>
    ['username','displayName','preferredName'].some(k=>q[k]?.contains && String(u[k]||'').toLowerCase().includes(String(q[k].contains).toLowerCase()))))
    .filter(u=>!where.AND || u.id>where.AND[0].OR[1].id.gt)
    .slice(0,take)}}},getCurrentUser:async()=>({id:'admin'})});
const endpoint=handlers.get('GET /api/studio-systems/access-renewals');
const reply=()=>({status:200,headers:{},code(n){this.status=n;return this},header(k,v){this.headers[k]=v;return this},send(data){this.body=data;return this}});
await check('renewal query provides a bounded first page and a stable continuation cursor',async()=>{
  const r=reply();const out=await endpoint({query:{}},r);
  assert.equal(out.expiring.length,50);assert.ok(out.nextCursor);assert.equal(r.headers['Cache-Control'],'no-store');
  const more=await endpoint({query:{cursor:out.nextCursor}},reply());
  assert.equal(more.expiring.length,50);assert.equal(more.expiring[0].id,'u050');
});
await check('renewal search queries all candidates rather than only the first 250',async()=>{
  const out=await endpoint({query:{search:'person129'}},reply());
  assert.equal(out.expiring.length,1);assert.equal(out.expiring[0].id,'u129');
  assert.ok(lastWhere.OR);
});
await check('corrupt pagination tokens fail with a safe 400',async()=>{
  const r=reply();await endpoint({query:{cursor:'not-a-token'}},r);
  assert.equal(r.status,400);assert.equal(r.body.code,'ACCESS_RENEWAL_CURSOR_INVALID');
});
assert.match(source('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts'),/closePendingAccessRenewals\(tx,/);
assert.match(source('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts'),/accessRenewalsCancelled:/);
assert.match(source('packages/renderer/src/features/settings/StudioAccessRenewalsPanel.tsx'),/Search accounts/);
console.log(`${checks} G27 People lifecycle checks passed`);
