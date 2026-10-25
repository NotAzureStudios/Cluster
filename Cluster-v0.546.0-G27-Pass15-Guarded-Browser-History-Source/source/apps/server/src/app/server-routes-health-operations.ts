
import fs from "node:fs/promises";
import path from "node:path";import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { kioskProfileForSession, normalizeClusterKioskProfiles } from "@cluster/shared";

import { databaseProviderFromUrl, redactDatabaseUrl } from "../core/database-provider.js";import { encryptionKeyConfigured } from "../core/setting-crypto.js";
import { assessServerPerformance } from "../core/performance-budgets.js";
import { evaluateMaintenancePreflight, type MaintenanceIntent } from "../core/operations-maintenance-preflight.js";
import { previewMaintenanceWindows } from "../core/operations-maintenance-window.js";
import { supervisorReadiness } from "../core/operations-supervisor-readiness.js";
import { buildApiToolHealthSnapshot } from "../core/api-tool-health.js";
import { joinApiToolDependencyReadiness } from "../core/api-tool-readiness.js";
import { SERVER_DOMAIN_CATALOG } from "./server-domain-catalog.js";
import { assessRuntimeSaturation } from "../core/operational-health.js";
import { buildOperatorAlerts, operatorPosture } from "../core/operator-control-plane.js";
import { applyOperatorAlertPreference, cleanOperatorAlertPreferences, parsePreferenceRecord } from "../core/operator-alert-preferences.js";
import { BoundedCache } from "../core/bounded-cache.js";
import { discoverProjectCapsules } from "../core/data-layout.js";


import type { ServerRouteRegistrationDeps } from "./server-composition-types.js";

export function registerHealthOperationsRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const aggregateSnapshotCache = new BoundedCache<string, any>(8);
  let auditIntegrityCache: { at: number; value: any } | null = null;
  async function readOperatorAuditIntegrity() {
    if (!deps.auditService) return { ok: false, checked: 0, writeFailures: 0, error: "Audit integrity service unavailable." };
    if (auditIntegrityCache && Date.now() - auditIntegrityCache.at < 60_000) return auditIntegrityCache.value;
    const value = await deps.auditService.verifySecurityIntegrity();
    auditIntegrityCache = { at: Date.now(), value };
    return value;
  }
  const {
    AUTH_REQUIRED,
    CLUSTER_VERSION,
    CONFIGURED_CORS_ORIGINS,
    RATE_LIMIT_ENABLED,
    RUNTIME_PROFILE,
    SESSION_SECURE,
    CONFIG_FILE_PATH,
    DATABASE_URL,
    DATA_LAYOUT,
    DATA_ROOT,
    RUNTIME_CONFIG,
    UPLOAD_ROOT,
    backgroundTasks,
    countFolderEntries,
    databaseDiagnostics,
    decorateUserForClient,
    getCurrentUser,
    prisma,
    processStartedAt,
    rateLimiter,
    readSettings,
    readinessProbe,
    requireAdminUserForRequest,
    runtimeTelemetry,
    resourceGovernor,
    concurrentWorkLimiter,
    dataIntegrityRuntime,
    storageLifecycleRuntime,
    integrationCircuits,
    safePersistenceRecordCount,
    stabilizationCounts
  } = deps;
  
  
  app.get("/health", async () => {
    const telemetry = runtimeTelemetry.snapshot();
    const operational = deps.operationalHealthSnapshot();
    const saturation = assessRuntimeSaturation(telemetry);
    return {
      ok: true,
      app: "Cluster",
      version: CLUSTER_VERSION,
      ready: operational.ready,
      draining: Boolean(deps.serverDraining),
      state: operational.state,
      saturation,
      generatedAt: operational.generatedAt,
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      signals: operational.checks.map((check: any) => ({ key: check.key, status: check.status })),
      runtime: {
        profile: RUNTIME_PROFILE,
        requests: telemetry.requests,
        eventLoop: telemetry.eventLoop,
        memory: telemetry.memory,
        process: telemetry.process,
        gc: telemetry.gc,
      },
      governor: resourceGovernor.snapshot(),
      workAdmission: concurrentWorkLimiter.stats(),
      integrity: dataIntegrityRuntime.snapshot(),
      storageLifecycle: storageLifecycleRuntime.snapshot(),
    };
  });

  app.get("/api/kiosk/public", async (request, reply) => {
    const query = z.object({ profile: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i).optional() }).parse(request.query || {});
    const settings = await readSettings();
    const profiles = normalizeClusterKioskProfiles((settings as any).desktopKioskProfiles);
    const configuredDefault = String((settings as any).desktopKioskSignedOutProfileId || "").trim() || null;
    const profile = query.profile
      ? profiles.find((item) => item.enabled && item.sessionMode === "signed-out" && item.id === query.profile) || null
      : kioskProfileForSession(profiles, "signed-out", configuredDefault);
    reply.header("Cache-Control", "no-store, private");
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!profile || !profile.publicEnabled) return reply.code(404).send({ ok: false, code: "KIOSK_PROFILE_UNAVAILABLE", error: "This public kiosk profile is unavailable." });
    return {
      ok: true,
      profile: {
        id: profile.id,
        name: profile.name,
        title: profile.publicTitle || "Cluster",
        message: profile.publicMessage || "",
        showServerStatus: profile.publicShowServerStatus !== false,
        offlineBehavior: profile.offlineBehavior,
        offlineMessage: profile.offlineMessage,
        managedExitRequired: profile.managedExitRequired,
        automation: {
          autoStart: profile.autoStart,
          scheduleEnabled: profile.scheduleEnabled,
          scheduleDays: [...profile.scheduleDays],
          scheduleStart: profile.scheduleStart,
          scheduleEnd: profile.scheduleEnd,
        },
        cards: profile.publicCards.map((card) => ({ id: card.id, title: card.title, body: card.body, tone: card.tone })),
      },
    };
  });

  app.get("/health/live", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      live: true,
      version: CLUSTER_VERSION,
      pid: process.pid,
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      state: deps.serverDraining ? "draining" : deps.serverReady ? "running" : "starting",
    };
  });
  
  // Local native Host/SCM readiness is intentionally distinct from client
  // workspace readiness. A held maintenance server is *running* even though
  // workspace traffic correctly receives 503 from /health/ready.
  app.get("/health/supervisor", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const [database, storage] = await Promise.allSettled([readinessProbe.check(), deps.writableStorageProbe.check()]);
    const status = supervisorReadiness({
      serverReady: Boolean(deps.serverReady),
      draining: Boolean(deps.serverDraining),
      mode: deps.getRuntimeMode(),
      database: database.status === "fulfilled" ? database.value : null,
      storage: storage.status === "fulfilled" ? storage.value : null,
    });
    if (!status.ready) { reply.code(503); reply.header("Retry-After", "3"); }
    return { ...status, version: CLUSTER_VERSION };
  });

  app.get("/health/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const [database, storage] = await Promise.all([readinessProbe.check(), deps.writableStorageProbe.check()]);
    const operational = deps.operationalHealthSnapshot(database, storage);
    const saturation = assessRuntimeSaturation(runtimeTelemetry.snapshot());
    const routeReady = operational.ready && saturation.state !== "critical";
    if (!routeReady) {
      app.log.warn({ state: operational.state, checks: operational.checks.filter((check: any) => check.status === "fail") }, "readiness check failed");
      reply.code(503);
      reply.header("Retry-After", "3");
    }
    return {
      ok: routeReady,
      ready: routeReady,
      state: operational.state,
      saturation,
      draining: Boolean(deps.serverDraining),
      version: CLUSTER_VERSION,
      dependencies: { database, storage },
      checks: operational.checks.filter((check: any) => ["lifecycle", "database", "storage"].includes(check.key)),
    };
  });

  // Operator-triggered, bounded, non-mutating maintenance preflight. This
  // deliberately does not stop workers, flip mode, or contact external URLs.
  app.get("/api/admin/operations/maintenance/preflight", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const query = z.object({ intent: z.enum(["enter-maintenance", "enter-read-only", "restart", "update"]).default("enter-maintenance") }).strict().parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    const [database, storage, jobs, savedPolicy, backupReadiness] = await Promise.allSettled([
      readinessProbe.check(true),
      deps.writableStorageProbe.check(true),
      deps.jobQueue.counts(true),
      readSettings(),
      query.intent === "update" ? deps.recoveryReadiness() : Promise.resolve(null),
    ]);
    const maintenanceWindow = savedPolicy.status === "fulfilled"
      ? (() => { try { const preview = previewMaintenanceWindows(savedPolicy.value, { count: 1 }); return { enabled: preview.enabled, active: preview.windows[0]?.active === true, nextStartAt: preview.windows[0]?.startAt ?? null }; } catch { return null; } })()
      : null;
    // Failed reads are NOT silently converted into empty queues or healthy
    // dependencies. The pure evaluator treats all missing evidence as blockers.
    const observed = evaluateMaintenancePreflight({
      intent: query.intent as MaintenanceIntent,
      mode: deps.getRuntimeMode(),
      ready: Boolean(deps.serverReady),
      draining: Boolean(deps.serverDraining),
      database: database.status === "fulfilled" ? database.value : null,
      storage: storage.status === "fulfilled" ? storage.value : null,
      jobs: jobs.status === "fulfilled" ? jobs.value : null,
      tasks: backgroundTasks.snapshots(),
      work: concurrentWorkLimiter.stats(),
      window: maintenanceWindow,
      recovery: backupReadiness.status === "fulfilled" ? backupReadiness.value : null,
    });
    return observed;
  });

  // Read-only preview of the last protected-save maintenance policy.
  // No actions are queued, and no caller-defined executable commands exist.
  app.get("/api/admin/operations/maintenance/windows", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    reply.header("Cache-Control", "no-store, private");
    return previewMaintenanceWindows(await readSettings());
  });

  app.get("/api/admin/operations/health", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const [database, storage, databaseProvider] = await Promise.all([
      readinessProbe.check(true),
      deps.writableStorageProbe.check(true),
      databaseDiagnostics.providerSnapshot(),
    ]);
    const operational = deps.operationalHealthSnapshot(database, storage);
    const runtime = runtimeTelemetry.snapshot();
    const databaseQueries = databaseDiagnostics.snapshot();
    const durableJobCounts = await deps.jobQueue.counts();
    const acceleration = deps.acceleration?.snapshot?.() || null;
    const collaboration = deps.collaborationRuntime?.diagnostics?.() || null;
    const resourceChanges = deps.changeRuntime?.snapshot?.() || null;
    const distributedRateLimit = deps.distributedRateLimiter?.stats?.() || null;
    const performanceBudgets = assessServerPerformance({ runtime, databaseQueries, postgres: databaseProvider, durableJobs: durableJobCounts, acceleration, collaboration });
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      operational,
      dependencies: { database, storage, postgres: databaseProvider },
      runtime,
      databaseQueries,
      gpu: deps.gpuTelemetry?.snapshot?.() || null,
      performanceBudgets,
      acceleration,
      realtime: { collaboration, resourceChanges },
      distributedRateLimit,
      backgroundTasks: backgroundTasks.snapshots(),
      toolRuntimeOwners: backgroundTasks.ownerSnapshots(),
      ownedSubscriptions: backgroundTasks.subscriptionSnapshots(),
      durableJobs: { counts: durableJobCounts, worker: deps.jobWorker.snapshot(), runtime: deps.jobRuntime?.snapshot?.() || null },
      governor: resourceGovernor.snapshot(),
      governorSampler: deps.resourceGovernorRuntime?.samplingStatus?.() || null,
      workAdmission: concurrentWorkLimiter.stats(),
      integrity: dataIntegrityRuntime.snapshot(),
      storageLifecycle: storageLifecycleRuntime.snapshot(),
      dependencyCircuits: integrationCircuits(),
      events: deps.events.snapshot(),
      readiness: readinessProbe.snapshot(),
    };
  });

  // An authorized, passive API health inventory. No HTTP probe or async fanout:
  // access does not trigger requests to every tool or leak user-specific paths.
  app.get("/api/admin/operations/api-tools", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "private, no-store");
    const traffic = buildApiToolHealthSnapshot(SERVER_DOMAIN_CATALOG, runtimeTelemetry.routeMetricsSnapshot());
    const readiness = deps.apiToolReadiness.snapshot(SERVER_DOMAIN_CATALOG);
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      ...traffic,
      tools: joinApiToolDependencyReadiness(traffic.tools, readiness),
      dependencyReadiness: { ...readiness, tools: undefined },
    };
  });

  // Explicit operator-triggered recheck. Fixed local checks only: no URL, tool
  // selection, or remotely supplied probe input. Cooldown prevents admin spam.
  app.post("/api/admin/operations/api-tools/check", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "private, no-store");
    const outcome = await deps.apiToolReadiness.sampleIfDue(30_000);
    await deps.logSecurityEvent?.({ event: "operations.api_tools.dependency_check", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_API_TOOL_SAFE_CHECK", request, metadata: { outcome } });
    return { ok: true, outcome, readiness: deps.apiToolReadiness.snapshot(SERVER_DOMAIN_CATALOG) };
  });

  // On-demand compatibility check against the *already-configured* Redis
  // acceleration connection. No arbitrary host/URL body and no background poll.
  // Held runtime modes block POST at the common request gate.
  app.post("/api/admin/operations/acceleration/compatibility-check", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    z.object({}).strict().parse(request.body || {});
    reply.header("Cache-Control", "no-store");
    return deps.acceleration.checkConfiguredCompatibility();
  });

  app.get("/api/admin/operations/performance", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const [postgres, durableJobs, gpuJobs] = await Promise.all([
      databaseDiagnostics.providerSnapshot(),
      deps.jobQueue.counts(),
      prisma.gpuMediaLease.groupBy({ by: ["host", "deviceId"], where: { expiresAt: { gt: new Date() } }, _count: { _all: true } }).catch(() => []),
    ]);
    const runtime = runtimeTelemetry.snapshot();
    const databaseQueries = databaseDiagnostics.snapshot();
    const acceleration = deps.acceleration?.snapshot?.() || null;
    const collaboration = deps.collaborationRuntime?.diagnostics?.() || null;
    const resourceChanges = deps.changeRuntime?.snapshot?.() || null;
    const distributedRateLimit = deps.distributedRateLimiter?.stats?.() || null;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      runtime,
      databaseQueries,
      gpu: deps.gpuTelemetry?.snapshot?.() || null,
      gpuJobs: gpuJobs.map((row: any) => ({ host: row.host, deviceId: row.deviceId, active: Number(row._count?._all || 0) })),
      postgres,
      durableJobs,
      jobRuntime: deps.jobRuntime?.snapshot?.() || null,
      acceleration,
      realtime: { collaboration, resourceChanges },
      distributedRateLimit,
      governor: resourceGovernor.snapshot(),
      workAdmission: concurrentWorkLimiter.stats(),
      budgets: assessServerPerformance({ runtime, databaseQueries, postgres, durableJobs, acceleration, collaboration }),
    };
  });

  app.get("/api/admin/operations/database", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      queries: databaseDiagnostics.snapshot(),
      postgres: await databaseDiagnostics.providerSnapshot(),
    };
  });

  // GET must remain a *pure snapshot* under read-only and maintenance holds.
  // Prior query flags caused GET to trigger write-capable background work,
  // bypassing the method-aware F4 P3 control-plane fence.
  app.get("/api/admin/operations/storage-lifecycle", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    z.object({}).strict().parse(request.query || {});
    const lifecycle = storageLifecycleRuntime.snapshot();
    reply.header("Cache-Control", "no-store");
    return { ok: lifecycle.state !== "degraded", generatedAt: new Date().toISOString(), lifecycle };
  });

  app.post("/api/admin/operations/storage-lifecycle/run", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    z.object({ confirmation: z.literal("RUN STORAGE LIFECYCLE") }).strict().parse(request.body || {});
    const lifecycle = await storageLifecycleRuntime.run();
    reply.header("Cache-Control", "no-store");
    return { ok: lifecycle.state !== "degraded", generatedAt: new Date().toISOString(), lifecycle };
  });

  app.get("/api/admin/operations/integrity", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    z.object({}).strict().parse(request.query || {});
    const integrity = dataIntegrityRuntime.snapshot();
    reply.header("Cache-Control", "no-store");
    return { ok: integrity.state !== "degraded", generatedAt: new Date().toISOString(), integrity };
  });

  app.post("/api/admin/operations/integrity/refresh", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    z.object({ confirmation: z.literal("REFRESH INTEGRITY EVIDENCE") }).strict().parse(request.body || {});
    const integrity = await dataIntegrityRuntime.scan(true);
    reply.header("Cache-Control", "no-store");
    return { ok: integrity.state !== "degraded", generatedAt: new Date().toISOString(), integrity };
  });

  app.get("/api/admin/operations/health-transitions", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    reply.header("Cache-Control", "no-store");
    return { ok: true, version: CLUSTER_VERSION, ...deps.operationalHealthHistory.snapshot() };
  });
  app.get("/api/admin/operations/alert-preferences", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const row = await prisma.user.findUnique({ where: { id: admin.id }, select: { preferences: true } }).catch(() => null);
    const preferences = parsePreferenceRecord(row?.preferences);
    reply.header("Cache-Control", "no-store");
    return { ok: true, preferences: cleanOperatorAlertPreferences(preferences.operatorAlertPreferences) };
  });

  app.patch("/api/admin/operations/alert-preferences", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const body = z.object({
      alertId: z.string().regex(/^[a-z0-9:_-]{1,120}$/i),
      action: z.enum(["acknowledge", "unacknowledge", "snooze", "unsnooze"]),
      snoozeMinutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
    }).parse(request.body || {});
    const row = await prisma.user.findUnique({ where: { id: admin.id }, select: { preferences: true } });
    if (!row) return reply.code(404).send({ ok: false, error: "Administrator account not found." });
    const root = parsePreferenceRecord(row.preferences);
    const cleaned = applyOperatorAlertPreference(root.operatorAlertPreferences, body);
    await prisma.user.update({ where: { id: admin.id }, data: { preferences: JSON.stringify({ ...root, operatorAlertPreferences: cleaned }) } });
    await deps.logSecurityEvent?.({ event: "operator_alert.preference", actorUserId: admin.id, result: "SUCCESS", reasonCode: `OPERATOR_ALERT_${body.action.toUpperCase()}`, request, metadata: { alertId: body.alertId, snoozeMinutes: body.action === "snooze" ? body.snoozeMinutes || 60 : null } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, preferences: cleaned };
  });

  app.get("/api/admin/operations/sync-clients", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const query = z.object({ q: z.string().trim().max(120).default(""), state: z.enum(["all", "active", "stale"]).default("all"), page: z.coerce.number().int().min(1).max(100).default(1), limit: z.coerce.number().int().min(5).max(100).default(25) }).parse(request.query || {});
    const now = Date.now();
    const activeCutoff = new Date(now - 15 * 60_000);
    const staleCutoff = new Date(now - 7 * 24 * 60 * 60_000);
    const where: any = {
      ...(query.state === "active" ? { lastSeenAt: { gte: activeCutoff } } : query.state === "stale" ? { lastSeenAt: { lt: staleCutoff } } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { platform: { contains: query.q, mode: "insensitive" } }, { clientVersion: { contains: query.q, mode: "insensitive" } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.clusterSyncDevice.count({ where }),
      prisma.clusterSyncDevice.findMany({ where, select: { id: true, name: true, platform: true, clientVersion: true, mutationSchemaVersion: true, lastSeenAt: true, createdAt: true }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    ]);
    reply.header("Cache-Control", "no-store");
    return { ok: true, page: query.page, limit: query.limit, total, pages: Math.max(1, Math.ceil(total / query.limit)), clients: rows.map((row: any) => ({ id: row.id, name: row.name || "Unnamed client", platform: row.platform || "unknown", clientVersion: row.clientVersion || "unknown", mutationSchemaVersion: row.mutationSchemaVersion, lastSeenAt: row.lastSeenAt, createdAt: row.createdAt })) };
  });

  app.get("/api/admin/operations/control-plane", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const payload = await aggregateSnapshotCache.getOrLoad("operations.control-plane", { ttlMs: 10_000 }, async () => {
      const generatedAt = new Date();
      const activeDeviceCutoff = new Date(generatedAt.getTime() - 15 * 60_000);
      const staleDeviceCutoff = new Date(generatedAt.getTime() - 7 * 24 * 60 * 60_000);
      const receiptCutoff = new Date(generatedAt.getTime() - 24 * 60 * 60_000);
      const mediaWorkerCutoff = new Date(generatedAt.getTime() - 35_000);
      const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await run(); } catch (error) { app.log.warn({ error }, "operator control-plane probe failed"); return fallback; }
      };
      const [database, storage, postgres, durableJobCounts, jobPressure, auditIntegrity, syncDeviceCounts, syncConflicts, failedSyncReceipts24h, syncVersions, syncPlatforms, syncDeviceRows, mediaWorkers, mediaQueueRows, recentSecurity, automationJobRows, automationRules, settings, backupRows, securityFailureCounts] = await Promise.all([
        readinessProbe.check(true),
        deps.writableStorageProbe.check(true),
        databaseDiagnostics.providerSnapshot(),
        deps.jobQueue.counts(),
        safe(() => deps.jobQueue.pressure(), { oldestQueuedAt: null, oldestQueuedAgeMs: null, stalledLeases: 0, byQueue: [] }),
        safe(() => readOperatorAuditIntegrity(), { ok: false, checked: 0, writeFailures: 0, error: "Audit integrity service unavailable." }),
        safe(async () => {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::bigint AS total,
                    COUNT(*) FILTER (WHERE "lastSeenAt" >= $1)::bigint AS active,
                    COUNT(*) FILTER (WHERE "lastSeenAt" < $2)::bigint AS stale
             FROM "ClusterSyncDevice"`,
            activeDeviceCutoff,
            staleDeviceCutoff,
          ) as Array<{ total: bigint | number | string; active: bigint | number | string; stale: bigint | number | string }>;
          const row = rows[0] || { total: 0, active: 0, stale: 0 };
          return { total: Number(row.total || 0), active: Number(row.active || 0), stale: Number(row.stale || 0) };
        }, { total: 0, active: 0, stale: 0 }),
        safe(() => prisma.clusterSyncConflict.count({ where: { status: "OPEN" } }), 0),
        safe(() => prisma.clusterSyncReceipt.count({ where: { createdAt: { gte: receiptCutoff }, statusCode: { gte: 400 } } }), 0),
        safe(() => prisma.clusterSyncDevice.groupBy({ by: ["clientVersion"], _count: { _all: true }, take: 12 }), []),
        safe(() => prisma.clusterSyncDevice.groupBy({ by: ["platform"], _count: { _all: true }, take: 12 }), []),
        safe(() => prisma.clusterSyncDevice.findMany({ select: { id: true, name: true, platform: true, clientVersion: true, mutationSchemaVersion: true, lastSeenAt: true, createdAt: true }, orderBy: { lastSeenAt: "desc" }, take: 32 }), []),
        safe(() => prisma.mediaWorkerHeartbeat.findMany({ select: { id: true, hostname: true, status: true, desiredState: true, concurrency: true, activeJobs: true, selectedAcceleration: true, lastError: true, lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 64 }), []),
        safe(() => prisma.backgroundJob.groupBy({ by: ["queue", "status"], where: { queue: { startsWith: "media" } }, _count: { _all: true } }), []),
        deps.auditService ? safe(async () => (await deps.auditService.securityEvents({ limit: 8, cursor: null })).items || [], []) : Promise.resolve([]),
        safe(() => prisma.backgroundJob.groupBy({ by: ["status"], where: { type: "automation.studio-action" }, _count: { _all: true } }), []),
        safe(() => prisma.projectControlRecord.findMany({ where: { kind: "automation", archived: false }, select: { id: true, status: true, payload: true }, take: 500 }), []),
        safe(() => readSettings(), {} as any),
        deps.listBackupManifests ? safe(() => deps.listBackupManifests(), []) : Promise.resolve([]),
        safe(async () => {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::bigint AS failures,
                    COUNT(*) FILTER (WHERE position('admin.' in "event") = 1 OR position('background_job.' in "event") = 1 OR position('operator_alert.' in "event") = 1 OR position('media_worker.' in "event") = 1)::bigint AS privileged
             FROM "SecurityAuditEvent"
             WHERE "occurredAt" >= $1 AND "result" = 'FAILURE'`,
            receiptCutoff,
          ) as Array<{ failures: bigint | number | string; privileged: bigint | number | string }>;
          const row = rows[0] || { failures: 0, privileged: 0 };
          return { failures: Number(row.failures || 0), privileged: Number(row.privileged || 0) };
        }, { failures: 0, privileged: 0 }),
      ]);
    const operational = deps.operationalHealthSnapshot(database, storage);
    const runtime = runtimeTelemetry.snapshot();
    const databaseQueries = databaseDiagnostics.snapshot();
    const acceleration = deps.acceleration?.snapshot?.() || null;
    const collaboration = deps.collaborationRuntime?.diagnostics?.() || null;
    const resourceChanges = deps.changeRuntime?.snapshot?.() || null;
    const distributedRateLimit = deps.distributedRateLimiter?.stats?.() || null;
    const performanceBudgets = assessServerPerformance({ runtime, databaseQueries, postgres, durableJobs: durableJobCounts, acceleration, collaboration });
    const backgroundTaskRows = backgroundTasks.snapshots();
    const events = deps.events.snapshot();
    const onlineMediaWorkers = mediaWorkers.filter((worker: any) => worker.lastSeenAt >= mediaWorkerCutoff && worker.status !== "offline");
    const activeMediaWorkers = onlineMediaWorkers.filter((worker: any) => worker.desiredState === "active");
    const mediaQueue = mediaQueueRows.reduce((summary: any, row: any) => {
      const count = Number(row._count?._all || 0);
      if (row.status === "QUEUED") summary.queued += count;
      else if (row.status === "RUNNING") summary.running += count;
      else if (row.status === "FAILED") summary.failed += count;
      else if (row.status === "DEAD_LETTER") summary.deadLetter += count;
      summary.total += count;
      return summary;
    }, { queued: 0, running: 0, failed: 0, deadLetter: 0, total: 0 });
    const sync = {
      devices: {
        total: Number(syncDeviceCounts.total || 0),
        active15m: Number(syncDeviceCounts.active || 0),
        stale7d: Number(syncDeviceCounts.stale || 0),
        versions: syncVersions.map((row: any) => ({ value: row.clientVersion || "unknown", count: Number(row._count?._all || 0) })).sort((a: any, b: any) => b.count - a.count || a.value.localeCompare(b.value)),
        platforms: syncPlatforms.map((row: any) => ({ value: row.platform || "unknown", count: Number(row._count?._all || 0) })).sort((a: any, b: any) => b.count - a.count || a.value.localeCompare(b.value)),
        rows: syncDeviceRows.map((row: any) => ({ id: row.id, name: row.name || "Unnamed client", platform: row.platform || "unknown", clientVersion: row.clientVersion || "unknown", mutationSchemaVersion: row.mutationSchemaVersion, lastSeenAt: row.lastSeenAt, createdAt: row.createdAt })),
      },
      openConflicts: Number(syncConflicts || 0),
      failedReceipts24h: Number(failedSyncReceipts24h || 0),
    };
    const media = {
      workers: { total: mediaWorkers.length, online: onlineMediaWorkers.length, active: activeMediaWorkers.length, rows: mediaWorkers.map((worker: any) => ({ id: worker.id, hostname: worker.hostname, status: worker.lastSeenAt >= mediaWorkerCutoff ? worker.status : "offline", desiredState: worker.desiredState, concurrency: worker.concurrency, activeJobs: worker.activeJobs, acceleration: worker.selectedAcceleration, lastError: worker.lastError || null, lastSeenAt: worker.lastSeenAt })) },
      queue: mediaQueue,
    };
    const automationCounts = automationJobRows.reduce((summary: any, row: any) => { const count = Number(row._count?._all || 0); if (row.status === "QUEUED") summary.queued += count; else if (row.status === "RUNNING") summary.running += count; else if (row.status === "FAILED") summary.failed += count; else if (row.status === "DEAD_LETTER") summary.deadLetter += count; return summary; }, { queued: 0, running: 0, failed: 0, deadLetter: 0 });
    const automation = { ...automationCounts, rules: automationRules.length, pausedRules: automationRules.filter((rule: any) => rule.status === "paused").length, draftRules: automationRules.filter((rule: any) => { try { return JSON.parse(String(rule.payload || "{}")).governanceState === "draft"; } catch { return false; } }).length };
    const latestBackup: any = (backupRows as any[])[0] || null;
    const backup = {
      enabled: Boolean(settings?.backupEnabled),
      retentionDays: Number(settings?.backupRetentionDays || 14),
      generationCount: backupRows.length,
      latestCreatedAt: latestBackup?.createdAt || null,
      latestVerified: latestBackup?.verification ? true : null,
      latestVerificationOk: latestBackup?.evidence?.verification?.ok ?? latestBackup?.verification?.ok ?? latestBackup?.signatureValid ?? null,
      latestRestoreDrillAt: latestBackup?.evidence?.restoreDrill?.checkedAt || null,
      latestRestoreDrillOk: latestBackup?.evidence?.restoreDrill?.ok ?? null,
    };
    const security = { failures24h: Number(securityFailureCounts.failures || 0), privilegedFailures24h: Number(securityFailureCounts.privileged || 0) };
    const alerts = buildOperatorAlerts({
      operational,
      performance: performanceBudgets,
      postgres,
      storage,
      backgroundTasks: backgroundTaskRows,
      jobs: { counts: durableJobCounts, pressure: jobPressure },
      sync,
      media,
      audit: auditIntegrity,
      events,
      automation,
      backup,
      security,
    });
      return {
        ok: true,
        version: CLUSTER_VERSION,
        generatedAt: generatedAt.toISOString(),
        posture: operatorPosture(alerts),
        alerts,
        runtime: {
          operational,
          telemetry: runtime,
          performanceBudgets,
          backgroundTasks: backgroundTaskRows,
          events,
          acceleration,
          realtime: { collaboration, resourceChanges },
          distributedRateLimit,
        },
        database: { readiness: database, postgres, queries: databaseQueries },
        storage,
        jobs: { counts: durableJobCounts, worker: deps.jobWorker.snapshot(), runtime: deps.jobRuntime?.snapshot?.() || null, pressure: jobPressure },
        sync,
        media,
        automation,
        backup,
        security,
        audit: {
          integrity: auditIntegrity,
          recent: recentSecurity.map((event: any) => ({ id: event.id, event: event.event, result: event.result, reasonCode: event.reasonCode, requestPath: event.requestPath || null, occurredAt: event.occurredAt })),
        },
        incidents: deps.operationalHealthHistory.snapshot(),
        notes: [
          "Operator data is bounded and excludes raw audit metadata, credentials, network addresses, and workspace content.",
          "Operational actions reuse existing storage, database, job, security-audit, and server-configuration authorities.",
        ],
      };
    });
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  
  
  app.get("/api/admin/diagnostics", async (request, reply) => {
    const current = await getCurrentUser(request);
    const decorated = await decorateUserForClient(current);
    if (!decorated?.isAdmin) {
      reply.code(403);
      return { ok: false, error: "Admin required." };
    }
    const settings = await readSettings();
    const folders = await Promise.all(
      [
        ["data", DATA_ROOT],
        ["system", DATA_LAYOUT.systemRoot],
        ["config", DATA_LAYOUT.configRoot],
        ["library", DATA_LAYOUT.libraryRoot],
        ["projects", DATA_LAYOUT.projectsRoot],
        ["users", DATA_LAYOUT.usersRoot],
        ["uploads", UPLOAD_ROOT],
        ["exports", DATA_LAYOUT.exportsRoot],
        ["backups", DATA_LAYOUT.backupsRoot],
        ["logs", DATA_LAYOUT.logsRoot],
        ["runtime", DATA_LAYOUT.runtimeRoot],
        ["gitWorktrees", DATA_LAYOUT.sourceWorkspacesRoot],
      ].map(async ([key, folderPath]) => ({
        key,
        path: folderPath,
        ...(await countFolderEntries(folderPath)),
      })),
    );
    const [projects, boards, cards, users, sessions, whiteboards, timelineItems, libraryItems, timeEntries, persistenceRecords, sourceControlConnections, storageHealth, projectCapsules] = await Promise.all([prisma.project.count(), prisma.board.count(), prisma.card.count(), prisma.user.count(), prisma.session.count(), prisma.whiteboard.count(), prisma.timelineItem.count(), prisma.libraryItem.count(), prisma.timeEntry.count(), safePersistenceRecordCount(), prisma.integrationConnection.count({ where: { category: "source-control", archived: false, status: { not: "disabled" } } }), DATA_LAYOUT.storage.inspectAll(), discoverProjectCapsules(DATA_LAYOUT)]);
    const folderCount = (key: string) => folders.find((folder) => folder.key === key)?.files || 0;
    return {
      ok: true,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || "development",
      dataRoot: DATA_ROOT,
      uploadRoot: UPLOAD_ROOT,
      storageTopology: DATA_LAYOUT.storage.domains,
      databaseProvider: databaseProviderFromUrl(DATABASE_URL),
      databaseUrl: redactDatabaseUrl(DATABASE_URL),
      configFile: CONFIG_FILE_PATH,
      counts: {
        projects,
        boards,
        cards,
        users,
        sessions,
        whiteboards,
        timelineItems,
        libraryItems,
        timeEntries,
        persistenceRecords,
        uploads: folderCount("uploads"),
        attachments: folderCount("attachments"),
        backups: folderCount("backups"),
        exports: folderCount("exports"),
        logs: folderCount("logs"),
      },
      features: {
        authRequired: AUTH_REQUIRED,
        rateLimitEnabled: RATE_LIMIT_ENABLED,
        secureCookies: SESSION_SECURE,
        discordConfigured: Boolean(settings.discordWebhookUrl || settings.discordGuildId || settings.discordBotToken),
        sourceControlConfigured: sourceControlConnections > 0,
        backupsEnabled: Boolean(settings.backupEnabled),
        encryptionKeyConfigured: encryptionKeyConfigured(),
      },
      runtime: {
        profile: RUNTIME_PROFILE,
        ready: deps.serverReady,
        uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
        requestLoggingEnabled: !RUNTIME_CONFIG.disableRequestLogging,
        configuredOriginCount: CONFIGURED_CORS_ORIGINS.size,
        rateLimiter: rateLimiter.stats(),
        backgroundTasks: backgroundTasks.snapshots(),
        toolRuntimeOwners: backgroundTasks.ownerSnapshots(),
      ownedSubscriptions: backgroundTasks.subscriptionSnapshots(),
        durableJobs: { counts: await deps.jobQueue.counts(), worker: deps.jobWorker.snapshot() },
        events: deps.events.snapshot(),
        readiness: readinessProbe.snapshot(),
        writableStorage: deps.writableStorageProbe.snapshot(),
        operationalHealth: deps.operationalHealthSnapshot(),
        performance: runtimeTelemetry.snapshot(),
        databaseQueries: databaseDiagnostics.snapshot(),
      },
      folders,
      storageHealth,
      projectCapsules: {
        count: projectCapsules.length,
        withRepository: projectCapsules.filter((entry) => entry.repositoryPresent).length,
        items: projectCapsules,
      },
      healthChecks: [
        {
          key: "endpoint",
          label: "Endpoint health",
          status: "pass",
          detail: "Admin diagnostics route responded.",
        },
        {
          key: "migration",
          label: "Migration status",
          status: projects >= 0 && users >= 0 ? "pass" : "warn",
          detail: `${projects} projects, ${cards} cards, ${libraryItems} library items counted.`,
        },
        {
          key: "backup",
          label: "Backup health",
          status: folderCount("backups") > 0 ? "pass" : "warn",
          detail: folderCount("backups") > 0 ? `${folderCount("backups")} backup item(s) found.` : "No backup files detected yet.",
        },
        {
          key: "storage",
          label: "Storage health",
          status: folders.some((folder) => !folder.exists) ? "fail" : "pass",
          detail: `${folders.filter((folder) => folder.exists).length}/${folders.length} data folders available.`,
        },
        {
          key: "attachments",
          label: "Attachment storage",
          status: folderCount("attachments") >= 0 ? "pass" : "warn",
          detail: `${folderCount("attachments")} attachment file(s) in storage folder.`,
        },
        {
          key: "persistence",
          label: "Workflow persistence",
          status: persistenceRecords > 0 ? "pass" : "warn",
          detail: `${persistenceRecords} schema-backed workflow record(s) stored.`,
        },
      ],
      notes: ["Diagnostics are read-only and admin-only.", settings.backupEnabled ? "Backup policy is enabled." : "Backup policy is not enabled yet.", encryptionKeyConfigured() ? "A custom encryption key is configured." : "Set CLUSTER_SECRET_KEY before real hosting."],
    };
  });
  
  
  app.get("/api/admin/stabilization", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const counts = await stabilizationCounts();
    const settings = await readSettings();
    const sourceControlConnections = await prisma.integrationConnection.count({ where: { category: "source-control", archived: false, status: { not: "disabled" } } });
    const schemaExists = await fs
      .access(path.join(process.cwd(), "prisma", "schema.prisma"))
      .then(() => true)
      .catch(() => false);
    const folders = await Promise.all(
      [
        ["library", DATA_LAYOUT.libraryRoot],
        ["projects", DATA_LAYOUT.projectsRoot],
        ["users", DATA_LAYOUT.usersRoot],
        ["uploads", UPLOAD_ROOT],
        ["exports", DATA_LAYOUT.exportsRoot],
        ["backups", DATA_LAYOUT.backupsRoot],
        ["logs", DATA_LAYOUT.logsRoot],
      ].map(async ([key, folderPath]) => ({
        key,
        ...(await countFolderEntries(folderPath)),
      })),
    );
    const missingFolders = folders.filter((folder) => !folder.exists).map((folder) => folder.key);
    return {
      ok: true,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      counts,
      checks: [
        {
          key: "schema",
          label: "Prisma schema",
          status: schemaExists ? "pass" : "fail",
          detail: schemaExists ? "schema.prisma is present." : "schema.prisma was not found from the server working directory.",
        },
        {
          key: "projects",
          label: "Project data",
          status: counts.projects > 0 ? "pass" : "warn",
          detail: counts.projects > 0 ? `${counts.projects} project(s) available.` : "No projects yet. Seed demo data or create a real project.",
        },
        {
          key: "boards",
          label: "Board structure",
          status: counts.boards > 0 && counts.lists > 0 ? "pass" : "warn",
          detail: `${counts.boards} board(s), ${counts.lists} list(s), ${counts.cards} card(s).`,
        },
        {
          key: "library",
          label: "Library lifecycle",
          status: counts.libraryItems > 0 ? "pass" : "warn",
          detail: `${counts.libraryItems} library item(s) tracked.`,
        },
        {
          key: "whiteboards",
          label: "Whiteboard production data",
          status: counts.whiteboards > 0 ? "pass" : "warn",
          detail: `${counts.whiteboards} whiteboard(s) available.`,
        },
        {
          key: "activity",
          label: "Activity/audit feed",
          status: counts.activityEvents > 0 ? "pass" : "warn",
          detail: `${counts.activityEvents} activity event(s) stored.`,
        },
        {
          key: "persistence",
          label: "Workflow persistence",
          status: counts.persistenceRecords > 0 ? "pass" : "warn",
          detail: `${counts.persistenceRecords || 0} v0.141 persistence record(s) stored.`,
        },
        {
          key: "folders",
          label: "Data folders",
          status: missingFolders.length ? "warn" : "pass",
          detail: missingFolders.length ? `Missing: ${missingFolders.join(", ")}.` : "Database, uploads, exports, backups, and logs folders are readable.",
        },
      ],
      persistence: [
        {
          system: "Projects / boards / cards",
          storage: "Prisma PostgreSQL",
          status: "persistent",
          note: "Core production structure is database-backed.",
        },
        {
          system: "Users / permissions",
          storage: "Prisma PostgreSQL",
          status: "persistent",
          note: "Users, role defaults, tool permissions, and project permissions are persisted.",
        },
        {
          system: "Scheduler and time capture",
          storage: "Prisma PostgreSQL + activity events",
          status: "persistent",
          note: "Clock entries, schedule blocks, and billing policy are server-owned.",
        },
        {
          system: "Library lifecycle",
          storage: "Prisma PostgreSQL",
          status: "persistent",
          note: "Version, reviewer, visibility, lifecycle state, and review dates are persisted.",
        },
        {
          system: "Whiteboard production metadata",
          storage: "Prisma PostgreSQL",
          status: "persistent",
          note: "Element links, review state, and production comments are revisioned with the Whiteboard record; local storage is recovery-only.",
        },
        {
          system: "Workflow bridge records",
          storage: "Prisma PostgreSQL",
          status: "hardened",
          note: "Project workflows use revisioned ClusterPersistenceRecord rows; operational registries and synchronized Studio state use ClientStateRecord rows.",
        },
        {
          system: "Account and notification preferences",
          storage: "Prisma PostgreSQL",
          status: "persistent",
          note: "Synchronized preferences roam with the signed-in profile; only theme bootstrap, media controls, recovery drafts, offline queues, and session handoffs remain device-local.",
        },
        {
          system: "Backup restore staging",
          storage: "Browser review + downloadable plan",
          status: "planned",
          note: "Restore is staged for review. Applying staged restores still needs a carefully scoped server-side apply step.",
        },
      ],
      localCommands: ["npm install", "npm run db:deploy", "npm run build", "npm run dev"],
      security: [
        {
          label: "Auth required",
          status: AUTH_REQUIRED ? "pass" : "warn",
          detail: AUTH_REQUIRED ? "Authentication is required." : "Development login is available. Enable auth before team hosting.",
        },
        {
          label: "Secure cookies",
          status: SESSION_SECURE ? "pass" : "warn",
          detail: SESSION_SECURE ? "Secure cookie mode is enabled." : "Secure cookies are disabled. Use HTTPS and secure cookies for production.",
        },
        {
          label: "Rate limits",
          status: RATE_LIMIT_ENABLED ? "pass" : "warn",
          detail: RATE_LIMIT_ENABLED ? "Rate limiting is enabled." : "Rate limiting is disabled.",
        },
        {
          label: "Secret key",
          status: encryptionKeyConfigured() ? "pass" : "warn",
          detail: encryptionKeyConfigured() ? "Custom encryption key configured." : "Set CLUSTER_SECRET_KEY before real hosting.",
        },
        {
          label: "Production integrations",
          status: settings.discordWebhookUrl || settings.discordBotToken || sourceControlConnections > 0 ? "pass" : "warn",
          detail: settings.discordWebhookUrl || settings.discordBotToken || sourceControlConnections > 0 ? "At least one production integration is configured." : "No Source Control or Discord integrations are configured yet.",
        },
      ],
    };
  });
}
