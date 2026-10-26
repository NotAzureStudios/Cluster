#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const gpuSrc = readFileSync('apps/server/src/core/gpu-telemetry.ts', 'utf8');
const transpiled = ts.transpileModule(gpuSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(transpiled, { module: mod, exports: mod.exports, require, Buffer, Date, Number, Math, String, Array, Map, Set, Promise, JSON, process, setTimeout, clearTimeout }, { filename: 'gpu-telemetry.ts' });
const { parseNvidiaSmi, computeGpuMediaBudget, hasCudaDevice, verifiedGpuDeviceId, GpuTelemetry } = mod.exports;
const worker = readFileSync('apps/server/src/workers/media-worker.ts', 'utf8');
const drawer = readFileSync('packages/renderer/src/features/create/SharedCreateDrawer.tsx', 'utf8');
const tickets = readFileSync('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx', 'utf8');
const mutation = readFileSync('packages/renderer/src/core/api/mutation.ts','utf8');
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const snapshot = (devices, status='available') => ({ status, provider: 'nvidia-smi', sampledAt: new Date().toISOString(), devices, metricsSupported: true });
const nvidia = (id) => ({ id, vendor: 'nvidia', utilizationPercent: 2, memoryTotalMiB: 8192, memoryUsedMiB: 1200, temperatureC: 40 });
await check('Unproven nvidia-smi index does not masquerade as stable distributed lease identity', () => {
 const rows = parseNvidiaSmi('0, N/A, RTX, 999, 5, 3, 8192, 1200, 55, 90');
 assert.equal(rows.length, 1);
 assert.equal(rows[0].id, 'nvidia-unverified-0');
 assert.equal(verifiedGpuDeviceId(rows[0].id), false);
 assert.equal(computeGpuMediaBudget(snapshot(rows), 'nvenc').limit, 0);
 assert.equal(hasCudaDevice(snapshot(rows)), false);
});
await check('Verified NVIDIA UUID remains a valid lease identity', () => {
 const rows = parseNvidiaSmi('0, GPU-12345678-aaaa-bbbb-cccc-ddddeeeeffff, RTX, 999, 5, 3, 8192, 1200, 55, 90');
 assert.equal(rows[0].id, 'GPU-12345678-aaaa-bbbb-cccc-ddddeeeeffff');
 assert.equal(hasCudaDevice(snapshot(rows)), true);
 assert.ok(computeGpuMediaBudget(snapshot(rows), 'nvenc').limit > 0);
});
await check('Missing GPU telemetry does not create an unlimited unidentified shared capacity pool', () => {
 const empty = snapshot([], 'unavailable');
 assert.equal(computeGpuMediaBudget(empty, 'nvenc').limit, 0);
 assert.equal(computeGpuMediaBudget(empty, 'nvenc').reason, 'no-verified-device');
 assert.equal(hasCudaDevice(empty), false);
 assert.doesNotMatch(worker, /unidentified-\$\{acceleration\}/);
 assert.match(worker, /if \(decision\.profile === "software" \|\| !fresh\.limit \|\| !fresh\.deviceId\) return null/);
 assert.match(worker, /return accelerated \?\? execute\("software"\)/);
});
await check('Stale snapshots without stable identity fail closed but known UUID retains conservative capacity', () => {
 const empty = computeGpuMediaBudget(snapshot([], 'stale'), 'nvenc');
 assert.equal(empty.limit, 0);
 assert.equal(computeGpuMediaBudget(snapshot([nvidia('nvidia-unverified-0')], 'stale'), 'nvenc').limit, 0);
 const known = computeGpuMediaBudget(snapshot([nvidia('GPU-12345678-aaaa')], 'stale'), 'nvenc');
 assert.equal(known.deviceId, 'GPU-12345678-aaaa');
 assert.equal(known.limit, 1);
});
await check('Linux DRM enumeration suffix is not accepted as globally stable device identity', () => {
 assert.equal(verifiedGpuDeviceId('card1-0x10de-0x2684'), false);
 assert.equal(computeGpuMediaBudget(snapshot([{...nvidia('card1-0x10de-0x2684'), vendor: 'nvidia'}]),'nvenc').limit, 0);
});
await check('Non-NVIDIA sensors never authorize a CUDA thumbnail', () => {
 assert.equal(hasCudaDevice(snapshot([{...nvidia('windows-amd-deadbeef'), vendor:'amd'}])), false);
});
await check('Create drawer locks a private confirmed-commit outcome without manufacturing object identity', () => {
 assert.match(drawer, /detail\.code === "IDEMPOTENCY_ALREADY_COMMITTED"[\s\S]*?createIntentRef\.current\.commit\(\)/);
 assert.match(drawer, /No duplicate was submitted\. Refresh the destination workspace/);
 assert.match(drawer, /disabled=\{createIntentRef\.current\.committed\} busy=\{busy\}/);
 assert.match(drawer, /else if \(mode === "whiteboard"\) void onReloadWhiteboards/);
});
await check('Ticket mini-create refreshes source on committed confirmation without replay', () => {
 assert.match(tickets, /error\.code === "IDEMPOTENCY_ALREADY_COMMITTED"[\s\S]*?ticketCreateIntentRef\.current\.commit\(\)/);
 assert.match(tickets, /void loadPersonalTickets\(true\)/);
 assert.match(tickets, /Ticket list refresh failed; use Refresh again later/);
 assert.match(tickets, /queryApi<\{ boards: Board\[\] \}>\("\/api\/tickets\/workspace", \{ staleMs: 15_000, maxAgeMs: 5 \* 60_000, force, tags:/);
});
await check('Declined accelerated work releases the GPU gate before software fallback', () => {
 assert.ok((worker.match(/return accelerated \?\? execute\("software"\)/g) || []).length >= 2);
 assert.ok(!worker.includes('return result ?? execute("software")'));
});
await check('Shared online mutation cache invalidates confirmed commits but never invents private results', () => {
 assert.match(mutation, /error instanceof ApiError && error.status === 409 && error.code === "IDEMPOTENCY_ALREADY_COMMITTED"[\s\S]*?invalidateMutationCache\(path\);[\s\S]*?invalidateMutationQueries\(options.invalidate\);[\s\S]*?throw error;/);
});
console.log(`Batch B verified admission + interactive Create confirmation: ${count}/${count} passed`);
