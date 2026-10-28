import { z } from "zod";
import { CLUSTER_ACCESS_TARGET_KINDS, clusterResourceChangesQuerySchema, type ClusterResourceChange, type ClusterResourceKind } from "@cluster/shared";
import { apiError } from "../../core/api-response.js";
import { latestResourceChangeSequence, readResourceChanges, resourceChangeSequenceIdentity, resourceChangeWindow, type ResourceChangeRuntime } from "../../core/resource-change-runtime.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";
import type { LibraryAccessService } from "../library/library-access-service.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";
import { loadStudioAudienceUserContext } from "../access/studio-audience.js";
import { isEnrolledResourceChangeProvider, loadResourceChangeProviderSnapshot } from "./resource-change-providers.js";
import { enabledResourceChanges, resourceChangeToolAvailabilityFingerprint } from "./resource-change-tool-lifecycle.js";
import type { ClusterAdminConfigurableToolId } from "@cluster/shared";

const streamQuerySchema = z.object({
  after: z.coerce.string().regex(/^[0-9]+$/).optional(),
  afterIdentity: z.coerce.string().regex(/^[^\r\n]{1,200}$/).optional(),
});

const PROJECT_FALLBACK_KINDS = new Set<ClusterResourceKind>(["meeting"]);
const LIBRARY_CHANGE_KINDS = new Set<ClusterResourceKind>(["library", "file"]);
const IDENTITY_CHECK_KINDS = new Set<ClusterResourceKind>(["card", "ticket", "calendar"]);
const INACTIVE_ACCOUNT_STATES = new Set(["DISABLED", "SUSPENDED", "PRIVACY_ERASED"]);

function activeAccount(user: any) {
  if (!user || user.archived === true || INACTIVE_ACCOUNT_STATES.has(String(user.accountState || "").toUpperCase())) return false;
  const expiry = user.accessExpiresAt ? new Date(user.accessExpiresAt).getTime() : Infinity;
  return Number.isFinite(expiry) ? expiry > Date.now() : !user.accessExpiresAt;
}

/** A streaming request's initial identity is not a durable permission grant.
 * Re-read session, actor and role/team membership from canonical authorities. */
async function freshIdentity(deps: any, request: any) {
  const initialSession = await deps.getCurrentSession(request);
  if (!initialSession?.id) return null;
  const session = await deps.prisma.session.findUnique({
    where: { id: initialSession.id },
    include: { user: { include: WORKFORCE_USER_AUTHORITY_INCLUDE } },
  });
  if (!session || session.userId !== initialSession.userId || session.revokedAt
    || new Date(session.expiresAt).getTime() <= Date.now() || !activeAccount(session.user)
    || Math.max(1, Number(session.authenticationGeneration || 1)) !== Math.max(1, Number(session.user.authenticationGeneration || 1))) return null;
  const decorated = await deps.decorateUserForClient(session.user);
  return decorated ? { user: session.user, decorated, role: decorated.workspaceRole || null } : null;
}

function authorizationTarget(change: ClusterResourceChange) {
  const { resource } = change;
  if (PROJECT_FALLBACK_KINDS.has(resource.kind)) return { kind: "project", id: resource.projectId || resource.id };
  if (resource.kind === "library") return { kind: "library", id: resource.id };
  return { kind: resource.kind, id: resource.id };
}

/** Apply canonical domain authorization to resource invalidations. The feed
 * exposes identifiers and event timing, so it is NOT a public event bus.
 * Avoid substituting project membership for Library/Records/Calendar access. */
async function filterAuthorizedChanges(deps: any, request: any, changes: ClusterResourceChange[]) {
  // A shared feed must not keep broadcasting disabled tools while their
  // TD2 background owners, routes and collaboration subscriptions are paused.
  // Apply this before the administrator fast path as well.
  changes = enabledResourceChanges(changes, deps.isConfigurableToolEnabled);
  if (!changes.length) return [];
  const identity = await freshIdentity(deps, request);
  if (!identity) return [];
  const admin = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
  // Even administrators cannot bypass the Library's separate Personnel
  // Records boundary through a change-feed invalidation envelope.
  if (admin && !changes.some((change) => LIBRARY_CHANGE_KINDS.has(change.resource.kind)
    || IDENTITY_CHECK_KINDS.has(change.resource.kind) || isEnrolledResourceChangeProvider(change.resource.kind))) {
    return enabledResourceChanges(changes, deps.isConfigurableToolEnabled);
  }

  const libraryChanges = changes.filter((change) => LIBRARY_CHANGE_KINDS.has(change.resource.kind));
  const libraryIds = [...new Set(libraryChanges.map((change) => change.resource.id))];
  let allowedLibraryIds = new Set<string>();
  if (libraryIds.length) {
    // The Library's own ACL resolver includes folder grants, ownership and
    // private generated artifacts. Never use generic project access for files.
    const [items, protectedItems, accessContext] = await Promise.all([
      deps.prisma.libraryItem.findMany({
        where: { id: { in: libraryIds }, status: { notIn: ["trashed", "destroyed"] } },
        include: { project: { include: { memberships: { where: { status: "active" } } } } },
      }),
      deps.prisma.personnelRecordAttachment.findMany({
        where: { libraryItemId: { in: libraryIds } }, select: { libraryItemId: true },
      }),
      deps.libraryAccess.contextForUser(identity.user, undefined, { strict: true }),
    ]);
    const recordIds = new Set(protectedItems.map((row: any) => String(row.libraryItemId)));
    allowedLibraryIds = new Set(items.filter((item: any) =>
      !recordIds.has(String(item.id)) && libraryChanges.some((change) => change.resource.id === item.id
        && (!change.resource.projectId || change.resource.projectId === item.projectId))
        && deps.libraryAccess.visibleFor(accessContext, item, "view"),
    ).map((item: any) => String(item.id)));
  }

  // Provider identity is loaded first; it supplies canonical parents for
  // project-less invalidations and prevents two inconsistent provider reads.
  const providerSnapshot = await loadResourceChangeProviderSnapshot(deps.prisma, changes);
  // Studio audience queries normally tolerate transient read errors in
  // non-sensitive UI. Streams cannot: an incomplete exclusion audience would
  // disclose IDs. Load a strict current projection once for this batch.
  const audienceContext = providerSnapshot.requiresAudience
    ? await loadStudioAudienceUserContext(deps.prisma, identity.user, { strict: true })
    : undefined;
  const providerLibraryContext = providerSnapshot.requiresLibrary
    ? await deps.libraryAccess.contextForUser(identity.user, undefined, { strict: true })
    : undefined;
  const projectIds = [...new Set([...providerSnapshot.projectIds, ...changes.flatMap((change) => {
    if (change.resource.kind === "project") return [change.resource.id];
    return change.resource.projectId ? [change.resource.projectId] : [];
  })])];
  const projects = projectIds.length ? await deps.prisma.project.findMany({ where: { id: { in: projectIds }, archived: false } }) : [];
  const projectById = new Map<string, any>(projects.map((project: any) => [String(project.id), project]));

  const directTargets = new Set<string>(CLUSTER_ACCESS_TARGET_KINDS as readonly string[]);
  const targetPairs = new Map<string, { targetKind: string; targetId: string }>();
  for (const change of changes) {
    if (LIBRARY_CHANGE_KINDS.has(change.resource.kind)) continue;
    if (!isEnrolledResourceChangeProvider(change.resource.kind)) {
      const target = authorizationTarget(change);
      if (target.kind && target.id && directTargets.has(target.kind)) targetPairs.set(`${target.kind}:${target.id}`, { targetKind: target.kind, targetId: target.id });
    }
    // Enrolled providers still use Project-scoped Access Rules. Skipping
    // their target-specific rules must NOT silently skip parent-level denies.
    const projectId = change.resource.kind === "project" ? change.resource.id : change.resource.projectId;
    if (projectId) targetPairs.set(`project:${projectId}`, { targetKind: "project", targetId: projectId });
  }
  // Missing projectId in an outbox envelope does not bypass inherited deny
  // rules. Include the authoritative Project IDs obtained from provider rows.
  for (const projectId of providerSnapshot.projectIds) {
    targetPairs.set(`project:${projectId}`, { targetKind: "project", targetId: projectId });
  }
  const pairs = [...targetPairs.values()];
  // A failed Access Rule lookup must never be interpreted as "no deny rules".
  const rules = pairs.length ? await deps.prisma.accessRule.findMany({ where: { status: "active", OR: pairs } }) : [];

  const calendarIds = changes.filter((change) => change.resource.kind === "calendar").map((change) => change.resource.id);
  const calendarRows = calendarIds.length ? await deps.prisma.calendarEvent.findMany({
    where: { id: { in: calendarIds } },
    include: { project: { include: { memberships: { where: { status: "active" } } } } },
  }) : [];
  const calendarById = new Map<string, any>(calendarRows.map((event: any) => [String(event.id), event]));

  const cardIds = changes.filter((change) => change.resource.kind === "card" || change.resource.kind === "ticket").map((change) => change.resource.id);
  const cardRows = cardIds.length ? await deps.prisma.card.findMany({
    where: { id: { in: cardIds }, archived: false },
    include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } },
  }) : [];
  const cardById = new Map<string, any>(cardRows.map((card: any) => [String(card.id), card]));
  const providerVisible = providerSnapshot.visible({
    prisma: deps.prisma, authorization: deps.authorization, user: identity.user, role: identity.role, rules, projects: projectById,
    audienceContext, libraryContext: providerLibraryContext, libraryVisibleFor: deps.libraryAccess.visibleFor,
  });
  const visible: ClusterResourceChange[] = [];
  for (const change of changes) {
    if (isEnrolledResourceChangeProvider(change.resource.kind)) {
      if (providerVisible.has(change)) visible.push(change);
      continue;
    }
    if (LIBRARY_CHANGE_KINDS.has(change.resource.kind)) {
      if (allowedLibraryIds.has(change.resource.id)) visible.push(change);
      continue;
    }
    if (change.resource.kind === "calendar") {
      const event = calendarById.get(String(change.resource.id));
      if (event && (!change.resource.projectId || event.projectId === change.resource.projectId)
        && await canAccessCalendarEvent(deps.authorization, request, event, "view")) visible.push(change);
      continue;
    }
    if (change.resource.kind === "card" || change.resource.kind === "ticket") {
      const card = cardById.get(String(change.resource.id));
      if (!card?.list?.board?.project) continue;
      const project = card.list.board.project;
      if (change.resource.projectId && project.id !== change.resource.projectId) continue;
      const boardAllowed = admin || deps.authorization.hasTargetAccess(identity.user, identity.role, "board", card.list.board.id, project, rules, "view");
      const ticketAllowed = admin || card.workItemKind !== "ticket" || deps.authorization.hasToolPermission(identity.user, identity.role, "tickets", "view");
      if (boardAllowed && ticketAllowed) visible.push(change);
      continue;
    }
    const target = authorizationTarget(change);
    const projectId = change.resource.kind === "project" ? change.resource.id : change.resource.projectId || null;
    const project = projectId ? projectById.get(String(projectId)) : null;
    if (projectId && !project) continue;
    if (deps.authorization.hasTargetAccess(identity.user, identity.role, target.kind, target.id, project, rules, "view")) visible.push(change);
  }
  // Availability can change during provider/ACL database reads. Never emit a
  // result admitted under a tool state that has since been disabled.
  return enabledResourceChanges(visible, deps.isConfigurableToolEnabled);
}

function parseSequence(value: string | undefined, fallback = 0n) {
  if (!value) return fallback;
  try { return BigInt(value); } catch { return fallback; }
}

export function registerResourceChangeRoutes(deps: { app: any; prisma: any; authorization: any; changeRuntime: ResourceChangeRuntime; libraryAccess: Pick<LibraryAccessService, "contextForUser" | "visibleFor">; getCurrentSession: (request: any) => Promise<any>; decorateUserForClient: (user: any) => Promise<any>; runtimeTelemetry?: { beginLongLived: () => () => void }; isConfigurableToolEnabled: (tool: ClusterAdminConfigurableToolId) => boolean }) {
  const { app, prisma, changeRuntime } = deps;

  app.get("/api/changes", async (request: any, reply: any) => {
    const identity = await freshIdentity(deps, request);
    if (!identity) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const query = clusterResourceChangesQuerySchema.parse(request.query || {});
    const after = parseSequence(query.after);
    // A restored/recreated server may have a lower outbox sequence than a
    // client remembered before the restore. Querying from that future cursor
    // would strand the client indefinitely, including after new writes.
    const window = await resourceChangeWindow(prisma);
    const cursorAhead = after > window.latest;
    const cursorExpired = after > 0n && window.floor > 0n && after < window.floor - 1n;
    const historyReplaced = !cursorAhead && !cursorExpired && after > 0n && Boolean(query.afterIdentity)
      && await resourceChangeSequenceIdentity(prisma, after) !== query.afterIdentity;
    const effectiveAfter = cursorAhead || cursorExpired || historyReplaced ? window.latest : after;
    const raw = cursorAhead || cursorExpired || historyReplaced ? [] : await readResourceChanges(prisma, effectiveAfter, query.limit);
    const changes = raw.length ? await filterAuthorizedChanges(deps, request, raw) : [];
    const cursor = raw.length ? raw.at(-1)!.sequence : effectiveAfter.toString();
    const resetRequired = cursorAhead || cursorExpired || historyReplaced;
    const resetReason = cursorAhead ? "cursor_ahead" : cursorExpired ? "cursor_expired" : historyReplaced ? "history_replaced" : null;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      changes,
      cursor,
      cursorIdentity: await resourceChangeSequenceIdentity(prisma, BigInt(cursor)),
      floorSequence: window.floor.toString(),
      latestSequence: window.latest.toString(),
      resetRequired,
      ...(resetReason ? { resetReason } : {}),
      hasMore: BigInt(cursor) < window.latest,
    };
  });

  app.get("/api/changes/stream", async (request: any, reply: any) => {
    const identity = await freshIdentity(deps, request);
    if (!identity) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    const query = streamQuerySchema.parse(request.query || {});
    const window = await resourceChangeWindow(prisma);
    const requestedAfter = query.after ? parseSequence(query.after) : window.latest;
    const cursorAhead = requestedAfter > window.latest;
    const cursorExpired = requestedAfter > 0n && window.floor > 0n && requestedAfter < window.floor - 1n;
    const historyReplaced = !cursorAhead && !cursorExpired && requestedAfter > 0n && Boolean(query.afterIdentity)
      && await resourceChangeSequenceIdentity(prisma, requestedAfter) !== query.afterIdentity;
    const resetRequired = cursorAhead || cursorExpired || historyReplaced;
    let lastSent = resetRequired ? window.latest : requestedAfter;
    let lastSentIdentity = await resourceChangeSequenceIdentity(prisma, lastSent);
    let toolAvailabilityFingerprint = resourceChangeToolAvailabilityFingerprint(deps.isConfigurableToolEnabled);

    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();
    reply.raw.flushHeaders?.();
    const endLongLived = deps.runtimeTelemetry?.beginLongLived() || (() => undefined);

    const maxBufferedBytes = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number(process.env.CLUSTER_SSE_MAX_BUFFER_BYTES || 512 * 1024)));
    const send = (event: string, payload: unknown, id?: string) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return false;
      const buffered = Number(reply.raw.writableLength || 0);
      if (buffered > maxBufferedBytes) {
        reply.raw.end();
        return false;
      }
      const frame = `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      const writable = reply.raw.write(frame);
      if (!writable && Number(reply.raw.writableLength || 0) > maxBufferedBytes) {
        reply.raw.end();
        return false;
      }
      return true;
    };
    send("ready", { ok: true, cursor: lastSent.toString(), cursorIdentity: lastSentIdentity, streamVersion: 1, floorSequence: window.floor.toString(), latestSequence: window.latest.toString() });
    const reconcileToolAvailability = () => {
      const current = resourceChangeToolAvailabilityFingerprint(deps.isConfigurableToolEnabled);
      if (current === toolAvailabilityFingerprint) return;
      toolAvailabilityFingerprint = current;
      // Clients may have advanced their cursor across disabled-tool changes.
      // Do not replay unverified historical events; refresh current authorized
      // projections once the tool becomes available again.
      send("reset", { reason: "tool_availability_changed", cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });
    };
    if (resetRequired) send("reset", { reason: cursorAhead ? "cursor_ahead" : cursorExpired ? "cursor_expired" : "history_replaced", cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });

    let chain = Promise.resolve();
    let queuedBatches = 0;
    let bridging = true;
    let bridgeOverflow = false;
    const bridgeBuffer: ClusterResourceChange[][] = [];
    const maxQueuedBatches = Math.max(2, Math.min(32, Number(process.env.CLUSTER_SSE_MAX_QUEUED_BATCHES || 8)));
    const processBatch = async (batch: ClusterResourceChange[]) => {
      reconcileToolAvailability();
      const pending = batch.filter((change) => BigInt(change.sequence) > lastSent);
      if (!pending.length || reply.raw.destroyed || reply.raw.writableEnded) return;
      const visible = await filterAuthorizedChanges(deps, request, pending);
      // A tool may be disabled after the asynchronous ACL checks. Enforce
      // admission again directly before sending the serialized event.
      for (const change of enabledResourceChanges(visible, deps.isConfigurableToolEnabled)) {
        if (!send("change", change, change.sequence)) break;
      }
      lastSent = BigInt(pending.at(-1)!.sequence);
      lastSentIdentity = pending.at(-1)!.cursorIdentity ?? await resourceChangeSequenceIdentity(prisma, lastSent);
    };
    const deliver = (batch: ClusterResourceChange[]) => {
      if (bridging) {
        if (bridgeBuffer.length >= maxQueuedBatches) bridgeOverflow = true;
        else bridgeBuffer.push(batch);
        return;
      }
      if (queuedBatches >= maxQueuedBatches) {
        const latest = batch.at(-1);
        if (latest) {
          lastSent = BigInt(latest.sequence);
          lastSentIdentity = latest.cursorIdentity ?? null;
          send("reset", { reason: "slow_client", cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });
        }
        return;
      }
      queuedBatches += 1;
      chain = chain.then(() => processBatch(batch)).catch(() => {
        // A provider/ACL failure is not a harmless missed refresh: retaining
        // an apparently healthy feed after an unverified batch hides outages.
        // Terminate and let the client's bounded reconnect reconcile safely.
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          send("reset", { reason: "authorization_unavailable", cursor: lastSent.toString() });
          reply.raw.end();
        }
      }).finally(() => { queuedBatches = Math.max(0, queuedBatches - 1); });
    };

    if (query.after && !resetRequired) {
      let pages = 0;
      while (lastSent < window.latest && pages < 4) {
        const backlog = await readResourceChanges(prisma, lastSent, 250);
        if (!backlog.length) break;
        await processBatch(backlog);
        pages += 1;
      }
      if (lastSent < window.latest) {
        lastSent = window.latest;
        lastSentIdentity = await resourceChangeSequenceIdentity(prisma, lastSent);
        send("reset", { reason: "cursor_too_far_behind", cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });
      }
    }
    const unsubscribe = changeRuntime.subscribe(deliver, (reset) => {
      // A live database restore can rewind the *server poller*, not just a
      // reconnecting client's cursor. End this stream after the reset so no
      // queued pre-restore changes can be delivered under the new timeline.
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        send("reset", reset);
        reply.raw.end();
      }
    });
    let heartbeat: NodeJS.Timeout | null = null;
    // SSE requests outlive ordinary request identity caches. A disabled or
    // expired account must lose its live subscription even while the feed is idle.
    let checkingAccess = false;
    const accessCheck = setInterval(() => {
      if (checkingAccess || reply.raw.destroyed || reply.raw.writableEnded) return;
      checkingAccess = true;
      void freshIdentity(deps, request).then((current) => {
        if (!current && !reply.raw.destroyed && !reply.raw.writableEnded) {
          send("access", { state: "revoked", reason: "resource_feed_access_revoked" });
          reply.raw.end();
        }
      }).catch(() => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end(); })
        .finally(() => { checkingAccess = false; });
    }, 60_000);
    accessCheck.unref?.();
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      clearInterval(accessCheck);
      unsubscribe();
      endLongLived();
    };
    request.raw.once("close", cleanup);
    request.raw.once("error", cleanup);
    // A server-initiated SSE shutdown does not always close request.raw;
    // unsubscribe as soon as the response ends, including restore resets.
    reply.raw.once?.("close", cleanup);
    reply.raw.once?.("finish", cleanup);
    // Subscribe before the bridge read, then page until caught up. Live batches
    // are buffered while bridging so changes landing between the final database
    // read and subscription cannot disappear. A pathological burst falls back
    // to a reset/refetch instead of silently skipping a cursor range.
    try {
      let bridgePages = 0;
      const maxBridgePages = Math.max(4, Math.min(64, Number(process.env.CLUSTER_SSE_MAX_BRIDGE_PAGES || 32)));
      while (!bridgeOverflow && bridgePages < maxBridgePages && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const bridge = await readResourceChanges(prisma, lastSent, 250);
        if (!bridge.length) break;
        await processBatch(bridge);
        bridgePages += 1;
        if (bridge.length < 250) break;
      }
      if (bridgeOverflow || bridgePages >= maxBridgePages) {
        // Discard the already-covered bridge buffer, then take an authoritative
        // reset cursor. Any live batches arriving after this clear remain
        // buffered and are drained after the reset, so the reset path has no
        // latest-sequence -> live-subscription gap either.
        bridgeBuffer.length = 0;
        lastSent = await latestResourceChangeSequence(prisma);
        lastSentIdentity = await resourceChangeSequenceIdentity(prisma, lastSent);
        send("reset", { reason: bridgeOverflow ? "bridge_overflow" : "cursor_too_far_behind", cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });
      }
      while (bridgeBuffer.length && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const buffered = bridgeBuffer.shift();
        if (buffered) await processBatch(buffered);
      }
      bridging = false;
      heartbeat = setInterval(() => {
        reconcileToolAvailability();
        send("ping", { serverTime: Date.now(), cursor: lastSent.toString(), cursorIdentity: lastSentIdentity });
      }, 25_000);
      heartbeat.unref?.();
    } catch {
      cleanup();
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });
}
