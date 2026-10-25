import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('apps/server/src/core/operations-maintenance-window.ts');
const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(transpiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p13-'));
let n=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);n++};
const yes=(actual,message)=>{assert.ok(actual,message);n++};
const throws=(fn,re,message)=>{assert.throws(fn,re,message);n++};
try {
 fs.writeFileSync(path.join(dir,'calendar.cjs'),transpiled.outputText);
 const {validMaintenanceTimezone,normalizeMaintenanceWindowPolicy,previewMaintenanceWindows}=require(path.join(dir,'calendar.cjs'));
 const policy=(x={})=>({maintenanceWindowEnabled:true,maintenanceWindowTimezone:'America/New_York',maintenanceWindowDaysCsv:'Sun',maintenanceWindowStart:'03:00',maintenanceWindowDurationMinutes:60,...x});
 const now=Date.parse('2026-10-23T19:24:00Z');
 eq(previewMaintenanceWindows(policy({maintenanceWindowEnabled:false}),{now}).windows,[],'disabled policy never proposes a window');
 eq(previewMaintenanceWindows(policy({maintenanceWindowEnabled:false}),{now}).executable,false,'never executor approval');
 eq(normalizeMaintenanceWindowPolicy({}).enabled,false,'defaults disabled');
 eq(normalizeMaintenanceWindowPolicy({}).durationMinutes,60,'default duration');
 eq(normalizeMaintenanceWindowPolicy(policy({maintenanceWindowDaysCsv:'Mon, Wed'})).days,['Mon','Wed'],'weekday order');
 yes(validMaintenanceTimezone('America/New_York'),'IANA zone accepted');
 yes(validMaintenanceTimezone('Etc/UTC'),'UTC zone accepted');
 for(const invalid of ['','Bogus/Fantasy','America/New_York\nSECRET','../etc/passwd',String('A').repeat(65)]){
   eq(validMaintenanceTimezone(invalid),false,`reject invalid timezone ${JSON.stringify(invalid)}`);
 }
 for(const value of [null,'x',true,3,NaN,14.5,241,0,-1]){
   throws(()=>normalizeMaintenanceWindowPolicy(policy({maintenanceWindowDurationMinutes:value})),/duration/i,'invalid duration '+String(value));
 }
 for(const value of ['','Sun, Sun','Saturday','sun','Sun,','Sun;Wed', 'Mon,Joe', 'Mon, Wed, Mon']){
   throws(()=>normalizeMaintenanceWindowPolicy(policy({maintenanceWindowDaysCsv:value})),/weekday/i,'invalid weekdays '+JSON.stringify(value));
 }
 for(const value of ['03:70','3:00','24:00','23:60','03:00:00']){
   throws(()=>normalizeMaintenanceWindowPolicy(policy({maintenanceWindowStart:value})),/start/i,'invalid time '+value);
 }
 for(const value of [0,7,NaN,2.5]) throws(()=>previewMaintenanceWindows(policy(),{now,count:value}),/count|one to six|preview/i,'invalid count '+value);
 throws(()=>previewMaintenanceWindows(policy(),{now:NaN}),/Invalid maintenance calendar time/,'invalid now');
 throws(()=>previewMaintenanceWindows(policy(),{now:-1}),/Invalid maintenance calendar time/,'negative now');
 throws(()=>previewMaintenanceWindows(policy(),{now:1e20}),/Invalid maintenance calendar time/,'out of JS date range');
 const regular=previewMaintenanceWindows(policy(),{now,count:3});
 eq(regular.windows.length,3,'three windows');
 eq(regular.windows[0].startAt,'2026-10-25T07:00:00.000Z','NY autumn EDT Sunday');
 eq(regular.windows[1].startAt,'2026-11-01T08:00:00.000Z','NY autumn EST Sunday');
 eq(regular.windows[2].startAt,'2026-11-08T08:00:00.000Z','following EST Sunday');
 eq(regular.days,['Sun'],'normalized days');
 eq(regular.windows[0].active,false,'upcoming not active');
 eq(regular.windows[0].localDate,'2026-10-25','local calendar date');
 eq(regular.windows[0].endAt,'2026-10-25T08:00:00.000Z','duration applied in real time');
 eq(regular.executable,false,'cannot permit actions');
 const spring=previewMaintenanceWindows(policy({maintenanceWindowStart:'02:30'}),{now:Date.parse('2026-03-07T00:00:00Z'),count:2});
 eq(spring.windows[0].startAt,'2026-03-15T06:30:00.000Z','missing spring DST time skipped entirely');
 eq(spring.windows[1].startAt,'2026-03-22T06:30:00.000Z','next scheduled after DST transition');
 const autumn=previewMaintenanceWindows(policy({maintenanceWindowStart:'01:30'}),{now:Date.parse('2026-10-31T00:00:00Z'),count:2});
 eq(autumn.windows[0].startAt,'2026-11-01T05:30:00.000Z','first ambiguous autumn occurrence');
 eq(autumn.windows[1].startAt,'2026-11-08T06:30:00.000Z','no duplicate autumn execution window');
 eq(new Set(autumn.windows.map(w=>w.localDate)).size,2,'unique calendar days');
 const afterFirstAutumn=previewMaintenanceWindows(policy({maintenanceWindowStart:'01:30'}),{now:Date.parse('2026-11-01T06:45:00Z'),count:1});
 eq(afterFirstAutumn.windows[0].startAt,'2026-11-08T06:30:00.000Z','second autumn 01:30 is never a new window, even after first has expired');
 const duringSecondAutumn=previewMaintenanceWindows(policy({maintenanceWindowStart:'01:30',maintenanceWindowDurationMinutes:180}),{now:Date.parse('2026-11-01T06:45:00Z'),count:1});
 eq(duringSecondAutumn.windows[0].startAt,'2026-11-01T05:30:00.000Z','overlapping first autumn window remains authoritative');
 eq(duringSecondAutumn.windows[0].active,true,'first autumn long-running window is still active');
 const active=previewMaintenanceWindows(policy(),{now:Date.parse('2026-10-25T07:35:00Z'),count:2});
 eq(active.windows[0].active,true,'current window shown active');
 eq(active.windows[0].startAt,'2026-10-25T07:00:00.000Z','current start retained');
 const expired=previewMaintenanceWindows(policy(),{now:Date.parse('2026-10-25T08:01:00Z'),count:1});
 eq(expired.windows[0].localDate,'2026-11-01','closed window excluded');
 const multi=previewMaintenanceWindows(policy({maintenanceWindowDaysCsv:'Sun, Wed',maintenanceWindowStart:'21:15'}),{now,count:4});
 eq(multi.windows.length,4,'multiple days');
 yes(multi.windows.every((w,i)=>!i||w.startAt>multi.windows[i-1].startAt),'stable ordering');
 // Maintenance preflight must not grant false confidence outside a saved window.
 const preflightTranspiled=ts.transpileModule(read('apps/server/src/core/operations-maintenance-preflight.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 fs.writeFileSync(path.join(dir,'preflight.cjs'),preflightTranspiled.outputText);
 const {evaluateMaintenancePreflight}=require(path.join(dir,'preflight.cjs'));
 const base= (intent,window)=>({intent,mode:'normal',ready:true,draining:false,
   database:{ok:true,checkedAt:new Date(now).toISOString()},storage:{ok:true,checkedAt:new Date(now).toISOString()},
   tasks:[],jobs:{running:0},work:{heavyInFlight:0,criticalInFlight:0},window,recovery:{ok:true,state:'ready',generatedAt:new Date(now).toISOString(),checks:{instanceIdentityPresent:true,generationPresent:true,generationMatchesInstance:true,completeSchema:true,verificationPassed:true,restoreDrillPassed:true,latestGenerationVerified:true,backupFresh:true,drillFresh:true,secretKeyAvailable:true}},now});
 const outside={enabled:true,active:false,nextStartAt:regular.windows[0].startAt};
 const inside={enabled:true,active:true,nextStartAt:regular.windows[0].startAt};
 for(const intent of ['restart','update']){
   const blocked=evaluateMaintenancePreflight(base(intent,outside));
   eq(blocked.ok,false,`${intent} denied outside scheduled window`);
   yes(blocked.blockers.some(x=>x.code==='OUTSIDE_MAINTENANCE_WINDOW'),`${intent} reason outside window`);
   const missing=evaluateMaintenancePreflight(base(intent,null));
   eq(missing.ok,false,`${intent} denied when window settings unavailable`);
   yes(missing.blockers.some(x=>x.code==='WINDOW_UNVERIFIED'),`${intent} missing window fail closed`);
   const allowed=evaluateMaintenancePreflight(base(intent,inside));
   eq(allowed.ok,true,`${intent} has no policy blocker inside window`);
   eq(allowed.executable,false,`${intent} still not executable`);
   const manual=evaluateMaintenancePreflight(base(intent,{enabled:false,active:false,nextStartAt:null}));
   eq(manual.ok,true,`${intent} requires manual coordination when planning disabled`);
   yes(manual.warnings.some(x=>x.code==='NO_MAINTENANCE_WINDOW'),`${intent} no-window advisory`);
 }
 const validRecovery=base('update',inside).recovery;
 const invalidRecovery=[
   [null,'RECOVERY_UNVERIFIED'],
   [{...validRecovery,generatedAt:new Date(now-301_000).toISOString()},'RECOVERY_UNVERIFIED'],
   [{...validRecovery,generatedAt:new Date(now+5_001).toISOString()},'RECOVERY_UNVERIFIED'],
   [{...validRecovery,generatedAt:'bad time'},'RECOVERY_UNVERIFIED'],
   [{...validRecovery,ok:false},'RECOVERY_NOT_READY'],
   [{...validRecovery,state:'warning'},'RECOVERY_NOT_READY'],
   [{...validRecovery,state:'critical'},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,generationMatchesInstance:false}},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,latestGenerationVerified:false}},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,restoreDrillPassed:false}},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,backupFresh:false}},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,drillFresh:false}},'RECOVERY_NOT_READY'],
   [{...validRecovery,checks:{...validRecovery.checks,secretKeyAvailable:false}},'RECOVERY_NOT_READY'],
 ];
 for(const [recovery,code] of invalidRecovery){
   const result=evaluateMaintenancePreflight({...base('update',inside),recovery});
   eq(result.ok,false,`update blocked for recovery ${code}`);
   yes(result.blockers.some(b=>b.code===code),`recovery blocker ${code}`);
 }
 yes(read('apps/server/src/app/cluster-server.ts').includes('registerHealthOperationsRoutes({\n  recoveryReadiness,'),'actual recovery service passed to operations route');
 yes(read('apps/server/src/app/server-routes-health-operations.ts').includes('query.intent === "update" ? deps.recoveryReadiness()'),'update-only recovery validation (no extra probes for ordinary preview)');
 const ordinary=evaluateMaintenancePreflight(base('enter-maintenance',outside));
 eq(ordinary.ok,true,'entering maintenance state can be planned outside restart window');
 eq(ordinary.executable,false,'enter-maintenance never executable');
 // Registration, saved-settings validation, and protected-save integration.
 const routes=read('apps/server/src/app/server-routes-health-operations.ts');
 yes(routes.includes('app.get("/api/admin/operations/maintenance/windows"'),'admin endpoint');
 yes(routes.includes('window: maintenanceWindow'),'preflight receives persisted maintenance window evidence');
 yes(routes.includes('savedPolicy.status === "fulfilled"'),'failed policy read cannot be assumed enabled or healthy');
 const section=routes.slice(routes.indexOf('app.get("/api/admin/operations/maintenance/windows"'));
 yes(section.indexOf('requireAdminUserForRequest')<section.indexOf('previewMaintenanceWindows(await readSettings())'),'auth before saved policy read');
 yes(section.includes('Cache-Control", "no-store, private"'),'no caching of admin preview');
 const config=read('apps/server/src/app/server-routes-configuration-integrations.ts');
 const keys=['maintenanceWindowEnabled','maintenanceWindowTimezone','maintenanceWindowDaysCsv','maintenanceWindowStart','maintenanceWindowDurationMinutes'];
 for(const key of keys){eq((config.match(new RegExp(key+': z\\.','g'))||[]).length,2,`${key} protected config validation in both save schemas`);}
 const ui=read('packages/renderer/src/features/settings/ServerConfigPage.tsx');
 for(const key of keys) yes(ui.includes(`key: "${key}"`),`UI editable ${key}`);
 yes(ui.includes('Preview saved windows'),'explicit preview control');
 yes(ui.includes('never initiates a reboot, update or drain'),'UI does not promise automatic work');
 yes(read('apps/server/src/core/openapi.ts').includes('"/api/admin/operations/maintenance/windows": { get:'),'OpenAPI documented');
 const model=read('apps/server/src/app/server-composition-types.ts');
 const rendererModel=read('packages/renderer/src/features/application/application-models/settings-server.ts');
 for(const key of keys){yes(model.includes(key+'?:'),`server setting type ${key}`); yes(rendererModel.includes(key+'?:'),`client setting type ${key}`);}
 console.log(`${n}/${n} F4 P15 maintenance window and recovery safety assertions passed`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
