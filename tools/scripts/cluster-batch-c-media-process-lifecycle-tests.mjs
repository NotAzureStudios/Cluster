#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runMediaProcess } from '../../apps/server/src/core/media-process-runtime.ts';

let checks = 0;
async function check(name, work) { await work(); checks++; console.log(`PASS ${name}`); }
const cmd = process.execPath;
const script = (code) => ({ command: cmd, args: ['-e', code] });
const cancelled = (signal) => Object.assign(async () => Boolean(signal?.aborted), { signal });
await check('successful child must close before result is returned', async () => {
  const result = await runMediaProcess({...script('process.stdout.write("out_time_us=1000000\\n"); setTimeout(() => process.exit(0), 35)'), cancellationRequested: cancelled(), durationSeconds: 2 });
  assert.equal(typeof result.stderr, 'string');
});
await check('pre-aborted controller never launches subprocess', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runMediaProcess({...script('process.exit(0)'), cancellationRequested: cancelled(controller.signal)}), /cancelled before launch/);
});
await check('failed initial cancellation read blocks process launch', async () => {
  await assert.rejects(runMediaProcess({...script('process.exit(0)'), cancellationRequested: async () => { throw new Error('cancel database unavailable'); }}), /cancel database unavailable/);
});
await check('timeout waits for child close, not just kill signal', async () => {
  const begin = performance.now();
  await assert.rejects(runMediaProcess({...script('process.on("SIGTERM",()=>setTimeout(()=>process.exit(0),220)); setInterval(()=>{},1000)'), cancellationRequested: cancelled(), timeoutMs: 100}), /exceeded the media job timeout/);
  assert.ok(performance.now()-begin >= 240, 'GPU lease would be released before terminated child closed');
});
await check('cancellation signal terminates live process and rejects result', async () => {
  const controller = new AbortController();
  const task = runMediaProcess({...script('setInterval(()=>{},1000)'), cancellationRequested: cancelled(controller.signal)});
  setTimeout(() => controller.abort(new Error('cancelled')), 150);
  await assert.rejects(task, /cancelled/);
});
await check('missing progress line bounds memory and fails output', async () => {
  await assert.rejects(runMediaProcess({...script('process.stdout.write("X".repeat(100000)); setInterval(()=>{},1000)'), cancellationRequested: cancelled()}), /MEDIA_PROCESS_PROGRESS_OVERFLOW/);
});
await check('late failure to read cancellation status cannot publish output', async () => {
  let reads = 0;
  await assert.rejects(runMediaProcess({...script('process.exit(0)'), cancellationRequested: async () => { if (++reads > 1) throw new Error('lost cancellation database'); return false; }}), /lost cancellation database/);
});
await check('progress failures are observed and do not trigger unhandled rejection', async () => {
  await assert.rejects(runMediaProcess({
    ...script('process.stdout.write("out_time_us=1000000\\n"); setTimeout(()=>process.exit(0),70)'),
    cancellationRequested: cancelled(), durationSeconds: 3,
    onProgress: async () => { throw new Error('progress store unavailable'); },
  }), /progress store unavailable/);
});
console.log(`Batch C media process lifecycle: ${checks}/${checks} passed`);
