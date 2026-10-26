import { CLUSTER_DOMAIN_EVENTS, clusterResourceAddressFromEntity } from "@cluster/shared";
import { createClusterDomainEvent } from "../../core/domain-events.js";
import { resolveStudioAudienceUserIds } from "../access/studio-audience.js";

/** Single publication authority for manual and scheduled announcements.
 * The status CAS, audience snapshot, activity and durable notification outbox
 * are committed in the same transaction. A failed audience read / outbox write
 * rolls everything back. Repeated worker claims cannot send duplicates.
 */
export function createStudioAnnouncementDelivery(input: { prisma: any; events: any }) {
  const { prisma, events } = input;
  async function publish(id: string, options: { now?: Date; actorUserId?: string | null; scheduled: boolean }) {
    const now = options.now ?? new Date();
    const result = await prisma.$transaction(async (tx: any) => {
      const current = await tx.studioAnnouncement.findUnique({ where: { id } });
      if (!current) return { outcome: "not_found" as const };
      const eligible = options.scheduled
        ? current.status === "scheduled" && current.scheduledAt && new Date(current.scheduledAt).getTime() <= now.getTime()
        : current.status === "draft";
      if (!eligible) return { outcome: "not_ready" as const };
      const userIds = await resolveStudioAudienceUserIds(tx, current.audienceJson, { strict: true });
      if (userIds.length > 5_000) throw new Error("ANNOUNCEMENT_AUDIENCE_LIMIT");
      const updated = await tx.studioAnnouncement.updateMany({
        where: { id, status: current.status, revision: current.revision, ...(options.scheduled ? { scheduledAt: { lte: now } } : {}) },
        data: { status: "published", publishedById: options.actorUserId ?? null, publishedAt: now, deliveryCount: userIds.length, revision: { increment: 1 } },
      });
      if (updated.count !== 1) return { outcome: "conflict" as const };
      const metadata = {
        userIds, notifyInbox: true, notificationSignal: "announcement", notificationPriority: current.priority,
        requiresAction: current.requiresAcknowledgement, notificationGroupKey: `announcement:${id}`,
        discordDeliveryRequested: current.discordDeliveryRequested, scheduledPublication: options.scheduled,
      };
      const activity = await tx.activityEvent.create({ data: {
        userId: options.actorUserId ?? null, type: "published", entityType: "announcement", entityId: id,
        title: current.title, message: current.body, metadata: JSON.stringify(metadata),
      } });
      await events.appendInTransaction(tx, createClusterDomainEvent(CLUSTER_DOMAIN_EVENTS.activityRecorded, {
        occurredAt: activity.createdAt instanceof Date ? activity.createdAt : now,
        actorUserId: activity.userId ?? null,
        resource: clusterResourceAddressFromEntity({ entityType: "announcement", entityId: id }),
        payload: activity,
      }));
      return { outcome: "published" as const, deliveryCount: userIds.length };
    }, { timeout: 20_000 });
    if (result.outcome === "published") events.wake();
    return result;
  }

  async function runDue(options: { now?: Date; limit?: number } = {}) {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(50, options.limit ?? 25));
    const rows = await prisma.studioAnnouncement.findMany({
      where: { status: "scheduled", scheduledAt: { lte: now } },
      select: { id: true }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: limit,
    });
    let published = 0; let stale = 0;
    for (const row of rows) {
      const result = await publish(row.id, { now, scheduled: true });
      if (result.outcome === "published") published += 1;
      else stale += 1;
    }
    return { examined: rows.length, published, stale, remainingPossible: rows.length === limit };
  }
  return { publish, runDue };
}
