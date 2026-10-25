import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";
import { mondayWeekStart } from "../../core/time.js";
import { parseScheduleStringList } from "./scheduler-planning.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

type TimeRouteAccessDependencies = {
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  serializeUserLite: (user: any) => any;
  readSettings: () => Promise<Record<string, any>>;
  authorization: AuthorizationService;
};

type TimeReferences = {
  projectId?: string | null;
  boardId?: string | null;
  cardId?: string | null;
};

export function createTimeRouteAccess({
  prisma,
  getCurrentUser,
  decorateUserForClient,
  hasToolPermission,
  serializeUserLite,
  readSettings,
  authorization,
}: TimeRouteAccessDependencies) {
  const weekStart = mondayWeekStart;
  const weekEnd = (start: Date) => new Date(start.getTime() + 604800000);

  async function resolveBillableValue(actor: any, projectId: string | null | undefined, category: string, requested?: boolean) {
    const settings = await readSettings();
    const decorated = await decorateUserForClient(actor);
    const canManage = Boolean(decorated?.isAdmin || hasToolPermission(actor, decorated?.workspaceRole, "scheduler", "manage"));
    if (canManage && typeof requested === "boolean") return requested;
    const configuredProjects = Array.isArray(settings.schedulerBillableProjectIds) ? settings.schedulerBillableProjectIds.map(String) : [];
    const configuredCategories = Array.isArray(settings.schedulerBillableCategories) ? settings.schedulerBillableCategories.map(String) : [];
    if (projectId && configuredProjects.includes(String(projectId))) return true;
    if (configuredCategories.includes(String(category))) return true;
    return Boolean(settings.schedulerDefaultBillable);
  }

  async function isTimeManager(currentUser: any) {
    if (!currentUser) return false;
    const decorated = await decorateUserForClient(currentUser);
    return Boolean(decorated?.isAdmin || hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "manage"));
  }

  async function canOperateTimerForUser(currentUser: any, targetUserId: string) {
    if (!currentUser) return false;
    return currentUser.id === targetUserId || await isTimeManager(currentUser);
  }

  async function targetUserIdForWrite(request: FastifyRequest, requestedUserId?: string | null) {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) throw new Error("Login required.");
    const targetUserId = requestedUserId || currentUser.id;
    if (!(await canOperateTimerForUser(currentUser, targetUserId))) {
      throw new Error("Scheduler manage permission required to write entries for another user.");
    }
    return targetUserId;
  }

  async function canViewTimeEntry(request: FastifyRequest, entry: any) {
    if (!(await authorization.requestCanUserScope(request, { ownerUserId: entry?.userId, tool: "scheduler", minimum: "view" }))) return false;
    if (!entry?.project) return true;
    return authorization.requestCanTarget(request, "time", String(entry.id), entry.project, "view");
  }

  async function canViewScheduleBlock(request: FastifyRequest, block: any) {
    const currentUser = await getCurrentUser(request);
    const isParticipant = Boolean(currentUser?.id && parseScheduleStringList(block?.participantIds).includes(String(currentUser.id)));
    if (isParticipant) {
      const decorated = await decorateUserForClient(currentUser);
      if (!decorated?.isAdmin && !hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "view")) return false;
    } else if (!(await authorization.requestCanUserScope(request, { ownerUserId: block?.userId, tool: "scheduler", minimum: "view", allowUnowned: true }))) return false;
    if (!block?.project) return true;
    return authorization.requestCanTarget(request, "schedule", String(block.id), block.project, "view");
  }

  async function canViewCalendarEvent(request: FastifyRequest, event: any) {
    return canAccessCalendarEvent(authorization, request, event, "view");
  }

  async function requireTimeReferences(request: FastifyRequest, reply: FastifyReply, refs: TimeReferences, targetKind: "time" | "schedule", targetId: string) {
    let project: any | null = null;
    let board: any | null = null;
    let card: any | null = null;
    if (refs.cardId) {
      card = await prisma.card.findUnique({ where: { id: refs.cardId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
      if (!card) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." }); return null; }
      if (!(await authorization.requireCard(request, reply, card.id, "view"))) return null;
      board = card.list.board;
      project = board.project;
    }
    if (refs.boardId) {
      const requestedBoard = await prisma.board.findUnique({ where: { id: refs.boardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!requestedBoard) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." }); return null; }
      if (!(await authorization.requireTarget(request, reply, "board", requestedBoard.id, requestedBoard.project, "view"))) return null;
      if (board && board.id !== requestedBoard.id) {
        reply.code(400).send({ ok: false, code: "PARENT_MISMATCH", error: "The selected card does not belong to the selected board." });
        return null;
      }
      board = requestedBoard;
      project = project || requestedBoard.project;
    }
    if (refs.projectId) {
      const requestedProject = await prisma.project.findUnique({ where: { id: refs.projectId } });
      if (!requestedProject) { reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." }); return null; }
      if (project && project.id !== requestedProject.id) {
        reply.code(400).send({ ok: false, code: "PARENT_MISMATCH", error: "The selected board or card does not belong to the selected project." });
        return null;
      }
      project = requestedProject;
    }
    if (project && !(await authorization.requireTarget(request, reply, targetKind, targetId, project, "contribute"))) return null;
    return { projectId: project?.id || null, boardId: board?.id || null, cardId: card?.id || null, project, board, card };
  }

  async function requireExistingTimeProject(
    request: FastifyRequest,
    reply: FastifyReply,
    targetKind: "time" | "schedule",
    targetId: string,
    project: any | null | undefined,
    minimum: "view" | "contribute" = "contribute",
  ) {
    if (!project) return true;
    return authorization.requireTarget(request, reply, targetKind, targetId, project, minimum);
  }

  async function filterVisibleTimeEntries(request: FastifyRequest, entries: any[]) {
    const checks = await Promise.all(entries.map(async (entry) => ({ entry, allowed: await canViewTimeEntry(request, entry) })));
    return checks.filter((item) => item.allowed).map((item) => item.entry);
  }

  async function filterVisibleScheduleBlocks(request: FastifyRequest, blocks: any[]) {
    const checks = await Promise.all(blocks.map(async (block) => ({ block, allowed: await canViewScheduleBlock(request, block) })));
    return checks.filter((item) => item.allowed).map((item) => item.block);
  }

  return {
    weekStart,
    weekEnd,
    resolveBillableValue,
    isTimeManager,
    canOperateTimerForUser,
    canCorrectTimeEntry: async (currentUser: any, _entry: any) => isTimeManager(currentUser),
    canDeleteTimeEntry: async (currentUser: any, _entry: any) => isTimeManager(currentUser),
    canChangeScheduleBlock: async (currentUser: any, _block: any, _operation: "edit" | "delete") => isTimeManager(currentUser),
    targetUserIdForWrite,
    canViewTimeEntry,
    canViewScheduleBlock,
    canViewCalendarEvent,
    requireTimeReferences,
    requireExistingTimeProject,
    filterVisibleTimeEntries,
    filterVisibleScheduleBlocks,
  };
}
