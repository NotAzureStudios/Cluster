import type { CreateBoardInput, CreateListInput, UpdateBoardInput, UpdateListInput } from "./board-schemas.js";
import { saveListWithHistory, swapBoardListsWithHistory } from "./board-list-saved-history.js";
import { permanentlyDeleteUnusedList } from "./board-list-lifecycle.js";

export function createBoardRepository(prisma: any) {
  const boardInclude = { project: { include: { memberships: { where: { status: "active" } } } }, lists: true };

  return {
    countActiveBoards(projectId: string) {
      return prisma.board.count({ where: { projectId, archived: false } });
    },
    findProject(projectId: string) {
      return prisma.project.findUnique({ where: { id: projectId } });
    },
    createBoard(projectId: string, body: CreateBoardInput, columns: string[]) {
      return prisma.board.create({
        data: {
          projectId,
          name: body.name,
          description: body.description || null,
          assignedUserIds: JSON.stringify(body.assignedUserIds || []),
          backgroundColor: body.backgroundColor || null,
          backgroundStyle: body.backgroundStyle || "soft",
          labelDefinitions: JSON.stringify(body.labelDefinitions || []),
          ...(columns.length ? { lists: {
            create: columns.map((title, position) => ({
              title,
              position,
              isDone: ["Done", "Approved", "Release", "Publish"].includes(title),
            })),
          } } : {}),
        },
        include: { lists: true },
      });
    },
    findBoardForMutation(boardId: string) {
      return prisma.board.findUnique({ where: { id: boardId }, include: boardInclude });
    },
    updateBoard(boardId: string, revision: number, body: UpdateBoardInput) {
      return prisma.board.updateMany({
        where: { id: boardId, revision },
        data: {
          name: body.name,
          description: body.description,
          assignedUserIds: body.assignedUserIds ? JSON.stringify(body.assignedUserIds) : undefined,
          backgroundColor: body.backgroundColor,
          backgroundStyle: body.backgroundStyle,
          labelDefinitions: body.labelDefinitions ? JSON.stringify(body.labelDefinitions) : undefined,
          archived: body.archived,
          revision: { increment: 1 },
        },
      });
    },
    findUpdatedBoard(boardId: string) {
      return prisma.board.findUniqueOrThrow({ where: { id: boardId }, include: { lists: true } });
    },
    deleteBoard(board: any) {
      // Board disposal also may not cascade through Tickets or historical Cards.
      return prisma.$transaction(async (tx: any) => {
        const count = await tx.card.count({ where: { list: { boardId: board.id } } });
        if (count) throw Object.assign(new Error("Archive or move the Board's Cards and Tickets first. Permanent deletion cannot destroy work."), { code: "BOARD_DELETE_BLOCKED" });
        const history = await tx.boardListSavedOperation.count({ where: { list: { boardId: board.id } } });
        if (history) throw Object.assign(new Error("This Board contains saved column history. Preserve its evidence instead of deleting the Board."), { code: "BOARD_DELETE_BLOCKED" });
        const removed = await tx.board.deleteMany({ where: { id: board.id, revision: board.revision } });
        if (!removed.count) throw Object.assign(new Error("Board changed before deletion."), { code: "P2025" });
        await tx.syncTombstone.create({ data: { workspaceId: board.project.workspaceId, projectId: board.projectId, entityType: "board", entityId: board.id } });
        return { ok: true };
      }, { isolationLevel: "Serializable" });
    },
    findLastList(boardId: string) {
      return prisma.boardList.findFirst({ where: { boardId, archived: false }, orderBy: { position: "desc" } });
    },
    createList(boardId: string, body: CreateListInput, position: number) {
      return prisma.boardList.create({
        data: {
          boardId,
          title: body.title,
          description: body.description ?? null,
          color: body.color ?? null,
          wipLimit: body.wipLimit ?? null,
          isDone: body.isDone ?? false,
          collapsed: body.collapsed ?? false,
          assignedUserIds: JSON.stringify(body.assignedUserIds || []),
          position,
        },
        include: { board: true },
      });
    },
    findListForMutation(listId: string) {
      return prisma.boardList.findUnique({ where: { id: listId }, include: { board: true, cards: true } });
    },
    updateList(listId: string, revision: number, body: UpdateListInput, actorUserId?: string | null) {
      return saveListWithHistory(prisma, listId, revision, body, actorUserId);
    },
    findUpdatedList(listId: string) {
      return prisma.boardList.findUniqueOrThrow({ where: { id: listId }, include: { board: true } });
    },
    findListForReorder(listId: string) {
      return prisma.boardList.findUniqueOrThrow({ where: { id: listId }, include: { board: true } });
    },
    findListSiblings(boardId: string) {
      return prisma.boardList.findMany({ where: { boardId, archived: false }, orderBy: { position: "asc" } });
    },
    swapListPositions(list: any, target: any, userId?: string | null): Promise<boolean> {
      return swapBoardListsWithHistory(prisma, list, target, userId);
    },
    findListForDelete(listId: string) {
      return prisma.boardList.findUnique({ where: { id: listId }, include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } }, cards: true } });
    },
    deleteList(list: any) {
      return permanentlyDeleteUnusedList(prisma, { listId: list.id, expectedRevision: list.revision,
        workspaceId: list.board.project.workspaceId, projectId: list.board.projectId, boardId: list.boardId });
    },
    findArchivedLists(boardId: string) {
      return prisma.boardList.findMany({ where: { boardId, archived: true }, orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, boardId: true, title: true, description: true, color: true, position: true, revision: true, archived: true } });
    },
    findArchivedCards(boardId: string) {
      return prisma.card.findMany({
        where: { archived: true, list: { boardId } },
        orderBy: { updatedAt: "desc" },
        take: 250,
        include: {
          checklistItems: { orderBy: { position: "asc" } },
          comments: { orderBy: { createdAt: "desc" }, include: { user: true } },
          activity: { orderBy: { createdAt: "desc" }, take: 25 },
          assignee: true,
          list: { include: { board: true } },
        },
      });
    },
    findBoardDetail(boardId: string) {
      return prisma.board.findUnique({
        where: { id: boardId },
        include: {
          project: { include: { memberships: { where: { status: "active" } } } },
          lists: {
            where: { archived: false },
            orderBy: { position: "asc" },
            include: {
              cards: {
                where: { archived: false },
                orderBy: { position: "asc" },
                include: {
                  checklistItems: { orderBy: { position: "asc" } },
                  comments: { orderBy: { createdAt: "desc" }, include: { user: true } },
                  activity: { orderBy: { createdAt: "desc" }, take: 25 },
                  assignee: true,
                },
              },
            },
          },
        },
      });
    },
  };
}

export type BoardRepository = ReturnType<typeof createBoardRepository>;
