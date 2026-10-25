export function createSessionRepository(prisma: any) {
  return {
    listForUser(userId: string) {
      return prisma.session.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: "desc" },
      });
    },
    listActive(limit = 250) {
      return prisma.session.findMany({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        include: { user: true },
        orderBy: { lastSeenAt: "desc" },
        take: limit,
      });
    },
    findById(id: string, includeUser = false) {
      return prisma.session.findUnique({ where: { id }, ...(includeUser ? { include: { user: true } } : {}) });
    },
    revoke(id: string, reason = "user_revoked") {
      return prisma.session.update({ where: { id }, data: { revokedAt: new Date(), revocationReason: reason } });
    },
    revokeOthers(userId: string, currentId: string, reason = "revoke_others") {
      return prisma.session.updateMany({ where: { userId, id: { not: currentId }, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: reason } });
    },
    revokeUser(userId: string, reason = "admin_revoked_user") {
      return prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: reason } });
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;
