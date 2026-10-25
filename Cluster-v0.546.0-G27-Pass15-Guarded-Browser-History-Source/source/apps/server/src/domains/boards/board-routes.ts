import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CollaborationRuntime } from "../../core/collaboration-runtime.js";
import type { AuthorizationService } from "../access/authorization.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createBoardPolicy } from "./board-policy.js";
import { createBoardRepository } from "./board-repository.js";
import { createBoardService } from "./board-service.js";
import { BoardListHistoryError, listBoardListSavedHistory, reverseListSavedOperation } from "./board-list-saved-history.js";
import { BoardListLifecycleError, transitionBoardListLifecycle } from "./board-list-lifecycle.js";
import { z } from "zod";
import { createExternalEntityLinkService } from "../integrations/external-entity-link-service.js";
import { buildBoardPlanningPayload, findBoardProjectionCards, findBoardProjectionRelationships } from "./board-planning-service.js";
import { boardIdParamsSchema, createBoardSchema, createListSchema, listIdParamsSchema, projectIdParamsSchema, reorderListSchema, revisionBodySchema, updateBoardSchema, updateListSchema } from "./board-schemas.js";

type BoardRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  authorization: AuthorizationService;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  defaultBoardColumnsForProjectType: (type: string, productionProfile?: string | null) => string[];
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  sendRevisionConflict: (reply: FastifyReply, entityType: string, current: unknown) => unknown;
  serializeBoard: (board: any) => any;
  serializeCard: (card: any) => any;
  collaborationRuntime: Pick<CollaborationRuntime, "scheduleBroadcast">;
};

export function registerBoardRoutes(deps: BoardRouteDependencies) {
  const { app, prisma, authorization, getCurrentUser, defaultBoardColumnsForProjectType, logActivity, sendRevisionConflict, serializeBoard, serializeCard, collaborationRuntime } = deps;
  const repository = createBoardRepository(prisma);
  const policy = createBoardPolicy(authorization);
  const externalLinks = createExternalEntityLinkService(prisma);
  const service = createBoardService({
    repository,
    defaultBoardColumnsForProjectType,
    logActivity,
    scheduleBroadcast: collaborationRuntime.scheduleBroadcast.bind(collaborationRuntime),
    logInfo: (data, message) => app.log.info(data, message),
  });

  app.post("/api/projects/:projectId/boards", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { projectId } = projectIdParamsSchema.parse(request.params);
    const body = createBoardSchema.parse(request.body);
    const project = await repository.findProject(projectId);
    if (!project) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    if (!(await policy.requireProjectBoardManage(request, reply, project))) return;
    return service.create(project, body, user?.id);
  });

  app.patch("/api/boards/:boardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const body = updateBoardSchema.parse(request.body);
    const existing = await repository.findBoardForMutation(boardId);
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, existing, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return sendRevisionConflict(reply, "board", serializeBoard(existing));
    const result = await service.update(existing, body, user?.id);
    if ("conflict" in result) return sendRevisionConflict(reply, "board", result.conflict ? serializeBoard(result.conflict) : null);
    return result.board;
  });

  app.delete("/api/boards/:boardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const body = revisionBodySchema.parse(request.body || {});
    const board = await repository.findBoardForMutation(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== board.revision) return sendRevisionConflict(reply, "board", serializeBoard(board));
    let result: Awaited<ReturnType<typeof service.remove>>;
    try { result = await service.remove(board, user?.id); }
    catch (error) { if ((error as any)?.code === "BOARD_DELETE_BLOCKED") return reply.code(409).send({ ok: false, code: "BOARD_DELETE_BLOCKED", error: (error as Error).message }); throw error; }
    if ("conflict" in result) return sendRevisionConflict(reply, "board", result.conflict ? serializeBoard(result.conflict) : null);
    return result;
  });

  app.post("/api/boards/:boardId/lists", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const body = createListSchema.parse(request.body);
    const board = await repository.findBoardForMutation(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "manage"))) return;
    return service.createList(boardId, body, user?.id);
  });

  app.patch("/api/lists/:listId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { listId } = listIdParamsSchema.parse(request.params);
    const body = updateListSchema.parse(request.body);
    if (!(await policy.requireList(request, reply, listId, "manage"))) return;
    const existing = await repository.findListForMutation(listId);
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Column not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return sendRevisionConflict(reply, "column", existing);
    const result = await service.updateList(existing, body, user?.id);
    if ("conflict" in result) return sendRevisionConflict(reply, "column", result.conflict);
    return result.list;
  });

  // Metadata-only history. Fresh permission checks are required for every read and reversal.
  app.get("/api/lists/:listId/saved-history", async (request, reply) => {
    const { listId } = listIdParamsSchema.parse(request.params);
    if (!(await policy.requireList(request, reply, listId, "view"))) return;
    const user = await getCurrentUser(request);
    reply.header("Cache-Control", "private, no-store");
    try { return await listBoardListSavedHistory(prisma, listId, user?.id || ""); }
    catch (error) {
      if (error instanceof BoardListHistoryError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/lists/:listId/saved-history/${direction}`, async (request, reply) => {
      const { listId } = listIdParamsSchema.parse(request.params);
      const body = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().min(1).max(128) }).parse(request.body);
      if (!(await policy.requireList(request, reply, listId, "manage"))) return;
      const user = await getCurrentUser(request);
      if (!user?.id) return reply.code(401).send({ ok: false, code: "UNAUTHENTICATED", error: "Sign in to reverse column history." });
      try {
        const result = await reverseListSavedOperation(prisma, { listId, actorUserId: user.id, ...body, action: direction });
        const list = await repository.findUpdatedList(listId);
        await logActivity({ userId: user.id, projectId: list.board.projectId, boardId: list.boardId,
          type: "updated", entityType: "list", entityId: listId,
          title: direction === "undo" ? "Column settings undone" : "Column settings redone", message: list.title,
          metadata: { revision: result.revision, changedFields: result.changedFields, sourceOperationId: body.operationId } }).catch(() => undefined);
        collaborationRuntime.scheduleBroadcast("board", list.boardId, true);
        return { ok: true, ...result, list };
      } catch (error) {
        if (error instanceof BoardListHistoryError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
        throw error;
      }
    });
  }

  app.post("/api/lists/:listId/reorder", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { listId } = listIdParamsSchema.parse(request.params);
    const { direction, expectedRevision } = reorderListSchema.parse(request.body);
    if (!(await policy.requireList(request, reply, listId, "manage"))) return;
    const list = await repository.findListForReorder(listId);
    if (expectedRevision !== list.revision) return sendRevisionConflict(reply, "column", list);
    const result = await service.reorderList(list, direction, user?.id);
    if ("conflict" in result) return sendRevisionConflict(reply, "column", await repository.findListForReorder(listId));
    return result;
  });

  app.get("/api/boards/:boardId/archived-lists", async (request, reply) => {
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const board = await repository.findBoardForMutation(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "view"))) return;
    reply.header("Cache-Control", "private, no-store");
    return repository.findArchivedLists(boardId);
  });

  app.post("/api/lists/:listId/lifecycle", async (request, reply) => {
    const { listId } = listIdParamsSchema.parse(request.params);
    const body = z.object({ action: z.enum(["archive", "restore"]), expectedRevision: z.number().int().positive() }).parse(request.body);
    if (!(await policy.requireList(request, reply, listId, "manage"))) return;
    const user = await getCurrentUser(request);
    try {
      const list = await transitionBoardListLifecycle(prisma, { listId, ...body, actorUserId: user?.id });
      await logActivity({ userId: user?.id, projectId: (await repository.findListForMutation(listId))?.board?.projectId,
        boardId: list.boardId, type: body.action === "archive" ? "archived" : "updated",
        entityType: "list", entityId: listId, title: body.action === "archive" ? "Column archived" : "Column restored", message: list.title }).catch(() => undefined);
      collaborationRuntime.scheduleBroadcast("board", list.boardId, true);
      return { ok: true, list };
    } catch (error) {
      if (error instanceof BoardListLifecycleError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.delete("/api/lists/:listId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { listId } = listIdParamsSchema.parse(request.params);
    const body = revisionBodySchema.parse(request.body || {});
    if (!(await policy.requireList(request, reply, listId, "manage"))) return;
    const list = await repository.findListForDelete(listId);
    if (!list) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Column not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== list.revision) return sendRevisionConflict(reply, "column", list);
    let result: Awaited<ReturnType<typeof service.removeList>>;
    try { result = await service.removeList(list, user?.id); }
    catch (error) { if (error instanceof BoardListLifecycleError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message }); throw error; }
    if ("conflict" in result) return sendRevisionConflict(reply, "column", result.conflict);
    return result;
  });

  app.get("/api/boards/:boardId/archived-cards", async (request, reply) => {
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const board = await repository.findBoardForMutation(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "view"))) return;
    const cards = await repository.findArchivedCards(boardId);
    const visibleCards = await authorization.filterCardsForRequest(request, cards, board.project, "view");
    const decoratedCards = await externalLinks.decorateCards(visibleCards);
    return decoratedCards.map((card: any) => ({ ...serializeCard(card), listTitle: card.list?.title || "Unknown column", listArchived: Boolean(card.list?.archived) }));
  });


  app.get("/api/boards/:boardId/planning", async (request, reply) => {
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const board = await repository.findBoardDetail(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "view"))) return;
    const visibleCardIds: string[] = [];
    for (const list of board.lists || []) {
      const visibleCards = await authorization.filterCardsForRequest(request, list.cards || [], board.project, "view");
      visibleCardIds.push(...visibleCards.map((card: any) => card.id));
    }
    const projectionRelationships = await findBoardProjectionRelationships(prisma, board.projectId, board.id);
    const projectedCards = await findBoardProjectionCards(prisma, board.projectId, projectionRelationships);
    const visibleProjectionCards = await authorization.filterCardsForRequest(request, projectedCards, board.project, "view");
    return buildBoardPlanningPayload({ prisma, boardId: board.id, projectId: board.projectId, visibleCardIds, projectionRelationships, visibleProjectionCards });
  });

  app.get("/api/boards/:boardId", async (request, reply) => {
    const { boardId } = boardIdParamsSchema.parse(request.params);
    const board = await repository.findBoardDetail(boardId);
    if (!board) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Board not found." });
    if (!(await policy.requireBoard(request, reply, board, "view"))) return;
    for (const list of board.lists || []) {
      const visibleCards = await authorization.filterCardsForRequest(request, list.cards || [], board.project, "view");
      list.cards = await externalLinks.decorateCards(visibleCards);
    }
    return serializeBoard(board);
  });
}
