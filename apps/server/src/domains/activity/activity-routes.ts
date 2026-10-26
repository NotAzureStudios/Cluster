import { decodeCursor, encodeCursor } from "../../core/cursor-pagination.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { activityQuerySchema, userActivityQuerySchema } from "@cluster/shared";

export function registerActivityRoutes(deps: any) {
  const { app, activityService, serializeActivityEvent, serializeUserPublicProfile, authorization } = deps;

  app.get("/api/activity", async (request: any, reply: any) => {
    const query = activityQuerySchema.parse(request.query || {});
    // Exact-resource activity can bypass the global Activity tool only when the
    // authorization boundary knows how to resolve that entity type to a real
    // target permission. Unknown entity taxonomies still require Activity-tool
    // access and cannot use this route as a permission side door.
    const exactResourceQuery = Boolean(query.entityId && query.entityType && authorization.activityTargetKindForEntityType(query.entityType));
    if (!exactResourceQuery && !(await authorization.requireTool(request, reply, "activity", "view"))) return;
    const identity = await authorization.identityForRequest(request);
    const authorizationContext = {
      userId: identity.user?.id || null,
      admin: Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || ""))),
    };
    let cursor = decodeCursor(query.cursor);
    const visible: any[] = [];
    let nextCursor: string | null = null;
    let hasMore = false;
    const scanLimit = Math.min(250, Math.max(query.limit, query.limit * 3));
    for (let scan = 0; scan < 20 && visible.length < query.limit; scan += 1) {
      const page = await activityService.list({ ...query, limit: scanLimit, cursor }, authorizationContext);
      const allowed = await authorization.filterActivityEventsForRequest(request, page.items, "view");
      for (const event of allowed) {
        visible.push(event);
        if (visible.length >= query.limit) {
          nextCursor = encodeCursor({ at: event.createdAt, id: String(event.id) });
          hasMore = page.hasMore || allowed.at(-1)?.id !== event.id;
          break;
        }
      }
      if (visible.length >= query.limit) break;
      if (!page.hasMore || !page.nextCursor) { nextCursor = null; hasMore = false; break; }
      nextCursor = page.nextCursor;
      hasMore = true;
      cursor = decodeCursor(page.nextCursor);
    }
    const items = visible.slice(0, query.limit).map(serializeActivityEvent);
    if (!query.cursor) {
      if (nextCursor) reply.header("X-Next-Cursor", nextCursor);
      return sendPrivateRevalidated(request, reply, items);
    }
    return sendPrivateRevalidated(request, reply, { items, nextCursor, hasMore });
  });

  app.get("/api/users/activity", async (request: any, reply: any) => {
    if (!(await authorization.requireTool(request, reply, "people", "view"))) return;
    const query = userActivityQuerySchema.parse(request.query || {});
    const identity = await authorization.identityForRequest(request);
    const includeActivitySummary = Boolean(
      identity.user &&
      identity.decorated?.isAdmin &&
      authorization.hasToolPermission(identity.user, identity.role, "activity", "view"),
    );
    const users = await activityService.userSummaries(query.limit, includeActivitySummary);
    return users.map((user: any) => ({
      ...serializeUserPublicProfile(user),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      ...(includeActivitySummary ? { counts: user._count, lastActivityAt: user.activityEvents?.[0]?.createdAt ?? null } : {}),
    }));
  });
}
