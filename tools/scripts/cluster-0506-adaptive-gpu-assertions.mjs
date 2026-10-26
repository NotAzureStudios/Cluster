import assert from 'node:assert/strict';
import {computeGpuMediaBudget, GpuEncodeLimiter} from '../../apps/server/src/core/gpu-telemetry.ts';
const base=(memoryTotalMiB, memoryUsedMiB, utilizationPercent, vendor='nvidia') => ({status:'available',provider:'nvidia-smi',sampledAt:new Date().toISOString(),metricsSupported:true,devices:[{id:'gpu0',name:'Detected GPU',vendor,driver:'1',memoryTotalMiB,memoryUsedMiB,utilizationPercent,memoryUtilizationPercent:null,temperatureC:null,powerWatts:null}]});
const run=(snap, profile='nvenc', options={})=>computeGpuMediaBudget(snap,profile,options);
assert.equal(run(base(2048,256,10)).limit,1);
assert.equal(run(base(24576,2048,10)).limit,4);
assert.equal(run(base(24576,2048,80)).limit,3); // maxJobs 4, half raw capacity still >=4
assert.equal(run(base(24576,2048,95)).limit,0);
assert.equal(run(base(8192,7900,5)).limit,0);
assert.equal(run(base(24576,2048,5),'nvenc',{maxJobs:2}).limit,2);
assert.equal(run(base(8192,1000,5,'amd'),'nvenc').limit,1); // unknown NVIDIA sensor: hardware codec probing still required
assert.equal(run(base(8192,1000,5,'amd'),'amf').limit,2);
assert.equal(run(base(8192,1000,5),'software').limit,0);
assert.equal(run({status:'partial', devices:[]},'nvenc').limit,1);
const lim=new GpuEncodeLimiter(1);let active=0,peak=0; const sleep=()=>new Promise(r=>setTimeout(r,8));
const work=()=>lim.run(async()=>{active++;peak=Math.max(active,peak);await sleep();active--;});
await Promise.all([work(),work(),work()]);assert.equal(peak,1);
lim.setLimit(2);peak=0;await Promise.all([work(),work(),work(),work()]);assert.equal(peak,2);
assert.equal(lim.snapshot().active,0);
console.log('Adaptive GPU assertions: 13/13 PASS');
