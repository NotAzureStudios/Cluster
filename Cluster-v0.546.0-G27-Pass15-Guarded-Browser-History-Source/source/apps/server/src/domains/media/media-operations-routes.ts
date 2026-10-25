import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ASSET_PROCESSING_JOBS, REVIEW_MEDIA } from "@cluster/shared";
import { DEFAULT_MEDIA_PROCESSING_POLICIES, mediaStorageDiagnostics, normalizeAccelerationPreference } from "../../core/media-processing.js";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";

function parseArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

export function registerMediaOperationsRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const { AUTH_REQUIRED, decorateUserForClient, getCurrentUser, logActivity, prisma } = deps;

  async function requireStudioAdmin(request: FastifyRequest, reply: FastifyReply) {
    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;
    if (AUTH_REQUIRED && !decorated?.isAdmin) {
      reply.code(403).send({ code: "ADMIN_REQUIRED", message: "Studio administrator access is required for media infrastructure controls." });
      return null;
    }
    return { user };
  }

  app.get("/api/admin/media-processing/operations", async (request, reply) => {
    const auth = await requireStudioAdmin(request, reply); if (!auth) return;
    const cutoff = new Date(Date.now() - 35_000);
    const workers = await prisma.mediaWorkerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 64 });
    const policies = await prisma.mediaProcessingPolicy.findMany({ orderBy: [{ projectType: "asc" }, { medium: "asc" }, { assetRole: "asc" }], take: 500 });
    const mediaJobs = await prisma.backgroundJob.groupBy({ by: ["queue", "status"], where: { queue: { startsWith: "media" } }, _count: { _all: true } }).catch(() => []);
    const gpuLeases = await prisma.gpuMediaLease.groupBy({ by: ["host", "deviceId"], where: { expiresAt: { gt: new Date() } }, _count: { _all: true } }).catch(() => []);
    const storage = await mediaStorageDiagnostics(prisma);
    return {
      workers: workers.map((worker: any) => ({ id: worker.id, hostname: worker.hostname, online: worker.lastSeenAt >= cutoff, status: worker.lastSeenAt >= cutoff ? worker.status : "offline", desiredState: worker.desiredState, labels: parseArray(worker.labels), capabilities: parseArray(worker.capabilities), accelerationProfiles: parseArray(worker.accelerationProfiles), selectedAcceleration: worker.selectedAcceleration, concurrency: worker.concurrency, activeJobs: worker.activeJobs, capacityPercent: Math.round(Number(worker.activeJobs || 0) / Math.max(1, Number(worker.concurrency || 1)) * 100), storageTopology: worker.storageTopology, storageFingerprint: worker.storageFingerprint, storageMatch: worker.storageTopology !== "remote" && (!worker.storageFingerprint || worker.storageFingerprint === storage.fingerprint), lastError: worker.lastError, ffmpegVersion: worker.ffmpegVersion, ffprobeVersion: worker.ffprobeVersion, toolVersions: parseObject(worker.toolVersions), resourceBudgets: parseObject(worker.resourceBudgets), startedAt: worker.startedAt, lastSeenAt: worker.lastSeenAt })),
      policies: policies.map((policy: any) => ({ ...policy, jobs: parseArray(policy.jobs) })),
      defaults: DEFAULT_MEDIA_PROCESSING_POLICIES,
      queue: mediaJobs.map((row: any) => ({ queue: row.queue, status: row.status, count: Number(row._count?._all || 0) })),
      gpuJobs: gpuLeases.map((row: any) => ({ host: row.host, deviceId: row.deviceId, active: Number(row._count?._all || 0) })),
      storage,
    };
  });

  app.post("/api/admin/media-processing/reprocess", async (request, reply) => {
    const auth = await requireStudioAdmin(request, reply); if (!auth) return;
    const body = z.object({ dryRun: z.boolean().optional().default(true), limit: z.coerce.number().int().min(1).max(50).default(25) }).parse(request.body || {});
    const rows = await prisma.backgroundJob.findMany({
      where: { queue: { startsWith: "media" }, status: { in: ["FAILED", "DEAD_LETTER", "CANCELLED"] } },
      select: { id: true, queue: true, type: true, status: true, lastError: true, correlationId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: body.limit,
    });
    const preview = rows.map((row: any) => ({ id: row.id, queue: row.queue, type: row.type, status: row.status, lastError: row.lastError || null, correlationId: row.correlationId || null, updatedAt: row.updatedAt }));
    if (body.dryRun) return { ok: true, dryRun: true, requested: preview.length, preview };
    const outcomes = [];
    for (const row of rows) {
      const retried = await deps.jobQueue.retry(row.id);
      outcomes.push({ id: row.id, retried: Boolean(retried), status: retried?.status || row.status });
    }
    const retried = outcomes.filter((outcome) => outcome.retried).length;
    await logActivity({ userId: auth.user?.id, type: "queued", entityType: "media_processing", entityId: `bulk:${Date.now()}`, title: "Media reprocessing queued", message: `${retried}/${rows.length} failed media operation${rows.length === 1 ? "" : "s"} requeued through the durable worker pool`, metadata: { requested: rows.length, retried } });
    await deps.logSecurityEvent?.({ event: "media_processing.reprocess", actorUserId: auth.user?.id || null, result: retried === rows.length ? "SUCCESS" : "FAILURE", reasonCode: "ADMIN_MEDIA_REPROCESS", request, metadata: { requested: rows.length, retried } });
    return { ok: retried === rows.length, requested: rows.length, retried, outcomes };
  });

  app.get("/api/admin/media-processing/workers", async (request, reply) => {
    const auth = await requireStudioAdmin(request, reply); if (!auth) return;
    const query = z.object({ q: z.string().trim().max(120).default(""), state: z.enum(["all", "online", "offline", "active", "drain", "maintenance"]).default("all"), page: z.coerce.number().int().min(1).max(100).default(1), limit: z.coerce.number().int().min(5).max(100).default(25) }).parse(request.query || {});
    const cutoff = new Date(Date.now() - 35_000);
    const rows = await prisma.mediaWorkerHeartbeat.findMany({ orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], take: 500 });
    const filtered = rows.filter((worker: any) => {
      const online = worker.lastSeenAt >= cutoff && worker.status !== "offline";
      const stateMatch = query.state === "all" || (query.state === "online" && online) || (query.state === "offline" && !online) || worker.desiredState === query.state;
      const haystack = `${worker.hostname || ""} ${worker.status || ""} ${worker.desiredState || ""} ${worker.selectedAcceleration || ""}`.toLowerCase();
      return stateMatch && (!query.q || haystack.includes(query.q.toLowerCase()));
    });
    const start = (query.page - 1) * query.limit;
    const page = filtered.slice(start, start + query.limit).map((worker: any) => ({ id: worker.id, hostname: worker.hostname, online: worker.lastSeenAt >= cutoff && worker.status !== "offline", status: worker.lastSeenAt >= cutoff ? worker.status : "offline", desiredState: worker.desiredState, concurrency: worker.concurrency, activeJobs: worker.activeJobs, selectedAcceleration: worker.selectedAcceleration, lastError: worker.lastError, lastSeenAt: worker.lastSeenAt }));
    return { ok: true, page: query.page, limit: query.limit, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / query.limit)), workers: page };
  });

  app.patch("/api/admin/media-processing/workers/:workerId", async (request, reply) => {
    const auth = await requireStudioAdmin(request, reply); if (!auth) return;
    const params = z.object({ workerId: z.string().min(1).max(200) }).parse(request.params);
    const body = z.object({ desiredState: z.enum(["active", "drain", "maintenance"]) }).parse(request.body || {});
    const worker = await prisma.mediaWorkerHeartbeat.findUnique({ where: { id: params.workerId } });
    if (!worker) return reply.code(404).send({ code: "MEDIA_WORKER_NOT_FOUND", message: "Media worker not found." });
    const updated = await prisma.mediaWorkerHeartbeat.update({ where: { id: worker.id }, data: { desiredState: body.desiredState } });
    await logActivity({ userId: auth.user?.id, type: "updated", entityType: "media_worker", entityId: worker.id, title: "Media worker directive updated", message: `${worker.hostname}: ${body.desiredState}`, metadata: { desiredState: body.desiredState } });
    await deps.logSecurityEvent?.({ event: "media_worker.directive", actorUserId: auth.user?.id || null, result: "SUCCESS", reasonCode: "ADMIN_MEDIA_WORKER_DIRECTIVE", request, metadata: { workerId: worker.id, desiredState: body.desiredState } });
    return { ok: true, id: updated.id, desiredState: updated.desiredState };
  });

  app.put("/api/admin/media-processing/policies/:projectType/:medium/:assetRole", async (request, reply) => {
    const auth = await requireStudioAdmin(request, reply); if (!auth) return;
    const params = z.object({ projectType: z.string().trim().min(1).max(80), medium: z.enum(REVIEW_MEDIA), assetRole: z.enum(["source", "proxy", "review", "master", "reference"]) }).parse(request.params);
    const body = z.object({ enabled: z.boolean().default(true), jobs: z.array(z.enum(ASSET_PROCESSING_JOBS)).max(12), accelerationPreference: z.enum(["auto", "software", "nvenc", "qsv", "videotoolbox"]).default("auto"), retentionDays: z.number().int().min(1).max(3650).nullable().optional() }).parse(request.body || {});
    const key = { projectType: params.projectType.toLowerCase(), medium: params.medium, assetRole: params.assetRole };
    const policy = await prisma.mediaProcessingPolicy.upsert({ where: { projectType_medium_assetRole: key }, update: { enabled: body.enabled, jobs: JSON.stringify(body.jobs), accelerationPreference: normalizeAccelerationPreference(body.accelerationPreference), retentionDays: body.retentionDays ?? null }, create: { ...key, enabled: body.enabled, jobs: JSON.stringify(body.jobs), accelerationPreference: normalizeAccelerationPreference(body.accelerationPreference), retentionDays: body.retentionDays ?? null } });
    await logActivity({ userId: auth.user?.id, type: "updated", entityType: "media_processing_policy", entityId: policy.id, title: "Media ingestion policy updated", message: `${policy.projectType}/${policy.medium}/${policy.assetRole}`, metadata: { medium: policy.medium, jobs: body.jobs, accelerationPreference: body.accelerationPreference } });
    return { ...policy, jobs: parseArray(policy.jobs) };
  });
}
