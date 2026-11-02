import crypto from "node:crypto";
import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";
import { LOGIN_FAILURE_DECAY_MS, loginLockDurationMs } from "../../core/auth.js";
import { createAuthenticatorService } from "./authenticator-service.js";
import { requestDeviceId } from "../sessions/session-device.js";
import { factorStrengthSatisfies, normalizeStudioSecurityPolicy, securityPolicyMinimumFactorStrength, securityPolicyRequiresMfa } from "../../core/studio-security-policy.js";
import { issueSecurityVerification, nextAuthenticationGeneration, nextVerificationGeneration, securityVerificationPolicy, type SecurityVerificationPurpose } from "../../core/security-verification.js";
import { verifyWebAuthnAssertion, webAuthnRpFromOrigin } from "./webauthn.js";
import { desktopSessionHandoffAllowed } from "./desktop-session-handoff.js";

export function registerAuthCoreRoutes(deps: AuthRouteDependencies) {
  const notificationService = deps.notificationService;
  const { app, prisma, authorization, inspectInstanceSetup, isDiscordConfigured, normalizeAuthUsername, verifyPassword, verifyUserPin, dummyPasswordHash, rateLimitKey, clearRateLimitKey, logSecurityEvent, createSession, clearCurrentSessionCache, clearSessionCookies, csrfTokenForSession, decorateUserForClient, accountNextStep, validateNewPassword, hashPassword, nextAccountState, getCurrentSession, hashToken, randomOAuthState, oauthStateDigest, fetchWithTimeout, safeAuthenticationReason, requireConfirmation, parseJsonObject, readSettings, onSessionRevoked, onUserSessionsRevoked } = deps;
  const mfaService = createAuthenticatorService({ prisma, logSecurityEvent });
  const REQUIRE_DISCORD_LINK = deps.requireDiscordLink;
  const DEV_LOGIN_ENABLED = deps.devLoginEnabled;
  const PASSWORD_MIN_LENGTH = deps.passwordMinLength;
  const PASSWORD_MAX_LENGTH = deps.passwordMaxLength;
  const AUTH_RATE_LIMIT_MAX = deps.authRateLimitMax;
  const API_RATE_LIMIT_WINDOW_MS = deps.apiRateLimitWindowMs;
  const LOGIN_FAILURE_LIMIT = deps.loginFailureLimit;
  const LOGIN_LOCK_MS = deps.loginLockMs;
  const AUTH_SECRET = deps.authSecret;
  const GENERIC_AUTH_ERROR = deps.genericAuthError;
  const SESSION_COOKIE = deps.sessionCookie;
  const SESSION_SECURE = deps.sessionSecure;
  const WEB_ORIGIN = deps.webOrigin;
  const DISCORD_LINK_STATE_LIFETIME_MS = deps.discordLinkStateLifetimeMs;

  const desktopSessionCodes = new Map<string, { userId: string; sourceSessionId: string; expiresAt: number }>();
  const DESKTOP_SESSION_CODE_TTL_MS = 60_000;
  const DESKTOP_SESSION_CODE_LIMIT = 512;

  async function workspaceRoleForUser(userId: string) {
    const memberships = await (prisma as any).workspaceMember.findMany({ where: { userId }, select: { role: true }, take: 16 }).catch(() => []);
    const roles = memberships.map((row: any) => String(row.role || "member").toLowerCase());
    if (roles.includes("owner")) return "owner";
    if (roles.includes("admin")) return "admin";
    return roles[0] || "member";
  }

  async function mfaPolicyForUser(userId: string) {
    const settings = await readSettings();
    const policy = normalizeStudioSecurityPolicy(settings, {
      sessionDays: Number(settings.sessionDays || 7),
      sessionIdleHours: Number(settings.sessionIdleHours || 168),
      sessionMaxPerUser: Number(settings.sessionMaxPerUser || 10),
    });
    const workspaceRole = await workspaceRoleForUser(userId);
    return { policy, workspaceRole, required: securityPolicyRequiresMfa(policy, workspaceRole), minimumStrength: securityPolicyMinimumFactorStrength(policy, workspaceRole) };
  }

  async function createMfaEnrollmentSession(user: any, reply: any, request: any, reasonCode: string) {
    const created = await createSession(user.id, reply, request, { authMethod: "mfa-enrollment-pending" });
    clearCurrentSessionCache(request);
    await logSecurityEvent({ event: "mfa.enrollment_required", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode, request });
    const decorated = await decorateUserForClient(user);
    return { ok: true, user: { ...decorated, nextAuthStep: "SETUP_MFA" }, nextStep: "SETUP_MFA", mfaEnrollmentRequired: true, csrfToken: csrfTokenForSession(created.id) };
  }

  function pruneDesktopSessionCodes(now = Date.now()) {
    for (const [digest, entry] of desktopSessionCodes) if (entry.expiresAt <= now) desktopSessionCodes.delete(digest);
    while (desktopSessionCodes.size > DESKTOP_SESSION_CODE_LIMIT) desktopSessionCodes.delete(desktopSessionCodes.keys().next().value as string);
  }

  function normalizedPhone(value: unknown) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 7 ? digits : "";
  }

  async function resolveLoginIdentity(identifierValue: unknown) {
    const identifier = String(identifierValue || "").normalize("NFKC").trim();
    if (!identifier) return null;
    const candidates: any[] = [];
    try {
      const username = normalizeAuthUsername(identifier);
      const user = await (prisma as any).user.findUnique({ where: { username } });
      if (user) candidates.push(user);
    } catch {
      // Email and phone identifiers do not need to satisfy the username grammar.
    }
    if (identifier.includes("@")) {
      const emailUsers = await (prisma as any).user.findMany({ where: { email: { equals: identifier, mode: "insensitive" } }, take: 3 });
      candidates.push(...emailUsers);
    }
    const phone = normalizedPhone(identifier);
    if (phone) {
      const phoneUsers = await (prisma as any).user.findMany({
        where: { OR: [{ phoneNumber: { not: null } }, { alternatePhoneNumber: { not: null } }] },
        take: 5000,
      });
      candidates.push(...phoneUsers.filter((user: any) => [user.phoneNumber, user.alternatePhoneNumber].some((value) => normalizedPhone(value) === phone)));
    }
    const unique = [...new Map(candidates.map((user) => [user.id, user])).values()];
    return unique.length === 1 ? unique[0] : null;
  }

  async function adminRecipientIds() {
    const rows = await (prisma as any).workspaceMember.findMany({
      where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: { notIn: ["DISABLED", "SUSPENDED", "PRIVACY_ERASED"] } } },
      select: { userId: true },
      take: 5000,
    });
    return [...new Set(rows.map((row: any) => String(row.userId)))];
  }

app.get("/api/auth/config", async () => {
  const instanceSetup = await inspectInstanceSetup(prisma);
  return {
    passwordLoginEnabled: true,
    discordConfigured: isDiscordConfigured(),
    discordLinkRequired: REQUIRE_DISCORD_LINK,
    devLoginEnabled: DEV_LOGIN_ENABLED,
    discordLinkUrl: "/api/auth/discord/link",
    ownerSetupRequired: instanceSetup.setupRequired,
    ownerSetupReason: instanceSetup.reason,
    passwordReadyAdministratorCount: instanceSetup.passwordReadyAdministratorCount,
    setupLauncherName: process.platform === "win32" ? "ClusterServer.exe --recover-owner" : "docker compose logs cluster",
    passwordPolicy: {
      minimumLength: PASSWORD_MIN_LENGTH,
      maximumLength: PASSWORD_MAX_LENGTH,
    },
  };
});

app.post("/api/auth/desktop-session-code", async (request, reply) => {
  const session = await getCurrentSession(request);
  if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
  const security = await mfaPolicyForUser(String(session.userId));
  if (!desktopSessionHandoffAllowed({
    userId: String(session.userId), user: session.user, source: session,
    requireDiscordLink: REQUIRE_DISCORD_LINK,
    sessionDays: security.policy.sessionDays, sessionIdleHours: security.policy.sessionIdleHours,
  })) return reply.code(403).send({ ok: false, code: "DESKTOP_SESSION_HANDOFF_BLOCKED", error: "Complete your sign-in and account access requirements before opening Desktop." });
  pruneDesktopSessionCodes();
  const code = crypto.randomBytes(32).toString("base64url");
  // The code is single-use and references the authenticated browser SESSION,
  // not just its user. A subsequent logout, revocation, credential rotation,
  // or offboarding must invalidate the handoff before redemption.
  desktopSessionCodes.set(hashToken(code), { userId: String(session.userId), sourceSessionId: String(session.id), expiresAt: Date.now() + DESKTOP_SESSION_CODE_TTL_MS });
  reply.header("Cache-Control", "no-store");
  await logSecurityEvent({ event: "desktop.session_code_issued", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "DESKTOP_NATIVE_SESSION", request });
  return { ok: true, code, expiresInSeconds: Math.floor(DESKTOP_SESSION_CODE_TTL_MS / 1000) };
});

app.post("/api/auth/desktop-session-redeem", async (request, reply) => {
  pruneDesktopSessionCodes();
  const body = z.object({ code: z.string().min(32).max(256) }).parse(request.body || {});
  const digest = hashToken(body.code);
  const claim = desktopSessionCodes.get(digest);
  desktopSessionCodes.delete(digest);
  if (!claim || claim.expiresAt <= Date.now()) {
    await logSecurityEvent({ event: "desktop.session_code_rejected", actorUserId: null, targetUserId: null, result: "FAILURE", reasonCode: "DESKTOP_SESSION_CODE_INVALID", request });
    return reply.code(401).send({ ok: false, code: "DESKTOP_SESSION_CODE_INVALID", error: "The Desktop session handoff expired or was already used." });
  }
  const source = await (prisma as any).session.findUnique({ where: { id: claim.sourceSessionId }, include: { user: true } });
  const security = source?.userId === claim.userId ? await mfaPolicyForUser(claim.userId) : null;
  if (!source || !security || !desktopSessionHandoffAllowed({
    userId: claim.userId, user: source.user, source,
    requireDiscordLink: REQUIRE_DISCORD_LINK,
    sessionDays: security.policy.sessionDays, sessionIdleHours: security.policy.sessionIdleHours,
  })) {
    await logSecurityEvent({ event: "desktop.session_code_rejected", actorUserId: null, targetUserId: null, result: "FAILURE", reasonCode: "DESKTOP_SOURCE_SESSION_REVOKED", request });
    return reply.code(401).send({ ok: false, code: "DESKTOP_SESSION_CODE_INVALID", error: "The source login is no longer eligible to open Desktop." });
  }
  const user = source.user;
  const nativeSession = await createSession(user.id, reply, request, { authMethod: "desktop-native" });
  clearCurrentSessionCache(request);
  reply.header("Cache-Control", "no-store");
  await logSecurityEvent({ event: "desktop.session_redeemed", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "DESKTOP_NATIVE_SESSION", request });
  return { ok: true, csrfToken: csrfTokenForSession(nativeSession.id), expiresAt: nativeSession.expiresAt, userId: user.id };
});

app.get("/api/auth/csrf", async (request, reply) => {
  const session = await getCurrentSession(request);
  if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
  reply.header("Cache-Control", "no-store");
  return {
    ok: true,
    token: csrfTokenForSession(session.id),
    expiresAt: session.expiresAt,
  };
});

app.post("/api/auth/reauth", async (request, reply) => {
  const session = await getCurrentSession(request);
  if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
  const purposes = ["security_export", "privacy", "session_management", "mfa", "server_configuration", "studio_administration", "context_export", "context_secret_export", "library_administration", "personnel_records", "vault_secret_reveal"] as const satisfies readonly SecurityVerificationPurpose[];
  const body = z.object({
    purpose: z.enum(purposes).optional(),
    credentialType: z.enum(["password", "pin"]).optional().default("password"),
    credential: z.string().min(1).max(1024).optional(),
    password: z.string().min(1).max(1024).optional(),
    pin: z.string().regex(/^\d{4,8}$/).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  }).superRefine((value, ctx) => {
    const credential = value.credentialType === "pin" ? (value.credential || value.pin) : (value.credential || value.password);
    if (!credential) ctx.addIssue({ code: z.ZodIssueCode.custom, message: value.credentialType === "pin" ? "Enter your security PIN." : "Enter your account password." });
  }).parse(request.body || {});
  const user = session.user as any;
  const rateKey = `reauth:${user.id}:${hashToken(String(request.ip || "local")).slice(0, 20)}`;
  if (await rateLimitKey(reply, rateKey, Math.max(3, Math.min(6, AUTH_RATE_LIMIT_MAX)), API_RATE_LIMIT_WINDOW_MS)) return;
  if (["SUSPENDED", "DISABLED", "LOCKED"].includes(String(user.accountState || ""))) {
    await logSecurityEvent({ event: "account.reauth_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: "ACCOUNT_UNAVAILABLE", request });
    return reply.code(401).send({ ok: false, code: "AUTH_REAUTH_FAILED", error: GENERIC_AUTH_ERROR });
  }

  const credential = String(body.credential || (body.credentialType === "pin" ? body.pin : body.password) || "");
  if (body.credentialType === "pin") {
    if (!body.purpose) return reply.code(400).send({ ok: false, code: "AUTH_REAUTH_PURPOSE_REQUIRED", error: "PIN re-authentication requires an explicit security purpose." });
    try {
      await verifyUserPin(user, credential, `reauth:${body.purpose}`, request);
    } catch {
      await logSecurityEvent({ event: "account.reauth_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: "INVALID_PIN", request, metadata: { purpose: body.purpose } });
      return reply.code(401).send({ ok: false, code: "AUTH_REAUTH_FAILED", error: GENERIC_AUTH_ERROR });
    }
    const verificationPolicy = securityVerificationPolicy(body.purpose);
    if (verificationPolicy.reasonMode === "required" && !body.reason) return reply.code(400).send({ ok: false, code: "AUTH_REAUTH_REASON_REQUIRED", error: "Enter a reason for this security verification." });
    const grant = await issueSecurityVerification(prisma, {
      sessionId: session.id, userId: user.id, user, purpose: body.purpose, method: "pin",
      ttlMs: verificationPolicy.ttlMs, singleUse: verificationPolicy.singleUse, requiredReason: body.reason || null, auditCorrelationId: String(request.id || "") || null,
    });
    clearRateLimitKey(rateKey);
    await logSecurityEvent({ event: "account.reauthenticated", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "PIN_REAUTHENTICATION", request, metadata: { purpose: body.purpose, sessionRotated: false, grantExpiresAt: new Date(grant.expiresAt).toISOString(), singleUse: verificationPolicy.singleUse, reasonCaptured: Boolean(body.reason) } });
    return { ok: true, method: "pin", purpose: body.purpose, reauthenticatedAt: new Date(grant.issuedAt).toISOString(), grantExpiresAt: new Date(grant.expiresAt).toISOString(), grantTtlSeconds: Math.round(verificationPolicy.ttlMs / 1000), singleUse: verificationPolicy.singleUse };
  }

  const matches = user.passwordHash ? await verifyPassword(user.passwordHash, credential) : false;
  if (!matches) {
    await logSecurityEvent({ event: "account.reauth_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: "INVALID_CREDENTIALS", request, metadata: { purpose: body.purpose || null } });
    return reply.code(401).send({ ok: false, code: "AUTH_REAUTH_FAILED", error: GENERIC_AUTH_ERROR });
  }

  const rotatedAt = new Date();
  await (prisma as any).session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: rotatedAt, revocationReason: "reauthenticated" } });
  onSessionRevoked(session.id, user.id, "reauthenticated");
  clearCurrentSessionCache(request);
  const nextSession = await createSession(user.id, reply, request, { authMethod: body.purpose ? "reauth:password" : "reauth" });
  const verificationPolicy = body.purpose ? securityVerificationPolicy(body.purpose) : null;
  if (verificationPolicy?.reasonMode === "required" && !body.reason) return reply.code(400).send({ ok: false, code: "AUTH_REAUTH_REASON_REQUIRED", error: "Enter a reason for this security verification." });
  const grant = body.purpose && verificationPolicy ? await issueSecurityVerification(prisma, {
    sessionId: nextSession.id, userId: user.id, user, purpose: body.purpose, method: "password",
    ttlMs: verificationPolicy.ttlMs, singleUse: verificationPolicy.singleUse, requiredReason: body.reason || null, auditCorrelationId: String(request.id || "") || null,
  }) : null;
  clearRateLimitKey(rateKey);
  await logSecurityEvent({ event: "account.reauthenticated", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "PASSWORD_REAUTHENTICATION", request, metadata: { purpose: body.purpose || null, sessionRotated: true, grantExpiresAt: grant ? new Date(grant.expiresAt).toISOString() : null, singleUse: verificationPolicy?.singleUse || false, reasonCaptured: Boolean(body.reason) } });
  return { ok: true, method: "password", purpose: body.purpose || null, reauthenticatedAt: rotatedAt.toISOString(), grantExpiresAt: grant ? new Date(grant.expiresAt).toISOString() : null, grantTtlSeconds: verificationPolicy ? Math.round(verificationPolicy.ttlMs / 1000) : null, singleUse: verificationPolicy?.singleUse || false };
});

app.post("/api/auth/passkeys/login/start", async (request, reply) => {
  const rateKey = `passkey-login-start:${hashToken(String(request.ip || "local")).slice(0, 28)}`;
  if (await rateLimitKey(reply, rateKey, Math.max(6, Math.min(30, AUTH_RATE_LIMIT_MAX * 2)), API_RATE_LIMIT_WINDOW_MS)) return;
  const relyingParty = webAuthnRpFromOrigin(WEB_ORIGIN);
  const challenge = await mfaService.createWebAuthnChallenge({
    userId: null,
    deviceId: requestDeviceId(request),
    flow: "passwordless_login",
    rpId: relyingParty.rpId,
    expectedOrigin: relyingParty.origin,
    context: { discoverable: true },
  });
  reply.header("Cache-Control", "no-store");
  return {
    ok: true,
    challenge: challenge.challenge,
    expiresAt: challenge.expiresAt.toISOString(),
    publicKey: {
      challenge: challenge.challenge,
      rpId: relyingParty.rpId,
      timeout: 300000,
      userVerification: "required",
    },
  };
});

app.post("/api/auth/passkeys/login/verify", async (request, reply) => {
  const body = z.object({ challenge: z.string().min(32).max(512), credential: z.any() }).parse(request.body || {});
  const credentialId = String(body.credential?.rawId || body.credential?.id || "");
  const rateKey = `passkey-login-verify:${hashToken(String(request.ip || "local")).slice(0, 20)}:${hashToken(credentialId || "unknown").slice(0, 20)}`;
  if (await rateLimitKey(reply, rateKey, Math.max(6, Math.min(30, AUTH_RATE_LIMIT_MAX * 2)), API_RATE_LIMIT_WINDOW_MS)) return;
  const challenge = await mfaService.findChallenge(body.challenge, "passwordless_login");
  if (!challenge || challenge.userId || challenge.deviceId && challenge.deviceId !== requestDeviceId(request) || !challenge.rpId || !challenge.expectedOrigin) {
    return reply.code(401).send({ ok: false, code: "PASSKEY_CHALLENGE_INVALID", error: "The passkey sign-in challenge expired or was already used." });
  }
  const factor = await mfaService.activeWebAuthnFactorByCredentialId(credentialId, { requireDiscoverable: true });
  const user = factor?.user;
  const unavailable = !factor || !user || ["SUSPENDED", "DISABLED", "LOCKED"].includes(String(user.accountState || "")) || Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
  const passwordSetupRequired = user && ["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(user.accountState || ""));
  const passkeyPolicy = user ? await mfaPolicyForUser(user.id) : null;
  const policyStrengthBlocked = Boolean(passkeyPolicy?.required && !factorStrengthSatisfies(String(factor?.strength || "mfa"), passkeyPolicy.minimumStrength));
  if (unavailable || passwordSetupRequired || policyStrengthBlocked || !factor.publicKeySpki || !factor.publicKeyAlgorithm || !factor.credentialId) {
    await logSecurityEvent({ event: "account.passkey_login_failed", actorUserId: user?.id || null, targetUserId: user?.id || null, result: "FAILURE", reasonCode: passwordSetupRequired ? "PASSWORD_SETUP_REQUIRED" : policyStrengthBlocked ? "AUTHENTICATOR_STRENGTH_POLICY" : "PASSKEY_UNAVAILABLE", request });
    return reply.code(401).send({ ok: false, code: "PASSKEY_LOGIN_FAILED", error: GENERIC_AUTH_ERROR });
  }
  const expectedUserHandle = Buffer.from(String(user.id), "utf8").toString("base64url");
  if (String(body.credential?.response?.userHandle || "") !== expectedUserHandle) {
    await logSecurityEvent({ event: "account.passkey_login_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: "WEBAUTHN_USER_HANDLE_MISMATCH", request });
    return reply.code(401).send({ ok: false, code: "PASSKEY_LOGIN_FAILED", error: GENERIC_AUTH_ERROR });
  }
  let verified: any;
  try {
    verified = verifyWebAuthnAssertion({ credential: body.credential, expectedChallenge: body.challenge, expectedOrigin: challenge.expectedOrigin, rpId: challenge.rpId, credentialId: factor.credentialId, publicKeySpki: factor.publicKeySpki, publicKeyAlgorithm: factor.publicKeyAlgorithm, requireUserVerification: true });
  } catch (error) {
    await logSecurityEvent({ event: "account.passkey_login_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: safeAuthenticationReason(error), request });
    return reply.code(401).send({ ok: false, code: "PASSKEY_LOGIN_FAILED", error: GENERIC_AUTH_ERROR });
  }
  if (!(await mfaService.claimChallenge(challenge.id))) return reply.code(401).send({ ok: false, code: "PASSKEY_CHALLENGE_INVALID", error: "The passkey sign-in challenge expired or was already used." });
  const marked = await mfaService.markWebAuthnUsed({ factorId: factor.id, signCount: verified.signCount, backupState: verified.backupState, userVerification: verified.userVerification });
  if (!marked.ok) {
    await logSecurityEvent({ event: "account.passkey_login_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: marked.code, request, metadata: { factorId: factor.id } });
    return reply.code(401).send({ ok: false, code: "PASSKEY_LOGIN_FAILED", error: GENERIC_AUTH_ERROR });
  }
  const normalizedLoginState = !REQUIRE_DISCORD_LINK && user.accountState === "DISCORD_LINK_REQUIRED" ? "ACTIVE" : user.accountState;
  await (prisma as any).user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lastSeenAt: new Date(), accountState: normalizedLoginState } });
  try {
    await createSession(user.id, reply, request, { authMethod: factor.strength === "hardware_backed" ? "security-key" : "passkey" });
  } catch (error) {
    await logSecurityEvent({ event: "account.session_failed", actorUserId: user.id, targetUserId: user.id, result: "FAILURE", reasonCode: "SESSION_CREATION_FAILED", request, metadata: { reason: safeAuthenticationReason(error), factorId: factor.id } });
    return reply.code(409).send({ ok: false, code: "AUTH_SESSION_UNAVAILABLE", error: "Passkey verification succeeded, but Cluster could not create a login session. Try again." });
  }
  clearRateLimitKey(rateKey);
  const refreshed = await (prisma as any).user.findUnique({ where: { id: user.id } });
  await logSecurityEvent({ event: "account.login_succeeded", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: factor.strength === "hardware_backed" ? "SECURITY_KEY_PASSWORDLESS" : "PASSKEY_PASSWORDLESS", request, metadata: { factorId: factor.id, discoverable: true } });
  return { ok: true, user: await decorateUserForClient(refreshed), nextStep: accountNextStep(refreshed?.accountState, REQUIRE_DISCORD_LINK) };
});

app.post("/api/auth/login", async (request, reply) => {
  const body = z
    .object({
      identifier: z.string().min(1).max(320).optional(),
      username: z.string().min(1).max(320).optional(),
      password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    })
    .refine((value) => Boolean(value.identifier || value.username), { message: "A username, email, or phone number is required." })
    .parse(request.body);

  const identifier = String(body.identifier || body.username || "").normalize("NFKC").trim();
  const identityKey = hashToken(identifier.toLowerCase()).slice(0, 28);
  const accountRateKey = `auth-account:${identityKey}`;
  const accountIpRateKey = `auth-account-ip:${identityKey}:${hashToken(String(request.ip || "local")).slice(0, 20)}`;
  if (await rateLimitKey(reply, accountRateKey, AUTH_RATE_LIMIT_MAX, API_RATE_LIMIT_WINDOW_MS)) return;
  if (await rateLimitKey(reply, accountIpRateKey, Math.max(3, Math.min(6, AUTH_RATE_LIMIT_MAX)), API_RATE_LIMIT_WINDOW_MS)) return;

  const user = await resolveLoginIdentity(identifier);
  const passwordHash = user?.passwordHash || (await dummyPasswordHash());
  const passwordMatches = await verifyPassword(passwordHash, body.password);
  const now = new Date();
  const lockedNow = Boolean(user?.lockedUntil && new Date(user.lockedUntil).getTime() > now.getTime());
  const unavailable = !user || !user.passwordHash || ["SUSPENDED", "DISABLED", "LOCKED"].includes(String(user.accountState || ""));

  if (!passwordMatches || unavailable || lockedNow) {
    if (user && !lockedNow) {
      const lastFailureAt = user.lastFailedLoginAt ? new Date(user.lastFailedLoginAt).getTime() : 0;
      const previousFailures = lastFailureAt && now.getTime() - lastFailureAt <= LOGIN_FAILURE_DECAY_MS ? Number(user.failedLoginCount || 0) : 0;
      const failures = previousFailures + 1;
      const lockDurationMs = loginLockDurationMs(failures, LOGIN_LOCK_MS);
      const shouldLock = lockDurationMs > 0;
      await (prisma as any).user
        .update({
          where: { id: user.id },
          data: {
            failedLoginCount: failures,
            lastFailedLoginAt: now,
            lockedUntil: shouldLock ? new Date(now.getTime() + lockDurationMs) : null,
          },
        })
        .catch(() => undefined);
      await logSecurityEvent({
        event: shouldLock ? "account.locked" : "account.login_failed",
        actorUserId: user.id,
        targetUserId: user.id,
        result: "FAILURE",
        reasonCode: shouldLock ? "LOGIN_FAILURE_THRESHOLD" : "INVALID_CREDENTIALS",
        request,
        metadata: shouldLock ? { lockMinutes: Math.round(lockDurationMs / 60_000) } : undefined,
      });
    } else {
      await logSecurityEvent({
        event: "account.login_failed",
        actorUserId: user?.id || null,
        targetUserId: user?.id || null,
        result: "FAILURE",
        reasonCode: lockedNow ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS",
        request,
      });
    }
    return reply.code(401).send({ ok: false, error: GENERIC_AUTH_ERROR });
  }

  const normalizedLoginState = !REQUIRE_DISCORD_LINK && user.accountState === "DISCORD_LINK_REQUIRED" ? "ACTIVE" : user.accountState;
  await (prisma as any).user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lastSeenAt: now,
      accountState: normalizedLoginState,
    },
  });
  clearRateLimitKey(accountRateKey);
  clearRateLimitKey(accountIpRateKey);

  const [mfaStatus, mfaPolicy] = await Promise.all([mfaService.status(user.id), mfaPolicyForUser(user.id)]);
  if (mfaStatus.enabled) {
    const activeFactors = (mfaStatus.factors || []).filter((factor: any) => factor.state === "active" && !factor.revokedAt && !factor.compromisedAt);
    const acceptableFactors = mfaPolicy.required ? activeFactors.filter((factor: any) => factorStrengthSatisfies(String(factor.strength || "mfa"), mfaPolicy.minimumStrength)) : activeFactors;
    if (mfaPolicy.required && !acceptableFactors.length && accountNextStep(normalizedLoginState, REQUIRE_DISCORD_LINK) === "NONE") {
      return createMfaEnrollmentSession({ ...user, accountState: normalizedLoginState }, reply, request, "STUDIO_AUTHENTICATOR_STRENGTH_POLICY");
    }
    const strongFactorRequired = mfaPolicy.required && mfaPolicy.minimumStrength !== "mfa";
    const challenge = await mfaService.createLoginChallenge(user.id, requestDeviceId(request), strongFactorRequired ? "webauthn" : "any");
    await logSecurityEvent({
      event: "account.password_factor_succeeded",
      actorUserId: user.id,
      targetUserId: user.id,
      result: "SUCCESS",
      reasonCode: "MFA_REQUIRED",
      request,
      metadata: { challengeExpiresAt: challenge.expiresAt.toISOString() },
    });
    reply.header("Cache-Control", "no-store");
    const passkeyFactors = acceptableFactors.filter((factor: any) => factor.kind === "webauthn" && factor.credentialId);
    const relyingParty = webAuthnRpFromOrigin(WEB_ORIGIN);
    return {
      ok: true,
      mfaRequired: true,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt.toISOString(),
      recoveryAvailable: !strongFactorRequired && mfaStatus.recoveryCodesRemaining > 0,
      factorKinds: [...new Set(acceptableFactors.map((factor: any) => String(factor.kind)))],
      minimumFactorStrength: mfaPolicy.required ? mfaPolicy.minimumStrength : "mfa",
      passkeyAvailable: passkeyFactors.length > 0,
      passkeyPublicKey: passkeyFactors.length ? {
        challenge: challenge.challenge,
        rpId: relyingParty.rpId,
        timeout: 300000,
        userVerification: "required",
        allowCredentials: passkeyFactors.map((factor: any) => ({ id: factor.credentialId, type: "public-key", transports: factor.transports || [] })),
      } : null,
    };
  }

  if (mfaPolicy.required && accountNextStep(normalizedLoginState, REQUIRE_DISCORD_LINK) === "NONE") {
    return createMfaEnrollmentSession({ ...user, accountState: normalizedLoginState }, reply, request, "STUDIO_MFA_POLICY");
  }

  try {
    await createSession(user.id, reply, request, { authMethod: "password" });
  } catch (error) {
    await logSecurityEvent({
      event: "account.session_failed",
      actorUserId: user.id,
      targetUserId: user.id,
      result: "FAILURE",
      reasonCode: "SESSION_CREATION_FAILED",
      request,
      metadata: { reason: safeAuthenticationReason(error) },
    });
    return reply.code(409).send({
      ok: false,
      code: "AUTH_SESSION_UNAVAILABLE",
      error: "Your credentials were accepted, but Cluster could not create a login session. Restart the server and try signing in again.",
      action: "Restart Cluster Server, then sign in with the same username and password.",
      retryable: true,
    });
  }
  const refreshed = await (prisma as any).user.findUnique({
    where: { id: user.id },
  });
  await logSecurityEvent({
    event: "account.login_succeeded",
    actorUserId: user.id,
    targetUserId: user.id,
    result: "SUCCESS",
    reasonCode: "PASSWORD_AUTHENTICATION",
    request,
    metadata: {
      accountState: refreshed?.accountState || "PASSWORD_CHANGE_REQUIRED",
    },
  });
  return {
    ok: true,
    user: await decorateUserForClient(refreshed),
    nextStep: accountNextStep(refreshed?.accountState, REQUIRE_DISCORD_LINK),
  };
});

app.post("/api/auth/password-reset-request", async (request, reply) => {
  const body = z.object({ identifier: z.string().min(1).max(320) }).parse(request.body || {});
  const identifier = String(body.identifier).normalize("NFKC").trim();
  const rateKey = `password-reset-request:${hashToken(identifier.toLowerCase()).slice(0, 28)}:${hashToken(String(request.ip || "local")).slice(0, 20)}`;
  if (await rateLimitKey(reply, rateKey, Math.max(2, Math.min(5, AUTH_RATE_LIMIT_MAX)), API_RATE_LIMIT_WINDOW_MS)) return;
  const user = await resolveLoginIdentity(identifier);
  if (user && !["DISABLED", "PRIVACY_ERASED"].includes(String(user.accountState || ""))) {
    const existing = await (prisma as any).passwordResetRequest.findFirst({ where: { userId: user.id, status: "pending" }, orderBy: { createdAt: "desc" } }).catch(() => null);
    const resetRequest = existing || await (prisma as any).passwordResetRequest.create({
      data: { userId: user.id, requesterHint: identifier.slice(0, 320) },
    });
    const recipients = await adminRecipientIds();
    const existingNotifications = recipients.length ? await (prisma as any).notificationInboxItem.findMany({
      where: { userId: { in: recipients }, entityType: "password_reset_request", entityId: resetRequest.id, dismissedAt: null },
      select: { userId: true },
    }).catch(() => []) : [];
    const already = new Set(existingNotifications.map((row: any) => String(row.userId)));
    const pendingRecipients = recipients.filter((id) => !already.has(id));
    if (pendingRecipients.length) {
      const createdNotifications = await Promise.all(pendingRecipients.map((userId) => (prisma as any).notificationInboxItem.create({
        data: {
          userId,
          category: "system",
          priority: "high",
          title: "Password reset requested",
          message: `${user.displayName || user.username} requested administrator help resetting their password.`,
          entityType: "password_reset_request",
          entityId: resetRequest.id,
          actorLabel: user.displayName || user.username,
          metadata: JSON.stringify({ targetUserId: user.id, resetRequestId: resetRequest.id, route: "userAdmin" }),
        },
      })));
      notificationService?.publishRecords(createdNotifications);
    }
    await logSecurityEvent({ event: "account.password_reset_requested", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: existing ? "REQUEST_ALREADY_PENDING" : "USER_REQUEST", request });
  } else {
    await verifyPassword(await dummyPasswordHash(), String(crypto.randomBytes(16).toString("hex")));
  }
  return { ok: true, message: "If that account can be recovered, an administrator has been notified." };
});

app.post("/api/auth/session-password", async (request, reply) => {
  const session = await getCurrentSession(request);
  if (!session) return reply.code(401).send({ ok: false, error: "Login required." });
  const user = session.user as any;
  if (!["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED"].includes(String(user.accountState))) {
    return reply.code(409).send({
      ok: false,
      error: "This account does not require a password setup.",
    });
  }
  const body = z
    .object({
      password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    })
    .parse(request.body);
  let password = "";
  try {
    password = validateNewPassword(body.password, user);
  } catch (error) {
    return reply.code(400).send({
      ok: false,
      error: error instanceof Error ? error.message : "Password is not allowed.",
    });
  }
  const accountState = nextAccountState(user.discordUserId, REQUIRE_DISCORD_LINK);
  const changedAt = new Date();
  await (prisma as any).$transaction([
    (prisma as any).user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        passwordChangedAt: changedAt,
        authenticationGeneration: nextAuthenticationGeneration(user),
        verificationGeneration: nextVerificationGeneration(user),
        accountState,
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    }),
    (prisma as any).session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: changedAt, revocationReason: "password_changed" },
    }),
  ]);
  onUserSessionsRevoked(user.id, "password_changed");
  await createSession(user.id, reply, request, { authMethod: "password-reset" });
  const refreshed = await (prisma as any).user.findUnique({
    where: { id: user.id },
  });
  await logSecurityEvent({
    event: "account.password_changed",
    actorUserId: user.id,
    targetUserId: user.id,
    result: "SUCCESS",
    reasonCode: "PASSWORD_CHANGED",
    request,
  });
  const passwordNextStep = accountNextStep(accountState, REQUIRE_DISCORD_LINK);
  if (passwordNextStep === "NONE") {
    const [mfaStatus, mfaPolicy] = await Promise.all([mfaService.status(user.id), mfaPolicyForUser(user.id)]);
    if (mfaPolicy.required && !mfaStatus.enabled) {
      await (prisma as any).session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { authMethod: "mfa-enrollment-pending" } });
      const decorated = await decorateUserForClient(refreshed);
      return { ok: true, user: { ...decorated, nextAuthStep: "SETUP_MFA" }, nextStep: "SETUP_MFA", mfaEnrollmentRequired: true };
    }
  }
  return {
    ok: true,
    user: await decorateUserForClient(refreshed),
    nextStep: passwordNextStep,
  };
});

app.post("/api/auth/dev-login", async (request, reply) => {
  if (!DEV_LOGIN_ENABLED)
    return reply.code(404).send({
      ok: false,
      error: "Local development login is disabled on this server.",
    });
  const developmentPasswordHash = await hashPassword("Cluster local development password 208");
  const user = await (prisma as any).user.upsert({
    where: { username: "duckey" },
    update: {
      passwordHash: developmentPasswordHash,
      accountState: "ACTIVE",
      discordUserId: "dev_discord_duckey",
      discordUsername: "duckey-dev",
      discordLinkedAt: new Date(),
    },
    create: {
      username: "duckey",
      displayName: "Duckey",
      email: "duckey@example.local",
      passwordHash: developmentPasswordHash,
      accountState: "ACTIVE",
      discordUserId: "dev_discord_duckey",
      discordUsername: "duckey-dev",
      discordLinkedAt: new Date(),
    },
  });

  const workspace = await prisma.workspace.findFirst();
  if (workspace) {
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      update: {},
      create: { workspaceId: workspace.id, userId: user.id, role: "owner" },
    });
  }

  await createSession(user.id, reply, request, { authMethod: "development" });
  await logSecurityEvent({
    event: "account.login_succeeded",
    actorUserId: user.id,
    targetUserId: user.id,
    result: "SUCCESS",
    reasonCode: "LOCAL_DEVELOPMENT_LOGIN",
    request,
  });
  return { ok: true, user: await decorateUserForClient(user) };
});

app.post("/api/auth/logout", async (request, reply) => {
  const session = await getCurrentSession(request);
  if (session) {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "logout" },
    });
    onSessionRevoked(session.id, session.userId, "logout");
    await logSecurityEvent({ event: "account.logged_out", actorUserId: session.userId, targetUserId: session.userId, result: "SUCCESS", reasonCode: "USER_LOGOUT", request, metadata: { sessionId: session.id } });
  }
  clearCurrentSessionCache(request);
  clearSessionCookies(reply);
  reply.header("Clear-Site-Data", '"cookies"');
  return { ok: true };
});
}
