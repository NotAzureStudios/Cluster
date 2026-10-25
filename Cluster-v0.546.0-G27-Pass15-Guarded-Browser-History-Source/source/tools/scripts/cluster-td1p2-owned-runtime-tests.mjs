import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (filename) => fs.readFileSync(path.join(base,filename),'utf8');
async function loadTs(file) {
  const result=ts.transpileModule(src(file), {fileName:file,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  assert.doesNotMatch(result.outputText, /from ['"]\.\//);
  const uri='data:text/javascript;base64,'+Buffer.from(result.outputText).toString('base64');
  return import(uri);
}
const { BackgroundTaskRegistry } = await loadTs('apps/server/src/core/background-tasks.ts');
const { clusterToolSettingAuthority, CLUSTER_LINKED_STUDIO_TOOL_FIELDS, CLUSTER_TOOL_SETTING_KEYS } = await loadTs('packages/shared/src/tool-settings-contract.ts');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve,ms));
let passed=0;
async function test(name,fn){ await fn(); passed++; console.log('PASS',name); }

await test('linked Studio settings explicitly name owner and saved key', () => {
  assert.deepEqual(clusterToolSettingAuthority('scheduler','timezone'),{
    persistedKey:'studioTimezone', scope:'studio', description:'Studio timezone (Calendar and time reporting)' });
  assert.equal(clusterToolSettingAuthority('calendar','enabled').scope,'tool');
  assert.equal(clusterToolSettingAuthority('calendar','fake'),null);
  for (const [tool, fields] of Object.entries(CLUSTER_LINKED_STUDIO_TOOL_FIELDS))
    for (const name of Object.keys(fields)) {
      assert.ok(CLUSTER_TOOL_SETTING_KEYS[tool][name]);
      assert.equal(clusterToolSettingAuthority(tool,name).scope,'studio');
    }
});
await test('Tool Configuration warns about settings shared across the Studio',()=>{
  const ui=src('packages/renderer/src/features/admin/AdminToolControls.tsx');
  assert.match(ui,/linkedStudioSettings/);
  assert.match(ui,/Studio-wide change:/);
  assert.match(ui,/Linked Studio defaults:/);
});
await test('database changes notify owned runtime regardless of tool or Studio settings writer',()=>{
  const service=src('apps/server/src/app/server-services-settings-integrations.ts');
  const app=src('apps/server/src/app/cluster-server.ts');
  assert.match(service,/onStudioSettingsChanged\?\.\(result\.changedKeys, effectiveSettings\)/);
  assert.match(service,/onStudioSettingsChanged\?\.\(CONFIGURABLE_TOOL_SETTING_FLAGS, committed\)/);
  assert.match(app,/onStudioSettingsChanged: \(changedKeys:/);
  assert.match(app,/reconcileToolAvailability\(bootToolSettings/);
  const runtime=src('apps/server/src/app/server-job-runtime.ts');
  assert.match(runtime, /scheduleAdaptive\("studio-calendar-automation-enqueue"[\s\S]*?\{ owner: "calendar"/);
  assert.match(runtime, /if \(!input\.backgroundTasks\.isOwnerEnabled\("calendar"\)\) throw new BackgroundJobDeferredError/);
});
await test('suspending an adaptive owner clears its pending timer and prevents wakes', async()=>{
  const scheduler=new BackgroundTaskRegistry();
  let count=0;
  try {
    scheduler.setOwnerEnabled('calendar',false);
    scheduler.scheduleAdaptive('c',12,()=>{count++}, {owner:'calendar',runImmediately:true,jitterRatio:0,maxBackoffMs:12});
    assert.equal(scheduler.snapshots()[0].nextRunAt,null);
    await sleep(35);
    assert.equal(count,0);
    scheduler.setOwnerEnabled('calendar',true);
    await sleep(35);
    assert.ok(count>=1);
    scheduler.setOwnerEnabled('calendar',false);
    const observed=count;
    assert.equal(scheduler.snapshots()[0].nextRunAt,null);
    assert.equal(scheduler.snapshots()[0].suspended,true);
    await sleep(35);
    assert.equal(count,observed);
  } finally {scheduler.stopAll();}
});
await test('other owners and system tasks remain active while one owner is off',async()=>{
  const scheduler=new BackgroundTaskRegistry();
  let a=0,b=0,core=0;
  try {
    scheduler.scheduleInterval('calendar',9,()=>{a++},{owner:'calendar'});
    scheduler.scheduleInterval('library',9,()=>{b++},{owner:'library'});
    scheduler.scheduleInterval('core',9,()=>{core++});
    scheduler.setOwnerEnabled('calendar',false);
    await sleep(30);
    assert.equal(a,0);
    assert.ok(b>0 && core>0);
    scheduler.setOwnerEnabled('calendar',true);
    await sleep(30);
    assert.ok(a>0);
  } finally {scheduler.stopAll();}
});
await test('in-flight work is not claimed cancellable; stale continuations never rearm a disabled timer',async()=>{
  const scheduler=new BackgroundTaskRegistry();
  let started=0,finish;
  try {
    scheduler.scheduleAdaptive('inflight',30, async()=>{started++; await new Promise(r=>finish=r);}, {owner:'calendar',runImmediately:true,jitterRatio:0});
    await sleep(12);
    assert.equal(started,1);
    scheduler.setOwnerEnabled('calendar',false);
    finish(); await sleep(15);
    assert.equal(scheduler.snapshots()[0].nextRunAt,null);
    assert.equal(started,1);
    scheduler.setOwnerEnabled('calendar',true);
    await sleep(40);
    assert.ok(started>=2);
  } finally {scheduler.stopAll(); if(finish) finish();}
});
await test('a stopped generation cannot resurrect after the same task name is registered again', async()=>{
  const scheduler=new BackgroundTaskRegistry();
  let releaseOld, oldRuns=0, newRuns=0;
  try {
    scheduler.scheduleAdaptive('reused',8,async()=>{oldRuns++; await new Promise(resolve=>releaseOld=resolve);},{runImmediately:true,jitterRatio:0,maxBackoffMs:8});
    for(let i=0;i<20 && !releaseOld;i++) await sleep(5);
    assert.equal(oldRuns,1);
    scheduler.stop('reused');
    scheduler.scheduleAdaptive('reused',70,()=>{newRuns++},{jitterRatio:0,maxBackoffMs:70});
    releaseOld();
    await sleep(30);
    assert.equal(oldRuns,1);
    assert.equal(newRuns,0);
    assert.equal(scheduler.snapshots().length,1);
  } finally {scheduler.stopAll(); if(releaseOld) releaseOld();}
});
await test('stopAll is final and cannot resurrect timers through owner toggles', async()=>{
  const scheduler=new BackgroundTaskRegistry();
  let runs=0;
  scheduler.scheduleInterval('test',5,()=>{runs++},{owner:'calendar'});
  scheduler.stopAll();
  scheduler.setOwnerEnabled('calendar',false);
  scheduler.setOwnerEnabled('calendar',true);
  await sleep(20);
  assert.equal(runs,0);
});
console.log(`${passed}/${passed} TD1 Pass2 + TD2 ownership foundation tests passed`);
