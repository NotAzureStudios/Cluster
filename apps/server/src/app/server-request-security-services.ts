import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { secureOutboundFetch, type OutboundRequestPolicy } from "../core/outbound-http.js";
import { mutationOriginDecisionForRequest } from "../core/security.js";
import { normalizeStudioSecurityPolicy } from "../core/studio-security-policy.js";
import { requestDeviceId, requestDevicePlatform, touchDeviceRegistration } from "../domains/sessions/session-device.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../domains/workforce/workforce-user-authority.js";

export function createRequestSecurityServices(deps: Record<string, any>) {
  const {
    AUTH_SECRET,
    CONFIGURED_CORS_ORIGINS,
    RATE_LIMIT_ENABLED,
    REQUEST_TIMEOUT_MS,
    REQUIRE_MUTATION_ORIGIN,
    SECURITY_HEADERS_ENABLED,
    SESSION_COOKIE,
    SESSION_DAYS,
    SESSION_IDLE_HOURS,
    SESSION_MAX_PER_USER,
    SESSION_SECURE,
    prisma,
    rateLimiter,
    distributedRateLimiter,
    readSettings,
    onSessionRevoked = (_sessionId: string, _userId: string, _reason: string) => undefined,
  } = deps;

  // Security-sensitive buckets prefer the distributed limiter so all API workers
  // share the same budget. Fall back to the local limiter during bootstrap or
  // recovery if the distributed dependency is ever unavailable.
  const securityRateLimiter = distributedRateLimiter ?? rateLimiter;

  const sessionCache = new WeakMap<FastifyRequest, any | null>();
  let securityPolicyCache: { value: ReturnType<typeof normalizeStudioSecurityPolicy>; expiresAt: number } | null = null;

  async function currentSecurityPolicy() {
    if (securityPolicyCache && securityPolicyCache.expiresAt > Date.now()) return securityPolicyCache.value;
    const settings = await readSettings();
    const value = normalizeStudioSecurityPolicy(settings, {
      sessionDays: SESSION_DAYS,
      sessionIdleHours: SESSION_IDLE_HOURS,
      sessionMaxPerUser: SESSION_MAX_PER_USER,
    });
    securityPolicyCache = { value, expiresAt: Date.now() + 5_000 };
    return value;
  }

  function hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function csrfTokenForSession(sessionId: string) {
    return crypto.createHmac("sha256", String(AUTH_SECRET)).update(`cluster-csrf\0${sessionId}`, "utf8").digest("base64url");
  }

  function csrfTokenMatches(sessionId: string, supplied: unknown) {
    const expected = Buffer.from(csrfTokenForSession(sessionId), "utf8");
    const actual = Buffer.from(String(supplied || ""), "utf8");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  function sessionCookieOptions() {
    return {
      path: "/",
      httpOnly: true,
      sameSite: "strict" as const,
      secure: SESSION_SECURE,
      priority: "high" as const,
    };
  }

  function clearSessionCookies(reply: FastifyReply) {
    const options = sessionCookieOptions();
    reply.clearCookie(SESSION_COOKIE, options);
    if (SESSION_COOKIE !== "cluster_session") reply.clearCookie("cluster_session", { ...options, secure: false });
    if (SESSION_COOKIE !== "__Host-cluster_session" && SESSION_SECURE) reply.clearCookie("__Host-cluster_session", options);
  }

  function randomToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  function getClientKey(request: FastifyRequest) {
    const userId = (request as FastifyRequest & { clusterUser?: { id?: string } }).clusterUser?.id;
    if (userId) return `user:${String(userId).slice(0, 96)}`;
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    if (sessionToken) return `session:${hashToken(String(sessionToken)).slice(0, 24)}`;
    return `ip:${String(request.ip || "local").slice(0, 96)}`;
  }

  async function rateLimit(request: FastifyRequest, reply: FastifyReply, bucketName: string, limit: number, windowMs: number, cost = 1) {
    if (!RATE_LIMIT_ENABLED) return false;
    const limiter = ["auth-transport", "security-transport", "setup"].includes(bucketName) ? securityRateLimiter : rateLimiter;
    const decision = await limiter.consumeCost(`${bucketName}:${getClientKey(request)}`, limit, windowMs, Math.max(1, Math.min(limit, Math.trunc(cost))));
    reply.header("X-Cluster-Rate-Limit-Bucket", bucketName);
    reply.header("X-RateLimit-Limit", String(decision.limit));
    reply.header("X-RateLimit-Remaining", String(decision.remaining));
    reply.header("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
    if (decision.allowed) return false;
    reply.header("Retry-After", String(decision.retryAfterSeconds));
    reply.code(429).send({
      ok: false,
      code: "RATE_LIMITED",
      error: "Too many requests. Please try again shortly.",
      action: `Try again in ${decision.retryAfterSeconds} seconds.`,
      retryable: true,
      retryAfterSeconds: decision.retryAfterSeconds,
      details: { bucket: bucketName, limit: decision.limit, remaining: decision.remaining, windowMs },
    });
    return true;
  }

  async function rateLimitKey(reply: FastifyReply, key: string, limit: number, windowMs: number) {
    if (!RATE_LIMIT_ENABLED) return false;
    const decision = await securityRateLimiter.consume(key, limit, windowMs);
    // Expose the authoritative bucket for diagnosis, including on successful
    // requests. It contains no user ID, credential or secret material.
    reply.header("X-Cluster-Rate-Limit-Bucket", key.startsWith("user-scope:") ? key.split(":").at(-1) || "user-scope" : "security");
    reply.header("X-RateLimit-Limit", String(decision.limit));
    reply.header("X-RateLimit-Remaining", String(decision.remaining));
    reply.header("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
    if (decision.allowed) return false;
    reply.header("Retry-After", String(decision.retryAfterSeconds));
    reply.code(429).send({
      ok: false,
      code: "RATE_LIMITED",
      details: { bucket: key.includes("user-scope:") ? key.split(":").at(-1) : "security", limit: decision.limit, windowMs },
      error: "Too many attempts. Try again later.",
      action: `Try again in ${decision.retryAfterSeconds} seconds.`,
      retryable: true,
      retryAfterSeconds: decision.retryAfterSeconds,
    });
    return true;
  }

  function clearRateLimitKey(key: string) {
    rateLimiter.delete(key);
    void securityRateLimiter.delete(key);
  }

  function securityHeaders(reply: FastifyReply) {
    if (!SECURITY_HEADERS_ENABLED) return;
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header("Cache-Control", "no-store, max-age=0");
    reply.header("Pragma", "no-cache");
    if (SESSION_SECURE) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  function mutationOriginDecision(request: FastifyRequest) {
    return mutationOriginDecisionForRequest({
      enabled: REQUIRE_MUTATION_ORIGIN,
      method: request.method,
      pathname: request.url.split("?")[0] || "/",
      fetchSite: String(request.headers["sec-fetch-site"] || ""),
      fetchMode: String(request.headers["sec-fetch-mode"] || ""),
      fetchDest: String(request.headers["sec-fetch-dest"] || ""),
      origin: String(request.headers.origin || ""),
      clusterClientHeadersPresent: Boolean(request.headers["x-cluster-client-protocol"] && request.headers["x-cluster-client-host"]),
      allowedOrigins: CONFIGURED_CORS_ORIGINS,
    });
  }

  function mutationOriginAllowed(request: FastifyRequest) {
    return mutationOriginDecision(request).allowed;
  }

  function requireConfirmation(request: FastifyRequest, reply: FastifyReply, expected: string) {
    const supplied = String(request.headers["x-cluster-confirmation"] || "").trim();
    if (supplied === expected) return true;
    reply.code(412).send({
      ok: false,
      error: `Confirmation required. Send ${expected} in the X-Cluster-Confirmation header.`,
      confirmation: expected,
    });
    return false;
  }

  async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS, policy: OutboundRequestPolicy = {}) {
    return secureOutboundFetch(url, init, timeoutMs, policy);
  }

  function requestUserAgent(request?: FastifyRequest) {
    return request ? String(request.headers["user-agent"] || "Unknown client").slice(0, 500) : "Unknown client";
  }

  function requestIpAddress(request?: FastifyRequest) {
    if (!request) return null;
    return String(request.ip || "unknown").slice(0, 96);
  }

  function transientSessionStorageError(error: unknown) {
    const code = String((error as { code?: unknown } | null)?.code || "");
    const message = error instanceof Error ? error.message : String(error || "");
    return ["P1001", "P1008", "P2024", "P2028", "P2034"].includes(code) || /40P01|40001|55P03|deadlock|serialization failure|connection pool|timed out/i.test(message);
  }

  async function createSession(userId: string, reply: FastifyReply, request?: FastifyRequest, options: { authMethod?: string } = {}) {
    const securityPolicy = await currentSecurityPolicy();
    const expiresAt = new Date(Date.now() + securityPolicy.sessionDays * 24 * 60 * 60 * 1000);
    const now = new Date();
    const deviceId = requestDeviceId(request);
    const devicePlatform = requestDevicePlatform(request);
    const userSecurityState = await prisma.user.findUnique({ where: { id: userId }, select: { authenticationGeneration: true } });
    if (!userSecurityState) throw new Error("Cluster could not create a session for a missing user.");
    const authenticationGeneration = Math.max(1, Number(userSecurityState.authenticationGeneration || 1));
    const existing = await prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true },
    }).catch(() => [] as Array<{ id: string }>);
    const overflow = existing.slice(Math.max(0, securityPolicy.sessionMaxPerUser - 1));
    if (overflow.length) {
      await prisma.session.updateMany({
        where: { id: { in: overflow.map((item: any) => item.id) } },
        data: { revokedAt: now, revocationReason: "session_limit" },
      }).catch(() => undefined);
      for (const item of overflow) onSessionRevoked(item.id, userId, "session_limit");
    }

    let createdSession: any = null;
    let token = "";
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      token = randomToken();
      try {
        createdSession = await prisma.session.create({
          data: {
            tokenHash: hashToken(token),
            userId,
            expiresAt,
            lastSeenAt: new Date(),
            userAgent: requestUserAgent(request),
            ipAddress: requestIpAddress(request),
            authMethod: String(options.authMethod || "password").slice(0, 32),
            authenticationGeneration,
            deviceId,
          },
        });
        break;
      } catch (error) {
        lastError = error;
        if (!transientSessionStorageError(error) || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 125));
      }
    }
    if (!createdSession) throw lastError instanceof Error ? lastError : new Error("Cluster could not create the login session.");

    if (deviceId) await touchDeviceRegistration(prisma, { userId, deviceId, platform: devicePlatform, userAgent: requestUserAgent(request) });
    clearSessionCookies(reply);
    reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt });
    return createdSession;
  }

  async function getCurrentSession(request: FastifyRequest): Promise<any | null> {
    if (sessionCache.has(request)) return sessionCache.get(request) || null;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      sessionCache.set(request, null);
      return null;
    }
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(String(token)) }, include: { user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE } } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      sessionCache.set(request, null);
      return null;
    }
    const currentAuthenticationGeneration = Math.max(1, Number(session.user?.authenticationGeneration || 1));
    if (Math.max(1, Number(session.authenticationGeneration || 1)) !== currentAuthenticationGeneration) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: "credential_generation_changed" } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, "credential_generation_changed");
      sessionCache.set(request, null);
      return null;
    }
    const securityPolicy = await currentSecurityPolicy();
    const policyLifetimeCutoff = Date.now() - securityPolicy.sessionDays * 24 * 60 * 60 * 1000;
    if (session.createdAt.getTime() < policyLifetimeCutoff) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: "security_policy_lifetime" } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, "security_policy_lifetime");
      sessionCache.set(request, null);
      return null;
    }
    const idleCutoff = Date.now() - securityPolicy.sessionIdleHours * 60 * 60 * 1000;
    if (session.lastSeenAt.getTime() < idleCutoff) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: "idle_timeout" } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, "idle_timeout");
      sessionCache.set(request, null);
      return null;
    }
    const suppliedDeviceId = requestDeviceId(request);
    if (session.deviceId && suppliedDeviceId && String(session.deviceId) !== suppliedDeviceId) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revocationReason: "device_binding_mismatch" } }).catch(() => null);
      onSessionRevoked(session.id, session.userId, "device_binding_mismatch");
      (request as FastifyRequest & { clusterSessionInvalidationCode?: string }).clusterSessionInvalidationCode = "DEVICE_BINDING_MISMATCH";
      sessionCache.set(request, null);
      return null;
    }
    if (!session.deviceId && suppliedDeviceId) {
      session.deviceId = suppliedDeviceId;
      void prisma.session.update({ where: { id: session.id }, data: { deviceId: suppliedDeviceId } }).catch(() => null);
      void touchDeviceRegistration(prisma, { userId: session.userId, deviceId: suppliedDeviceId, platform: requestDevicePlatform(request), userAgent: requestUserAgent(request) });
    }
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      const seenAt = new Date();
      void prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: seenAt,
          ipAddress: requestIpAddress(request),
          userAgent: requestUserAgent(request),
          ...(session.deviceId ? { deviceId: session.deviceId } : {}),
        },
      }).catch(() => null);
      if (session.deviceId) void touchDeviceRegistration(prisma, { userId: session.userId, deviceId: session.deviceId, platform: requestDevicePlatform(request), userAgent: requestUserAgent(request) });
    }
    sessionCache.set(request, session);
    return session;
  }

  function clearCurrentSessionCache(request: FastifyRequest) {
    sessionCache.delete(request);
  }

  async function getCurrentUser(request: FastifyRequest): Promise<any | null> {
    const session = await getCurrentSession(request);
    return session?.user || null;
  }

  return {
    clearCurrentSessionCache,
    clearRateLimitKey,
    clearSessionCookies,
    createSession,
    csrfTokenForSession,
    csrfTokenMatches,
    fetchWithTimeout,
    getClientKey,
    getCurrentSession,
    getCurrentUser,
    hashToken,
    mutationOriginAllowed,
    mutationOriginDecision,
    rateLimit,
    rateLimitKey,
    requestIpAddress,
    requestUserAgent,
    requireConfirmation,
    securityHeaders,
  };
}
