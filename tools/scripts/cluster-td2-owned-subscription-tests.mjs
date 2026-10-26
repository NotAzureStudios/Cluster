import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => {try {return require('typescript');} catch {return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
const compiled = ts.transpileModule(read('apps/server/src/core/background-tasks.ts'), {fileName:'background-tasks.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const module = {exports:{}};
new Function('require','module','exports',compiled.outputText)(require,module,module.exports);
const {BackgroundTaskRegistry} = module.exports;
let passed = 0;
async function test(name, fn) {await fn(); passed++; console.log('PASS',name);}
function emitter() {
  const listeners = new Set();
  let subscribeCalls=0, disposeCalls=0;
  return {
    subscribe(callback) { subscribeCalls++;listeners.add(callback);return ()=>{disposeCalls++;listeners.delete(callback);} },
    publish() { for (const listener of listeners) listener(); },
    get count() {return listeners.size;},
    get subscribeCalls() {return subscribeCalls;},
    get disposeCalls() {return disposeCalls;},
  };
}
await test('Tool-owned listener subscribes, disconnects, and reconnects once',()=>{
  const runtime=new BackgroundTaskRegistry();const bus=emitter();let changes=0,clears=0;
  try {
    runtime.registerOwnedSubscription('library-context-invalidation','library',()=>bus.subscribe(()=>changes++),{onSuspend:()=>clears++,onResume:()=>clears++});
    bus.publish();assert.equal(changes,1);
    runtime.setOwnerEnabled('library',false);assert.equal(bus.count,0);assert.equal(clears,1);
    bus.publish();assert.equal(changes,1);
    runtime.setOwnerEnabled('library',false);assert.equal(bus.disposeCalls,1);
    runtime.setOwnerEnabled('library',true);assert.equal(bus.count,1);assert.equal(clears,2);
    runtime.setOwnerEnabled('library',true);assert.equal(bus.subscribeCalls,2);
    bus.publish();assert.equal(changes,2);
    assert.deepEqual(runtime.subscriptionSnapshots(),[{name:'library-context-invalidation',owner:'library',active:true,suspended:false,lastError:null}]);
  } finally {runtime.stopAll();assert.equal(bus.count,0);}
});
await test('Registration while owner already disabled does not connect and can later rearm',()=>{
  const runtime=new BackgroundTaskRegistry();const bus=emitter();let clears=0;
  try {
    runtime.setOwnerEnabled('library',false);
    runtime.registerOwnedSubscription('cache','library',()=>bus.subscribe(()=>{}),{onSuspend:()=>clears++,onResume:()=>clears++});
    assert.equal(bus.subscribeCalls,0);assert.equal(clears,1);
    runtime.setOwnerEnabled('library',true);assert.equal(bus.subscribeCalls,1);assert.equal(clears,2);
  } finally {runtime.stopAll();}
});
await test('Other owners and unowned maintenance timers remain unaffected',async()=>{
  const runtime=new BackgroundTaskRegistry();const library=emitter();const calendar=emitter();let runs=0;
  try {
    runtime.registerOwnedSubscription('library-cache','library',()=>library.subscribe(()=>{}));
    runtime.registerOwnedSubscription('calendar-feed','calendar',()=>calendar.subscribe(()=>{}));
    runtime.scheduleInterval('core-maintenance',5,()=>{runs++;});
    runtime.setOwnerEnabled('library',false);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(library.count,0);assert.equal(calendar.count,1);assert.ok(runs>0);
  } finally {runtime.stopAll();}
});
await test('Disposer identity is protected after unregister/re-register',()=>{
  const runtime=new BackgroundTaskRegistry();const a=emitter();const b=emitter();
  try {
    const removeOld=runtime.registerOwnedSubscription('cache','library',()=>a.subscribe(()=>{}));
    removeOld();
    runtime.registerOwnedSubscription('cache','library',()=>b.subscribe(()=>{}));
    removeOld();assert.equal(b.count,1);
    assert.equal(a.count,0);
  } finally {runtime.stopAll();}
});
await test('Duplicate resource names, invalid disposers and post-shutdown registration are rejected',()=>{
  const runtime=new BackgroundTaskRegistry();const bus=emitter();
  runtime.registerOwnedSubscription('cache','library',()=>bus.subscribe(()=>{}));
  assert.throws(()=>runtime.registerOwnedSubscription('cache','calendar',()=>()=>{}),/already registered/);
  assert.throws(()=>runtime.scheduleInterval('cache',100,()=>{}),/already registered/);
  assert.throws(()=>runtime.registerOwnedSubscription('broken','library',()=>null),/must return a disposer/);
  assert.equal(runtime.subscriptionSnapshots().length,1);
  runtime.stopAll();assert.equal(bus.count,0);
  assert.equal(runtime.subscriptionSnapshots().length,0);
  assert.throws(()=>runtime.registerOwnedSubscription('later','library',()=>()=>{}),/already stopped/);
});
await test('Failed restart records diagnostics and retries on later disable/enable transition',()=>{
  const logged=[];const runtime=new BackgroundTaskRegistry({warn:(e,m)=>logged.push(m)});let fail=true;const bus=emitter();
  try {
    runtime.setOwnerEnabled('library',false);
    runtime.registerOwnedSubscription('failing','library',()=>{if(fail)throw Error('temporary outage');return bus.subscribe(()=>{});});
    runtime.setOwnerEnabled('library',true);
    assert.equal(runtime.subscriptionSnapshots()[0].active,false);
    assert.match(runtime.subscriptionSnapshots()[0].lastError,/temporary outage/);
    assert.equal(logged.length,1);
    fail=false;runtime.setOwnerEnabled('library',true); // next Settings reconciliation retries only failed listeners
    assert.equal(bus.count,1);
    runtime.setOwnerEnabled('library',true);
    assert.equal(bus.subscribeCalls,1);
    assert.equal(runtime.subscriptionSnapshots()[0].lastError,null);
  } finally {runtime.stopAll();}
});
await test('Library route uses owner-managed subscriber and resets cache on both lifecycle edges',()=>{
  const lib=read('apps/server/src/domains/library/library-routes.ts');
  const server=read('apps/server/src/app/cluster-server.ts');
  assert.match(lib,/ownedSubscriptions\.registerOwnedSubscription\([\s\S]*?"library-context-invalidation", "library"/);
  assert.match(lib,/onSuspend: \(\) => clearLibraryContextCache\(false\), onResume: \(\) => clearLibraryContextCache\(false\)/);
  assert.match(server,/ownedSubscriptions: backgroundTasks/);
  const admin = read('apps/server/src/app/server-routes-health-operations.ts');
  assert.match(admin,/ownedSubscriptions: backgroundTasks\.subscriptionSnapshots\(\)/);
});
console.log(`${passed}/${passed} TD2 owned subscription checks passed`);
