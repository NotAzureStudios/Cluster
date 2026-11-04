
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { type FastifyInstance } from "fastify";

import { z } from "zod";
import { validateClusterBundleAssignments, validateClusterProjectBundlePolicies, validateClusterBundleRevisionChanges, validateClusterPermissionBundles, clusterKioskProfilesSchema, clusterProjectTypeDefinitionSchema } from "@cluster/shared";
import { safeUrl, validateCorsOrigins } from "../core/security.js";
import { databaseProviderFromUrl } from "../core/database-provider.js";
import { packetsSettingsSchemaShape } from "../core/packets-settings.js";
import { profileFieldDefinitionsSchema } from "../domains/users/people-profile-contract.js";
import { revokedStudioRoleIds } from "../domains/users/people-role-governance.js";
import { BOOT_SECRET_SETTING_KEYS, encryptionKeyConfigured, encryptionKeyId, previousEncryptionKeyIds, SENSITIVE_SETTING_KEYS } from "../core/setting-crypto.js";
import { OperationCancelledError, withRequestCancellation } from "../core/operation-cancellation.js";
import { createClusterStorageManager } from "../core/storage/storage-manager.js";
import { checkServerConfigPreconditions } from "../core/server-config-preconditions.js";
import { readNetworkDeploymentStatus } from "../core/server-network-deployment.js";
import { diagnoseLocalNetworkPorts } from "../core/server-network-local-diagnostics.js";
import { NETWORK_REVIEW_KEYS, reviewBoundDomainPortDrift, reviewNetworkChange } from "../core/server-network-change-review.js";

import type { SettingPayload, ServerRouteRegistrationDeps } from "./server-composition-types.js";


function validIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

const backupTimezoneSchema = z.string().trim().min(1).max(100).refine(validIanaTimeZone, "Backup timezone must be a valid IANA timezone, such as America/New_York.");

function backupOperationFailure(reply: any, error: unknown, fallback: string) {
  if (error instanceof OperationCancelledError || (error as any)?.code === "OPERATION_CANCELLED") {
    return reply.code(499).send({ ok: false, code: "OPERATION_CANCELLED", error: error instanceof Error ? error.message : "Operation cancelled.", retryable: true });
  }
  return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : fallback });
}

export function registerConfigurationIntegrationRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    ALLOW_EXECUTABLE_UPLOADS,
    API_RATE_LIMIT_MAX,
    API_RATE_LIMIT_WINDOW_MS,
    AUTH_RATE_LIMIT_MAX,
    AUTH_REQUIRED,
    AVATAR_UPLOAD_LIMIT_BYTES,
    BACKUP_VERIFY_AFTER_CREATE,
    CLUSTER_VERSION,
    CONFIGURED_CORS_ORIGINS,
    DEV_LOGIN_ENABLED,
    RATE_LIMIT_ENABLED,
    REQUEST_TIMEOUT_MS,
    REQUIRE_DISCORD_LINK,
    REQUIRE_MUTATION_ORIGIN,
    RUNTIME_PROFILE,
    SECURITY_HEADERS_ENABLED,
    SESSION_IDLE_HOURS,
    SESSION_MAX_PER_USER,
    SESSION_SECURE,
    UPLOAD_LIMIT_BYTES,
    CONFIG_FILE_PATH,
    DATA_ROOT,
    MASKED_SECRET,
    RUNTIME_CONFIG,

    backgroundTasks,
    backupIsDue,
    backupWindowKey,
    collaborationRuntime,
    createPreUpgradeCheckpoint,
    createServerBackup,
    deleteBackupGeneration,
    decorateUserForClient,
    getCurrentUser,
    hasToolPermission,
    listBackupManifests,
    logActivity,
    prisma,
    processStartedAt,
    pruneOperationalRecords,
    rateLimiter,
    readBackupManifest,
    recoveryReadiness,
    runServerRestoreDrill,
    readQualityGateStatus,
    readSettings,
    requireAdminUserForRequest,
    requireConfirmation,
    saveSettings,
    patchSettings,
    settingsForClient,
    studioSettingsForClient,
    stripServerManagedSettings,
    verifyBackupManifest,
    verifyUserPin,
    securityTelemetry,
    auditService
  } = deps;
  
  app.post("/api/admin/backups/now", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    try {
      return await withRequestCancellation(request, reply, (signal) => createServerBackup("manual", signal));
    } catch (error) {
      if (error instanceof OperationCancelledError || (error as any)?.code === "OPERATION_CANCELLED") {
        return reply.code(499).send({ ok: false, code: "OPERATION_CANCELLED", error: error instanceof Error ? error.message : "Backup cancelled.", retryable: true });
      }
      return { ok: false, error: error instanceof Error ? error.message : "Backup failed." };
    }
  });
  
  app.get("/api/admin/backups/schedule", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const settings = await readSettings();
    return {
      ok: true,
      enabled: Boolean(settings.backupEnabled),
      frequency: settings.backupFrequency || "daily",
      scheduleDate: settings.backupScheduleDate || null,
      scheduleTime: settings.backupScheduleTime || "03:00",
      scheduleDays: settings.backupScheduleDaysCsv || "",
      timezone: settings.backupTimezone || "server local time",
      dueNow: backupIsDue(settings),
      windowKey: backupWindowKey(settings),
    };
  });
  
  app.get("/api/admin/backups", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    return { ok: true, backups: await listBackupManifests() };
  });

  app.get("/api/admin/backups/recovery-readiness", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    return recoveryReadiness();
  });

  app.post("/api/admin/backups/pre-upgrade-checkpoint", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "CREATE PRE-UPGRADE CHECKPOINT")) return;
    try {
      const checkpoint: any = await withRequestCancellation(request, reply, (signal) => createPreUpgradeCheckpoint(signal));
      await logActivity({ userId: admin.id, type: "backup", entityType: "backup", entityId: checkpoint.fileName, title: "Pre-upgrade recovery checkpoint created", message: "Backup generation passed verification and isolated restore drill before upgrade." });
      return checkpoint;
    } catch (error) {
      return backupOperationFailure(reply, error, "Pre-upgrade checkpoint failed.");
    }
  });
  
  app.post("/api/admin/backups/:fileName/verify", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const params = z.object({ fileName: z.string().min(1).max(240) }).parse(request.params);
    try {
      const verification: any = await withRequestCancellation(request, reply, (signal) => verifyBackupManifest(params.fileName, signal));
      // Verification is reported separately. Signed v2 manifests are immutable recovery evidence;
      // rewriting them during inspection would invalidate or silently re-author the backup generation.
      await logActivity({
        userId: admin.id,
        type: "backup",
        entityType: "backup",
        entityId: params.fileName,
        title: "Backup verified",
        message: verification.ok ? "Database, uploads, branding, checksums, and manifest integrity passed" : "Backup verification found problems",
      });
      return verification;
    } catch (error) {
      return backupOperationFailure(reply, error, "Backup verification failed.");
    }
  });
  
  app.post("/api/admin/backups/:fileName/restore-drill", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "RUN RESTORE DRILL")) return;
    const params = z.object({ fileName: z.string().min(1).max(240) }).parse(request.params);
    try {
      const drill: any = await withRequestCancellation(request, reply, (signal) => runServerRestoreDrill(params.fileName, signal));
      await logActivity({
        userId: admin.id,
        type: "backup",
        entityType: "backup",
        entityId: params.fileName,
        title: "Restore drill completed",
        message: drill.ok ? "Database restore and filesystem extraction drill passed" : "Restore drill detected recovery mismatches",
      });
      return drill;
    } catch (error) {
      return backupOperationFailure(reply, error, "Restore drill failed.");
    }
  });
  
  app.delete("/api/admin/backups/:fileName", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "DELETE BACKUP")) return;
    const params = z.object({ fileName: z.string().min(1).max(240) }).parse(request.params);
    try {
      await deleteBackupGeneration(params.fileName);
      await logActivity({
        userId: admin.id,
        type: "backup",
        entityType: "backup",
        entityId: params.fileName,
        title: "Backup deleted",
        message: params.fileName,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Backup deletion failed.",
      });
    }
  });
  
  app.post("/api/admin/maintenance/prune", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "PRUNE AUDIT DATA")) return;
    z.object({}).parse(request.body || {});
    const result = await pruneOperationalRecords();
    await logActivity({
      userId: admin.id,
      type: "maintenance",
      entityType: "audit",
      title: "Operational history pruned",
      message: `${result.activityEvents + result.persistenceAuditLogs} audit row(s) removed`,
    });
    return { ok: true, ...result };
  });
  
  app.get("/api/server-config", async () => {
    const settings = await readSettings();
    return settingsForClient(settings);
  });
  
  // The offline deployment plan contains encrypted boot settings; expose only
  // sanitized state, never the snapshots, hashes or restore bytes.
  app.get("/api/server-config/network/deployment", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")) {
      return reply.code(403).send({ ok: false, code: "SERVER_CONFIG_MANAGE_REQUIRED" });
    }
    try { return { ok: true, ...(await readNetworkDeploymentStatus(CONFIG_FILE_PATH)) }; }
    catch { return reply.code(503).send({ ok: false, code: "NETWORK_DEPLOYMENT_RECOVERY_REQUIRED", error: "The native network deployment record needs operator inspection." }); }
  });

  // On-demand, admin-only local TCP checks. Never accept arbitrary addresses,
  // user-supplied port ranges or external destinations from the request.
  app.get("/api/server-config/network/local-diagnostics", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")) {
      return reply.code(403).send({ ok: false, code: "SERVER_CONFIG_MANAGE_REQUIRED" });
    }
    try {
      const current = await readSettings(true);
      return { ok: true, ...(await diagnoseLocalNetworkPorts(current as Record<string, unknown>)) };
    } catch {
      return reply.code(503).send({ ok: false, code: "NETWORK_LOCAL_DIAGNOSTICS_UNAVAILABLE",
        error: "Local port diagnostics could not read the current server configuration." });
    }
  });

  // Explicit request only: no background port-scans, no firewall mutations, no
  // URL-based network fetches. Server-side save repeats the same validation.
  app.post("/api/server-config/network/preview", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")) {
      return reply.code(403).send({ ok: false, code: "SERVER_CONFIG_MANAGE_REQUIRED" });
    }
    const parsed = z.object({
      changes: z.object({
        serverHost: z.string().max(255).optional(), serverPort: z.number().optional(),
        webHost: z.string().max(255).optional(), webPort: z.number().optional(),
        allowInsecureLanHttp: z.boolean().optional(),
        webTlsCertFile: z.string().max(2048).optional(), webTlsKeyFile: z.string().max(2048).optional(),
        publicApiUrl: z.string().max(2048).optional(), publicWebUrl: z.string().max(2048).optional(),
        corsOrigins: z.string().max(4000).optional(), trustedProxy: z.boolean().optional(),
        sessionSecure: z.boolean().optional(), lanDiscoveryEnabled: z.boolean().optional(),
      }).strict(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, code: "INVALID_NETWORK_PREVIEW" });
    const settings = await readSettings(true);
    const baseline = Object.fromEntries(NETWORK_REVIEW_KEYS.map(key => [key, settings[key]]));
    const draft = { ...baseline, ...parsed.data.changes };
    const review = reviewNetworkChange(baseline, draft);
    // The profile comparison is local-instance only, bounded, and strictly
    // informational. It cannot assert that a proxy is installed or reachable.
    let boundDomainProfiles: { checked: number; mismatches: { id: string; webPortMismatch: boolean; apiPortMismatch: boolean }[]; truncated: boolean } | null = null;
    const serverId = String(settings.serverInstanceId || "").toLowerCase();
    if (serverId) {
      const profiles = await prisma.studioManagedDomain.findMany({
        where: { bindingServerInstanceId: serverId, verificationState: "verified" },
        select: { id: true, connectionWebPort: true, connectionApiPort: true }, take: 26,
      });
      const drift = reviewBoundDomainPortDrift(profiles.slice(0, 25), draft);
      boundDomainProfiles = { ...drift, truncated: profiles.length > 25 };
      if (drift.mismatches.length) review.warnings.push({ code: "DOMAIN_PROFILE_PORT_DRIFT", field: "domains",
        message: `${drift.mismatches.length} bound domain profile(s) expect different listener ports. Update their plans before restarting.` });
      if (profiles.length > 25) review.warnings.push({ code: "DOMAIN_PROFILE_REVIEW_INCOMPLETE", field: "domains",
        message: "More than 25 domains are bound to this server; review the remaining profiles individually before deploying." });
    }
    return { ...review, boundDomainProfiles, checkedAt: new Date().toISOString() };
  });

  // A restart is a separate, PIN-authorized action. The API commits no
  // arbitrary commands and never terminates its own process. The independent
  // Windows supervisor claims this one-shot private request, verifies the
  // on-disk configuration fingerprint, drains owned children, then relaunches.
  app.post("/api/server-config/restart", async (request, reply) => {
    const operator = await getCurrentUser(request);
    const decorated = await decorateUserForClient(operator);
    if (!operator || (!decorated?.isAdmin && !hasToolPermission(operator, decorated?.workspaceRole, "serverConfig", "manage"))) {
      return reply.code(403).send({ ok: false, code: "SERVER_RESTART_FORBIDDEN", error: "Server Configuration manage permission is required." });
    }
    const parsed = z.object({
      securityPin: z.string().min(1),
      confirmation: z.literal("RESTART CLUSTER SERVER"),
    }).strict().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, code: "SERVER_RESTART_CONFIRMATION_REQUIRED", error: "Explicit confirmation and Security PIN are required for a server restart." });
    }
    await verifyUserPin(operator, parsed.data.securityPin, "apply_server_configuration", request);
    if (process.platform !== "win32") {
      return reply.code(409).send({ ok: false, code: "WINDOWS_SUPERVISOR_REQUIRED", error: "Web-controlled restart requires the native Windows Server supervisor." });
    }
    const dir = path.join(DATA_ROOT, "system", "runtime");
    const requestFile = path.join(dir, "cluster-restart-request.json");
    const receiptFile = path.join(dir, "cluster-restart-result.json");
    try {
      // An accepted request must not be superseded during the drain window.
      try {
        const last = JSON.parse(await fs.readFile(receiptFile, "utf8")) as {state?: string; updatedAt?: string};
        const at = Date.parse(String(last.updatedAt ?? ""));
        if (last.state === "accepted" && Number.isFinite(at) && Date.now() - at < 180_000) {
          return reply.code(409).send({ ok: false, code: "SERVER_RESTART_IN_PROGRESS", error: "A native server restart is already in progress." });
        }
      } catch (error: any) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      const config = await fs.readFile(CONFIG_FILE_PATH);
      const configSha256 = createHash("sha256").update(config).digest("hex");
      const requestId = randomUUID();
      const body = JSON.stringify({ schema: 1, action: "restart", requestId,
        createdAt: new Date().toISOString(), configSha256 });
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      // O_EXCL protects against duplicate restart submissions. Credentials
      // and PINs never enter this file, and no user-supplied path is accepted.
      const handle = await fs.open(requestFile, "wx", 0o600);
      try { await handle.writeFile(body, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      return reply.code(202).send({ ok: true, code: "SERVER_RESTART_ACCEPTED", requestId,
        message: "Native supervisor restart requested. This session may disconnect while Cluster drains and restarts." });
    } catch (error: any) {
      if (error?.code === "EEXIST") {
        return reply.code(409).send({ ok: false, code: "SERVER_RESTART_PENDING", error: "A restart request is already pending native supervision." });
      }
      return reply.code(503).send({ ok: false, code: "SERVER_RESTART_UNAVAILABLE",
        error: "Unable to publish the restart request to the local Windows supervisor. The configuration remains saved; restart using the native Server Manager." });
    }
  });

  app.get("/api/server-config/restart/status", async (request, reply) => {
    const operator = await getCurrentUser(request);
    const decorated = await decorateUserForClient(operator);
    if (!operator || (!decorated?.isAdmin && !hasToolPermission(operator, decorated?.workspaceRole, "serverConfig", "manage"))) {
      return reply.code(403).send({ ok: false, code: "SERVER_RESTART_FORBIDDEN" });
    }
    const dir = path.join(DATA_ROOT, "system", "runtime");
    try {
      const bytes = await fs.readFile(path.join(dir, "cluster-restart-result.json"), "utf8");
      const receipt = z.object({ schema: z.literal(1), requestId: z.string().uuid(),
        state: z.enum(["accepted", "ready", "failed"]), updatedAt: z.string() }).parse(JSON.parse(bytes));
      return { ok: true, ...receipt };
    } catch {
      return { ok: true, state: "none" };
    }
  });

  app.put("/api/server-config", async (request, reply) => {
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")) {
      return reply.code(403).send({ ok: false, error: "Server Configuration manage permission is required." });
    }
    const body = z
      .object({
        appDisplayName: z.string().optional(),
        serverDisplayName: z.string().trim().min(1).max(120).optional(),
        lanDiscoveryEnabled: z.boolean().optional(),
        studioName: z.string().optional(),
        organizationLogoUrl: z.string().optional(),
        workspaceName: z.string().optional(),
        interfaceDensity: z.string().optional(),
        sidebarStyle: z.string().optional(),
        fontFamily: z.string().optional(),
        accentColor: z.string().optional(),
        secondaryAccentColor: z.string().optional(),
        dangerColor: z.string().optional(),
        cornerRadius: z.number().optional(),
        glassStrength: z.number().optional(),
        backgroundStyle: z.string().optional(),
        cardStyle: z.string().optional(),
        motionLevel: z.string().optional(),
        securityPin: z.string().optional(),
        tagPresetCsv: z.string().optional(),
        defaultCardPriority: z.string().optional(),
        defaultCardLabels: z.string().optional(),
        notifyCardCreated: z.boolean().optional(),
        notifyCardMoved: z.boolean().optional(),
        notifyCardCompleted: z.boolean().optional(),
        notifyGitEvents: z.boolean().optional(),
        notifyWhiteboardUpdates: z.boolean().optional(),
        notifyUpcomingEvents: z.boolean().optional(),
        notifyDueDates: z.boolean().optional(),
        notificationLookaheadDays: z.number().optional(),
        whiteboardAutosaveSeconds: z.number().optional(),
        whiteboardDefaultWidth: z.number().optional(),
        whiteboardDefaultHeight: z.number().optional(),
        serverHost: z.string().optional(),
        serverPort: z.number().int().min(1).max(65535).optional(),
        webHost: z.string().optional(),
        webPort: z.number().int().min(1).max(65535).optional(),
        allowInsecureLanHttp: z.boolean().optional(),
        webTlsCertFile: z.string().max(2048).optional(), webTlsKeyFile: z.string().max(2048).optional(),
        publicApiUrl: z.string().optional(),
        publicWebUrl: z.string().optional(),
        corsOrigins: z.string().optional(),
        requestBodyLimitMb: z.number().min(1).optional(),
        uploadLimitMb: z.number().min(1).optional(),
        requestTimeoutSeconds: z.number().min(1).optional(),
        authRequired: z.boolean().optional(),
        devLoginEnabled: z.boolean().optional(),
        requireDiscordLink: z.boolean().optional(),
        sessionDays: z.number().min(1).optional(),
        sessionSecure: z.boolean().optional(),
        rateLimitEnabled: z.boolean().optional(),
        rateLimitMax: z.number().min(1).optional(),
        rateLimitWindowMinutes: z.number().min(1).optional(),
        authRateLimitMax: z.number().int().min(3).max(1000).optional(),
        sessionIdleHours: z.number().min(1).max(8760).optional(),
        sessionMaxPerUser: z.number().int().min(1).max(100).optional(),
        securityHeadersEnabled: z.boolean().optional(),
        requireMutationOrigin: z.boolean().optional(),
        avatarUploadLimitMb: z.number().min(1).max(25).optional(),
        allowExecutableUploads: z.boolean().optional(),
        allowedUploadMimeCsv: z.string().max(4000).optional(),
        backupVerifyAfterCreate: z.boolean().optional(),
        operationsReadinessIntervalMinutes: z.number().int().min(2).max(15).optional(),
        operationsEscalationIntervalMinutes: z.number().int().min(2).max(5).optional(),
        operationsNativeReconcileIntervalMinutes: z.number().int().min(2).max(5).optional(),
        operationsIntegrityScanHours: z.number().int().min(1).max(24).optional(),
        maintenanceWindowEnabled: z.boolean().optional(),
        maintenanceWindowTimezone: z.string().min(1).max(64).refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return /^[A-Za-z0-9_+\-/]+$/.test(value); } catch { return false; } }, "Invalid IANA timezone").optional(),
        maintenanceWindowDaysCsv: z.string().min(3).max(64).regex(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:\s*,\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat))*$/, "Use comma-separated weekday abbreviations").refine((value) => { const days = value.split(",").map(s => s.trim()); return new Set(days).size === days.length; }, "Duplicate weekdays are not allowed").optional(),
        maintenanceWindowStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
        maintenanceWindowDurationMinutes: z.number().int().min(15).max(240).optional(),
        logLevel: z.string().optional(),
        enableRequestLogs: z.boolean().optional(),
        autoSeed: z.boolean().optional(),
        backupEnabled: z.boolean().optional(),
        backupRetentionDays: z.number().min(1).optional(),
        backupScheduleDate: z.string().optional(),
        backupScheduleTime: z.string().optional(),
        backupFrequency: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).optional(),
        backupScheduleDaysCsv: z.string().optional(),
        backupScheduleRule: z.string().optional(),
        backupTimezone: backupTimezoneSchema.optional(),
        trustedProxy: z.boolean().optional(),
        dataRootOverride: z.string().optional(),
        projectsRootOverride: z.string().optional(),
        libraryRootOverride: z.string().optional(),
        usersRootOverride: z.string().optional(),
        backupsRootOverride: z.string().optional(),
        logsRootOverride: z.string().optional(),
        runtimeRootOverride: z.string().optional(),
        exportsRootOverride: z.string().optional(),
        brandingRootOverride: z.string().optional(),
        uploadRootOverride: z.string().optional(),
        configFileOverride: z.string().optional(),
        databaseUrlOverride: z.string().optional(),
        accelerationMode: z.enum(["auto", "memory", "redis-required"]).optional(),
        redisUrlOverride: z.string().optional(),
        redisKeyPrefix: z.string().max(80).optional(),
        defaultProjectTypeId: z.string().min(1).max(64).optional(),
        defaultProjectStatus: z.string().optional(),
        defaultProjectSource: z.string().optional(),
        defaultProjectVisibility: z.string().optional(),
        defaultCreateStarterBoard: z.boolean().optional(),
        defaultCreateStarterWhiteboard: z.boolean().optional(),
        defaultCreateStarterLibrary: z.boolean().optional(),
        defaultBuildProfileKey: z.string().optional(),
        defaultProjectBoardNameMode: z.string().optional(),
        projectTypePresets: z.array(clusterProjectTypeDefinitionSchema).max(64).optional(),
        studioEnabledProductionProfileIds: z.array(z.string().trim().min(1).max(80)).max(64).optional(),
        timelineEnabled: z.boolean().optional(),
        timelineDefaultView: z.enum(["roadmap", "calendar", "list"]).optional(),
        timelineIncludeCalendar: z.boolean().optional(),
        timelineIncludeDueDates: z.boolean().optional(),
        timelineIncludeSchedule: z.boolean().optional(),
        timelineAllowManualItems: z.boolean().optional(),
        timelineAllowComments: z.boolean().optional(),
        timelineAllowExports: z.boolean().optional(),
        timelineDefaultRangeDays: z.number().int().min(1).max(365).optional(),
        timelineMaxRangeDays: z.number().int().min(7).max(730).optional(),
        timelineMaxItemsPerPage: z.number().int().min(50).max(5000).optional(),
        ticketsEnabled: z.boolean().optional(),
        ticketsDefaultQueue: z.enum(["all", "open", "urgent", "review"]).optional(),
        ticketsRequireProject: z.boolean().optional(),
        ticketsAutoAssignCreator: z.boolean().optional(),
        ticketsAllowAttachments: z.boolean().optional(),
        ticketsAttachmentLimitMb: z.number().int().min(1).max(2048).optional(),
        ticketsRequireAssigneeOnClose: z.boolean().optional(),
        ticketsDefaultPriority: z.string().optional(),
        ticketsSlaHours: z.number().int().min(1).max(8760).optional(),
        ticketsAutoArchiveDays: z.number().int().min(0).max(3650).optional(),
        calendarEnabled: z.boolean().optional(),
        calendarDefaultView: z.enum(["agenda", "week", "month", "day"]).optional(),
        calendarWeekStartsMonday: z.boolean().optional(),
        calendarIncludeDueCards: z.boolean().optional(),
        calendarAllowRecurring: z.boolean().optional(),
        calendarConflictWarnings: z.boolean().optional(),
        calendarAllowExternalGuests: z.boolean().optional(),
        calendarDefaultDurationMinutes: z.number().int().min(5).max(1440).optional(),
        calendarMaximumDurationHours: z.number().int().min(1).max(720).optional(),
        calendarMinimumNoticeMinutes: z.number().int().min(0).max(10080).optional(),
        schedulerEnabled: z.boolean().optional(),
        schedulerDefaultView: z.enum(["week", "schedule", "team"]).optional(),
        schedulerDefaultBillable: z.boolean().optional(),
        schedulerBillableProjectIds: z.array(z.string()).max(5000).optional(),
        schedulerBillableCategories: z.array(z.string()).max(100).optional(),
        schedulerOvertimeHours: z.number().min(1).max(168).optional(),
        schedulerAutoCloseHours: z.number().min(1).max(72).optional(),
        schedulerAllowSelfEdits: z.boolean().optional(),
        schedulerAllowSelfDelete: z.boolean().optional(),
        schedulerAllowManualEntries: z.boolean().optional(),
        schedulerAllowScheduleSelfEdits: z.boolean().optional(),
        schedulerAllowScheduleSelfDelete: z.boolean().optional(),
        schedulerResourcePlanningEnabled: z.boolean().optional(),
        schedulerConflictWarnings: z.boolean().optional(),
        schedulerCalendarMirrorDefault: z.boolean().optional(),
        schedulerRequireProject: z.boolean().optional(),
        schedulerEditWindowDays: z.number().int().min(0).max(3650).optional(),
        schedulerLockAfterDays: z.number().int().min(0).max(3650).optional(),
        schedulerRoundingMinutes: z.number().int().min(1).max(60).optional(),
        schedulerMinimumBreakMinutes: z.number().int().min(0).max(240).optional(),
        studioPeopleProfileFields: profileFieldDefinitionsSchema.optional(),
        libraryEnabled: z.boolean().optional(),
        libraryDefaultLayout: z.enum(["grid", "list"]).optional(),
        libraryShowFilesInTree: z.boolean().optional(),
        libraryPreviewLimitMb: z.number().int().min(8).max(512).optional(),
        libraryMaxUploadMb: z.number().int().min(1).max(4096).optional(),
        libraryAllowExternalLinks: z.boolean().optional(),
        libraryAllowYoutube: z.boolean().optional(),
        libraryAllowModelPreviews: z.boolean().optional(),
        libraryAllowBlendPreviews: z.boolean().optional(),
        libraryModelPreviewMaxMb: z.number().int().min(8).max(4096).optional(),
        libraryThumbnailWidth: z.number().int().min(240).max(1600).optional(),
        libraryThumbnailQuality: z.number().int().min(30).max(100).optional(),
        libraryDesktopMountPolicy: z.enum(["disabled", "user-choice", "required"]).optional(),
        libraryDesktopMountIsolation: z.enum(["shared", "dedicated", "exclusive"]).optional(),
        librarySensitiveOfflineCachePolicy: z.enum(["disabled", "protected"]).optional(),
        libraryCrossServerTransferPolicy: z.enum(["allowed", "approval", "trusted-only", "disabled"]).optional(),
        libraryDesktopMountReadOnly: z.boolean().optional(),
        desktopKioskProfiles: clusterKioskProfilesSchema.optional(),
        desktopKioskSignedInProfileId: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i).optional(),
        desktopKioskSignedOutProfileId: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i).optional(),
        ...packetsSettingsSchemaShape,
        studioExternalProjectOwnerRequired: z.boolean().optional(),
        studioExternalOwnerFieldLabel: z.string().optional(),
        studioDataBackupMode: z.string().optional(),
        studioBackupStartDate: z.string().optional(),
        studioBackupTime: z.string().optional(),
        studioBackupFrequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
        studioBackupScheduleDaysCsv: z.string().optional(),
        studioBackupScheduleRule: z.string().optional(),
        studioBackupTimezone: z.string().optional(),
        expectedSettings: z.record(z.object({ exists: z.boolean(), value: z.unknown().optional() }).strict()).optional(),
      })
      .strict()
      .parse(request.body);
    const { securityPin, expectedSettings, ...requestedChanges } = body;
    if (!securityPin?.trim()) {
      return reply.code(428).send({ ok: false, code: "SERVER_CONFIG_PIN_REQUIRED", error: "A Security PIN is required for server configuration changes." });
    }
    if (!Object.keys(requestedChanges).length) {
      return reply.code(400).send({ ok: false, code: "SERVER_CONFIG_NO_CHANGES", error: "Choose at least one server configuration field to change." });
    }
    try {
      checkServerConfigPreconditions({}, requestedChanges, expectedSettings, { checkValues: false });
    } catch {
      return reply.code(428).send({ ok: false, code: "SERVER_CONFIG_PRECONDITION_REQUIRED", error: "Provide the original value of every edited server configuration field." });
    }
    if (!user) return reply.code(401).send({ ok: false, error: "Login required." });
    await verifyUserPin(user, securityPin, "apply_server_configuration", request);
    const existing = await readSettings(true);
    // Masked secret values are compared to the same safe projection the editor loaded.
    const conflicts = checkServerConfigPreconditions(settingsForClient(existing), requestedChanges, expectedSettings).conflicts;
    if (conflicts.length) {
      return reply.code(409).send({ ok: false, code: "SERVER_CONFIG_CONFLICT", error: "Server Configuration changed while you were editing. Refresh to review changes.", conflictingKeys: conflicts });
    }
    const integrationOwnedSettingKeys = ["discordWebhookUrl", "discordVoiceUrl", "discordMessagePrefix", "discordBotToken", "discordGuildId", "discordForumChannelId", "discordChatChannelId", "discordAdminRoleId", "discordApplicationId", "discordApplicationPublicKey"] as const;
    for (const key of integrationOwnedSettingKeys) delete (body as any)[key];
    const effectiveKioskProfiles = body.desktopKioskProfiles || existing.desktopKioskProfiles || [];
    const validateKioskDefault = (id: string | undefined, sessionMode: "signed-in" | "signed-out") => {
      if (!id) return;
      const profile = effectiveKioskProfiles.find((item: any) => item.id === id && item.enabled !== false && item.sessionMode === sessionMode);
      if (!profile) throw new Error(`Choose an enabled ${sessionMode} kiosk profile before saving it as the default.`);
    };
    const effectiveSignedInKioskDefault = body.desktopKioskSignedInProfileId ?? existing.desktopKioskSignedInProfileId;
    const effectiveSignedOutKioskDefault = body.desktopKioskSignedOutProfileId ?? existing.desktopKioskSignedOutProfileId;
    validateKioskDefault(effectiveSignedInKioskDefault, "signed-in");
    validateKioskDefault(effectiveSignedOutKioskDefault, "signed-out");
    if (body.organizationLogoUrl) {
      body.organizationLogoUrl = safeUrl(body.organizationLogoUrl, "Organization logo URL", ["http:", "https:"]);
    }
    if (body.publicApiUrl) {
      body.publicApiUrl = safeUrl(body.publicApiUrl, "Public API URL", ["http:", "https:"]).replace(/\/$/, "");
    }
    if (body.publicWebUrl) {
      body.publicWebUrl = safeUrl(body.publicWebUrl, "Public web URL", ["http:", "https:"]).replace(/\/$/, "");
    }
    if (body.corsOrigins !== undefined) body.corsOrigins = validateCorsOrigins(body.corsOrigins);
    if (body.databaseUrlOverride && body.databaseUrlOverride !== MASKED_SECRET) {
      try {
        databaseProviderFromUrl(body.databaseUrlOverride);
      } catch {
        // An invalid override is a bad input, not an internal server failure.
        // Never echo the value: PostgreSQL URLs may contain credentials.
        return reply.code(400).send({ ok: false, code: "INVALID_DATABASE_URL_OVERRIDE",
          field: "databaseUrlOverride",
          error: "Database URL override must be a complete postgresql:// or postgres:// connection URL. Existing database configuration was not changed." });
      }
    }
    const weakensSecurity = (AUTH_REQUIRED && body.authRequired === false) || (!DEV_LOGIN_ENABLED && body.devLoginEnabled === true) || (REQUIRE_DISCORD_LINK && body.requireDiscordLink === false) || (SESSION_SECURE && body.sessionSecure === false) || (RATE_LIMIT_ENABLED && body.rateLimitEnabled === false) || (SECURITY_HEADERS_ENABLED && body.securityHeadersEnabled === false) || (REQUIRE_MUTATION_ORIGIN && body.requireMutationOrigin === false) || (!ALLOW_EXECUTABLE_UPLOADS && body.allowExecutableUploads === true);
    const merged: SettingPayload = {
      ...existing,
      ...requestedChanges,
      appDisplayName: "Cluster",
      databaseUrlOverride: body.databaseUrlOverride === undefined || body.databaseUrlOverride === MASKED_SECRET ? existing.databaseUrlOverride : body.databaseUrlOverride,
      redisUrlOverride: body.redisUrlOverride === undefined || body.redisUrlOverride === MASKED_SECRET ? existing.redisUrlOverride : body.redisUrlOverride,
    };
    // Evaluate the COMPLETE effective settings, not only the changed fields.
    // Preview and PUT use one canonical policy; no silent bypass by skipping the UI.
    const networkEdited = NETWORK_REVIEW_KEYS.some(key => Object.prototype.hasOwnProperty.call(requestedChanges, key));
    // Offline native rollback cannot undo database-backed setting changes.
    // Separate the network restart transaction from unrelated Studio settings,
    // otherwise a failed boot would restore only half of a protected save.
    if (networkEdited && Object.keys(requestedChanges).some(key => !(NETWORK_REVIEW_KEYS as readonly string[]).includes(key))) {
      return reply.code(400).send({ ok: false, code: "NETWORK_DEPLOYMENT_EXCLUSIVE",
        error: "Save networking changes separately from other server settings. The native supervisor can only roll back a network-only publication." });
    }
    const networkReview = networkEdited ? reviewNetworkChange(existing as Record<string, unknown>, merged as Record<string, unknown>) : null;
    if (networkReview && !networkReview.ok) {
      return reply.code(400).send({ ok: false, code: "NETWORK_CONFIG_UNSAFE", blockers: networkReview.blockers,
        error: "The proposed network configuration has blocking safety issues. Review Networking & Ports before saving." });
    }
    const confirmation = networkReview?.requiresExposureConfirmation ? "CONFIRM NETWORK EXPOSURE"
      : weakensSecurity ? "APPLY INSECURE CONFIG" : null;
    if (confirmation && !requireConfirmation(request, reply, confirmation)) return;
    try {
      const pathKey = (value: string) => {
        const resolved = path.resolve(value);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
      };
      const effectiveRoot = path.resolve(String(process.env.CLUSTER_DATA_DIR || merged.dataRootOverride || DATA_ROOT));
      if (pathKey(effectiveRoot) !== pathKey(DATA_ROOT)) {
        return reply.code(409).send({ ok: false, code: "STORAGE_MOVE_REQUIRED", error: "Data Root cannot be repointed while Cluster is running. Use the verified Move Cluster Data workflow so PostgreSQL and durable files move together." });
      }
      const boot = (RUNTIME_CONFIG as any)?.bootSettings || {};
      const currentStorage = createClusterStorageManager(DATA_ROOT, {
        projects: boot.projectsRootOverride, library: boot.libraryRootOverride, users: boot.usersRootOverride, backups: boot.backupsRootOverride,
        logs: boot.logsRootOverride, runtime: boot.runtimeRootOverride, exports: boot.exportsRootOverride, uploads: boot.uploadRootOverride, branding: boot.brandingRootOverride,
      });
      const candidateStorage = createClusterStorageManager(effectiveRoot, {
        projects: merged.projectsRootOverride,
        library: merged.libraryRootOverride,
        users: merged.usersRootOverride,
        backups: merged.backupsRootOverride,
        logs: merged.logsRootOverride,
        runtime: merged.runtimeRootOverride,
        exports: merged.exportsRootOverride,
        uploads: merged.uploadRootOverride,
        branding: merged.brandingRootOverride,
      });
      for (const domain of ["projects", "library", "users", "backups", "logs", "exports", "uploads", "branding"] as const) {
        const currentPath = currentStorage.get(domain);
        const candidatePath = candidateStorage.get(domain);
        if (pathKey(currentPath) === pathKey(candidatePath)) continue;
        let entries: string[] = [];
        try {
          entries = await fs.readdir(currentPath);
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw new Error(`Cannot verify existing ${domain} storage before changing its path: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (entries.length) {
          return reply.code(409).send({ ok: false, code: "STORAGE_DOMAIN_MOVE_REQUIRED", error: `${domain} storage already contains data and cannot be repointed in-place. Move/verify that storage domain before changing its path.` });
        }
      }
    } catch (error) {
      return reply.code(400).send({ ok: false, code: "STORAGE_TOPOLOGY_INVALID", error: error instanceof Error ? error.message : "Storage topology is invalid." });
    }
    try {
      await saveSettings(merged, { changedFields: requestedChanges, expectedSettings });
    } catch (error: any) {
      if (error?.code === "NETWORK_DEPLOYMENT_PENDING") {
        return reply.code(409).send({ ok: false, code: "NETWORK_DEPLOYMENT_PENDING", error: "The staged network configuration must pass a managed Windows Service restart before another server settings save." });
      }
      if (error?.code === "SERVER_CONFIG_CONFLICT") {
        return reply.code(409).send({
          ok: false,
          code: "SERVER_CONFIG_CONFLICT",
          error: error.message,
          conflictingKeys: error.conflictingKeys || [],
        });
      }
      throw error;
    }
    return {
      ok: true,
      settingsSource: "config-file",
      configPath: CONFIG_FILE_PATH,
    };
  });
  
  app.get("/api/settings", async () => {
    const settings = await readSettings();
    return studioSettingsForClient(settings);
  });
  
  app.put("/api/settings", async (request, reply) => {
    // Studio-wide settings must never be mutable by an ordinary signed-in user.
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const body = z
      .object({
        appDisplayName: z.string().optional(),
        studioName: z.string().optional(),
        organizationLogoUrl: z.string().optional(),
        workspaceName: z.string().optional(),
        interfaceDensity: z.string().optional(),
        sidebarStyle: z.string().optional(),
        fontFamily: z.string().optional(),
        accentColor: z.string().optional(),
        secondaryAccentColor: z.string().optional(),
        dangerColor: z.string().optional(),
        cornerRadius: z.number().optional(),
        glassStrength: z.number().optional(),
        backgroundStyle: z.string().optional(),
        cardStyle: z.string().optional(),
        motionLevel: z.string().optional(),
        securityPin: z.string().optional(),
        tagPresetCsv: z.string().optional(),
        defaultCardPriority: z.string().optional(),
        defaultCardLabels: z.string().optional(),
        notifyCardCreated: z.boolean().optional(),
        notifyCardMoved: z.boolean().optional(),
        notifyCardCompleted: z.boolean().optional(),
        notifyGitEvents: z.boolean().optional(),
        notifyWhiteboardUpdates: z.boolean().optional(),
        notifyUpcomingEvents: z.boolean().optional(),
        notifyDueDates: z.boolean().optional(),
        notificationLookaheadDays: z.number().optional(),
        whiteboardAutosaveSeconds: z.number().optional(),
        whiteboardDefaultWidth: z.number().optional(),
        whiteboardDefaultHeight: z.number().optional(),
        serverHost: z.string().optional(),
        serverPort: z.number().int().min(1).max(65535).optional(),
        webHost: z.string().optional(),
        webPort: z.number().int().min(1).max(65535).optional(),
        allowInsecureLanHttp: z.boolean().optional(),
        webTlsCertFile: z.string().max(2048).optional(), webTlsKeyFile: z.string().max(2048).optional(),
        publicApiUrl: z.string().optional(),
        publicWebUrl: z.string().optional(),
        corsOrigins: z.string().optional(),
        requestBodyLimitMb: z.number().min(1).optional(),
        uploadLimitMb: z.number().min(1).optional(),
        requestTimeoutSeconds: z.number().min(1).optional(),
        authRequired: z.boolean().optional(),
        devLoginEnabled: z.boolean().optional(),
        requireDiscordLink: z.boolean().optional(),
        sessionDays: z.number().min(1).optional(),
        sessionSecure: z.boolean().optional(),
        rateLimitEnabled: z.boolean().optional(),
        rateLimitMax: z.number().min(1).optional(),
        rateLimitWindowMinutes: z.number().min(1).optional(),
        authRateLimitMax: z.number().int().min(3).max(1000).optional(),
        sessionIdleHours: z.number().min(1).max(8760).optional(),
        sessionMaxPerUser: z.number().int().min(1).max(100).optional(),
        securityHeadersEnabled: z.boolean().optional(),
        requireMutationOrigin: z.boolean().optional(),
        avatarUploadLimitMb: z.number().min(1).max(25).optional(),
        allowExecutableUploads: z.boolean().optional(),
        allowedUploadMimeCsv: z.string().max(4000).optional(),
        backupVerifyAfterCreate: z.boolean().optional(),
        operationsReadinessIntervalMinutes: z.number().int().min(2).max(15).optional(),
        operationsEscalationIntervalMinutes: z.number().int().min(2).max(5).optional(),
        operationsNativeReconcileIntervalMinutes: z.number().int().min(2).max(5).optional(),
        operationsIntegrityScanHours: z.number().int().min(1).max(24).optional(),
        maintenanceWindowEnabled: z.boolean().optional(),
        maintenanceWindowTimezone: z.string().min(1).max(64).refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return /^[A-Za-z0-9_+\-/]+$/.test(value); } catch { return false; } }, "Invalid IANA timezone").optional(),
        maintenanceWindowDaysCsv: z.string().min(3).max(64).regex(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:\s*,\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat))*$/, "Use comma-separated weekday abbreviations").refine((value) => { const days = value.split(",").map(s => s.trim()); return new Set(days).size === days.length; }, "Duplicate weekdays are not allowed").optional(),
        maintenanceWindowStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
        maintenanceWindowDurationMinutes: z.number().int().min(15).max(240).optional(),
        logLevel: z.string().optional(),
        enableRequestLogs: z.boolean().optional(),
        autoSeed: z.boolean().optional(),
        backupEnabled: z.boolean().optional(),
        backupRetentionDays: z.number().min(1).optional(),
        backupScheduleDate: z.string().optional(),
        backupScheduleTime: z.string().optional(),
        backupFrequency: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).optional(),
        backupScheduleDaysCsv: z.string().optional(),
        backupScheduleRule: z.string().optional(),
        backupTimezone: backupTimezoneSchema.optional(),
        trustedProxy: z.boolean().optional(),
        dataRootOverride: z.string().optional(),
        projectsRootOverride: z.string().optional(),
        libraryRootOverride: z.string().optional(),
        usersRootOverride: z.string().optional(),
        backupsRootOverride: z.string().optional(),
        logsRootOverride: z.string().optional(),
        runtimeRootOverride: z.string().optional(),
        exportsRootOverride: z.string().optional(),
        brandingRootOverride: z.string().optional(),
        uploadRootOverride: z.string().optional(),
        configFileOverride: z.string().optional(),
        databaseUrlOverride: z.string().optional(),
        accelerationMode: z.enum(["auto", "memory", "redis-required"]).optional(),
        redisUrlOverride: z.string().optional(),
        redisKeyPrefix: z.string().max(80).optional(),
        defaultProjectTypeId: z.string().min(1).max(64).optional(),
        defaultProjectStatus: z.string().optional(),
        defaultProjectSource: z.string().optional(),
        defaultProjectVisibility: z.string().optional(),
        defaultCreateStarterBoard: z.boolean().optional(),
        defaultCreateStarterWhiteboard: z.boolean().optional(),
        defaultCreateStarterLibrary: z.boolean().optional(),
        defaultBuildProfileKey: z.string().optional(),
        defaultProjectBoardNameMode: z.string().optional(),
        projectTypePresets: z.array(clusterProjectTypeDefinitionSchema).max(64).optional(),
        studioEnabledProductionProfileIds: z.array(z.string().trim().min(1).max(80)).max(64).optional(),
        timelineEnabled: z.boolean().optional(),
        timelineDefaultView: z.enum(["roadmap", "calendar", "list"]).optional(),
        timelineIncludeCalendar: z.boolean().optional(),
        timelineIncludeDueDates: z.boolean().optional(),
        timelineIncludeSchedule: z.boolean().optional(),
        timelineAllowManualItems: z.boolean().optional(),
        timelineAllowComments: z.boolean().optional(),
        timelineAllowExports: z.boolean().optional(),
        timelineDefaultRangeDays: z.number().int().min(1).max(365).optional(),
        timelineMaxRangeDays: z.number().int().min(7).max(730).optional(),
        timelineMaxItemsPerPage: z.number().int().min(50).max(5000).optional(),
        ticketsEnabled: z.boolean().optional(),
        ticketsDefaultQueue: z.enum(["all", "open", "urgent", "review"]).optional(),
        ticketsRequireProject: z.boolean().optional(),
        ticketsAutoAssignCreator: z.boolean().optional(),
        ticketsAllowAttachments: z.boolean().optional(),
        ticketsAttachmentLimitMb: z.number().int().min(1).max(2048).optional(),
        ticketsRequireAssigneeOnClose: z.boolean().optional(),
        ticketsDefaultPriority: z.string().optional(),
        ticketsSlaHours: z.number().int().min(1).max(8760).optional(),
        ticketsAutoArchiveDays: z.number().int().min(0).max(3650).optional(),
        calendarEnabled: z.boolean().optional(),
        calendarDefaultView: z.enum(["agenda", "week", "month", "day"]).optional(),
        calendarWeekStartsMonday: z.boolean().optional(),
        calendarIncludeDueCards: z.boolean().optional(),
        calendarAllowRecurring: z.boolean().optional(),
        calendarConflictWarnings: z.boolean().optional(),
        calendarAllowExternalGuests: z.boolean().optional(),
        calendarDefaultDurationMinutes: z.number().int().min(5).max(1440).optional(),
        calendarMaximumDurationHours: z.number().int().min(1).max(720).optional(),
        calendarMinimumNoticeMinutes: z.number().int().min(0).max(10080).optional(),
        schedulerEnabled: z.boolean().optional(),
        schedulerDefaultView: z.enum(["week", "schedule", "team"]).optional(),
        schedulerDefaultBillable: z.boolean().optional(),
        schedulerBillableProjectIds: z.array(z.string()).max(5000).optional(),
        schedulerBillableCategories: z.array(z.string()).max(100).optional(),
        schedulerOvertimeHours: z.number().min(1).max(168).optional(),
        schedulerAutoCloseHours: z.number().min(1).max(72).optional(),
        schedulerAllowSelfEdits: z.boolean().optional(),
        schedulerAllowSelfDelete: z.boolean().optional(),
        schedulerAllowManualEntries: z.boolean().optional(),
        schedulerAllowScheduleSelfEdits: z.boolean().optional(),
        schedulerAllowScheduleSelfDelete: z.boolean().optional(),
        schedulerResourcePlanningEnabled: z.boolean().optional(),
        schedulerConflictWarnings: z.boolean().optional(),
        schedulerCalendarMirrorDefault: z.boolean().optional(),
        schedulerRequireProject: z.boolean().optional(),
        schedulerEditWindowDays: z.number().int().min(0).max(3650).optional(),
        schedulerLockAfterDays: z.number().int().min(0).max(3650).optional(),
        schedulerRoundingMinutes: z.number().int().min(1).max(60).optional(),
        schedulerMinimumBreakMinutes: z.number().int().min(0).max(240).optional(),
        studioPeopleProfileFields: profileFieldDefinitionsSchema.optional(),
        libraryEnabled: z.boolean().optional(),
        libraryDefaultLayout: z.enum(["grid", "list"]).optional(),
        libraryShowFilesInTree: z.boolean().optional(),
        libraryPreviewLimitMb: z.number().int().min(8).max(512).optional(),
        libraryMaxUploadMb: z.number().int().min(1).max(4096).optional(),
        libraryAllowExternalLinks: z.boolean().optional(),
        libraryAllowYoutube: z.boolean().optional(),
        libraryAllowModelPreviews: z.boolean().optional(),
        libraryAllowBlendPreviews: z.boolean().optional(),
        libraryModelPreviewMaxMb: z.number().int().min(8).max(4096).optional(),
        libraryThumbnailWidth: z.number().int().min(240).max(1600).optional(),
        libraryThumbnailQuality: z.number().int().min(30).max(100).optional(),
        libraryDesktopMountPolicy: z.enum(["disabled", "user-choice", "required"]).optional(),
        libraryDesktopMountIsolation: z.enum(["shared", "dedicated", "exclusive"]).optional(),
        librarySensitiveOfflineCachePolicy: z.enum(["disabled", "protected"]).optional(),
        libraryCrossServerTransferPolicy: z.enum(["allowed", "approval", "trusted-only", "disabled"]).optional(),
        libraryDesktopMountReadOnly: z.boolean().optional(),
        ...packetsSettingsSchemaShape,
        studioExternalProjectOwnerRequired: z.boolean().optional(),
        studioExternalOwnerFieldLabel: z.string().optional(),
        studioDataBackupMode: z.string().optional(),
        studioBackupStartDate: z.string().optional(),
        studioBackupTime: z.string().optional(),
        studioBackupFrequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
        studioBackupScheduleDaysCsv: z.string().optional(),
        studioBackupScheduleRule: z.string().optional(),
        studioBackupTimezone: z.string().optional(),
      })
      .passthrough()
      .parse(request.body);
    if (!body.securityPin) {
      return reply.code(403).send({ ok: false, code: "SECURITY_PIN_REQUIRED", error: "Confirm your security PIN before changing Studio Settings." });
    }
    await verifyUserPin(admin, body.securityPin, "apply_studio_settings", request);
    delete (body as any).securityPin;
    if (body.organizationLogoUrl) {
      body.organizationLogoUrl = safeUrl(body.organizationLogoUrl, "Organization logo URL", ["http:", "https:"]);
    }
    if (body.publicApiUrl) {
      body.publicApiUrl = safeUrl(body.publicApiUrl, "Public API URL", ["http:", "https:"]).replace(/\/$/, "");
    }
    if (body.publicWebUrl) {
      body.publicWebUrl = safeUrl(body.publicWebUrl, "Public web URL", ["http:", "https:"]).replace(/\/$/, "");
    }
    if (body.corsOrigins !== undefined) body.corsOrigins = validateCorsOrigins(body.corsOrigins);
    if (body.databaseUrlOverride && body.databaseUrlOverride !== MASKED_SECRET) {
      try {
        databaseProviderFromUrl(body.databaseUrlOverride);
      } catch {
        return reply.code(400).send({ ok: false, code: "INVALID_DATABASE_URL_OVERRIDE",
          field: "databaseUrlOverride",
          error: "Database URL override must be a complete postgresql:// or postgres:// connection URL. Existing database configuration was not changed." });
      }
    }
    const expectedSettings = body.expectedSettings;
    delete body.expectedSettings;
    const safeBody = stripServerManagedSettings(body);
    // Studio Settings only publishes the fields this request owns. A broad
    // stale read/modify/write could overwrite another admin's configuration import.
    delete safeBody.appDisplayName;
    const changedKeys = Object.keys(safeBody).filter((key) => (safeBody as Record<string, unknown>)[key] !== undefined);
    if (!expectedSettings || Object.keys(expectedSettings).length !== changedKeys.length || changedKeys.some((key) => !Object.prototype.hasOwnProperty.call(expectedSettings, key))) {
      return reply.code(428).send({ ok: false, code: "STUDIO_SETTINGS_PRECONDITION_REQUIRED", error: "Reload Studio Settings before editing; every changed setting needs its loaded value." });
    }
    // The settings endpoint already enforces admin + PIN + optimistic concurrency.
    // Validate bundles against the current authoritative snapshot before publish;
    // reject unversioned edits and dangling role/department references.
    if (changedKeys.some((key) => ["studioPermissionBundles", "studioRoleDefinitions", "studioDepartmentDefinitions", "studioProjectBundlePolicies"].includes(key))) {
      const current = await readSettings();
      try {
        const previous = validateClusterPermissionBundles(current.studioPermissionBundles || []);
        const bundles = validateClusterPermissionBundles(safeBody.studioPermissionBundles ?? current.studioPermissionBundles ?? []);
        if (safeBody.studioPermissionBundles !== undefined) validateClusterBundleRevisionChanges(previous, bundles);
        if (safeBody.studioRoleDefinitions !== undefined) {
          const revokedIds = revokedStudioRoleIds(current, {
            ...current,
            studioRoleDefinitions: safeBody.studioRoleDefinitions,
          });
          if (revokedIds.length) {
            const assignment = await prisma.workspaceMember.findFirst({
              where: { role: { in: revokedIds } }, select: { role: true },
            });
            if (assignment) throw Object.assign(
              new Error(`Role "${assignment.role}" is assigned to users. Reassign those accounts before disabling or removing the role.`),
              { code: "ROLE_IN_USE" },
            );
          }
        }
        if (safeBody.studioDepartmentDefinitions !== undefined) {
          // Policy templates may link to one real organizational department each,
          // but cannot mint authority through a guessed or foreign workspace ID.
          const definitions = safeBody.studioDepartmentDefinitions as Array<Record<string, unknown>>;
          const links = definitions
            .filter((item) => item?.workforceDepartmentId != null)
            .map((item) => item.workforceDepartmentId);
          if (links.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)) {
            throw Object.assign(new Error("A linked Workforce Department must use an existing immutable ID."), { code: "DEPARTMENT_POLICY_LINK_INVALID" });
          }
          const ids = links as string[];
          if (new Set(ids).size !== ids.length) {
            throw Object.assign(new Error("Only one permission template may link to each Workforce Department."), { code: "DEPARTMENT_POLICY_LINK_INVALID" });
          }
          if (ids.length) {
            const membership = await prisma.workspaceMember.findFirst({
              where: { userId: admin.id }, orderBy: { workspaceId: "asc" },
              select: { workspaceId: true },
            });
            if (!membership) throw Object.assign(new Error("The administrator has no active workspace."), { code: "DEPARTMENT_POLICY_LINK_INVALID" });
            const found = await prisma.department.findMany({
              where: { id: { in: ids }, workspaceId: membership.workspaceId, archived: false },
              select: { id: true },
            });
            if (found.length !== ids.length) {
              throw Object.assign(new Error("Linked departments must be active and belong to the administrator's workspace."), { code: "DEPARTMENT_POLICY_LINK_INVALID" });
            }
          }
        }
        const projectPolicies = validateClusterProjectBundlePolicies(safeBody.studioProjectBundlePolicies ?? current.studioProjectBundlePolicies ?? [], bundles);
        if (safeBody.studioProjectBundlePolicies !== undefined && projectPolicies.length) {
          const projects = await prisma.project.findMany({ where: { id: { in: projectPolicies.map((item) => item.projectId) }, archived: false }, select: { id: true } });
          const known = new Set(projects.map((project: any) => project.id));
          if (projectPolicies.some((policy) => !known.has(policy.projectId))) throw new Error("Project policy targets must refer to active Projects.");
        }
        for (const [kind, entries] of [["Role", safeBody.studioRoleDefinitions ?? current.studioRoleDefinitions ?? []], ["Department", safeBody.studioDepartmentDefinitions ?? current.studioDepartmentDefinitions ?? []]] as const) {
          if (!Array.isArray(entries) || entries.length > 256) throw new Error(`${kind} definitions must be a bounded array.`);
          for (const entry of entries as any[]) {
            validateClusterBundleAssignments(entry?.permissionBundleIds, bundles, `${kind} ${entry?.id || "unknown"}`);
            if (kind === "Department") {
              if (entry?.iconId != null && ![
                "glyph:project", "glyph:game", "glyph:code", "glyph:video", "glyph:image", "glyph:model",
                "glyph:folder", "glyph:library", "glyph:work", "glyph:calendar", "glyph:packet", "glyph:grid",
                "glyph:check", "glyph:users", "brand:as-git", "brand:discord", "brand:steam", "brand:epic",
                "brand:unreal", "brand:blender", "brand:curseforge", "brand:minecraft",
              ].includes(entry.iconId)) throw new Error("Department icons must use an approved built-in preset.");
              if (entry?.accentColor != null && (typeof entry.accentColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(entry.accentColor))) throw new Error("Department accent must be a six-digit hex color.");
            }
          }
        }
      } catch (error) {
        if ((error as any)?.code === "DEPARTMENT_POLICY_LINK_INVALID") {
          return reply.code(400).send({ ok: false, code: "DEPARTMENT_POLICY_LINK_INVALID", error: error instanceof Error ? error.message : "Invalid department link." });
        }
        if ((error as any)?.code === "ROLE_IN_USE") {
          return reply.code(409).send({ ok: false, code: "ROLE_IN_USE", error: error instanceof Error ? error.message : "Assigned roles cannot be removed." });
        }
        return reply.code(400).send({ ok: false, code: "PERMISSION_BUNDLE_INVALID", error: error instanceof Error ? error.message : "Invalid permission bundles." });
      }
    }
    try {
      await patchSettings(safeBody, expectedSettings);
    } catch (error) {
      if ((error as any)?.code === "STUDIO_SETTINGS_CONFLICT") {
        return reply.code(409).send({
          ok: false,
          code: "STUDIO_SETTINGS_CONFLICT",
          error: "Another administrator changed these settings. Your unsaved edits were retained; reload and review the latest values before applying again.",
          conflictingKeys: (error as any).conflictingKeys,
        });
      }
      throw error;
    }
    return { ok: true };
  });
  
  app.get("/api/security/diagnostics", async (request, reply) => {
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    if (!decorated?.isAdmin && !hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")) {
      return reply.code(403).send({ ok: false, error: "Server Configuration manage permission is required." });
    }
    const settings = await readSettings();
    const [activeSessions, activityEvents, persistenceAuditLogs, securityAuditEvents, securityAuditIntegrity, backups, qualityGate] = await Promise.all([
      (prisma as any).session.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      prisma.activityEvent.count(),
      prisma.persistenceAuditLog.count(),
      auditService.securityCount(),
      auditService.verifySecurityIntegrity(),
      listBackupManifests(),
      readQualityGateStatus(),
    ]);
    const latestBackup = backups[0] || null;
    collaborationRuntime.trim();
    const collaborationDiagnostics = collaborationRuntime.diagnostics();
    return {
      ok: true,
      version: CLUSTER_VERSION,
      authRequired: AUTH_REQUIRED,
      devLoginEnabled: DEV_LOGIN_ENABLED,
      discordLinkRequired: REQUIRE_DISCORD_LINK,
      secureCookies: SESSION_SECURE,
      rateLimitEnabled: RATE_LIMIT_ENABLED,
      rateLimitMax: API_RATE_LIMIT_MAX,
      rateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS,
      authRateLimitMax: AUTH_RATE_LIMIT_MAX,
      securityHeadersEnabled: SECURITY_HEADERS_ENABLED,
      mutationOriginRequired: REQUIRE_MUTATION_ORIGIN,
      bodyLimitBytes: RUNTIME_CONFIG.bodyLimit,
      uploadLimitBytes: UPLOAD_LIMIT_BYTES,
      avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES,
      executableUploadsAllowed: Boolean(ALLOW_EXECUTABLE_UPLOADS || settings.allowExecutableUploads),
      allowedUploadMimeCsv: settings.allowedUploadMimeCsv || "image/*, video/*, audio/*, PDF, ZIP, JSON, text, binary project files",
      externalTimeoutMs: REQUEST_TIMEOUT_MS,
      sessionIdleHours: SESSION_IDLE_HOURS,
      sessionMaxPerUser: SESSION_MAX_PER_USER,
      activeSessions,
      auditRows: activityEvents + persistenceAuditLogs + securityAuditEvents,
      securityAuditRows: securityAuditEvents,
      securityAuditIntegrity,
      backupVerifyAfterCreate: settings.backupVerifyAfterCreate ?? BACKUP_VERIFY_AFTER_CREATE,
      latestBackup,
      qualityGate,
      collaboration: collaborationDiagnostics,
      runtime: {
        profile: RUNTIME_PROFILE,
        ready: deps.serverReady,
        uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
        requestLoggingEnabled: !RUNTIME_CONFIG.disableRequestLogging,
        rateLimiter: rateLimiter.stats(),
        backgroundTasks: backgroundTasks.snapshots(),
        ownedSubscriptions: backgroundTasks.subscriptionSnapshots(),
      },
      configuredOriginCount: CONFIGURED_CORS_ORIGINS.size,
      securityEvents: securityTelemetry?.snapshot?.() || null,
      adminRoleConfigured: Boolean(settings.discordGuildId && settings.discordAdminRoleId && settings.discordBotToken && settings.discordBotToken !== MASKED_SECRET),
      currentUserIsAdmin: Boolean(decorated?.isAdmin),
      secretsEncryptedAtRest: true,
      encryptionKeyConfigured: encryptionKeyConfigured(),
      encryptionKeyId: encryptionKeyId(),
      previousEncryptionKeyIds: previousEncryptionKeyIds(),
      encryptedSettingKeys: [...Array.from(SENSITIVE_SETTING_KEYS), ...Array.from(BOOT_SECRET_SETTING_KEYS)],
      notes: [SESSION_SECURE ? "Secure cookies are enabled." : "Secure cookies are disabled for local HTTP development.", DEV_LOGIN_ENABLED ? "Local development login is enabled." : "Local development login is disabled.", REQUIRE_DISCORD_LINK ? "Discord linking is required before workspace access." : "Discord linking is temporarily optional.", RATE_LIMIT_ENABLED ? `Rate limiting is enabled at ${API_RATE_LIMIT_MAX} requests per ${Math.round(API_RATE_LIMIT_WINDOW_MS / 1000)} seconds.` : "Rate limiting is disabled.", SECURITY_HEADERS_ENABLED ? "Security headers are enabled." : "Security headers are disabled.", REQUIRE_MUTATION_ORIGIN ? "Cross-site mutation origin checks are enabled." : "Mutation origin checks are disabled.", encryptionKeyConfigured() ? "Sensitive settings, protected boot configuration, and context packs are encrypted with the dedicated Cluster storage key." : "Set a dedicated CLUSTER_SECRET_KEY before real hosting; production now refuses to start without one.", latestBackup?.verification?.ok === true ? "The newest backup has passed verification." : "No verified backup is currently available."],
    };
  });
  

}
