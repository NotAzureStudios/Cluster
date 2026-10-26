import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => {try{return require('typescript');}catch{return require(path.join('/usr/local/lib/node_modules/typescript'));}})();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
function load(name, deps={}) {
 const transpiled=ts.transpileModule(read(name),{fileName:name,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 assert.equal(transpiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const module={exports:{}};
 vm.runInNewContext(transpiled.outputText,{module,exports:module.exports,require:id=>{
  if (Object.hasOwn(deps,id)) return deps[id];
  throw new Error('Missing mock '+id);
 },console}, {filename:name});
 return module.exports;
}
const tool=load('packages/shared/src/tool-settings-contract.ts');
const shared=load('packages/shared/src/project-tool-setting-contract.ts',{'./tool-settings-contract.js':tool});
const service=load('apps/server/src/domains/admin/project-tool-settings.ts',{'@cluster/shared':shared});
const rows=new Map();
const key=(o)=>`${o.projectId}/${o.tool}/${o.field}`;
const prisma={projectToolSettingOverride:{
 async findUnique({where}) {const row=rows.get(key(where.projectId_tool_field));return row?{...row}:null;},
 async create({data}) {const k=key(data); if(rows.has(k)){const e=new Error('duplicate');e.code='P2002';throw e;}const row={...data,revision:1};rows.set(k,row);return {...row};},
 async updateMany({where,data}) {const k=key(where),row=rows.get(k);if(!row||row.revision!==where.revision)return {count:0}; rows.set(k,{...row,...data,revision:row.revision+1});return {count:1};},
 async deleteMany({where}) {const k=key(where),row=rows.get(k);if(!row||row.revision!==where.revision)return {count:0};rows.delete(k);return {count:1};},
}};
let checks=0;
async function check(title,fn) {await fn();checks++;console.log('PASS',title);}
const studio={calendarDefaultView:'week'};
await check('Studio fallback is never locked and personal preference wins',async()=>{
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(inherited.lockUserOverride,false);
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,'day').source,'user');
});
await check('New Project override can lock out personal default on initial load',async()=>{
 await service.updateProjectCalendarView(prisma,'p','month',null,'admin',true);
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(inherited.lockUserOverride,true);
 assert.equal(inherited.revision,1);
 const resolved=shared.clusterResolveEffectiveCalendarView(inherited,'day');
 assert.equal(resolved.value,'month');assert.equal(resolved.source,'project');
 assert.equal(resolved.storedValue,'month');
});
await check('Lock cannot shadow Project default with an invalid personal value',async()=>{
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,'invalid').value,'month');
});
await check('Lock update CAS prevents stale admin from reverting policy',async()=>{
 await service.updateProjectCalendarView(prisma,'p','month',1,'admin',false);
 await assert.rejects(service.updateProjectCalendarView(prisma,'p','month',1,'stale-admin',true),e=>e.code==='PROJECT_TOOL_SETTING_CONFLICT');
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(inherited.lockUserOverride,false);assert.equal(inherited.revision,2);
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,'day').value,'day');
});
await check('Re-locking is revisioned and takes effect without changing view value',async()=>{
 await service.updateProjectCalendarView(prisma,'p','month',2,'admin',true);
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(inherited.lockUserOverride,true);assert.equal(inherited.revision,3);
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,'day').value,'month');
});
await check('Reset deletes both the Project override and lock, restoring Studio and User precedence',async()=>{
 await service.updateProjectCalendarView(prisma,'p',null,3,'admin',false);
 const inherited=await service.projectCalendarViewSnapshot(prisma,'p',studio);
 assert.equal(inherited.lockUserOverride,false);assert.equal(inherited.source,'studio');
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,'day').value,'day');
 assert.equal(shared.clusterResolveEffectiveCalendarView(inherited,null).value,'week');
});
await check('Boolean false is preserved and invalid stored policy is rejected',async()=>{
 rows.set('bad/calendar/defaultView',{valueJson:'"week"',revision:1,lockUserOverride:'yes'});
 await assert.rejects(service.projectCalendarViewSnapshot(prisma,'bad',studio),/Invalid stored Project Calendar lock policy/);
 rows.set('bad/calendar/defaultView',{valueJson:'"week"',revision:1,lockUserOverride:false});
 assert.equal((await service.projectCalendarViewSnapshot(prisma,'bad',studio)).lockUserOverride,false);
});
await check('Service rejects non-boolean lock even if HTTP validation is bypassed',async()=>{
 await assert.rejects(service.updateProjectCalendarView(prisma,'not-allowed','week',null,'admin','true'),/Invalid Project Calendar lock policy/);
 assert.equal(rows.has('not-allowed/calendar/defaultView'),false);
});
await check('Multiple Projects retain separate lock policy and do not alter Studio defaults',async()=>{
 await service.updateProjectCalendarView(prisma,'a','day',null,'admin',true);
 await service.updateProjectCalendarView(prisma,'b','agenda',null,'admin',false);
 assert.equal(shared.clusterResolveEffectiveCalendarView(await service.projectCalendarViewSnapshot(prisma,'a',studio),'month').value,'day');
 assert.equal(shared.clusterResolveEffectiveCalendarView(await service.projectCalendarViewSnapshot(prisma,'b',studio),'month').value,'month');
 assert.equal(studio.calendarDefaultView,'week');
});
await check('Schema, SQL, API and admin editor all carry the same lock policy',async()=>{
 const schema=read('apps/server/prisma/schema.prisma');
 const sql=read('apps/server/prisma/migrations/20261011143000_td1_project_calendar_parent_lock/migration.sql');
 const routes=read('apps/server/src/domains/admin/admin-tool-routes.ts');
 const ui=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
 const calendar=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.match(schema,/lockUserOverride Boolean @default\(false\)/);
 assert.match(sql,/ADD COLUMN "lockUserOverride" BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(routes,/lockUserOverride: z\.boolean\(\)/);
 assert(routes.includes('body.value !== null && body.lockUserOverride === true'));
 assert(ui.includes('setCalendarProjectLockDraft'));
 assert(ui.includes('Ignore personal default-view preferences for this Project'));
 assert(ui.includes('calendarProjectLockDraft === calendarProjectDefault.lockUserOverride'));
 assert(calendar.includes('clusterResolveEffectiveCalendarView(inherited, userView)'));
 assert(!read('apps/server/src/domains/admin/project-tool-settings.ts').includes('calendarEnabled'));
});
console.log(`${checks}/${checks} TD1 Project Calendar parent-lock checks passed`);
