import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { GpuTelemetry, GpuEncodeLimiter, parseNvidiaSmi, chooseGpuEncodeAdmission } from "../../apps/server/src/core/gpu-telemetry.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let count = 0;
const check = (label, fn) => { fn(); count++; console.log(`PASS ${count}: ${label}`); };
const nvidia = '0, GPU-12345678-abcd, "NVIDIA, RTX 3090 Ti", 560.1, 73, 22, 24564, 18320, 69, 290.5';
check("NVIDIA CSV parsing honors quoting and VRAM units", () => {
  const gpu = parseNvidiaSmi(nvidia)[0];
  assert.equal(gpu.name, "NVIDIA, RTX 3090 Ti"); assert.equal(gpu.utilizationPercent, 73);
  assert.equal(gpu.memoryTotalMiB, 24564); assert.equal(gpu.memoryUsedMiB, 18320);
  assert.equal(gpu.temperatureC, 69); assert.equal(gpu.powerWatts, 290.5);
});
check("N/A values stay unknown, not fake idle zeros", () => {
  const gpu = parseNvidiaSmi('1, GPU-aaaaaaaa, Test GPU, 1, N/A, N/A, 8192, N/A, N/A, N/A')[0];
  assert.equal(gpu.utilizationPercent, null); assert.equal(gpu.memoryUsedMiB, null);
});
check("Reject invalid GPU index and malformed data", () => {
  assert.equal(parseNvidiaSmi("invalid,uuid,Test" ).length, 0);
  assert.equal(parseNvidiaSmi("" ).length, 0);
});
const available = { status: "available", provider: "nvidia-smi", sampledAt: new Date().toISOString(), metricsSupported: true, devices: parseNvidiaSmi(nvidia) };
check("Available GPU capacity selects acceleration", () => assert.equal(chooseGpuEncodeAdmission(available, "nvenc").profile, "accelerated"));
check("Hot GPU selects software without starving HTTP", () => {
  const high = { ...available, devices: [{ ...available.devices[0], utilizationPercent: 99 }] };
  assert.equal(chooseGpuEncodeAdmission(high, "nvenc").profile, "software");
});
check("Low free VRAM selects software", () => {
  const full = { ...available, devices: [{ ...available.devices[0], memoryUsedMiB: 24400 }] };
  assert.equal(chooseGpuEncodeAdmission(full, "nvenc").profile, "software");
});
check("Unknown GPU telemetry leaves FFmpeg hardware fallback available", () => {
  assert.equal(chooseGpuEncodeAdmission({ ...available, status: "unavailable", devices: [] }, "nvenc").profile, "accelerated");
});
check("Explicit software request cannot be upgraded", () => assert.equal(chooseGpuEncodeAdmission(available, "software").profile, "software"));
let calls = 0;
const telemetry = new GpuTelemetry({ platform: "win32", runner: async (cmd) => { calls++; if (cmd === "nvidia-smi") return nvidia; throw new Error("unexpected provider"); }, ttlMs: 20_000 });
await Promise.all(Array.from({ length: 5 }, () => telemetry.sample()));
check("Concurrent probes are coalesced", () => assert.equal(calls, 1));
await telemetry.sample();
check("Cached probe does not respawn a process", () => assert.equal(calls, 1));
check("Telemetry snapshots carry sample provenance", () => {
  const shot = telemetry.snapshot(); assert.equal(shot.status, "available"); assert.equal(shot.provider, "nvidia-smi"); assert.ok(shot.sampledAt);
});
const identity = new GpuTelemetry({ platform: "win32", runner: async (cmd) => {
  if (cmd === "nvidia-smi") throw new Error("not installed");
  return '{"Name":"AMD Radeon RX 7800 XT","AdapterCompatibility":"AMD","DriverVersion":"1.0"}';
} });
const identityShot = await identity.sample();
check("Windows AMD identity is labeled partial without invented usage", () => {
  assert.equal(identityShot.status, "partial"); assert.equal(identityShot.devices[0].vendor, "amd"); assert.equal(identityShot.devices[0].utilizationPercent, null);
});
const limiter = new GpuEncodeLimiter(1);
let simultaneous = 0, peak = 0;
await Promise.all(Array.from({ length: 4 }, (_, i) => limiter.run(async () => {
  simultaneous++; peak = Math.max(peak, simultaneous); await new Promise((resolve) => setTimeout(resolve, 3)); simultaneous--; return i;
})));
check("GPU-only semaphore serializes concurrent encodes", () => { assert.equal(peak, 1); assert.equal(limiter.snapshot().active, 0); });
const controller = new AbortController();
let finishFirst;
const blocked = new Promise((resolve) => { finishFirst = resolve; });
const first = limiter.run(async () => blocked);
const queued = limiter.run(async () => "incorrect", controller.signal).then(() => "resolved", () => "cancelled");
controller.abort();
finishFirst(); await first;
check("Cancelled queued encode never runs", async () => assert.equal(await queued, "cancelled"));
const read = (name) => readFileSync(resolve(root, name), "utf8");
check("Host telemetry follows existing governor cadence", () => {
  const runtime = read("apps/server/src/app/server-resource-governor-runtime.ts");
  assert.match(runtime, /input\.gpuTelemetry\?\.sample/);
});
check("GPU details are only projected from authenticated admin routes", () => {
  const route = read("apps/server/src/app/server-routes-health-operations.ts");
  const publicHealth = route.slice(route.indexOf('app.get("/health"'), route.indexOf('app.get("/api/kiosk/public"'));
  assert.doesNotMatch(publicHealth, /gpuTelemetry|gpu:/);
  assert.match(route, /requireAdminUserForRequest/);
  assert.match(route, /gpu: deps\.gpuTelemetry/);
});
check("Media worker uses bounded accelerated encode gate and CPU fallback", () => {
  const worker = read("apps/server/src/workers/media-worker.ts");
  assert.match(worker, /gpuLimiter\.run/); assert.match(worker, /chooseGpuEncodeAdmission/); assert.match(worker, /return execute\("software"\)/);
});
check("AMD AMF joins existing NVIDIA/Intel/Apple encode profiles", () => {
  const processor = read("apps/server/src/core/media-processing.ts");
  assert.match(processor, /h264_amf/); assert.match(processor, /h264_nvenc/); assert.match(processor, /h264_qsv/);
  assert.match(processor, /h264_videotoolbox/);
});
check("Admin UI projects metrics with explicit unavailable states", () => {
  const panel = read("packages/renderer/src/features/operations/ServerPerformancePanel.tsx");
  assert.match(panel, /GPU devices/); assert.match(panel, /VRAM unavailable/); assert.match(panel, /Temperature unavailable/);
});
check("Native Windows control panel samples GPU off UI thread", () => {
  const sampler = read("apps/server-launcher-go/gpu_metrics_windows.go");
  const panel = read("apps/server-launcher-go/launcher_ui_windows.go");
  assert.match(sampler, /go func\(\)/); assert.match(sampler, /context.WithTimeout/);
  assert.match(sampler, /30\s*\*\s*time.Second/);
  assert.match(panel, /ui.gpuSampler.poll\(\)/);
});
console.log(`GPU source checks: ${count}/${count} PASS`);
