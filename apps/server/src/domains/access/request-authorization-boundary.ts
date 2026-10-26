import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "./authorization.js";
import { markRequestAuthorized, requestContextFor } from "./request-context.js";
import { createResourceAuthorizationBoundary } from "./resource-authorization-boundary.js";

export function createRequestAuthorizationBoundary(deps: { prisma: any; authorization: AuthorizationService }) {
  const { authorization } = deps;
  const authorizeResourceBoundary = createResourceAuthorizationBoundary(deps);

  return async function authorizeRequestBoundary(request: FastifyRequest, reply: FastifyReply) {
    const context = requestContextFor(request);
    const { access } = context.policy;

    if (access.kind === "public") {
      markRequestAuthorized(request);
      return true;
    }
    if (access.kind === "admin") {
      if (!(await authorization.requireAdmin(request, reply))) return false;
    } else if (access.kind === "tool") {
      if (!(await authorization.requireTool(request, reply, access.tool, access.level))) return false;
    }

    if (!(await authorizeResourceBoundary(request, reply, context.policy))) return false;
    markRequestAuthorized(request);
    return true;
  };
}
