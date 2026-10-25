import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); }})();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(read(file), {fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,`${file} syntax`);
  const mod = {exports:{}};
  vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require:id => {
    if (Object.hasOwn(dependencies,id)) return dependencies[id];
    throw new Error(`Missing mock dependency: ${id}`);
  }}, {filename:file});
  return mod.exports;
}
const sharedTool = load('packages/shared/src/tool-settings-contract.ts');
const shared = load('packages/shared/src/project-tool-setting-contract.ts', {'./tool-settings-contract.js': sharedTool});
const service = load('apps/server/src/domains/admin/project-tool-settings.ts', {'@cluster/shared':shared});
const rows = new Map();
const makeKey = ({projectId,tool,field}) => `${projectId}/${tool}/${field}`;
const prisma = { projectToolSettingOverride: {
  async findUnique({where}) { const row=rows.get(makeKey(where.projectId_tool_field));return row?{...row}:null; },
  async create({data}) {const key=makeKey(data);if(rows.has(key)){const e=new Error('duplicate');e.code='P2002';throw e;}rows.set(key,{...data,revision:1});return {...rows.get(key)};},
  async updateMany({where,data}) {const key=makeKey(where);const row=rows.get(key);if(!row||row.revision!==where.revision)return {count:0};rows.set(key,{...row,valueJson:data.valueJson,revision:row.revision+data.revision.increment,updatedById:data.updatedById});return {count:1};},
  async deleteMany({where}) {const key=makeKey(where);const row=rows.get(key);if(!row||row.revision!==where.revision)return {count:0};rows.delete(key);return {count:1};},
}};
const projectId='project-one';
let passed=0;
async function check(name,fn) {await fn();passed++;console.log('PASS',name);}
await check('Studio default resolves when Project has no record', async () => {
  const x=await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'week'});
  assert.equal(x.value,'week');assert.equal(x.source,'studio');assert.equal(x.revision,null);
});
await check('Explicit Project view wins and supplies revision/provenance', async () => {
  await service.updateProjectCalendarView(prisma,projectId,'month',null,'admin');
  const x=await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'week'});
  assert.equal(x.value,'month');assert.equal(x.source,'project');assert.equal(x.revision,1);
});
await check('CAS update advances revision and retains Project precedence', async () => {
  await service.updateProjectCalendarView(prisma,projectId,'day',1,'admin');
  const x=await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'agenda'});
  assert.equal(x.value,'day');assert.equal(x.revision,2);
});
await check('Stale admin cannot overwrite newer Project choice', async () => {
  await assert.rejects(service.updateProjectCalendarView(prisma,projectId,'week',1,'admin'),e=>e.code==='PROJECT_TOOL_SETTING_CONFLICT');
  assert.equal((await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'week'})).value,'day');
});
await check('Parallel create collision permits only one committed winner', async () => {
  const result=await Promise.allSettled([service.updateProjectCalendarView(prisma,'second','month',null,'a'),service.updateProjectCalendarView(prisma,'second','week',null,'b')]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(result.filter(x=>x.status==='rejected'&&x.reason.code==='PROJECT_TOOL_SETTING_CONFLICT').length,1);
});
await check('Reset with stale expected revision fails closed', async () => {
  await assert.rejects(service.updateProjectCalendarView(prisma,projectId,null,1,'admin'),e=>e.code==='PROJECT_TOOL_SETTING_CONFLICT');
});
await check('Reset deletes Project row and follows future Studio default', async () => {
  await service.updateProjectCalendarView(prisma,projectId,null,2,'admin');
  assert.equal((await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'week'})).value,'week');
  assert.equal((await service.projectCalendarViewSnapshot(prisma,projectId,{calendarDefaultView:'month'})).value,'month');
  assert.equal(rows.has(makeKey({projectId,tool:'calendar',field:'defaultView'})),false);
});
await check('Resetting nonexistent Project override does not invent a Studio setting', async () => {
  await assert.rejects(service.updateProjectCalendarView(prisma,projectId,null,null,'admin'),/missing Project override/);
});
await check('Corrupted Project values fail closed instead of silently becoming defaults', async () => {
  rows.set('corrupted/calendar/defaultView',{valueJson:'"not-a-view"',revision:1});
  await assert.rejects(service.projectCalendarViewSnapshot(prisma,'corrupted',{}),/Invalid stored/);
});
await check('Only a non-security field is exposed by scoped implementation', async () => {
  const route=read('apps/server/src/domains/admin/admin-tool-routes.ts');
  assert(route.includes('requireToolAdmin(request, reply)'));
  assert(route.includes('PROJECT_TOOL_SETTING_CONFLICT'));
  assert(!read('apps/server/src/domains/admin/project-tool-settings.ts').includes('calendarEnabled'));
  assert(!read('packages/shared/src/project-tool-setting-contract.ts').includes('calendarEnabled'));
});
await check('Calendar reader requires authenticated Project access', async () => {
  const route=read('apps/server/src/domains/planning/calendar-routes.ts');
  assert(route.includes('authorization.requireProject(request, reply, projectId, "view")'));
  assert(route.includes('if (!actor) return reply.code(401)'));
});
await check('Renderer loads effective Project view without overwriting manual changes', async () => {
  const calendar=read('packages/renderer/src/features/calendar/CalendarPage.tsx');
  assert(calendar.includes('userChangedView.current'));
  assert(calendar.includes('/api/calendar/view-preference'));
  const admin=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
  assert(admin.includes('Project Calendar default view'));
  assert(admin.includes('Reset to Studio default'));
});
await check('Migration uses scoped Project FK and an atomic composite identity', async () => {
  const sql=read('apps/server/prisma/migrations/20261011133000_td1_project_calendar_inheritance/migration.sql');
  assert(sql.includes('PRIMARY KEY ("projectId", "tool", "field")'));
  assert(sql.includes('ON DELETE CASCADE'));
  assert(read('apps/server/prisma/schema.prisma').includes('model ProjectToolSettingOverride'));
});
await check('Service rejects unsupported view values even if called without HTTP validation', async () => {
  await assert.rejects(service.updateProjectCalendarView(prisma,'bad-view','serverOnly',null,'admin'),/Unsupported Project Calendar view/);
});
await check('Admin route enforces authorization, Project existence, CAS conflicts and reset', async () => {
  const validation={parse:x=>x,min(){return this},max(){return this},int(){return this},regex(){return this},positive(){return this},nullable(){return this},strict(){return this},optional(){return this}};
  const z={object:()=>validation,record:()=>validation,enum:()=>validation,boolean:()=>validation,number:()=>validation,string:()=>validation,unknown:()=>validation,literal:()=>validation,array:()=>validation};
  const routes=load('apps/server/src/domains/admin/admin-tool-routes.ts', {
    '@cluster/shared':{...sharedTool,...shared,CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS:Object.keys(sharedTool.CLUSTER_TOOL_SETTING_KEYS)},
    './project-tool-settings.js':service,
    'zod':{z},'node:fs/promises':{},'node:path':{},
  });
  const handlers=new Map();
  const app={get:(p,f)=>handlers.set('GET '+p,f),put:(p,f)=>handlers.set('PUT '+p,f),post:(p,f)=>handlers.set('POST '+p,f),log:{warn:()=>{}}};
  const db={...prisma, project:{findUnique:async({where})=> where.id==='missing'?null:{id:where.id,archived:false}}};
  routes.registerAdminToolRoutes(app,{prisma:db,
    getCurrentUser:async request=>request.denied?null:{id:'admin',isAdmin:true},
    decorateUserForClient:async user=>user,
    readSettings:async()=>({calendarDefaultView:'week'}),patchSettings:async()=>{},readSettingPreconditions:async()=>({}),resetSettingOverrides:async()=>{},
    verifyStorageSchema:async()=>{},logSecurityEvent:async()=>{},dataLayout:{},
  });
  const get=handlers.get('GET /api/admin/tools/calendar/projects/:projectId/default-view');
  const put=handlers.get('PUT /api/admin/tools/calendar/projects/:projectId/default-view');
  assert.equal(typeof get,'function');assert.equal(typeof put,'function');
  const invoke=async(handler,projectId,body,denied=false)=>{
    const reply={status:200,code(n){this.status=n;return this;},send(x){this.payload=x;return x;}};
    const output=await handler({params:{projectId},body,denied},reply);
    return {status:reply.status,body:output??reply.payload};
  };
  assert.equal((await invoke(get,'new-project',undefined,true)).status,403);
  assert.equal((await invoke(put,'new-project',{value:'month',expectedRevision:null,lockUserOverride:false},true)).status,403);
  assert.equal((await invoke(get,'missing')).status,404);
  const initial=await invoke(get,'new-project');assert.equal(initial.body.source,'studio');assert.equal(initial.body.value,'week');
  const saved=await invoke(put,'new-project',{value:'month',expectedRevision:null,lockUserOverride:false});assert.equal(saved.status,200);assert.equal(saved.body.revision,1);
  const stale=await invoke(put,'new-project',{value:'day',expectedRevision:null,lockUserOverride:false});assert.equal(stale.status,409);
  assert.equal(stale.body.code,'PROJECT_TOOL_SETTING_CONFLICT');
  const reset=await invoke(put,'new-project',{value:null,expectedRevision:1,lockUserOverride:false});assert.equal(reset.status,200);assert.equal(reset.body.value,'week');assert.equal(reset.body.source,'studio');
  const locked=await invoke(put,'new-project',{value:'day',expectedRevision:null,lockUserOverride:true});
  assert.equal(locked.status,200);assert.equal(locked.body.lockUserOverride,true);
  assert.equal(shared.clusterResolveEffectiveCalendarView(locked.body,'month').value,'day');
  const conflicting=await invoke(put,'new-project',{value:'day',expectedRevision:null,lockUserOverride:false});
  assert.equal(conflicting.status,409);
  const unlocked=await invoke(put,'new-project',{value:null,expectedRevision:1,lockUserOverride:false});
  assert.equal(unlocked.status,200);assert.equal(unlocked.body.lockUserOverride,false);
});
console.log(`${passed}/${passed} TD1 Project Calendar inheritance checks passed`);
