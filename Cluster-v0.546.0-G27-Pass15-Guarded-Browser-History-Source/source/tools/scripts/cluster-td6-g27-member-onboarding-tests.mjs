#!/usr/bin/env node
// G27 Batch 4: invoke the actual member onboarding route and its dependencies.
// Intentionally mock Prisma; this is not a replacement for PostgreSQL testing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourcePath = 'apps/server/src/domains/studio-systems/studio-onboarding-routes.ts';
function load(file, imports) {
  const js = ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(name => {
    if (Object.hasOwn(imports,name)) return imports[name];
    throw Error(`Fixture import not registered: ${name}`);
  },module,module.exports);
  return module.exports;
}
const schema = {parse:value=>value,min(){return this},max(){return this}};
const z = {object:()=>schema,string:()=>schema};
const runtime = load('apps/server/src/domains/studio-systems/studio-onboarding-runtime.ts',{});
const routes = load(sourcePath,{
  '@cluster/shared': {studioAudienceSchema:schema,studioOnboardingAssignmentLifecycleSchema:schema,studioOnboardingPlanCreateSchema:schema,studioOnboardingPlanVersionCreateSchema:schema},
  'zod':{z},
  '../access/studio-audience.js':{
    parseStudioJson:()=>({mode:'all',targets:[]}),
    resolveStudioAudienceUserIds:async()=>[],
    studioAudienceMatchesUser:async(_db,audience)=>audience!=='restricted',
  },
  './studio-form-runtime.js':{serializeStudioForm:row=>row,serializeStudioFormVersion:row=>row},
  './studio-onboarding-runtime.js':runtime,
  './studio-onboarding-publication.js':{commitStudioOnboardingPublication:async()=>({})},
});
let assertions=0;
async function check(label,fn){await fn();assertions++;console.log(`PASS G27 onboarding ${label}`);}
function fixture({loggedIn=true,steps=[],assignments=null,packets=[],forms=[],policies=[],completions=[]}={}){
  const handlers=new Map();const app={get:(path,fn)=>handlers.set('GET '+path,fn),post(){},patch(){}};
  const version={id:'version1',status:'published',versionLabel:'v1',steps,plan:{id:'plan1',key:'first-week',title:'First Week',status:'active',description:'Welcome'}};
  const assigned = assignments ?? [{id:'assigned1',userId:'member1',planVersionId:'version1',status:'active',assignedAt:new Date('2026-10-18T12:00:00Z'),planVersion:version}];
  let queries=0;
  const record=(data)=>async()=>{queries++;return data};
  const prisma={
    studioOnboardingAssignment:{findMany:async ({where})=>{queries++;return assigned.filter(row=>row.userId===where.userId && row.status===where.status)}},
    packetCompletion:{findMany:record(completions)},
    studioPolicyVersion:{findMany:record(policies)},
    studioPolicyAcceptance:{findMany:record([])},
    studioFormSubmission:{findMany:record([])},
    studioFormVersion:{findMany:record(forms)},
    packetDefinition:{findMany:record(packets)},
  };
  routes.registerStudioOnboardingRoutes({app,prisma,getCurrentUser:async()=>loggedIn?{id:'member1'}:null,authorization:{requireTool:async()=>true},logActivity:async()=>{}});
  async function member(){
    const reply={status:200,headers:{},code(v){this.status=v;return this},header(k,v){this.headers[k]=v;return this},send(value){this.data=value;return value}};
    const output=await handlers.get('GET /api/onboarding')({},reply);
    return {status:reply.status,data:output??reply.data,headers:reply.headers};
  }
  return {member,get queries(){return queries}};
}
await check('unauthenticated request cannot read assignments',async()=>{
  const f=fixture({loggedIn:false});const result=await f.member();assert.equal(result.status,401);
  assert.equal(result.data.code,'AUTH_REQUIRED');assert.equal(f.queries,0);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
});
await check('no assignments is an authoritative empty list',async()=>{
  const result=await fixture({assignments:[]}).member();assert.deepEqual(result.data,{plans:[]});
  assert.equal(result.headers['Cache-Control'],'private, no-store');
});
await check('deleted packet dependency is unavailable instead of crashing',async()=>{
  const f=fixture({steps:[{id:'step1',position:0,kind:'packet',resourceId:'missing',resourceLabel:'Missing asset',required:true}]});
  const result=await f.member();assert.equal(result.data.plans.length,1);
  assert.equal(result.data.plans[0].steps[0].action.kind,'unavailable');
  assert.equal(result.data.plans[0].progress.done,false);
});
await check('unauthorized packet remains inaccessible through onboarding action',async()=>{
  const step={id:'step1',kind:'packet',resourceId:'packet1',resourceLabel:'Editing kit',required:true};
  const result=await fixture({steps:[step],packets:[{id:'packet1',audienceJson:'restricted',libraryFolder:{id:'restricted-folder',status:'active'}}]}).member();
  assert.equal(result.data.plans[0].steps[0].action.kind,'unavailable');
  assert.equal(JSON.stringify(result.data).includes('restricted-folder'),false);
  assert.equal(result.data.plans[0].steps[0].resourceLabel,'Restricted onboarding resource');
  assert.equal(result.data.plans[0].steps[0].resourceId,null);
});
await check('eligible packet uses its Library folder navigation and canonical completion',async()=>{
  const step={id:'step1',kind:'packet',resourceId:'packet1',resourceLabel:'Editing kit',required:true};
  const result=await fixture({steps:[step],packets:[{id:'packet1',audienceJson:'public',libraryFolder:{id:'folder1',status:'active'}}],completions:[{userId:'member1',packetDefinitionId:'packet1',completedAt:new Date()}]}).member();
  assert.equal(result.data.plans[0].steps[0].action.packetId,'folder1');
  assert.equal(result.data.plans[0].progress.done,true);
});
await check('inactive and superseded assignments never surface on member page',async()=>{
  const step={id:'s1',kind:'packet',resourceId:'x',resourceLabel:'X',required:true};
  const active={id:'active',userId:'member1',status:'active',planVersion:{id:'pv',status:'published',steps:[step],plan:{id:'plan',key:'ok',title:'OK',status:'active'}}};
  const result=await fixture({assignments:[{...active,id:'revoked',status:'revoked'},{...active,id:'old',planVersion:{...active.planVersion,status:'draft'}},active]}).member();
  assert.deepEqual(result.data.plans.map(p=>p.assignmentId),['active']);
});
await check('notification links use member-scoped onboarding instead of generic tickets',()=>{
  const nav=readFileSync('packages/renderer/src/features/notifications/notification-navigation.ts','utf8');
  const page=readFileSync('packages/renderer/src/features/work/MyWorkPage.tsx','utf8');
  assert.match(nav,/studio_onboarding_assignment/);assert.match(nav,/screen: "mywork", inspectScope: "onboarding"/);
  assert.match(page,/onboardingPlans\.some/);assert.match(page,/cluster:inspector-state-changed/);
});
await check('notification navigation resolves a concrete My Work deep link',()=>{
  const mod=load('packages/renderer/src/features/notifications/notification-navigation.ts',{
    '@cluster/shared':{clusterResourceAddressFromEntity:()=>null},
    '../workflow/resource-navigation':{clusterResourceNavigation:()=>null},
  });
  const target=mod.notificationWorkNavigation({entityType:'studio_onboarding_assignment',entityId:'ownassignment',category:'action'});
  assert.deepEqual(target,{screen:'mywork',inspectScope:'onboarding',inspectId:'ownassignment'});
  assert.equal(mod.notificationDesktopRoute(target),'mywork/inspect/onboarding/ownassignment');
  assert.equal(mod.notificationWorkNavigation({entityType:'studio_onboarding_assignment',entityId:'',category:'action'}),null);
});
await check('missing policy does not expose its stored restricted label or ID',async()=>{
  const step={id:'step',kind:'policy',resourceId:'private-policy-v1',resourceLabel:'Secret policy title',resourceVersionLabel:'v1',required:true};
  const result=await fixture({steps:[step]}).member();
  const displayed=result.data.plans[0].steps[0];
  assert.equal(displayed.action.kind,'unavailable');
  assert.equal(displayed.resourceId,null);assert.equal(displayed.resourceLabel,'Restricted onboarding resource');
  assert.equal(JSON.stringify(displayed).includes('Secret policy title'),false);
});
await check('My Work integrates unfinished onboarding in its Attention queue',()=>{
  const page=readFileSync('packages/renderer/src/features/work/MyWorkPage.tsx','utf8');
  assert.match(page,/onboardingPlans\.filter\(\(plan\) => !plan\.progress\.done\)/);
  assert.match(page,/\.\.\.onboardingItems/);
  assert.match(page,/setView\("today"\);[\s\S]*?inspectScope: "onboarding"/);
});
await check('access explanation is on demand, self scoped, and reuses authoritative API',()=>{
  const panel=readFileSync('packages/renderer/src/features/work/MyEffectiveAccessPanel.tsx','utf8');
  assert.match(panel,/api\/access\/explain\?tool=/);
  assert.doesNotMatch(panel,/userId=/);
  assert.match(panel,/onClick=\{\(\) => void explain\(\)\}/);
  assert.match(panel,/requestId\.current/);
});
await check('first-login and My Work do not turn API failure into zero assignments',()=>{
  const login=readFileSync('packages/renderer/src/features/auth/FirstLoginExperience.tsx','utf8');
  const work=readFileSync('packages/renderer/src/features/work/MyWorkPage.tsx','utf8');
  assert.doesNotMatch(login,/\/api\/onboarding"\)\.catch\(/);
  assert.match(login,/Onboarding assignments unavailable/);
  assert.match(work,/api<\{ plans: OnboardingPlan\[\] \}>\("\/api\/onboarding"\)/);
  assert.match(work,/Onboarding assignments could not be refreshed/);
  assert.match(work,/if \(onboardingResult\.plans !== null\) setOnboardingPlans/);
});
console.log(`G27 member onboarding: ${assertions}/${assertions} checks passed`);
