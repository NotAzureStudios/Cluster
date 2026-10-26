import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { runtimeStyle } from "../../core/runtime-style";
import type { BoardList, Priority, Project } from "../application/application-models";
import type { BoardIssueFilter, BoardSortMode, BoardViewPreset } from "./board-workspace-model";
import type { BoardViewMode } from "./BoardAlternativeViews";

export const BOARD_CARD_RENDER_BATCH = 120;
export type BoardGroupMode = "none" | "assignee" | "priority" | "category";

export type BoardSavedView = {
  id: string;
  name: string;
  viewMode: BoardViewMode;
  viewPreset: BoardViewPreset;
  priorityFilter: "all" | Priority;
  labelFilter: string;
  categoryFilter: string;
  issueFilter: BoardIssueFilter;
  assigneeFilter: string;
  sortMode: BoardSortMode;
  hideDone: boolean;
  hideEmptyLists: boolean;
  laneWidth: "narrow" | "standard" | "wide";
  density: "compact" | "comfortable";
  groupMode: BoardGroupMode;
};

export type BoardSharedViewRecord = BoardSavedView & {
  projectId: string;
  boardId: string;
  ownerId: string;
  scope: "project";
  shared: true;
  createdAt?: string;
  updatedAt?: string;
};

export function boardSavedViewName(view: Omit<BoardSavedView, "id" | "name">, index: number) {
  const parts: string[] = [];
  if (view.viewPreset !== "all") parts.push(view.viewPreset === "mine" ? "My cards" : view.viewPreset[0].toUpperCase() + view.viewPreset.slice(1));
  if (view.priorityFilter !== "all") parts.push(`${view.priorityFilter[0].toUpperCase()}${view.priorityFilter.slice(1)} priority`);
  if (view.labelFilter) parts.push(view.labelFilter);
  if (view.categoryFilter) parts.push(view.categoryFilter);
  if (view.assigneeFilter) parts.push("Assigned view");
  if (view.hideDone) parts.push("Active only");
  if (view.groupMode !== "none") parts.push(`By ${view.groupMode}`);
  const mode = view.viewMode === "kanban" ? "Board" : view.viewMode[0].toUpperCase() + view.viewMode.slice(1);
  parts.push(mode);
  return parts.slice(0, 3).join(" · ") || `View ${index + 1}`;
}

export function toDateInputValue(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function boardOptions(projects: Project[]) {
  return projects.flatMap((project) => project.boards.map((board) => ({ ...board, projectId: project.id, projectName: project.name })));
}

export function DroppableList({ list, children, collapsed = false }: { list: BoardList; children: ReactNode; collapsed?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `list:${list.id}` });
  const style = runtimeStyle({ "--column-accent": list.color || "var(--cluster-blue-500)" });
  return <section ref={setNodeRef} style={style} className={`board-list ${isOver ? "is-over" : ""} ${list.isDone ? "done-column" : ""} ${collapsed ? "collapsed-column" : ""}`}>{children}</section>;
}
