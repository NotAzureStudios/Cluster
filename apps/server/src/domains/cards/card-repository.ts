import { commitSavedCardUpdate } from "./card-saved-history.js";
import type { CreateCardInput, UpdateCardInput } from "./card-schemas.js";

const cardDetailInclude = {
  checklistItems: { orderBy: { position: "asc" } },
  comments: { orderBy: { createdAt: "desc" }, include: { user: true } },
  activity: { orderBy: { createdAt: "desc" }, take: 25 },
  assignee: true,
  list: { include: { board: true } },
};

export function createCardRepository(prisma: any) {
  return {
    findLastCard(listId: string, excludeId?: string) {
      return prisma.card.findFirst({
        where: { listId, archived: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
        orderBy: { position: "desc" },
      });
    },
    async createCard(body: CreateCardInput, position: number) {
      const targetList = await prisma.boardList.findUnique({ where: { id: body.listId }, select: { isDone: true, archived: true, board: { select: { archived: true } } } });
      if (!targetList || targetList.archived || targetList.board?.archived) throw new Error("LIST_ARCHIVED: Restore the destination column before adding work.");
      return prisma.card.create({
        data: {
          listId: body.listId,
          title: body.title,
          description: body.description,
          priority: body.priority,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          deferredUntil: body.deferredUntil ? new Date(body.deferredUntil) : null,
          completionCriteria: body.completionCriteria?.trim() || null,
          labels: JSON.stringify(body.labels),
          category: body.category || null,
          coverColor: body.coverColor || null,
          coverImage: body.coverImage || null,
          estimatePoints: body.estimatePoints ?? null,
          memberIds: JSON.stringify(body.memberIds || []),
          watcherIds: JSON.stringify(body.watcherIds || []),
          assigneeId: body.assigneeId || null,
          externalUrl: body.externalUrl || null,
          completedAt: targetList?.isDone ? new Date() : null,
          stateEnteredAt: new Date(),
          position,
          activity: { create: { type: "created", message: "Card created" } },
        },
        include: cardDetailInclude,
      });
    },
    findCardForUpdate(cardId: string) {
      return prisma.card.findUnique({ where: { id: cardId }, include: cardDetailInclude });
    },
    async duplicateCard(cardId: string, title?: string) {
      const source = await prisma.card.findUnique({ where: { id: cardId }, include: { ...cardDetailInclude, checklistItems: { orderBy: { position: "asc" } } } });
      if (!source) return null;
      if (source.list?.archived || source.list?.board?.archived) throw new Error("LIST_ARCHIVED: Restore the source column before duplicating work.");
      const last = await prisma.card.findFirst({ where: { listId: source.listId, archived: false }, orderBy: { position: "desc" } });
      return prisma.card.create({
        data: {
          listId: source.listId, title: (title || `${source.title} copy`).slice(0, 240), description: source.description, priority: source.priority, workItemKind: source.workItemKind, ticketStage: source.workItemKind === "ticket" ? "new" : null, dueDate: source.dueDate, startDate: source.startDate, deferredUntil: source.deferredUntil, completionCriteria: source.completionCriteria, labels: source.labels, category: source.category, coverColor: source.coverColor, coverImage: source.coverImage, estimatePoints: source.estimatePoints, memberIds: source.memberIds, watcherIds: source.watcherIds, assigneeId: source.assigneeId, externalUrl: source.externalUrl, completedAt: source.workItemKind === "ticket" ? null : source.list.isDone ? new Date() : null, stateEnteredAt: new Date(), position: last ? last.position + 1 : 0,
          checklistItems: { create: source.checklistItems.map((item: any) => ({ text: item.text, completed: item.completed, position: item.position })) },
          activity: { create: { type: "created", message: `Duplicated from ${source.title}` } },
        },
        include: cardDetailInclude,
      });
    },
    updateCard(cardId: string, revision: number, body: UpdateCardInput, actorUserId?: string | null) {
      return commitSavedCardUpdate(prisma, cardId, revision, {
          title: body.title,
          description: body.description,
          priority: body.priority,
          ticketStage: body.ticketStage,
          dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
          startDate: body.startDate === undefined ? undefined : body.startDate ? new Date(body.startDate) : null,
          deferredUntil: body.deferredUntil === undefined ? undefined : body.deferredUntil ? new Date(body.deferredUntil) : null,
          completionCriteria: body.completionCriteria === undefined ? undefined : body.completionCriteria?.trim() || null,
          labels: body.labels ? JSON.stringify(body.labels) : undefined,
          category: body.category,
          coverColor: body.coverColor,
          coverImage: body.coverImage,
          estimatePoints: body.estimatePoints,
          memberIds: body.memberIds ? JSON.stringify(body.memberIds) : undefined,
          watcherIds: body.watcherIds ? JSON.stringify(body.watcherIds) : undefined,
          assigneeId: body.assigneeId === undefined ? undefined : body.assigneeId || null,
          externalUrl: body.externalUrl,
          archived: body.archived,
        }, actorUserId);
    },
    addActivity(cardId: string, type: string, message: string) {
      return prisma.cardActivity.create({ data: { cardId, type, message } });
    },
    findCardForDelete(cardId: string) {
      return prisma.card.findUnique({ where: { id: cardId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
    },
    deleteCard(card: any) {
      return prisma.$transaction([
        prisma.syncTombstone.create({ data: { workspaceId: card.list.board.project.workspaceId, projectId: card.list.board.projectId, parentEntityId: card.list.boardId, entityType: "card", entityId: card.id } }),
        prisma.card.delete({ where: { id: card.id } }),
      ]);
    },
    findCardForMove(cardId: string) {
      return prisma.card.findUnique({
        where: { id: cardId },
        include: { list: true, checklistItems: true, comments: { include: { user: true } }, activity: true, assignee: true },
      });
    },
    moveCard(cardId: string, revision: number, listId: string, position: number) {
      return prisma.$transaction(async (tx: any) => {
        const [current, targetList] = await Promise.all([
          tx.card.findUnique({ where: { id: cardId }, select: { id: true, listId: true, revision: true, completedAt: true } }),
          tx.boardList.findUnique({ where: { id: listId }, select: { id: true, isDone: true, archived: true, board: { select: { archived: true } } } }),
        ]);
        if (!current || current.revision !== revision || !targetList || targetList.archived || targetList.board?.archived) return { count: 0 };
        const changedState = current.listId !== listId;
        return tx.card.updateMany({
          where: { id: cardId, revision },
          data: {
            listId,
            position,
            ...(changedState ? { stateEnteredAt: new Date(), completedAt: targetList.isDone ? (current.completedAt || new Date()) : null } : {}),
            revision: { increment: 1 },
          },
        });
      });
    },
    moveCardAtIndex(cardId: string, revision: number, listId: string, index: number) {
      return prisma.$transaction(async (tx: any) => {
        const [current, targetList] = await Promise.all([
          tx.card.findUnique({ where: { id: cardId }, select: { id: true, listId: true, revision: true, completedAt: true } }),
          tx.boardList.findUnique({ where: { id: listId }, select: { id: true, isDone: true, archived: true, board: { select: { archived: true } } } }),
        ]);
        if (!current || current.revision !== revision || !targetList || targetList.archived || targetList.board?.archived) return { count: 0 };
        const previousListId = current.listId;
        const changedState = previousListId !== listId;
        const targetRows = await tx.card.findMany({ where: { listId, archived: false, id: { not: cardId } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
        const targetIndex = Math.max(0, Math.min(index, targetRows.length));
        const updated = await tx.card.updateMany({ where: { id: cardId, revision }, data: { listId, ...(changedState ? { stateEnteredAt: new Date(), completedAt: targetList.isDone ? (current.completedAt || new Date()) : null } : {}), revision: { increment: 1 } } });
        if (!updated.count) return updated;
        const targetOrder = targetRows.map((row: any) => row.id);
        targetOrder.splice(targetIndex, 0, cardId);
        await Promise.all(targetOrder.map((id: string, position: number) => tx.card.update({ where: { id }, data: { position } })));
        if (previousListId !== listId) {
          const previousRows = await tx.card.findMany({ where: { listId: previousListId, archived: false }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
          await Promise.all(previousRows.map((row: any, position: number) => tx.card.update({ where: { id: row.id }, data: { position } })));
        }
        return updated;
      });
    },
    createChecklistItem(cardId: string, text: string, position: number) {
      return prisma.checklistItem.create({ data: { cardId, text, position } });
    },
    findLastChecklistItem(cardId: string) {
      return prisma.checklistItem.findFirst({ where: { cardId }, orderBy: { position: "desc" } });
    },
    findChecklistItem(itemId: string) {
      return prisma.checklistItem.findUnique({ where: { id: itemId }, select: { cardId: true } });
    },
    findChecklistItemForPromotion(itemId: string) {
      return prisma.checklistItem.findUnique({
        where: { id: itemId },
        include: { card: { include: { list: { include: { board: true } } } } },
      });
    },
    findPromotionTargetList(listId: string) {
      return prisma.boardList.findUnique({ where: { id: listId }, include: { board: true } });
    },
    promoteChecklistItem(item: any, targetList: any, createdById?: string | null) {
      return prisma.$transaction(async (tx: any) => {
        const last = await tx.card.findFirst({ where: { listId: targetList.id, archived: false }, orderBy: { position: "desc" } });
        const source = item.card;
        const promoted = await tx.card.create({
          data: {
            listId: targetList.id,
            title: String(item.text || "Checklist item").slice(0, 240),
            description: `Promoted from checklist on ${source.title}.`,
            priority: source.priority,
            dueDate: source.dueDate,
            startDate: null,
            deferredUntil: null,
            completionCriteria: null,
            labels: source.labels,
            category: source.category,
            estimatePoints: null,
            memberIds: source.memberIds,
            watcherIds: source.watcherIds,
            assigneeId: source.assigneeId,
            externalUrl: null,
            position: last ? last.position + 1 : 0,
            completedAt: targetList.isDone ? new Date() : null,
            stateEnteredAt: new Date(),
            activity: { create: { type: "created", message: `Promoted from ${source.title}` } },
          },
          include: cardDetailInclude,
        });
        await tx.projectRelationship.create({ data: {
          projectId: source.list.board.projectId,
          sourceType: "card", sourceId: source.id,
          targetType: "card", targetId: promoted.id,
          relationship: "parent_of",
          description: `Promoted checklist item: ${item.text}`,
          critical: false, createdById: createdById || null,
        } });
        await tx.checklistItem.update({ where: { id: item.id }, data: { completed: true } });
        await tx.cardActivity.create({ data: { cardId: source.id, type: "promoted", message: `Promoted checklist item to Card: ${item.text}` } });
        return promoted;
      });
    },
    updateChecklistItem(itemId: string, data: Record<string, unknown>) {
      return prisma.checklistItem.update({ where: { id: itemId }, data });
    },
    deleteChecklistItem(itemId: string) {
      return prisma.checklistItem.delete({ where: { id: itemId } });
    },
    createComment(cardId: string, userId: string | null, body: string) {
      return prisma.cardComment.create({
        data: { cardId, userId, body },
        include: { user: true, card: { include: { list: { include: { board: true } } } } },
      });
    },
  };
}

export type CardRepository = ReturnType<typeof createCardRepository>;
