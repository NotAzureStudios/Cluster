import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";
import { nextAuthenticationGeneration, nextVerificationGeneration, revokeUserSecurityVerifications } from "../../core/security-verification.js";
import { hashSecurityPin } from "../../core/security-pin-credential.js";
import { PASSWORD_MIN_LENGTH } from "../../core/auth.js";
import { resolveAdminActivationState } from "./admin-account-activation-policy.js";

export function registerAuthAdminRoutes(deps: AuthRouteDependencies) {
  const notificationService = deps.notificationService;
  const { app, prisma, authorization, inspectInstanceSetup, isDiscordConfigured, normalizeAuthUsername, verifyPassword, dummyPasswordHash, rateLimitKey, clearRateLimitKey, logSecurityEvent, createSession, decorateUserForClient, accountNextStep, validateNewPassword, hashPassword, generateTemporaryPassword, nextAccountState, getCurrentSession, hashToken, randomOAuthState, oauthStateDigest, fetchWithTimeout, safeAuthenticationReason, requireConfirmation, parseJsonObject, onUserSessionsRevoked } = deps;
  const REQUIRE_DISCORD_LINK = deps.requireDiscordLink;
  const DEV_LOGIN_ENABLED = deps.devLoginEnabled;
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

  async function requireOwnerAuthorityForTarget(admin: any, targetUserId: string, reply: any) {
    const targetOwner = await (prisma as any).workspaceMember.findFirst({ where: { userId: targetUserId, role: "owner" }, select: { id: true } });
    if (!targetOwner) return true;
    const actorOwner = await (prisma as any).workspaceMember.findFirst({ where: { userId: admin.id, role: "owner" }, select: { id: true } });
    if (actorOwner) return true;
    reply.code(403).send({ ok: false, code: "OWNER_ACCOUNT_REQUIRES_OWNER", error: "Only a workspace owner can change security or lifecycle state for another owner account." });
    return false;
  }

app.get("/api/admin/password-reset-requests", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const query = z.object({ status: z.enum(["pending", "fulfilled", "dismissed", "all"]).default("pending") }).parse(request.query || {});
  const rows = await (prisma as any).passwordResetRequest.findMany({
    where: query.status === "all" ? {} : { status: query.status },
    include: { user: true, resolvedBy: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 250,
  });
  return { ok: true, items: rows.map((row: any) => ({
    id: row.id, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt, resolution: row.resolution,
    user: { id: row.user.id, username: row.user.username, displayName: row.user.displayName, email: row.user.email, phoneNumber: row.user.phoneNumber, avatarUrl: row.user.avatarUrl },
    resolvedBy: row.resolvedBy ? { id: row.resolvedBy.id, username: row.resolvedBy.username, displayName: row.resolvedBy.displayName } : null,
  })) };
});

app.post("/api/admin/password-reset-requests/:requestId/dismiss", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ requestId: z.string() }).parse(request.params);
  const resetRequest = await (prisma as any).passwordResetRequest.findUnique({ where: { id: params.requestId }, include: { user: true } });
  if (!resetRequest) return reply.code(404).send({ ok: false, error: "Reset request not found." });
  if (resetRequest.status !== "pending") return reply.code(409).send({ ok: false, error: "This reset request has already been resolved." });
  const resolvedAt = new Date();
  await (prisma as any).passwordResetRequest.update({ where: { id: resetRequest.id }, data: { status: "dismissed", resolvedById: admin.id, resolvedAt, resolution: "dismissed" } });
  await (prisma as any).notificationInboxItem.updateMany({ where: { entityType: "password_reset_request", entityId: resetRequest.id, dismissedAt: null }, data: { dismissedAt: resolvedAt, readAt: resolvedAt } }).catch(() => undefined);
  const reviewedNotification = await (prisma as any).notificationInboxItem.create({ data: { userId: resetRequest.userId, category: "system", priority: "normal", title: "Password reset request reviewed", message: "An administrator reviewed your password reset request. Contact an administrator if you still cannot sign in.", entityType: "password_reset_request", entityId: resetRequest.id, actorLabel: admin.displayName || admin.username, metadata: JSON.stringify({ status: "dismissed" }) } }).catch(() => null);
  notificationService?.publishRecord(reviewedNotification);
  await logSecurityEvent({ event: "account.password_reset_request_dismissed", actorUserId: admin.id, targetUserId: resetRequest.userId, result: "SUCCESS", reasonCode: "ADMIN_ACTION", request });
  return { ok: true };
});

app.post("/api/admin/users/:userId/password-reset", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const target = await (prisma as any).user.findUnique({ where: { id: params.userId } });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  if (target.archived || target.accountState === "PRIVACY_ERASED" || (target.accessExpiresAt && new Date(target.accessExpiresAt) <= new Date())) return reply.code(409).send({ ok: false, code: "PEOPLE_LIFECYCLE_GOVERNED", error: "Complete the governed People return/renewal workflow before issuing a temporary password." });
  const temporaryPassword = generateTemporaryPassword();
  const resetAt = new Date();
  await (prisma as any).$transaction([
    (prisma as any).user.update({
      where: { id: target.id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        passwordChangedAt: null,
        authenticationGeneration: nextAuthenticationGeneration(target),
        verificationGeneration: nextVerificationGeneration(target),
        accountState: "PASSWORD_RESET_REQUIRED",
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    }),
    (prisma as any).session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: resetAt, revocationReason: "admin_password_reset" },
    }),
  ]);
  onUserSessionsRevoked(target.id, "admin_password_reset");
  await logSecurityEvent({
    event: "account.password_reset_required",
    actorUserId: admin.id,
    targetUserId: target.id,
    result: "SUCCESS",
    reasonCode: "ADMIN_TEMPORARY_PASSWORD",
    request,
  });
  const fulfilledAt = new Date();
  const pendingRequests = await (prisma as any).passwordResetRequest.findMany({ where: { userId: target.id, status: "pending" }, select: { id: true } }).catch(() => []);
  if (pendingRequests.length) {
    await (prisma as any).passwordResetRequest.updateMany({ where: { id: { in: pendingRequests.map((row: any) => row.id) } }, data: { status: "fulfilled", resolvedById: admin.id, resolvedAt: fulfilledAt, resolution: "temporary_password_issued" } }).catch(() => undefined);
    await (prisma as any).notificationInboxItem.updateMany({ where: { entityType: "password_reset_request", entityId: { in: pendingRequests.map((row: any) => row.id) }, dismissedAt: null }, data: { dismissedAt: fulfilledAt, readAt: fulfilledAt } }).catch(() => undefined);
  }
  const issuedNotification = await (prisma as any).notificationInboxItem.create({ data: { userId: target.id, category: "system", priority: "high", title: "Password reset issued", message: "An administrator issued a temporary password for your account. Change it after signing in.", entityType: "account", entityId: target.id, actorLabel: admin.displayName || admin.username, metadata: JSON.stringify({ action: "password_reset" }) } }).catch(() => null);
  notificationService?.publishRecord(issuedNotification);
  return { ok: true, username: target.username, temporaryPassword };
});


app.post("/api/admin/users/:userId/authenticators/reset", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  if (!requireConfirmation(request, reply, "RESET AUTHENTICATORS")) return;
  const params = z.object({ userId: z.string().min(1) }).parse(request.params);
  if (params.userId === admin.id) return reply.code(409).send({ ok: false, code: "MFA_ADMIN_SELF_RESET_BLOCKED", error: "Use your own account security settings to replace authenticators on the current administrator account." });
  const target = await (prisma as any).user.findUnique({ where: { id: params.userId }, include: { memberships: { select: { role: true } } } });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  const targetIsOwner = (target.memberships || []).some((membership: any) => String(membership.role || "").toLowerCase() === "owner");
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  const now = new Date();
  const nextGeneration = nextVerificationGeneration(target);
  await (prisma as any).$transaction([
    (prisma as any).authenticator.updateMany({ where: { userId: target.id, revokedAt: null }, data: { state: "revoked", revokedAt: now } }),
    (prisma as any).authenticatorRecoveryCode.deleteMany({ where: { userId: target.id } }),
    (prisma as any).authenticatorChallenge.deleteMany({ where: { userId: target.id } }),
    (prisma as any).user.update({ where: { id: target.id }, data: { verificationGeneration: nextGeneration } }),
    (prisma as any).session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revocationReason: "admin_authenticator_recovery" } }),
  ]);
  await revokeUserSecurityVerifications(prisma, target.id);
  onUserSessionsRevoked(target.id, "admin_authenticator_recovery");
  const notification = await (prisma as any).notificationInboxItem.create({ data: { userId: target.id, category: "system", priority: "high", title: "Authenticators reset", message: "An administrator reset your account authenticators. Sign in with your password and enroll the authenticator required by Studio security policy.", entityType: "account", entityId: target.id, actorLabel: admin.displayName || admin.username, metadata: JSON.stringify({ action: "authenticator_recovery" }) } }).catch(() => null);
  notificationService?.publishRecord(notification);
  await logSecurityEvent({ event: "mfa.admin_recovery_reset", actorUserId: admin.id, targetUserId: target.id, result: "SUCCESS", reasonCode: "ADMIN_AUTHENTICATOR_RECOVERY", request, metadata: { targetWasOwner: targetIsOwner, revokedSessions: true, verificationGeneration: nextGeneration } });
  return { ok: true, userId: target.id, requiresReenrollment: true, sessionsRevoked: true };
});

app.put("/api/admin/users/:userId/pin", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const body = z.object({ pin: z.string().regex(/^\d{4,8}$/) }).parse(request.body);
  const target = await (prisma as any).user.findUnique({ where: { id: params.userId } });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  const updated = await (prisma as any).user.update({
    where: { id: target.id },
    data: { pinHash: await hashSecurityPin(body.pin), pinUpdatedAt: new Date(), failedPinCount: 0, pinLockedUntil: null, verificationGeneration: nextVerificationGeneration(target) },
  });
  await revokeUserSecurityVerifications(prisma, target.id);
  await logSecurityEvent({ event: "account.pin_admin_set", actorUserId: admin.id, targetUserId: target.id, result: "SUCCESS", reasonCode: "ADMIN_ACTION", request });
  return { ok: true, user: await decorateUserForClient(updated) };
});

app.delete("/api/admin/users/:userId/pin", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const target = await (prisma as any).user.findUnique({ where: { id: params.userId } });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  const updated = await (prisma as any).user.update({
    where: { id: target.id },
    data: { pinHash: null, pinUpdatedAt: null, failedPinCount: 0, pinLockedUntil: null, verificationGeneration: nextVerificationGeneration(target) },
  });
  await revokeUserSecurityVerifications(prisma, target.id);
  await logSecurityEvent({ event: "account.pin_reset", actorUserId: admin.id, targetUserId: target.id, result: "SUCCESS", reasonCode: "ADMIN_ACTION", request });
  return { ok: true, user: await decorateUserForClient(updated) };
});

app.put("/api/admin/users/:userId/password", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const body = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH) }).parse(request.body);
  const target = await (prisma as any).user.findUnique({ where: { id: params.userId } });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  if (target.archived || target.accountState === "PRIVACY_ERASED" || (target.accessExpiresAt && new Date(target.accessExpiresAt) <= new Date())) return reply.code(409).send({ ok: false, code: "PEOPLE_LIFECYCLE_GOVERNED", error: "Return or renew access through the governed People lifecycle before provisioning credentials." });
  let password: string;
  try {
    password = validateNewPassword(body.password, target);
  } catch (error) {
    return reply.code(400).send({ ok: false, code: "PASSWORD_POLICY_REJECTED", error: error instanceof Error ? error.message : "Password does not meet account policy." });
  }
  const now = new Date();
  const updated = await (prisma as any).user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: now, authenticationGeneration: nextAuthenticationGeneration(target), verificationGeneration: nextVerificationGeneration(target), accountState: nextAccountState(target.discordUserId, REQUIRE_DISCORD_LINK), failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
  });
  await (prisma as any).session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revocationReason: "admin_password_changed" } });
  onUserSessionsRevoked(target.id, "admin_password_changed");
  await logSecurityEvent({ event: "account.password_admin_set", actorUserId: admin.id, targetUserId: target.id, result: "SUCCESS", reasonCode: "ADMIN_ACTION", request });
  return { ok: true, user: await decorateUserForClient(updated) };
});

app.patch("/api/admin/users/:userId/account-state", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const body = z.object({ state: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]) }).parse(request.body);
  if (params.userId === admin.id && body.state !== "ACTIVE") {
    return reply.code(400).send({
      ok: false,
      error: "You cannot suspend or disable your own account.",
    });
  }
  const target = await (prisma as any).user.findUnique({
    where: { id: params.userId },
  });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  if (body.state === "ACTIVE" && (target.archived || target.accountState === "PRIVACY_ERASED" || (target.accessExpiresAt && new Date(target.accessExpiresAt) <= new Date()))) return reply.code(409).send({ ok: false, code: "PEOPLE_LIFECYCLE_GOVERNED", error: "Archived, erased or expired identities cannot be activated. Use the governed return or access renewal workflow." });
  if (body.state === "ACTIVE" && !target.passwordHash) {
    return reply.code(409).send({
      ok: false,
      error: "The account must complete password setup before it can be activated.",
    });
  }
  // Re-enabling never bypasses initial provision or password-reset handoff.
  const state = body.state === "ACTIVE"
    ? resolveAdminActivationState(target, REQUIRE_DISCORD_LINK, nextAccountState)
    : body.state;
  const now = new Date();
  const disablingAccess = state !== "ACTIVE";
  const operations: any[] = [
    (prisma as any).user.update({
      where: { id: target.id },
      data: {
        accountState: state,
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        ...(disablingAccess ? { authenticationGeneration: nextAuthenticationGeneration(target), verificationGeneration: nextVerificationGeneration(target) } : {}),
      },
    }),
  ];
  if (disablingAccess) {
    operations.push(
      (prisma as any).session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revocationReason: "account_state_changed" } }),
      (prisma as any).securityVerificationGrant.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } }),
      (prisma as any).authenticatorChallenge.deleteMany({ where: { userId: target.id } }),
    );
    if (state === "DISABLED") {
      operations.push(
        (prisma as any).deviceRegistration.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, proofStatus: "revoked" } }),
        (prisma as any).authenticator.updateMany({ where: { userId: target.id, revokedAt: null }, data: { state: "revoked", revokedAt: now } }),
        (prisma as any).authenticatorRecoveryCode.deleteMany({ where: { userId: target.id } }),
        (prisma as any).discordLinkChallenge.deleteMany({ where: { userId: target.id } }),
      );
    }
  }
  const [updated] = await (prisma as any).$transaction(operations);
  if (disablingAccess) onUserSessionsRevoked(target.id, "account_state_changed");
  await logSecurityEvent({
    event: state === "SUSPENDED" ? "account.suspended" : state === "DISABLED" ? "account.disabled" : "account.activated",
    actorUserId: admin.id,
    targetUserId: target.id,
    result: "SUCCESS",
    reasonCode: "ADMIN_ACTION",
    request,
    metadata: { requestedState: body.state, appliedState: state },
  });
  return { ok: true, user: await decorateUserForClient(updated) };
});

app.delete("/api/admin/users/:userId/discord-link", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  if (!requireConfirmation(request, reply, "CLEAR DISCORD LINK")) return;
  const params = z.object({ userId: z.string() }).parse(request.params);
  const target = await (prisma as any).user.findUnique({
    where: { id: params.userId },
  });
  if (!target) return reply.code(404).send({ ok: false, error: "User not found." });
  if (!(await requireOwnerAuthorityForTarget(admin, target.id, reply))) return;
  await (prisma as any).$transaction([
    (prisma as any).user.update({
      where: { id: target.id },
      data: {
        discordUserId: null,
        discordUsername: null,
        discordDisplayName: null,
        discordAvatar: null,
        discordLinkedAt: null,
        discordLastVerifiedAt: null,
        accountState: nextAccountState(null, REQUIRE_DISCORD_LINK),
      },
    }),
    (prisma as any).session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: "discord_link_cleared" },
    }),
  ]);
  onUserSessionsRevoked(target.id, "discord_link_cleared");
  await logSecurityEvent({
    event: "discord.link_cleared",
    actorUserId: admin.id,
    targetUserId: target.id,
    result: "SUCCESS",
    reasonCode: "ADMIN_ACTION",
    request,
  });
  return { ok: true };
});

}
