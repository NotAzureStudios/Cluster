import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); }
})();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const file = 'apps/server/src/workers/media-worker-control.ts';
const { outputText } = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }});
const module = { exports: {} };
new Function('require','module','exports',outputText)(require,module,module.exports);
const { MediaWorkerControl, MediaWorkerPeriodicTasks, mediaWorkerDirective } = module.exports;
let total = 0;
async function check(name, fn) { await fn(); ++total; console.log('PASS', name); }
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
const client = (findUnique) => ({ mediaWorkerHeartbeat: { findUnique } });
await check('valid authoritative states are read exactly from database', async () => {
  for (const state of ['active','drain','maintenance']) {
    let seen;
    assert.equal(await mediaWorkerDirective(client(async (args)=> { seen=args; return {desiredState:state};}), 'worker-1'),state);
    assert.deepEqual(seen, {where:{id:'worker-1'},select:{desiredState:true}});
  }
});
await check('database read errors are not swallowed or treated as active', async () => {
  await assert.rejects(mediaWorkerDirective(client(async ()=> { throw Error('database offline'); }), 'w'), /database offline/);
});
await check('missing control row does not authorize new work', async () => {
  await assert.rejects(mediaWorkerDirective(client(async ()=> null),'w'), /unavailable/);
});
await check('malformed control rows cannot fall back to active', async () => {
  for(const desiredState of [undefined,null,'resume','ACTIVE',false]) {
    await assert.rejects(mediaWorkerDirective(client(async ()=> ({desiredState})),'w'), /invalid/);
  }
});
await check('actual directive-read failure places existing control into maintenance', async () => {
  let failed=false;
  const db = client(async()=> { if(failed) throw Error('unreachable'); return {desiredState:'active'}; });
  const control = new MediaWorkerControl(()=>mediaWorkerDirective(db,'w'));
  await control.refresh(); assert.equal(control.current(),'active');
  failed=true; await assert.rejects(control.refresh(),/unreachable/);
  assert.equal(control.current(),'maintenance');
});
await check('duplicate callbacks of same maintenance kind do not overlap', async () => {
  const tasks = new MediaWorkerPeriodicTasks();
  const block = deferred(); let count=0;
  const first = tasks.run('heartbeat',async()=> { count++; await block.promise; });
  const second = tasks.run('heartbeat',async()=> { count++; });
  assert.equal(first,second);
  await Promise.resolve(); assert.equal(count,1);
  block.resolve(); await Promise.all([first,second]);
  await tasks.run('heartbeat',async()=> { count++; });
  assert.equal(count,2);
});
await check('distinct periodic task kinds can execute while another is pending',async()=> {
  const tasks=new MediaWorkerPeriodicTasks(); const block=deferred();
  const one=tasks.run('heartbeat',async()=>block.promise);
  let ran=false;
  await tasks.run('directive',async()=>{ran=true;}); assert.equal(ran,true);
  block.resolve(); await one;
});
await check('shutdown waits for running periodic I/O and forbids new callbacks',async()=> {
  const tasks=new MediaWorkerPeriodicTasks(); const block=deferred();
  let done=false, afterStop=false;
  const inflight=tasks.run('retention',async()=> {await block.promise; done=true;});
  let drained=false;
  const shutdown=tasks.stopAndDrain().then(()=>{drained=true;});
  await Promise.resolve(); assert.equal(drained,false);
  await tasks.run('retention',async()=>{afterStop=true;}); assert.equal(afterStop,false);
  block.resolve(); await Promise.all([inflight,shutdown]);
  assert.equal(drained,true); assert.equal(done,true);
});
await check('failed in-flight I/O is drained and shutdown does not reject',async()=> {
  const tasks=new MediaWorkerPeriodicTasks(); const block=deferred();
  const failed=tasks.run('directive',async()=>block.promise);
  const shutdown=tasks.stopAndDrain();
  block.reject(Error('lost database'));
  await assert.rejects(failed,/lost database/);
  await shutdown;
});
await check('status writes cannot overtake the final draining/stopped status',async()=> {
  const tasks=new MediaWorkerPeriodicTasks(); const gate=deferred(); const states=[];
  const periodic=tasks.run('heartbeat',async()=>{await gate.promise;states.push('ready');});
  const shutdown=(async()=>{ await tasks.stopAndDrain(); states.push('draining');states.push('stopped');})();
  await Promise.resolve();assert.deepEqual(states,[]);
  gate.resolve();await Promise.all([periodic,shutdown]);
  assert.deepEqual(states,['ready','draining','stopped']);
});
await check('worker wires tracked heartbeats, directives and retention before shutdown',()=> {
  const s=read('apps/server/src/workers/media-worker.ts');
  assert.match(s,/const periodic = new MediaWorkerPeriodicTasks\(\)/);
  for(const key of ['heartbeat','directive','retention']) assert.ok(s.includes(`periodic.run("${key}"`),key);
  const block=s.slice(s.indexOf('async function shutdown('),s.indexOf('function handleShutdown('));
  assert.ok(block.indexOf('worker.stop()')>=0 && block.indexOf('worker.stop()')<block.indexOf('await '));
  assert.ok(block.indexOf('await periodic.stopAndDrain()') < block.indexOf('await heartbeat("draining")'));
  assert.ok(block.indexOf('await heartbeat("stopped")')<block.indexOf('await prisma.$disconnect()'));
});
await check('old directive lookup no longer masks database errors in media processing',()=>{
  const s=read('apps/server/src/core/media-processing.ts');
  assert.doesNotMatch(s,/export async function mediaWorkerDirective\(/);
  assert.match(read('apps/server/src/workers/media-worker.ts'), /MediaWorkerPeriodicTasks, mediaWorkerDirective/);
});
console.log(`${total}/${total} media control/periodic shutdown regression checks passed`);
