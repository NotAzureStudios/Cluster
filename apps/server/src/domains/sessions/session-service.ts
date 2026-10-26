import type { SessionRepository } from "./session-repository.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";

export function serializeSessionRecord(session: any, currentSessionId?: string | null, serializeUser?: (user: any) => any) {
  return {
    id: session.id,
    userId: session.userId,
    user: session.user ? serializeUser?.(session.user) : undefined,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    authMethod: session.authMethod || "password",
    deviceId: session.deviceId || null,
    revocationReason: session.revocationReason || null,
    userAgent: session.userAgent || "Unknown client",
    ipAddress: session.ipAddress || null,
    current: Boolean(currentSessionId && session.id === currentSessionId),
  };
}

export function createSessionService(
  repository: SessionRepository,
  logActivity: (input: ActivityRecordInput) => Promise<unknown>,
  onSessionRevoked: (sessionId: string, userId: string, reason: string) => void,
  onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void,
) {
  return {
    async revokePersonal(current: any, target: any) {
      await repository.revoke(target.id, "user_revoked");
      onSessionRevoked(target.id, target.userId, "user_revoked");
      await logActivity({ userId: current.userId, type: "security", entityType: "session", entityId: target.id, title: "Session revoked", message: target.id === current.id ? "Current session revoked" : "Personal session revoked" });
      return { ok: true, currentSessionRevoked: target.id === current.id };
    },
    async revokeOthers(current: any) {
      const result = await repository.revokeOthers(current.userId, current.id, "revoke_others");
      onUserSessionsRevoked(current.userId, "revoke_others", current.id);
      await logActivity({ userId: current.userId, type: "security", entityType: "session", entityId: current.id, title: "Other sessions revoked", message: `${result.count} session(s) revoked` });
      return { ok: true, revoked: result.count };
    },
    async revokeAsAdmin(admin: any, target: any) {
      await repository.revoke(target.id, "admin_revoked");
      onSessionRevoked(target.id, target.userId, "admin_revoked");
      await logActivity({ userId: admin.id, type: "security", entityType: "session", entityId: target.id, title: "Admin revoked session", message: target.user?.displayName || target.user?.username || target.userId });
      return { ok: true };
    },
    async revokeUserAsAdmin(admin: any, userId: string) {
      const result = await repository.revokeUser(userId, "admin_revoked_user");
      onUserSessionsRevoked(userId, "admin_revoked_user");
      await logActivity({ userId: admin.id, type: "security", entityType: "user", entityId: userId, title: "User sessions revoked", message: `${result.count} session(s) revoked` });
      return { ok: true, revoked: result.count };
    },
  };
}
