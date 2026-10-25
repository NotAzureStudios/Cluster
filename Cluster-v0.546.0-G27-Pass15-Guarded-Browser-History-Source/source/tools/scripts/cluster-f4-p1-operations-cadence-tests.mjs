import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const src=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const moduleSource=src('apps/server/src/core/operations-maintenance-cadence.ts');
const trans=ts.transpileModule(moduleSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((trans.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p1-'));
let passed=0;
const ok=(v,m)=>{assert.ok(v,m);passed++};
const eq=(a,b,m)=>{assert.equal(a,b,m);passed++};
try {
 fs.writeFileSync(path.join(directory,'cadence.cjs'),trans.outputText);
 const {OPERATIONS_CADENCE,operationsCadenceMilliseconds,operationsCadenceValue}=require(path.join(directory,'cadence.cjs'));
 const rules={operationsReadinessIntervalMinutes:[2,2,15,60_000],operationsEscalationIntervalMinutes:[2,2,5,60_000],operationsNativeReconcileIntervalMinutes:[2,2,5,60_000],operationsIntegrityScanHours:[6,1,24,3_600_000]};
 for(const [key,[d,min,max,multiplier]] of Object.entries(rules)){
  eq(OPERATIONS_CADENCE[key].defaultValue,d,`${key} default`);
  eq(operationsCadenceMilliseconds(key,undefined),d*multiplier,`${key} missing`);
  eq(operationsCadenceMilliseconds(key,null),d*multiplier,`${key} null`);
  eq(operationsCadenceMilliseconds(key,NaN),d*multiplier,`${key} NaN`);
  eq(operationsCadenceMilliseconds(key,Infinity),d*multiplier,`${key} infinity`);
  eq(operationsCadenceMilliseconds(key,-Infinity),d*multiplier,`${key} negative infinity`);
  eq(operationsCadenceMilliseconds(key,'2'),d*multiplier,`${key} string not coerced`);
  eq(operationsCadenceMilliseconds(key,{}),d*multiplier,`${key} object not coerced`);
  eq(operationsCadenceMilliseconds(key,min-1),d*multiplier,`${key} below bound`);
  eq(operationsCadenceMilliseconds(key,max+1),d*multiplier,`${key} above bound`);
  eq(operationsCadenceMilliseconds(key,min+0.5),d*multiplier,`${key} fraction rejected`);
  eq(operationsCadenceMilliseconds(key,min),min*multiplier,`${key} min`);
  eq(operationsCadenceMilliseconds(key,max),max*multiplier,`${key} max`);
  eq(operationsCadenceValue(key,min),min,`${key} roundtrip`);
  ok(Number.isSafeInteger(operationsCadenceMilliseconds(key,max)),`${key} bounded safe timer`);
 }
 const routes=src('apps/server/src/app/server-routes-configuration-integrations.ts');
 const settings=src('apps/server/src/app/server-composition-types.ts');
 const viewModel=src('packages/renderer/src/features/application/application-models/settings-server.ts');
 const ui=src('packages/renderer/src/features/settings/ServerConfigPage.tsx');
 const scheduler=src('apps/server/src/app/cluster-server.ts');
 const registry=src('apps/server/src/core/background-tasks.ts');
 const managed=src('apps/server/src/app/server-services-settings-integrations.ts');
 for(const [key,[d,min,max]] of Object.entries(rules)) {
  ok(routes.includes(`${key}: z.number().int().min(${min}).max(${max}).optional()`), `${key} strict Zod`);
  ok((routes.match(new RegExp(`${key}: z\\.number\\(\\)\\.int\\(\\)`, 'g'))||[]).length>=2, `${key} all save/config surfaces`);
  ok(settings.includes(`${key}?: number`),`${key} setting payload`);
  ok(viewModel.includes(`${key}?: number`),`${key} renderer payload`);
  ok(ui.includes(`key: "${key}"`) && ui.includes(`section: "maintenance"`), `${key} UI editable`);
  ok(ui.includes(`${key}: ${d},`),`${key} UI default`);
  ok(scheduler.includes(`operationsCadenceMilliseconds("${key}", (await readSettings()).${key})`), `${key} live effective setting`);
 }
 const expected=['"api-tool-dependency-readiness"','"operations-incident-alert-escalation"','"native-emergency-incident-reconcile"','"data-integrity-reconcile"'];
 for(const name of expected)eq(scheduler.split(`scheduleAdaptive(${name}`).length-1,1,`${name} one scheduled job`);
 ok(!moduleSource.includes('restartService')&&!moduleSource.includes('executeUpdate')&&!moduleSource.includes('deleteMany'), 'cadence cannot grant recovery authority');
 ok(ui.includes('section === "maintenance"')&&ui.includes('renderSectionFields("maintenance")'), 'maintenance navigation connected');
 ok(ui.includes('requestSecurityPin(') && ui.includes('await api("/api/server-config"'), 'one protected server config flow reused');
 ok(managed.includes('const databasePayload = stripServerManagedSettings(payload'), 'database settings persisted transactionally');
 ok(!managed.includes('"operationsReadinessIntervalMinutes",'), 'cadence not assigned to boot config');
 ok(registry.includes('const explicitDelay = outcome.result'), 'existing adaptive task result delay honored');
 ok(registry.includes('record.consecutiveFailures') && registry.includes('maxBackoffMs'), 'scheduler retains backoff');
 console.log(`${passed}/${passed} F4 P1 operations cadence assertions passed`);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
