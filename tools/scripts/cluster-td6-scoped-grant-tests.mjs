import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
const root=path.resolve(import.meta.dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const compile=(file,imports={})=>{const js=ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const module={exports:{}};new Function('require','module','exports',js)(name=>{if(name in imports)return imports[name];throw Error('Unexpected import '+name);},module,module.exports);return module.exports;};
class PeopleGovernanceError extends Error {constructor(code,message,statusCode=409){super(message);this.code=code;this.statusCode=statusCode;}}
const policy=compile('apps/server/src/domains/access/scoped-grant-policy.ts',{'../users/people-governance.js':{PeopleGovernanceError}});
const zChain=()=>new Proxy({parse:x=>x,strict:()=>zChain()},{get:(t,k)=>k in t?t[k]:()=>zChain()});
const z={object:zChain,string:zChain,enum:zChain,number:zChain,array:zChain,boolean:zChain,unknown:zChain,record:zChain};
const routes=compile('apps/server/src/domains/access/scoped-grant-routes.ts',{'zod':{z},'../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},'../users/people-governance.js':{PeopleGovernanceError},'./scoped-grant-policy.js':policy});
const authModule=compile('apps/server/src/domains/access/authorization.ts',{
  '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project'],CLUSTER_TOOL_PERMISSION_KEYS:['projects'],createClusterExplanation:()=>({}),validateClusterPermissionBundles:()=>[],validateClusterProjectBundlePolicies:()=>[],resolveAssignedPermissionBundles:()=>[],resolveClusterEffectiveState:()=>({}),clusterProjectBundleCap:()=>null},
  '../projects/project-membership.js':{membershipIsLead:()=>false,projectMembershipForUser:()=>null},
  './authorization-decision.js':{decisionResource:()=>({}),minimumForAuthorizationAction:()=> 'view'},
  '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({})},
  '../planning/calendar-access.js':{canAccessCalendarEvent:()=>true},
  './scoped-grant-policy.js':policy,
});
const projectAuth=authModule.createAuthorizationService({prisma:{},authRequired:true,getCurrentUser:async()=>null,decorateUserForClient:async()=>({workspaceRole:'member',isAdmin:false}),getStudioPermissionSettings:()=>({}),parseObject:value=>{try{return JSON.parse(value||'{}')}catch{return {}}},parseLabels:()=>[]});
const days=n=>new Date(Date.now()+n*86400000);
let checks=0;
async function test(name,fn){await fn();console.log('PASS',name);checks++;}
const subject={id:'person',username:'sample',displayName:'Sample',archived:false,accountState:'ACTIVE',accessExpiresAt:days(90),profileRevision:5};
await test('policy rejects inactive, expired and archived recipients',()=>{for(const changed of [{archived:true},{accountState:'DISABLED'},{accountState:'SUSPENDED'},{accessExpiresAt:days(-1)}])assert.throws(()=>policy.requireScopedGrantSubject({...subject,...changed}),e=>e.code.startsWith('SCOPED_GRANT_'));});
await test('grant expiry bounded to 180 days and the identity window',()=>{policy.validateScopedGrantWindow(subject,days(40));for(const until of [days(-1),days(200),days(95)])assert.throws(()=>policy.validateScopedGrantWindow(subject,until));});
await test('new personal access grants are additive; original explicit allowlists remain exclusive',()=>{assert.equal(policy.isExclusiveAccessAllow({effect:'allow',governedGrantId:'r1'}),false);assert.equal(policy.isExclusiveAccessAllow({effect:'allow',governedGrantId:null}),true);assert.equal(policy.isExclusiveAccessAllow({effect:'deny',governedGrantId:null}),false);});
await test('actual Project authorization preserves unrelated baseline, additive upgrades and explicit deny',async()=>{
  const p={id:'p1',name:'Project One',source:'internal',status:'active',memberships:[]};
  const scopedRule={id:'grant',targetKind:'project',targetId:'p1',subjectKind:'member',subjectId:'person',effect:'allow',level:'contribute',status:'active',expiresAt:days(20),governedGrantId:'r1'};
  const subjectActor={user:{...subject,projectPermissions:'{}'},role:'member',decorated:{workspaceRole:'member',isAdmin:false}};
  const otherActor={user:{...subject,id:'other',projectPermissions:'{}'},role:'member',decorated:{workspaceRole:'member',isAdmin:false}};
  const query=(actor,rules,minimum='view')=>projectAuth.authorize(actor,'view',{kind:'project',project:p},{minimum,rules});
  assert.equal((await query(otherActor,[scopedRule])).allowed,true,'other users retain baseline view');
  assert.equal((await query(subjectActor,[scopedRule],'contribute')).allowed,true,'recipient receives extra contribute access');
  assert.equal((await query(otherActor,[{...scopedRule,governedGrantId:null}])).allowed,false,'legacy manual allowlist remains exclusive');
  assert.equal((await query(subjectActor,[scopedRule,{...scopedRule,id:'deny',effect:'deny',level:'none'}])).allowed,false,'explicit denies are authoritative');
  assert.equal((await query(subjectActor,[{...scopedRule,expiresAt:days(-1)}],'contribute')).allowed,false,'expired grant confers no elevation');
  const managerActor={...subjectActor,user:{...subjectActor.user,projectPermissions:'{"p1":"manage"}'}};
  assert.equal((await query(managerActor,[{...scopedRule,level:'view'}],'manage')).allowed,true,'additive view grant never downgrades existing manager');
});
const checkRule={id:'rule1',targetKind:'project',targetId:'p1',subjectKind:'member',subjectId:'person',status:'active',effect:'allow',level:'view',expiresAt:days(18),updatedAt:days(-1)};
await test('extension requires matching rule identity, version, level and increasing expiry',()=>{const row={targetId:'p1',subjectUserId:'person',accessRuleId:'rule1',level:'view',previousExpiresAt:checkRule.expiresAt,expectedRuleUpdatedAt:checkRule.updatedAt,expiresAt:days(38)};policy.requireScopedGrantExtension(checkRule,row);for(const mutation of [{level:'manage'},{accessRuleId:'wrong'},{expiresAt:days(5)},{expectedRuleUpdatedAt:days(-2)}])assert.throws(()=>policy.requireScopedGrantExtension(checkRule,{...row,...mutation}));});
function harness(options={}) {
  const project={id:'p1',name:'Project One',status:'active',workspaceId:'w1',memberships:[]};
  const members=[{workspaceId:'w1',userId:'admin-a',role:'owner'},{workspaceId:'w1',userId:'admin-b',role:'admin'},...(!options.noMembership?[{workspaceId:'w1',userId:'person',role:'member'}]:[])];
  let state={user:structuredClone({...subject,...options.subject}),project,requests:[],rules:structuredClone(options.rules||[]),records:[],inbox:[],events:[]};
  const handlers=new Map(); let actor='admin-a',managerAllowed=true,projectAllowed=true,failRecord=false;
  const app={get:(p,f)=>handlers.set('GET '+p,f),post:(p,f)=>handlers.set('POST '+p,f)};
  let counter=0;
  function db(get){const s=new Proxy({}, {get(_,key){return get()[key]},set(_,key,value){get()[key]=value;return true}});return {
    user:{findUnique:async({where})=>where.id===s.user.id?structuredClone(s.user):null,findMany:async()=>[structuredClone(s.user)]},
    project:{findUnique:async({where})=>where.id==='p1'?structuredClone(s.project):null,findMany:async()=>[structuredClone(s.project)]},
    workspaceMember:{findUnique:async({where})=>members.find(m=>m.workspaceId===where.workspaceId_userId.workspaceId&&m.userId===where.workspaceId_userId.userId)||null,findMany:async({where})=>members.filter(m=>m.role==='owner'||m.role==='admin').map(m=>({userId:m.userId}))},
    studioScopedGrantRequest:{findMany:async()=>structuredClone(s.requests),findFirst:async({where})=>s.requests.find(x=>x.subjectUserId===where.subjectUserId&&x.targetId===where.targetId&&x.status===where.status)||null,
      findUnique:async({where})=>structuredClone(s.requests.find(x=>x.id===where.id)||null),create:async({data})=>{const x={...data,id:'r'+(++counter),status:'pending',requestedAt:new Date()};s.requests.push(x);return structuredClone(x);},
      updateMany:async({where,data})=>{const x=s.requests.find(y=>y.id===where.id&&y.status===where.status);if(!x)return {count:0};Object.assign(x,data);return {count:1};},update:async({where,data})=>{const x=s.requests.find(y=>y.id===where.id);Object.assign(x,data);return structuredClone(x);}},
    accessRule:{findMany:async({where})=>structuredClone(s.rules.filter(x=>x.targetId===where.targetId&&x.subjectId===where.subjectId&&x.effect==='allow'&&x.status==='active'&&(!x.expiresAt||new Date(x.expiresAt)>new Date()))),
      create:async({data})=>{const x={...data,id:'rule'+(s.rules.length+1),updatedAt:new Date(),createdAt:new Date()};s.rules.push(x);return structuredClone(x);},
      updateMany:async({where,data})=>{const x=s.rules.find(r=>r.id===where.id&&r.status===where.status&&new Date(r.expiresAt).getTime()===new Date(where.expiresAt).getTime()&&new Date(r.updatedAt).getTime()===new Date(where.updatedAt).getTime());if(!x)return {count:0};Object.assign(x,data,{updatedAt:new Date()});return {count:1};}},
    personnelRecord:{create:async({data})=>{if(failRecord)throw Error('RECORD_WRITE_FAILED');const x={...data,id:'rec'+s.records.length};s.records.push(x);return structuredClone(x);}},
    notificationInboxItem:{createMany:async({data})=>{s.inbox.push(...data);return {count:data.length};},updateMany:async({where,data})=>{let count=0;for(const x of s.inbox)if(x.groupKey===where.groupKey&&x.requiresAction===where.requiresAction){Object.assign(x,data);count++;}return {count};}}
  }}
  const prisma=db(()=>state);prisma.$transaction=async fn=>{const draft=structuredClone(state);const answer=await fn(db(()=>draft));state=draft;return answer;};
  routes.registerScopedGrantRoutes({app,prisma,authorization:{requireTool:async()=>managerAllowed,requireTarget:async()=>projectAllowed,authorize:async()=>({allowed:projectAllowed})},getCurrentUser:async()=>({id:actor}),logActivity:async x=>state.events.push(x),logSecurityEvent:async x=>state.events.push(x)});
  async function call(method,url,body){const handler=handlers.get(method+' '+url);assert.ok(handler,url);const response={statusCode:200,header(){return this},code(n){this.statusCode=n;return this},send(x){this.value=x;return x}};const params={grantId:state.requests[0]?.id};const value=await handler({body,params,query:{}},response);return {code:response.statusCode,data:response.value??value};}
  return {call,get:()=>state,setActor:x=>actor=x,setManager:x=>managerAllowed=x,setProject:x=>projectAllowed=x,failRecord:x=>failRecord=x,change:fn=>fn(state)};
}
const fixedExpiry=days(38);
const req=(user=subject)=>({userId:'person',projectId:'p1',operation:'grant',level:'view',expiresAt:fixedExpiry.toISOString(),reason:'Temporary external review access',expectedProfileRevision:user.profileRevision});
const f=harness();
await test('unauthorized manager receives no read or write projection',async()=>{f.setManager(false);assert.equal((await f.call('GET','/api/studio-systems/scoped-grants')).data,undefined);assert.equal((await f.call('POST','/api/studio-systems/scoped-grants',req())).data,undefined);f.setManager(true);});
await test('request queues independent peer review and never creates a permission',async()=>{const a=await f.call('POST','/api/studio-systems/scoped-grants',req());assert.equal(a.data.ok,true);assert.equal(f.get().rules.length,0);assert.equal(f.get().inbox[0].userId,'admin-b');assert.equal(f.get().requests[0].status,'pending');});
await test('duplicate pending grant refuses to create another request',async()=>{const a=await f.call('POST','/api/studio-systems/scoped-grants',req());assert.equal(a.code,409);assert.equal(a.data.code,'SCOPED_GRANT_PENDING');assert.equal(f.get().requests.length,1);});
await test('requester cannot approve own grant',async()=>{const a=await f.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Approved by me'});assert.equal(a.code,403);assert.equal(f.get().rules.length,0);});
await test('reviewer must retain People and Project manage rights',async()=>{f.setActor('admin-b');f.setProject(false);const a=await f.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Valid request'});assert.equal(a.data,undefined);assert.equal(f.get().rules.length,0);f.setProject(true);});
await test('independent reviewer commits bounded AccessRule and confidential evidence atomically',async()=>{const a=await f.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Need temporary access'});assert.equal(a.data.ok,true);assert.equal(f.get().rules[0].subjectKind,'member');assert.equal(f.get().rules[0].governedGrantId,f.get().requests[0].id);assert.equal(f.get().rules[0].expiresAt.toISOString(),new Date(req().expiresAt).toISOString());assert.equal(f.get().records[0].sourceKind,'studio_scoped_grant');assert.equal(f.get().records[0].classification,'confidential');assert.equal(f.get().inbox[0].requiresAction,false);});
await test('approval replay is rejected rather than issuing more grants',async()=>{const a=await f.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Second approval attempt'});assert.equal(a.code,409);assert.equal(f.get().rules.length,1);});
await test('stale recipient, missing workspace membership and identity-bound expiry fail closed',async()=>{for(const options of [{subject:{profileRevision:6}},{noMembership:true},{subject:{accessExpiresAt:days(9)}}]){const x=harness(options);const res=await x.call('POST','/api/studio-systems/scoped-grants',req());assert.equal(res.code,409);assert.equal(x.get().requests.length,0);}});
await test('changed recipient after request blocks grant approval',async()=>{const x=harness();await x.call('POST','/api/studio-systems/scoped-grants',req());x.change(s=>{s.user.accountState='DISABLED'});x.setActor('admin-b');const res=await x.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Checked request'});assert.equal(res.code,409);assert.equal(x.get().rules.length,0);});
await test('evidence failure rolls back the newly inserted AccessRule',async()=>{const x=harness();await x.call('POST','/api/studio-systems/scoped-grants',req());x.setActor('admin-b');x.failRecord(true);await assert.rejects(x.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Checked request'}),/RECORD_WRITE_FAILED/);assert.equal(x.get().rules.length,0);assert.equal(x.get().requests[0].status,'pending');});
await test('extension rejects missing/stale rule, preserves access level, and applies expiry only',async()=>{const x=harness({rules:[checkRule]});const body={...req(),operation:'extend',accessRuleId:'rule1',expiresAt:days(40).toISOString()};const a=await x.call('POST','/api/studio-systems/scoped-grants',body);assert.equal(a.data.ok,true);x.setActor('admin-b');const b=await x.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Extend current contract'});assert.equal(b.data.ok,true);assert.equal(x.get().rules.length,1);assert.equal(x.get().rules[0].level,'view');assert.equal(x.get().rules[0].expiresAt.toISOString(),new Date(body.expiresAt).toISOString());});
await test('changed grant revision blocks stale extension at review',async()=>{const x=harness({rules:[checkRule]});await x.call('POST','/api/studio-systems/scoped-grants',{...req(),operation:'extend',accessRuleId:'rule1',expiresAt:days(40).toISOString()});x.change(s=>{s.rules[0].updatedAt=days(-2)});x.setActor('admin-b');const a=await x.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'approved',reason:'Request still valid'});assert.equal(a.code,409);assert.equal(x.get().records.length,0);});
await test('new grant cannot silently supersede a live direct grant',async()=>{const x=harness({rules:[checkRule]});const a=await x.call('POST','/api/studio-systems/scoped-grants',req());assert.equal(a.code,409);assert.equal(x.get().requests.length,0);});
await test('denial leaves no AccessRule but retains confidential decision evidence',async()=>{const x=harness();await x.call('POST','/api/studio-systems/scoped-grants',req());x.setActor('admin-b');const a=await x.call('POST','/api/studio-systems/scoped-grants/:grantId/review',{decision:'rejected',reason:'Not needed now'});assert.equal(a.data.ok,true);assert.equal(x.get().rules.length,0);assert.equal(x.get().records.length,1);});
await test('legacy AccessRule handlers reject direct individual issuance and extension',async()=>{
  const legacy=compile('apps/server/src/domains/access/access-routes.ts',{
    'zod':{z},'@cluster/shared':{validateClusterBundleAssignments:()=>[],validateClusterPermissionBundles:()=>[]},
    './authorization.js':{ACCESS_RULE_TARGET_KINDS:['project'],AUTHORIZATION_RULE_SELECT:{}},
    './project-target-discovery.js':{discoverProjectAccessTargets:async()=>[],PROJECT_ACCESS_PICKER_KINDS:['project']},
    './project-rule-preview.js':{previewProjectRuleImpact:async()=>({})},
    '../workforce/workforce-user-authority.js':{WORKFORCE_USER_AUTHORITY_INCLUDE:{}},
  });
  const handlers={};const app={post:(url,fn)=>handlers[`POST ${url}`]=fn,get:(url,fn)=>handlers[`GET ${url}`]=fn,patch:(url,fn)=>handlers[`PATCH ${url}`]=fn,delete:(url,fn)=>handlers[`DELETE ${url}`]=fn};
  let writes=0;
  legacy.registerAccessRoutes({app,prisma:{accessRule:{findUnique:async()=>({id:'old',targetKind:'project',targetId:'p1',projectId:'p1',subjectKind:'member',subjectId:'person',effect:'allow',level:'view',status:'active'}),create:async()=>{writes++},update:async()=>{writes++}}},getCurrentUser:async()=>({id:'admin-a'}),authorization:{},serializeAccessRule:x=>x,logActivity:async()=>{},canAccessLibraryItem:async()=>false,getStudioPermissionSettings:()=>({}),cursorSecret:'x'});
  const reply=()=>({statusCode:200,code(n){this.statusCode=n;return this},send(x){this.value=x;return x}});
  const createReply=reply();await handlers['POST /api/access-rules']({body:{subjectKind:'member',subjectId:'person',targetKind:'project',targetId:'p1',effect:'allow',level:'manage',status:'paused'}},createReply);
  assert.equal(createReply.statusCode,409);assert.equal(createReply.value.code,'SCOPED_GRANT_REVIEW_REQUIRED');
  const patchReply=reply();await handlers['PATCH /api/access-rules/:ruleId']({params:{ruleId:'old'},body:{expiresAt:days(80).toISOString()}},patchReply);
  assert.equal(patchReply.statusCode,409);assert.equal(patchReply.value.code,'SCOPED_GRANT_REVIEW_REQUIRED');assert.equal(writes,0);
});
await test('direct REST creation and elevation paths are blocked, admin panel and migration registered',()=>{const access=read('apps/server/src/domains/access/access-routes.ts');const boot=read('apps/server/src/app/cluster-server.ts');const studio=read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx');const schema=read('apps/server/prisma/schema.prisma');const migration=read('apps/server/prisma/migrations/20261018223000_td6_f10_scoped_grant_requests/migration.sql');assert.ok(access.includes('SCOPED_GRANT_REVIEW_REQUIRED'));assert.ok(boot.includes('registerScopedGrantRoutes({'));assert.ok(studio.includes('<StudioScopedGrantsPanel />'));assert.ok(schema.includes('model StudioScopedGrantRequest'));assert.ok(migration.includes('StudioScopedGrantRequest_pending_unique'));assert.ok(migration.includes('AccessRule_governedGrantId_key'));assert.ok(read('apps/server/src/domains/access/authorization.ts').includes('scoped.some(isExclusiveAccessAllow)')); });
console.log(`${checks}/${checks} F10 scoped grant assertions passed`);
