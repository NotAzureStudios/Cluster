#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runManagedSubprocess } from '../../apps/server/src/core/managed-subprocess.ts';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cluster-managed-process-'));
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`PASS ${name}`); };
const script = async (name, body) => {
  const filename = path.join(dir, `${name}.js`);
  await fs.writeFile(filename, '#!/usr/bin/env node\n' + body, {mode:0o700});
  await fs.chmod(filename, 0o700);
  return filename;
};
const opts = (command, more = {}) => ({command, args: [], timeoutMs:2000, maxOutputBytes:4096, ...more});
try {
  await check('successful stdout and stderr settle after close', async () => {
    const app=await script('success', `process.stdout.write('done'); process.stderr.write('warning'); setTimeout(()=>process.exit(0), 40);`);
    const result=await runManagedSubprocess(opts(app));
    assert.equal(result.stdout,'done'); assert.equal(result.stderr,'warning');
  });
  await check('nonzero exit propagates bounded stderr', async () => {
    const app=await script('failed', `process.stdout.write('partial'); process.stderr.write('source failed'); process.exit(7);`);
    await assert.rejects(runManagedSubprocess(opts(app)), /source failed/);
  });
  await check('abort waits for process close after SIGTERM handler', async () => {
    const app=await script('abort', `process.on('SIGTERM', ()=>setTimeout(()=>process.exit(0), 220)); setInterval(()=>{},1000);`);
    const controller=new AbortController();
    const begin=performance.now();
    const task=runManagedSubprocess(opts(app,{signal:controller.signal}));
    setTimeout(()=>controller.abort(new Error('operator cancelled')),200);
    await assert.rejects(task, /operator cancelled/);
    assert.ok(performance.now()-begin>=380,'managed lease settled before cancelled child closed');
  });
  await check('pre-aborted signal prevents launching a child', async () => {
    const controller=new AbortController(); controller.abort(new Error('already cancelled'));
    await assert.rejects(runManagedSubprocess(opts('/nonexistent/binary',{signal:controller.signal})),/already cancelled/);
  });
  await check('timeout rejects only after kill and close', async () => {
    const pidFile=path.join(dir,'pid');
    const app=await script('timed', `const fs=require('fs'); fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000);`);
    await assert.rejects(runManagedSubprocess(opts(app,{timeoutMs:250})), /exceeded the 250 ms subprocess timeout/);
    const pid=Number(await fs.readFile(pidFile,'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  });
  await check('capture limit includes both stdout and stderr', async () => {
    const app=await script('capture', `process.stdout.write('a'.repeat(100)); process.stderr.write('b'.repeat(100)); setInterval(()=>{},1000);`);
    await assert.rejects(runManagedSubprocess(opts(app,{maxOutputBytes:150})),/more than 150 bytes/);
  });
  await check('ignored stdout does not accumulate output bytes', async () => {
    const app=await script('ignored', `process.stdout.write('x'.repeat(5000)); process.stderr.write('ok');`);
    const result=await runManagedSubprocess(opts(app,{captureStdout:false,maxOutputBytes:10}));
    assert.equal(result.stdout,''); assert.equal(result.stderr,'ok');
  });
  await check('spawn error rejected after handles close', async () => {
    await assert.rejects(runManagedSubprocess(opts(path.join(dir,'missing-binary'))),/ENOENT/);
  });
  await check('invalid caps fail closed before command launch', async () => {
    await assert.rejects(runManagedSubprocess(opts('/missing/binary',{maxOutputBytes:0})),/MANAGED_PROCESS_CAPTURE_INVALID/);
    await assert.rejects(runManagedSubprocess(opts('/missing/binary',{timeoutMs:0})),/MANAGED_PROCESS_TIMEOUT_INVALID/);
  });
  await check('backup, restore and Library derivative use the same custody runner', async () => {
    for (const file of ['apps/server/src/core/database-backup.ts','apps/server/src/core/database-recovery.ts','apps/server/src/domains/library/library-9e2-jobs.ts']) {
      const source=await fs.readFile(path.resolve(import.meta.dirname,'../..',file),'utf8');
      assert.match(source,/runManagedSubprocess\(/,file);
      assert.doesNotMatch(source,/\bspawn\(/,file);
    }
  });
  console.log(`Batch D managed subprocess: ${count}/${count} passed`);
} finally { await fs.rm(dir,{recursive:true,force:true}); }
