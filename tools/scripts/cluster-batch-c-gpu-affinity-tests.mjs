#!/usr/bin/env node
import assert from 'node:assert/strict';
import { nvidiaDeviceBudgets, computeGpuMediaBudget } from '../../apps/server/src/core/gpu-telemetry.ts';
import { renderVideoThumbnail, videoThumbnailCommand } from '../../apps/server/src/core/media-gpu-thumbnail.ts';
import { runMediaProcess } from '../../apps/server/src/core/media-process-runtime.ts';
import { readFileSync } from 'node:fs';
const uuids = [
 'GPU-11111111-2222-3333-4444-555555555555',
 'GPU-66666666-7777-8888-9999-aaaaaaaaaaaa',
];
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS '+name); }
function device(id, memoryTotalMiB, memoryUsedMiB, temperatureC=45, utilizationPercent=10) {
 return {id, name:'NVIDIA card', vendor:'nvidia', memoryTotalMiB, memoryUsedMiB, temperatureC, utilizationPercent};
}
function snapshot(devices, status='available') { return {status,provider:'nvidia-smi',sampledAt:new Date().toISOString(),devices,metricsSupported:true}; }
const a = device(uuids[0],8192,1300); const b = device(uuids[1],24576,500);
await check('new candidate scheduler includes two verified cards with independent budgets',()=>{
 const candidates = nvidiaDeviceBudgets(snapshot([a,b]),{maxJobs:4});
 assert.equal(candidates.length,2);
 assert.deepEqual(new Set(candidates.map(c=>c.deviceId)),new Set(uuids));
 assert.ok(candidates.every(c=>c.limit>0));
});
await check('hot card does not borrow another card GPU quota',()=>{
 const candidates=nvidiaDeviceBudgets(snapshot([{...a,temperatureC:105},b]));
 assert.deepEqual(candidates.map(c=>c.deviceId),[uuids[1]]);
});
await check('unverified, ordinal, malformed, non-NVIDIA and stale cards cannot use routed CUDA',()=>{
 for(const status of ['stale','unavailable','partial']) assert.equal(nvidiaDeviceBudgets(snapshot([a,b],status)).length,0);
 assert.deepEqual(nvidiaDeviceBudgets(snapshot([{...a,id:'GPU-1234'}, {...b,vendor:'amd'}])),[]);
});
await check('historical single-default admission remains unchanged while opt-in disabled',()=>{
 assert.equal(computeGpuMediaBudget(snapshot([a,b]),'nvenc').deviceId,uuids[0]);
});
await check('CUDA thumbnails bind device zero after CUDA UUID process isolation',()=>{
 const args=videoThumbnailCommand('clip.mp4','frame.jpg',15,'cuda',true);
 assert.deepEqual(args.slice(0,7),['-y','-hwaccel','cuda','-hwaccel_device','0','-hwaccel_output_format','cuda']);
 assert.ok(!videoThumbnailCommand('clip.mp4','frame.jpg',15,'software',true).includes('-hwaccel_device'));
});
await check('CUDA_VISIBLE_DEVICES is private to the specific child process',async()=>{
 const before=process.env.CUDA_VISIBLE_DEVICES;
 let value='';
 const first=await runMediaProcess({command:process.execPath,args:['-e','process.stderr.write(process.env.CUDA_VISIBLE_DEVICES||"missing")'],cancellationRequested:async()=>false,nvidiaGpuUuid:uuids[1]});
 value=first.stderr;
 assert.equal(value,uuids[1]);
 assert.equal(process.env.CUDA_VISIBLE_DEVICES,before);
});
await check('malformed GPU IDs are rejected before launch, not interpreted as env commands',async()=>{
 await assert.rejects(runMediaProcess({command:process.execPath,args:['-e','process.exit(0)'],cancellationRequested:async()=>false,nvidiaGpuUuid:'GPU-1234; MALICIOUS=1'}),/MEDIA_GPU_DEVICE_INVALID/);
});
await check('failed GPU thumbnail defers CPU fallback until the lease is dropped',async()=>{
 const calls=[];
 const result=await renderVideoThumbnail({sourcePath:'clip.mp4',outputPath:'frame.jpg',seekSeconds:5,mode:'cuda',deferSoftwareFallback:true,
 cancelled:async()=>false,removePartial:async()=>calls.push('clean'),onFallback:()=>calls.push('fallback'),
 run:async(args)=>{calls.push(args.includes('cuda')?'gpu':'cpu');throw new Error('driver rejected CUDA');}});
 assert.equal(result,null);
 assert.deepEqual(calls,['gpu','clean','fallback']);
});
await check('NVENC and thumbnail CPU retries are outside GPU lease and gate',()=>{
 const worker=readFileSync('apps/server/src/workers/media-worker.ts','utf8');
 const processing=readFileSync('apps/server/src/core/media-processing.ts','utf8');
 assert.match(worker,/deferSoftwareFallback: Boolean\(leaseSignal\)/);
 assert.match(processing,/if \(input\.deferSoftwareFallback\) \{[\s\S]*?await fs\.rm\(outputPath,[\s\S]*?return null;/);
 assert.match(processing,/if \(!result\) return null/);
 assert.match(worker,/return accelerated \?\? execute\("software"\)/);
});
await check('GPU admission and FFmpeg path are both wired to selected UUID',()=>{
 const worker=readFileSync('apps/server/src/workers/media-worker.ts','utf8');
 const executor=readFileSync('apps/server/src/core/media-processing.ts','utf8');
 assert.match(worker,/CLUSTER_MEDIA_NVIDIA_MULTI_GPU === "on"/);
 assert.match(worker,/for \(const candidate of nvidiaDeviceBudgets\(current/);
 assert.match(worker,/candidate\.deviceId\)\)/);
 assert.match(executor,/"-gpu", "0"/);
 assert.match(executor,/nvidiaGpuUuid: requestedAcceleration === "nvenc"/);
 assert.match(executor,/nvidiaGpuUuid: args\.includes\("cuda"\)/);
});
console.log(`Batch C NVIDIA affinity: ${passed}/${passed} passed`);
