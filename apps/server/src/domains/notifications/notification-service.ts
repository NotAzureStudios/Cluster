import { runNotificationSideEffect } from "./notification-best-effort.js";
import { CLUSTER_DOMAIN_EVENTS } from "@cluster/shared";
import { buildCursorPage } from "../../core/cursor-pagination.js";
import {
  CLUSTER_NOTIFICATION_CATEGORIES,
  CLUSTER_NOTIFICATION_PRIORITIES,
  CLUSTER_NOTIFICATION_SIGNALS,
  CLUSTER_NOTIFICATION_TOOLS,
  clusterResourceAddressFromEntity,
  clusterResourceKindFromEntityType,
  type ClusterResourceAddress,
  type NotificationCategory,
  type NotificationPriority,
  type NotificationSignal,
  type NotificationTool,
} from "@cluster/shared";
import { createNotificationRepository } from "./notification-repository.js";
import { createSubscriptionService, notificationWatchScope } from "../comments/subscription-service.js";
import { BoundedCache } from "../../core/bounded-cache.js";
import { evaluateNotificationPolicy } from "./notification-policy.js";
import {
  NOTIFICATION_RETENTION,
  notificationDigestSlot,
  notificationEscalationLevel,
  notificationEscalationPriority,
} from "./notification-lifecycle.js";

function parseObject(value: unknown) {
  if (!value) return {} as Record<string, any>;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch {
    return {} as Record<string, any>;
  }
}

function stringValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function enumValue<T extends string>(values: readonly T[], value: unknown): T | null {
  const text = String(value || "").trim() as T;
  return values.includes(text) ? text : null;
}

export function resourceAddressForNotification(event: any, metadataValue?: unknown): ClusterResourceAddress | null {
  const meta = parseObject(metadataValue ?? event?.metadata);
  const source = parseObject(meta.source);
  const entityKind = String(source.kind || meta.sourceKind || event?.entityType || "").trim().toLowerCase();
  const sourceKind = clusterResourceKindFromEntityType(entityKind);
  const projectId = stringValue(source.projectId || meta.projectId || event?.projectId || event?.project?.id);
  const entityId = stringValue(source.id || meta.sourceId || event?.entityId || event?.cardId);
  // A child record ID is NOT interchangeable with its parent's ID. Only
  // promote child notifications to a parent resource when an explicit parent
  // identifier was supplied by the event producer.
  const parentKind = entityKind === "review_comment" || entityKind === "review_version" ? "review_asset"
    : entityKind === "build_artifact" ? "build"
    : entityKind === "release_note" ? "release" : null;
  if (parentKind) {
    const parentId = parentKind === "review_asset" ? stringValue(meta.reviewAssetId || meta.assetId)
      : parentKind === "build" ? stringValue(meta.buildId)
      : stringValue(meta.releaseId);
    return parentId ? clusterResourceAddressFromEntity({ entityType: parentKind, entityId: parentId, projectId }) : null;
  }
  if (sourceKind === "review_asset") {
    const reviewId = stringValue(meta.reviewAssetId || meta.assetId || entityId);
    return reviewId ? clusterResourceAddressFromEntity({ entityType: "review_asset", entityId: reviewId, projectId }) : null;
  }
  return clusterResourceAddressFromEntity({
    entityType: sourceKind || source.kind || meta.sourceKind || event?.entityType,
    entityId: entityId || stringValue(event?.cardId),
    projectId,
  });
}

function textFor(event: any) {
  return `${event.type || ""} ${event.entityType || ""} ${event.title || ""} ${event.message || ""} ${event.metadata || ""}`.toLowerCase();
}

function inferTool(event: any, meta: Record<string, any>, text: string): NotificationTool {
  const explicit = enumValue(CLUSTER_NOTIFICATION_TOOLS, meta.notificationTool || meta.tool);
  if (explicit) return explicit;
  const source = parseObject(meta.source);
  const kind = String(source.kind || meta.sourceKind || event.entityType || "").toLowerCase();
  if (/review_asset|review_comment|review_round|review_session|version_family|video/.test(kind) || /video review|timecode|frame-accurate/.test(text)) return "review";
  if (/build|release|deploy|git|commit|merge|pull_request/.test(kind) || /build|release|deployment|pull request/.test(text)) return "builds";
  if (/qa|test/.test(kind) || /qa|test plan|regression/.test(text)) return "qa";
  if (/ticket/.test(kind)) return "tickets";
  if (/whiteboard/.test(kind)) return "whiteboards";
  if (/board|card/.test(kind)) return "boards";
  if (/schedule/.test(kind)) return "scheduler";
  if (/calendar/.test(kind)) return "calendar";
  if (/timeline|milestone/.test(kind)) return "timeline";
  if (/library|file|asset/.test(kind)) return "library";
  if (/user|person|team|profile/.test(kind)) return "people";
  if (/automation|webhook|integration|job/.test(kind) || meta.automationId || meta.automation === true) return "automation";
  if (/security|privacy|backup|session|access/.test(kind) || /security|privacy|backup/.test(text)) return "system";
  return "project";
}

function inferSignal(event: any, meta: Record<string, any>, text: string): NotificationSignal {
  const explicit = enumValue(CLUSTER_NOTIFICATION_SIGNALS, meta.notificationSignal || meta.signal);
  if (explicit) return explicit;
  if (meta.mention === true || (Array.isArray(meta.mentionedUserIds) && meta.mentionedUserIds.length) || /mention/.test(text)) return "mention";
  if (/rejected|failed|failure|error|crash|unavailable/.test(text)) return "failure";
  if (/blocked|blocker/.test(text)) return "blocked";
  if (/approval|approved|completion submitted/.test(text)) return "approval";
  if (/review requested|review session|review round|needs review|reviewer/.test(text)) return "review";
  if (/new version|version uploaded|version created|superseded|version family/.test(text)) return "version";
  if (/assign|assignee/.test(text)) return "assignment";
  if (/comment|reply|feedback|annotation/.test(text)) return "comment";
  if (/overdue|due soon|due date|deadline|milestone/.test(text)) return "due";
  if (/released|release ready|published|deployed/.test(text)) return "release";
  if (/security|privacy|access|session|backup/.test(text)) return "security";
  if (meta.broadcast === true || /announcement/.test(text)) return "announcement";
  return "activity";
}

function inferCategory(signal: NotificationSignal, tool: NotificationTool, event: any, meta: Record<string, any>, text: string): NotificationCategory {
  const explicit = enumValue(CLUSTER_NOTIFICATION_CATEGORIES, meta.notificationCategory || meta.category);
  if (explicit) return explicit;
  if (signal === "mention") return "mentions";
  if (signal === "approval" || signal === "review") return "approvals";
  if (tool === "builds" || signal === "release") return "delivery";
  if (tool === "qa") return "qa";
  if (["scheduler", "calendar", "timeline"].includes(tool) || signal === "due") return "schedule";
  if (["tickets", "boards", "whiteboards"].includes(tool) || signal === "assignment") return "work";
  if (tool === "system" || signal === "security") return "system";
  if (signal === "digest") return "system";
  if (/ticket|card|task/.test(text) || event.cardId) return "work";
  return "activity";
}

function inferPriority(signal: NotificationSignal, meta: Record<string, any>, text: string): NotificationPriority {
  const explicit = enumValue(CLUSTER_NOTIFICATION_PRIORITIES, meta.notificationPriority || meta.priority);
  if (explicit) return explicit;
  if (["failure", "security"].includes(signal) || /critical|breach|crash|overdue|rejected|unavailable/.test(text)) return "critical";
  if (["blocked", "approval", "review", "mention"].includes(signal) || /urgent|important|attention|required|warning|due soon|stale/.test(text)) return "high";
  if (["assignment", "due", "release", "version"].includes(signal) || /ready|completed|published/.test(text)) return "medium";
  return "normal";
}

function groupKeyFor(event: any, meta: Record<string, any>, tool: NotificationTool, signal: NotificationSignal) {
  const explicit = stringValue(meta.notificationGroupKey || meta.groupKey || meta.threadKey);
  if (explicit) return explicit!.slice(0, 240);
  const source = parseObject(meta.source);
  const projectId = stringValue(source.projectId || meta.projectId || event.projectId || event.project?.id) || "workspace";
  const reviewFamily = stringValue(meta.versionFamilyId || meta.reviewSessionId || meta.reviewRoundId || meta.approvalId);
  if (reviewFamily) return `${projectId}:${tool}:${reviewFamily}`.slice(0, 240);
  const entityId = stringValue(source.id || meta.sourceId || event.entityId || event.cardId || event.boardId || event.whiteboardId);
  const entityType = String(source.kind || meta.sourceKind || event.entityType || signal || "activity").toLowerCase();
  return `${projectId}:${tool}:${entityType}:${entityId || signal}`.slice(0, 240);
}

export function classifyNotificationEvent(event: any) {
  const text = textFor(event);
  const meta = parseObject(event.metadata);
  const tool = inferTool(event, meta, text);
  const signal = inferSignal(event, meta, text);
  const category = inferCategory(signal, tool, event, meta, text);
  const priority = inferPriority(signal, meta, text);
  const requiresAction = meta.requiresAction === true || ["assignment", "review", "approval", "blocked", "failure", "due"].includes(signal);
  const escalationLevel = Math.max(0, Math.min(3, Number(meta.escalationLevel ?? 0) || 0));
  return { category, priority, tool, signal, requiresAction, escalationLevel, groupKey: groupKeyFor(event, meta, tool, signal) };
}

function meaningful(event: any) {
  const text = textFor(event);
  const meta = parseObject(event.metadata);
  if (meta.notifyInbox === true || meta.broadcast === true || meta.mention === true || meta.notificationSignal || (Array.isArray(meta.userIds) && meta.userIds.length)) return true;
  if (/presence|heartbeat|profile icon|avatar|starter whiteboard created|bound library folder created/.test(text)) return false;
  return /mention|assign|approval|review|version|due|overdue|ticket|card|task|build|qa|release|deployment|git|security|backup|failed|failure|error|blocked|rejected|completed|ready|announcement/.test(text);
}

function serialize(item: any) {
  const metadata = parseObject(item.metadata);
  return {
    id: item.id,
    type: item.category,
    category: item.category,
    priority: item.priority,
    title: item.title,
    message: item.message,
    read: Boolean(item.readAt),
    readAt: item.readAt,
    dismissedAt: item.dismissedAt,
    snoozedUntil: item.snoozedUntil,
    createdAt: item.createdAt,
    projectId: item.projectId,
    projectName: item.projectLabel,
    boardId: item.boardId,
    cardId: item.cardId,
    entityType: item.entityType,
    entityId: item.entityId,
    actor: item.actorLabel,
    groupKey: item.groupKey,
    tool: item.tool,
    signal: item.signal,
    requiresAction: Boolean(item.requiresAction),
    escalationLevel: Number(item.escalationLevel || 0),
    acknowledgedAt: item.acknowledgedAt,
    lastEscalatedAt: item.lastEscalatedAt,
    resource: item.resourceKind && item.resourceId ? {
      kind: item.resourceKind,
      id: item.resourceId,
      ...(item.resourceProjectId ? { projectId: item.resourceProjectId } : {}),
    } : null,
    metadata,
  };
}

function enabledCategoriesForUser(user: any) {
  const preferences = parseObject(user?.preferences);
  const categoryDelivery = parseObject(preferences.notificationCategoryDelivery);
  return CLUSTER_NOTIFICATION_CATEGORIES.filter((category) => {
    return category === "system" || categoryDelivery[category] !== "off";
  });
}

function digestMessage(digest: any, cadence: string) {
  const total = (digest.rows || []).reduce((sum: number, row: any) => sum + Number(row?._count?._all || 0), 0);
  const critical = (digest.rows || []).filter((row: any) => row.priority === "critical").reduce((sum: number, row: any) => sum + Number(row?._count?._all || 0), 0);
  const high = (digest.rows || []).filter((row: any) => row.priority === "high").reduce((sum: number, row: any) => sum + Number(row?._count?._all || 0), 0);
  const label = cadence === "weekly" ? "Weekly" : "Daily";
  const detail = [critical ? `${critical} critical` : "", high ? `${high} important` : ""].filter(Boolean).join(" · ");
  return { total, title: `${label} Cluster digest`, message: detail ? `${total} update${total === 1 ? "" : "s"} · ${detail}` : `${total} update${total === 1 ? "" : "s"} since your last ${cadence} window.` };
}

function groupLabel(item: any, groupBy: "thread" | "project" | "category" | "tool") {
  if (groupBy === "project") return item.projectLabel || "Workspace";
  if (groupBy === "category") return item.category || "activity";
  if (groupBy === "tool") return item.tool || "project";
  return item.projectLabel ? `${item.projectLabel} · ${item.title}` : item.title || item.signal || "Activity";
}

export function createNotificationService(deps: {
  prisma: any;
  events?: any;
  logger?: any;
  publishSummaryInvalidation?: (userId: string | null) => void | Promise<void>;
}) {
  const repository = createNotificationRepository(deps.prisma);
  const subscriptions = createSubscriptionService(deps.prisma);
  const summaryCache = new BoundedCache<string, any>({
    maxEntries: Math.max(64, Number(process.env.CLUSTER_NOTIFICATION_SUMMARY_CACHE_ENTRIES || 2_000)),
    maxWeight: Math.max(2 * 1024 * 1024, Number(process.env.CLUSTER_NOTIFICATION_SUMMARY_CACHE_BYTES || 8 * 1024 * 1024)),
    weightOf: (value) => {
      try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
      catch { return 512; }
    },
  });
  const liveSubscribers = new Map<string, Set<(item: any) => void>>();
  let visibilityFilter: ((userId: string, items: any[]) => Promise<any[]>) | null = null;
  let externalDeliveryHandler: ((record: any) => Promise<unknown> | unknown) | null = null;

  function summaryCacheKey(userId: string, categories?: string[], visibilityBypass = false) {
    return `${String(userId)}:${visibilityBypass ? "aggregate" : "visible"}:${[...(categories || [])].map(String).sort().join(",")}`;
  }

  function invalidateSummaryCache(userId?: string | null, publish = true) {
    if (userId) summaryCache.deleteWhere((key) => String(key).startsWith(`${userId}:`));
    else summaryCache.clear();
    if (publish && deps.publishSummaryInvalidation) runNotificationSideEffect(
      () => deps.publishSummaryInvalidation!(userId || null),
      (error) => deps.logger?.warn?.(error, "notification summary invalidation broadcast failed"),
    );
  }

  async function filterVisible(userId: string, items: any[], retryOnFailure = false) {
    if (!items.length || !visibilityFilter) return items;
    try {
      return await visibilityFilter(String(userId), items);
    } catch (error) {
      deps.logger?.warn?.(error, "notification visibility filter failed closed");
      // Reads must fail closed. Durable delivery must ALSO fail closed, but
      // propagate the failure so the outbox retries instead of marking the
      // recipient permanently muted during a temporary ACL outage.
      if (retryOnFailure) throw error;
      return [];
    }
  }

  function summaryFromRecords(records: any[], now = new Date()) {
    const categories: Record<string, number> = {};
    const tools: Record<string, number> = {};
    let unread = 0;
    let snoozed = 0;
    let critical = 0;
    let high = 0;
    let requiresAction = 0;
    let unacknowledged = 0;
    for (const item of records) {
      categories[item.category || "activity"] = (categories[item.category || "activity"] || 0) + 1;
      if (item.tool) tools[item.tool] = (tools[item.tool] || 0) + 1;
      const snoozedNow = item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now.getTime();
      if (snoozedNow) snoozed += 1;
      if (!snoozedNow && item.requiresAction && !item.acknowledgedAt) unacknowledged += 1;
      const activeUnread = !item.readAt && !snoozedNow;
      if (activeUnread) {
        unread += 1;
        if (item.priority === "critical") critical += 1;
        if (item.priority === "high") high += 1;
        if (item.requiresAction) requiresAction += 1;
      }
    }
    return { total: records.length, unread, snoozed, critical, high, requiresAction, unacknowledged, categories, tools };
  }

  function digestFromRecords(records: any[], since: Date) {
    const grouped = new Map<string, { category: string; priority: string; _count: { _all: number } }>();
    for (const item of records) {
      const category = String(item.category || "activity");
      const priority = String(item.priority || "normal");
      const key = `${category}:${priority}`;
      const row = grouped.get(key) || { category, priority, _count: { _all: 0 } };
      row._count._all += 1;
      grouped.set(key, row);
    }
    const top = records.filter((item) => ["critical", "high"].includes(String(item.priority || ""))).slice(0, 8);
    return { since: since.toISOString(), rows: [...grouped.values()], top };
  }

  async function visibleIds(userId: string, ids: string[]) {
    if (!ids?.length) return [];
    const records = await repository.recordsByIds(userId, ids);
    return (await filterVisible(userId, records)).map((record: any) => String(record.id));
  }

  async function publishLive(record: any) {
    const userId = String(record?.userId || "");
    const listeners = liveSubscribers.get(userId);
    if (!listeners?.size) return;
    const visible = await filterVisible(userId, [record]);
    if (!visible.length) return;
    const item = serialize(visible[0]);
    for (const listener of [...listeners]) {
      try { listener(item); } catch (error) { deps.logger?.warn?.(error, "notification live subscriber failed"); }
    }
  }

  async function materialize(event: any, options: { historical?: boolean } = {}) {
    if (!event?.id) return { count: 0, muted: 0 };
    const classification = classifyNotificationEvent(event);
    const metadata = parseObject(event.metadata);
    const resource = resourceAddressForNotification(event, metadata);
    const watchScope = notificationWatchScope({ signal: classification.signal, entityType: event.entityType });
    const watcherIds = resource
      ? await subscriptions.recipientIds(resource, watchScope, {
          excludeUserIds: [String(event.userId || event.user?.id || "")].filter(Boolean),
        })
      : [];
    if (!meaningful(event) && !watcherIds.length) return { count: 0, muted: 0 };
    const recipients = await repository.recipientUsersForActivity({
      ...event,
      metadata: { ...metadata, userIds: [...new Set([...(Array.isArray(metadata.userIds) ? metadata.userIds : []), ...watcherIds])], watchedRecipientIds: watcherIds, watchScope },
    });
    if (!recipients.length) return { count: 0, muted: 0 };
    metadata.notification = {
      category: classification.category,
      tool: classification.tool,
      signal: classification.signal,
      groupKey: classification.groupKey,
      requiresAction: classification.requiresAction,
    };

    let delivered = 0;
    let muted = 0;
    for (const recipient of recipients) {
      const canReceive = (await filterVisible(recipient.id, [{
        userId: recipient.id,
        activityEventId: event.id,
        projectId: event.projectId ?? event.project?.id ?? null,
        boardId: event.boardId ?? null,
        cardId: event.cardId ?? null,
        entityType: String(event.entityType || "activity"),
        entityId: event.entityId ?? null,
      }], true)).length > 0;
      if (!canReceive) { muted += 1; continue; }
      const decision = evaluateNotificationPolicy(recipient, classification, event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt || Date.now()));
      if (!decision.store) { muted += 1; continue; }
      const recipientMetadata = {
        ...metadata,
        notificationPolicy: {
          deliveryMode: decision.deliveryMode,
          interruptive: decision.interruptive,
          quietHours: decision.quietHours,
          projectMode: decision.projectMode,
          toolMode: decision.toolMode,
          priorityFloor: decision.priorityFloor,
        },
      };
      const escalationLevel = classification.escalationLevel;
      const result = await repository.deliver({
        activityEventId: event.id,
        ...classification,
        priority: decision.priority,
        escalationLevel,
        title: String(event.title || "Cluster notification").slice(0, 220),
        message: event.message ? String(event.message).slice(0, 4_000) : null,
        projectId: event.projectId ?? event.project?.id ?? null,
        projectLabel: event.project?.name ?? null,
        boardId: event.boardId ?? null,
        cardId: event.cardId ?? null,
        entityType: String(event.entityType || "activity"),
        entityId: event.entityId ?? null,
        resourceKind: resource?.kind ?? null,
        resourceId: resource?.id ?? null,
        resourceProjectId: resource?.projectId ?? null,
        actorLabel: event.user?.displayName || event.user?.username || null,
        metadata: recipientMetadata,
        createdAt: event.createdAt,
        readAt: options.historical ? (event.createdAt || new Date()) : null,
      }, [recipient.id]);
      delivered += result.count || 0;
      if (result.count) invalidateSummaryCache(recipient.id);
      if (!options.historical) for (const record of result.records || []) {
        await publishLive(record);
        if (externalDeliveryHandler) {
          try { await externalDeliveryHandler(record); } catch (error) { deps.logger?.warn?.(error, "notification external delivery enqueue failed"); }
        }
      }
    }
    return { count: delivered, muted };
  }

  async function loadSummary(userId: string, categories?: string[], visibilityBypass = false) {
    const key = summaryCacheKey(userId, categories, visibilityBypass);
    return summaryCache.getOrLoad(key, { ttlMs: 15_000 }, async () =>
      visibilityBypass
        ? repository.summary(userId, categories)
        : summaryFromRecords(await filterVisible(userId, await repository.summaryRecords(userId, categories)))
    );
  }

  if (deps.events) {
    deps.events.subscribe(CLUSTER_DOMAIN_EVENTS.activityRecorded.type, "notifications.materialize-activity", async (domainEvent: any) => {
      try {
        await materialize(domainEvent.payload);
      } catch (error) {
        deps.logger?.warn?.(error, "notification inbox materialization failed; durable delivery will retry");
        // Do not acknowledge the durable outbox on a partial/failed projection.
        // repository.deliver is event/recipient-idempotent, so replay fills in
        // recipients that were missed without duplicating previous deliveries.
        throw error;
      }
    });
  }

  return {
    async initialize() {
      const recent = await repository.backfillRecent(750).catch(() => []);
      let delivered = 0;
      let muted = 0;
      for (const event of [...recent].reverse()) {
        try {
          const result = await materialize(event, { historical: true });
          delivered += Number(result.count || 0);
          muted += Number(result.muted || 0);
        } catch (error) { deps.logger?.warn?.(error, "notification inbox backfill item failed"); }
      }
      return { scanned: recent.length, delivered, muted };
    },
    materialize,
    setVisibilityFilter(filter: ((userId: string, items: any[]) => Promise<any[]>) | null) { visibilityFilter = filter; },
    setSubscriptionAuthorization(authorizer: Parameters<typeof subscriptions.setRecipientAuthorizer>[0]) { subscriptions.setRecipientAuthorizer(authorizer); },
    setExternalDeliveryHandler(handler: ((record: any) => Promise<unknown> | unknown) | null) { externalDeliveryHandler = handler; },
    publishRecord(record: any) {
      if (record) runNotificationSideEffect(
        () => publishLive(record),
        (error) => deps.logger?.warn?.(error, "notification live publish failed; client reconciliation will retry"),
      );
    },
    publishRecords(records: any[]) {
      for (const record of records || []) if (record) runNotificationSideEffect(
        () => publishLive(record),
        (error) => deps.logger?.warn?.(error, "notification live publish failed; client reconciliation will retry"),
      );
    },
    subscribe(userId: string, listener: (item: any) => void) {
      const key = String(userId);
      const listeners = liveSubscribers.get(key) || new Set<(item: any) => void>();
      listeners.add(listener);
      liveSubscribers.set(key, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) liveSubscribers.delete(key);
      };
    },
    liveSubscriberCount() { return [...liveSubscribers.values()].reduce((sum, listeners) => sum + listeners.size, 0); },
    async list(userId: string, options: any) {
      const limit = Math.max(1, Number(options.limit || 50));
      const batchLimit = Math.min(250, Math.max(50, limit * 3));
      let cursor = options.cursor || null;
      const visibleRecords: any[] = [];
      for (let pass = 0; pass < 100 && visibleRecords.length <= limit; pass += 1) {
        const raw = await repository.list(userId, { ...options, limit: batchLimit, cursor });
        const rawHasMore = raw.length > batchLimit;
        const rawItems = rawHasMore ? raw.slice(0, batchLimit) : raw;
        visibleRecords.push(...await filterVisible(userId, rawItems));
        if (!rawHasMore || !rawItems.length) break;
        const last = rawItems[rawItems.length - 1];
        cursor = { at: last.createdAt instanceof Date ? last.createdAt : new Date(last.createdAt), id: String(last.id) };
      }
      const page = buildCursorPage(visibleRecords, limit, "createdAt");
      return { ...page, items: page.items.map(serialize), summary: await loadSummary(userId, options.categories, Boolean(options.visibilityBypass)) };
    },
    async summary(userId: string, categories?: string[], options: { visibilityBypass?: boolean } = {}) {
      return loadSummary(userId, categories, Boolean(options.visibilityBypass));
    },
    async digest(userId: string, hours: number, categories?: string[]) {
      const since = new Date(Date.now() - Math.min(Math.max(hours, 1), 24 * 30) * 60 * 60 * 1000);
      const records = await filterVisible(userId, await repository.digestRecords(userId, since, categories));
      const digest = digestFromRecords(records, since);
      return { ...digest, top: digest.top.map(serialize) };
    },
    async digestStatus(userId: string) {
      const latest = await repository.latestDigestDelivery(userId);
      return latest ? { cadence: latest.cadence, periodKey: latest.periodKey, deliveredAt: latest.deliveredAt, scheduledFor: latest.scheduledFor } : null;
    },
    async scheduleDueDigests(enqueue: (input: any) => Promise<any>, now = new Date()) {
      const batchSize = 500;
      let afterId: string | null = null;
      let scanned = 0;
      let due = 0;
      let enqueued = 0;
      for (;;) {
        const users = await repository.digestUsers(batchSize, afterId);
        if (!users.length) break;
        scanned += users.length;
        for (const user of users) {
          const slot = notificationDigestSlot(user, now);
          if (!slot) continue;
          due += 1;
          const claim = await repository.claimDigestDelivery(user.id, slot);
          if (!claim.record || claim.record.deliveredAt) continue;
          await enqueue({
            type: "notifications.digest-deliver",
            payload: { deliveryId: claim.record.id },
            dedupeKey: `notifications:digest:${user.id}:${slot.cadence}:${slot.periodKey}`,
            maxAttempts: 5,
            priority: -5,
            createdById: user.id,
          });
          enqueued += 1;
        }
        afterId = users[users.length - 1]?.id || null;
        if (users.length < batchSize || !afterId) break;
      }
      return { scanned, due, enqueued };
    },
    async deliverScheduledDigest(deliveryId: string, now = new Date()) {
      const delivery = await repository.digestDelivery(deliveryId);
      if (!delivery) return { delivered: false, reason: "missing" };
      if (delivery.deliveredAt) return { delivered: false, reason: "already-delivered", deliveredAt: delivery.deliveredAt };
      const user = delivery.user;
      const slot = notificationDigestSlot(user, now);
      if (!slot || slot.cadence !== delivery.cadence || slot.periodKey !== delivery.periodKey) {
        return { delivered: false, reason: "not-due" };
      }
      const categories = enabledCategoriesForUser(user);
      const digestRecords = await filterVisible(user.id, await repository.digestRecords(user.id, delivery.periodStart, categories));
      const digest = digestFromRecords(digestRecords, delivery.periodStart);
      const summary = digestMessage(digest, delivery.cadence);
      let notificationInboxItemId: string | null = null;
      if (summary.total > 0) {
        const record = await repository.createDigestInboxItem({
          userId: user.id,
          category: "system",
          priority: digest.top?.some((item: any) => item.priority === "critical") ? "high" : "normal",
          title: summary.title,
          message: summary.message,
          entityType: "notification_digest",
          entityId: delivery.id,
          actorLabel: "Cluster",
          groupKey: `notification-digest:${delivery.cadence}`,
          tool: "system",
          signal: "digest",
          requiresAction: false,
          escalationLevel: 0,
          metadata: JSON.stringify({ notificationDigest: true, cadence: delivery.cadence, periodKey: delivery.periodKey, periodStart: delivery.periodStart, periodEnd: delivery.periodEnd, rows: digest.rows, topIds: (digest.top || []).map((item: any) => item.id) }),
          createdAt: now,
        });
        notificationInboxItemId = record.id;
        invalidateSummaryCache(user.id);
        await publishLive(record);
      }
      await repository.completeDigestDelivery(delivery.id, { deliveredAt: now, notificationInboxItemId, summaryJson: JSON.stringify({ ...summary, rows: digest.rows, topIds: (digest.top || []).map((item: any) => item.id) }) });
      return { delivered: true, notificationInboxItemId, total: summary.total, cadence: delivery.cadence, periodKey: delivery.periodKey };
    },
    async escalateActionRequired(now = new Date()) {
      const batchSize = 500;
      let cursor: { createdAt: Date; id: string } | null = null;
      let scanned = 0;
      let escalated = 0;
      for (;;) {
        const candidates = await repository.escalationCandidates(now, batchSize, cursor);
        if (!candidates.length) break;
        scanned += candidates.length;
        for (const item of candidates) {
          if (!(await filterVisible(item.userId, [item])).length) continue;
          const level = notificationEscalationLevel(item, item.user, now);
          if (level <= Number(item.escalationLevel || 0)) continue;
          const metadata = parseObject(item.metadata);
          const escalatedPriority = notificationEscalationPriority(level, item.priority);
          const policy = evaluateNotificationPolicy(item.user, {
            category: enumValue(CLUSTER_NOTIFICATION_CATEGORIES, item.category) || "activity",
            priority: escalatedPriority,
            projectId: item.projectId || null,
            tool: enumValue(CLUSTER_NOTIFICATION_TOOLS, item.tool) || "project",
            signal: enumValue(CLUSTER_NOTIFICATION_SIGNALS, item.signal) || "activity",
            requiresAction: true,
          }, now);
          metadata.notificationEscalation = { level, escalatedAt: now.toISOString(), previousLevel: Number(item.escalationLevel || 0) };
          metadata.notificationPolicy = {
            deliveryMode: policy.deliveryMode,
            interruptive: policy.interruptive,
            quietHours: policy.quietHours,
            projectMode: policy.projectMode,
            toolMode: policy.toolMode,
            priorityFloor: policy.priorityFloor,
          };
          const record = await repository.updateEscalation(item.userId, item.id, {
            level,
            priority: policy.priority,
            metadata,
            escalatedAt: now,
          });
          if (!record) continue;
          invalidateSummaryCache(item.userId);
          await publishLive(record);
          escalated += 1;
        }
        const last = candidates[candidates.length - 1];
        cursor = last ? { createdAt: last.createdAt, id: last.id } : null;
        if (candidates.length < batchSize || !cursor) break;
      }
      return { scanned, escalated };
    },
    async pruneLifecycle(now = new Date()) {
      const result = await repository.pruneLifecycle(now, NOTIFICATION_RETENTION);
      if (result) invalidateSummaryCache(null);
      return result;
    },
    async groups(userId: string, options: { hours: number; groupBy: "thread" | "project" | "category" | "tool"; includeRead: boolean; limit: number }) {
      const since = new Date(Date.now() - Math.min(Math.max(options.hours, 1), 24 * 30) * 60 * 60 * 1000);
      const rows = await filterVisible(userId, await repository.groupingRows(userId, since, options.includeRead));
      const groups = new Map<string, any>();
      for (const row of rows) {
        const key = options.groupBy === "thread" ? (row.groupKey || `${row.projectId || "workspace"}:${row.category}:${row.entityType}:${row.entityId || row.id}`)
          : options.groupBy === "project" ? (row.projectId || "workspace")
          : options.groupBy === "category" ? (row.category || "activity")
          : (row.tool || "project");
        const existing = groups.get(key) || { key, label: groupLabel(row, options.groupBy), count: 0, unread: 0, critical: 0, high: 0, requiresAction: 0, latestAt: row.createdAt, latest: row, projectId: row.projectId, projectName: row.projectLabel, category: row.category, tool: row.tool, signal: row.signal };
        existing.count += 1;
        if (!row.readAt) existing.unread += 1;
        if (row.priority === "critical") existing.critical += 1;
        if (row.priority === "high") existing.high += 1;
        if (row.requiresAction && !row.acknowledgedAt) existing.requiresAction += 1;
        groups.set(key, existing);
      }
      return [...groups.values()]
        .sort((left, right) => right.critical - left.critical || right.requiresAction - left.requiresAction || new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime())
        .slice(0, options.limit)
        .map((group) => ({ ...group, latestAt: group.latestAt instanceof Date ? group.latestAt.toISOString() : group.latestAt, latest: serialize(group.latest) }));
    },
    async markRead(userId: string, ids: string[], read = true) {
      const result = await repository.markRead(userId, await visibleIds(userId, ids), read);
      if (result?.count) invalidateSummaryCache(userId);
      return result;
    },
    async acknowledge(userId: string, ids: string[], acknowledged = true) {
      const authorizedIds = await visibleIds(userId, ids);
      const result = await repository.acknowledge(userId, authorizedIds, acknowledged);
      const records = await filterVisible(userId, await repository.recordsByIds(userId, authorizedIds));
      if (result?.count) invalidateSummaryCache(userId);
      for (const record of records) await publishLive(record);
      return result;
    },
    async dismiss(userId: string, ids: string[]) {
      const result = await repository.dismiss(userId, await visibleIds(userId, ids));
      if (result?.count) invalidateSummaryCache(userId);
      return result;
    },
    async restoreDismissed(userId: string, ids?: string[]) {
      const records = await repository.dismissedRecords(userId, ids);
      const authorizedIds = (await filterVisible(userId, records)).map((record: any) => String(record.id));
      if (!authorizedIds.length) return { count: 0 };
      const result = await repository.restoreDismissed(userId, authorizedIds);
      if (result?.count) invalidateSummaryCache(userId);
      return result;
    },
    async snooze(userId: string, ids: string[], until: Date | null) {
      const result = await repository.snooze(userId, await visibleIds(userId, ids), until);
      if (result?.count) invalidateSummaryCache(userId);
      return result;
    },
    invalidateSummary(userId?: string | null) { invalidateSummaryCache(userId, false); },
    summaryCacheSnapshot() { return { entries: summaryCache.size, pending: summaryCache.pending }; },
  };
}
