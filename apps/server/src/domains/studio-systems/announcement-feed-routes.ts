import { z } from "zod";

/** The reader side of announcements: what each person received, newest
 *  first, with their own read and acknowledgement state. Delivery remains the
 *  Inbox item the publisher created, so read/acknowledge reuse those records.
 *  Settings editors also see every published announcement with its reach. */
export function registerAnnouncementFeedRoutes(deps: { app: any; prisma: any; authorization: any; getCurrentUser: (request: any) => Promise<any> }) {
  const { app, prisma, authorization, getCurrentUser } = deps;

  app.get("/api/announcements", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to read announcements." });
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query || {});
    const identity = await authorization.identityForRequest(request);
    const manager = Boolean(identity.decorated?.isAdmin) || authorization.hasToolPermission(identity.user, identity.role, "settings", "edit");
    const deliveries = await prisma.notificationInboxItem.findMany({
      where: { userId: user.id, entityType: "announcement", entityId: { not: null } },
      orderBy: { createdAt: "desc" }, take: limit,
      select: { id: true, entityId: true, readAt: true, acknowledgedAt: true, requiresAction: true },
    });
    const byAnnouncement = new Map<string, any>(deliveries.map((item: any) => [item.entityId, item]));
    const rows = await prisma.studioAnnouncement.findMany({
      where: { status: "published", ...(manager ? {} : { id: { in: [...byAnnouncement.keys()] } }) },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: limit,
      include: { publishedBy: { select: { id: true, displayName: true, username: true, avatarUrl: true } }, createdBy: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
    });
    const reach = manager && rows.length ? await prisma.notificationInboxItem.groupBy({
      by: ["entityId"], where: { entityType: "announcement", entityId: { in: rows.map((row: any) => row.id) } },
      _count: { _all: true, readAt: true, acknowledgedAt: true },
    }) : [];
    const reachById = new Map<string, any>(reach.map((row: any) => [row.entityId, row._count]));
    reply.header("Cache-Control", "private, no-store");
    return {
      manager,
      announcements: rows.map((row: any) => {
        const delivery = byAnnouncement.get(row.id);
        const author = row.createdBy || row.publishedBy;
        const counts = reachById.get(row.id);
        return {
          id: row.id, title: row.title, body: row.body, priority: row.priority,
          requiresAcknowledgement: row.requiresAcknowledgement, publishedAt: row.publishedAt,
          author: author ? { id: author.id, name: author.displayName || author.username, avatarUrl: author.avatarUrl || null } : null,
          deliveryId: delivery?.id || null, read: Boolean(delivery?.readAt), acknowledgedAt: delivery?.acknowledgedAt || null,
          reach: manager ? { delivered: row.deliveryCount, read: counts?.readAt || 0, acknowledged: counts?.acknowledgedAt || 0 } : null,
        };
      }),
    };
  });
}
