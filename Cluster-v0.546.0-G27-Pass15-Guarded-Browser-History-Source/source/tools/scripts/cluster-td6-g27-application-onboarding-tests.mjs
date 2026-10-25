#!/usr/bin/env node
// G27 Batch 3: execute real application review/conversion handlers using a
// rollback-capable transactional fixture. PostgreSQL integration is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, imports = {}) {
  const source = readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',js)(name => {
    if (Object.hasOwn(imports,name)) return imports[name];
    throw Error(`Unexpected fixture import: ${name}`);
  },module,module.exports);
  return module.exports;
}
const profile = load('apps/server/src/domains/studio-systems/studio-application-profile.ts');
const revision = load('apps/server/src/domains/studio-systems/studio-application-revisions.ts');
const schema = { parse: value => value, min() { return this; }, max() { return this; } };
const z = { object: () => schema, string: () => schema };
let checks=0;
async function test(label, fn){await fn(); checks++; console.log(`PASS G27 application ${label}`);}

await test('unselected applicant fields are never copied', () => {
  assert.deepEqual(profile.buildApplicationProfile([{id:'name',profileMappingKey:'displayName'},{id:'secret',profileMappingKey:'legalName'}],{name:'  Artist  ',secret:'Private'},['name']),{displayName:'Artist'});
});
for (const [label,fields,answers,selected] of [
  ['unknown mapping', [{id:'f',profileMappingKey:'toolPermissions'}],{f:'admin'},['f']],
  ['removed mapping', [],{f:'any'},['f']],
  ['duplicate target', [{id:'a',profileMappingKey:'displayName'},{id:'b',profileMappingKey:'displayName'}],{a:'A',b:'B'},['a','b']],
  ['invalid email', [{id:'mail',profileMappingKey:'email'}],{mail:'invalid'},['mail']],
  ['oversized name', [{id:'name',profileMappingKey:'displayName'}],{name:'A'.repeat(201)},['name']],
  ['nontext mapping', [{id:'name',profileMappingKey:'displayName'}],{name:['one','two']},['name']],
  ['duplicate field selection', [{id:'name',profileMappingKey:'displayName'}],{name:'Name'},['name','name']],
]) await test(`rejects ${label}`, () => {
  assert.throws(() => profile.buildApplicationProfile(fields,answers,selected), error => error.code === 'APPLICATION_MAPPING_INVALID');
});

function fixture({status='approved',plan='published',allowed=true,failAudit=false,failInbox=false,failActivity=false}={}) {
  const stamp='2026-10-22T13:01:00.000Z';
  let state={ submission:{id:'application1',updatedAt:new Date(stamp),status,convertedUserId:null,
      form:{id:'form1',purpose:'application',title:'New team application'},
      formVersion:{id:'formversion1',schemaJson:JSON.stringify({fields:[{id:'name',profileMappingKey:'displayName'},{id:'access',profileMappingKey:'toolPermissions'}]})},
      answersJson:JSON.stringify({name:'Candidate',access:'owner'})},
    users:[], activities:[], audits:[], inbox:[{groupKey:'application:application1',requiresAction:true,acknowledgedAt:null}],
    assignments:[],
  };
  let auditFailure=failAudit, inboxFailure=failInbox, activityFailure=failActivity;
  let statusOnboarding=plan, audienceAllowed=allowed, onboardingReads=0, authorized=true;
  let userSerial=0;
  const appRoutes=new Map();
  const app=Object.fromEntries(['get','post','patch','put'].map(method=>[method,(path,handler)=>appRoutes.set(`${method.toUpperCase()} ${path}`,handler)]));
  function db() { return {
    studioFormSubmission:{
      findFirst:async ({where}) => where.id===state.submission.id ? structuredClone(state.submission) : null,
      updateMany:async ({where,data}) => {
        const row=state.submission;
        if(where.id!==row.id || where.updatedAt?.getTime()!==row.updatedAt.getTime() || row.convertedUserId !== null ||
          (typeof where.status==='string' && row.status!==where.status) ||
          (where.status?.in && !where.status.in.includes(row.status))) return {count:0};
        Object.assign(row,structuredClone(data),{updatedAt:new Date(row.updatedAt.getTime()+1000)});return {count:1};
      },
      findUniqueOrThrow:async()=>structuredClone(state.submission),
      update:async ({data}) => {Object.assign(state.submission,structuredClone(data));return structuredClone(state.submission)},
    },
    studioOnboardingPlanVersion:{ findUnique:async({where}) => where.id==='planv1' ? {id:'planv1',status:statusOnboarding==='changes_after_preflight' && ++onboardingReads>1 ? 'draft' : statusOnboarding==='changes_after_preflight'?'published':statusOnboarding,
      dueAfterDays:7,plan:{id:'plan1',status:'active',title:'First Week',audienceJson:JSON.stringify({mode:'include',targets:[{kind:'studio'}]})}} : null },
    notificationInboxItem:{
      updateMany:async({where,data})=>{if(inboxFailure)throw Error('INBOX_WRITE_FAILED');let count=0;
        for(const row of state.inbox){if(row.groupKey===where.groupKey && row.requiresAction===where.requiresAction){Object.assign(row,structuredClone(data));count++}}return {count};},
      create:async({data})=>{if(inboxFailure)throw Error('INBOX_WRITE_FAILED');state.inbox.push(structuredClone(data));return {id:'notice-new'}}
    },
    user:{findUnique:async({where})=>state.users.find(row=>row.username===where.username)||null,
      create:async({data})=>{const row={id:`person${++userSerial}`,username:data.username,accountState:data.accountState,
        displayName:data.displayName,email:data.email,role:data.memberships?.create?.role,
        toolPermissions:data.toolPermissions,projectPermissions:data.projectPermissions,
        passwordHash:data.passwordHash};state.users.push(row);return structuredClone(row)}},
    workspace:{findFirstOrThrow:async()=>({id:'w1'})},
    studioOnboardingAssignment:{findUnique:async()=>null,create:async({data})=>{const row={id:'onboard1',...data};state.assignments.push(row);return row}},
    $transaction:async(fn)=>{
      const old=structuredClone(state);
      try { return await fn(db()) } catch(error) {state=old;throw error}
    },
  }}
  const parser={ parse:value=>value };
  const workflow=load('apps/server/src/domains/studio-systems/studio-workflow-routes.ts', {
    '@cluster/shared':{publicApplicationSubmissionSchema:parser,studioAnnouncementCreateSchema:parser,studioAnnouncementScheduleSchema:parser,studioAnnouncementDraftEditSchema:parser,studioAnnouncementAudiencePreviewSchema:parser,
      studioApplicationConversionSchema:parser,studioApplicationListQuerySchema:parser,studioApplicationReviewSchema:parser,projectVisibleStudioFormAnswers:()=>({})},
    zod:{z},'../../core/cursor-pagination.js':{buildCursorPage:()=>({}),cursorWhere:()=>null,decodeCursor:()=>null},
    '../access/studio-audience.js':{parseStudioJson:(value,fallback)=>value ? JSON.parse(value) : fallback,parseStudioAudience:value=>value ? JSON.parse(value) : {mode:"all",targets:[]},
      resolveStudioAudienceUserIds:async()=>[],studioAudienceMatchesUser:async()=>audienceAllowed,
      loadStudioAudienceUserContext:async()=>({departmentId:'',jobRoleId:'',teamIds:new Set(),projectIds:new Set()}),
      studioAudienceMatchesContext:()=>audienceAllowed},
    './studio-form-runtime.js':{applicationRespondentMetadata:()=>({}),serializeStudioForm:()=>({}),serializeStudioFormVersion:()=>({}),validateStudioFormAnswers:()=>({ok:true})},
    './studio-onboarding-runtime.js':{createStudioOnboardingAssignment:async(tx,v,userId,source,assignedAt)=>({created:true,assignment:await tx.studioOnboardingAssignment.create({data:{planVersionId:v.id,userId,source,assignedAt}})})},
    '../workforce/workforce-normalization.js':{syncUserWorkforceAuthorities:async()=>{}},
    './studio-application-revisions.js':revision,
    './studio-announcement-create-intents.js':{announcementCreateDigest:()=> 'test-digest',isAnnouncementCreateUniqueConflict:(e)=>e?.code==='P2002'},
    './studio-application-profile.js':profile,
    './studio-announcement-delivery.js':{createStudioAnnouncementDelivery:()=>({publish:async()=>({outcome:'missing'})})},
    '../../core/security-audit-store.js':{appendSecurityAuditEvent:async(_tx,event)=>{state.audits.push(structuredClone(event));if(auditFailure)throw Error('AUDIT_WRITE_FAILED');}},
  });
  const prisma=db();
  workflow.registerStudioWorkflowRoutes({app,prisma,authorization:{requireTool:async()=>authorized},getCurrentUser:async()=>({id:'administrator'}),
    normalizeAuthUsername:input=>input.trim().toLowerCase(), generateTemporaryPassword:()=> 'ephemeral-test-only',hashPassword:async()=> 'hashed-only',
    logActivity:async()=>{if(activityFailure)throw Error('ACTIVITY_WRITE_FAILED');},events:{},readSettings:async()=>({})});
  async function call(method,path,body){const reply={code(n){this.status=n;return this},header(name,value){this.headers ||= {};this.headers[name]=value;return this},send(v){return v},status:200};
    const handler=appRoutes.get(`${method} ${path}`);assert.ok(handler,path);
    const result=await handler({params:{submissionId:'application1'},body},reply);
    return {status:reply.status,result,headers:reply.headers || {}};
  }
  const convert=(changes={})=>call('POST','/api/studio-systems/applications/:submissionId/convert',{
    username:'candidate1',selectedFieldIds:['name'],expectedUpdatedAt:stamp,onboardingVersionId:'planv1',...changes});
  const review=(status,next={})=>call('PATCH','/api/studio-systems/applications/:submissionId/review',{
    status,note:'Reviewed',expectedUpdatedAt:stamp,...next});
  return {convert,review,get state(){return state},setAuditFailure:v=>auditFailure=v,setPlan:v=>statusOnboarding=v,
    setAllowed:v=>audienceAllowed=v,setActivityFailure:v=>activityFailure=v,setAuthorized:v=>authorized=v,
    read:()=>call('GET','/api/studio-systems/applications/:submissionId')};
}
await test('conversion creates member with explicit field, onboarding and first-login action',async()=>{
 const f=fixture();const response=await f.convert();assert.equal(response.result.ok,true);
 assert.equal(f.state.users.length,1);assert.equal(f.state.users[0].role,'member');
 assert.equal(f.state.users[0].accountState,'PASSWORD_CHANGE_REQUIRED');
 assert.equal(f.state.users[0].toolPermissions,'{}');assert.equal(f.state.users[0].displayName,'Candidate');
 assert.equal(f.state.users[0].access,undefined);assert.equal(f.state.assignments.length,1);
 assert.equal(f.state.inbox.length,2);assert.equal(f.state.inbox[0].requiresAction,false);
 assert.equal(f.state.inbox[1].requiresAction,true);assert.equal(f.state.inbox[1].userId,'person1');
 assert.equal(f.state.audits.length,1);assert.equal(f.state.audits[0].event,'account.created');
 assert.equal(JSON.stringify(f.state.audits).includes('ephemeral-test-only'),false);
 assert.equal(f.state.submission.status,'converted');assert.equal(f.state.submission.convertedUserId,'person1');
 assert.equal(response.result.temporaryPassword,'ephemeral-test-only');
});
await test('a second conversion attempt cannot issue another account',async()=>{
 const f=fixture();await f.convert();const result=await f.convert();assert.equal(result.status,409);
 assert.equal(result.result.code,'APPLICATION_ALREADY_CONVERTED');assert.equal(f.state.users.length,1);
});
await test('security-audit failure rolls back account, onboarding and Inbox changes',async()=>{
 const f=fixture({failAudit:true});await assert.rejects(f.convert(),/AUDIT_WRITE_FAILED/);
 assert.equal(f.state.users.length,0);assert.equal(f.state.assignments.length,0);
 assert.equal(f.state.inbox.length,1);assert.equal(f.state.inbox[0].requiresAction,true);
 assert.equal(f.state.submission.status,'approved');assert.equal(f.state.audits.length,0);
});
await test('Inbox write failure rolls back account and approval claim',async()=>{
 const f=fixture({failInbox:true});await assert.rejects(f.convert(),/INBOX_WRITE_FAILED/);
 assert.equal(f.state.users.length,0);assert.equal(f.state.submission.status,'approved');
});
await test('changed onboarding status prevents account creation',async()=>{
 const f=fixture({plan:'changes_after_preflight'});const result=await f.convert();assert.equal(result.result.code,'ONBOARDING_VERSION_STALE');
 assert.equal(f.state.users.length,0);assert.equal(f.state.inbox.length,1);
});
await test('ineligible onboarding blocks conversion transaction instead of silently skipping',async()=>{
 const f=fixture({allowed:false});const result=await f.convert();assert.equal(result.result.code,'ONBOARDING_AUDIENCE_DENIED');
 assert.equal(f.state.users.length,0);assert.equal(f.state.assignments.length,0);
});
await test('explicitly selecting no plan creates a person without an onboarding assignment',async()=>{
 const f=fixture({allowed:false});const result=await f.convert({onboardingVersionId:null});assert.equal(result.result.ok,true);
 assert.equal(f.state.assignments.length,0);assert.equal(f.state.inbox.length,1);
});
await test('forbidden application mapping fails before issuing an account',async()=>{
 const f=fixture();const result=await f.convert({selectedFieldIds:['access']});assert.equal(result.result.code,'APPLICATION_MAPPING_INVALID');
 assert.equal(f.state.users.length,0);
});
await test('activity logging failure after commit does not conceal generated credential',async()=>{
 const f=fixture({failActivity:true});const result=await f.convert();assert.equal(result.result.temporaryPassword,'ephemeral-test-only');
 assert.equal(f.state.users.length,1);assert.equal(f.state.audits.length,1);
});
await test('deep-linked applicant detail returns the authorized exact record',async()=>{
  const f=fixture();const detail=await f.read();assert.equal(detail.status,200);
  assert.equal(detail.result.application.id,'application1');assert.equal(detail.headers['Cache-Control'],'no-store');
  f.setAuthorized(false);const denied=await f.read();assert.equal(denied.result,undefined);
  const server=readFileSync('apps/server/src/domains/studio-systems/studio-workflow-routes.ts','utf8');
  const ui=readFileSync('packages/renderer/src/features/settings/StudioApplicationsPanel.tsx','utf8');
  const nav=readFileSync('packages/renderer/src/features/notifications/notification-navigation.ts','utf8');
  assert.match(server,/app\.get\("\/api\/studio-systems\/applications\/:submissionId"/);
  assert.match(server,/reply\.header\("Cache-Control", "no-store"\)/);
  assert.match(nav,/item\.entityType === "studio_application"/);
  assert.match(ui,/targetApplicationId/);
});
await test('review approval writes audit within the transaction',async()=>{
 const f=fixture({status:'submitted'});const result=await f.review('approved');assert.equal(result.result.status,'approved');
 assert.equal(f.state.audits.length,1);assert.equal(f.state.inbox[0].requiresAction,true);
});
await test('review rejection closes old application action without deleting history',async()=>{
 const f=fixture({status:'submitted'});const result=await f.review('rejected');assert.equal(result.result.status,'rejected');
 assert.equal(f.state.inbox[0].requiresAction,false);assert.ok(f.state.inbox[0].acknowledgedAt);
});
await test('review audit failure rolls back the review and leaves Inbox pending',async()=>{
 const f=fixture({status:'submitted',failAudit:true});await assert.rejects(f.review('rejected'),/AUDIT_WRITE_FAILED/);
 assert.equal(f.state.submission.status,'submitted');assert.equal(f.state.inbox[0].requiresAction,true);
});
console.log(`G27 application/onboarding: ${checks}/${checks} checks passed`);
