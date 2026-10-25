import type { ClusterWorkflowRelationship } from "./workflow-contracts.js";

export type BoardPlanningDependency = {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  relationship: ClusterWorkflowRelationship;
  description?: string | null;
  critical: boolean;
  blocking: boolean;
};

export type BoardPlanningProjection = {
  relationshipId: string;
  cardId: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent" | string;
  dueDate?: string | null;
  deferredUntil?: string | null;
  stateEnteredAt?: string | null;
  estimatePoints?: number | null;
  assigneeId?: string | null;
  assigneeLabel?: string | null;
  owningBoardId: string;
  owningBoardName: string;
  owningListId: string;
  owningListTitle: string;
  owningListDone: boolean;
};

export type BoardPlanningActivityPoint = {
  date: string;
  count: number;
};

export type BoardPlanningPayload = {
  boardId: string;
  projectId: string;
  generatedAt: string;
  dependencies: BoardPlanningDependency[];
  projections: BoardPlanningProjection[];
  activity: BoardPlanningActivityPoint[];
};
