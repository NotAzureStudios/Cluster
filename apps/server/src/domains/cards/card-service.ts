import type { CollaborationTool } from "../../core/collaboration-runtime.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { CardRepository } from "./card-repository.js";
import type { CreateCardInput, MoveCardInput, UpdateCardInput } from "./card-schemas.js";
import { workAssignmentActivity } from "../work/work-assignment.js";

export type CardServiceDependencies = {
  repository: CardRepository;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  scheduleBroadcast: (tool: CollaborationTool, id: string, immediate?: boolean) => void;
};


function cardWorkKind(card: any): "card" | "ticket" {
  return card?.workItemKind === "ticket" ? "ticket" : "card";
}

export function createCardService(deps: CardServiceDependencies) {
  const { repository, logActivity, scheduleBroadcast } = deps;

  return {
    async create(body: CreateCardInput, userId?: string | null) {
      const last = await repository.findLastCard(body.listId);
      const card = await repository.createCard(body, last ? last.position + 1 : 0);
      await logActivity({ userId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, type: "created", entityType: "card", entityId: card.id, title: "Card created", message: card.title, metadata: { priority: card.priority, list: card.list.title } });
      const assignment = workAssignmentActivity({ actorUserId: userId, source: { kind: cardWorkKind(card), id: card.id, projectId: card.list.board.projectId, label: card.title }, assigneeId: card.assigneeId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, dueAt: card.dueDate });
      if (assignment) await logActivity(assignment);
      scheduleBroadcast("board", card.list.boardId, true);
      return card;
    },
    async duplicate(cardId: string, title: string | undefined, userId?: string | null) {
      const card = await repository.duplicateCard(cardId, title);
      if (!card) return null;
      await logActivity({ userId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, type: "created", entityType: "card", entityId: card.id, title: "Card duplicated", message: card.title });
      scheduleBroadcast("board", card.list.boardId, true);
      return card;
    },
    async update(existing: any, body: UpdateCardInput, userId?: string | null) {
      const result = await repository.updateCard(existing.id, existing.revision, body, userId);
      if (!result.count) return { conflict: await repository.findCardForUpdate(existing.id) };
      await repository.addActivity(existing.id, "updated", "Card updated");
      const card = await repository.findCardForUpdate(existing.id);
      await logActivity({ userId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, type: body.archived ? "archived" : "updated", entityType: "card", entityId: card.id, title: body.archived ? "Card archived" : "Card updated", message: card.title, metadata: { revision: card.revision, previousPriority: existing.priority, priority: card.priority } });
      if (body.assigneeId !== undefined) {
        const assignment = workAssignmentActivity({ actorUserId: userId, source: { kind: cardWorkKind(card), id: card.id, projectId: card.list.board.projectId, label: card.title }, previousAssigneeId: existing.assigneeId, assigneeId: card.assigneeId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, dueAt: card.dueDate });
        if (assignment) await logActivity(assignment);
      }
      scheduleBroadcast("board", card.list.boardId, true);
      return { card };
    },
    async remove(card: any, userId?: string | null) {
      await repository.deleteCard(card);
      await logActivity({ userId, projectId: card.list.board.projectId, boardId: card.list.boardId, cardId: card.id, type: "deleted", entityType: "card", entityId: card.id, title: "Card deleted", message: card.title || card.id });
      scheduleBroadcast("board", card.list.boardId, true);
      return { ok: true };
    },
    async move(oldCard: any, body: MoveCardInput, userId?: string | null) {
      const last = body.index === undefined ? await repository.findLastCard(body.listId, oldCard.id) : null;
      const result = body.index === undefined
        ? await repository.moveCard(oldCard.id, oldCard.revision, body.listId, last ? last.position + 1 : 0)
        : await repository.moveCardAtIndex(oldCard.id, oldCard.revision, body.listId, body.index);
      if (!result.count) return { conflict: await repository.findCardForUpdate(oldCard.id) };
      await repository.addActivity(oldCard.id, "moved", `Moved from ${oldCard.list.title}`);
      const moved = await repository.findCardForUpdate(oldCard.id);
      await logActivity({ userId, projectId: moved.list.board.projectId, boardId: moved.list.boardId, cardId: moved.id, type: "moved", entityType: "card", entityId: moved.id, title: "Card moved", message: `${moved.title}: ${oldCard.list.title} → ${moved.list.title}`, metadata: { from: oldCard.list.title, to: moved.list.title, fromListId: oldCard.listId, toListId: moved.listId, revision: moved.revision } });
      scheduleBroadcast("board", moved.list.boardId, true);
      return { card: moved };
    },
    async addChecklistItem(cardId: string, text: string) {
      const last = await repository.findLastChecklistItem(cardId);
      return repository.createChecklistItem(cardId, text, last ? last.position + 1 : 0);
    },
    async addComment(cardId: string, userId: string | null, body: string) {
      const comment = await repository.createComment(cardId, userId, body);
      await repository.addActivity(cardId, "comment", "Comment added");
      await logActivity({ userId, projectId: comment.card.list.board.projectId, boardId: comment.card.list.boardId, cardId, type: "comment", entityType: "card", entityId: cardId, title: "Card commented", message: comment.card.title });
      scheduleBroadcast("board", comment.card.list.boardId, true);
      return comment;
    },
  };
}

export type CardService = ReturnType<typeof createCardService>;
