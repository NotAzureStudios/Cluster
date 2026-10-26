import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";

type EntityCommentAccessDependencies = {
  prisma: any;
  authRequired: boolean;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  authorization: AuthorizationService;
  enforceCardAccess: (request: FastifyRequest, reply: FastifyReply, cardId: string, minimum: string) => Promise<boolean>;
  enforceTargetAccess: (request: FastifyRequest, reply: FastifyReply, targetKind: string, targetId: string, project: any, minimum: string) => Promise<boolean>;
};

const WORKSPACE_COMMENT_TOOLS: Record<string, string> = {
  projects: "projects", boards: "boards", whiteboards: "whiteboards", library: "library", review_asset: "viewer", builds: "builds", qa: "qa",
  tickets: "tickets", calendar: "calendar", timeline: "timeline", scheduler: "scheduler", packets: "packets",
  people: "people", activity: "activity", inbox: "inbox", integrations: "integrations", settings: "settings",
};

function permissionMinimum(minimum: string) {
  return minimum === "view" ? "view" : "contribute";
}

function toolMinimum(minimum: string) {
  return minimum === "view" ? "view" : "edit";
}

export function createEntityCommentAccess(deps: EntityCommentAccessDependencies) {
  const { prisma, authRequired, getCurrentUser, authorization, enforceCardAccess, enforceTargetAccess } = deps;

  return async function enforceEntityCommentAccess(request: FastifyRequest, reply: FastifyReply, entityType: string, entityId: string, minimum = "view") {
    const user = await getCurrentUser(request);
    if (!user) {
      if (!authRequired) return true;
      reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
      return false;
    }

    if (entityType === "ticket" || entityType === "card") return Boolean(await enforceCardAccess(request, reply, entityId, permissionMinimum(minimum)));

    if (entityType === "project") {
      const project = await prisma.project.findUnique({ where: { id: entityId } });
      if (!project || project.archived) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." }); return false; }
      return enforceTargetAccess(request, reply, "project", project.id, project, permissionMinimum(minimum));
    }

    if (entityType === "board") {
      const board = await prisma.board.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!board || board.archived) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." }); return false; }
      return enforceTargetAccess(request, reply, "board", board.id, board.project, permissionMinimum(minimum));
    }

    if (entityType === "whiteboard") {
      const whiteboard = await prisma.whiteboard.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!whiteboard) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Whiteboard not found." }); return false; }
      if (!whiteboard.project) return Boolean(await authorization.requireTool(request, reply, "whiteboards", toolMinimum(minimum)));
      return enforceTargetAccess(request, reply, "whiteboard", whiteboard.id, whiteboard.project, permissionMinimum(minimum));
    }

    if (entityType === "library") {
      const item = await prisma.libraryItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!item || item.lifecycleState === "destroyed") { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Library item not found." }); return false; }
      return enforceTargetAccess(request, reply, "library", item.id, item.project, permissionMinimum(minimum));
    }

    if (entityType === "workspace") {
      const scope = entityId.split(":", 1)[0].trim().toLowerCase();
      if (scope === "admin") return Boolean(await authorization.requireAdmin(request, reply));
      const tool = WORKSPACE_COMMENT_TOOLS[scope];
      if (!tool) { reply.code(400).send({ ok: false, code: "COMMENT_TARGET_INVALID", error: "Unsupported workspace comment scope." }); return false; }
      return Boolean(await authorization.requireTool(request, reply, tool, toolMinimum(minimum)));
    }

    if (entityType === "project_control") {
      const record = await prisma.projectControlRecord.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!record || record.archived || !record.project) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project control record not found." }); return false; }
      return enforceTargetAccess(request, reply, "project", record.project.id, record.project, permissionMinimum(minimum));
    }

    if (entityType === "source_review") {
      const review = await prisma.sourceReview.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!review?.project || review.project.archived) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Source review not found." }); return false; }
      return Boolean(await authorization.requireTarget(request, reply, "source_review", review.id, review.project, permissionMinimum(minimum)));
    }

    if (entityType === "build" || entityType === "qa_plan" || entityType === "qa_session") {
      const record = entityType === "build"
        ? await prisma.deliveryBuild.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } })
        : entityType === "qa_plan"
          ? await prisma.deliveryQaPlan.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } })
          : await prisma.deliveryQaSession.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } });
      if (!record?.projectId) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Delivery record not found." }); return false; }
      const project = await prisma.project.findUnique({ where: { id: record.projectId } });
      if (!project || project.archived) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." }); return false; }
      return Boolean(await authorization.requireTarget(request, reply, entityType, entityId, project, permissionMinimum(minimum)));
    }

    if (entityType === "timeline") {
      const item = await prisma.timelineItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!item) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Timeline item not found." }); return false; }
      if (!item.project) return Boolean(await authorization.requireUserScope(request, reply, { ownerUserId: item.userId, tool: "timeline", minimum: toolMinimum(minimum), allowUnowned: true }));
      return enforceTargetAccess(request, reply, "timeline", item.id, item.project, permissionMinimum(minimum));
    }

    reply.code(400).send({ ok: false, code: "COMMENT_TARGET_INVALID", error: "Unsupported comment target." });
    return false;
  };
}
