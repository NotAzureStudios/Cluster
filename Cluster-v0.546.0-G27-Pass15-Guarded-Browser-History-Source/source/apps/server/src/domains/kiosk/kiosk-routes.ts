import { z } from "zod";
import { normalizeClusterKioskProfiles } from "@cluster/shared";
import type { ClusterKioskRuntime } from "./kiosk-runtime.js";

const profileIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i);
const GENERIC_KIOSK_ADMIN_ERROR = "The kiosk administrator credentials could not be verified.";

export function registerKioskRoutes(deps: {
  app: any;
  prisma: any;
  readSettings: () => Promise<Record<string, any>>;
  getCurrentSession: (request: any) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  verifyPassword: (hash: string, value: string) => Promise<boolean>;
  verifyUserPin: (user: any, pin: string, purpose: string, request?: any) => Promise<boolean>;
  dummyPasswordHash: () => Promise<string>;
  normalizeAuthUsername: (value: string) => string;
  rateLimitKey: (reply: any, key: string, limit: number, windowMs: number) => Promise<boolean>;
  clearRateLimitKey: (key: string) => void;
  authRateLimitMax: number;
  apiRateLimitWindowMs: number;
  logSecurityEvent: (input: any) => Promise<any>;
  kioskRuntime: ClusterKioskRuntime;
}) {
  const { app, prisma, readSettings, getCurrentSession, decorateUserForClient, verifyPassword, verifyUserPin, dummyPasswordHash, normalizeAuthUsername, rateLimitKey, clearRateLimitKey, authRateLimitMax, apiRateLimitWindowMs, logSecurityEvent, kioskRuntime } = deps;

  app.post("/api/kiosk/session/start", async (request: any, reply: any) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const body = z.object({ profileId: profileIdSchema }).parse(request.body || {});
    const settings = await readSettings();
    const profile = normalizeClusterKioskProfiles(settings.desktopKioskProfiles).find((item) => item.id === body.profileId && item.enabled && item.sessionMode === "signed-in");
    if (!profile) return reply.code(404).send({ ok: false, code: "KIOSK_PROFILE_UNAVAILABLE", error: "The selected signed-in kiosk profile is unavailable." });
    kioskRuntime.setSession(reply, session.id, profile.id);
    await logSecurityEvent({ event: "kiosk.session_started", actorUserId: session.user?.id || null, targetUserId: session.user?.id || null, result: "SUCCESS", reasonCode: "MANAGED_KIOSK_STARTED", request, metadata: { profileId: profile.id, readOnly: profile.readOnly } });
    return { ok: true, profile: { id: profile.id, name: profile.name, readOnly: profile.readOnly, managedExitRequired: profile.managedExitRequired } };
  });

  app.post("/api/kiosk/session/end", async (request: any, reply: any) => {
    const session = await getCurrentSession(request);
    if (!session) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const active = await kioskRuntime.resolve(request, session.id);
    const body = z.object({ pin: z.string().regex(/^\d{4,8}$/).optional() }).parse(request.body || {});
    if (active?.managedExitRequired) {
      if (!body.pin) return reply.code(400).send({ ok: false, code: "KIOSK_PIN_REQUIRED", error: "Enter an administrator security PIN to exit this kiosk profile." });
      await verifyUserPin(session.user, body.pin, "exit_kiosk", request);
    }
    kioskRuntime.clearSession(reply);
    await logSecurityEvent({ event: "kiosk.session_ended", actorUserId: session.user?.id || null, targetUserId: session.user?.id || null, result: "SUCCESS", reasonCode: active?.managedExitRequired ? "PIN_VERIFIED_EXIT" : "POLICY_EXIT", request, metadata: { profileId: active?.id || null } });
    return { ok: true };
  });

  app.post("/api/kiosk/session/recover", async (request: any, reply: any) => {
    const session = await getCurrentSession(request);
    if (!session) { kioskRuntime.clearSession(reply); return { ok: true }; }
    const active = await kioskRuntime.resolve(request, session.id);
    const body = z.object({ reason: z.enum(["native_inactive", "scheduled_exit", "emergency_exit", "renderer_recovery"]).default("renderer_recovery") }).parse(request.body || {});
    kioskRuntime.clearSession(reply);
    await logSecurityEvent({ event: "kiosk.session_recovered", actorUserId: session.user?.id || null, targetUserId: session.user?.id || null, result: "SUCCESS", reasonCode: body.reason.toUpperCase(), request, metadata: { profileId: active?.id || null } });
    return { ok: true };
  });

  app.post("/api/kiosk/admin-exit", async (request: any, reply: any) => {
    const body = z.object({
      profileId: profileIdSchema,
      identifier: z.string().trim().min(1).max(320),
      credentialType: z.enum(["password", "pin"]),
      credential: z.string().min(1).max(1024),
    }).parse(request.body || {});
    const rateKey = `kiosk-admin-exit:${String(request.ip || "local").slice(0, 96)}:${body.profileId}`;
    if (await rateLimitKey(reply, rateKey, Math.max(3, Math.min(6, authRateLimitMax)), apiRateLimitWindowMs)) return;
    const settings = await readSettings();
    const profile = normalizeClusterKioskProfiles(settings.desktopKioskProfiles).find((item) => item.id === body.profileId && item.enabled && item.sessionMode === "signed-out" && item.managedExitRequired);
    const normalizedUsername = normalizeAuthUsername(body.identifier);
    const user = profile ? await prisma.user.findFirst({
      where: { OR: [{ username: { equals: normalizedUsername, mode: "insensitive" } }, { email: { equals: body.identifier, mode: "insensitive" } }] },
    }) : null;
    const decorated = user ? await decorateUserForClient(user) : null;
    let credentialMatches = false;
    if (body.credentialType === "password") credentialMatches = await verifyPassword(user?.passwordHash || await dummyPasswordHash(), body.credential);
    else if (user?.pinHash) {
      try { credentialMatches = await verifyUserPin(user, body.credential, "exit_signed_out_kiosk", request); } catch { credentialMatches = false; }
    } else {
      await verifyPassword(await dummyPasswordHash(), body.credential);
    }
    const accountAvailable = user && !["SUSPENDED", "DISABLED", "LOCKED", "PRIVACY_ERASED"].includes(String(user.accountState || ""));
    if (!profile || !user || !decorated?.isAdmin || !accountAvailable || !credentialMatches) {
      await logSecurityEvent({ event: "kiosk.admin_exit_denied", actorUserId: user?.id || null, targetUserId: user?.id || null, result: "FAILURE", reasonCode: "INVALID_ADMIN_CREDENTIALS", request, metadata: { profileId: body.profileId, credentialType: body.credentialType } });
      return reply.code(401).send({ ok: false, code: "KIOSK_ADMIN_AUTH_FAILED", error: GENERIC_KIOSK_ADMIN_ERROR });
    }
    clearRateLimitKey(rateKey);
    await logSecurityEvent({ event: "kiosk.admin_exit_verified", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: body.credentialType === "pin" ? "ADMIN_PIN" : "ADMIN_PASSWORD", request, metadata: { profileId: profile.id } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, profileId: profile.id };
  });
}
