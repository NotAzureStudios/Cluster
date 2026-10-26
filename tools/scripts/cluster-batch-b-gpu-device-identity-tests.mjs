#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const code=ts.transpileModule(readFileSync('apps/server/src/core/gpu-telemetry.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require,Set,Map,JSON,Date,Number,Promise,String,Math,Array,Uint32Array,setTimeout,clearTimeout,process,Buffer},{filename:'gpu-telemetry.ts'});
const {GpuTelemetry,computeGpuMediaBudget} = module.exports;
const first={Name:'AMD Radeon Pro',AdapterCompatibility:'AMD',DriverVersion:'3.4',PNPDeviceID:'PCI\\VEN_1002&DEV_AAAA\\SLOT1'};
const second={Name:'Intel Arc Pro',AdapterCompatibility:'Intel',DriverVersion:'2.2',PNPDeviceID:'PCI\\VEN_8086&DEV_BBBB\\SLOT2'};
let items=[first,second];
const runner=async(command)=>{if(command==='nvidia-smi') throw Error('not installed');return JSON.stringify(items);};
let count=0; async function check(label,fn){await fn();console.log('PASS '+label);count++}
await check('Windows CIM identities remain stable after PCI enumeration reorder',async()=>{
 const a=await new GpuTelemetry({platform:'win32',runner}).sample();
 items=[second,first];
 const b=await new GpuTelemetry({platform:'win32',runner}).sample();
 assert.equal(a.devices.length,2); assert.equal(b.devices.length,2);
 for(const device of a.devices){const other=b.devices.find(x=>x.name===device.name); assert.equal(other.id,device.id)}
 assert.notEqual(a.devices[0].id,a.devices[1].id);
 assert.ok(a.devices.every(x=>/^windows-(amd|intel)-[a-f0-9]{24}$/.test(x.id)));
 assert.ok(!JSON.stringify(a).includes('VEN_1002'));
});
await check('missing PNP identity stays clearly unverified, not globally shared',async()=>{
 items=[{Name:'Unknown Adapter',AdapterCompatibility:'Unknown'}];
 const a=await new GpuTelemetry({platform:'win32',runner}).sample();
 assert.equal(a.devices[0].id,'windows-unverified-0');
 const unverified=computeGpuMediaBudget({...a,devices:[{...a.devices[0],vendor:'amd'}]},'amf');
 assert.equal(unverified.limit,0);assert.equal(unverified.reason,'unstable-device-identity');
});
await check('per-device budget does not multiply capacity using imaginary second GPUs',async()=>{
 const snapshot={status:'partial',provider:'windows-cim',sampledAt:new Date().toISOString(),devices:[{id:'verified-card',vendor:'amd',utilizationPercent:null,memoryTotalMiB:null,memoryUsedMiB:null}],metricsSupported:false};
 const result=computeGpuMediaBudget(snapshot,'amf');
 assert.equal(result.deviceId,'verified-card');assert.equal(result.limit,1);
});
console.log(`Batch B GPU adapter identity checks ${count}/${count} passed`);
