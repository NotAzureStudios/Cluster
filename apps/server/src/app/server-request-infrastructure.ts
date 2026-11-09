import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { API_CONTRACT } from "@cluster/shared";
import { BoundedWarningGate } from "../core/bounded-warning-gate.js";
import { apiReadContractFor, evaluateReadBudget } from "../core/api-read-contracts.js";
import { apiOperationLabel, normalizeApiErrorBody } from "../core/api-response.js";
import { accountNextStep, accountStateAllowsWorkspace, REAUTH_WINDOW_MS, sessionRecentlyAuthenticated } from "../core/auth.js";
import { normalizeHttpError } from "../core/http-errors.js";
import { assessRuntimeSaturation } from "../core/operational-health.js";
import type { ResourceGovernor } from "../core/resource-governor.js";
import { ensureSessionPolicyAcceptance } from "../core/policy-acceptance.js";
import { apiTransportRateLimitPolicy, authTransportRateLimitPolicy, boundedPayloadStream, requestWorkPolicy, userScopedRateLimitPolicy } from "../core/request-workload.js";
import { hasValidSecurityVerification, highRiskSecurityVerificationPurpose, strongerVerificationStrength } from "../core/security-verification.js";
import { normalizeStudioSecurityPolicy, securityPolicyHighRiskVerificationStrength } from "../core/studio-security-policy.js";
import { enterReliabilityContext, updateReliabilityContext } from "../core/reliability-context.js";
import { csrfProtectionRequired, reauthPolicyForRequest } from "../core/session-security.js";
import { clientCompatibility } from "../core/openapi.js";
import { safeErrorForLog, sanitizeClientCorrelationId, sanitizeRequestPath } from "../core/security-observability.js";
import { publicServerRuntimeState, runtimeRequestDecision, type ClusterRuntimeAccessMode } from "../core/runtime-access-state.js";
import { securityAuditPolicyForRequest } from "../core/security-audit-policy.js";
import { enforceMfaEnrollmentRestriction, enforceStudioMfaPolicyBoundary } from "../domains/auth/mfa-policy-boundary.js";
import { requestContextFor, setRequestActorContext } from "../domains/access/request-context.js";
import { isConfigurableToolCapability } from "../domains/access/configurable-tool-availability.js";
import { setRequestDeviceProof, verifyDeviceProofForRequest } from "../domains/sessions/device-proof.js";
import { serverUpdateMaintenanceHeld } from "../core/server-update-maintenance.js";

type ServerRequestInfrastructureDeps = {
  app: FastifyInstance;
  prisma: any;
  dataRoot: string;
  runtimeConfig: any;
  configuredCorsOrigins: ReadonlySet<string>;
  sessionSecret: string;
  clusterVersion: string;
  authRequired: boolean;
  requireDiscordLink: boolean;
  sessionDays: number;
  sessionIdleHours: number;
  sessionMaxPerUser: number;
  apiRateLimitMax: number;
  apiRateLimitWindowMs: number;
  authRateLimitMax: number;
  uploadLimitBytes: number;
  avatarUploadLimitBytes: number;
  concurrentWorkLimiter: { acquire(workClass: string, keys: { clientKey: string; workspaceKey?: string | null }): (() => void) | null };
  resourceGovernor: ResourceGovernor;
  runtimeTelemetry: any;
  securityTelemetry: any;
  databaseDiagnostics: any;
  auditService: any;
  getServerState: () => { ready: boolean; draining: boolean; mode: ClusterRuntimeAccessMode };
  securityHeaders: (reply: FastifyReply) => void;
  mutationOriginAllowed: (request: FastifyRequest) => boolean;
  mutationOriginDecision: (request: FastifyRequest) => { allowed: boolean; reason: string; evidence: string };
  rateLimit: (request: FastifyRequest, reply: FastifyReply, bucketName: string, limit: number, windowMs: number, cost?: number) => Promise<boolean>;
  rateLimitKey: (reply: FastifyReply, key: string, limit: number, windowMs: number) => Promise<boolean>;
  getClientKey: (request: FastifyRequest) => string;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>;
  clearSessionCookies: (reply: FastifyReply) => void;
  csrfTokenMatches: (sessionId: string, supplied: unknown) => boolean;
  decorateUserForClient: (user: any) => Promise<any>;
  kioskRuntime: any;
  isUserAccessExpired: (user: any) => boolean;
  studioPermissionSettings: any;
  onSessionRevoked: (sessionId: string, userId: string, reason: string) => void;
  onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void;
  hasToolPermission: (user: any, role: any, tool: string, minimum?: string) => boolean;
  disabledToolLabel: (tool: string | null, settings: any) => string | null;
  readSettings: () => Promise<any>;
  authorizeRequestBoundary: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  requestIpAddress: (request?: FastifyRequest) => string | null;
  requestUserAgent: (request?: FastifyRequest) => string | null;
};

export async function registerServerRequestInfrastructure(deps: ServerRequestInfrastructureDeps) {
  const {
    app, prisma, dataRoot, runtimeConfig, configuredCorsOrigins, sessionSecret, clusterVersion, authRequired, requireDiscordLink,
    sessionDays, sessionIdleHours, sessionMaxPerUser, apiRateLimitMax, apiRateLimitWindowMs, authRateLimitMax,
    uploadLimitBytes, avatarUploadLimitBytes,
    concurrentWorkLimiter, resourceGovernor, runtimeTelemetry, securityTelemetry, databaseDiagnostics, auditService, getServerState,
    securityHeaders, mutationOriginAllowed, mutationOriginDecision, rateLimit, rateLimitKey, getClientKey, getCurrentSession, clearSessionCookies,
    csrfTokenMatches, decorateUserForClient, kioskRuntime, isUserAccessExpired, studioPermissionSettings,
    onSessionRevoked, onUserSessionsRevoked, hasToolPermission, disabledToolLabel, readSettings, authorizeRequestBoundary,
    requestIpAddress, requestUserAgent,
  } = deps;

  const requestWarningGate = new BoundedWarningGate(60_000, 256);
  const requestTelemetryStarts = new WeakMap<FastifyRequest, bigint>();
  const requestWorkPolicies = new WeakMap<FastifyRequest, ReturnType<typeof requestWorkPolicy>>();
  const requestWorkReleases = new WeakMap<FastifyRequest, () => void>();

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || configuredCorsOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by Cluster local CORS: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept", "Content-Type", "X-Client-Request-Id", "X-Cluster-Client-Version", "X-Cluster-Client-Host",
      "X-Cluster-Client-Protocol", "X-Cluster-Idempotency-Key", "X-Cluster-Confirmation", "X-Cluster-CSRF",
      "X-Cluster-Device-Id", "X-Cluster-Device-Proof-Timestamp", "X-Cluster-Device-Proof-Signature", "X-Cluster-Device-Proof-Public-Key", "X-Cluster-Device-Proof-Algorithm",
      "X-Cluster-Base-Revision", "Range", "If-Range", "Content-Range", "If-None-Match", "If-Modified-Since",
    ],
    exposedHeaders: [
      "X-Request-Id", "X-Client-Request-Id", "X-Cluster-Version", "X-Cluster-Api-Contract",
      "X-Cluster-Minimum-Client-Version", "X-Cluster-Transport-Protocol", "X-Cluster-Client-Compatibility",
      "X-Cluster-Client-Protocol-Compatibility", "X-Cluster-Server-State", "X-Cluster-Server-Mode", "X-Cluster-CSRF-Invalid", "X-Cluster-Resource-Revision",
      "X-Cluster-Correlation-Id", "X-Cluster-Original-Correlation-Id", "X-Cluster-Rate-Limit-Bucket", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "ETag", "Retry-After",
      "Accept-Ranges", "Content-Range", "Content-Length", "Content-Encoding", "Content-Disposition",
      "X-Cluster-Saturation", "X-Cluster-Governor", "X-Cluster-Backpressure",
    ],
  });

  await app.register(cookie, { secret: sessionSecret });
  await app.register(compress, {
    global: true,
    encodings: ["br", "gzip", "deflate"],
    threshold: 1024,
    customTypes: /^(?:application\/(?:json|javascript)|text\/)/i,
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeHttpError(error, String(request.id));
    if (normalized.logLevel === "error") {
      request.log.error({ err: safeErrorForLog(error), requestId: request.id, method: request.method, url: sanitizeRequestPath(request.url, request.routeOptions.url) }, "request failed");
    }
    reply.code(normalized.statusCode).send(normalized.body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      ok: false,
      error: request.url.startsWith("/api/") ? "API route not found." : "Route not found.",
      code: "ROUTE_NOT_FOUND",
      requestId: String(request.id),
    });
  });

  app.addHook("onRequest", async (request, reply) => {
    requestTelemetryStarts.set(request, runtimeTelemetry.begin());
    const context = requestContextFor(request);
    const { pathname } = context.policy;
    securityHeaders(reply);
    const clientCorrelationId = sanitizeClientCorrelationId(request.headers["x-client-request-id"]);
    enterReliabilityContext({ correlationId: clientCorrelationId || String(request.id), requestId: String(request.id) });
    if (clientCorrelationId) reply.header("X-Client-Request-Id", clientCorrelationId);
    reply.header("X-Cluster-Correlation-Id", clientCorrelationId || String(request.id));
    reply.header("X-Request-Id", request.id);
    reply.header("X-Cluster-Version", clusterVersion);
    reply.header("X-Cluster-Api-Contract", API_CONTRACT.version);
    reply.header("X-Cluster-Minimum-Client-Version", API_CONTRACT.minimumClientVersion);
    reply.header("X-Cluster-Transport-Protocol", API_CONTRACT.clients.transportProtocolVersion);
    if (!pathname.startsWith("/health") && await serverUpdateMaintenanceHeld(dataRoot)) {
      reply.header("Cache-Control", "no-store");
      reply.header("Retry-After", "5");
      reply.header("X-Cluster-Server-State", "maintenance");
      reply.code(503).send({ ok: false, code: "SERVER_UPDATE_HOLD",
        error: "Cluster is verifying a managed Server update. API access is temporarily held.", retryable: true });
      return;
    }
    const serverState = getServerState();
    reply.header("X-Cluster-Server-State", publicServerRuntimeState(serverState));
    reply.header("X-Cluster-Server-Mode", serverState.mode);
    const saturation = assessRuntimeSaturation(runtimeTelemetry.snapshot());
    const governorSnapshot = resourceGovernor.snapshot();
    reply.header("X-Cluster-Saturation", saturation.state);
    reply.header("X-Cluster-Governor", governorSnapshot.mode);

    const workPolicy = requestWorkPolicy({ pathname, method: request.method, globalBodyLimitBytes: runtimeConfig.bodyLimit, uploadLimitBytes, avatarUploadLimitBytes });
    requestWorkPolicies.set(request, workPolicy);
    reply.header("X-Cluster-Request-Cost", String(workPolicy.cost));
    reply.header("X-Cluster-Work-Class", workPolicy.workClass);
    const admission = resourceGovernor.admissionFor(workPolicy.workClass);
    if (!admission.allow && context.policy.isApi && !pathname.startsWith("/api/meta/") && !pathname.startsWith("/health")) {
      const retryAfter = String(admission.retryAfterSeconds || 3);
      reply.header("Retry-After", retryAfter);
      reply.header("X-Cluster-Backpressure", resourceGovernor.snapshot().mode);
      reply.code(503).send({
        ok: false,
        code: "SERVER_SATURATED",
        error: workPolicy.workClass === "normal"
          ? "Cluster is temporarily saturated and is shedding new work to protect active sessions."
          : "Cluster is protecting interactive capacity and has deferred this expensive operation.",
        action: "Retry after the indicated delay.",
        retryable: true,
        requestId: String(request.id),
        contractVersion: API_CONTRACT.version,
        details: { mode: resourceGovernor.snapshot().mode, workClass: workPolicy.workClass, reason: admission.reason },
      });
      return;
    }
    const declaredLength = Number(Array.isArray(request.headers["content-length"]) ? request.headers["content-length"][0] : request.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > workPolicy.bodyLimitBytes) {
      reply.code(413).send({ ok: false, code: "BODY_TOO_LARGE", error: "Request body exceeds the limit for this Cluster operation.", retryable: false, requestId: String(request.id), contractVersion: API_CONTRACT.version, details: { maximumBytes: workPolicy.bodyLimitBytes } });
      return;
    }
    databaseDiagnostics.beginRequest(String(request.id), request.routeOptions.url || pathname);
    if (context.policy.isApi) reply.header("Cache-Control", "no-store");

    const rawClientProtocol = request.headers["x-cluster-client-protocol"];
    const clientProtocolText = Array.isArray(rawClientProtocol) ? rawClientProtocol[0] : rawClientProtocol;
    if (clientProtocolText !== undefined) {
      const clientProtocol = Number(clientProtocolText);
      const minimumProtocol = API_CONTRACT.clients.minimumTransportProtocolVersion;
      const maximumProtocol = API_CONTRACT.clients.transportProtocolVersion;
      const protocolCompatible = Number.isInteger(clientProtocol) && clientProtocol >= minimumProtocol && clientProtocol <= maximumProtocol;
      reply.header("X-Cluster-Client-Protocol-Compatibility", protocolCompatible ? "COMPATIBLE" : "UNSUPPORTED");
      if (!protocolCompatible && pathname !== "/api/meta/compatibility" && !pathname.startsWith("/health")) {
        reply.code(426).send({ ok: false, code: "CLIENT_UPGRADE_REQUIRED", error: `This Cluster client uses transport protocol ${String(clientProtocolText)}, but the server supports ${minimumProtocol}-${maximumProtocol}.`, action: "Update this client to the server release, then reconnect.", retryable: false, requestId: String(request.id), contractVersion: API_CONTRACT.version, details: { clientProtocol: String(clientProtocolText), minimumProtocol, maximumProtocol } });
        return;
      }
    } else reply.header("X-Cluster-Client-Protocol-Compatibility", "UNDECLARED");

    const rawClientVersion = request.headers["x-cluster-client-version"];
    const clientVersion = Array.isArray(rawClientVersion) ? rawClientVersion[0] : rawClientVersion;
    if (clientVersion) {
      const compatibility = clientCompatibility(String(clientVersion), clusterVersion);
      reply.header("X-Cluster-Client-Compatibility", compatibility.reason);
      const compatibilityPath = pathname === "/api/meta/compatibility" || pathname.startsWith("/health");
      if (!compatibility.compatible && !compatibilityPath) {
        const rawClientHost = request.headers["x-cluster-client-host"];
        const clientHost = String(Array.isArray(rawClientHost) ? rawClientHost[0] : rawClientHost || "unknown").slice(0, 32);
        const warningKey = `${clientHost}:${clientVersion}:${compatibility.reason}`;
        const warning = requestWarningGate.check(`client-compat:${warningKey}`);
        if (warning.emit) app.log.warn({ clientVersion, clientHost, reason: compatibility.reason, suppressedRepeats: warning.suppressedRepeats }, "Cluster rejected an incompatible client");
        reply.code(426).send({ ok: false, code: "CLIENT_UPGRADE_REQUIRED", error: `Cluster ${clientVersion} is not compatible with server ${clusterVersion}.`, action: "Update this client to the server release, then reconnect.", retryable: false, requestId: String(request.id), contractVersion: API_CONTRACT.version, details: { clientVersion: String(clientVersion), serverVersion: clusterVersion, minimumClientVersion: API_CONTRACT.minimumClientVersion, reason: compatibility.reason } });
        return;
      }
    } else reply.header("X-Cluster-Client-Compatibility", "UNDECLARED");

    if (serverState.draining && context.policy.isApi && !pathname.startsWith("/api/meta/")) {
      reply.header("Retry-After", "5");
      reply.header("Connection", "close");
      reply.code(503).send({ ok: false, code: "SERVICE_UNAVAILABLE", error: "Cluster is restarting and is not accepting new API work.", action: "Reconnect after the server finishes restarting.", retryable: true, requestId: String(request.id), contractVersion: API_CONTRACT.version });
      return;
    }
    if (!serverState.draining && context.policy.isApi) {
      const runtimeDecision = runtimeRequestDecision({ mode: serverState.mode, pathname, method: request.method });
      if (!runtimeDecision.allowed) {
        reply.header("Retry-After", runtimeDecision.status === 503 ? "5" : "3");
        reply.code(runtimeDecision.status || 503).send({
          ok: false,
          code: runtimeDecision.code,
          error: runtimeDecision.error,
          action: runtimeDecision.action,
          retryable: runtimeDecision.retryable,
          requestId: String(request.id),
          contractVersion: API_CONTRACT.version,
          details: { serverMode: serverState.mode, serverState: publicServerRuntimeState(serverState) },
        });
        return;
      }
    }
    const originDecision = mutationOriginDecision(request);
    if (!originDecision.allowed) {
      securityTelemetry.record("request.origin_blocked", "FAILURE");
      const warning = requestWarningGate.check(`origin:${request.routeOptions.url || pathname}:${originDecision.reason}`);
      if (warning.emit) request.log.warn({ reason: originDecision.reason, evidence: originDecision.evidence, suppressedRepeats: warning.suppressedRepeats }, "mutation request blocked by request-integrity policy");
      reply.code(403).send({
        ok: false,
        code: "REQUEST_INTEGRITY_BLOCKED",
        error: "This mutation request did not pass Cluster request-integrity checks.",
        action: "Retry from the Cluster client. If this continues, refresh the client session.",
        retryable: true,
      });
      return;
    }
    const authTransportPolicy = authTransportRateLimitPolicy({ pathname, method: request.method, authRateLimitMax });
    const isExternalToolPath = pathname.startsWith("/api/admin/discord") || /^\/api\/projects\/[^/]+\/discord(?:\/|$)/.test(pathname) || pathname.startsWith("/api/integrations/discord") || pathname.includes("/source-control");
    if (authTransportPolicy && await rateLimit(request, reply, authTransportPolicy.bucketName, authTransportPolicy.limit, apiRateLimitWindowMs)) {
      securityTelemetry.record(authTransportPolicy.bucketName === "security-transport" ? "request.security_rate_limited" : "request.auth_rate_limited", "FAILURE");
      return;
    }
    if (isExternalToolPath && await rateLimit(request, reply, "external", Math.max(30, Math.floor(apiRateLimitMax / 3)), apiRateLimitWindowMs)) {
      securityTelemetry.record("request.external_rate_limited", "FAILURE");
      return;
    }
    if (context.policy.isApi) {
      const traffic = apiTransportRateLimitPolicy({ pathname, method: request.method, apiRateLimitMax });
      if (await rateLimit(request, reply, traffic.bucketName, traffic.limit, apiRateLimitWindowMs, workPolicy.cost)) {
        const warning = requestWarningGate.check(`api-limit:${request.routeOptions.url || traffic.bucketName}:${request.method}:${traffic.bucketName}`);
        if (warning.emit) request.log.warn({ route: request.routeOptions.url || traffic.bucketName, method: request.method, bucket: traffic.bucketName, cost: workPolicy.cost, limit: traffic.limit, configuredLimit: apiRateLimitMax, windowMs: apiRateLimitWindowMs, suppressedRepeats: warning.suppressedRepeats }, "Cluster API traffic budget exhausted");
        securityTelemetry.record("request.api_rate_limited", "FAILURE");
        return;
      }
    }
  });

  app.addHook("preParsing", async (request, _reply, payload) => {
    const policy = requestWorkPolicies.get(request);
    if (!policy || !requestContextFor(request).policy.isApi || !payload) return payload;
    return boundedPayloadStream(payload, policy.bodyLimitBytes);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const readContract = apiReadContractFor(request.method, request.routeOptions.url);
    if (readContract && reply.statusCode < 400 && (typeof payload === "string" || Buffer.isBuffer(payload))) {
      const payloadBytes = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload, "utf8");
      if (payloadBytes > readContract.budget.maxPayloadBytes) {
        const detail = `payloadBytes ${payloadBytes}/${readContract.budget.maxPayloadBytes}`;
        databaseDiagnostics.recordBudgetViolation({ contractId: readContract.id, route: readContract.route, kind: "payload", detail });
        const warning = requestWarningGate.check(`read-payload:${readContract.id}`);
        if (warning.emit) request.log.warn({ contractId: readContract.id, payloadBytes, maximumBytes: readContract.budget.maxPayloadBytes, suppressedRepeats: warning.suppressedRepeats }, "read-model payload budget exceeded");
      }
    }
    if (reply.statusCode < 400 || !requestContextFor(request).policy.isApi || typeof payload !== "string") return payload;
    const contentType = String(reply.getHeader("content-type") || "");
    if (!contentType.includes("application/json")) return payload;
    try {
      return JSON.stringify(normalizeApiErrorBody(JSON.parse(payload), String(request.id), reply.statusCode, { operation: apiOperationLabel(request) }));
    } catch {
      return payload;
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const releaseWork = requestWorkReleases.get(request);
    if (releaseWork) { requestWorkReleases.delete(request); releaseWork(); }
    const startedAt = requestTelemetryStarts.get(request);
    if (startedAt) {
      requestTelemetryStarts.delete(request);
      runtimeTelemetry.complete(startedAt, request.routeOptions.url || "/unmatched", reply.statusCode);
    }
    const querySample = databaseDiagnostics.completeRequest(String(request.id));
    const readContract = apiReadContractFor(request.method, request.routeOptions.url);
    if (querySample && readContract) {
      const violations = evaluateReadBudget(querySample, readContract);
      if (violations.length) {
        const detail = violations.join(", ");
        databaseDiagnostics.recordBudgetViolation({ contractId: readContract.id, route: readContract.route, kind: "query", detail });
        const warning = requestWarningGate.check(`read-query:${readContract.id}:${violations.join(",")}`);
        if (warning.emit) request.log.warn({ contractId: readContract.id, querySample, budget: readContract.budget, violations, suppressedRepeats: warning.suppressedRepeats }, "read-model query budget exceeded");
      }
    }
    if (reply.statusCode === 401) securityTelemetry.record("request.unauthorized", "FAILURE");
    else if (reply.statusCode === 403) securityTelemetry.record("request.forbidden", "FAILURE");
    else if (reply.statusCode === 429) securityTelemetry.record("request.rate_limited", "FAILURE");
    else if (reply.statusCode >= 500) securityTelemetry.record("request.server_error", "FAILURE");

    const pathname = requestContextFor(request).policy.pathname;
    const policy = securityAuditPolicyForRequest(pathname, request.method, reply.statusCode);
    if (!policy) return;
    const clusterUser = (request as FastifyRequest & { clusterUser?: { id: string } }).clusterUser;
    const session = await getCurrentSession(request).catch(() => null);
    const auditWrite = await auditService.recordSecurity({
      event: policy.event,
      actorUserId: clusterUser?.id || session?.user?.id || null,
      result: policy.result,
      reasonCode: policy.reasonCode,
      requestId: String(request.id || "") || null,
      requestMethod: request.method,
      requestPath: sanitizeRequestPath(pathname, request.routeOptions.url),
      sessionId: session?.id || null,
      ipAddress: requestIpAddress(request),
      userAgent: requestUserAgent(request),
      metadata: { category: policy.category, statusCode: reply.statusCode, route: request.routeOptions.url || pathname },
    });
    if (!auditWrite.ok) securityTelemetry.record("security.audit_write_failed", "FAILURE");
  });

  app.addHook("onRequestAbort", async (request) => {
    const releaseWork = requestWorkReleases.get(request);
    if (releaseWork) { requestWorkReleases.delete(request); releaseWork(); }
    const startedAt = requestTelemetryStarts.get(request);
    if (!startedAt) return;
    requestTelemetryStarts.delete(request);
    runtimeTelemetry.abandon(startedAt, request.routeOptions.url || "/unmatched");
    databaseDiagnostics.completeRequest(String(request.id));
  });

  app.addHook("preHandler", async (request, reply) => {
    const context = requestContextFor(request);
    const { policy } = context;
    if (!policy.isApi) return;

    const session = await getCurrentSession(request);
    if (session && csrfProtectionRequired(policy.pathname, policy.method)) {
      const suppliedCsrf = request.headers["x-cluster-csrf"];
      if (!csrfTokenMatches(session.id, Array.isArray(suppliedCsrf) ? suppliedCsrf[0] : suppliedCsrf)) {
        securityTelemetry.record("request.csrf_blocked", "FAILURE");
        reply.header("X-Cluster-CSRF-Invalid", "1");
        reply.code(403).send({ ok: false, code: "CSRF_TOKEN_INVALID", error: "The request could not be verified. Refresh Cluster and try again.", action: "Refresh the client to renew its session request token.", retryable: true });
        return;
      }
    }

    if (policy.access.kind === "public" || !authRequired) return;
    if (!session) {
      clearSessionCookies(reply);
      const invalidationCode = String((request as FastifyRequest & { clusterSessionInvalidationCode?: string }).clusterSessionInvalidationCode || "");
      if (invalidationCode === "DEVICE_BINDING_MISMATCH") {
        reply.header("Clear-Site-Data", '"cookies"');
        reply.code(401).send({ ok: false, signedOut: true, code: invalidationCode, error: "This session is bound to a different device installation. Sign in again on this installation." });
      } else {
        reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
      }
      return;
    }

    const user = session.user;
    (request as FastifyRequest & { clusterUser?: { id: string } }).clusterUser = { id: user.id };
    const decorated = await decorateUserForClient(user);
    const userRatePolicy = userScopedRateLimitPolicy({ pathname: policy.pathname, method: policy.method, apiRateLimitMax });
    if (userRatePolicy && await rateLimitKey(reply, `user-scope:${user.id}:${userRatePolicy.bucketName}`, userRatePolicy.limit, apiRateLimitWindowMs)) {
      securityTelemetry.record(`request.${userRatePolicy.bucketName}_rate_limited`, "FAILURE");
      return;
    }
    const kioskProfile = await kioskRuntime.resolve(request, session.id);
    setRequestActorContext(request, {
      userId: user.id,
      sessionId: session.id,
      workspaceId: decorated?.workspaceId ? String(decorated.workspaceId) : null,
      workspaceRole: decorated?.workspaceRole ? String(decorated.workspaceRole) : null,
      isAdmin: Boolean(decorated?.isAdmin),
      kioskProfileId: kioskProfile?.id || null,
    });
    const deviceProof = await verifyDeviceProofForRequest(prisma, request, session).catch(() => ({ present: true, verified: false, code: "invalid" as const, deviceId: session.deviceId || null, keyFingerprint: null, verifiedAt: null }));
    setRequestDeviceProof(request, deviceProof);
    if (deviceProof.present && !deviceProof.verified) securityTelemetry.record(`device.proof_${deviceProof.code}`, "FAILURE");
    if (deviceProof.code === "revoked" || deviceProof.code === "device_mismatch") {
      const reason = deviceProof.code === "revoked" ? "device_revoked" : "device_binding_mismatch";
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: reason } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, reason);
      clearSessionCookies(reply);
      reply.header("Clear-Site-Data", '"cookies"');
      reply.code(401).send({ ok: false, signedOut: true, code: deviceProof.code === "revoked" ? "DEVICE_REVOKED" : "DEVICE_BINDING_MISMATCH", error: deviceProof.code === "revoked" ? "This device was revoked. Sign in again to continue." : "This session is bound to a different device installation. Sign in again on this installation." });
      return;
    }
    updateReliabilityContext({
      userId: user.id,
      workspaceId: decorated?.workspaceId ? String(decorated.workspaceId) : null,
    });
    if (kioskProfile) {
      (request as FastifyRequest & { clusterKioskProfile?: typeof kioskProfile }).clusterKioskProfile = kioskProfile;
      const kioskDecision = await kioskRuntime.enforce(kioskProfile, request);
      if (!kioskDecision.ok) {
        reply.code(403).send({ ok: false, code: kioskDecision.code, error: kioskDecision.message, kioskProfileId: kioskProfile.id });
        return;
      }
    }

    if (isUserAccessExpired(user)) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: "access_expired" } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, "access_expired");
      clearSessionCookies(reply);
      reply.header("Clear-Site-Data", '"cookies"');
      reply.code(403).send({ ok: false, signedOut: true, code: "ACCOUNT_ACCESS_EXPIRED", error: "Your Cluster access has expired. Contact a studio administrator to renew it." });
      return;
    }
    if (enforceMfaEnrollmentRestriction({ pathname: policy.pathname, session, reply })) return;
    if (!accountStateAllowsWorkspace(user.accountState, requireDiscordLink)) {
      reply.code(403).send({ ok: false, code: "account_setup_required", error: "Account setup must be completed before using Cluster.", accountState: user.accountState || "PASSWORD_CHANGE_REQUIRED", nextStep: accountNextStep(user.accountState, requireDiscordLink) });
      return;
    }

    if (await enforceStudioMfaPolicyBoundary({
      pathname: policy.pathname, session, user, workspaceRole: decorated?.workspaceRole, prisma, settings: studioPermissionSettings,
      sessionDefaults: { sessionDays, sessionIdleHours, sessionMaxPerUser }, reply, onUserSessionsRevoked, clearSessionCookies,
    })) return;

    if (!policy.pathname.startsWith("/api/legal/acceptance")) {
      const acceptance = await ensureSessionPolicyAcceptance(prisma, session, Boolean(decorated?.isAdmin));
      if (!acceptance.complete) {
        reply.code(428).send({ ok: false, code: "POLICY_ACCEPTANCE_REQUIRED", error: "Review and accept the current required policy versions before continuing.", action: "Open the policy review screen, review each current version, then record your acknowledgement or acceptance.", retryable: false, acceptance: { schemaVersion: acceptance.schemaVersion, pending: acceptance.pending } });
        return;
      }
    }

    const hasPrivilegedConfigAccess = Boolean(
      decorated?.isAdmin
      || hasToolPermission(user, decorated?.workspaceRole, "serverConfig", "manage")
      || (policy.pathname.startsWith("/api/admin/integrations/") && hasToolPermission(user, decorated?.workspaceRole, "integrations", "manage")),
    );
    const baseVerificationPolicy = reauthPolicyForRequest(policy.pathname, policy.method, hasPrivilegedConfigAccess)
      || (Boolean(decorated?.isAdmin) && policy.administrativeMutation ? reauthPolicyForRequest("/api/admin/security-sensitive", "POST", true) : null);
    const studioSecurityPolicy = normalizeStudioSecurityPolicy(studioPermissionSettings, { sessionDays, sessionIdleHours, sessionMaxPerUser });
    const requestedVerificationPolicy = baseVerificationPolicy ? {
      ...baseVerificationPolicy,
      minimumStrength: highRiskSecurityVerificationPurpose(baseVerificationPolicy.purpose)
        ? strongerVerificationStrength(baseVerificationPolicy.minimumStrength, securityPolicyHighRiskVerificationStrength(studioSecurityPolicy))
        : baseVerificationPolicy.minimumStrength,
    } : null;
    const enrollmentPendingMutation = String(session.authMethod || "") === "mfa-enrollment-pending"
      && ["/api/auth/mfa/enroll/start", "/api/auth/mfa/enroll/verify", "/api/auth/mfa/passkeys/enroll/start", "/api/auth/mfa/passkeys/enroll/verify"].includes(policy.pathname);
    if (requestedVerificationPolicy && !enrollmentPendingMutation) {
      const deviceProofRecoveryMutation = /^\/api\/me\/devices\/[^/]+\/proof\/rotate$/.test(policy.pathname);
      if (!deviceProofRecoveryMutation && highRiskSecurityVerificationPurpose(requestedVerificationPolicy.purpose) && studioSecurityPolicy.highRiskRequireDeviceProof && !deviceProof.verified) {
        reply.code(428).send({
          ok: false,
          code: "DEVICE_PROOF_REQUIRED",
          error: deviceProof.code === "key_mismatch" ? "This installation's device key no longer matches the registered device identity." : "This security-sensitive action requires a cryptographically verified device.",
          action: deviceProof.code === "key_mismatch" ? "Rotate or revoke this installation's device identity, then try again." : "Use a Cluster client with secure device-key storage, then retry the action.",
          retryable: false,
          deviceProofState: deviceProof.code,
        });
        return;
      }
      const freshLogin = requestedVerificationPolicy.freshLoginSatisfies
        && !String(session.authMethod || "password").startsWith("reauth:")
        && sessionRecentlyAuthenticated(session.createdAt, Date.now(), REAUTH_WINDOW_MS);
      const scopedGrant = freshLogin ? true : await hasValidSecurityVerification(prisma, {
        sessionId: session.id,
        userId: user.id,
        user,
        purpose: requestedVerificationPolicy.purpose,
        minimumStrength: requestedVerificationPolicy.minimumStrength,
        consume: requestedVerificationPolicy.singleUse,
      });
      if (!freshLogin && !scopedGrant) {
        const acceptablePasskeyStrengths = requestedVerificationPolicy.minimumStrength === "hardware_backed" ? ["hardware_backed"] : ["phishing_resistant", "hardware_backed"];
        const passkeyAvailable = await prisma.authenticator.count({ where: { userId: user.id, kind: "webauthn", state: "active", revokedAt: null, compromisedAt: null, strength: { in: acceptablePasskeyStrengths } } }).then((count: number) => count > 0).catch(() => false);
        reply.code(428).send({
          ok: false,
          code: "AUTH_REAUTH_REQUIRED",
          error: requestedVerificationPolicy.minimumStrength === "knowledge" ? "Confirm your identity before continuing with this security-sensitive action." : "Use a passkey or security key before continuing with this security-sensitive action.",
          action: requestedVerificationPolicy.minimumStrength === "hardware_backed" ? "Use a hardware security key for this action. Cluster grants only a short-lived permission for the requested security scope." : requestedVerificationPolicy.minimumStrength === "phishing_resistant" ? "Use a passkey or security key for this action. Cluster grants only a short-lived permission for the requested security scope." : "Re-authenticate for this action. Cluster grants only a short-lived permission for the requested security scope.",
          retryable: true,
          reauthenticationWindowSeconds: Math.round(requestedVerificationPolicy.ttlMs / 1000),
          reauthenticationPurpose: requestedVerificationPolicy.purpose,
          reauthenticationSingleUse: requestedVerificationPolicy.singleUse,
          reauthenticationMinimumStrength: requestedVerificationPolicy.minimumStrength,
          reauthenticationReasonMode: requestedVerificationPolicy.reasonMode,
          pinAllowed: requestedVerificationPolicy.minimumStrength === "knowledge" && Boolean(user.pinHash),
          passwordAllowed: requestedVerificationPolicy.minimumStrength === "knowledge",
          passkeyAvailable,
          passkeyRequired: requestedVerificationPolicy.minimumStrength === "phishing_resistant" || requestedVerificationPolicy.minimumStrength === "hardware_backed",
        });
        return;
      }
    }

    if (isConfigurableToolCapability(policy.capability)) {
      const disabledTool = disabledToolLabel(policy.capability, await readSettings());
      if (disabledTool) {
        reply.code(503).send({ ok: false, code: "TOOL_DISABLED", error: `${disabledTool} is disabled by studio administration.` });
        return;
      }
    }

    if (!(await authorizeRequestBoundary(request, reply))) return;

    const workPolicy = requestWorkPolicies.get(request);
    if (workPolicy && workPolicy.workClass !== "normal") {
      const actor = requestContextFor(request).actor;
      const release = concurrentWorkLimiter.acquire(workPolicy.workClass, {
        clientKey: getClientKey(request),
        workspaceKey: actor?.workspaceId || null,
      });
      if (!release) {
        securityTelemetry.record("request.backpressure", "FAILURE");
        reply.header("Retry-After", "2");
        reply.header("X-Cluster-Backpressure", workPolicy.workClass);
        reply.code(503).send({ ok: false, code: "SERVICE_UNAVAILABLE", error: "Cluster is already processing the maximum safe amount of expensive work for this client, workspace, or server.", action: "Retry this operation shortly.", retryable: true, requestId: String(request.id), contractVersion: API_CONTRACT.version });
        return;
      }
      requestWorkReleases.set(request, release);
    }
  });
}
