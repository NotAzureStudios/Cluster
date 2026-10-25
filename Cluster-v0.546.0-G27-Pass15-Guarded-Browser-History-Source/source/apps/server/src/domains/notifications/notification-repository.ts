import { cursorWhere } from "../../core/cursor-pagination.js";

function parseObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeIds(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function createNotificationRepository(prisma: any) {
  return {
    async list(userId: string, options: { limit: number; cursor?: any; includeRead?: boolean; includeSnoozed?: boolean; categories?: string[]; priorities?: string[]; tools?: string[]; signals?: string[]; requiresAction?: boolean; query?: string }) {
      const now = new Date();
      const query = String(options.query || "").trim();
      const where: any = {
        userId,
        dismissedAt: null,
        ...(options.includeRead ? {} : { readAt: null }),
        ...(options.includeSnoozed ? {} : { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }),
        ...(options.categories ? { category: { in: options.categories } } : {}),
        ...(options.priorities?.length ? { priority: { in: options.priorities } } : {}),
        ...(options.tools?.length ? { tool: { in: options.tools } } : {}),
        ...(options.signals?.length ? { signal: { in: options.signals } } : {}),
        ...(typeof options.requiresAction === "boolean" ? { requiresAction: options.requiresAction } : {}),
        ...(cursorWhere(options.cursor || null, "createdAt", "desc") || {}),
      };
      if (query) {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { OR: [
            { title: { contains: query, mode: "insensitive" } },
            { message: { contains: query, mode: "insensitive" } },
            { projectLabel: { contains: query, mode: "insensitive" } },
            { actorLabel: { contains: query, mode: "insensitive" } },
          ] },
        ];
      }
      return prisma.notificationInboxItem.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: options.limit + 1,
      });
    },


    summaryRecords(userId: string, categories?: string[]) {
      return prisma.notificationInboxItem.findMany({
        where: { userId, dismissedAt: null, ...(categories ? { category: { in: categories } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          activityEventId: true,
          projectId: true,
          boardId: true,
          cardId: true,
          entityType: true,
          entityId: true,
          category: true,
          tool: true,
          priority: true,
          readAt: true,
          snoozedUntil: true,
          requiresAction: true,
          acknowledgedAt: true,
        },
      });
    },

    digestRecords(userId: string, since: Date, categories?: string[]) {
      return prisma.notificationInboxItem.findMany({
        where: { userId, dismissedAt: null, entityType: { not: "notification_digest" }, createdAt: { gte: since }, ...(categories ? { category: { in: categories } } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },
    async summary(userId: string, categories?: string[]) {
      const now = new Date();
      const normalizedCategories = normalizeIds(categories || []);
      const values: unknown[] = [userId, now];
      const categoryClause = normalizedCategories.length
        ? ` AND "category" IN (${normalizedCategories.map((category) => { values.push(category); return `$${values.length}`; }).join(", ")})`
        : "";
      const rows = await prisma.$queryRawUnsafe(`
        WITH filtered AS MATERIALIZED (
          SELECT "category", "tool", "priority", "readAt", "snoozedUntil", "requiresAction", "acknowledgedAt"
          FROM "NotificationInboxItem"
          WHERE "userId" = $1 AND "dismissedAt" IS NULL${categoryClause}
        )
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE "readAt" IS NULL AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= $2))::int AS unread,
          count(*) FILTER (WHERE "snoozedUntil" > $2)::int AS snoozed,
          count(*) FILTER (WHERE "priority" = 'critical' AND "readAt" IS NULL AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= $2))::int AS critical,
          count(*) FILTER (WHERE "priority" = 'high' AND "readAt" IS NULL AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= $2))::int AS high,
          count(*) FILTER (WHERE "requiresAction" = TRUE AND "readAt" IS NULL AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= $2))::int AS requires_action,
          count(*) FILTER (WHERE "requiresAction" = TRUE AND "acknowledgedAt" IS NULL AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= $2))::int AS unacknowledged,
          COALESCE((SELECT jsonb_object_agg("category", category_count)::text FROM (SELECT "category", count(*)::int AS category_count FROM filtered GROUP BY "category") category_counts), '{}') AS categories_json,
          COALESCE((SELECT jsonb_object_agg("tool", tool_count)::text FROM (SELECT "tool", count(*)::int AS tool_count FROM filtered WHERE "tool" IS NOT NULL GROUP BY "tool") tool_counts), '{}') AS tools_json
        FROM filtered
      `, ...values) as Array<{
        total: number | bigint | string;
        unread: number | bigint | string;
        snoozed: number | bigint | string;
        critical: number | bigint | string;
        high: number | bigint | string;
        requires_action: number | bigint | string;
        unacknowledged: number | bigint | string;
        categories_json: string | null;
        tools_json: string | null;
      }>;
      const row = rows[0] || {} as any;
      const numberValue = (value: unknown) => Number(value || 0);
      const parseCounts = (value: unknown) => {
        try { return value ? JSON.parse(String(value)) as Record<string, number> : {}; } catch { return {}; }
      };
      return {
        total: numberValue(row.total),
        unread: numberValue(row.unread),
        snoozed: numberValue(row.snoozed),
        critical: numberValue(row.critical),
        high: numberValue(row.high),
        requiresAction: numberValue(row.requires_action),
        unacknowledged: numberValue(row.unacknowledged),
        categories: parseCounts(row.categories_json),
        tools: parseCounts(row.tools_json),
      };
    },

    async digest(userId: string, since: Date, categories?: string[]) {
      const categoryFilter = categories ? { category: { in: categories } } : {};
      const rows = await prisma.notificationInboxItem.groupBy({
        by: ["category", "priority"],
        where: { userId, dismissedAt: null, entityType: { not: "notification_digest" }, createdAt: { gte: since }, ...categoryFilter },
        _count: { _all: true },
      });
      const top = await prisma.notificationInboxItem.findMany({
        where: { userId, dismissedAt: null, entityType: { not: "notification_digest" }, createdAt: { gte: since }, priority: { in: ["critical", "high"] }, ...categoryFilter },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
      });
      return { since: since.toISOString(), rows, top };
    },

    groupingRows(userId: string, since: Date, includeRead = true) {
      return prisma.notificationInboxItem.findMany({
        where: { userId, dismissedAt: null, createdAt: { gte: since }, ...(includeRead ? {} : { readAt: null }) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1_000,
      });
    },

    dismissedRecords(userId: string, ids?: string[]) {
      return prisma.notificationInboxItem.findMany({
        where: { userId, dismissedAt: { not: null }, ...(ids?.length ? { id: { in: normalizeIds(ids) } } : {}) },
      });
    },
    markRead(userId: string, ids: string[], read: boolean) {
      return prisma.notificationInboxItem.updateMany({ where: { userId, id: { in: normalizeIds(ids) } }, data: { readAt: read ? new Date() : null } });
    },
    dismiss(userId: string, ids: string[]) {
      return prisma.notificationInboxItem.updateMany({ where: { userId, id: { in: normalizeIds(ids) } }, data: { dismissedAt: new Date(), readAt: new Date() } });
    },
    restoreDismissed(userId: string, ids?: string[]) {
      return prisma.notificationInboxItem.updateMany({ where: { userId, dismissedAt: { not: null }, ...(ids?.length ? { id: { in: normalizeIds(ids) } } : {}) }, data: { dismissedAt: null } });
    },
    snooze(userId: string, ids: string[], until: Date | null) {
      return prisma.notificationInboxItem.updateMany({ where: { userId, id: { in: normalizeIds(ids) } }, data: { snoozedUntil: until } });
    },
    acknowledge(userId: string, ids: string[], acknowledged: boolean) {
      const now = new Date();
      return prisma.notificationInboxItem.updateMany({
        where: { userId, id: { in: normalizeIds(ids) }, requiresAction: true },
        data: { acknowledgedAt: acknowledged ? now : null, ...(acknowledged ? { readAt: now } : {}) },
      });
    },
    recordsByIds(userId: string, ids: string[]) {
      return prisma.notificationInboxItem.findMany({ where: { userId, id: { in: normalizeIds(ids) } } });
    },

    escalationCandidates(now: Date, limit = 500, after?: { createdAt: Date; id: string } | null) {
      const cursorFilter = after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : null;
      return prisma.notificationInboxItem.findMany({
        where: {
          requiresAction: true,
          acknowledgedAt: null,
          dismissedAt: null,
          escalationLevel: { lt: 3 },
          createdAt: { lte: new Date(now.getTime() - 60 * 60 * 1000) },
          AND: [
            { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
            ...(cursorFilter ? [cursorFilter] : []),
          ],
        },
        include: { user: { select: { id: true, preferences: true, workingPattern: { select: { timezone: true } } } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: Math.min(Math.max(limit, 1), 1_000),
      });
    },

    async updateEscalation(userId: string, id: string, input: { level: number; priority: string; metadata: Record<string, unknown>; escalatedAt: Date }) {
      const changed = await prisma.notificationInboxItem.updateMany({
        where: { id, userId, requiresAction: true, acknowledgedAt: null, dismissedAt: null, escalationLevel: { lt: input.level } },
        data: { escalationLevel: input.level, priority: input.priority, lastEscalatedAt: input.escalatedAt, metadata: JSON.stringify(input.metadata) },
      });
      if (!changed.count) return null;
      return prisma.notificationInboxItem.findUnique({ where: { id } });
    },

    digestUsers(limit = 500, afterId?: string | null) {
      return prisma.user.findMany({
        where: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] }, ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true, preferences: true, workingPattern: { select: { timezone: true } }, username: true, displayName: true, preferredName: true },
        orderBy: [{ id: "asc" }],
        take: Math.min(Math.max(limit, 1), 1_000),
      });
    },

    async claimDigestDelivery(userId: string, slot: { cadence: string; periodKey: string; periodStart: Date; periodEnd: Date; scheduledFor: Date }) {
      const where = { userId_cadence_periodKey: { userId, cadence: slot.cadence, periodKey: slot.periodKey } };
      const existing = await prisma.notificationDigestDelivery.findUnique({ where });
      if (existing) return { record: existing, claimed: false };
      try {
        const record = await prisma.notificationDigestDelivery.create({ data: { userId, cadence: slot.cadence, periodKey: slot.periodKey, periodStart: slot.periodStart, periodEnd: slot.periodEnd, scheduledFor: slot.scheduledFor } });
        return { record, claimed: true };
      } catch {
        const record = await prisma.notificationDigestDelivery.findUnique({ where });
        return { record, claimed: false };
      }
    },

    digestDelivery(id: string) {
      return prisma.notificationDigestDelivery.findUnique({ where: { id }, include: { user: { select: { id: true, preferences: true, workingPattern: { select: { timezone: true } }, username: true, displayName: true, preferredName: true } } } });
    },

    latestDigestDelivery(userId: string) {
      return prisma.notificationDigestDelivery.findFirst({ where: { userId, deliveredAt: { not: null } }, orderBy: [{ deliveredAt: "desc" }, { id: "desc" }] });
    },

    completeDigestDelivery(id: string, input: { deliveredAt: Date; notificationInboxItemId: string | null; summaryJson: string }) {
      return prisma.notificationDigestDelivery.update({ where: { id }, data: input });
    },

    createDigestInboxItem(input: any) {
      return prisma.notificationInboxItem.create({ data: input });
    },

    async pruneLifecycle(now: Date, retention: { dismissedDays: number; readDays: number; unreadDays: number; acknowledgedDays: number; digestDeliveryDays: number }) {
      const daysAgo = (days: number) => new Date(now.getTime() - Math.max(1, days) * 86_400_000);
      const [dismissed, read, unread, acknowledged, digests] = await prisma.$transaction([
        prisma.notificationInboxItem.deleteMany({ where: { dismissedAt: { lt: daysAgo(retention.dismissedDays) }, requiresAction: false } }),
        prisma.notificationInboxItem.deleteMany({ where: { dismissedAt: null, readAt: { lt: daysAgo(retention.readDays) }, requiresAction: false } }),
        prisma.notificationInboxItem.deleteMany({ where: { dismissedAt: null, readAt: null, createdAt: { lt: daysAgo(retention.unreadDays) }, requiresAction: false } }),
        prisma.notificationInboxItem.deleteMany({ where: { requiresAction: true, acknowledgedAt: { lt: daysAgo(retention.acknowledgedDays) } } }),
        prisma.notificationDigestDelivery.deleteMany({ where: { createdAt: { lt: daysAgo(retention.digestDeliveryDays) } } }),
      ]);
      return { dismissed: dismissed.count, read: read.count, unread: unread.count, acknowledged: acknowledged.count, digests: digests.count };
    },

    async deliver(input: any, recipientIds: string[]) {
      const recipients = normalizeIds(recipientIds);
      if (!input.activityEventId || typeof input.activityEventId !== "string") throw new Error("NOTIFICATION_ACTIVITY_ID_REQUIRED");
      if (recipients.length > 5000) throw new Error("NOTIFICATION_RECIPIENT_LIMIT");
      if (!recipients.length) return { count: 0, records: [] as any[] };
      const deliverable = await prisma.user.findMany({
        where: { id: { in: recipients }, archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } },
        select: { id: true },
      });
      const deliverableIds = new Set(deliverable.map((user: any) => String(user.id)));
      const records: any[] = [];
      for (const userId of recipients) {
        if (!deliverableIds.has(userId)) continue;
        // A published activity ID is immutable. Re-materialization after
        // restart/reconnect must NOT re-fire native/email delivery or repaint
        // an already-read inbox record. The database unique key is the claim.
        let record: any;
        try {
          record = await prisma.notificationInboxItem.create({ data: {

            userId,
            activityEventId: input.activityEventId,
            category: input.category,
            priority: input.priority,
            title: input.title,
            message: input.message ?? null,
            projectId: input.projectId ?? null,
            projectLabel: input.projectLabel ?? null,
            boardId: input.boardId ?? null,
            cardId: input.cardId ?? null,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            resourceKind: input.resourceKind ?? null,
            resourceId: input.resourceId ?? null,
            resourceProjectId: input.resourceProjectId ?? null,
            actorLabel: input.actorLabel ?? null,
            groupKey: input.groupKey ?? null,
            tool: input.tool ?? null,
            signal: input.signal ?? null,
            requiresAction: Boolean(input.requiresAction),
            escalationLevel: Number(input.escalationLevel || 0),
            metadata: JSON.stringify(input.metadata ?? {}),
            readAt: input.readAt ? (input.readAt instanceof Date ? input.readAt : new Date(input.readAt)) : null,
            createdAt: input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt || Date.now()),
          } });
        } catch (error: any) {
          if (error?.code === "P2002") continue; // Already materialized.
          throw error;
        }
        records.push(record);
      }
      return { count: records.length, records };
    },

    async recipientUsersForActivity(event: any) {
      const meta = parseObject(event.metadata);
      const ids = normalizeIds([
        ...(Array.isArray(meta.userIds) ? meta.userIds : []),
        ...(Array.isArray(meta.mentionedUserIds) ? meta.mentionedUserIds : []),
        meta.assigneeId,
        meta.userId,
        meta.targetUserId,
        meta.reviewerId,
        meta.ownerId,
        event.card?.assigneeId,
      ]);
      const explicitMentionIds = normalizeIds(Array.isArray(meta.mentionedUserIds) ? meta.mentionedUserIds : []);
      const mentionTokens = explicitMentionIds.length || meta.mention === true
        ? []
        : [...`${event.title || ""} ${event.message || ""}`.matchAll(/@([a-z0-9_.-]{2,64})/gi)]
            .map((match) => String(match[1] || "").toLowerCase());
      if (mentionTokens.length) {
        const activeUsers = await prisma.user.findMany({
          where: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } },
          select: { id: true, username: true, displayName: true, preferredName: true },
          take: 5_000,
        });
        const mentionSet = new Set(mentionTokens);
        for (const user of activeUsers) {
          const candidates = [user.username, user.displayName, user.preferredName]
            .map((value) => String(value || "").trim().toLowerCase())
            .filter(Boolean);
          if (candidates.some((candidate) => mentionSet.has(candidate))) ids.push(user.id);
        }
      }
      if (meta.broadcast === true) {
        const active = await prisma.user.findMany({ where: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } }, select: { id: true } });
        ids.push(...active.map((user: any) => user.id));
      }
      const recipientIds = normalizeIds(ids);
      if (!recipientIds.length) return [];
      return prisma.user.findMany({
        where: { id: { in: recipientIds }, archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } },
        select: { id: true, preferences: true, workingPattern: { select: { timezone: true } }, username: true, displayName: true, preferredName: true },
        take: Math.min(recipientIds.length, 5_000),
      });
    },


    async backfillRecent(limit = 500) {
      return prisma.activityEvent.findMany({
        include: { user: true, project: { include: { memberships: { where: { status: "active" } } } }, card: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 2_000),
      });
    },
  };
}
