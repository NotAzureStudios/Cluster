import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderVideoThumbnail, videoThumbnailCommand, supportsCudaThumbnail } from '../../apps/server/src/core/media-gpu-thumbnail.ts';
import { hasCudaDevice, computeGpuMediaBudget } from '../../apps/server/src/core/gpu-telemetry.ts';
let count = 0;
const check = (value) => { assert.ok(value); count++; };
check(supportsCudaThumbnail('Hardware acceleration methods: cuda\n', '... scale_cuda ...'));
check(!supportsCudaThumbnail('Hardware acceleration methods: cuda', 'scale_qsv'));
check(!supportsCudaThumbnail('Hardware acceleration methods: vaapi', 'scale_cuda'));
check(!hasCudaDevice({status:'partial',devices:[{vendor:'amd'}]}));
check(hasCudaDevice({status:'partial',devices:[{id:'GPU-12345678-aaaa',vendor:'nvidia'}]}));
check(!hasCudaDevice({status:'stale',devices:[{id:'GPU-12345678-aaaa',vendor:'nvidia'}]}));
const gpu=(temperatureC,status='available')=>({status,devices:[{id:'n0',vendor:'nvidia',memoryTotalMiB:16384,memoryUsedMiB:1024,utilizationPercent:12,temperatureC}]});
check(computeGpuMediaBudget(gpu(94),'nvenc').limit===0);
check(computeGpuMediaBudget(gpu(83),'nvenc').limit<computeGpuMediaBudget(gpu(50),'nvenc').limit);
check(computeGpuMediaBudget(gpu(50,'stale'),'nvenc').limit===1);
const cuda = videoThumbnailCommand('a.mp4', 'poster.jpg', 2, 'cuda');
check(cuda.includes('-hwaccel_output_format') && cuda.includes('cuda'));
check(cuda.some(arg => arg.includes('hwdownload')));
check(cuda.at(-1) === 'poster.jpg');
const cpu = videoThumbnailCommand('a.mp4', 'poster.jpg', 0, 'software');
check(!cpu.includes('-hwaccel') && !cpu.includes('-ss'));
check(cpu.some(arg => arg.includes("min(1280,iw)")));
let attempts = [], partialRemoved = 0, failures = 0;
const input = {
 sourcePath:'a.mp4', outputPath:'poster.jpg',seekSeconds:2, mode:'cuda',
 cancelled:async()=>false, removePartial:async()=>{partialRemoved++;},
 onFallback:()=>{failures++;},
 run:async(args)=>{attempts.push(args); if(args.includes('cuda')) throw Error('GPU unavailable');}
};
const fallback = await renderVideoThumbnail(input);
check(fallback.acceleration === 'software' && fallback.fellBack);
check(attempts.length === 2 && attempts[0].includes('cuda') && !attempts[1].includes('cuda'));
check(partialRemoved === 1 && failures === 1);
attempts = []; partialRemoved = 0;
const success = await renderVideoThumbnail({...input,run:async(args)=>{attempts.push(args);}});
check(success.acceleration === 'cuda' && !success.fellBack && attempts.length === 1);
let cancelled = false; attempts = [];
await assert.rejects(renderVideoThumbnail({...input,
 cancelled:async()=>cancelled,
 run:async(args)=>{attempts.push(args);cancelled=true;throw Error('cancelled');}
}),/cancelled/);
check(attempts.length === 1);
let cpuCleanup = 0;
await assert.rejects(renderVideoThumbnail({...input, mode:'software',
 run:async()=>{throw Error('bad source');},removePartial:async()=>{cpuCleanup++;}
}),/bad source/);
check(cpuCleanup===1);
const worker = readFileSync(new URL('../../apps/server/src/workers/media-worker.ts',import.meta.url),'utf8');
check(worker.includes('gpuLimiter.run(') && worker.includes('thumbnailAcceleration'));
check(worker.includes('computeGpuMediaBudget') && worker.includes('gpuThumbnailCooldownUntil') && worker.includes('hasCudaDevice('));
const processing = readFileSync(new URL('../../apps/server/src/core/media-processing.ts',import.meta.url),'utf8');
check(processing.includes('renderVideoThumbnail(') && processing.includes('supportsCudaThumbnail('));
check(processing.includes('acceleration: result.acceleration'));
console.log(`GPU thumbnail assertions: ${count}/${count} PASS`);
