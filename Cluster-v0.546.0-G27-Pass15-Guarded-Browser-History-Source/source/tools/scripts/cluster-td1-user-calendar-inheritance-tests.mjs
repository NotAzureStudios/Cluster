import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(file, dependencies={}) {
 const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,file);
 const mod={exports:{}};
 vm.runInNewContext(result.outputText,{module:mod,exports:mod.exports,require:id=>{
  if (Object.hasOwn(dependencies,id)) return dependencies[id];
  throw Error(`Missing test mock ${id}`);
 },AbortController,console},{filename:file});
 return mod.exports;
}
const sharedTool=load('packages/shared/src/tool-settings-contract.ts');
const shared=load('packages/shared/src/project-tool-setting-contract.ts',{'./tool-settings-contract.js':sharedTool});
const studio={calendarDefaultView:'week'};
const inheritedStudio=shared.clusterResolveProjectCalendarView(studio,null);
const inheritedProject=shared.clusterResolveProjectCalendarView(studio,{valueJson:'"month"',revision:2});
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS',name);}
await test('no explicit user preference retains Studio default and provenance',()=>{
 const result=shared.clusterResolveEffectiveCalendarView(inheritedStudio,undefined);
 assert.equal(result.value,'week');assert.equal(result.source,'studio');assert.equal(result.revision,null);
});
await test('no explicit user preference retains Project default and its revision',()=>{
 const result=shared.clusterResolveEffectiveCalendarView(inheritedProject,undefined);
 assert.equal(result.value,'month');assert.equal(result.source,'project');assert.equal(result.revision,2);
});
await test('explicit user preference overrides Project and Studio but preserves Project provenance',()=>{
 const result=shared.clusterResolveEffectiveCalendarView(inheritedProject,'agenda');
 assert.equal(result.value,'agenda');assert.equal(result.source,'user');assert.equal(result.revision,2);
 assert.equal(result.storedValue,'month');
 assert.equal(inheritedProject.value,'month');
});
await test('null, empty or unrecognized user values cannot shadow inherited defaults',()=>{
 for(const value of [null,'','invalid',true,{},0]){
  const resolved=shared.clusterResolveEffectiveCalendarView(inheritedProject,value);
  assert.equal(resolved.value,'month');assert.equal(resolved.source,'project');
 }
});
// Test the real registered user-preference handler with mocked storage and
// schema chaining. Zod schema source and UI reset semantics are checked below.
const validator=new Proxy({}, {get(_t,name) {if(name==='parse') return input=>input;return (..._args)=>validator;}});
const z=new Proxy({}, {get:()=> (..._args)=>validator});
const userRoute=load('apps/server/src/domains/users/user-preference-routes.ts', {
 zod:{z}, 'node:crypto':require('node:crypto'), '@cluster/shared':{CLUSTER_CREATE_MODE_IDS:[]},
 '../../core/policy-acceptance.js':{policyAcceptanceStatus:async()=>null},
 './people-profile-contract.js':{}, './people-governance.js':{},
 '../../core/security-verification.js':{}, '../workforce/workforce-normalization.js':{},
 '../../core/security-pin-credential.js':{},
});
function setup(initial='{}') {
 let row={id:'person-1',preferences:initial,personalAccentColor:null};
 const handlers=new Map();
 const app=Object.fromEntries(['get','patch','post','put','delete'].map(method=>[method,(url,handler)=>handlers.set(method.toUpperCase()+' '+url,handler)]));
 const prisma={user:{
  async findUnique({where}){return row?.id===where.id?{...row}:null;},
  async updateMany({where,data}) {if(!row||where.id!==row.id||where.preferences!==row.preferences)return {count:0};row={...row,...data};return {count:1};},
 },$transaction:async callback=>callback(prisma)};
 userRoute.registerUserPreferenceRoutes({app,prisma,
  getCurrentUser:async request=>request.denied?null:{id:'person-1'},
  decorateUserForClient:async user=>user,
  normalizePersonalAccent:x=>x,verifyPassword:async()=>true,hashPassword:async()=>'',verifyUserPin:async()=>true,
  logSecurityEvent:async()=>{},readSettings:async()=>({}),
 });
 const handler=handlers.get('PATCH /api/me/preferences');
 assert.equal(typeof handler,'function');
 async function send(body,denied=false) {
  const reply={status:200,code(n){this.status=n;return this;},send(result){this.payload=result;return result;}};
  const value=await handler({body,denied},reply);
  return {status:reply.status,body:value??reply.payload};
 }
 return {send,get:()=>row,handler};
}
await test('account PATCH persists an explicit user view without altering unrelated preferences',async()=>{
 const m=setup('{"other":"kept"}');
 const result=await m.send({preferences:{userCalendarDefaultView:'day'}});
 assert.equal(result.status,200);assert.equal(result.body.preferences.userCalendarDefaultView,'day');
 assert.equal(result.body.preferences.other,'kept');
});
await test('null reset deletes user override instead of saving a null sentinel',async()=>{
 const m=setup('{"other":"kept","userCalendarDefaultView":"agenda"}');
 const result=await m.send({preferences:{userCalendarDefaultView:null}});
 assert.equal(result.status,200);
 assert.equal(Object.hasOwn(result.body.preferences,'userCalendarDefaultView'),false);
 assert.equal(JSON.parse(m.get().preferences).other,'kept');
});
await test('normal unrelated preference patch retains an explicit user view',async()=>{
 const m=setup('{"userCalendarDefaultView":"week"}');
 await m.send({preferences:{userShowHelpText:true}});
 assert.equal(JSON.parse(m.get().preferences).userCalendarDefaultView,'week');
});
await test('two concurrent preference writers cannot silently overwrite each other',async()=>{
 const m=setup('{"userCalendarDefaultView":"week"}');
 const results=await Promise.all([m.send({preferences:{userCalendarDefaultView:'month'}}),m.send({preferences:{userCalendarDefaultView:'day'}})]);
 assert.equal(results.filter(x=>x.status===200).length,1);
 const denied=results.find(x=>x.status===409);
 assert(denied);assert.equal(denied.body.code,'USER_PREFERENCES_CONFLICT');
});
await test('unsigned-in user cannot modify personal view',async()=>{
 const m=setup();const result=await m.send({preferences:{userCalendarDefaultView:'month'}},true);
 assert.equal(result.status,401);assert.equal(m.get().preferences,'{}');
});
await test('server validates optional nullable personal Calendar preference',()=>{
 const source=read('apps/server/src/domains/users/user-preference-routes.ts');
 assert.match(source,/userCalendarDefaultView:\s*z\s*\.enum\(\["day", "week", "month", "agenda"\]\)\s*\.nullable\(\)/);
});
await test('normal Calendar API revalidates Project before resolving personal override',()=>{
 const source=read('apps/server/src/domains/planning/calendar-routes.ts');
 const authorization=source.indexOf('authorization.requireProject(request, reply, projectId, "view")');
 const personal=source.indexOf('clusterResolveEffectiveCalendarView(inherited, userView)');
 assert(authorization!==-1&&personal>authorization);
 assert(source.includes('prisma.user.findUnique({ where: { id: actor.id }, select: { preferences: true } })'));
});
await test('Account Settings exposes inherit + explicit views and does not pin a Week fallback',()=>{
 const account=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
 const core=read('packages/renderer/src/features/application/modules/application-foundation.tsx');
 assert(account.includes('userCalendarDefaultView: null'));
 assert(account.includes('<option value="inherit">Follow Project / Studio default</option>'));
 assert(core.includes('"userCalendarDefaultView"'));
 assert(account.includes('cluster-calendar-view-preference-changed'));
 assert(read('packages/renderer/src/features/calendar/CalendarPage.tsx').includes('cluster-calendar-view-preference-changed'));
});
console.log(`${checks}/${checks} TD1 user Calendar inheritance checks passed`);
