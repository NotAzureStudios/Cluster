import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiError } from "../../core/api-response.js";
import { SavedCardHistoryError, listSavedCardHistory, reverseSavedCardOperation } from "./card-saved-history.js";
import type { CollaborationRuntime } from "../../core/collaboration-runtime.js";
import type { AuthorizationService } from "../access/authorization.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createCardPolicy } from "./card-policy.js";
import { createCardRepository } from "./card-repository.js";
import { createCardService } from "./card-service.js";
import { emitProjectDeliveryAutomationSignals } from "../projects/project-delivery-lifecycle-service.js";
import { createExternalEntityLinkService } from "../integrations/external-entity-link-service.js";
import { workAssignmentActivity } from "../work/work-assignment.js";
import { cardIdParamsSchema, cardRevisionBodySchema, checklistItemParamsSchema, createCardCommentSchema, createCardSchema, createChecklistItemSchema, duplicateCardSchema, moveCardSchema, promoteChecklistItemSchema, updateCardSchema, updateChecklistItemSchema, savedCardHistoryCommandSchema } from "./card-schemas.js";

type CardRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  authorization: AuthorizationService;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  serializeCard: (card: any) => any;
  sendRevisionConflict: (reply: FastifyReply, entityType: string, current: unknown) => unknown;
  collaborationRuntime: Pick<CollaborationRuntime, "scheduleBroadcast">;
};

export function registerCardRoutes(deps: CardRouteDependencies) {
  const { app, prisma, authorization, getCurrentUser, logActivity, serializeCard, sendRevisionConflict, collaborationRuntime } = deps;
  const repository = createCardRepository(prisma);
  const policy = createCardPolicy(authorization);
  const service = createCardService({ repository, logActivity, scheduleBroadcast: collaborationRuntime.scheduleBroadcast.bind(collaborationRuntime) });
  const externalLinks = createExternalEntityLinkService(prisma);
  async function serializeCardWithLinks(card: any) {
    if (!card) return serializeCard(card);
    const [decorated] = await externalLinks.decorateCards([card]);
    return serializeCard(decorated);
  }

  // A Card-specific, permission-filtered fresh read is required to resolve a
  // revision conflict without discarding an unsaved editor draft. Do not use
  // the cached full-Board projection for concurrency recovery.
  app.get("/api/cards/:cardId", async (request, reply) => {
    const { cardId } = cardIdParamsSchema.parse(request.params);
    if (!(await policy.requireCard(request, reply, cardId, "view"))) return;
    const latest = await repository.findCardForUpdate(cardId);
    if (!latest) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
    reply.header("Cache-Control", "no-store");
    return serializeCardWithLinks(latest);
  });

  // Auth-filtered metadata history. No snapshots leak through the read API.
  app.get("/api/cards/:cardId/saved-history", async (request, reply) => {
    const { cardId } = cardIdParamsSchema.parse(request.params);
    if (!(await policy.requireCard(request, reply, cardId, "view"))) return;
    const user = await getCurrentUser(request);
    reply.header("Cache-Control", "private, no-store");
    try { return await listSavedCardHistory(prisma, cardId, user?.id || ""); }
    catch (error) {
      if (error instanceof SavedCardHistoryError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/cards/:cardId/saved-history/${direction}`, async (request, reply) => {
      const { cardId } = cardIdParamsSchema.parse(request.params);
      const body = savedCardHistoryCommandSchema.parse(request.body || {});
      if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
      const user = await getCurrentUser(request);
      if (!user?.id) return reply.code(401).send({ ok: false, code: "UNAUTHENTICATED", error: "Sign in to reverse a saved edit." });
      try {
        const result = await reverseSavedCardOperation(prisma, { cardId, actorUserId: user.id, action: direction, ...body });
        const card = await repository.findCardForUpdate(cardId);
        if (!card) return reply.code(409).send({ ok: false, code: "CARD_CHANGED_AFTER_HISTORY", error: "The saved edit was applied, but the Card changed again. Refresh before continuing." });
        // A successful commit is authoritative even if activity delivery is unavailable.
        if (result.previousAssigneeId !== result.assigneeId) {
          const assignment = workAssignmentActivity({ actorUserId: user.id,
            source: { kind: card.workItemKind === "ticket" ? "ticket" : "card", id: card.id,
              projectId: card.list.board.projectId, label: card.title },
            previousAssigneeId: result.previousAssigneeId, assigneeId: result.assigneeId,
            projectId: card.list.board.projectId, boardId: card.list.boardId, cardId,
            dueAt: card.dueDate });
          if (assignment) await logActivity(assignment).catch(() => undefined);
        }
        await emitProjectDeliveryAutomationSignals({ prisma, logActivity,
          projectId: card.list.board.projectId, actorId: user.id }).catch(() => undefined);
        await logActivity({ userId: user.id, projectId: card.list.board.projectId,
          boardId: card.list.boardId, cardId, type: "updated", entityType: "card", entityId: cardId,
          title: direction === "undo" ? "Saved Card edit undone" : "Saved Card edit redone", message: card.title,
          metadata: { revision: result.revision, savedHistoryAction: direction, operationId: body.operationId, changedFields: result.changedFields } }).catch(() => undefined);
        collaborationRuntime.scheduleBroadcast("board", card.list.boardId, true);
        return serializeCardWithLinks(card);
      } catch (error) {
        if (error instanceof SavedCardHistoryError) return reply.code(error.status).send({ ok: false, code: error.code, error: error.message });
        throw error;
      }
    });
  }

  app.post("/api/cards", async (request, reply) => {
    const user = await getCurrentUser(request);
    const body = createCardSchema.parse(request.body);
    if (!(await policy.requireList(request, reply, body.listId, "contribute"))) return;
    const destination = await prisma.boardList.findUnique({ where: { id: body.listId }, select: { archived: true, board: { select: { archived: true } } } });
    if (!destination || destination.archived || destination.board?.archived) return reply.code(409).send({ ok: false, code: "LIST_ARCHIVED", error: "Restore the destination Board and column before creating work." });
    return serializeCardWithLinks(await service.create(body, user?.id));
  });

  app.post("/api/cards/:cardId/duplicate", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const { title } = duplicateCardSchema.parse(request.body || {});
    if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
    const source = await repository.findCardForUpdate(cardId);
    if (!source || source.list?.archived || source.list?.board?.archived) return reply.code(409).send({ ok: false, code: "LIST_ARCHIVED", error: "Restore the source column before duplicating work." });
    const card = await service.duplicate(cardId, title, user?.id);
    if (!card) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
    return serializeCardWithLinks(card);
  });

  app.patch("/api/cards/:cardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const body = updateCardSchema.parse(request.body);
    if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
    const existing = await repository.findCardForUpdate(cardId);
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
    if ((body.archived === false || body.archived === undefined) && (existing.list?.archived || existing.list?.board?.archived)) return reply.code(409).send({ ok: false, code: "LIST_ARCHIVED", error: "Restore the column before editing or restoring this Card." });
    if (body.ticketStage !== undefined && existing.workItemKind !== "ticket") return reply.code(400).send({ ok: false, code: "TICKET_STAGE_ONLY", error: "Only Tickets have a triage stage." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return sendRevisionConflict(reply, "card", await serializeCardWithLinks(existing));
    const result = await service.update(existing, body, user?.id);
    if ("conflict" in result) return sendRevisionConflict(reply, "card", result.conflict ? await serializeCardWithLinks(result.conflict) : null);
    const projectId = result.card?.list?.board?.projectId || null;
    if (projectId) await emitProjectDeliveryAutomationSignals({ prisma, logActivity, projectId, actorId: user?.id || null }).catch(() => undefined);
    return serializeCardWithLinks(result.card);
  });

  app.delete("/api/cards/:cardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const body = cardRevisionBodySchema.parse(request.body || {});
    if (!(await policy.requireCard(request, reply, cardId, "manage"))) return;
    const card = await repository.findCardForDelete(cardId);
    if (!card) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== card.revision) return sendRevisionConflict(reply, "card", await serializeCardWithLinks(card));
    return service.remove(card, user?.id);
  });

  app.post("/api/cards/:cardId/move", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const body = moveCardSchema.parse(request.body);
    if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
    if (!(await policy.requireList(request, reply, body.listId, "contribute"))) return;
    const destination = await prisma.boardList.findUnique({ where: { id: body.listId }, select: { archived: true, board: { select: { archived: true } } } });
    if (!destination || destination.archived || destination.board?.archived) return reply.code(409).send({ ok: false, code: "LIST_ARCHIVED", error: "Restore the destination Board and column before moving work." });
    const oldCard = await repository.findCardForMove(cardId);
    if (!oldCard) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Card not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== oldCard.revision) return sendRevisionConflict(reply, "card", await serializeCardWithLinks(oldCard));
    const result = await service.move(oldCard, body, user?.id);
    if ("conflict" in result) return sendRevisionConflict(reply, "card", result.conflict ? await serializeCardWithLinks(result.conflict) : null);
    const projectId = result.card?.list?.board?.projectId || null;
    if (projectId) await emitProjectDeliveryAutomationSignals({ prisma, logActivity, projectId, actorId: user?.id || null }).catch(() => undefined);
    return serializeCardWithLinks(result.card);
  });

  app.post("/api/cards/:cardId/checklist", async (request, reply) => {
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const { text } = createChecklistItemSchema.parse(request.body);
    if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
    return service.addChecklistItem(cardId, text);
  });

  app.patch("/api/checklist/:itemId", async (request, reply) => {
    const { itemId } = checklistItemParamsSchema.parse(request.params);
    const body = updateChecklistItemSchema.parse(request.body);
    const item = await repository.findChecklistItem(itemId);
    if (!item) return apiError(request, reply, 404, "NOT_FOUND", "Checklist item not found.");
    if (!(await policy.requireCard(request, reply, item.cardId, "contribute"))) return;
    return repository.updateChecklistItem(itemId, body);
  });

  app.post("/api/checklist/:itemId/promote", async (request, reply) => {
    const user = await getCurrentUser(request);
    const { itemId } = checklistItemParamsSchema.parse(request.params);
    const body = promoteChecklistItemSchema.parse(request.body || {});
    const item = await repository.findChecklistItemForPromotion(itemId);
    if (!item) return apiError(request, reply, 404, "NOT_FOUND", "Checklist item not found.");
    if (!(await policy.requireCard(request, reply, item.cardId, "contribute"))) return;
    const targetListId = body.targetListId || item.card.listId;
    if (!(await policy.requireList(request, reply, targetListId, "contribute"))) return;
    const targetList = await repository.findPromotionTargetList(targetListId);
    if (!targetList) return apiError(request, reply, 404, "NOT_FOUND", "Target column not found.");
    if (targetList.board.projectId !== item.card.list.board.projectId) return apiError(request, reply, 400, "VALIDATION_FAILED", "Checklist items can only be promoted within the same project.");
    const promoted = await repository.promoteChecklistItem(item, targetList, user?.id);
    await logActivity({ userId: user?.id, projectId: item.card.list.board.projectId, boardId: targetList.boardId, cardId: promoted.id, type: "created", entityType: "card", entityId: promoted.id, title: "Checklist item promoted", message: promoted.title, metadata: { parentCardId: item.card.id, checklistItemId: item.id } });
    collaborationRuntime.scheduleBroadcast("board", item.card.list.boardId, true);
    if (targetList.boardId !== item.card.list.boardId) collaborationRuntime.scheduleBroadcast("board", targetList.boardId, true);
    return serializeCardWithLinks(promoted);
  });

  app.delete("/api/checklist/:itemId", async (request, reply) => {
    const { itemId } = checklistItemParamsSchema.parse(request.params);
    const item = await repository.findChecklistItem(itemId);
    if (!item) return apiError(request, reply, 404, "NOT_FOUND", "Checklist item not found.");
    if (!(await policy.requireCard(request, reply, item.cardId, "contribute"))) return;
    await repository.deleteChecklistItem(itemId);
    return { ok: true };
  });

  app.post("/api/cards/:cardId/comments", async (request, reply) => {
    const { cardId } = cardIdParamsSchema.parse(request.params);
    const { body } = createCardCommentSchema.parse(request.body);
    if (!(await policy.requireCard(request, reply, cardId, "contribute"))) return;
    const user = await getCurrentUser(request);
    return service.addComment(cardId, user?.id ?? null, body);
  });
}
