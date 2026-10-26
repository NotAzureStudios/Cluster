import type { FastifyReply, FastifyRequest } from "fastify";

export type TicketCreateRequest = {
  projectId?: string | null;
  boardId?: string | null;
  listId?: string | null;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string | null;
  labels: string[];
  assigneeId?: string | null;
};

type TicketDestinationServiceDependencies = {
  prisma: any;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  enforceListAccess: (...args: any[]) => Promise<any>;
};

const STUDIO_QUEUE_BOARD = "Tickets";
const STUDIO_QUEUE_LISTS = ["New", "In progress", "Waiting", "Review", "Resolved"];

/** A Ticket destination is explicit. Only the reserved Studio Tickets queue may provision itself. */
export function createTicketDestinationService({ prisma, enforceTargetAccess, enforceListAccess }: TicketDestinationServiceDependencies) {
  function reject(reply: FastifyReply, code: string, error: string, status = 409) {
    return reply.code(status).send({ ok: false, code, error });
  }

  async function resolveTicketDestination(request: FastifyRequest, reply: FastifyReply, body: TicketCreateRequest) {
    if (body.listId) {
      const list = await enforceListAccess(request, reply, body.listId, "contribute");
      if (!list) return null;
      const board = list.board;
      if (!board || board.archived || board.project?.archived || list.archived || list.isDone) {
        return reject(reply, "TICKET_DESTINATION_UNAVAILABLE", "Choose an active, non-completed List on an active Board.");
      }
      if (body.boardId && board.id !== body.boardId) {
        return reject(reply, "TICKET_DESTINATION_MISMATCH", "The selected List does not belong to the selected Board.");
      }
      if (body.projectId && board.project.id !== body.projectId) {
        return reject(reply, "TICKET_DESTINATION_MISMATCH", "The selected List belongs to a different Project.");
      }
      return { listId: list.id, boardId: board.id, projectId: board.project.id };
    }

    if (body.boardId) {
      const board = await prisma.board.findUnique({
        where: { id: body.boardId },
        include: { project: { include: { memberships: { where: { status: "active" } } } } },
      });
      if (!board || board.archived || board.project?.archived) return reject(reply, "TICKET_DESTINATION_UNAVAILABLE", "The selected Board is unavailable.");
      if (body.projectId && board.project.id !== body.projectId) return reject(reply, "TICKET_DESTINATION_MISMATCH", "The selected Board belongs to a different Project.");
      if (!(await enforceTargetAccess(request, reply, "board", board.id, board.project, "contribute"))) return null;
      return reject(reply, "TICKET_LIST_REQUIRED", "Select the destination List. Cluster will not silently choose or create one.");
    }

    // Project Boards are user-managed resources. A Ticket submission may not
    // seize an arbitrary Board or mutate an intentionally blank one.
    if (body.projectId) {
      const project = await prisma.project.findUnique({ where: { id: body.projectId } });
      if (!project || project.archived) return reject(reply, "TICKET_PROJECT_UNAVAILABLE", "The selected Project is unavailable.", 404);
      if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return null;
      return reject(reply, "TICKET_DESTINATION_REQUIRED", "Choose an active Board and List for this Project Ticket, or select Studio Tickets instead.");
    }

    // The Studio queue is the sole explicitly managed Ticket destination; it
    // is not an ordinary user Board and cannot alter user-defined Board Lists.
    const workspace = await prisma.workspace.findFirstOrThrow();
    let project = await prisma.project.findFirst({ where: { workspaceId: workspace.id, source: "system-tickets", archived: false } });
    if (!project) {
      project = await prisma.project.create({
        data: {
          workspaceId: workspace.id,
          name: "Studio tickets",
          description: "Workspace-level Tickets independent of production Boards.",
          source: "system-tickets", projectType: "general", productionProfile: "generic", status: "active",
          productionTracks: "[]", assignedUserIds: "[]",
        },
      });
    }
    let board = await prisma.board.findFirst({
      where: { projectId: project.id, name: STUDIO_QUEUE_BOARD, archived: false },
      include: { lists: { orderBy: { position: "asc" } } },
    });
    if (!board) {
      board = await prisma.board.create({
        data: {
          projectId: project.id, name: STUDIO_QUEUE_BOARD,
          description: "Managed Studio Ticket intake and triage queue.",
          lists: { create: STUDIO_QUEUE_LISTS.map((title, position) => ({ title, position, isDone: title === "Resolved" })) },
        },
        include: { lists: { orderBy: { position: "asc" } } },
      });
    }
    // An existing empty/modified managed queue is not permission to recreate
    // a workflow the Studio deliberately removed.
    const newList = board.lists.find((list: any) => list.title === "New" && !list.archived && !list.isDone);
    if (!newList) return reject(reply, "STUDIO_TICKET_INBOX_UNAVAILABLE", "Studio Tickets has no active New List. Ask an administrator to configure its intake destination.");
    return { listId: newList.id, boardId: board.id, projectId: project.id };
  }

  return { resolveTicketDestination };
}
