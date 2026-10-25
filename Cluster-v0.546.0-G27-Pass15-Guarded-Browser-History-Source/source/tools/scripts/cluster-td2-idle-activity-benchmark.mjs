/** Isolated scheduler evidence, NOT live Cluster CPU/DB/network certification.
 * Real wall-clock timers prove disabled owners stop firing while shared work continues. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsFile = 'apps/server/src/core/background-tasks.ts';
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, tsFile), 'utf8'), {fileName:tsFile,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const mod={exports:{}};
new Function('require','module','exports',compiled.outputText)(require,mod,mod.exports);
const { BackgroundTaskRegistry } = mod.exports;
const counts={calendar:0,library:0,shared:0};
const registry=new BackgroundTaskRegistry();
const period=15;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const diff=(a,b)=>Object.fromEntries(Object.keys(counts).map(k=>[k,b[k]-a[k]]));
const snapshot=()=>({...counts});
try {
  registry.scheduleInterval('calendar-poll',period,()=>{counts.calendar++;},{owner:'calendar'});
  registry.scheduleInterval('library-poll',period,()=>{counts.library++;},{owner:'library'});
  registry.scheduleInterval('shared-health',period,()=>{counts.shared++;});
  const a=snapshot();await wait(240);const b=snapshot();
  registry.setOwnerEnabled('calendar',false);
  registry.setOwnerEnabled('library',false);
  const paused=registry.ownerSnapshots();
  assert.equal(paused.find(r=>r.owner==='calendar').armedTimers,0);
  assert.equal(paused.find(r=>r.owner==='library').armedTimers,0);
  await wait(240);const c=snapshot();
  registry.setOwnerEnabled('calendar',true);
  registry.setOwnerEnabled('library',true);
  await wait(240);const d=snapshot();
  const enabled=diff(a,b),disabled=diff(b,c),reenabled=diff(c,d);
  assert.ok(enabled.calendar>=6 && enabled.library>=6 && enabled.shared>=6,'baseline did not execute enough ticks');
  assert.equal(disabled.calendar,0,'calendar fired while disabled');
  assert.equal(disabled.library,0,'library fired while disabled');
  assert.ok(disabled.shared>=6,'unowned maintenance should continue');
  assert.ok(reenabled.calendar>=6 && reenabled.library>=6,'tool callbacks did not resume');
  console.log(JSON.stringify({kind:'isolated_scheduler_execution_evidence',periodMs:period,windowMs:240,
    enabled,disabled,reenabled,ownerSnapshots:registry.ownerSnapshots(),
    caveat:'Controlled process-level callback counts only; no production CPU/DB/network claim.'},null,2));
} finally { registry.stopAll(); }
