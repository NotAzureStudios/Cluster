# Cluster v0.506 · GPU Video Thumbnails and Adaptive Media Budget

## Source status

This is an **incremental v0.506 development-source checkpoint**, based on the recoverable
`Cluster-v0.506-Adaptive-GPU.zip`. It is **not** the unmerged Pass 15 baseline,
a Windows binary package, or a production-certified release. The main product version remains `0.506`.

## Implemented

- Media-tool inspection now probes actual FFmpeg `-hwaccels` and `-filters` output for CUDA + `scale_cuda`; codec/driver/device runtime success is **not** assumed.
- Video thumbnail generation (HD+ sources) can perform GPU decode and CUDA scaling, then download a frame for JPEG output. Smaller frames and image-file derivatives retain the CPU path.
- Worker admission requires **detected NVIDIA hardware**, usable telemetry, sufficient measured capacity and an available process-local GPU slot. CUDA thumbnail work shares the same limiter as video encoding.
- GPU budgets use VRAM headroom, utilization, **thermal pressure**, and an optional administrator concurrency ceiling. Stale metrics grant at most one conservative encoder attempt; stale detection does not grant CUDA thumbnail admission.
- FFmpeg hardware errors trigger one clean CPU retry. Any partial GPU output is removed first, and a 60-second per-worker CUDA-thumbnail cooldown avoids repeated driver failure storms. Cancellation stops rather than starting a fallback.
- Successful artifacts record whether `cuda` or `software` produced the frame. Derivative identity and existing authorization, retention and deduplication paths are unchanged.
- `CLUSTER_MEDIA_GPU_THUMBNAILS=off` disables the optional GPU video-thumbnail path. No GPU vendor/model names are hardcoded as a deployment target.
- Added targeted mocked fallback/cancellation/admission tests and an optional real-FFmpeg smoke test requiring no GPU.

## Not yet implemented / not certified

- **GPU scaling for still-image thumbnails**, PDFs, models, or general-purpose compute. Those require actual tested GPU execution/benchmarks instead of pretend acceleration toggles.
- Intel/AMD hardware-decoded video-frame thumbnails, multi-GPU explicit device binding, a **cross-process** GPU quota, GPU session telemetry, or a persistent multi-worker capacity lease.
- Real driver/codec support, Windows native control-panel build, end-to-end database and media-worker runtime certification.
- P14/P15 authoritative source merge. Preserve their Admin, Project Types, Library and Media Viewer changes while transplanting this work.

## Checks

Run `npm run verify:source-foundation` (includes `cluster:0506:gpu:thumbnails:assertions`).
Run `npm run cluster:0506:gpu:thumbnails:smoke` for a real FFmpeg CPU-fallback JPEG if FFmpeg exists.
Require actual Windows/NVIDIA/AMD/Intel runtime tests before promising full device coverage.
