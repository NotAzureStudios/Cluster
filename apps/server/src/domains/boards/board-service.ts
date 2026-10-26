import type { CollaborationTool } from "../../core/collaboration-runtime.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { BoardRepository } from "./board-repository.js";
import type { CreateBoardInput, CreateListInput, UpdateBoardInput, UpdateListInput } from "./board-schemas.js";

export type BoardServiceDependencies = {
  repository: BoardRepository;
  defaultBoardColumnsForProjectType: (type: string, productionProfile?: string | null) => string[];
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  scheduleBroadcast: (tool: CollaborationTool, id: string, immediate?: boolean) => void;
  logInfo: (data: Record<string, unknown>, message: string) => void;
};

export function createBoardService(deps: BoardServiceDependencies) {
  const { repository, defaultBoardColumnsForProjectType, logActivity, scheduleBroadcast, logInfo } = deps;

  return {
    async create(project: any, body: CreateBoardInput, userId?: string | null) {
      const count = await repository.countActiveBoards(project.id);
      const board = await repository.createBoard(
        project.id,
        body,
        body.template === "project-default"
          ? defaultBoardColumnsForProjectType(project.projectType || "general", project.productionProfile)
          : (body.columns ?? []),
      );
      logInfo({ projectId: project.id, boardId: board.id, boardCount: count + 1 }, "created board");
      await logActivity({ userId, projectId: project.id, boardId: board.id, type: "created", entityType: "board", entityId: board.id, title: "Board created", message: board.name });
      return board;
    },
    async update(existing: any, body: UpdateBoardInput, userId?: string | null) {
      const result = await repository.updateBoard(existing.id, existing.revision, body);
      if (!result.count) return { conflict: await repository.findBoardForMutation(existing.id) };
      const board = await repository.findUpdatedBoard(existing.id);
      await logActivity({ userId, projectId: board.projectId, boardId: board.id, type: body.archived ? "archived" : "updated", entityType: "board", entityId: board.id, title: body.archived ? "Board archived" : "Board updated", message: board.name, metadata: { revision: board.revision } });
      scheduleBroadcast("board", board.id, true);
      return { board };
    },
    async remove(board: any, userId?: string | null) {
      try { await repository.deleteBoard(board); }
      catch (error) {
        if ((error as any)?.code === "P2025") return { conflict: await repository.findBoardForMutation(board.id) };
        throw error;
      }
      await logActivity({ userId, projectId: board.projectId, boardId: board.id, type: "deleted", entityType: "board", entityId: board.id, title: "Board deleted", message: board.name || board.id });
      return { ok: true };
    },
    async createList(boardId: string, body: CreateListInput, userId?: string | null) {
      const last = await repository.findLastList(boardId);
      const list = await repository.createList(boardId, body, last ? last.position + 1 : 0);
      await logActivity({ userId, projectId: list.board.projectId, boardId, type: "created", entityType: "list", entityId: list.id, title: "List created", message: list.title });
      scheduleBroadcast("board", boardId, true);
      return list;
    },
    async updateList(existing: any, body: UpdateListInput, userId?: string | null) {
      const result = await repository.updateList(existing.id, existing.revision, body, userId);
      if (!result.count) return { conflict: await repository.findListForMutation(existing.id) };
      const list = await repository.findUpdatedList(existing.id);
      await logActivity({ userId, projectId: list.board.projectId, boardId: list.boardId, type: "updated", entityType: "list", entityId: list.id, title: "Column updated", message: list.title, metadata: { revision: list.revision } });
      scheduleBroadcast("board", list.boardId, true);
      return { list };
    },
    async reorderList(list: any, direction: "left" | "right", userId?: string | null) {
      const siblings = await repository.findListSiblings(list.boardId);
      const currentIndex = siblings.findIndex((item: any) => item.id === list.id);
      const target = siblings[direction === "left" ? currentIndex - 1 : currentIndex + 1];
      if (!target) return { ok: true, skipped: true };
      if (!(await repository.swapListPositions(list, target, userId))) return { ok: false, conflict: true };
      await logActivity({ userId, projectId: list.board.projectId, boardId: list.boardId, type: "moved", entityType: "list", entityId: list.id, title: "Column moved", message: `${list.title} moved ${direction}` });
      scheduleBroadcast("board", list.boardId, true);
      return { ok: true };
    },
    async removeList(list: any, userId?: string | null) {
      try { await repository.deleteList(list); }
      catch (error) {
        if ((error as any)?.code === "P2025") return { conflict: await repository.findListForMutation(list.id) };
        throw error;
      }
      await logActivity({ userId, projectId: list.board.projectId, boardId: list.boardId, type: "deleted", entityType: "list", entityId: list.id, title: "Column deleted", message: `${list.title || list.id} (${list.cards.length || 0} cards)` });
      scheduleBroadcast("board", list.boardId, true);
      return { ok: true };
    },
  };
}

export type BoardService = ReturnType<typeof createBoardService>;
