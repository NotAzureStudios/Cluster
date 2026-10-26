import { z } from "zod";
import { notificationAcknowledgeMutationSchema, notificationGroupQuerySchema, notificationQuerySchema, notificationStateMutationSchema, notificationSnoozeMutationSchema } from "@cluster/shared";
import { apiError } from "../../core/api-response.js";
import { decodeCursor } from "../../core/cursor-pagination.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";

const NOTIFICATION_CATEGORIES = ["activity", "mentions", "approvals", "delivery", "qa", "schedule", "work", "system"] as const;

function parsePreferenceRecord(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function enabledNotificationCategories(user: any) {
  const preferences = parsePreferenceRecord(user?.preferences);
  const categoryDelivery = parsePreferenceRecord(preferences.notificationCategoryDelivery);
  return NOTIFICATION_CATEGORIES.filter((category) => {
    // Critical security evidence must remain queryable even when a user has
    // muted routine System notifications. Routine items are suppressed before
    // materialization by notification-policy.
    return category === "system" || categoryDelivery[category] !== "off";
  });
}

export function registerNotificationRoutes(deps: any) {
  const { app, prisma, getCurrentUser, logActivity, authorization, notificationService, notificationStreamAccess } = deps;

  app.get("/api/notifications", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const query = notificationQuerySchema.parse(request.query || {});
    const enabledCategories = enabledNotificationCategories(user);
    const requestedCategories = query.categories?.length ? query.categories : enabledCategories;
    const categories = requestedCategories.filter((category: string) => enabledCategories.includes(category as (typeof NOTIFICATION_CATEGORIES)[number]));
    const identity = await authorization.identityForRequest(request);
    const visibilityBypass = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
    reply.header("Cache-Control", "no-store");
    return notificationService.list(user.id, { ...query, categories, cursor: decodeCursor(query.cursor), visibilityBypass });
  });

  app.get("/api/notifications/stream", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;

    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();
    reply.raw.flushHeaders?.();
    const endLongLived = deps.runtimeTelemetry?.beginLongLived() || (() => undefined);

    const maxBufferedBytes = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number(process.env.CLUSTER_SSE_MAX_BUFFER_BYTES || 512 * 1024)));
    const send = (event: string, payload: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return false;
      if (Number(reply.raw.writableLength || 0) > maxBufferedBytes) {
        reply.raw.end();
        return false;
      }
      const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      const writable = reply.raw.write(frame);
      if (!writable && Number(reply.raw.writableLength || 0) > maxBufferedBytes) {
        reply.raw.end();
        return false;
      }
      return true;
    };
    send("ready", { ok: true, serverTime: Date.now(), streamVersion: 2 });
    const unsubscribe = notificationService.subscribe(user.id, (item: any) => send("notification", item));
    const heartbeat = setInterval(() => send("ping", { serverTime: Date.now() }), 25_000);
    heartbeat.unref?.();
    let checkingAccess = false;
    const accessCheck = setInterval(() => {
      if (checkingAccess || reply.raw.destroyed || reply.raw.writableEnded) return;
      checkingAccess = true;
      void Promise.resolve(notificationStreamAccess ? notificationStreamAccess(user.id) : true)
        .catch(() => false)
        .then((allowed) => {
          if (allowed || reply.raw.destroyed || reply.raw.writableEnded) return;
          send("access", { state: "revoked", reason: "notification_access_revoked" });
          reply.raw.end();
        })
        .finally(() => { checkingAccess = false; });
    }, 60_000);
    accessCheck.unref?.();
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(accessCheck);
      unsubscribe();
      endLongLived();
    };
    request.raw.once("close", cleanup);
    request.raw.once("error", cleanup);
  });

  app.get("/api/notifications/summary", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const identity = await authorization.identityForRequest(request);
    const visibilityBypass = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
    const payload = { ok: true, summary: await notificationService.summary(user.id, enabledNotificationCategories(user), { visibilityBypass }) };
    return sendPrivateRevalidated(request, reply, payload);
  });

  app.get("/api/notifications/groups", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const query = notificationGroupQuerySchema.parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    return { ok: true, groups: await notificationService.groups(user.id, query) };
  });

  app.get("/api/notifications/digest", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const query = z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) }).parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    return { ok: true, ...(await notificationService.digest(user.id, query.hours, enabledNotificationCategories(user))) };
  });

  app.get("/api/notifications/digest/status", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, latest: await notificationService.digestStatus(user.id) };
  });

  app.post("/api/notifications/read", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const body = notificationStateMutationSchema.parse(request.body);
    const result = await notificationService.markRead(user.id, body.ids, body.read !== false);
    return { ok: true, updated: result.count, requestId: String(request.id) };
  });

  app.post("/api/notifications/acknowledge", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const body = notificationAcknowledgeMutationSchema.parse(request.body);
    const result = await notificationService.acknowledge(user.id, body.ids, body.acknowledged !== false);
    return { ok: true, updated: result.count, requestId: String(request.id) };
  });

  app.post("/api/notifications/dismiss", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const body = notificationStateMutationSchema.parse(request.body);
    const result = await notificationService.dismiss(user.id, body.ids);
    return { ok: true, updated: result.count, requestId: String(request.id) };
  });

  app.post("/api/notifications/restore", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const ids = request.body ? notificationStateMutationSchema.parse(request.body).ids : undefined;
    const result = await notificationService.restoreDismissed(user.id, ids);
    return { ok: true, updated: result.count, requestId: String(request.id) };
  });

  app.post("/api/notifications/snooze", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Authentication required.");
    if (!(await authorization.requireTool(request, reply, "inbox", "view"))) return;
    const body = notificationSnoozeMutationSchema.parse(request.body);
    const until = body.until ? new Date(body.until) : null;
    const result = await notificationService.snooze(user.id, body.ids, until);
    return { ok: true, updated: result.count, requestId: String(request.id) };
  });


}
