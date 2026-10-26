import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthorizationService } from "../access/authorization.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createSessionRepository } from "./session-repository.js";
import { createSessionService, serializeSessionRecord } from "./session-service.js";
import { serializeDeviceRecord } from "./session-device.js";
import { deviceProofRotationMessage, verifyPresentedDeviceKey } from "./device-proof.js";

type SessionRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  authorization: AuthorizationService;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>;
  clearCurrentSessionCache: (request: FastifyRequest) => void;
  onSessionRevoked: (sessionId: string, userId: string, reason: string) => void;
  onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void;
  requireConfirmation: (request: FastifyRequest, reply: FastifyReply, expected: string) => boolean;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  logSecurityEvent: (input: any) => Promise<unknown>;
  serializeUserLite: (user: any) => any;
  sessionCookie: string;
  sessionIdleHours: number;
  sessionMaxPerUser: number;
};

export function registerSessionRoutes(deps: SessionRouteDependencies) {
  const { app, prisma, authorization, getCurrentSession, clearCurrentSessionCache, onSessionRevoked, onUserSessionsRevoked, requireConfirmation, logActivity, logSecurityEvent, serializeUserLite, sessionCookie, sessionIdleHours, sessionMaxPerUser } = deps;
  const repository = createSessionRepository(prisma);
  const service = createSessionService(repository, logActivity, onSessionRevoked, onUserSessionsRevoked);
  const sessionParams = z.object({ sessionId: z.string() });
  const userParams = z.object({ userId: z.string() });
  const deviceParams = z.object({ deviceId: z.string().uuid() });
  const adminDeviceParams = z.object({ userId: z.string(), deviceId: z.string().uuid() });
  const deviceLabelBody = z.object({ label: z.string().trim().max(80).nullable().optional() });
  const deviceProofRotationBody = z.object({
    publicKeySpki: z.string().min(32).max(1024),
    signature: z.string().min(32).max(512),
    timestamp: z.string().regex(/^\d{13}$/),
  });

  async function revokeDeviceSessions(userId: string, deviceId: string, reason: string) {
    // Session revocation, device revocation and Package-pin deactivation must commit
    // together. Never report a revoked device while its explicit release pins remain active.
    const revokedSessionIds = await (prisma as any).$transaction(async (tx: any) => {
      const registration = await tx.deviceRegistration.findUnique({ where: { userId_deviceId: { userId, deviceId } }, select: { id: true } });
      const sessions = await tx.session.findMany({ where: { userId, deviceId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (sessions.length) await tx.session.updateMany({ where: { id: { in: sessions.map((item: any) => item.id) } }, data: { revokedAt: new Date(), revocationReason: reason } });
      await tx.deviceRegistration.updateMany({ where: { userId, deviceId }, data: { revokedAt: new Date() } });
      if (registration) await tx.managedPackagePin.updateMany({ where: { deviceId: registration.id, active: true }, data: { active: false, revision: { increment: 1 } } });
      return sessions.map((item: any) => item.id);
    }, { isolationLevel: "Serializable" });
    revokedSessionIds.forEach((sessionId: string) => onSessionRevoked(sessionId, userId, reason));
    return revokedSessionIds;
  }

  async function devicesForUser(userId: string, currentSessionId?: string | null) {
    const [registrations, sessions] = await Promise.all([
      (prisma as any).deviceRegistration.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" } }).catch(() => []),
      (prisma as any).session.findMany({ where: { userId, deviceId: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }).catch(() => []),
    ]);
    const byDevice = new Map<string, any[]>();
    sessions.forEach((session: any) => {
      const key = String(session.deviceId || "");
      if (!key) return;
      byDevice.set(key, [...(byDevice.get(key) || []), session]);
    });
    return registrations.map((device: any) => serializeDeviceRecord(device, byDevice.get(String(device.deviceId)) || [], currentSessionId));
  }

  app.get("/api/me/sessions", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const sessions = await repository.listForUser(current.userId);
    return { ok: true, sessions: sessions.map((session: any) => serializeSessionRecord(session, current.id, serializeUserLite)) };
  });

  app.delete("/api/me/sessions/:sessionId", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { sessionId } = sessionParams.parse(request.params);
    const target = await repository.findById(sessionId);
    if (!target || target.userId !== current.userId) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Session not found." });
    const result = await service.revokePersonal(current, target);
    await logSecurityEvent({ event: "session.revoked", actorUserId: current.userId, targetUserId: current.userId, result: "SUCCESS", reasonCode: result.currentSessionRevoked ? "CURRENT_SESSION_REVOKED" : "PERSONAL_SESSION_REVOKED", request, metadata: { revokedSessionId: target.id } });
    if (result.currentSessionRevoked) {
      clearCurrentSessionCache(request);
      reply.clearCookie(sessionCookie, { path: "/" });
      reply.header("Clear-Site-Data", '"cookies"');
    }
    return result;
  });

  app.post("/api/me/sessions/revoke-others", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    if (!requireConfirmation(request, reply, "REVOKE OTHER SESSIONS")) return;
    const result = await service.revokeOthers(current);
    await logSecurityEvent({ event: "session.others_revoked", actorUserId: current.userId, targetUserId: current.userId, result: "SUCCESS", reasonCode: "USER_REVOKE_OTHERS", request, metadata: { revokedCount: result.revoked } });
    return result;
  });


  app.get("/api/me/devices", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    return { ok: true, devices: await devicesForUser(current.userId, current.id) };
  });

  app.patch("/api/me/devices/:deviceId", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { deviceId } = deviceParams.parse(request.params);
    const body = deviceLabelBody.parse(request.body || {});
    const existing = await (prisma as any).deviceRegistration.findUnique({ where: { userId_deviceId: { userId: current.userId, deviceId } } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Device not found." });
    const updated = await (prisma as any).deviceRegistration.update({ where: { id: existing.id }, data: { label: String(body.label || "").trim() || null } });
    const sessions = await (prisma as any).session.findMany({ where: { userId: current.userId, deviceId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    await logSecurityEvent({ event: "device.renamed", actorUserId: current.userId, targetUserId: current.userId, result: "SUCCESS", reasonCode: "USER_DEVICE_LABEL", request, metadata: { deviceId, label: updated.label || null } });
    return { ok: true, device: serializeDeviceRecord(updated, sessions, current.id) };
  });


  app.post("/api/me/devices/:deviceId/proof/rotate", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    if (!requireConfirmation(request, reply, "ROTATE DEVICE PROOF")) return;
    const { deviceId } = deviceParams.parse(request.params);
    if (String(current.deviceId || "") !== deviceId) return reply.code(409).send({ ok: false, code: "DEVICE_PROOF_CURRENT_DEVICE_REQUIRED", error: "Only the current installation can rotate its device proof key." });
    const body = deviceProofRotationBody.parse(request.body || {});
    const timestampMs = Number(body.timestamp);
    if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > 2 * 60 * 1000) return reply.code(400).send({ ok: false, code: "DEVICE_PROOF_STALE", error: "The device proof rotation request expired. Try again." });
    const proof = verifyPresentedDeviceKey({ publicKeySpki: body.publicKeySpki, signature: body.signature, message: deviceProofRotationMessage({ deviceId, timestamp: body.timestamp }) });
    if (!proof.ok) return reply.code(400).send({ ok: false, code: proof.code, error: "The new device key could not be verified." });
    const existing = await (prisma as any).deviceRegistration.findUnique({ where: { userId_deviceId: { userId: current.userId, deviceId } } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Device not found." });
    const now = new Date();
    const updated = await (prisma as any).deviceRegistration.update({ where: { id: existing.id }, data: { proofStatus: "verified", proofAlgorithm: proof.algorithm, proofPublicKeySpki: body.publicKeySpki, proofKeyFingerprint: proof.fingerprint, proofVerifiedAt: now, proofLastSeenAt: now, revokedAt: null } });
    await logSecurityEvent({ event: "device.proof_rotated", actorUserId: current.userId, targetUserId: current.userId, result: "SUCCESS", reasonCode: "USER_DEVICE_PROOF_ROTATED", request, metadata: { deviceId, previousFingerprint: existing.proofKeyFingerprint || null, nextFingerprint: proof.fingerprint } });
    const sessions = await (prisma as any).session.findMany({ where: { userId: current.userId, deviceId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    return { ok: true, device: serializeDeviceRecord(updated, sessions, current.id) };
  });

  app.delete("/api/me/devices/:deviceId", async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    if (!requireConfirmation(request, reply, "REVOKE DEVICE")) return;
    const { deviceId } = deviceParams.parse(request.params);
    const existing = await (prisma as any).deviceRegistration.findUnique({ where: { userId_deviceId: { userId: current.userId, deviceId } } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Device not found." });
    const revokedSessionIds = await revokeDeviceSessions(current.userId, deviceId, "device_revoked");
    const currentSessionRevoked = revokedSessionIds.includes(current.id);
    await logSecurityEvent({ event: "device.revoked", actorUserId: current.userId, targetUserId: current.userId, result: "SUCCESS", reasonCode: "USER_REVOKE_DEVICE", request, metadata: { deviceId, revokedSessionCount: revokedSessionIds.length } });
    if (currentSessionRevoked) {
      clearCurrentSessionCache(request);
      reply.clearCookie(sessionCookie, { path: "/" });
      reply.header("Clear-Site-Data", '"cookies"');
    }
    return { ok: true, revoked: revokedSessionIds.length, currentSessionRevoked };
  });

  app.get("/api/admin/devices", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const current = await getCurrentSession(request);
    const registrations = await (prisma as any).deviceRegistration.findMany({ include: { user: true }, orderBy: { lastSeenAt: "desc" }, take: 1000 });
    const sessions = await (prisma as any).session.findMany({ where: { deviceId: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 5000 });
    const byKey = new Map<string, any[]>();
    sessions.forEach((session: any) => { const key = `${session.userId}:${session.deviceId}`; byKey.set(key, [...(byKey.get(key) || []), session]); });
    return { ok: true, devices: registrations.map((device: any) => ({ ...serializeDeviceRecord(device, byKey.get(`${device.userId}:${device.deviceId}`) || [], current?.id || null), user: serializeUserLite(device.user), userId: device.userId })) };
  });

  app.delete("/api/admin/devices/:userId/:deviceId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "REVOKE DEVICE")) return;
    const { userId, deviceId } = adminDeviceParams.parse(request.params);
    const existing = await (prisma as any).deviceRegistration.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Device not found." });
    const revokedSessionIds = await revokeDeviceSessions(userId, deviceId, "admin_device_revoked");
    const current = await getCurrentSession(request);
    const currentSessionRevoked = Boolean(current?.id && revokedSessionIds.includes(current.id));
    await logSecurityEvent({ event: "device.admin_revoked", actorUserId: admin.id, targetUserId: userId, result: "SUCCESS", reasonCode: "ADMIN_REVOKE_DEVICE", request, metadata: { deviceId, revokedSessionCount: revokedSessionIds.length } });
    if (currentSessionRevoked) { clearCurrentSessionCache(request); reply.clearCookie(sessionCookie, { path: "/" }); reply.header("Clear-Site-Data", '"cookies"'); }
    return { ok: true, revoked: revokedSessionIds.length, currentSessionRevoked };
  });

  app.get("/api/admin/sessions", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const current = await getCurrentSession(request);
    const sessions = await repository.listActive();
    return { ok: true, sessions: sessions.map((session: any) => serializeSessionRecord(session, current?.id || null, serializeUserLite)), idleHours: sessionIdleHours, maxPerUser: sessionMaxPerUser };
  });

  app.delete("/api/admin/sessions/:sessionId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "REVOKE SESSION")) return;
    const { sessionId } = sessionParams.parse(request.params);
    const target = await repository.findById(sessionId, true);
    if (!target) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Session not found." });
    const current = await getCurrentSession(request);
    const result = await service.revokeAsAdmin(admin, target);
    await logSecurityEvent({ event: "session.admin_revoked", actorUserId: admin.id, targetUserId: target.userId, result: "SUCCESS", reasonCode: "ADMIN_REVOKE_SESSION", request, metadata: { revokedSessionId: target.id } });
    if (current?.id === target.id) {
      clearCurrentSessionCache(request);
      reply.clearCookie(sessionCookie, { path: "/" });
      reply.header("Clear-Site-Data", '"cookies"');
    }
    return result;
  });

  app.post("/api/admin/sessions/revoke-user/:userId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "REVOKE USER SESSIONS")) return;
    const { userId } = userParams.parse(request.params);
    const result = await service.revokeUserAsAdmin(admin, userId);
    await logSecurityEvent({ event: "session.user_revoked", actorUserId: admin.id, targetUserId: userId, result: "SUCCESS", reasonCode: "ADMIN_REVOKE_USER_SESSIONS", request, metadata: { revokedCount: result.revoked } });
    return result;
  });
}
