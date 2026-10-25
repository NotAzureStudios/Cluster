import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";
import { buildSemanticCursorPage, decodeSemanticCursor, semanticCursorOrderBy, semanticCursorWhere, type ResolvedSemanticCursor } from "../../core/semantic-cursor-pagination.js";

type TicketPageOptions = {
  limit: number;
  cursor?: string | null;
  sort: ResolvedSemanticCursor;
  where?: Record<string, unknown>;
};

type TicketWorkspaceLimits = {
  boardLimit: number;
  userLimit: number;
  detail: "summary" | "full";
};

const summaryCardSelect = {
  id: true,
  listId: true,
  title: true,
  description: true,
  position: true,
  priority: true,
  dueDate: true,
  labels: true,
  assigneeId: true,
  externalUrl: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
  revision: true,
  assignee: true,
} as const;

export function createTicketRepository(prisma: any) {
  async function loadWorkspace({ boardLimit, userLimit, detail }: TicketWorkspaceLimits) {
    const cards = detail === "summary"
      ? {
          where: { archived: false },
          orderBy: { position: "asc" },
          select: summaryCardSelect,
        }
      : {
          where: { archived: false },
          orderBy: { position: "asc" },
          include: {
            checklistItems: { orderBy: { position: "asc" } },
            comments: { orderBy: { createdAt: "desc" }, include: { user: true } },
            activity: { orderBy: { createdAt: "desc" }, take: 25 },
            assignee: true,
          },
        };
    const [boards, users] = await Promise.all([
      prisma.board.findMany({
        where: { archived: false },
        include: {
          project: { include: { memberships: { where: { status: "active" } } } },
          lists: {
            orderBy: { position: "asc" },
            include: { cards },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: boardLimit,
      }),
      prisma.user.findMany({
        where: { archived: false },
        orderBy: [{ displayName: "asc" }, { username: "asc" }],
        take: userLimit,
      }),
    ]);
    return { boards, users };
  }

  async function listTicketPage({ limit, cursor, sort, where }: TicketPageOptions) {
    const decoded = decodeSemanticCursor(cursor, sort);
    if (cursor && !decoded) throw Object.assign(new Error("Ticket cursor does not match the active semantic sort."), { code: "DATA_CURSOR_INVALID", statusCode: 400 });
    const cursorFilter = semanticCursorWhere(decoded, sort);
    const records = await prisma.card.findMany({
      where: {
        AND: [
          { archived: false },
          ...(where ? [where] : []),
          ...(cursorFilter ? [cursorFilter] : []),
        ],
      },
      include: {
        assignee: true,
        list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } },
      },
      orderBy: semanticCursorOrderBy(sort),
      take: limit + 1,
    });
    return buildSemanticCursorPage(records as Array<{ id: string } & Record<string, any>>, limit, sort);
  }

  async function listActiveAccessRules() {
    // Ticket data-view authorization is resolved at the Board/Project boundary.
    // Do not scan card/file/etc. access rules that cannot affect this decision.
    return (await prisma.accessRule?.findMany?.({ where: { status: "active", targetKind: { in: ["project", "board"] } }, select: AUTHORIZATION_RULE_SELECT }).catch(() => [])) || [];
  }

  return { loadWorkspace, listTicketPage, listActiveAccessRules };
}
