# Cluster v0.506 · Adaptive GPU Resource Scheduling

## What changed
- Removed the fixed one-GPU-job default. GPU media-worker concurrency is computed from detected VRAM capacity, free VRAM, and GPU utilization. Small and large cards receive different admission budgets, up to a conservative default ceiling of four concurrent GPU encodes. `CLUSTER_MEDIA_GPU_MAX_CONCURRENT` remains an **optional maximum**, not the default requested job count; it accepts 1–16.
- Metrics are sampled through existing `GpuTelemetry` caching. Utilization >=92% or insufficient VRAM blocks new accelerated encode admission and routes the job to software. Partial or unavailable sensors conservatively allow a single FFmpeg hardware attempt, retaining its CPU fallback.
- NVIDIA NVENC, AMD AMF and Intel QSV are distinguished by detected vendor for capacity selection. FFmpeg profile capability checks remain authoritative. Other hardware profiles fall back to conservative admission if no device metrics match.
- One device is budgeted at a time; current FFmpeg jobs do not bind to explicit per-device IDs. Do **not** sum multi-GPU capacities or claim multi-adapter scheduling yet.
- Reworked the media-worker GPU admission queue to reserve each slot before waking a waiter, avoid slot overcommit, preserve abort handling, and allow dynamic limit changes without cancelling running work.
- Added `tools/scripts/cluster-0506-adaptive-gpu-assertions.mjs` with 13 focused checks.

## Limitations and next work
- This implements **adaptive admission for accelerated video proxy/review encoding**, not arbitrary CUDA/OpenCL/Vulkan general-compute offload.
- Image thumbnails are **not** claimed to use the GPU. Add a vetted acceleration backend (e.g. supported FFmpeg `scale_cuda`/`scale_qsv`/`scale_vaapi` for frame thumbnails where available), benchmark the GPU vs CPU path, and ensure portable CPU fallback. Vendor hardware decode/upload/output pipelines vary.
- Budgets are per media-worker process, not a distributed or multi-worker server-wide GPU quota. A future GPU Resource Governor should coordinate by GPU adapter UUID across all worker processes before increasing independent worker counts.
- Thermal throttle, encoder session limits, real device routing and cross-process coordination still need capability probing/runtime tests.
- Source remains the v0.506 staging baseline, not the unrecoverable Pass 15 master merge. No native Windows, driver, or PostgreSQL runtime certification is implied.
