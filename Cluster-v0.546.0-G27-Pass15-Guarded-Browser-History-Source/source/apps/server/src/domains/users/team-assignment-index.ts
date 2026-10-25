type RelationshipEvidence = { total: number; blockers: number; critical: number; labels: string[] };

type ParseIds = (value: unknown) => string[];
type RelationshipSummary = (...keys: string[]) => RelationshipEvidence | undefined;

export type TeamAssignmentResourceIndexes = {
  projectsByUser: Map<string, any[]>;
  boardsByUser: Map<string, any[]>;
  columnsByUser: Map<string, any[]>;
  cardsByUser: Map<string, any[]>;
  calendarByUser: Map<string, any[]>;
  scheduleByUser: Map<string, any[]>;
};

function pushUserResource<T>(index: Map<string, T[]>, userId: string | null | undefined, item: T) {
  if (!userId) return;
  const rows = index.get(userId);
  if (rows) rows.push(item);
  else index.set(userId, [item]);
}

export function parseTeamAssignmentIdList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function buildTeamAssignmentResourceIndexes(input: {
  projects: any[];
  boards: any[];
  lists: any[];
  cards: any[];
  calendarEvents: any[];
  scheduleBlocks: any[];
  parseAssignedIds: ParseIds;
  relationshipSummary: RelationshipSummary;
}): TeamAssignmentResourceIndexes {
  const { projects, boards, lists, cards, calendarEvents, scheduleBlocks, parseAssignedIds, relationshipSummary } = input;
  const projectsByUser = new Map<string, any[]>();
  const boardsByUser = new Map<string, any[]>();
  const columnsByUser = new Map<string, any[]>();
  const cardsByUser = new Map<string, any[]>();
  const calendarByUser = new Map<string, any[]>();
  const scheduleByUser = new Map<string, any[]>();

  for (const project of projects) {
    const row = { id: project.id, name: project.name };
    for (const membership of Array.isArray(project.memberships) ? project.memberships : []) pushUserResource(projectsByUser, String(membership.userId || ""), row);
  }
  for (const board of boards) {
    const row = { id: board.id, name: board.name, projectName: board.project.name };
    for (const userId of parseAssignedIds(board.assignedUserIds)) pushUserResource(boardsByUser, userId, row);
  }
  for (const list of lists) {
    const row = { id: list.id, title: list.title, boardName: list.board.name, projectName: list.board.project.name };
    for (const userId of parseAssignedIds(list.assignedUserIds)) pushUserResource(columnsByUser, userId, row);
  }
  for (const card of cards) {
    if (!card.assigneeId) continue;
    const ticket = card.workItemKind === "ticket";
    pushUserResource(cardsByUser, card.assigneeId, {
      id: card.id,
      title: card.title,
      priority: card.priority,
      dueDate: card.dueDate,
      boardId: card.list.board.id,
      projectId: card.list.board.project.id,
      boardName: card.list.board.name,
      projectName: card.list.board.project.name,
      isTicket: ticket,
      relationshipSummary: relationshipSummary(`card:${card.id}`, `ticket:${card.id}`),
    });
  }
  for (const event of calendarEvents) {
    const attendeeIds = parseTeamAssignmentIdList(event.attendeeIds);
    const row = {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      projectId: event.projectId,
      projectName: event.project?.name || null,
      ownerId: event.ownerId,
      attendeeIds,
      relationshipSummary: relationshipSummary(`calendar:${event.id}`),
    };
    const userIds = new Set<string>([...(event.ownerId ? [event.ownerId] : []), ...attendeeIds]);
    for (const userId of userIds) pushUserResource(calendarByUser, userId, row);
  }
  for (const block of scheduleBlocks) {
    const row = {
      id: block.id,
      title: block.title,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      projectId: block.projectId,
      projectName: block.project?.name || null,
      boardId: block.boardId,
      cardId: block.cardId,
      relationshipSummary: relationshipSummary(`scheduler:${block.id}`),
    };
    const userIds = new Set<string>([...(block.userId ? [block.userId] : []), ...parseTeamAssignmentIdList(block.participantIds)]);
    for (const userId of userIds) pushUserResource(scheduleByUser, userId, row);
  }

  return { projectsByUser, boardsByUser, columnsByUser, cardsByUser, calendarByUser, scheduleByUser };
}
