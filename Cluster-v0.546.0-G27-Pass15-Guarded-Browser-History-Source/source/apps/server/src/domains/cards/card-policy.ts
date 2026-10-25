import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";

export function createCardPolicy(authorization: AuthorizationService) {
  return {
    requireList(request: FastifyRequest, reply: FastifyReply, listId: string, level: "view" | "contribute" | "manage") {
      return authorization.requireList(request, reply, listId, level);
    },
    requireCard(request: FastifyRequest, reply: FastifyReply, cardId: string, level: "view" | "contribute" | "manage") {
      return authorization.requireCard(request, reply, cardId, level);
    },
  };
}
