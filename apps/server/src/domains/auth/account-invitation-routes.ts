import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";
import {
  accountInvitationDigest, accountInvitationEligible, approvedAccountInvitationOrigin,
  ACCOUNT_INVITATION_TOKEN_PATTERN, ACCOUNT_INVITATION_TTL_MS, createAccountInvitationToken,
} from "./account-invitation-policy.js";

const publicInvalid = {
  ok: false, code: "ACCOUNT_INVITATION_UNAVAILABLE",
  error: "This activation link is unavailable or expired. Request a new link from your studio administrator.",
};
const inviteParams = z.object({ userId: z.string().min(1).max(160) });
const revokeParams = z.object({ invitationId: z.string().min(1).max(160) });

/** The activation protocol deliberately does NOT create a session. A member
 * must use normal sign-in and all configured MFA/Discord gates afterward. */
export function registerAccountInvitationRoutes(deps: AuthRouteDependencies) {
  const { app, prisma, getCurrentSession, authorization, hashPassword, nextAccountState,
    validateNewPassword, readSettings, getCurrentSession: getSession,
    rateLimitKey, hashToken, logSecurityEvent, onUserSessionsRevoked,
    requireDiscordLink, passwordMinLength, passwordMaxLength, webOrigin } = deps;

  const loadActor = async (request: any, reply: any) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return null;
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: admin.id }, orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
      return null;
    }
    return { admin, membership };
  };

  const loadTarget = async (actor: any, userId: string) => {
    const target = await prisma.user.findFirst({
      where: { id: userId, memberships: { some: { workspaceId: actor.membership.workspaceId } } },
      select: {
        id: true, username: true, displayName: true, archived: true,
        accountState: true, accountType: true, passwordHash: true,
        passwordChangedAt: true, authenticationGeneration: true,
        accessExpiresAt: true, discordUserId: true,
        memberships: { where: { workspaceId: actor.membership.workspaceId }, select: { role: true }, take: 1 },
      },
    });
    if (!target?.memberships?.length) return null;
    return target;
  };

  app.post("/api/admin/users/:userId/account-invitations", async (request, reply) => {
    const actor = await loadActor(request, reply);
    if (!actor) return;
    const params = inviteParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, code: "INVITATION_TARGET_INVALID" });
    const origin = approvedAccountInvitationOrigin(webOrigin);
    if (!origin) {
      return reply.code(409).send({
        ok: false, code: "INVITATION_HTTPS_ORIGIN_REQUIRED",
        error: "Configure a canonical HTTPS studio web origin before issuing an invitation link. Local loopback is allowed for development.",
      });
    }
    const target = await loadTarget(actor, params.data.userId);
    if (!target) return reply.code(404).send({ ok: false, code: "INVITATION_TARGET_NOT_FOUND" });
    if ((target.memberships[0]?.role === "owner" || target.memberships[0]?.role === "admin") &&
      actor.membership.role !== "owner")
      return reply.code(403).send({ ok: false, code: "ROLE_OWNER_REQUIRED" });
    if (!accountInvitationEligible(target))
      return reply.code(409).send({ ok: false, code: "INVITATION_STATE_INELIGIBLE", error: "Only newly provisioned accounts awaiting their first password can receive activation links." });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCOUNT_INVITATION_TTL_MS);
    const { token, digest } = createAccountInvitationToken();
    const issued = await prisma.$transaction(async (tx: any) => {
      // Compare-and-swap protects concurrent issuance and lifecycle changes.
      const changed = await tx.user.updateMany({
        where: {
          id: target.id, archived: false, accountState: "PASSWORD_CHANGE_REQUIRED",
          passwordChangedAt: null, authenticationGeneration: target.authenticationGeneration,
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
        },
        data: {
          passwordHash: null, // Revokes the temporary password immediately.
          authenticationGeneration: { increment: 1 },
          verificationGeneration: { increment: 1 },
        },
      });
      if (changed.count !== 1) return null;
      await tx.studioAccountInvitation.updateMany({
        where: { userId: target.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: now, revokedById: actor.admin.id },
      });
      const invitation = await tx.studioAccountInvitation.create({
        data: {
          workspaceId: actor.membership.workspaceId, userId: target.id, issuedById: actor.admin.id,
          tokenHash: digest, authGeneration: target.authenticationGeneration + 1, expiresAt,
        },
        select: { id: true, createdAt: true, expiresAt: true },
      });
      await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now, revocationReason: "activation_invitation_issued" },
      });
      await tx.securityVerificationGrant.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return invitation;
    });
    if (!issued) return reply.code(409).send({ ok: false, code: "INVITATION_TARGET_CHANGED", error: "The account changed. Reload its current state before retrying." });

    onUserSessionsRevoked(target.id, "activation_invitation_issued");
    await logSecurityEvent({
      event: "account.invitation_issued", actorUserId: actor.admin.id,
      targetUserId: target.id, workspaceId: actor.membership.workspaceId,
      result: "SUCCESS", reasonCode: "ONE_TIME_INVITATION", request,
      metadata: { invitationId: issued.id, expiresAt: expiresAt.toISOString(), temporaryPasswordRevoked: true },
    });
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return {
      ok: true, id: issued.id, username: target.username,
      expiresAt: expiresAt.toISOString(),
      activationLink: `${origin}/#activate=${token}`, // Shown once, never persisted.
      note: "The previous temporary password is invalidated. Share this link privately. The recipient must choose a password, then sign in normally.",
    };
  });

  app.get("/api/admin/users/:userId/account-invitations", async (request, reply) => {
    const actor = await loadActor(request, reply);
    if (!actor) return;
    const params = inviteParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, code: "INVITATION_TARGET_INVALID" });
    const target = await loadTarget(actor, params.data.userId);
    if (!target) return reply.code(404).send({ ok: false, code: "INVITATION_TARGET_NOT_FOUND" });
    const invitations = await prisma.studioAccountInvitation.findMany({
      where: { workspaceId: actor.membership.workspaceId, userId: target.id },
      select: { id: true, createdAt: true, expiresAt: true, consumedAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" }, take: 20,
    });
    reply.header("Cache-Control", "no-store");
    return {
      ok: true, invitations: invitations.map((item: any) => ({
        id: item.id, createdAt: item.createdAt, expiresAt: item.expiresAt,
        status: item.consumedAt ? "accepted" : item.revokedAt ? "revoked" : item.expiresAt <= new Date() ? "expired" : "pending",
      })),
    };
  });

  app.post("/api/admin/account-invitations/:invitationId/revoke", async (request, reply) => {
    const actor = await loadActor(request, reply);
    if (!actor) return;
    const params = revokeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, code: "INVITATION_ID_INVALID" });
    const invitation = await prisma.studioAccountInvitation.findFirst({
      where: { id: params.data.invitationId, workspaceId: actor.membership.workspaceId },
      select: { id: true, userId: true },
    });
    if (!invitation) return reply.code(404).send({ ok: false, code: "INVITATION_NOT_FOUND" });
    const target = await loadTarget(actor, invitation.userId);
    if (!target) return reply.code(404).send({ ok: false, code: "INVITATION_TARGET_NOT_FOUND" });
    if (["owner", "admin"].includes(target.memberships[0]?.role) && actor.membership.role !== "owner")
      return reply.code(403).send({ ok: false, code: "ROLE_OWNER_REQUIRED" });
    const changed = await prisma.studioAccountInvitation.updateMany({
      where: { id: invitation.id, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.admin.id },
    });
    if (changed.count) await logSecurityEvent({
      event: "account.invitation_revoked", actorUserId: actor.admin.id,
      targetUserId: target.id, workspaceId: actor.membership.workspaceId,
      result: "SUCCESS", reasonCode: "ADMIN_INVITATION_REVOCATION", request,
      metadata: { invitationId: invitation.id },
    });
    return { ok: true, revoked: Boolean(changed.count) };
  });

  app.post("/api/auth/account-invitations/activate", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    const body = z.object({
      token: z.string().regex(ACCOUNT_INVITATION_TOKEN_PATTERN),
      password: z.string().min(passwordMinLength).max(passwordMaxLength),
    }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send(publicInvalid);
    const digest = accountInvitationDigest(body.data.token);
    const rateKey = `account-activation:${digest.slice(0,24)}:${hashToken(String(request.ip || "local")).slice(0,16)}`;
    if (await rateLimitKey(reply, rateKey, 5, 15 * 60 * 1000)) return;
    const invitation = await prisma.studioAccountInvitation.findUnique({
      where: { tokenHash: digest },
      include: { user: true },
    });
    const now = new Date();
    if (!invitation || invitation.revokedAt || invitation.consumedAt || invitation.expiresAt <= now ||
        !invitation.user || !accountInvitationEligible(invitation.user, now) ||
        invitation.user.authenticationGeneration !== invitation.authGeneration)
      return reply.code(400).send(publicInvalid);

    let password: string;
    try { password = validateNewPassword(body.data.password, invitation.user); }
    catch (error) {
      return reply.code(400).send({
        ok: false, code: "INVITATION_PASSWORD_POLICY",
        error: error instanceof Error ? error.message : "Password does not meet studio policy.",
      });
    }
    const passwordHash = await hashPassword(password);
    const consumed = await prisma.$transaction(async (tx: any) => {
      // The invite row is locked by its conditional update. A simultaneous
      // acceptance cannot use the same token twice.
      const claimed = await tx.studioAccountInvitation.updateMany({
        where: { id: invitation.id, tokenHash: digest, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) return null;
      const changed = await tx.user.updateMany({
        where: {
          id: invitation.userId, archived: false, accountState: "PASSWORD_CHANGE_REQUIRED",
          passwordChangedAt: null, authenticationGeneration: invitation.authGeneration,
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
        },
        data: {
          passwordHash, passwordChangedAt: now,
          accountState: nextAccountState(invitation.user.discordUserId, requireDiscordLink),
          authenticationGeneration: { increment: 1 },
          verificationGeneration: { increment: 1 },
          failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null,
        },
      });
      // A changed/disabled account MUST roll back the consumed token too.
      if (changed.count !== 1) throw new Error("ACCOUNT_INVITATION_TARGET_CHANGED");
      await tx.session.updateMany({
        where: { userId: invitation.userId, revokedAt: null },
        data: { revokedAt: now, revocationReason: "account_invitation_activated" },
      });
      await tx.securityVerificationGrant.updateMany({
        where: { userId: invitation.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return invitation.userId;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "ACCOUNT_INVITATION_TARGET_CHANGED") return null;
      throw error;
    });
    if (!consumed) return reply.code(400).send(publicInvalid);
    onUserSessionsRevoked(consumed, "account_invitation_activated");
    await logSecurityEvent({
      event: "account.invitation_activated", actorUserId: consumed, targetUserId: consumed,
      workspaceId: invitation.workspaceId, result: "SUCCESS", reasonCode: "SELF_SET_PASSWORD", request,
      metadata: { invitationId: invitation.id, sessionCreated: false },
    });
    return { ok: true, message: "Password created. Sign in normally to complete MFA and first-login setup." };
  });
}
