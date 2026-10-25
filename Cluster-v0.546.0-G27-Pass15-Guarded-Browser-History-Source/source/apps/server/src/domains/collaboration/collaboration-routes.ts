import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  collaborationActionSchema,
  collaborationHeartbeatSchema,
  collaborationLeaveSchema,
  collaborationResourceQuerySchema,
  collaborationStreamQuerySchema,
} from "@cluster/shared";
import type { CollaborationAction, CollaborationRuntime, CollaborationStreamClient, CollaborationTool } from "../../core/collaboration-runtime.js";
import type { AuthorizationService } from "../access/authorization.js";
import { composeCollaborationPresence, loadPresenceProfile } from "../presence/presence-policy-service.js";

type CollaborationRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>;
  enforceCollaborationResourceAccess: (
    request: FastifyRequest,
    reply: FastifyReply,
    tool: CollaborationTool,
    resourceId: string,
    minimum: string,
    user?: any,
  ) => Promise<boolean>;
  collaborationRuntime: CollaborationRuntime;
  clusterVersion: string;
  authorization: AuthorizationService;
  runtimeTelemetry?: { beginLongLived: () => () => void };
};

export function registerCollaborationRoutes(deps: CollaborationRouteDependencies) {
  const { app, prisma, getCurrentUser, getCurrentSession, enforceCollaborationResourceAccess, collaborationRuntime, clusterVersion, authorization } = deps;
  const CLUSTER_VERSION = clusterVersion;
app.post("/api/collaboration/heartbeat", async (request, reply) => {
  const user = await getCurrentUser(request);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  const body = collaborationHeartbeatSchema.parse(request.body);
  if (!(await enforceCollaborationResourceAccess(request, reply, body.tool, body.resourceId, "view", user))) return;
  collaborationRuntime.trim();
  const clientId = body.clientId || "default";
  const presenceProfile = await loadPresenceProfile(prisma, user.id);
  collaborationRuntime.upsertPresence(composeCollaborationPresence({
    userId: user.id,
    userName: user.displayName || user.preferredName || user.username,
    avatarUrl: user.avatarUrl,
    clientId,
    tool: body.tool,
    resourceId: body.resourceId,
    projectId: body.projectId || null,
    cursor: body.cursor || null,
    viewport: body.viewport || null,
    // Free-form client activity is intentionally ignored. Only approved work context is disclosed.
    activity: null,
    selection: body.selection || null,
    editing: body.editing || null,
    updatedAt: Date.now(),
  }, presenceProfile));
  collaborationRuntime.scheduleBroadcast(body.tool, body.resourceId);
  prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return { ok: true, serverTime: Date.now() };
});

app.get("/api/collaboration/state", async (request, reply) => {
  const session = await getCurrentSession(request);
  const user = session?.user || null;
  if (!session || !user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required" });
  const query = collaborationResourceQuerySchema.parse(request.query || {});
  if (!(await enforceCollaborationResourceAccess(request, reply, query.tool, query.resourceId, "view", user))) return;
  collaborationRuntime.trim();
  return collaborationRuntime.stateForRecipient({ userId: user.id, sessionId: session.id, clientId: "state" }, query.tool, query.resourceId);
});

app.get("/api/collaboration/stream", async (request, reply) => {
  const session = await getCurrentSession(request);
  const user = session?.user || null;
  if (!session || !user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required" });
  const query = collaborationStreamQuerySchema.parse(request.query || {});
  if (!(await enforceCollaborationResourceAccess(request, reply, query.tool, query.resourceId, "view", user))) return;

  const streamId = `${user.id}:${query.clientId || "default"}:${crypto.randomUUID()}`;
  const client: CollaborationStreamClient = {
    id: streamId,
    userId: user.id,
    sessionId: session.id,
    clientId: query.clientId || "default",
    raw: reply.raw,
    connectedAt: Date.now(),
    lastSentAt: Date.now(),
  };

  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.hijack();
  reply.raw.flushHeaders?.();
  const endLongLived = deps.runtimeTelemetry?.beginLongLived() || (() => undefined);

  // Install cleanup before the first asynchronous state projection. A Studio
  // tool disable can close this stream while stateForRecipient is awaiting DB
  // access, and otherwise the close event may be missed (leaking telemetry).
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    collaborationRuntime.removeStream(query.tool, query.resourceId, streamId);
    collaborationRuntime.removePresence(query.tool, query.resourceId, user.id, query.clientId || "default");
    collaborationRuntime.scheduleBroadcast(query.tool, query.resourceId);
    endLongLived();
  };
  request.raw.once("close", cleanup);
  request.raw.once("error", cleanup);
  collaborationRuntime.addStream(query.tool, query.resourceId, client);
  collaborationRuntime.sendEvent(client, "ready", {
    ok: true,
    version: CLUSTER_VERSION,
    serverTime: Date.now(),
    streamVersion: 2,
    fullStateFrames: true,
  });
  const initialState = await collaborationRuntime.stateForRecipient(client, query.tool, query.resourceId);
  if (!cleanedUp) collaborationRuntime.sendEvent(client, "state", initialState);
});

app.post("/api/collaboration/leave", async (request, reply) => {
  const user = await getCurrentUser(request);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  const body = collaborationLeaveSchema.parse(request.body);
  const clientId = body.clientId || "default";
  collaborationRuntime.removePresence(body.tool, body.resourceId, user.id, clientId);
  collaborationRuntime.scheduleBroadcast(body.tool, body.resourceId);
  return { ok: true };
});

app.post("/api/collaboration/action", async (request, reply) => {
  const user = await getCurrentUser(request);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  const body = collaborationActionSchema.parse(request.body);
  if (!(await enforceCollaborationResourceAccess(request, reply, body.tool, body.resourceId, "contribute", user))) return;
  collaborationRuntime.trim();
  const event: CollaborationAction = {
    id: crypto.randomUUID(),
    userId: user.id,
    userName: user.displayName || user.preferredName || user.username,
    tool: body.tool,
    resourceId: body.resourceId,
    projectId: body.projectId || null,
    entity: body.entity || null,
    action: body.action,
    detail: body.detail || null,
    createdAt: Date.now(),
  };
  collaborationRuntime.recordAction(event);
  collaborationRuntime.scheduleBroadcast(body.tool, body.resourceId, body.resourceChanged);
  return event;
});
app.get("/api/collaboration/diagnostics", async (request, reply) => {
  const admin = await authorization.requireAdmin(request, reply);
  if (!admin) return;
  collaborationRuntime.trim();
  return {
    ok: true,
    ...collaborationRuntime.diagnostics(),
    serverTime: Date.now(),
    version: CLUSTER_VERSION,
  };
});
}
