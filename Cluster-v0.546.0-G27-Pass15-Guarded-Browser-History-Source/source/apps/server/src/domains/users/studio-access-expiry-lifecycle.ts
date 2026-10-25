import { lockPeopleProfile } from "./people-governance.js";
const DAY = 86_400_000;
export function accessNoticeStage(expiresAt: Date, now = new Date()): "seven_days" | "one_day" | "expired" | null {
  const delta = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(delta)) return null;
  if (delta <= 0) return "expired";
  if (delta <= DAY) return "one_day";
  if (delta <= 7 * DAY) return "seven_days";
  return null;
}
/** Date-based authorization is already immediate. This sweep supplies durable evidence,
 * revokes expired sessions and delivers one administrative notice per exact access window. */
export async function runStudioAccessExpiryTick(input: { prisma: any; now?: Date; limit?: number }) {
  const { prisma } = input;
  const now = input.now || new Date();
  // `limit` is a page size, not a total-user ceiling. All eligible identities
  // must be considered, even when more than 500 have expiring access.
  const limit = Math.min(500, Math.max(1, input.limit || 250));
  const horizon = new Date(now.getTime() + 7 * DAY);
  const adminIds: string[] = [];
  let lastAdminId: string | null = null;
  while (true) {
    const admins: Array<{ userId: string }> = await prisma.workspaceMember.findMany({
      where: { role: { in: ["owner", "admin"] }, ...(lastAdminId ? { userId: { gt: lastAdminId } } : {}),
        user: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } },
      select: { userId: true }, orderBy: { userId: "asc" }, distinct: ["userId"], take: limit,
    });
    adminIds.push(...admins.map((admin) => String(admin.userId)));
    if (admins.length < limit) break;
    const next = String(admins[admins.length - 1].userId);
    if (lastAdminId && next <= lastAdminId) throw new Error("Administrator pagination did not advance.");
    lastAdminId = next;
  }
  const recipients = [...new Set(adminIds)];
  let inspected = 0;
  let lastExpiry: Date | null = null;
  let lastId: string | null = null;
  let delivered = 0; let revokedSessions = 0;
  while (true) {
    const after = lastExpiry && lastId ? { OR: [
      { accessExpiresAt: { gt: lastExpiry } },
      { accessExpiresAt: lastExpiry, id: { gt: lastId } },
    ] } : {};
    const due: Array<{ id: string; accessExpiresAt: Date }> = await prisma.user.findMany({
      where: { AND: [
        { archived: false, accountState: { notIn: ["DISABLED", "PRIVACY_ERASED"] }, accessExpiresAt: { not: null, lte: horizon } },
        after,
      ] },
      select: { id: true, accessExpiresAt: true }, orderBy: [{ accessExpiresAt: "asc" }, { id: "asc" }], take: limit,
    });
    if (!due.length) break;
    if (!recipients.length) throw new Error("No active Studio administrator can receive access-expiry notices.");
    inspected += due.length;
    for (const candidate of due) {
    const result = await prisma.$transaction(async (tx: any) => {
      await lockPeopleProfile(tx, candidate.id);
      const fresh = await tx.user.findUnique({ where: { id: candidate.id }, select: { id: true, archived: true, accountState: true, accessExpiresAt: true, username: true, displayName: true } });
      if (!fresh || fresh.archived || ["DISABLED", "PRIVACY_ERASED"].includes(fresh.accountState) || !fresh.accessExpiresAt) return { delivered: 0, revoked: 0 };
      const stage = accessNoticeStage(fresh.accessExpiresAt, now);
      if (!stage) return { delivered: 0, revoked: 0 };
      const created = await tx.studioAccessExpiryNotice.createMany({ data: [{ userId: fresh.id, expiresAt: fresh.accessExpiresAt, stage, notifiedAt: now }], skipDuplicates: true });
      if (created.count !== 1) return { delivered: 0, revoked: 0 };
      const sessions = stage === "expired" ? await tx.session.updateMany({ where: { userId: fresh.id, revokedAt: null }, data: { revokedAt: now } }) : { count: 0 };
      const expires = new Date(fresh.accessExpiresAt).toISOString();
      const title = stage === "expired" ? "Studio access expired" : stage === "one_day" ? "Studio access expires within 24 hours" : "Studio access expires within 7 days";
      await tx.notificationInboxItem.createMany({ data: recipients.map((adminId) => ({ userId: adminId, category: "system", priority: stage === "expired" ? "high" : "normal", title, message: `${fresh.displayName || fresh.username} · ${expires}. Review access in Studio Settings → Access Renewals.`, entityType: "user", entityId: fresh.id, resourceKind: "user", resourceId: fresh.id, groupKey: `access-expiry:${fresh.id}:${expires}:${stage}`, tool: "people", signal: "access_expiration", requiresAction: true })) });
      return { delivered: 1, revoked: sessions.count };
    });
      delivered += result.delivered; revokedSessions += result.revoked;
    }
    const last = due[due.length - 1];
    if (lastExpiry && (new Date(last.accessExpiresAt).getTime() < lastExpiry.getTime() ||
      (new Date(last.accessExpiresAt).getTime() === lastExpiry.getTime() && last.id <= String(lastId))))
      throw new Error("Access expiry pagination did not advance.");
    lastExpiry = new Date(last.accessExpiresAt);
    lastId = last.id;
    if (due.length < limit) break;
  }
  return { inspected, delivered, revokedSessions };

}
