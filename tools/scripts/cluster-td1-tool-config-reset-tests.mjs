import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'))}})();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');
const transpile=(file)=>{
 const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,`${file} syntax`);
 return result.outputText;
};
const evalModule=(filename,dependencies={})=>{
 const mod={exports:{}};
 vm.runInNewContext(transpile(filename),{module:mod,exports:mod.exports,console,process,require:(id)=>{if(Object.hasOwn(dependencies,id))return dependencies[id];throw Error(`Unhandled import: ${id}`)}},{filename});
 return mod.exports;
};
const shared=evalModule('packages/shared/src/tool-settings-contract.ts');
const crypto={BOOT_SECRET_SETTING_KEYS:new Set(),SENSITIVE_SETTING_KEYS:new Set(),decryptSettingStorageValue:(_k,v)=>v,encryptSettingStorageValue:(_k,v)=>v,shouldEncryptSetting:()=>false,encryptedValueNeedsRotation:()=>false};
const servicesModule=evalModule('apps/server/src/app/server-services-settings-integrations.ts',{
 'node:fs/promises':{readFile:async()=>{const e=Error('ENOENT');e.code='ENOENT';throw e;}},
 '../core/setting-crypto.js':crypto,
 '../core/server-config-publication-journal.js':{hasPublicationJournal:async()=>false},
 '../core/server-config-preconditions.js':{},
 '../domains/access/configurable-tool-availability.js':{},
 '../core/auth.js':{}, '../core/data-layout.js':{}, '../core/database-provider.js':{}, '../core/storage-migrations.js':{}, '../core/secret-store.js':{}, '../core/security-pin-credential.js':{},
});
const rows=new Map([
 ['timelineDefaultRangeDays',JSON.stringify(45)],
 ['studioDefaultMilestoneCadence',JSON.stringify('weekly')],
 ['ticketsAutoArchiveDays',JSON.stringify(null)],
 ['serverHost',JSON.stringify('internal-host')],
]);
let commits=0, notifications=0, tail=Promise.resolve();
const rowOperations=(state)=>({
 findMany:async({where}={})=>[...state].filter(([key])=>!where?.key?.in||where.key.in.includes(key)).map(([key,value])=>({key,value})),
 upsert:async({where,create,update})=>{state.set(where.key,state.has(where.key)?update.value:create.value)},
 deleteMany:async({where})=>{if(where.key)state.delete(where.key);else for(const key of where.key.in)state.delete(key)},
});
const prisma={
 appSetting:rowOperations(rows),
 timelineItem:{count:async()=>0},entityComment:{count:async()=>0},
 boardList:{findMany:async()=>[]},card:{count:async()=>0},
 $transaction:async(fn)=>{
   const next=tail.then(async()=>{
    const staging=new Map(rows);
    const result=await fn({appSetting:rowOperations(staging),$queryRaw:async()=>[{locked:1}]});
    rows.clear();for(const [k,v] of staging)rows.set(k,v);commits++;return result;
   });tail=next.catch(()=>undefined);return next;
 },
};
const services=servicesModule.createSettingsIntegrationServices({
 CONFIG_FILE_PATH:'/nonexistent',DATA_LAYOUT:{},DATA_ROOT:'/nonexistent',SERVER_MANAGED_SETTING_KEYS:new Set(['serverHost']),
 app:{log:{error:()=>{},warn:()=>{}}},prisma,studioPermissionSettings:{},onStudioSettingsChanged:()=>{notifications++}
});
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name)}
await check('reset removes a saved value instead of pinning a literal default',async()=>{
 const baseline=await services.readSettingPreconditions(['timelineDefaultRangeDays']);
 const result=await services.resetSettingOverrides(['timelineDefaultRangeDays'],baseline);
 assert.equal(JSON.stringify(result.changedKeys),JSON.stringify(['timelineDefaultRangeDays']));
 assert(!rows.has('timelineDefaultRangeDays'));
 assert.equal((await services.readSettingPreconditions(['timelineDefaultRangeDays'])).timelineDefaultRangeDays.exists,false);
 assert.equal(shared.clusterResolveToolConfig('timeline',await services.readSettings(true)).defaultRangeDays,30);
});
await check('reset clears explicitly stored null rather than interpreting it as absent',async()=>{
 const b=await services.readSettingPreconditions(['ticketsAutoArchiveDays']);assert.equal(b.ticketsAutoArchiveDays.exists,true);assert.equal(b.ticketsAutoArchiveDays.value,null);
 await services.resetSettingOverrides(['ticketsAutoArchiveDays'],b);
 assert(!rows.has('ticketsAutoArchiveDays'));
 assert.equal(shared.clusterResolveToolConfig('tickets',await services.readSettings(true)).autoArchiveDays,90);
});
await check('stale reset cannot erase a concurrent admin update',async()=>{
 const b=await services.readSettingPreconditions(['studioDefaultMilestoneCadence']);
 await services.patchSettings({studioDefaultMilestoneCadence:'monthly'},b);
 const before=commits;
 await assert.rejects(services.resetSettingOverrides(['studioDefaultMilestoneCadence'],b),e=>e.code==='STUDIO_SETTINGS_CONFLICT'&&e.conflictingKeys.includes('studioDefaultMilestoneCadence'));
 assert.equal(JSON.parse(rows.get('studioDefaultMilestoneCadence')),'monthly');assert.equal(commits,before);
});
await check('missing row, incomplete expectation and server-managed setting all fail closed',async()=>{
 await assert.rejects(services.resetSettingOverrides(['timelineDefaultRangeDays'],{timelineDefaultRangeDays:{exists:true,value:45}}),e=>e.code==='STUDIO_SETTINGS_CONFLICT');
 await assert.rejects(services.resetSettingOverrides(['studioDefaultMilestoneCadence'],{}),/identify every selected field/);
 await assert.rejects(services.resetSettingOverrides(['serverHost'],{serverHost:{exists:true,value:'internal-host'}}),/server-managed/);
 assert.equal(JSON.parse(rows.get('serverHost')),'internal-host');
});
await check('reset changes only selected rows and sends runtime propagation when committed',async()=>{
 const pre=notifications;
 const b=await services.readSettingPreconditions(['studioDefaultMilestoneCadence']);
 await services.resetSettingOverrides(['studioDefaultMilestoneCadence'],b);
 assert.equal(notifications,pre+1);
 assert(!rows.has('studioDefaultMilestoneCadence'));
 assert.equal(JSON.parse(rows.get('serverHost')),'internal-host');
});
// Lightweight route harness: executable authorization/confirmation/endpoint logic
// is tested here, while all transaction logic above uses the real service code.
// The schema chain stub is not a substitute for a dependency-backed Zod test.
const validation={parse:v=>v,min(){return this},max(){return this},int(){return this},regex(){return this},strict(){return this},optional(){return this}};
const z={object:()=>validation,record:()=>validation,enum:()=>validation,boolean:()=>validation,number:()=>validation,string:()=>validation,unknown:()=>validation,literal:()=>validation,array:()=>validation};
const routeModule=evalModule('apps/server/src/domains/admin/admin-tool-routes.ts',{
 '@cluster/shared':{...shared, CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS:Object.keys(shared.CLUSTER_TOOL_SETTING_KEYS)},
 'zod':{z},
 'node:fs/promises':{},'node:path':{},
 './project-tool-settings.js':{projectCalendarViewSnapshot:async()=>({value:'agenda',source:'studio',revision:null}),updateProjectCalendarView:async()=>{}},
});
const registered=new Map();
let serveStaleSettings=false;
const app={get:(p,cb)=>registered.set('GET '+p,cb),put:(p,cb)=>registered.set('PUT '+p,cb),post:(p,cb)=>registered.set('POST '+p,cb)};
routeModule.registerAdminToolRoutes(app,{
 prisma,getCurrentUser:async req=>({id:'a',isAdmin:!req.noAdmin}),decorateUserForClient:async user=>user,
 readSettings:()=>serveStaleSettings?Promise.resolve({timelineDefaultRangeDays:999}):services.readSettings(true),patchSettings:services.patchSettings,readSettingPreconditions:services.readSettingPreconditions,
 resetSettingOverrides:services.resetSettingOverrides,verifyStorageSchema:async()=>{},logSecurityEvent:async()=>{},dataLayout:{},
});
const endpoint=registered.get('POST /api/admin/tools/:tool/settings/:field/reset');
assert.equal(typeof endpoint,'function');
async function invoke(tool,field,body,noAdmin=false){
 const reply={statusCode:200,code(n){this.statusCode=n;return this},send(v){this.payload=v;return v}};
 const result=await endpoint({params:{tool,field},body,noAdmin},reply);
 return {status:reply.statusCode,result:result??reply.payload};
}
await check('reset endpoint rejects non-admin access',async()=>{
 const r=await invoke('timeline','defaultView',{},true);assert.equal(r.status,403);
});
await check('unknown tool setting field is rejected before changing DB',async()=>{
 const r=await invoke('timeline','serverHost',{expectedSetting:{exists:true,value:'internal-host'}});
 assert.equal(r.status,404);assert(rows.has('serverHost'));
});
await check('Studio-owned setting reset requires explicit impact acknowledgement',async()=>{
 rows.set('studioStatusReportCadence',JSON.stringify('biweekly'));
 const b=(await services.readSettingPreconditions(['studioStatusReportCadence'])).studioStatusReportCadence;
 const denial=await invoke('timeline','statusReportCadence',{expectedSetting:b});
 assert.equal(denial.status,409);assert.equal(denial.result.code,'TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED');
 assert(rows.has('studioStatusReportCadence'));
 const permitted=await invoke('timeline','statusReportCadence',{expectedSetting:b,acknowledgeStudioChanges:true});
 assert.equal(permitted.status,200);assert.equal(permitted.result.ok,true);assert(!rows.has('studioStatusReportCadence'));
 assert.equal(permitted.result.settingProvenance.find(x=>x.field==='statusReportCadence').source,'resolved');
});
await check('route rejects outdated expected value after another administrator saves',async()=>{
 rows.set('timelineDefaultRangeDays',JSON.stringify(41));
 const baseline=(await services.readSettingPreconditions(['timelineDefaultRangeDays'])).timelineDefaultRangeDays;
 await services.patchSettings({timelineDefaultRangeDays:75},{timelineDefaultRangeDays:baseline});
 const conflict=await invoke('timeline','defaultRangeDays',{expectedSetting:baseline});
 assert.equal(conflict.status,409);assert.equal(conflict.result.code,'TOOL_CONFIG_CONFLICT');
 assert.equal(JSON.parse(rows.get('timelineDefaultRangeDays')),75);
});
await check('tool-owned field reset returns refreshed config, preconditions and provenance',async()=>{
 const baseline=(await services.readSettingPreconditions(['timelineDefaultRangeDays'])).timelineDefaultRangeDays;
 const r=await invoke('timeline','defaultRangeDays',{expectedSetting:baseline});
 assert.equal(r.status,200);assert.equal(r.result.config.defaultRangeDays,30);
 assert.equal(r.result.expectedSettings.timelineDefaultRangeDays.exists,false);
 assert.equal(r.result.settingProvenance.find(x=>x.field==='defaultRangeDays').source,'resolved');
});
await check('absent DB row cannot resurrect from stale five-second Settings projection',async()=>{
 serveStaleSettings=true;
 const reply={statusCode:200,code(n){this.statusCode=n;return this},send(v){this.payload=v;return v}};
 const list=await registered.get('GET /api/admin/tools')({noAdmin:false},reply);
 const timeline=list.tools.find(x=>x.key==='timeline');
 assert.equal(timeline.config.defaultRangeDays,30);
 assert.equal(timeline.settingProvenance.find(x=>x.field==='defaultRangeDays').source,'resolved');
 serveStaleSettings=false;
});
await check('resetting a disabled tool availability field restores its default and emits runtime notification',async()=>{
 rows.set('timelineEnabled',JSON.stringify(false));
 const before=notifications;
 const baseline=(await services.readSettingPreconditions(['timelineEnabled'])).timelineEnabled;
 const result=await invoke('timeline','enabled',{expectedSetting:baseline});
 assert.equal(result.status,200);assert.equal(result.result.config.enabled,true);
 assert.equal(notifications,before+1);assert(!rows.has('timelineEnabled'));
});
await check('renderer retains other unsaved fields, confirms resets and updates tool listeners',()=>{
 const ui=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
 assert.match(ui,/confirmCluster\(\{/);assert.match(ui,/setDraft\(\(current\) => \(\{ \.\.\.current, \[entry\.field\]: result\.config\[entry\.field\] \}\)\)/);
 assert.match(ui,/cluster-tool-settings-changed/);assert.match(ui,/entry\.source === "stored" && <ClusterButton/);
 assert.match(ui,/acknowledgeStudioChanges: entry\.scope === "studio"/);
});
console.log(`${passed}/${passed} TD1 Tool Config atomic reset checks passed`);
