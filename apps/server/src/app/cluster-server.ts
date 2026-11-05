import { operationsCadenceMilliseconds } from "../core/operations-maintenance-cadence.js";
import { canAccessCalendarEventAsActor } from "../domains/planning/calendar-access.js";
import fs from "node:fs/promises";
import { CLUSTER_DOMAIN_EVENTS } from "@cluster/shared";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import { safeUrl } from "../core/security.js";
import { loadRuntimeConfig } from "../core/runtime-config.js";
import { FixedWindowRateLimiter } from "../core/rate-limit.js";
import { DistributedFixedWindowRateLimiter } from "../core/distributed-rate-limit.js";
import { ConcurrentWorkLimiter } from "../core/request-workload.js";
import { BackgroundTaskRegistry } from "../core/background-tasks.js";
import { reconcileConfigurableToolOwners } from "../domains/access/configurable-tool-availability.js";
import { CollaborationRuntime, collaborationRoomOwner, type CollaborationTool } from "../core/collaboration-runtime.js";
import { ClusterCoordinationBus } from "../core/cluster-coordination-bus.js";
import { createStudioSettingsCoordination } from "../core/studio-settings-coordination.js";
import { accountNextStep, DISCORD_LINK_STATE_LIFETIME_MS, GENERIC_AUTH_ERROR, hashPassword, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_MS, nextAccountState, normalizeAuthUsername, oauthStateDigest, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, randomOAuthState, safeAuthenticationReason, generateTemporaryPassword, validateNewPassword, verifyPassword } from "../core/auth.js";
import { inspectInstanceSetup } from "../core/instance-setup.js";
import { revokeSessionSecurityVerifications, revokeUserSecurityVerifications } from "../core/security-verification.js";
import { registerTimeRoutes } from "../domains/time/time-routes.js";
import { registerSchedulerResourceRoutes } from "../domains/time/scheduler-resource-routes.js";
import { registerAdminToolRoutes } from "../domains/admin/admin-tool-routes.js";
import { registerLibraryRoutes } from "../domains/library/library-routes.js";
import { registerLibrary9E2Routes } from "../domains/library/library-9e2-routes.js";
import { registerLibrary9E2JobHandlers } from "../domains/library/library-9e2-jobs.js";
import { registerLibraryBulkJobHandler } from "../domains/library/library-bulk-jobs.js";
import { registerLibraryHierarchyMoveJob } from "../domains/library/library-hierarchy-move.js";
import { registerLibraryHierarchyLifecycleJob } from "../domains/library/library-hierarchy-lifecycle.js";
import { registerLibraryStorageReconciliationJob } from "../domains/library/library-storage-jobs.js";
import { registerLibraryOrphanAuditJob } from "../domains/library/library-orphan-jobs.js";
import { registerPersonnelRecordsRoutes } from "../domains/personnel-records/personnel-records-routes.js";
import { createLibraryAccessService } from "../domains/library/library-access-service.js";
import { registerBrandingRoutes } from "../domains/admin/branding-routes.js";
import { registerUserPreferenceRoutes } from "../domains/users/user-preference-routes.js";
import { registerSyncRoutes } from "../domains/sync/sync-routes.js";
import { registerCalendarRoutes } from "../domains/planning/calendar-routes.js";
import { registerTimelineRoutes } from "../domains/planning/timeline-routes.js";
import { registerMetaDiagnosticsRoutes } from "../domains/admin/meta-diagnostics-routes.js";
import { registerPrivacyPolicyRoutes } from "../domains/legal/privacy-policy-routes.js";
import { registerTermsPolicyRoutes } from "../domains/legal/terms-policy-routes.js";
import { registerOperatorAgreementRoutes } from "../domains/legal/operator-agreement-routes.js";
import { registerCopyrightPolicyRoutes } from "../domains/legal/copyright-policy-routes.js";
import { registerSecurityDisclosurePolicyRoutes } from "../domains/legal/security-disclosure-policy-routes.js";
import { registerLegalComplianceRoutes } from "../domains/legal/legal-compliance-routes.js";
import { registerThirdPartyDisclosureRoutes } from "../domains/legal/third-party-disclosure-routes.js";
import { registerPolicyAcceptanceRoutes } from "../domains/legal/policy-acceptance-routes.js";
import { registerCopyrightWorkflowRoutes } from "../domains/legal/copyright-workflow-routes.js";
import { registerPrivacyConsentRoutes } from "../domains/legal/privacy-consent-routes.js";
import { registerBehavioralAnalyticsRoutes } from "../domains/legal/behavioral-analytics-routes.js";
import { registerPrivacyDataRoutes } from "../domains/legal/privacy-data-routes.js";
import { registerDataRetentionRoutes } from "../domains/legal/data-retention-routes.js";
import { registerStudioSystemsRoutes } from "../domains/studio-systems/studio-systems-routes.js";
import { registerStudioOnboardingRoutes, runStudioOnboardingLifecycleTick } from "../domains/studio-systems/studio-onboarding-routes.js";
import { runStudioFormReminderTick } from "../domains/studio-systems/studio-form-reminders.js";
import { registerStudioWorkflowRoutes } from "../domains/studio-systems/studio-workflow-routes.js";
import { registerStudioInventoryVaultRoutes } from "../domains/inventory/studio-inventory-vault-routes.js";
import { registerDomainManagementRoutes } from "../domains/domains/domain-management-routes.js";
import { registerDomainConnectionRoutes } from "../domains/domains/domain-connection-routes.js";
import { registerManagedPackageRoutes } from "../domains/inventory/managed-package-routes.js";
import { registerStudioOffboardingRoutes } from "../domains/studio-systems/studio-offboarding-routes.js";
import { reconcileStudioKnowledgeAssignments } from "../domains/studio-systems/studio-knowledge-runtime.js";
import { registerProjectRoutes } from "../domains/projects/project-routes.js";
import { registerProjectProvisioningRoutes } from "../domains/projects/project-provisioning-routes.js";
import { registerProjectProvisioningJobHandlers } from "../domains/projects/project-provisioning.js";
import { registerProjectControlRoutes } from "../domains/projects/project-control-routes.js";
import { registerProjectWorkflowRoutes } from "../domains/projects/project-workflow-routes.js";
import { registerProjectControlIntegrationRoutes } from "../domains/projects/project-control-integration-routes.js";
import { registerProjectCloseoutRoutes } from "../domains/projects/project-closeout-routes.js";
import { registerProjectAutomationRoutes } from "../domains/projects/project-automation-routes.js";
import { registerProjectStructureTemplateRoutes } from "../domains/projects/project-structure-template-routes.js";
import { registerProjectIntelligenceRoutes } from "../domains/projects/project-intelligence-routes.js";
import { registerProjectIntelligenceOperationsRoutes } from "../domains/projects/project-intelligence-operations-routes.js";
import { registerProjectDeliveryLifecycleRoutes } from "../domains/projects/project-delivery-lifecycle-routes.js";
import { registerProjectDeliveryRoutes } from "../domains/projects/project-delivery-routes.js";
import { registerProjectTypeWorkspaceRoutes } from "../domains/projects/project-type-workspace-routes.js";
import { registerProjectAssetRoutes } from "../domains/projects/project-asset-routes.js";
import { registerCustomFieldRoutes } from "../domains/custom-fields/custom-field-routes.js";
import { registerHomeLayoutRoutes } from "../domains/home-layouts/home-layout-routes.js";
import { registerStudioAutomationRoutes } from "../domains/automation/studio-automation-routes.js";
import { registerBoardRoutes } from "../domains/boards/board-routes.js";
import { registerTicketRoutes } from "../domains/tickets/ticket-routes.js";
import { registerCardRoutes } from "../domains/cards/card-routes.js";
import { registerAuthRoutes } from "../domains/auth/auth-routes.js";
import { registerSessionRoutes } from "../domains/sessions/session-routes.js";
import { registerPresenceRoutes } from "../domains/presence/presence-routes.js";
import { registerAccessRoutes } from "../domains/access/access-routes.js";
import { registerUserAvatarRoutes } from "../domains/users/user-avatar-routes.js";
import { registerUserDirectoryRoutes } from "../domains/users/user-directory-routes.js";
import { registerStudioAccessRenewalRoutes } from "../domains/users/studio-access-renewal-routes.js";
import { registerScopedGrantRoutes } from "../domains/access/scoped-grant-routes.js";
import { registerTeamRoutes } from "../domains/users/team-routes.js";
import { registerWorkforceRoutes } from "../domains/workforce/workforce-routes.js";
import { registerRoleRoutes } from "../domains/roles/role-routes.js";
import { registerDepartmentRoutes } from "../domains/departments/department-routes.js";
import { registerActivityRoutes } from "../domains/activity/activity-routes.js";
import { createActivityService } from "../domains/activity/activity-service.js";
import { registerNotificationRoutes } from "../domains/notifications/notification-routes.js";
import { configureNotificationVisibility } from "../domains/notifications/notification-visibility.js";
import { registerAuditRoutes } from "../domains/audit/audit-routes.js";
import { createAuditService } from "../domains/audit/audit-service.js";
import { registerCollaborationRoutes } from "../domains/collaboration/collaboration-routes.js";
import { createCollaborationAccessBoundary } from "../domains/collaboration/collaboration-access.js";
import { registerUploadSessionRoutes, uploadPressureSnapshot } from "../domains/uploads/upload-session-routes.js";
import { registerSearchRoutes } from "../domains/search/search-routes.js";
import { createClusterKioskRuntime } from "../domains/kiosk/kiosk-runtime.js";
import { registerKioskRoutes } from "../domains/kiosk/kiosk-routes.js";
import { DurableDomainEventRuntime } from "../core/domain-events.js";
import { ClusterCommandRuntime } from "../core/command-runtime.js";
import { ResourceChangeRuntime } from "../core/resource-change-runtime.js";
import { registerResourceChangeRoutes } from "../domains/changes/resource-change-routes.js";
import { registerBackgroundJobRoutes } from "../domains/jobs/job-routes.js";
import { registerOperationsIncidentRoutes } from "../domains/operations/operations-incident-routes.js";
import { registerOperationsEvidenceRoutes } from "../domains/operations/operations-evidence-routes.js";
import { configureBackgroundJobExecutionAuthorization } from "../domains/jobs/job-execution-authorization.js";
import { registerServerArchitectureRoutes } from "../domains/admin/server-architecture-routes.js";
import { createBuiltInIntegrationRegistry } from "../domains/integrations/integration-provider-registry.js";
import { registerIntegrationRoutes } from "../domains/integrations/integration-routes.js";
import { createServerAutomationJobRuntime } from "./server-automation-job-runtime.js";
import { createServerResourceGovernorRuntime } from "./server-resource-governor-runtime.js";
import { createServerIntegrationsRuntime } from "./server-integrations-runtime.js";
import { createServerReadModelRuntime } from "./server-read-model-runtime.js";
import { registerServerDataPlatformRoutes } from "./server-data-platform-runtime.js";
import { syncEditableDataMirrors } from "../core/data-layout.js";
import { registerIdempotencyHooks } from "../core/idempotency.js";
import { configurePostgresqlRuntime } from "../core/postgresql-runtime.js";
import { RuntimeTelemetry } from "../core/runtime-telemetry.js";
import { ResourceGovernor } from "../core/resource-governor.js";
import { GpuTelemetry } from "../core/gpu-telemetry.js";
import { createServerRequestId, SecurityTelemetry } from "../core/security-observability.js";
import { CachedReadinessProbe } from "../core/readiness-probe.js";
import { ApiToolReadinessMonitor, type ApiDependencySignal } from "../core/api-tool-readiness.js";
import { SustainedDependencyIncidentDetector, reconcileDependencyIncidents } from "../core/operations-dependency-incidents.js";
import { readNativeJournal } from "../core/operations-native-alert-reader.js";
import { reconcileNativeEmergencyEvents, findUnreconciledNativeEvents } from "../core/operations-native-alert-reconciliation.js";
import { reconcileIncidentEscalations } from "../core/operations-incident-alert-routing.js";
import { OperationalHealthHistory, WritableStorageProbe, assessOperationalHealth } from "../core/operational-health.js";
import { verifyStorageSchema as verifyPostgresqlSchema, inspectStorageSchema } from "../core/storage-migrations.js";
import { readRecoveryApplyJournal } from "../core/recovery-generation.js";
import { createServerLifecycle, runServerStartup } from "./server-lifecycle.js";
import { createServerLocalDiscovery } from "./server-local-discovery.js";
import { clearServerRuntimeMarker, writeServerRuntimeMarker } from "../core/server-runtime-marker.js";
import { withDatabaseBootstrapLock } from "../core/database-bootstrap-lock.js";
import { registerHealthOperationsRoutes } from "./server-routes-health-operations.js";
import { registerPersistenceRoutes } from "./server-routes-persistence.js";
import { registerSetupRoutes } from "./server-routes-setup.js";
import { registerAccessAndApprovalRoutes } from "./server-routes-access-media.js";
import { registerMediaWhiteboardRoutes } from "./server-routes-media-whiteboards.js";
import { registerConfigurationIntegrationRoutes } from "./server-routes-configuration-integrations.js";
import { registerContextPackRoutes } from "./server-routes-context-packs.js";
import { createServerProductionIntegrationRuntime } from "./server-production-integration-runtime.js";
import { createRequestDomainServices } from "./server-services-request-domain.js";
import { registerServerRequestInfrastructure } from "./server-request-infrastructure.js";
import { createPersistenceServices } from "./server-services-persistence.js";
import { createSettingsIntegrationServices } from "./server-services-settings-integrations.js";
import { createOperationsServices } from "./server-services-operations.js";
import { createPrismaClient } from "../core/prisma-client.js";
import { databaseResourceBudget } from "../core/database-resource-budget.js";
import { DataIntegrityRuntime } from "../core/data-integrity-runtime.js";
import { efficiencyMetricsSnapshot } from "../core/efficiency-metrics.js";
import { StorageLifecycleRuntime } from "../core/storage/storage-lifecycle-runtime.js";
import { ClusterAccelerationRuntime, type ClusterAccelerationMode } from "../core/acceleration/cluster-acceleration-runtime.js";
import { runtimeAccessModeFromEnvironment } from "../core/runtime-access-state.js";
import { mayRunBackgroundMutation } from "../core/operations-background-mode.js";
const RUNTIME_CONFIG = loadRuntimeConfig();
const { clusterVersion: CLUSTER_VERSION, runtimeProfile: RUNTIME_PROFILE, bootWorkspaceRoot: BOOT_WORKSPACE_ROOT, bootConfigFilePath: BOOT_CONFIG_FILE_PATH, bootSettings: BOOT_SETTINGS, webOrigin: WEB_ORIGIN, configuredCorsOrigins: CONFIGURED_CORS_ORIGINS, sessionCookie: SESSION_COOKIE, sessionDays: SESSION_DAYS, sessionSecure: SESSION_SECURE, rateLimitEnabled: RATE_LIMIT_ENABLED, authRequired: AUTH_REQUIRED, devLoginEnabled: DEV_LOGIN_ENABLED, requestTimeoutMs: REQUEST_TIMEOUT_MS, apiRateLimitMax: API_RATE_LIMIT_MAX, apiRateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS, authRateLimitMax: AUTH_RATE_LIMIT_MAX, sessionIdleHours: SESSION_IDLE_HOURS, sessionMaxPerUser: SESSION_MAX_PER_USER, securityHeadersEnabled: SECURITY_HEADERS_ENABLED, requireMutationOrigin: REQUIRE_MUTATION_ORIGIN, requireDiscordLink: REQUIRE_DISCORD_LINK, uploadLimitBytes: UPLOAD_LIMIT_BYTES, avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES, allowExecutableUploads: ALLOW_EXECUTABLE_UPLOADS, backupVerifyAfterCreate: BACKUP_VERIFY_AFTER_CREATE, sessionSecret: SESSION_SECRET, authSecret: AUTH_SECRET } = RUNTIME_CONFIG;
const DATABASE_URL = process.env.DATABASE_URL || BOOT_SETTINGS.databaseUrlOverride || "postgresql://cluster@127.0.0.1:5432/cluster";
const RECOVERY_DATABASE_URL = String(process.env.CLUSTER_RECOVERY_DATABASE_URL || "").trim();
const app = Fastify({
  logger: RUNTIME_CONFIG.fastifyLogger,
  disableRequestLogging: RUNTIME_CONFIG.disableRequestLogging,
  bodyLimit: RUNTIME_CONFIG.bodyLimit,
  trustProxy: RUNTIME_CONFIG.trustProxy,
  requestIdHeader: false,
  genReqId: () => createServerRequestId(),
});
const prisma = createPrismaClient({ log: [{ emit: "event", level: "query" }] });
const databaseBudget = databaseResourceBudget(DATABASE_URL);
const runtimeTelemetry = new RuntimeTelemetry();
const resourceGovernor = new ResourceGovernor({
  // Server-managed performance controls take effect at the next supervised
  // restart, just like other boot configuration settings.
  profile: BOOT_SETTINGS.serverResourceProfile,
  maximumJobConcurrency: BOOT_SETTINGS.serverResourceWorkerCap,
  recoveryHoldMs: BOOT_SETTINGS.serverResourceRecoveryHoldMs,
});
const gpuTelemetry = new GpuTelemetry();
const databasePoolMax = databaseBudget.apiPoolMax;
const securityTelemetry = new SecurityTelemetry();
const readinessProbe = new CachedReadinessProbe(() => prisma.$queryRawUnsafe("SELECT 1"), { ttlMs: 1_000, timeoutMs: 2_500 });
const operationalHealthHistory = new OperationalHealthHistory();
const ACCELERATION_MODE = (["auto", "memory", "redis-required"].includes(String(process.env.CLUSTER_ACCELERATION_MODE || BOOT_SETTINGS.accelerationMode || "auto"))
  ? String(process.env.CLUSTER_ACCELERATION_MODE || BOOT_SETTINGS.accelerationMode || "auto")
  : "auto") as ClusterAccelerationMode;
const REDIS_URL = String(process.env.CLUSTER_REDIS_URL || BOOT_SETTINGS.redisUrlOverride || "").trim() || null;
const REDIS_KEY_PREFIX = String(process.env.CLUSTER_REDIS_KEY_PREFIX || BOOT_SETTINGS.redisKeyPrefix || "cluster").trim() || "cluster";
const acceleration = new ClusterAccelerationRuntime({
  mode: ACCELERATION_MODE,
  redisUrl: REDIS_URL,
  keyPrefix: REDIS_KEY_PREFIX,
  logger: {
    info: (payload, message) => app.log.info(payload, message),
    warn: (payload, message) => app.log.warn(payload, message),
  },
});
const rateLimiter = new FixedWindowRateLimiter();
const distributedRateLimiter = new DistributedFixedWindowRateLimiter(prisma as any, acceleration);
const concurrentWorkLimiter = new ConcurrentWorkLimiter();
const backgroundTasks = new BackgroundTaskRegistry({
  warn: (error, message) => app.log.warn(error, message),
}, {
  admit: (workloadClass) => resourceGovernor.allowsTask(workloadClass),
});
// Existing background jobs are the sole owners of these health/maintenance loops.
// React to committed Studio/Server settings without creating another timer.
const operationsCadenceTasks = {
  operationsReadinessIntervalMinutes: "api-tool-dependency-readiness",
  operationsEscalationIntervalMinutes: "operations-incident-alert-escalation",
  operationsNativeReconcileIntervalMinutes: "native-emergency-incident-reconcile",
  operationsIntegrityScanHours: "data-integrity-reconcile",
} as const;
function reconcileOperationsCadence(values: Record<string, unknown>) {
  for (const [key, name] of Object.entries(operationsCadenceTasks) as Array<[keyof typeof operationsCadenceTasks, string]>) {
    const interval = operationsCadenceMilliseconds(key, values[key]);
    const current = backgroundTasks.snapshots().find(task => task.name === name);
    if (!current || !current.nextRunAt) continue;
    // The existing scheduler gives the chosen cadence +/- jitter. Avoid
    // needlessly shifting timers when an unrelated setting changes.
    const previous = operationsCadenceLastApplied.get(key);
    if (previous !== undefined && previous === interval) continue;
    if (backgroundTasks.rescheduleAdaptive(name, interval)) operationsCadenceLastApplied.set(key, interval);
  }
}
const operationsCadenceLastApplied = new Map<keyof typeof operationsCadenceTasks, number>();
const processStartedAt = Date.now();
let serverReady = false;
let serverDraining = false;
const SERVER_RUNTIME_MODE = runtimeAccessModeFromEnvironment();
function backgroundMutationPermitted() {
  return mayRunBackgroundMutation({ mode: SERVER_RUNTIME_MODE, ready: serverReady, draining: serverDraining });
}
const MANAGED_HOST_SHUTDOWN_TOKEN = String(process.env.CLUSTER_HOST_SHUTDOWN_TOKEN || "").trim();
const DUMMY_PASSWORD = "Cluster dummy authentication value 210";
const dummyPasswordState: { promise: Promise<string> | null } = { promise: null };
const coordinationBus = new ClusterCoordinationBus({
  info: (payload, message) => app.log.info(payload, message),
  warn: (payload, message) => app.log.warn(payload, message),
}, { acceleration });
const collaborationRuntime = new CollaborationRuntime({
  publisher: (topic, payload) => { void coordinationBus.publish(topic, payload); },
});
for (const topic of [
  "collaboration.presence.upsert",
  "collaboration.presence.remove",
  "collaboration.action.record",
  "collaboration.session.disconnect",
  "collaboration.user.disconnect",
  "collaboration.room.changed",
]) coordinationBus.subscribe(topic, (payload) => collaborationRuntime.applyExternalEvent(topic, payload));
function onSessionRevoked(sessionId: string, _userId: string, reason: string) {
  void revokeSessionSecurityVerifications(prisma, sessionId);
  collaborationRuntime.disconnectSession(sessionId, reason);
}
function onUserSessionsRevoked(userId: string, reason: string, exceptSessionId?: string | null) {
  void revokeUserSecurityVerifications(prisma, userId, exceptSessionId);
  collaborationRuntime.disconnectUser(userId, reason, exceptSessionId);
}
const eventRuntime = new DurableDomainEventRuntime(prisma as any, {
  info: (payload, message) => app.log.info(payload, message),
  warn: (payload, message) => app.log.warn(payload, message),
  error: (payload, message) => app.log.error(payload, message),
});
const changeRuntime = new ResourceChangeRuntime(prisma as any, {
  warn: (payload, message) => app.log.warn(payload, message),
});
eventRuntime.subscribe("*", "resource-change-runtime-wake", async () => {
  changeRuntime.wake();
});
const activityService = createActivityService({ prisma, events: eventRuntime, logger: app.log });
const { projectReadModels, notificationService } = createServerReadModelRuntime({
  prisma,
  events: eventRuntime,
  coordination: coordinationBus,
  acceleration,
  logger: app.log,
});
const auditService = createAuditService({ prisma, logger: app.log });
const commandRuntime = new ClusterCommandRuntime({
  logger: {
    warn: (payload, message) => app.log.warn(payload, message),
    error: (payload, message) => app.log.error(payload, message),
  },
  audit: async (evidence) => {
    await auditService.recordSecurity({
      event: "command.execute",
      actorUserId: evidence.actorUserId || null,
      workspaceId: null,
      result: evidence.outcome === "succeeded" || evidence.outcome === "dry-run" ? "SUCCESS" : "FAILURE",
      reasonCode: `COMMAND_${evidence.outcome.toUpperCase().replace(/-/g, "_")}`,
      requestId: null,
      metadata: evidence,
    });
  },
});
let integrationsRuntime: ReturnType<typeof createServerIntegrationsRuntime> | null = null;
const { projectAutomation, jobQueue, operationRuntime, studioAutomation, jobRuntime, jobWorker } = createServerAutomationJobRuntime({
  prisma, events: eventRuntime,
  canViewCalendarReminderRecipient: async (user, event) => {
    const decorated = await decorateUserForClient(user);
    return canAccessCalendarEventAsActor(authorization, { user, decorated, role: decorated?.workspaceRole || null }, event, "view");
  },
  logActivity: (input) => activityService.record(input as any), logger: app.log, backgroundTasks,
  readSettings: (force) => readSettings(force), notifications: notificationService,
  onboarding: { runLifecycle: ({ now, limit } = {}) => runStudioOnboardingLifecycleTick({ prisma, logActivity, now, limit }) },
  forms: { runLifecycle: ({ now, maxDeliveries } = {}) => runStudioFormReminderTick({ prisma, logActivity, now, maxDeliveries }) },
  knowledge: { runLifecycle: ({ now } = {}) => reconcileStudioKnowledgeAssignments({ prisma, logActivity, now }) }, resourceGovernor,
  integrations: {
    deliver: async (deliveryId, attempt, maxAttempts) => { if (!integrationsRuntime) throw new Error("Webhook integration runtime is not initialized."); return integrationsRuntime.webhooks.deliver(deliveryId, attempt, maxAttempts); },
    recoverPending: async (limit) => integrationsRuntime?.webhooks.recoverPending(limit) ?? { scanned: 0, enqueued: 0 },
  },
  wakePublisher: async () => { await coordinationBus.publish("background-jobs.wake", { at: Date.now() }); },
});
eventRuntime.setWakePublisher(() => {
  changeRuntime.wake();
  return coordinationBus.publish("domain-events.wake", { at: Date.now() }).then(() => {});
});
coordinationBus.subscribe("domain-events.wake", () => { eventRuntime.wake(); changeRuntime.wake(); });
coordinationBus.subscribe("background-jobs.wake", () => jobRuntime.wake());
/** Cross-tool kill switches are Studio policy, not individual permissions. */
function reconcileToolAvailability(settings: Record<string, unknown>, changedKeys?: readonly string[]) {
  let reenabled = false;
  reconcileConfigurableToolOwners(settings, (tool, enabled) => {
    const wasEnabled = backgroundTasks.isOwnerEnabled(tool);
    if (enabled && !wasEnabled) reenabled = true;
    backgroundTasks.setOwnerEnabled(tool, enabled);
    if (!enabled && wasEnabled && collaborationRoomOwner(tool as CollaborationTool) === tool) {
      collaborationRuntime.disconnectTool(tool as CollaborationTool);
    }
  }, changedKeys);
  // Promptly pick up durable jobs preserved while their owner was disabled.
  if (reenabled) jobRuntime.wake();
}


const resourceGovernorRuntime = createServerResourceGovernorRuntime({
  prisma,
  databaseUrl: DATABASE_URL,
  databasePoolMax,
  runtimeTelemetry,
  resourceGovernor,
  gpuTelemetry,
  concurrentWorkLimiter,
  jobQueue,
  logger: app.log,
});
const integrationRegistry = createBuiltInIntegrationRegistry();
const MASKED_SECRET = "********";
let settingsCoordination: ReturnType<typeof createStudioSettingsCoordination> | null = null;
const {
  CONFIG_FILE_PATH,
  DATA_FOLDERS,
  DATA_LAYOUT,
  DATA_ROOT,
  SERVER_MANAGED_SETTING_KEYS,
  UPLOAD_ROOT,
  authorization,
  authorizeRequestBoundary,
  buildContextPackPayload,
  canArchiveProject,
  canManageProjectAccess,
  decorateUserForClient,
  canViewPrivateUserProfile,
  cleanOptionalString,
  clearRateLimitKey,
  clearCurrentSessionCache,
  clearSessionCookies,
  configuredProjectType,
  createSession,
  csrfTokenForSession,
  csrfTokenMatches,
  databaseDiagnostics,
  storageRuntime,
  discardStoredProjectFile,
  discardPreparedManagedBlob,
  projectFileStorageLocator,
  defaultBoardColumnsForProjectType,
  disabledToolLabel,
  enforceCardAccess,
  enforceListAccess,
  enforceTargetAccess,
  ensureDemoData,
  fetchWithTimeout,
  getCurrentSession,
  getClientKey,
  getCurrentUser,
  getSetupStatus,
  getWorkspaceRole,
  hasProjectPermission,
  hasTargetAccess,
  hasToolPermission,
  hashShareToken,
  hashToken,
  isDiscordConfigured,
  isUserAccessExpired,
  mutationOriginAllowed,
  mutationOriginDecision,
  normalizeProjectStatus,
  normalizeProjectType,
  parseContextPayload,
  parseJsonObject,
  parseLabels,
  parseObject,
  pickContextPackSettings,
  productionTracksForType,
  rateLimit,
  rateLimitKey,
  readQualityGateStatus,
  requestIpAddress,
  requestUserAgent,
  requireConfirmation,
  resolveAvatarStoredFile,
  resolveProjectStoredFile,
  securityHeaders,
  sendRevisionConflict,
  serializeAccessRule,
  serializeBoard,
  serializeCalendarEvent,
  serializeCard,
  serializeContextPack,
  serializeProjectShareLink,
  serializeProjectSummary,
  serializeTimelineItem,
  serializeUserLite,
  serializeUserPrivate,
  serializeUserPublicProfile,
  serializeReviewAsset,
  serializeWhiteboard,
  setupIsComplete,
  shareLinkExpired,
  studioPermissionSettings,
  unique,
  writeUpload,
  storeCompletedUpload,
  consumeUploadSession
} = createRequestDomainServices({
  ALLOW_EXECUTABLE_UPLOADS,
  AUTH_REQUIRED,
  AUTH_SECRET,
  AVATAR_UPLOAD_LIMIT_BYTES,
  BOOT_SETTINGS,
  BOOT_CONFIG_FILE_PATH,
  CLUSTER_VERSION,
  CONFIGURED_CORS_ORIGINS,
  RATE_LIMIT_ENABLED,
  REQUEST_TIMEOUT_MS,
  REQUIRE_DISCORD_LINK,
  REQUIRE_MUTATION_ORIGIN,
  SECURITY_HEADERS_ENABLED,
  SESSION_COOKIE,
  SESSION_DAYS,
  SESSION_IDLE_HOURS,
  SESSION_MAX_PER_USER,
  SESSION_SECURE,
  UPLOAD_LIMIT_BYTES,
  prisma,
  rateLimiter,
  distributedRateLimiter,
  readSettings: (force?: boolean) => readSettings(force),
  onSessionRevoked,
  onUserSessionsRevoked,
});
const dataIntegrityRuntime = new DataIntegrityRuntime(prisma, storageRuntime);
const storageLifecycleRuntime = new StorageLifecycleRuntime(prisma, storageRuntime);
const {
  buildPersistenceStorageData,
  checksumMatchesRecord,
  logPersistenceAudit,
  persistenceKindSchema,
  safePersistenceRecordCount,
  serializePersistenceRecord,
  validatePersistencePayload
} = createPersistenceServices({
  app,
  parseJsonObject,
  prisma
});
const {
  discordRequest,
  dummyPasswordHash,
  ensureDataFolders,
  logActivity,
  logSecurityEvent,
  normalizePersonalAccent,
  readSettings,
  recoverPendingConfigPublication,
  saveSettings,
  rewrapProtectedSettings,
  patchSettings,
  readSettingPreconditions,
  resetSettingOverrides,
  mutateSettingsKeys,
  serializeActivityEvent,
  settingsForClient,
  studioSettingsForClient,
  stripServerManagedSettings,
  verifyStorageSchema,
  verifyUserPin
} = createSettingsIntegrationServices({
  AUTH_SECRET,
  CONFIG_FILE_PATH,
  DATABASE_URL,
  DATA_FOLDERS,
  DATA_LAYOUT,
  DATA_ROOT,
  DUMMY_PASSWORD,
  MASKED_SECRET,
  SERVER_MANAGED_SETTING_KEYS,
  UPLOAD_ROOT,
  activityService,
  app,
  auditService,
  dummyPasswordState,
  fetchWithTimeout,
  parseJsonObject,
  prisma,
  requestIpAddress,
  requestUserAgent,
  studioPermissionSettings,
  securityTelemetry,
  onStudioSettingsChanged: (changedKeys: string[], values: Record<string, unknown>) => {
    settingsCoordination?.committedLocally(changedKeys, values);
    reconcileOperationsCadence(values);
  },
});
// Studio Settings changes are committed in the DB before the local callback.
// Cross-process notifications contain no setting values; receivers re-read DB
// truth and coalesce bursts. The 60s polling task remains a recovery fallback.
settingsCoordination = createStudioSettingsCoordination({
  readSettings: (force) => readSettings(force),
  applyToolAvailability: (settings, changedKeys) => {
    reconcileToolAvailability(settings, changedKeys);
    reconcileOperationsCadence(settings);
  },
  publishChange: (payload) => coordinationBus.publish("studio-settings.changed", payload),
  warn: (error, message) => app.log.warn({ err: error }, message),
});
coordinationBus.subscribe("studio-settings.changed", (payload) => {
  if (!payload || typeof payload !== "object" || (payload as any).kind !== "committed") return;
  return settingsCoordination?.refreshFromDatabase();
});
const kioskRuntime = createClusterKioskRuntime({ authSecret: AUTH_SECRET, sessionSecure: SESSION_SECURE, readSettings, prisma });
const writableStorageProbe = new WritableStorageProbe([
  { key: "data", root: DATA_ROOT },
  { key: "uploads", root: UPLOAD_ROOT },
  { key: "backups", root: DATA_LAYOUT.backupsRoot },
], { ttlMs: 5_000, timeoutMs: 2_500 });
// Server-owned, allowlisted dependency checks. No per-domain HTTP fanout, and
// never call untrusted URLs. Shared cached probes enforce their own timeouts.
const dependencyIncidentDetector = new SustainedDependencyIncidentDetector(2);
const apiToolReadiness = new ApiToolReadinessMonitor(async () => {
  const [database, storage] = await Promise.all([readinessProbe.check(), writableStorageProbe.check()]);
  const posture = operationalHealthSnapshot(database, storage);
  const keys: ApiDependencySignal["key"][] = ["lifecycle", "database", "storage", "background-tasks"];
  return keys.map((key) => {
    const check = posture.checks.find((item) => item.key === key);
    return { key, status: check?.status || "unknown", detail: check?.detail || "Health signal unavailable." };
  });
});
function operationalHealthSnapshot(database = readinessProbe.snapshot(), storage = writableStorageProbe.snapshot()) {
  return operationalHealthHistory.observe(assessOperationalHealth({
    serverReady,
    serverDraining,
    runtimeMode: SERVER_RUNTIME_MODE,
    database,
    storage,
    runtime: runtimeTelemetry.snapshot(),
    backgroundTasks: backgroundTasks.snapshots(),
  }));
}
await registerServerRequestInfrastructure({
  app,
  prisma,
  dataRoot: DATA_ROOT,
  runtimeConfig: RUNTIME_CONFIG,
  configuredCorsOrigins: CONFIGURED_CORS_ORIGINS,
  sessionSecret: SESSION_SECRET,
  clusterVersion: CLUSTER_VERSION,
  authRequired: AUTH_REQUIRED,
  requireDiscordLink: REQUIRE_DISCORD_LINK,
  sessionDays: SESSION_DAYS,
  sessionIdleHours: SESSION_IDLE_HOURS,
  sessionMaxPerUser: SESSION_MAX_PER_USER,
  apiRateLimitMax: API_RATE_LIMIT_MAX,
  apiRateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS,
  authRateLimitMax: AUTH_RATE_LIMIT_MAX,
  uploadLimitBytes: UPLOAD_LIMIT_BYTES,
  avatarUploadLimitBytes: AVATAR_UPLOAD_LIMIT_BYTES,
  concurrentWorkLimiter,
  resourceGovernor,
  runtimeTelemetry,
  securityTelemetry,
  databaseDiagnostics,
  auditService,
  getServerState: () => ({ ready: serverReady, draining: serverDraining, mode: SERVER_RUNTIME_MODE }),
  securityHeaders,
  mutationOriginAllowed,
  mutationOriginDecision,
  rateLimit,
  rateLimitKey,
  getClientKey,
  getCurrentSession,
  clearSessionCookies,
  csrfTokenMatches,
  decorateUserForClient,
  kioskRuntime,
  isUserAccessExpired,
  studioPermissionSettings,
  onSessionRevoked,
  onUserSessionsRevoked,
  hasToolPermission,
  disabledToolLabel,
  readSettings,
  authorizeRequestBoundary,
  requestIpAddress,
  requestUserAgent,
});
registerIdempotencyHooks(app, prisma as any);
registerMetaDiagnosticsRoutes({
  app,
  clusterVersion: CLUSTER_VERSION,
  authorization,
  databaseDiagnostics,
  inspectStorage: () => inspectStorageSchema(prisma as any),
  verifyStorage: () => verifyPostgresqlSchema(prisma as any, app.log),
  recoveryApplyStatus: () => readRecoveryApplyJournal(path.join(DATA_LAYOUT.backupsRoot, "recovery-checkpoints")),
  runtimeTelemetry,
  operationalHealthSnapshot,
  securityTelemetry,
  readSettings,
  logSecurityEvent,
  runtimeConfig: {
    profile: RUNTIME_PROFILE,
    authRequired: AUTH_REQUIRED,
    secureCookies: SESSION_SECURE,
    rateLimitEnabled: RATE_LIMIT_ENABLED,
    mutationOriginRequired: REQUIRE_MUTATION_ORIGIN,
    securityHeadersEnabled: SECURITY_HEADERS_ENABLED,
    executableUploadsAllowed: ALLOW_EXECUTABLE_UPLOADS,
    configuredOriginCount: CONFIGURED_CORS_ORIGINS.size,
  },
});
registerPrivacyPolicyRoutes({ app, prisma, getCurrentUser, readSettings });
registerTermsPolicyRoutes({ app, prisma, getCurrentUser, readSettings });
registerOperatorAgreementRoutes({ app, prisma, getCurrentUser, readSettings });
registerCopyrightPolicyRoutes({ app, prisma, getCurrentUser, readSettings });
registerSecurityDisclosurePolicyRoutes({ app, prisma, getCurrentUser, readSettings, webOrigin: WEB_ORIGIN });
registerLegalComplianceRoutes({ app, prisma, readSettings, authorization, logSecurityEvent });
registerThirdPartyDisclosureRoutes({ app, prisma, getCurrentUser, readSettings });
registerPolicyAcceptanceRoutes({ app, prisma, getCurrentSession, decorateUserForClient, logSecurityEvent });
registerCopyrightWorkflowRoutes({ app, prisma, dataLayout: DATA_LAYOUT, getCurrentUser, authorization, logActivity, logSecurityEvent });
registerPrivacyConsentRoutes({ app, prisma, getCurrentUser });
registerBehavioralAnalyticsRoutes({ app, prisma, getCurrentUser });
registerPrivacyDataRoutes({ app, prisma, getCurrentUser, getCurrentSession, requireConfirmation, logSecurityEvent, clearSessionCookies, onUserSessionsRevoked, requireDiscordLink: REQUIRE_DISCORD_LINK, authorization });
registerDataRetentionRoutes({ app, prisma, authorization, readSettings, requireConfirmation, logSecurityEvent });
registerStudioSystemsRoutes({ app, prisma, authorization, getCurrentUser, logActivity });
registerStudioOnboardingRoutes({ app, prisma, authorization, getCurrentUser, logActivity, jobQueue });
registerStudioWorkflowRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent, readSettings, rateLimitKey, hashToken, apiRateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS, hashPassword, generateTemporaryPassword, normalizeAuthUsername, events: eventRuntime });
registerStudioOffboardingRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent });
registerStudioInventoryVaultRoutes({ app, prisma, authorization, requireConfirmation, logSecurityEvent, getCurrentUser, verifyUserPin, auditService });
registerDomainManagementRoutes({ app, prisma, authorization, getCurrentUser, auditService, readSettings });
registerDomainConnectionRoutes({ app, prisma, authorization, getCurrentUser, auditService, readSettings });
registerManagedPackageRoutes({ app, prisma, storageRuntime, authorization, requireConfirmation, logSecurityEvent, getCurrentSession });
const {
  backupIsDue,
  backupWindowKey,
  countFolderEntries, createPreUpgradeCheckpoint, createServerBackup,
  deleteBackupGeneration,
  listBackupManifests,
  pruneOperationalRecords,
  readBackupManifest, recoveryReadiness, runServerRestoreDrill,
  requireAdminUserForRequest,
  seedProductionDemoWorkspace,
  sha256File,
  stabilizationCounts,
  startBackgroundTasks,
  verifyBackupManifest
} = createOperationsServices({
  BACKUP_VERIFY_AFTER_CREATE,
  CLUSTER_VERSION,
  CONFIG_FILE_PATH,
  DATABASE_URL,
  RECOVERY_DATABASE_URL,
  DATA_LAYOUT,
  DATA_ROOT,
  UPLOAD_ROOT,
  app,
  authorization,
  backgroundTasks,
  collaborationRuntime,
  ensureDataFolders,
  logActivity,
  prisma,
  rateLimiter,
  readSettings,
  safePersistenceRecordCount,
  storageRuntime
});
integrationsRuntime = createServerIntegrationsRuntime({
  app, prisma, queue: jobQueue, events: eventRuntime, readSettings, authorization, requireConfirmation,
  sessionDefaults: { sessionDays: SESSION_DAYS, sessionIdleHours: SESSION_IDLE_HOURS, sessionMaxPerUser: SESSION_MAX_PER_USER },
});
registerOperationsIncidentRoutes({ app, prisma, requireAdminUserForRequest, logActivity, logSecurityEvent, verifyUserPin });
registerOperationsEvidenceRoutes({ app, prisma, requireAdminUserForRequest });
registerBackgroundJobRoutes({
  app,
  prisma,
  queue: jobQueue,
  operations: operationRuntime,
  commands: commandRuntime,
  worker: jobWorker,
  requireAdminUserForRequest,
  logSecurityEvent,
});
registerServerArchitectureRoutes({
  app,
  events: eventRuntime,
  jobQueue,
  jobWorker,
  jobRuntime,
  coordination: coordinationBus,
  acceleration,
  concurrentWorkLimiter,
  storageRuntime, uploadPressure: () => uploadPressureSnapshot({ prisma, storageRuntime, dataLayout: DATA_LAYOUT }), efficiencyMetrics: () => efficiencyMetricsSnapshot(prisma),
  databaseResourceBudget: databaseBudget,
  projectReadModels,
  notificationSummaryCache: notificationService,
  requireAdminUserForRequest,
});
const productionIntegrations = createServerProductionIntegrationRuntime({ app, prisma, queue: jobQueue, worker: jobWorker, backgroundTasks, readSettings, discordRequest, fetchWithTimeout, notificationService, authorization, getCurrentUser, enforceTargetAccess, localDiscordUrl: `http://${["0.0.0.0", "::", ""].includes(RUNTIME_CONFIG.listenHost) ? "127.0.0.1" : RUNTIME_CONFIG.listenHost === "::1" ? "[::1]" : RUNTIME_CONFIG.listenHost}:${RUNTIME_CONFIG.listenPort}`, repositoriesRoot: DATA_LAYOUT.repositoriesRoot, sourceWorkspacesRoot: DATA_LAYOUT.sourceWorkspacesRoot, dataLayout: DATA_LAYOUT, logActivity });
registerIntegrationRoutes({ app, prisma, registry: integrationRegistry, readSettings, saveSettings, settingsForClient, authorization, sourceProvider: productionIntegrations.sourceProvider, discordRequest, logActivity });
registerUserPreferenceRoutes({ app, prisma, getCurrentUser, decorateUserForClient, normalizePersonalAccent, verifyPassword, hashPassword, verifyUserPin, logSecurityEvent, readSettings });
registerKioskRoutes({ app, prisma, readSettings, getCurrentSession, decorateUserForClient, verifyPassword, verifyUserPin, dummyPasswordHash, normalizeAuthUsername, rateLimitKey, clearRateLimitKey, authRateLimitMax: AUTH_RATE_LIMIT_MAX, apiRateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS, logSecurityEvent, kioskRuntime });
registerAuthRoutes({
  app,
  prisma,
  authorization,
  inspectInstanceSetup,
  isDiscordConfigured,
  requireDiscordLink: REQUIRE_DISCORD_LINK,
  devLoginEnabled: DEV_LOGIN_ENABLED,
  passwordMinLength: PASSWORD_MIN_LENGTH,
  passwordMaxLength: PASSWORD_MAX_LENGTH,
  authRateLimitMax: AUTH_RATE_LIMIT_MAX,
  apiRateLimitWindowMs: API_RATE_LIMIT_WINDOW_MS,
  loginFailureLimit: LOGIN_FAILURE_LIMIT,
  loginLockMs: LOGIN_LOCK_MS,
  authSecret: AUTH_SECRET,
  genericAuthError: GENERIC_AUTH_ERROR,
  sessionCookie: SESSION_COOKIE,
  sessionSecure: SESSION_SECURE,
  webOrigin: WEB_ORIGIN,
  discordLinkStateLifetimeMs: DISCORD_LINK_STATE_LIFETIME_MS,
  normalizeAuthUsername,
  verifyPassword,
  verifyUserPin,
  dummyPasswordHash,
  rateLimitKey,
  clearRateLimitKey,
  logSecurityEvent,
  createSession,
  clearCurrentSessionCache,
  clearSessionCookies,
  csrfTokenForSession,
  decorateUserForClient,
  accountNextStep,
  validateNewPassword,
  hashPassword,
  generateTemporaryPassword,
  nextAccountState,
  getCurrentSession,
  hashToken,
  randomOAuthState,
  oauthStateDigest,
  fetchWithTimeout,
  safeAuthenticationReason,
  requireConfirmation,
  parseJsonObject,
  readSettings,
  saveSettings,
  rewrapProtectedSettings,
  settingsForClient,
  onSessionRevoked,
  onUserSessionsRevoked,
  notificationService,
});
registerSessionRoutes({
  app,
  prisma,
  authorization,
  getCurrentSession,
  clearCurrentSessionCache,
  onSessionRevoked,
  onUserSessionsRevoked,
  requireConfirmation,
  logActivity,
  logSecurityEvent,
  serializeUserLite,
  sessionCookie: SESSION_COOKIE,
  sessionIdleHours: SESSION_IDLE_HOURS,
  sessionMaxPerUser: SESSION_MAX_PER_USER,
});
registerPresenceRoutes({ app, prisma, getCurrentUser, logActivity, decorateUserForClient, authorization });
registerAccessRoutes({ app, prisma, getCurrentUser, cursorSecret: AUTH_SECRET, getStudioPermissionSettings: () => studioPermissionSettings, authorization, serializeAccessRule, logActivity, canAccessLibraryItem: (request, item, minimum) => libraryAccess.canAccessItem(request, item, minimum) });
registerUserAvatarRoutes({ app, prisma, getCurrentUser, getWorkspaceRole, writeUpload, logActivity, resolveAvatarStoredFile, serializeUserLite });
registerStudioAccessRenewalRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent });
registerScopedGrantRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent });
registerUserDirectoryRoutes({
  app,
  prisma,
  getCurrentUser,
  getWorkspaceRole,
  hasToolPermission,
  serializeUserLite,
  serializeUserPrivate,
  serializeUserPublicProfile,
  parseObject,
  normalizeAuthUsername,
  hashPassword,
  generateTemporaryPassword,
  logSecurityEvent,
  logActivity,
  canViewPrivateUserProfile,
  serializeActivityEvent,
  readSettings,
  authorization,
});
registerTeamRoutes({ app, prisma, serializeUserPublicProfile, serializeUserLite, parseLabels, authorization, getCurrentUser, logActivity, readSettings, saveSettings, patchSettings, readSettingPreconditions });
registerWorkforceRoutes({ app, prisma, authorization, getCurrentUser, decorateUserForClient, serializeUserPublicProfile, logActivity });
registerRoleRoutes({ app, prisma, authorization });
registerDepartmentRoutes({ app, prisma, authorization });
registerActivityRoutes({ app, activityService, serializeActivityEvent, serializeUserPublicProfile, authorization });
const notificationVisibility = configureNotificationVisibility({ prisma, authorization, decorateUserForClient, notificationService });
registerNotificationRoutes({ app, prisma, getCurrentUser, logActivity, authorization, notificationService, notificationStreamAccess: notificationVisibility.canStream, runtimeTelemetry });
const libraryAccess = createLibraryAccessService({ prisma, getCurrentUser, decorateUserForClient, hasTargetAccess });
registerResourceChangeRoutes({ app, prisma, authorization, changeRuntime, libraryAccess, getCurrentSession, decorateUserForClient, runtimeTelemetry,
  isConfigurableToolEnabled: (tool) => backgroundTasks.isOwnerEnabled(tool),
});
registerServerDataPlatformRoutes({ app, prisma, dataLayout: DATA_LAYOUT, getCurrentUser, decorateUserForClient, authorization, jobQueue, jobWorker, requireAdminUserForRequest, logSecurityEvent, logActivity });
registerHomeLayoutRoutes({ app, prisma, getCurrentUser, authorization });
registerStudioAutomationRoutes({ app, authorization, getCurrentUser, service: studioAutomation });
registerAuditRoutes({ app, authorization, parseJsonObject, auditService, logSecurityEvent });
configureBackgroundJobExecutionAuthorization({ worker: jobWorker, prisma, authorization, decorateUserForClient, libraryAccess });
registerLibrary9E2JobHandlers({ worker: jobWorker, prisma, dataLayout: DATA_LAYOUT, storeCompletedUpload, consumeUploadSession, logActivity });
registerLibraryBulkJobHandler({ worker: jobWorker, prisma, libraryAccess });
registerLibraryHierarchyMoveJob({ worker: jobWorker, prisma, access: libraryAccess, coordination: coordinationBus });
registerLibraryHierarchyLifecycleJob({ worker: jobWorker, prisma, access: libraryAccess, coordination: coordinationBus });
registerLibraryStorageReconciliationJob({ worker: jobWorker, prisma, dataLayout: DATA_LAYOUT });
registerLibraryOrphanAuditJob({ worker: jobWorker, prisma, dataLayout: DATA_LAYOUT });
registerProjectProvisioningJobHandlers({ worker: jobWorker, prisma, dataLayout: DATA_LAYOUT, gitRuntime: productionIntegrations.gitRuntime, logActivity });
registerProjectRoutes({
  app, prisma, getCurrentUser, decorateUserForClient, hasTargetAccess, enforceTargetAccess, serializeProjectSummary, normalizeProjectType, normalizeProjectStatus, configuredProjectType, unique, safeUrl, logActivity, sendRevisionConflict, verifyUserPin, canArchiveProject, hasToolPermission, hasProjectPermission, readSettings, buildPersistenceStorageData, parseLabels,
  verifyStorage: () => verifyPostgresqlSchema(prisma as any, app.log),
  authorization,
  gitRuntime: productionIntegrations.gitRuntime,
  dataLayout: DATA_LAYOUT,
  writeUpload,
});
registerProjectProvisioningRoutes({
  app, prisma, operationRuntime, getCurrentUser, decorateUserForClient, hasToolPermission, configuredProjectType,
});
registerProjectControlRoutes({
  app,
  prisma,
  getCurrentUser,
  decorateUserForClient,
  enforceTargetAccess,
  requestCanTarget: authorization.requestCanTarget,
  sendRevisionConflict,
  logActivity,
  projectAutomation,
  libraryAccess,
});
registerProjectControlIntegrationRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity, readSettings, fetchWithTimeout, sourceProvider: productionIntegrations.sourceProvider });
registerProjectCloseoutRoutes({ app, prisma, getCurrentUser, decorateUserForClient, enforceTargetAccess, sendRevisionConflict, logActivity, verifyUserPin, authorization });
registerProjectAutomationRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, readSettings, projectAutomation });
registerProjectStructureTemplateRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity });
registerProjectIntelligenceRoutes({ app, prisma, enforceTargetAccess, authorization, projectReadModels });
registerProjectIntelligenceOperationsRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, readSettings, logActivity, projectReadModels });
registerProjectDeliveryLifecycleRoutes({ app, prisma, enforceTargetAccess, getCurrentUser, buildPersistenceStorageData, logActivity, projectReadModels });
registerProjectDeliveryRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity, studioAutomation, projectReadModels });
registerProjectTypeWorkspaceRoutes({ app, prisma, getCurrentUser, enforceTargetAccess, logActivity, readSettings });
registerProjectWorkflowRoutes({
  app,
  prisma,
  getCurrentUser,
  enforceTargetAccess,
  buildPersistenceStorageData,
  logPersistenceAudit,
  logActivity,
  parseJsonObject: (value) => parseJsonObject(typeof value === "string" ? value : value == null ? null : JSON.stringify(value)),
});
registerCustomFieldRoutes({
  app,
  prisma,
  getCurrentUser,
  decorateUserForClient,
  enforceTargetAccess,
  hasTargetAccess,
  authorization,
  buildPersistenceStorageData,
  logPersistenceAudit,
  logActivity,
  parseJsonObject: (value) => parseJsonObject(typeof value === "string" ? value : value == null ? null : JSON.stringify(value)),
});
registerSearchRoutes({
  app,
  prisma,
  getCurrentUser,
  decorateUserForClient,
  authorization,
  libraryAccess,
  parseLabels,
  serializeUserLite: serializeUserPublicProfile,
  serializeProjectSummary,
  jobWorker,
  operations: operationRuntime,
  subscribeToSearchChanges: (handler) => {
    eventRuntime.subscribe(CLUSTER_DOMAIN_EVENTS.activityRecorded.type, "search.activity-changes", handler);
  },
});
registerBoardRoutes({
  app, prisma, authorization, getCurrentUser, defaultBoardColumnsForProjectType, logActivity, sendRevisionConflict, serializeBoard, serializeCard, collaborationRuntime,
});
registerTicketRoutes({
  app, prisma, getCurrentUser, decorateUserForClient, hasTargetAccess, hasToolPermission, enforceTargetAccess, enforceListAccess, serializeBoard, serializeCard, readSettings, unique, logActivity, collaborationRuntime, studioAutomation,
});
registerCardRoutes({
  app, prisma, authorization, getCurrentUser, logActivity, serializeCard, sendRevisionConflict, collaborationRuntime,
});
const enforceCollaborationResourceAccess = createCollaborationAccessBoundary({
  prisma, authorization, collaborationRuntime, decorateUserForClient, getCurrentUser, parseLabels, libraryAccess,
  isToolEnabled: (owner) => backgroundTasks.isOwnerEnabled(owner),
});
registerCollaborationRoutes({
  app,
  prisma,
  getCurrentUser,
  getCurrentSession,
  enforceCollaborationResourceAccess,
  collaborationRuntime,
  clusterVersion: CLUSTER_VERSION,
  authorization,
  runtimeTelemetry,
});
registerUploadSessionRoutes({ app, prisma, storageRuntime, dataLayout: DATA_LAYOUT, getCurrentUser, decorateUserForClient, byteRateLimiter: distributedRateLimiter });
registerProjectAssetRoutes({ app, prisma, dataLayout: DATA_LAYOUT, resolveProjectStoredFile, storageRuntime, projectFileStorageLocator, getCurrentUser, enforceTargetAccess, authorization, logActivity });
registerBrandingRoutes({
  app,
  brandingRoot: DATA_LAYOUT.brandingRoot,
  getCurrentUser,
  getWorkspaceRole,
  writeUpload,
  logActivity,
});
registerLibraryRoutes({
  app,
  prisma,
  uploadRoot: UPLOAD_ROOT,
  dataLayout: DATA_LAYOUT,
  storageRuntime,
  getCurrentUser,
  decorateUserForClient,
  hasTargetAccess,
  hasToolPermission,
  serializeUserLite,
  storeCompletedUpload,
  consumeUploadSession,
  sha256File,
  safeUrl,
  unique,
  logActivity,
  readSettings: (force?: boolean) => readSettings(force),
  syncCursorSecret: SESSION_SECRET,
  coordination: coordinationBus,
  ownedSubscriptions: backgroundTasks,
  libraryAccess,
  jobQueue,
  notificationService,
});
registerLibrary9E2Routes({ app, prisma, operationRuntime, collaborationRuntime, libraryAccess, dataLayout: DATA_LAYOUT, storageRuntime, getCurrentUser, decorateUserForClient, hasToolPermission, logActivity });
registerPersonnelRecordsRoutes({ app, prisma, authorization, getCurrentUser, getCurrentSession, decorateUserForClient, hasToolPermission, logActivity, logSecurityEvent, dataLayout: DATA_LAYOUT });
registerSyncRoutes({
  app,
  prisma,
  getCurrentUser,
  getWorkspaceRole,
  hasTargetAccess,
  hasProjectResourceAccess: authorization.hasProjectResourceAccess,
  hasToolPermission,
  syncCursorSecret: SESSION_SECRET,
});
registerAdminToolRoutes(app, {
  prisma,
  getCurrentUser,
  decorateUserForClient,
  readSettings,
  saveSettings,
  patchSettings,
  readSettingPreconditions,
  resetSettingOverrides,
  verifyStorageSchema,
  logSecurityEvent,
  dataLayout: DATA_LAYOUT,
});
registerCalendarRoutes({
  app,
  prisma,
  getCurrentUser,
  logActivity,
  readSettings,
  serializeCalendarEvent,
  authorization,
});
registerTimeRoutes({
  app,
  prisma,
  getCurrentUser,
  decorateUserForClient,
  hasToolPermission,
  serializeUserLite,
  logActivity,
  readSettings,
  verifyUserPin,
  authorization,
});
registerSchedulerResourceRoutes({ app, prisma, getCurrentUser, decorateUserForClient, hasToolPermission, logActivity, authorization });
registerTimelineRoutes({
  app,
  prisma,
  getCurrentUser,
  logActivity,
  readSettings,
  serializeTimelineItem,
  sendRevisionConflict,
  authorization,
});
registerHealthOperationsRoutes({
  recoveryReadiness,
  apiToolReadiness,
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
  app,
  backgroundTasks,
  countFolderEntries,
  databaseDiagnostics,
  decorateUserForClient,
  getCurrentUser,
  prisma,
  processStartedAt,
  rateLimiter,
  readSettings,
  listBackupManifests,
  logSecurityEvent,
  readinessProbe,
  writableStorageProbe,
  operationalHealthSnapshot,
  operationalHealthHistory,
  requireAdminUserForRequest,
  runtimeTelemetry,
  gpuTelemetry,
  resourceGovernor,
  resourceGovernorRuntime,
  concurrentWorkLimiter,
  dataIntegrityRuntime,
  storageLifecycleRuntime,
  integrationCircuits: () => integrationsRuntime?.webhooks.circuitSnapshot() || [],
  safePersistenceRecordCount,
  stabilizationCounts,
  acceleration,
  collaborationRuntime,
  changeRuntime,
  distributedRateLimiter,
  jobRuntime,
  jobQueue,
  jobWorker,
  events: eventRuntime,
  auditService,
  get serverReady() { return serverReady; },
  get serverDraining() { return serverDraining; },
  getRuntimeMode: () => SERVER_RUNTIME_MODE,
});
registerPersistenceRoutes({
  CLUSTER_VERSION,
  app,
  buildPersistenceStorageData,
  checksumMatchesRecord,
  logActivity,
  logPersistenceAudit,
  parseJsonObject,
  persistenceKindSchema,
  prisma,
  requireAdminUserForRequest,
  serializePersistenceRecord,
  validatePersistencePayload
});
registerSetupRoutes({
  REQUIRE_DISCORD_LINK,
  app,
  cleanOptionalString,
  createSession,
  decorateUserForClient,
  defaultBoardColumnsForProjectType,
  getCurrentUser,
  getSetupStatus,
  logActivity,
  logSecurityEvent,
  normalizeProjectType,
  prisma,
  productionTracksForType,
  rateLimit,
  readSettings,
  requireAdminUserForRequest,
  saveSettings,
  mutateSettingsKeys,
  seedProductionDemoWorkspace,
  setupIsComplete
});
registerAccessAndApprovalRoutes({
  WEB_ORIGIN,
  app,
  canManageProjectAccess,
  decorateUserForClient,
  getCurrentUser,
  hashShareToken,
  hasToolPermission,
  logActivity,
  parseJsonObject,
  parseLabels,
  prisma,
  serializeProjectShareLink,
  shareLinkExpired,
  unique
});
registerMediaWhiteboardRoutes({
  AUTH_REQUIRED,
  app,
  collaborationRuntime,
  decorateUserForClient,
  authorization,
  enforceCardAccess,
  enforceTargetAccess,
  getCurrentUser,
  hasTargetAccess,
  jobQueue,
  logActivity,
  recordCommentActivityInTransaction: (tx: any, input: any) => activityService.recordInTransaction(tx, input),
  wakeCommentActivity: () => activityService.wakeCommittedActivity(),
  parseJsonObject,
  prisma,
  resolveProjectStoredFile,
  storageRuntime,
  discardStoredProjectFile,
  discardPreparedManagedBlob,
  projectFileStorageLocator,
  sendRevisionConflict,
  serializeUserLite,
  serializeReviewAsset,
  serializeWhiteboard,
  writeUpload,
  storeCompletedUpload,
  consumeUploadSession
});
registerConfigurationIntegrationRoutes({
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
  app,
  backgroundTasks,
  backupIsDue,
  backupWindowKey,
  collaborationRuntime, createPreUpgradeCheckpoint, createServerBackup,
  deleteBackupGeneration,
  decorateUserForClient,
  fetchWithTimeout,
  getCurrentUser,
  hasToolPermission,
  listBackupManifests,
  logActivity,
  prisma,
  processStartedAt,
  pruneOperationalRecords,
  rateLimiter,
  readBackupManifest, recoveryReadiness, runServerRestoreDrill,
  readQualityGateStatus,
  readSettings,
  requireAdminUserForRequest,
  requireConfirmation,
  saveSettings,
  settingsForClient,
  studioSettingsForClient,
  stripServerManagedSettings,
  patchSettings,
  verifyBackupManifest,
  verifyUserPin,
  securityTelemetry,
  auditService,
  get serverReady() { return serverReady; },
  get serverDraining() { return serverDraining; }
});
const providerRouteDeps = {
  app,
  authorization,
  buildContextPackPayload,
  getCurrentUser,
  logActivity,
  parseContextPayload,
  pickContextPackSettings,
  prisma,
  readSettings,
  saveSettings,
  settingsForClient,
  serializeCard,
  serializeContextPack
};
registerContextPackRoutes(providerRouteDeps);
const localDiscovery = createServerLocalDiscovery({
  readSettings,
  listenPort: RUNTIME_CONFIG.listenPort,
  logger: app.log,
});
const lifecycle = createServerLifecycle({
  app,
  shutdownTimeoutMs: RUNTIME_CONFIG.shutdownTimeoutMs,
  onDraining: async () => {
    serverReady = false;
    serverDraining = true;
    operationalHealthSnapshot();
    backgroundTasks.stopAll();
    settingsCoordination?.close();
    localDiscovery.stop();
    resourceGovernorRuntime.stop();
    await changeRuntime.drain();
    // Keep webhook fanout registered until the durable event worker finishes;
    // otherwise a shutdown-time claim could mark an event processed without
    // creating its required webhook deliveries. A timed-out drain is a failed
    // shutdown, not permission to unregister a still-running consumer.
    await eventRuntime.drain();
    integrationsRuntime?.webhooks.stopEventSubscription();
    await jobRuntime.drain();
    collaborationRuntime.close();
    await coordinationBus.close();
    await acceleration.close();
  },
  onClose: async () => {
    serverReady = false;
    rateLimiter.clear();
    resourceGovernorRuntime.stop();
    runtimeTelemetry.stop();
    await clearServerRuntimeMarker(DATA_LAYOUT.runtimeRoot).catch(() => undefined);
    await prisma.$disconnect();
  },
});
function managedHostTokenMatches(value: unknown) {
  if (!MANAGED_HOST_SHUTDOWN_TOKEN) return false;
  const supplied = String(Array.isArray(value) ? value[0] : value || "");
  const expectedBuffer = Buffer.from(MANAGED_HOST_SHUTDOWN_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}
if (RUNTIME_PROFILE === "managed-host" && MANAGED_HOST_SHUTDOWN_TOKEN) {
  app.post("/internal/host/shutdown", async (request, reply) => {
    if (!managedHostTokenMatches(request.headers["x-cluster-host-shutdown"])) {
      reply.code(404);
      return { ok: false, code: "ROUTE_NOT_FOUND", error: "Route not found.", requestId: String(request.id) };
    }
    reply.code(202);
    setImmediate(() => {
      void lifecycle.shutdownAndExit("managed-host");
    });
    return { ok: true, accepted: true, state: "draining", requestId: String(request.id) };
  });
}
async function readBootConfigBytesForRecovery(): Promise<string | null> {
  try { return await fs.readFile(CONFIG_FILE_PATH, "utf8"); }
  catch (error: any) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function startClusterServer() {
  lifecycle.installSignalHandlers();
  await runServerStartup({
    app,
    shutdown: lifecycle.shutdown,
    prepare: async () => {
      await ensureDataFolders();
      await withDatabaseBootstrapLock(prisma as any, DATABASE_URL, async () => {
        await configurePostgresqlRuntime(prisma as any, DATABASE_URL, app.log);
        await verifyPostgresqlSchema(prisma as any, app.log);
        // Reconcile DB/file publication before startup background mutations or
        // requests. If recovery changes boot config, refuse stale runtime boot.
        const bootConfigBeforeRecovery = await readBootConfigBytesForRecovery();
        const configRecovery = await recoverPendingConfigPublication();
        if (configRecovery !== "none") {
          const bootConfigAfterRecovery = await readBootConfigBytesForRecovery();
          if (bootConfigBeforeRecovery !== bootConfigAfterRecovery) {
            throw new Error("Server configuration recovered to a different boot state. Restart Cluster so runtime parameters reload safely.");
          }
        }
        await syncEditableDataMirrors(prisma, DATA_LAYOUT);
        if (RUNTIME_CONFIG.autoSeed) await ensureDemoData();
      }, { timeoutMs: RUNTIME_CONFIG.databaseBootstrapLockTimeoutMs, logger: app.log });
      if (RUNTIME_CONFIG.bootConfigWarning) app.log.warn(RUNTIME_CONFIG.bootConfigWarning);
    },
    listen: async () => {
      await app.listen({ port: RUNTIME_CONFIG.listenPort, host: RUNTIME_CONFIG.listenHost });
    },
    onReady: async () => {
      serverDraining = false;
      await acceleration.start();
      await coordinationBus.start();
      resourceGovernorRuntime.start();
      serverReady = true;
      const [database, storage] = await Promise.all([readinessProbe.check(true), writableStorageProbe.check(true)]);
      const operational = operationalHealthSnapshot(database, storage);
      const intentionallyHeld = SERVER_RUNTIME_MODE === "maintenance" || SERVER_RUNTIME_MODE === "recovery";
      if (!operational.ready && !intentionallyHeld) throw new Error(`Cluster readiness failed after listen: ${operational.state}`);
      if (intentionallyHeld) app.log.warn({ serverMode: SERVER_RUNTIME_MODE, state: operational.state }, "Cluster started with workspace runtime intentionally held");
      await writeServerRuntimeMarker(DATA_LAYOUT.runtimeRoot, CLUSTER_VERSION);
      await localDiscovery.start();
      // Apply persisted availability before registering owned periodic work.
      const bootToolSettings = await readSettings();
      reconcileToolAvailability(bootToolSettings);
      if (SERVER_RUNTIME_MODE === "normal") {
        integrationsRuntime?.webhooks.startEventSubscription();
        await changeRuntime.start();
        // Assignment changes are durable invalidation/change signals consumed
        // by the wildcard owners. Their canonical assignments live in the
        // domain tables, not a second event-fed materialized state table.
        // Do not register an assignment-specific subscriber without a real
        // projection and an explicit historical replay/backfill strategy.
        eventRuntime.start([
          { key: "resource-change-runtime-wake", type: "*" },
          { key: "projects.read-model-invalidation", type: "*" },
          { key: "integrations.webhooks", type: "*" },
          { key: "notifications.materialize-activity", type: CLUSTER_DOMAIN_EVENTS.activityRecorded.type },
          { key: "automation.studio-activity", type: CLUSTER_DOMAIN_EVENTS.activityRecorded.type },
          { key: "projects.automation-activity", type: CLUSTER_DOMAIN_EVENTS.activityRecorded.type },
          { key: "search.activity-changes", type: CLUSTER_DOMAIN_EVENTS.activityRecorded.type },
        ]);
        jobRuntime.start();
        void notificationService.initialize()
          .then((result) => app.log.info(result, "notification inbox backfill complete"))
          .catch((error) => app.log.warn(error, "notification inbox backfill failed"));
      } else {
        app.log.info({ serverMode: SERVER_RUNTIME_MODE }, "Background mutation runtimes are paused until Cluster returns to normal mode");
      }
      startBackgroundTasks();
      // One bounded local dependency sampling loop, not a timer per tool or
      // dashboard viewer. It is intentionally separate from traffic metrics.
      backgroundTasks.scheduleAdaptive("api-tool-dependency-readiness", 120_000, async () => {
        const nextDelayMs = operationsCadenceMilliseconds("operationsReadinessIntervalMinutes", (await readSettings()).operationsReadinessIntervalMinutes);
        await apiToolReadiness.sample();
        if (backgroundMutationPermitted()) {
          const evidence = apiToolReadiness.snapshot([]);
          const candidates = dependencyIncidentDetector.evaluate(evidence);
          if (candidates.length) {
            // Failure of the durable write is visible to the BackgroundTaskRegistry,
            // which backs off and retries. No duplicate event or inbox on retry.
            await reconcileDependencyIncidents({ prisma, candidates,
              onCommitted: (records) => {
                for (const userId of new Set(records.map((record: any) => String(record.userId)))) {
                  notificationService.invalidateSummary(userId);
                }
                notificationService.publishRecords(records);
              },
            });
          }
        }
        return { nextDelayMs };
      }, { runImmediately: true, maxBackoffMs: 15 * 60_000, slowTaskMs: 15_000, workloadClass: "maintenance" });
      // A local Settings write notifies this process immediately. A separate
      // server process may update the same database without sending that local
      // callback; reconcile from DB truth on a bounded cadence as a fallback.
      // This is eventual cross-process convergence, not an instantaneous
      // distributed revocation guarantee; API authorization stays authoritative.
      // One bounded escalation sweep for durable, unacknowledged incidents.
      // The dispatch receipt key fences duplicate Inbox messages across workers.
      backgroundTasks.scheduleAdaptive("operations-incident-alert-escalation", 120_000, async () => {
        const nextDelayMs = operationsCadenceMilliseconds("operationsEscalationIntervalMinutes", (await readSettings()).operationsEscalationIntervalMinutes);
        if (!backgroundMutationPermitted()) return { nextDelayMs };
        await reconcileIncidentEscalations({ prisma, onCommitted: (records) => {
          for (const userId of new Set(records.map((record: any) => String(record.userId)))) {
            notificationService.invalidateSummary(userId);
          }
          notificationService.publishRecords(records);
        } });
        return { nextDelayMs };
      }, { runImmediately: false, maxBackoffMs: 15 * 60_000, slowTaskMs: 15_000, workloadClass: "maintenance" });
      // Native Host and Launcher write this spool even while the database or
      // Node API is down. Reconcile only in writable mode after readiness,
      // never from a browser request and never by deleting native evidence.
      backgroundTasks.scheduleAdaptive("native-emergency-incident-reconcile", 120_000, async () => {
        const nextDelayMs = operationsCadenceMilliseconds("operationsNativeReconcileIntervalMinutes", (await readSettings()).operationsNativeReconcileIntervalMinutes);
        if (!backgroundMutationPermitted()) return { nextDelayMs };
        const journal = await readNativeJournal(BOOT_WORKSPACE_ROOT);
        if (journal.invalid) app.log.warn({ invalid: journal.invalid }, "Invalid native emergency journal entries ignored");
        if (journal.events.length) {
          // Query receipts once for the bounded journal. Filtering before the
          // 32-event transaction budget prevents a full historical journal
          // from permanently starving newer events behind old duplicates.
          const pending = await findUnreconciledNativeEvents(prisma, journal.events);
          if (pending.length) await reconcileNativeEmergencyEvents({ prisma, events: pending,
            onCommitted: (records) => {
              for (const userId of new Set(records.map((record: any) => String(record.userId)))) {
                notificationService.invalidateSummary(userId);
              }
              notificationService.publishRecords(records);
            },
          });
        }
        return { nextDelayMs };
      }, { runImmediately: true, maxBackoffMs: 15 * 60_000, slowTaskMs: 20_000, workloadClass: "maintenance" });
      backgroundTasks.scheduleAdaptive("studio-tool-availability-reconcile", 60_000, async () => {
        const authoritative = await readSettings(true);
        reconcileToolAvailability(authoritative);
        reconcileOperationsCadence(authoritative);
        return { nextDelayMs: 60_000 };
      }, { runImmediately: false, maxBackoffMs: 120_000, workloadClass: "interactive" });
      backgroundTasks.scheduleAdaptive("distributed-rate-limit-prune", 60 * 60 * 1000, async () => {
        if (!backgroundMutationPermitted()) return { nextDelayMs: 60 * 60 * 1000 };
        await distributedRateLimiter.prune();
      }, { runImmediately: false, maxBackoffMs: 6 * 60 * 60 * 1000, workloadClass: "maintenance" });
      backgroundTasks.scheduleAdaptive("data-integrity-reconcile", 6 * 60 * 60 * 1000, async () => {
        const nextDelayMs = operationsCadenceMilliseconds("operationsIntegrityScanHours", (await readSettings()).operationsIntegrityScanHours);
        if (!backgroundMutationPermitted()) return { nextDelayMs };
        await dataIntegrityRuntime.scan();
        return { nextDelayMs };
      }, { runImmediately: true, maxBackoffMs: 24 * 60 * 60 * 1000, slowTaskMs: 120_000, workloadClass: "maintenance" });
      backgroundTasks.scheduleAdaptive("storage-lifecycle", 60 * 60 * 1000, async () => {
        if (!backgroundMutationPermitted()) return { nextDelayMs: 60 * 60 * 1000 };
        await storageLifecycleRuntime.run();
      }, { runImmediately: false, maxBackoffMs: 12 * 60 * 60 * 1000, slowTaskMs: 30 * 60_000, workloadClass: "maintenance" });
      backgroundTasks.scheduleAdaptive("storage-browser-upload-probe", 15 * 60 * 1000, async () => {
        if (!backgroundMutationPermitted()) return { nextDelayMs: 15 * 60 * 1000 };
        await storageRuntime.browserDirectUploadCapability(WEB_ORIGIN);
      }, { runImmediately: true, maxBackoffMs: 6 * 60 * 60 * 1000, slowTaskMs: 30_000, workloadClass: "maintenance" });
      // Initialize cadence tracking only after all four authoritative jobs are
      // registered. Unrelated settings changes must not reset error backoff.
      for (const key of Object.keys(operationsCadenceTasks) as Array<keyof typeof operationsCadenceTasks>) {
        operationsCadenceLastApplied.set(key, operationsCadenceMilliseconds(key, bootToolSettings[key]));
      }
      app.log.info(
        { version: CLUSTER_VERSION, host: RUNTIME_CONFIG.listenHost, port: RUNTIME_CONFIG.listenPort, dataRoot: DATA_ROOT, apiRequestBudget: { enabled: RATE_LIMIT_ENABLED, perMinuteWindowLimit: API_RATE_LIMIT_MAX, windowMs: API_RATE_LIMIT_WINDOW_MS } },
        "Cluster server ready",
      );
    },
  });
}
