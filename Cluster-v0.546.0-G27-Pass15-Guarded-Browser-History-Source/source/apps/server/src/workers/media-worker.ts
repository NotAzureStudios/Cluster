import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { hostname } from "node:os";
import { createPrismaClient } from "../core/prisma-client.js";
import { cleanupExpiredAssetArtifacts, executeMediaJob, inspectMediaTools, mediaLimits, mediaWorkerHeartbeat, mediaWorkerLabels, selectedMediaAcceleration, supportedMediaJobRoutes, supportedMediaJobs, type MediaJobPayload } from "../core/media-processing.js";
import { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import { GpuEncodeLimiter, GpuTelemetry, chooseGpuEncodeAdmission, computeGpuMediaBudget, hasCudaDevice } from "../core/gpu-telemetry.js";
import { GpuMediaLeaseCoordinator } from "../core/gpu-media-leases.js";
import { DurableJobWorker } from "../domains/jobs/job-worker.js";
import { MediaWorkerControl, MediaWorkerPeriodicTasks, mediaWorkerDirective } from "./media-worker-control.js";

const prisma = createPrismaClient();
const queue = new BackgroundJobQueue(prisma as any, {
  info: (payload, message) => console.log(message || "media queue", payload),
  warn: (payload, message) => console.warn(message || "media queue", payload),
});
const tools = await inspectMediaTools();
const concurrency = mediaLimits().concurrency;
const selectedAcceleration = selectedMediaAcceleration(tools);
const gpuTelemetry = new GpuTelemetry();
// Explicit cap is optional. By default adapt to hardware/available headroom;
// this cap only limits acceleration, never overall CPU media throughput.
const gpuCapRaw = Number(process.env.CLUSTER_MEDIA_GPU_MAX_CONCURRENT || 4);
const gpuCap = Number.isFinite(gpuCapRaw) ? Math.max(1, Math.min(16, Math.floor(gpuCapRaw))) : 4;
// One process-local gate shared by GPU encodes and accelerated frame extraction.
const gpuLimiter = new GpuEncodeLimiter(1);
// Limits are shared by media workers running on this host and PostgreSQL DB.
// Failed quota acquisition fails closed to software processing.
const gpuLeases = new GpuMediaLeaseCoordinator(prisma as any);
const gpuHost = hostname();
let gpuThumbnailCooldownUntil = 0;
const labels = mediaWorkerLabels();
const supportedRoutes = supportedMediaJobRoutes(tools);
const supportedJobs = supportedMediaJobs(tools);
const supportsEncode = supportedRoutes.some(({ kind }) => kind === "proxy" || kind === "review_encode");
const workerQueues = [...supportedRoutes.filter(({ kind }) => kind !== "proxy" && kind !== "review_encode").map(({ medium, kind }) => `media.${medium}.${kind}`), ...(supportsEncode ? ["media.software", ...(selectedAcceleration !== "software" ? [`media.${selectedAcceleration}`] : [])] : [])];
const worker = new DurableJobWorker(queue, { queues: workerQueues, concurrency, leaseMs: 5 * 60_000, cancellationPollMs: 2_500 });
let stopping = false;
const control = new MediaWorkerControl(() => mediaWorkerDirective(prisma, worker.workerId));
const periodic = new MediaWorkerPeriodicTasks();
const shutdownController = new AbortController();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let directiveTimer: ReturnType<typeof setInterval> | null = null;
let retentionTimer: ReturnType<typeof setInterval> | null = null;
async function pause(ms: number) {
  try { await delay(ms, undefined, { signal: shutdownController.signal }); }
  catch (error) { if (!stopping) throw error; }
}
let heartbeatFailure: string | null = null;

for (const kind of supportedJobs) {
  worker.register<MediaJobPayload>(`media.${kind}`, async ({ payload, job, signal, updateProgress, cancellationRequested }) => {
    const routedAcceleration = job.queue.startsWith("media.") ? job.queue.slice("media.".length) : selectedAcceleration;
    const acceleration = tools.accelerationProfiles.includes(routedAcceleration as typeof selectedAcceleration)
      ? routedAcceleration as typeof selectedAcceleration : "software";
    const execute = (profile: typeof selectedAcceleration, thumbnailAcceleration: "cuda" | "software" = "software", leaseSignal?: AbortSignal) => executeMediaJob({
      prisma,
      kind,
      payload,
      durableJobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      cancellationRequested: Object.assign(
        async () => signal.aborted || Boolean(leaseSignal?.aborted) || await cancellationRequested(),
        { signal: leaseSignal || signal },
      ),
      updateProgress: (progress, message) => updateProgress(progress, message),
      tools,
      accelerationProfile: profile,
      thumbnailAcceleration,
      onGpuThumbnailFallback: (reason) => {
        gpuThumbnailCooldownUntil = Date.now() + 60_000;
        console.warn("GPU thumbnail failed; software fallback engaged (60s GPU frame cooldown)", reason);
      },
    });
    const gpuWork = async <T>(deviceId: string | null, limit: number, run: (leaseSignal: AbortSignal) => Promise<T>): Promise<T | null> => {
      if (!deviceId || limit <= 0) return null;
      const lease = await gpuLeases.tryAcquire({ host: gpuHost, deviceId, jobId: job.id, limit }).catch(() => null);
      if (!lease) return null;
      return gpuLeases.run(lease, run, signal);
    };
    // Frame extraction is a separate capability from hardware encoding. CUDA is
    // attempted only for video thumbnails and shares the encode GPU gate.
    if (kind === "thumbnail") {
      const videoThumbnail = job.queue === "media.video.thumbnail";
      if (!videoThumbnail || tools.thumbnailAcceleration !== "cuda" || Date.now() < gpuThumbnailCooldownUntil
        || process.env.CLUSTER_MEDIA_GPU_THUMBNAILS === "off") return execute("software");
      const gpu = await gpuTelemetry.sample().catch(() => gpuTelemetry.snapshot());
      const budget = computeGpuMediaBudget(gpu, "nvenc", { maxJobs: gpuCap, memoryPerJobMiB: 512 });
      if (!hasCudaDevice(gpu) || budget.limit === 0 || chooseGpuEncodeAdmission(gpu, "nvenc").profile === "software") return execute("software");
      gpuLimiter.setLimit(budget.limit);
      return gpuLimiter.run(async () => {
        const current = await gpuTelemetry.sample().catch(() => gpuTelemetry.snapshot());
        const fresh = computeGpuMediaBudget(current, "nvenc", { maxJobs: gpuCap, memoryPerJobMiB: 512 });
        if (Date.now() < gpuThumbnailCooldownUntil || !hasCudaDevice(current) || fresh.limit === 0) return execute("software");
        const result = await gpuWork(fresh.deviceId, fresh.limit, (leaseSignal) => execute("software", "cuda", leaseSignal));
        return result ?? execute("software");
      }, signal);
    }
    if ((kind !== "proxy" && kind !== "review_encode") || acceleration === "software") return execute("software");
    const gpu = await gpuTelemetry.sample().catch(() => gpuTelemetry.snapshot());
    const admission = chooseGpuEncodeAdmission(gpu, acceleration);
    const budget = computeGpuMediaBudget(gpu, acceleration, { maxJobs: gpuCap });
    if (admission.profile === "software" || budget.limit === 0) return execute("software");
    gpuLimiter.setLimit(budget.limit);
    // GPU capacity is recalculated on each job; CPU fallback never occupies the GPU gate.
    return gpuLimiter.run(async () => {
      const updated = await gpuTelemetry.sample().catch(() => gpuTelemetry.snapshot());
      const decision = chooseGpuEncodeAdmission(updated, acceleration);
      const fresh = computeGpuMediaBudget(updated, acceleration, { maxJobs: gpuCap });
      if (decision.profile === "software" || !fresh.limit) return execute("software");
      // Unknown metrics still get a conservative single shared slot, never an
      // independent unlimited GPU slot for each process.
      const device = fresh.deviceId || `unidentified-${acceleration}`;
      const result = await gpuWork(device, fresh.limit, (leaseSignal) => execute(acceleration, "software", leaseSignal));
      return result ?? execute("software");
    }, signal);
  });
}

async function heartbeat(status?: string) {
  const snapshot = worker.snapshot();
  await mediaWorkerHeartbeat(prisma, { workerId: snapshot.workerId, tools, concurrency, activeJobs: snapshot.running, status, selectedAcceleration, labels, lastError: heartbeatFailure });
}

async function refreshDirective() {
  return control.refresh();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  control.stop();
  worker.stop(); // Stop new claims before awaiting database or periodic I/O.
  shutdownController.abort();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (directiveTimer) clearInterval(directiveTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  console.log(`Cluster Media Worker received ${signal}; draining active jobs.`);
  // An interval callback may already be writing status or deleting expired files.
  // Wait for those writes before the final draining/stopped heartbeats and DB disconnect.
  await periodic.stopAndDrain();
  await heartbeat("draining").catch(() => undefined);
  await worker.drain();
  await heartbeat("stopped").catch(() => undefined);
  await prisma.$disconnect();
}

function handleShutdown(signal: string) {
  void shutdown(signal).then(() => process.exit(0), (error) => {
    console.error("Cluster Media Worker shutdown failed", error);
    process.exit(1);
  });
}
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

console.log(`Cluster Media Worker starting · queues=${workerQueues.join(",") || "none"} · concurrency=${concurrency} · acceleration=${selectedAcceleration}`);
console.log(tools.ready ? `Processing capabilities · ${tools.capabilities.join(", ") || "none"}` : "Media toolchain unavailable; worker will remain degraded until a supported processing capability is installed.");
await heartbeat();
await refreshDirective().catch((error) => console.warn("Media worker control unavailable at startup; pausing new claims", error));
heartbeatTimer = setInterval(() => {
  if (stopping) return;
  const state = control.current();
  void periodic.run("heartbeat", () => heartbeat(state === "maintenance" ? "maintenance" : state === "drain" ? "draining" : undefined)).then(() => { heartbeatFailure = null; }).catch((error) => { heartbeatFailure = String(error instanceof Error ? error.message : error).slice(0, 500); console.warn("Media worker heartbeat failed", error); });
}, 10_000);
heartbeatTimer.unref?.();
directiveTimer = setInterval(() => {
  if (!stopping) void periodic.run("directive", refreshDirective).catch((error) => console.warn("Media worker directive refresh failed; pausing new claims", error));
}, 5_000);
directiveTimer.unref?.();
retentionTimer = setInterval(() => { if (!stopping && control.current() === "active") void periodic.run("retention", () => cleanupExpiredAssetArtifacts(prisma, 500)).catch((error) => console.warn("Media retention cleanup failed", error)); }, 60 * 60_000);
retentionTimer.unref?.();
let idleBatchDelayMs = 1_000;
while (!stopping) {
  if (!tools.ready) { await pause(15_000); continue; }
  if (control.current() !== "active") { idleBatchDelayMs = 1_000; await pause(5_000); continue; }
  try {
    const started = await worker.runBatch();
    if (started > 0 || worker.snapshot().running > 0) idleBatchDelayMs = 1_000;
    else idleBatchDelayMs = Math.min(15_000, Math.max(1_000, Math.round(idleBatchDelayMs * 1.75)));
  } catch (error) {
    console.error("Media worker batch failed", error);
    idleBatchDelayMs = Math.min(15_000, Math.max(2_000, idleBatchDelayMs * 2));
  }
  await pause(idleBatchDelayMs);
}
if (heartbeatTimer) clearInterval(heartbeatTimer);
if (directiveTimer) clearInterval(directiveTimer);
if (retentionTimer) clearInterval(retentionTimer);
