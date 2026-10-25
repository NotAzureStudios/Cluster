import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";

export function createBoardPolicy(authorization: AuthorizationService) {
  return {
    requireProjectBoardManage(request: FastifyRequest, reply: FastifyReply, project: any) {
      return authorization.requireProjectResource(request, reply, project, "boards", "manage");
    },
    requireBoard(request: FastifyRequest, reply: FastifyReply, board: any, level: "view" | "contribute" | "manage") {
      return authorization.requireTarget(request, reply, "board", board.id, board.project, level);
    },
    requireList(request: FastifyRequest, reply: FastifyReply, listId: string, level: "view" | "contribute" | "manage") {
      return authorization.requireList(request, reply, listId, level);
    },
  };
}
