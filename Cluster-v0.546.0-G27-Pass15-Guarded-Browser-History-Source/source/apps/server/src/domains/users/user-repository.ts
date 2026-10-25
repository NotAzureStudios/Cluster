import { WORKFORCE_USER_AUTHORITY_INCLUDE } from "../workforce/workforce-user-authority.js";

export function createUserRepository(prisma: any) {
  return {
    listDirectory() {
      return prisma.user.findMany({
        include: {
          ...WORKFORCE_USER_AUTHORITY_INCLUDE,
          memberships: true,
          _count: { select: { assignedCards: true, comments: true, activityEvents: true } },
          activityEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: [{ updatedAt: "desc" }],
      });
    },
    findById(id: string) {
      return prisma.user.findUnique({ where: { id } });
    },
    listTeamResources(options: { userId?: string | null } = {}) {
      const userId = String(options.userId || "").trim();
      const assignedStringFilter = userId ? { contains: userId } : undefined;
      return Promise.all([
        prisma.user.findMany({
          where: userId ? { id: userId } : undefined,
          include: { ...WORKFORCE_USER_AUTHORITY_INCLUDE, memberships: true },
          orderBy: { updatedAt: "desc" },
        }),
        // Keep the lightweight project authority set complete even for user-scoped reads.
        // A person can be assigned a board/card without an explicit project membership,
        // and authorization still needs the containing project to evaluate that resource.
        prisma.project.findMany({
          where: { archived: false },
          select: { id: true, name: true, source: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, allocationPercent: true, accessLevel: true, status: true, startsAt: true, endsAt: true } } },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.board.findMany({
          where: userId ? {
            archived: false,
            OR: [
              { assignedUserIds: { contains: userId } },
              { lists: { some: { assignedUserIds: { contains: userId } } } },
              { lists: { some: { cards: { some: { assigneeId: userId, archived: false } } } } },
            ],
          } : { archived: false },
          select: { id: true, name: true, assignedUserIds: true, project: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.boardList.findMany({
          where: assignedStringFilter ? { assignedUserIds: assignedStringFilter } : undefined,
          select: { id: true, title: true, assignedUserIds: true, board: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.card.findMany({
          where: { archived: false, ...(userId ? { assigneeId: userId } : {}) },
          select: { id: true, title: true, priority: true, dueDate: true, assigneeId: true, workItemKind: true, labels: true, list: { select: { board: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } } } },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.calendarEvent.findMany({
          where: userId ? { OR: [{ ownerId: userId }, { attendeeIds: { contains: userId } }] } : undefined,
          select: { id: true, title: true, startsAt: true, endsAt: true, projectId: true, ownerId: true, attendeeIds: true, visibility: true, project: { select: { id: true, name: true, archived: true, memberships: { where: { status: "active" } } } } },
          orderBy: { startsAt: "asc" },
          take: 5000,
        }),
        prisma.scheduleBlock.findMany({
          where: userId ? { OR: [{ userId }, { participantIds: { contains: userId } }] } : undefined,
          select: { id: true, title: true, startsAt: true, endsAt: true, projectId: true, boardId: true, cardId: true, userId: true, participantIds: true, project: { select: { id: true, name: true } } },
          orderBy: { startsAt: "asc" },
          take: 5000,
        }),
      ]);
    },
  };
}
