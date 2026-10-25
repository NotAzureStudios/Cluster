import type { FastifyRequest } from "fastify";
import { describeClusterRequest, type ClusterRequestPolicy } from "./request-policy.js";

export type RequestActorContext = {
  userId: string;
  sessionId: string;
  workspaceId: string | null;
  workspaceRole: string | null;
  isAdmin: boolean;
  kioskProfileId: string | null;
};

export type ClusterRequestContext = {
  policy: ClusterRequestPolicy;
  actor: RequestActorContext | null;
  authorized: boolean;
};

const requestContexts = new WeakMap<FastifyRequest, ClusterRequestContext>();

export function requestContextFor(request: FastifyRequest) {
  let context = requestContexts.get(request);
  if (!context) {
    const pathname = request.url.split("?")[0] || "/";
    context = { policy: describeClusterRequest(pathname, request.method), actor: null, authorized: false };
    requestContexts.set(request, context);
  }
  return context;
}

export function setRequestActorContext(request: FastifyRequest, actor: RequestActorContext) {
  const context = requestContextFor(request);
  context.actor = actor;
  return context;
}

export function markRequestAuthorized(request: FastifyRequest) {
  const context = requestContextFor(request);
  context.authorized = true;
  return context;
}
