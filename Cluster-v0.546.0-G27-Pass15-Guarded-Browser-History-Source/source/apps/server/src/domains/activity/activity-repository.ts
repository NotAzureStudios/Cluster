import { cursorWhere } from "../../core/cursor-pagination.js";
import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";
export function createActivityRepository(prisma: any) {
  const projectClientSelect = { id: true, name: true, source: true, status: true, archived: true } as const;
  const membershipSelect = { userId: true, roleKey: true, roleLabel: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true } as const;
  const projectAuthorizationSelect = {
    ...projectClientSelect,
    memberships: { where: { status: "active" }, select: membershipSelect },
  } as const;
  const include = {
    user: { select: { id: true, username: true, displayName: true, avatarUrl: true, discordUserId: true, lastSeenAt: true, workforceStatus: { select: { availability: true, connectionVisibility: true } } } },
    project: { select: projectAuthorizationSelect },
    board: { select: { id: true, projectId: true, name: true } },
    whiteboard: { select: { id: true, projectId: true, name: true } },
    card: {
      select: {
        id: true,
        title: true,
        workItemKind: true,
        list: { select: { board: { select: { id: true, project: { select: projectAuthorizationSelect } } } } },
      },
    },
  } as const;
  const listInclude = (authorizationUserId?: string | null, authorizationAdmin = false) => {
    const projectSelect: any = authorizationAdmin || !authorizationUserId
      ? { ...projectClientSelect }
      : { ...projectClientSelect, memberships: { where: { status: "active", userId: authorizationUserId }, select: membershipSelect } };
    return {
      user: include.user,
      project: { select: projectSelect },
      board: include.board,
      whiteboard: include.whiteboard,
      card: { select: { id: true, title: true, workItemKind: true, list: { select: { board: { select: { id: true, project: { select: projectSelect } } } } } } },
    };
  };

  return {
    create(input: any) {
      return prisma.activityEvent.create({
        data: {
          userId: input.userId ?? null,
          projectId: input.projectId ?? null,
          boardId: input.boardId ?? null,
          whiteboardId: input.whiteboardId ?? null,
          cardId: input.cardId ?? null,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          title: input.title,
          message: input.message ?? null,
          metadata: JSON.stringify(input.metadata ?? {}),
        },
        include,
      });
    },
    list(query: any, authorization: { userId?: string | null; admin?: boolean } = {}) {
      return prisma.activityEvent.findMany({
        where: {
          type: query.type || undefined,
          entityType: query.entityType || undefined,
          entityId: query.entityId || undefined,
          projectId: query.projectId || undefined,
          userId: query.userId || undefined,
          ...(cursorWhere(query.cursor || null, "createdAt", "desc") || {}),
        },
        include: listInclude(authorization.userId, Boolean(authorization.admin)),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      });
    },
    userSummaries(limit: number, includeActivitySummary = false) {
      return prisma.user.findMany({
        include: {
          ...WORKFORCE_USER_AUTHORITY_INCLUDE,
          ...(includeActivitySummary ? {
            _count: { select: { activityEvents: true, comments: true, assignedCards: true } },
            activityEvents: { orderBy: { createdAt: "desc" }, take: 1 },
          } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
    },
  };
}
