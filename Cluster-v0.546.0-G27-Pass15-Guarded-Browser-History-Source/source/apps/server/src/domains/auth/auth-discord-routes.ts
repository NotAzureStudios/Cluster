import { z } from "zod";
import type { AuthRouteDependencies } from "./auth-types.js";

export function registerDiscordAuthRoutes(deps: AuthRouteDependencies) {
  const { app, prisma, authorization, inspectInstanceSetup, isDiscordConfigured, normalizeAuthUsername, verifyPassword, dummyPasswordHash, rateLimitKey, clearRateLimitKey, logSecurityEvent, createSession, decorateUserForClient, accountNextStep, validateNewPassword, hashPassword, generateTemporaryPassword, nextAccountState, getCurrentSession, hashToken, randomOAuthState, oauthStateDigest, fetchWithTimeout, safeAuthenticationReason, requireConfirmation, parseJsonObject, onUserSessionsRevoked } = deps;
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

app.get("/api/auth/discord/link", async (request, reply) => {
  if (!isDiscordConfigured()) {
    return reply.status(400).send({
      ok: false,
      error: "Discord OAuth is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI on the server.",
    });
  }
  const session = await getCurrentSession(request);
  if (!session) return reply.code(401).send({ ok: false, error: "Login required." });
  const user = session.user as any;
  if (!["DISCORD_LINK_REQUIRED", "ACTIVE"].includes(String(user.accountState))) {
    return reply.code(409).send({
      ok: false,
      error: "Complete password setup before linking Discord.",
    });
  }

  const redirectUri = process.env.DISCORD_REDIRECT_URI || "http://localhost:4000/api/auth/discord/callback";
  const state = randomOAuthState();
  const expiresAt = new Date(Date.now() + DISCORD_LINK_STATE_LIFETIME_MS);
  await (prisma as any).discordLinkChallenge.deleteMany({
    where: {
      userId: user.id,
      OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
    },
  });
  await (prisma as any).discordLinkChallenge.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      stateHash: oauthStateDigest(AUTH_SECRET, state),
      redirectUri,
      expiresAt,
    },
  });

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  await logSecurityEvent({
    event: "discord.link_started",
    actorUserId: user.id,
    targetUserId: user.id,
    result: "SUCCESS",
    reasonCode: "USER_INITIATED",
    request,
    metadata: { expiresAt: expiresAt.toISOString() },
  });
  return reply.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/api/auth/discord/callback", async (request, reply) => {
  const query = z
    .object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    })
    .parse(request.query);
  const failureRedirect = (reason: string) => reply.redirect(`${WEB_ORIGIN}/?discord_error=${encodeURIComponent(reason)}`);
  if (query.error) return failureRedirect(query.error);
  if (!query.code || !query.state) return failureRedirect("missing_oauth_parameters");

  const challenge = await (prisma as any).discordLinkChallenge.findUnique({
    where: { stateHash: oauthStateDigest(AUTH_SECRET, query.state) },
    include: { user: true, session: true },
  });
  const now = new Date();
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt).getTime() <= now.getTime() || challenge.session.revokedAt || new Date(challenge.session.expiresAt).getTime() <= now.getTime() || challenge.session.userId !== challenge.userId) {
    await logSecurityEvent({
      event: "discord.link_failed",
      actorUserId: challenge?.userId || null,
      targetUserId: challenge?.userId || null,
      result: "FAILURE",
      reasonCode: "INVALID_OR_EXPIRED_STATE",
      request,
    });
    return failureRedirect("invalid_or_expired_state");
  }

  const consumedChallenge = await (prisma as any).discordLinkChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumedChallenge.count !== 1) {
    await logSecurityEvent({
      event: "discord.link_failed",
      actorUserId: challenge.userId,
      targetUserId: challenge.userId,
      result: "FAILURE",
      reasonCode: "STATE_ALREADY_CONSUMED",
      request,
    });
    return failureRedirect("invalid_or_expired_state");
  }
  let accessToken = "";
  try {
    const tokenResponse = await fetchWithTimeout("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: challenge.redirectUri,
      }),
    }, undefined, { purpose: "Discord OAuth", requireHttps: true, allowedHosts: ["discord.com"], maxResponseBytes: 2 * 1024 * 1024 });
    if (!tokenResponse.ok) throw new Error("TOKEN_EXCHANGE_FAILED");
    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    accessToken = String(tokenData.access_token || "");
    if (!accessToken) throw new Error("TOKEN_EXCHANGE_FAILED");

    const userResponse = await fetchWithTimeout("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${accessToken}` } }, undefined, { purpose: "Discord OAuth", requireHttps: true, allowedHosts: ["discord.com"], maxResponseBytes: 2 * 1024 * 1024 });
    if (!userResponse.ok) throw new Error("IDENTITY_FETCH_FAILED");
    const discordUser = (await userResponse.json()) as {
      id?: string;
      username?: string;
      global_name?: string | null;
      avatar?: string | null;
    };
    if (!discordUser.id || !/^\d{5,32}$/.test(discordUser.id) || !discordUser.username) throw new Error("INVALID_DISCORD_IDENTITY");

    // A callback started before offboarding/expiry cannot re-activate a former identity.
    const liveIdentity = await (prisma as any).user.findUnique({ where: { id: challenge.userId } });
    if (!liveIdentity || liveIdentity.archived || liveIdentity.accountState === "PRIVACY_ERASED" || liveIdentity.accountState === "DISABLED" || (liveIdentity.accessExpiresAt && new Date(liveIdentity.accessExpiresAt) <= now)) throw new Error("IDENTITY_NOT_ACTIVE");
    const duplicate = await (prisma as any).user.findFirst({
      where: { discordUserId: discordUser.id, id: { not: challenge.userId } },
    });
    if (duplicate) throw new Error("DISCORD_IDENTITY_ALREADY_LINKED");

    const avatarUrl = discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null;
    const linkedUser = await (prisma as any).user.update({
      where: { id: challenge.userId },
      data: {
        discordUserId: discordUser.id,
        discordUsername: discordUser.username,
        discordDisplayName: discordUser.global_name || null,
        discordAvatar: avatarUrl,
        discordLinkedAt: challenge.user.discordUserId ? challenge.user.discordLinkedAt || now : now,
        discordLastVerifiedAt: now,
        accountState: "ACTIVE",
        lastSeenAt: now,
      },
    });
    await (prisma as any).session.updateMany({
      where: { userId: linkedUser.id, revokedAt: null },
      data: { revokedAt: now, revocationReason: "discord_identity_changed" },
    });
    onUserSessionsRevoked(linkedUser.id, "discord_identity_changed");
    await createSession(linkedUser.id, reply, request, { authMethod: "discord" });
    await logSecurityEvent({
      event: challenge.user.discordUserId ? "discord.link_changed" : "discord.link_succeeded",
      actorUserId: linkedUser.id,
      targetUserId: linkedUser.id,
      result: "SUCCESS",
      reasonCode: challenge.user.discordUserId ? "USER_RELINKED" : "REQUIRED_LINK_COMPLETED",
      request,
      metadata: { discordUserId: discordUser.id, sessionsRotated: true },
    });
    return reply.redirect(`${WEB_ORIGIN}/?discord=linked`);
  } catch (error) {
    const reason = safeAuthenticationReason(error);
    await logSecurityEvent({
      event: "discord.link_failed",
      actorUserId: challenge.userId,
      targetUserId: challenge.userId,
      result: "FAILURE",
      reasonCode: reason,
      request,
    });
    return failureRedirect(reason.toLowerCase());
  } finally {
    if (accessToken) {
      await fetchWithTimeout("https://discord.com/api/oauth2/token/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID!,
          client_secret: process.env.DISCORD_CLIENT_SECRET!,
          token: accessToken,
          token_type_hint: "access_token",
        }),
      }, undefined, { purpose: "Discord OAuth", requireHttps: true, allowedHosts: ["discord.com"], maxResponseBytes: 2 * 1024 * 1024 }).catch(() => undefined);
    }
  }
});
}
