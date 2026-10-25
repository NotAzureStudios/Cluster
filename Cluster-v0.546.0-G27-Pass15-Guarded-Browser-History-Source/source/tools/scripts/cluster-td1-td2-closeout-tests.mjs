import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js')); } })();
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function read(name) { return fs.readFileSync(path.join(source,name), 'utf8'); }
function transpile(file) {
  const compiled = ts.transpileModule(read(file), {fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const module={exports:{}};
  new Function('require','module','exports',compiled.outputText)(require,module,module.exports);
  return module.exports;
}
const { BackgroundTaskRegistry } = transpile('apps/server/src/core/background-tasks.ts');
const { clusterToolStudioChangeImpact } = transpile('packages/shared/src/tool-settings-contract.ts');
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
await test('Studio-impact resolution tracks persisted identities, excludes private fields and does not duplicate keys',()=>{
  assert.deepEqual(clusterToolStudioChangeImpact('scheduler',['studioTimezone', 'schedulerEnabled']).map(x=>x.field),['timezone']);
  assert.deepEqual(clusterToolStudioChangeImpact('library',['libraryEnabled','studioLibraryRootName']).map(x=>x.field),['rootName']);
  assert.equal(clusterToolStudioChangeImpact('calendar',['calendarEnabled']).length,0);
  assert.equal(clusterToolStudioChangeImpact('timeline',['studioDefaultMilestoneCadence','studioDefaultMilestoneCadence']).length,1);
});
await test('Tool Config API requires explicit acknowledgement for changed Studio-owned keys',()=>{
  const routes=read('apps/server/src/domains/admin/admin-tool-routes.ts');
  const ui=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
  assert.match(routes,/clusterToolStudioChangeImpact\(tool, Object\.keys\(expected\)\)/);
  assert.match(routes,/affectedStudioFields\.length && requestBody\.acknowledgeStudioChanges !== true/);
  assert.match(routes,/code: "TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED"/);
  assert.ok(routes.indexOf('TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED') < routes.indexOf('await patchSettings(patch, expected)'));
  assert.match(ui,/studioChangesAcknowledged/);
  assert.match(ui,/affected|Studio-wide change/);
  assert.match(ui,/acknowledgeStudioChanges: studioChanges\.length > 0/);
});
await test('suspending a running owner sends its callback an abort signal',async()=>{
  const registry=new BackgroundTaskRegistry(); let release,started,resolveStarted;
  const begun=new Promise(resolve=>resolveStarted=resolve);
  try {
    registry.scheduleAdaptive('scan',100,async signal=>{
      started=signal;
      resolveStarted();
      await new Promise(resolve=>release=resolve);
      return {activity:'idle'};
    },{owner:'calendar',runImmediately:true,jitterRatio:0});
    assert.equal(await Promise.race([begun.then(()=>true),wait(250).then(()=>false)]),true);
    assert.equal(started.aborted,false);
    registry.setOwnerEnabled('calendar',false);
    assert.equal(started.aborted,true);
    assert.equal(registry.snapshots()[0].cancellationRequested,true);
    release();await wait(10);
    assert.equal(registry.snapshots()[0].nextRunAt,null);
  } finally {registry.stopAll();release?.();}
});
await test('adaptive callbacks aborted midflight do not wake while disabled; resume schedules exactly one timer',async()=>{
  const registry=new BackgroundTaskRegistry();let release,started;
  const begun=new Promise(resolve=>started=resolve);let calls=0;
  try {
    registry.scheduleAdaptive('scan',35,async signal=>{calls++;if(calls===1){started();await new Promise(r=>release=r);}return {activity:'idle'};},{owner:'calendar',runImmediately:true,jitterRatio:0,maxBackoffMs:35});
    assert.equal(await Promise.race([begun.then(()=>true),wait(250).then(()=>false)]),true);
    registry.setOwnerEnabled('calendar',false);
    registry.setOwnerEnabled('calendar',true);
    // The original task is still running: do not arm a second timer yet.
    assert.equal(registry.snapshots()[0].nextRunAt,null);
    release();await wait(10);
    assert.ok(registry.snapshots()[0].nextRunAt);
    await wait(75);
    assert.ok(calls>=2 && calls<=4,`unexpected callback schedule ${calls}`);
  } finally {registry.stopAll();release?.();}
});
await test('interval owner reenable while one callback is running restores normal interval',async()=>{
  const registry=new BackgroundTaskRegistry();let release,started;const begun=new Promise(resolve=>started=resolve);let calls=0;
  try {
    registry.scheduleInterval('interval',10,async signal=>{calls++;if(calls===1){started();await new Promise(resolve=>release=resolve);}}, {owner:'calendar'});
    assert.equal(await Promise.race([begun.then(()=>true),wait(250).then(()=>false)]),true);
    registry.setOwnerEnabled('calendar',false);
    registry.setOwnerEnabled('calendar',true);
    release();await wait(40);
    assert.ok(calls>=2,`interval stalled after resuming: ${calls}`);
  } finally {registry.stopAll();release?.();}
});
await test('stopAll aborts an executing callback without rescheduling it',async()=>{
  const registry=new BackgroundTaskRegistry();let release,started;const begun=new Promise(resolve=>started=resolve);let signal;
  registry.scheduleAdaptive('scan',100,async s=>{signal=s;started();await new Promise(resolve=>release=resolve);},{owner:'calendar',runImmediately:true});
  assert.equal(await Promise.race([begun.then(()=>true),wait(250).then(()=>false)]),true);
  registry.stopAll();assert.equal(signal.aborted,true);
  release();await wait(10);
  assert.equal(registry.snapshots().length,0);
});
await test('Calendar enqueue callback observes signal and availability before queueing',()=>{
  const code=read('apps/server/src/app/server-job-runtime.ts');
  assert.match(code,/studio-calendar-automation-enqueue"[\s\S]*?async \(signal\) => \{[\s\S]*?signal\.aborted \|\| !input\.backgroundTasks\.isOwnerEnabled\("calendar"\)/);
});
console.log(`${count}/${count} TD1/TD2 closeout checks passed`);
