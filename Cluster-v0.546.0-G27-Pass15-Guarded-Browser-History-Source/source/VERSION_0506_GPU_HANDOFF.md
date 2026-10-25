# Cluster v0.506 · GPU metrics / acceleration continuation

## Baseline and status

This source builds on the previous **Cluster-v0.506.zip** (Studio Settings concurrency) staging checkpoint. It is **not** a merged Pass 15 master and not a certified Windows build. Keep the human-facing version `0.506` (Node manifests use `0.506.0`).

## Implemented

1. **GPU telemetry** (`apps/server/src/core/gpu-telemetry.ts`). `GpuTelemetry` coalesces/bounds probes, caches successful samples for 20s and failures for 60s, marks 120s-old samples stale, and never reports missing data as zero. NVIDIA NVML CLI (`nvidia-smi`) reports GPU%, memory controller %, VRAM MiB, temperature Celsius, power W, name, driver, and device identity. Windows CIM / Linux DRM enumerate other manufacturers with explicit unknown metrics. `nvidia-smi` is invoked without a shell, with a 2.5s timeout and 64 KiB output cap. Multiple GPUs are represented independently. Some GPU environments require vendor-specific drivers/permissions.
2. **Integrated host sampling** via the existing `createServerResourceGovernorRuntime` cadence. This is advisory-only and does not change global server saturation or reject normal HTTP work due to GPU load.
3. **Admin-only Operations hardware details** on `/api/admin/operations/performance` and `/api/admin/operations/health`, rendered in the Server Performance panel. The public `/health` payload intentionally contains no device names, utilization, VRAM or hardware IDs.
4. **Media processing GPU use** through FFmpeg NVIDIA NVENC, AMD AMF, Intel QSV, and Apple VideoToolbox where compiled/available. Accelerated proxy/review encoding uses a per-worker GPU gate (default 1 concurrent accelerated job, configurable 1–4) with cancellation. NVIDIA encodes select software when observed GPU utilization is >=94% or free VRAM is below 512 MiB. Unknown telemetry does not disable FFmpeg's existing hardware-then-software fallback. Non-encode jobs do not consume GPU slots.
5. **Native Windows control panel** now displays a separate line with NVIDIA GPU utilization, VRAM, temperature and GPU count. A 30s background cached probe prevents blocking the Win32 UI thread.

## Configuration

- `CLUSTER_MEDIA_ACCELERATION=auto|software|nvenc|amf|qsv|videotoolbox` (existing setting extended with AMD AMF).
- `CLUSTER_MEDIA_GPU_MAX_CONCURRENT=1` (new, clamped to 1–4; per **media-worker process**, not a multi-node global semaphore).

## Tests / limitations

- `npm run verify:source-foundation` includes the GPU assertions, covers cached/coalesced probes, telemetry absence, NVIDIA parsing, GPU-pressure fallback, concurrent limiter, admin-only projection, FFmpeg profile coverage, and native asynchronous polling source.
- Also run the TS parser/import + CSS sweep, source manifest hashing, ZIP integrity, and incremental patch application check.
- Need **real** Windows host/RTX 3090 Ti or other device, NVIDIA driver and `nvidia-smi` installed, actual FFmpeg build/driver support, AMD AMF/Intel QSV hardware tests, multiple-device and heavy contention tests. FFmpeg showing an encoder in `-encoders` alone does **not** establish device runtime readiness.
- Native Go 1.27.1 Windows build not available in this environment, so the Win32 change must be compiled and tested on the official build workstation.
- Other GPUs may only show identity and `metrics unavailable` until approved vendor-specific sensor APIs are implemented. No fabricated GPU compute acceleration for unrelated tasks.
- Current source lineage remains P13 + P16C overlay + v0.506 staging; the newer P15 reconstructed source cannot be materialized here. Apply this increment as a reviewed patch to the authoritative source, preserving P14/P15 Admin/Projects/Library changes.

## Next work

Merge into the authoritative source; run Windows/Go and full Node 24 build; benchmark real NVENC/AMF/QSV encodes and CPU fallback; certify thermal/VRAM metrics; then extend GPU compute only to workloads with proven CUDA/DirectML/Vulkan adapters and explicit CPU fallback. Keep version names simple.
