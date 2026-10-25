import {
  CLUSTER_WORKFLOW_RELATIONSHIP_META,
  type BoardPlanningActivityPoint,
  type BoardPlanningDependency,
  type BoardPlanningPayload,
  type BoardPlanningProjection,
  type ClusterWorkflowRelationship,
} from "@cluster/shared";

const PLANNING_RELATIONSHIPS = new Set<ClusterWorkflowRelationship>([
  "relates_to",
  "blocks",
  "blocked_by",
  "depends_on",
  "parent_of",
  "ships_in",
  "supersedes",
  "duplicates",
]);

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function activityWindow(days = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (days - 1 - index));
    return day;
  });
}

export async function findBoardProjectionRelationships(prisma: any, projectId: string, boardId: string) {
  return prisma.projectRelationship.findMany({
    where: {
      projectId,
      sourceType: "board",
      sourceId: boardId,
      targetType: "card",
      relationship: "tracks",
    },
    orderBy: [{ critical: "desc" }, { createdAt: "desc" }],
    take: 250,
  });
}

export async function findBoardProjectionCards(prisma: any, projectId: string, relationships: any[]) {
  const ids = Array.from(new Set(relationships.map((row: any) => String(row.targetId || "")).filter(Boolean)));
  if (!ids.length) return [];
  return prisma.card.findMany({
    where: { id: { in: ids }, archived: false, list: { board: { projectId } } },
    include: { assignee: true, list: { include: { board: true } } },
  });
}

export async function buildBoardPlanningPayload(input: {
  prisma: any;
  boardId: string;
  projectId: string;
  visibleCardIds: string[];
  projectionRelationships: any[];
  visibleProjectionCards: any[];
}): Promise<BoardPlanningPayload> {
  const { prisma, boardId, projectId, visibleCardIds, projectionRelationships, visibleProjectionCards } = input;
  const projectedIds = visibleProjectionCards.map((card) => card.id);
  const allVisibleIds = Array.from(new Set([...visibleCardIds, ...projectedIds]));
  const idSet = new Set(allVisibleIds);
  const [relationships, activityRows] = await Promise.all([
    allVisibleIds.length
      ? prisma.projectRelationship.findMany({
          where: {
            projectId,
            OR: [
              { sourceType: "card", sourceId: { in: allVisibleIds }, targetType: "card" },
              { targetType: "card", targetId: { in: allVisibleIds }, sourceType: "card" },
            ],
          },
          orderBy: [{ critical: "desc" }, { createdAt: "desc" }],
          take: 500,
        })
      : [],
    visibleCardIds.length
      ? prisma.cardActivity.findMany({
          where: { cardId: { in: visibleCardIds }, createdAt: { gte: activityWindow(14)[0] } },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 5000,
        })
      : [],
  ]);

  const dependencies: BoardPlanningDependency[] = relationships.flatMap((row: any) => {
    const relationship = row.relationship as ClusterWorkflowRelationship;
    if (!PLANNING_RELATIONSHIPS.has(relationship)) return [];
    if (!idSet.has(row.sourceId) || !idSet.has(row.targetId)) return [];
    const meta = CLUSTER_WORKFLOW_RELATIONSHIP_META[relationship];
    return [{
      id: row.id,
      sourceCardId: row.sourceId,
      targetCardId: row.targetId,
      relationship,
      description: row.description || null,
      critical: Boolean(row.critical),
      blocking: Boolean(meta?.blocking),
    }];
  });

  const projectionByCard = new Map(projectionRelationships.map((row: any) => [String(row.targetId), row]));
  const projections: BoardPlanningProjection[] = visibleProjectionCards
    .filter((card) => card.list?.board?.id !== boardId)
    .map((card) => ({
      relationshipId: projectionByCard.get(card.id)?.id || "",
      cardId: card.id,
      title: card.title,
      priority: card.priority,
      dueDate: card.dueDate?.toISOString?.() || card.dueDate || null,
      deferredUntil: card.deferredUntil?.toISOString?.() || card.deferredUntil || null,
      stateEnteredAt: card.stateEnteredAt?.toISOString?.() || card.stateEnteredAt || null,
      estimatePoints: card.estimatePoints ?? null,
      assigneeId: card.assigneeId || null,
      assigneeLabel: card.assignee?.displayName || card.assignee?.username || null,
      owningBoardId: card.list.board.id,
      owningBoardName: card.list.board.name,
      owningListId: card.list.id,
      owningListTitle: card.list.title,
      owningListDone: Boolean(card.list.isDone),
    }));

  const counts = new Map<string, number>();
  activityRows.forEach((row: any) => counts.set(isoDay(row.createdAt), (counts.get(isoDay(row.createdAt)) || 0) + 1));
  const activity: BoardPlanningActivityPoint[] = activityWindow(14).map((day) => ({ date: isoDay(day), count: counts.get(isoDay(day)) || 0 }));

  return { boardId, projectId, generatedAt: new Date().toISOString(), dependencies, projections, activity };
}
