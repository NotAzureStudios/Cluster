#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { extractWaveformData } from '../../apps/server/src/core/media-waveform-runtime.ts';
import { captureMediaCommand } from '../../apps/server/src/core/media-probe-runtime.ts';
import { runMediaProcess } from '../../apps/server/src/core/media-process-runtime.ts';
import { runGpuCommand } from '../../apps/server/src/core/gpu-telemetry.ts';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cluster-batch-d-'));
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log(`PASS ${name}`); };
const script = async (name, body) => {
  const filename = path.join(dir, `${name}.js`);
  await fs.writeFile(filename, '#!/usr/bin/env node\n' + body, { mode: 0o700 });
  await fs.chmod(filename, 0o700);
  return filename;
};
const cancel = (signal) => Object.assign(async () => Boolean(signal?.aborted), { signal });
const wave = (ffmpegPath, more = {}) => extractWaveformData({ffmpegPath, sourcePath: '/tmp/fake.wav', durationSeconds: 1, maxWaveformBins: 256, cancellationRequested: cancel(), ...more });
const pcm = (samples) => `process.stdout.write(Buffer.from(${JSON.stringify([...samples])}));`;
try {
  await check('closed zero-code PCM extraction has bounded real waveform samples', async () => {
    const data = Buffer.alloc(64 * 2);
    for (let i=0; i<64; i++) data.writeInt16LE(i % 2 ? -16384 : 8192, i * 2);
    const app = await script('pcm', pcm(data));
    const result = await wave(app);
    assert.equal(result.channels.length, 1);
    assert.ok(result.channels[0].samples.length > 0);
    assert.equal(result.channels[0].peak, 0.5);
    assert.ok(result.channels[0].rms > 0);
  });
  await check('nonzero exit rejects even after valid PCM peak data', async () => {
    const app = await script('partial', `${pcm(Buffer.alloc(128))}\nprocess.stderr.write('broken decoder'); process.exit(7);`);
    await assert.rejects(wave(app), /broken decoder/);
  });
  await check('empty successful decoder output is not published as a waveform', async () => {
    const app = await script('empty', `process.exit(0);`);
    await assert.rejects(wave(app), /MEDIA_WAVEFORM_EMPTY/);
  });
  await check('odd trailing PCM byte cannot be silently accepted', async () => {
    const app = await script('odd', pcm(Buffer.from([0,0,5])));
    await assert.rejects(wave(app), /MEDIA_WAVEFORM_PCM_INVALID/);
  });
  await check('failed terminal cancellation read blocks waveform publication', async () => {
    const app = await script('cancel-read', pcm(Buffer.alloc(128)));
    let n=0;
    await assert.rejects(wave(app, {cancellationRequested: async () => { if (++n > 1) throw new Error('database unavailable'); return false; }}), /database unavailable/);
  });
  await check('pre-aborted signal avoids launching decoder', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(wave('/path/never/run', { cancellationRequested: cancel(controller.signal) }), /cancelled before launch/);
  });
  await check('mid-stream signal cancels without treating output as complete', async () => {
    const app = await script('cancel-mid', `setInterval(() => process.stdout.write(Buffer.alloc(128)), 15);`);
    const controller = new AbortController();
    const task = wave(app, { cancellationRequested: cancel(controller.signal) });
    setTimeout(() => controller.abort(), 120);
    await assert.rejects(task, /MEDIA_JOB_CANCELLED/);
  });
  await check('timeout waits for decoder exit after SIGTERM', async () => {
    const app = await script('timeout', `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 220)); setInterval(() => {}, 1000);`);
    const start=performance.now();
    await assert.rejects(wave(app, {timeoutMs: 200}), /MEDIA_WAVEFORM_TIMEOUT/);
    assert.ok(performance.now()-start >= 370, 'waveform lease settled before decoder close');
  });
  await check('decoded audio beyond max bin budget is rejected instead of truncated', async () => {
    const app = await script('overflow', pcm(Buffer.alloc(30000)));
    await assert.rejects(wave(app, { maxWaveformBins: 2 }), /MEDIA_WAVEFORM_BIN_LIMIT/);
  });
  await check('missing decoder binary closes with error', async () => {
    await assert.rejects(wave(path.join(dir,'nonexistent')), /ENOENT/);
  });
  await check('probe output capture returns normal output', async () => {
    const app = await script('probe-ok', `process.stdout.write('ffmpeg available\\n');`);
    assert.equal(await captureMediaCommand(app, []), 'ffmpeg available');
  });
  await check('probe nonzero error uses stderr', async () => {
    const app = await script('probe-failed', `process.stderr.write('probe failed'); process.exit(3);`);
    await assert.rejects(captureMediaCommand(app, []), /probe failed/);
  });
  await check('probe output overflow fails closed and stops child', async () => {
    const app = await script('probe-overflow', `process.stdout.write('x'.repeat(100000)); setInterval(()=>{},1000);`);
    await assert.rejects(captureMediaCommand(app, [], 3000, 1024), /MEDIA_PROBE_CAPTURE_OVERFLOW/);
  });
  await check('probe timeout does not report completion before kill closes', async () => {
    const app = await script('probe-slow', `setInterval(()=>{},1000);`);
    await assert.rejects(captureMediaCommand(app, [], 180), /timed out/);
  });
  await check('probe missing executable rejects once stream handles close', async () => {
    await assert.rejects(captureMediaCommand(path.join(dir,'nonexistent'), []), /ENOENT/);
  });
  await check('media runner propagates spawn failure without publishing', async () => {
    await assert.rejects(runMediaProcess({command: path.join(dir,'nonexistent'), args: [], cancellationRequested: cancel()}), /ENOENT/);
  });
  await check('GPU telemetry probe returns closed child output', async () => {
    const app = await script('gpu-ok', `process.stdout.write('gpu metrics\\n');`);
    assert.equal((await runGpuCommand(app, [], 3000)).trim(), 'gpu metrics');
  });
  await check('GPU telemetry timeout does not leave its child process alive', async () => {
    const pidFile = path.join(dir, 'gpu-probe-pid');
    const app = await script('gpu-hang', `const fs=require('fs'); fs.writeFileSync(${JSON.stringify('${PIDFILE}')},String(process.pid)); setInterval(()=>{},1000);`.replace('${PIDFILE}', pidFile));
    await assert.rejects(runGpuCommand(app, [], 250), /GPU probe timeout/);
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
  await check('GPU telemetry overflow kills noisy child before reporting error', async () => {
    const app = await script('gpu-overflow', `process.stdout.write('x'.repeat(80000)); setInterval(()=>{},1000);`);
    await assert.rejects(runGpuCommand(app, [], 3000), /GPU probe output exceeded limit/);
  });
  await check('probe invalid bounds reject before spawn', async () => {
    await assert.rejects(captureMediaCommand('/path/never/run', [], 10, 0), /MEDIA_PROBE_CAPTURE_LIMIT_INVALID/);
    await assert.rejects(captureMediaCommand('/path/never/run', [], 0, 100), /MEDIA_PROBE_TIMEOUT_INVALID/);
  });
  console.log(`Batch D media custody: ${count}/${count} passed`);
} finally {
  await fs.rm(dir, {recursive:true, force:true});
}
