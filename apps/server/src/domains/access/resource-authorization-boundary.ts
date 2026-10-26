import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "./authorization.js";
import type { ClusterRequestPolicy } from "./request-policy.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

function paramsObject(request: FastifyRequest) {
  const value = request.params;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringParam(params: Record<string, unknown>, key: string) {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function requireProjectChild(
  request: FastifyRequest,
  reply: FastifyReply,
  authorization: AuthorizationService,
  project: any | null | undefined,
  targetKind: string,
  targetId: string,
  minimum: string,
) {
  if (!project) {
    reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: `${targetKind} not found.` });
    return false;
  }
  return authorization.requireTarget(request, reply, targetKind, targetId, project, minimum);
}

export function createResourceAuthorizationBoundary(deps: { prisma: any; authorization: AuthorizationService }) {
  const { prisma, authorization } = deps;

  return async function authorizeResourceBoundary(request: FastifyRequest, reply: FastifyReply, policy: ClusterRequestPolicy) {
    const { pathname, method } = policy;
    const params = paramsObject(request);
    const minimum = policy.resourceMinimum;

    const projectId = stringParam(params, "projectId");
    if (projectId) {
      let projectMinimum: string = minimum;
      if (pathname.includes("/share-links")) projectMinimum = "manage";
      if (/^\/api\/projects\/[^/]+$/.test(pathname) && method === "DELETE") projectMinimum = "manage";

      if (policy.capability && policy.capability !== "projects") {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project || project.archived) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
          return false;
        }
        if (!(await authorization.requireProjectResource(request, reply, project, policy.capability, projectMinimum))) return false;
      } else if (!(await authorization.requireProject(request, reply, projectId, projectMinimum))) return false;
    }

    const boardId = stringParam(params, "boardId");
    if (boardId) {
      const board = await prisma.board.findUnique({ where: { id: boardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!board) {
        reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
        return false;
      }
      if (!(await authorization.requireTarget(request, reply, "board", board.id, board.project, minimum))) return false;
    }

    const listId = stringParam(params, "listId");
    if (listId && !(await authorization.requireList(request, reply, listId, minimum))) return false;

    const cardId = stringParam(params, "cardId");
    if (cardId && !(await authorization.requireCard(request, reply, cardId, minimum))) return false;

    if (pathname.startsWith("/api/checklist/")) {
      const itemId = stringParam(params, "itemId");
      if (itemId) {
        const item = await prisma.checklistItem.findUnique({
          where: { id: itemId },
          include: { card: { include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } } },
        });
        if (!item) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Checklist item not found." });
          return false;
        }
        if (!(await authorization.requireCard(request, reply, item.card.id, minimum))) return false;
      }
    }

    const fileId = stringParam(params, "fileId");
    if (fileId) {
      const file = await prisma.projectFile.findUnique({ where: { id: fileId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!file) {
        reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "File not found." });
        return false;
      }
      if (!(await requireProjectChild(request, reply, authorization, file.project, "file", file.id, minimum))) return false;
    }

    const assetId = stringParam(params, "assetId");
    if (assetId) {
      const asset = await prisma.reviewAsset.findUnique({ where: { id: assetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!asset) {
        reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Review asset not found." });
        return false;
      }
      if (!(await requireProjectChild(request, reply, authorization, asset.project, "review_asset", asset.id, minimum))) return false;
    }

    if (pathname.startsWith("/api/review-comments/")) {
      const commentId = stringParam(params, "commentId");
      if (commentId) {
        const comment = await prisma.reviewComment.findUnique({
          where: { id: commentId },
          include: { reviewAsset: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } },
        });
        if (!comment?.reviewAsset) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Review comment not found." });
          return false;
        }
        if (!(await requireProjectChild(request, reply, authorization, comment.reviewAsset.project, "review_asset", comment.reviewAsset.id, minimum))) return false;
      }
    }

    const whiteboardId = stringParam(params, "whiteboardId");
    if (whiteboardId) {
      const whiteboard = await prisma.whiteboard.findUnique({ where: { id: whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!whiteboard) {
        reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Whiteboard not found." });
        return false;
      }
      if (!(await authorization.requireTarget(request, reply, "whiteboard", whiteboard.id, whiteboard.project || null, minimum))) return false;
    }

    if (pathname.startsWith("/api/library/")) {
      const itemId = stringParam(params, "itemId");
      if (itemId) {
        const item = await prisma.libraryItem.findUnique({ where: { id: itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!item) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Library item not found." });
          return false;
        }
        if (!(await authorization.requireTarget(request, reply, "library", item.id, item.project || null, minimum))) return false;
      }
    }

    if (pathname.startsWith("/api/calendar/events/")) {
      const eventId = stringParam(params, "eventId");
      if (eventId) {
        const event = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!event) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar event not found." });
          return false;
        }
        const calendarMinimum = method === "GET" ? "view" : minimum === "manage" ? "manage" : "edit";
        if (!(await canAccessCalendarEvent(authorization, request, event, calendarMinimum))) {
          reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You do not have access to this Calendar event." });
          return false;
        }
      }
    }

    if (pathname.startsWith("/api/timeline/items/")) {
      const itemId = stringParam(params, "itemId");
      if (itemId) {
        const item = await prisma.timelineItem.findUnique({ where: { id: itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!item) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Timeline item not found." });
          return false;
        }
        if (item.project) {
          if (!(await authorization.requireTarget(request, reply, "timeline", item.id, item.project, minimum))) return false;
        } else if (!(await authorization.requireUserScope(request, reply, { ownerUserId: item.userId, tool: "timeline", minimum: method === "GET" ? "view" : "edit", allowUnowned: true }))) return false;
      }
    }

    if (pathname.startsWith("/api/time/entries/")) {
      const entryId = stringParam(params, "entryId");
      if (entryId) {
        const entry = await prisma.timeEntry.findUnique({ where: { id: entryId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!entry) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Time entry not found." });
          return false;
        }
        if (!(await authorization.requireUserScope(request, reply, { ownerUserId: entry.userId, tool: "scheduler", minimum: method === "GET" ? "view" : "edit" }))) return false;
        if (entry.project && !(await authorization.requireTarget(request, reply, "time", entry.id, entry.project, minimum))) return false;
      }
    }

    if (pathname.startsWith("/api/schedule/blocks/")) {
      const blockId = stringParam(params, "blockId");
      if (blockId) {
        const block = await prisma.scheduleBlock.findUnique({ where: { id: blockId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
        if (!block) {
          reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Schedule block not found." });
          return false;
        }
        if (method !== "GET" && !(await authorization.requireUserScope(request, reply, { ownerUserId: block.userId, tool: "scheduler", minimum: "edit", allowUnowned: true }))) return false;
        if (block.project && !(await authorization.requireTarget(request, reply, "schedule", block.id, block.project, minimum))) return false;
      }
    }

    return true;
  };
}
