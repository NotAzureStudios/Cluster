import type { FastifyInstance, FastifyRequest } from "fastify";

import { z } from "zod";
import { API_CONTRACT, TICKET_DATA_FIELDS, isClosedTicketStage } from "@cluster/shared";
import { createTicketDestinationService, type TicketCreateRequest } from "./ticket-service.js";
import { createTicketRepository } from "./ticket-repository.js";
import { apiError } from "../../core/api-response.js";
import type { CollaborationRuntime } from "../../core/collaboration-runtime.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { workAssignmentActivity } from "../work/work-assignment.js";
import { createExternalEntityLinkService } from "../integrations/external-entity-link-service.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { parseClusterDataQueryParameter } from "../../core/data-query-http.js";
import { buildTicketDataQueryWhere, TICKET_SEMANTIC_CURSOR_FIELDS, ticketDataQueryAnalytics } from "./ticket-data-query.js";
import { resolveSemanticCursor, semanticContinuationSort } from "../../core/semantic-cursor-pagination.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";

type TicketRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasTargetAccess: (...args: any[]) => boolean;
  hasToolPermission: (...args: any[]) => boolean;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  enforceListAccess: (...args: any[]) => Promise<any>;
  serializeBoard: (board: any) => any;
  serializeCard: (card: any) => any;
  readSettings: () => Promise<Record<string, any>>;
  unique: (items: string[]) => string[];
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  collaborationRuntime: Pick<CollaborationRuntime, "scheduleBroadcast">;
  studioAutomation: { previewTicket: (input: Record<string, unknown>) => Promise<any>; activateTicket: (cardId: string, context: Record<string, unknown>, actions: Array<{ ruleId: string; actionId: string }>, actorId?: string | null) => Promise<any> };
};

export function registerTicketRoutes(deps: TicketRouteDependencies) {
  const { app, prisma, getCurrentUser, decorateUserForClient, hasTargetAccess, hasToolPermission, enforceTargetAccess, enforceListAccess, serializeBoard, serializeCard, readSettings, unique, logActivity, collaborationRuntime, studioAutomation } = deps;
  const { resolveTicketDestination } = createTicketDestinationService({ prisma, enforceTargetAccess, enforceListAccess });
  const ticketRepository = createTicketRepository(prisma);
  const externalLinks = createExternalEntityLinkService(prisma);

  app.get("/api/tickets/data-view", async (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(250).default(80),
      cursor: z.string().trim().max(2000).optional(),
      dataQuery: z.string().max(16_000).optional(),
    }).parse(request.query || {});
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const rules = decorated?.isAdmin ? [] : await ticketRepository.listActiveAccessRules();
    const requestedDataQuery = parseClusterDataQueryParameter(query.dataQuery);
    const dataQuery = normalizeClusterDataQuery({ ...requestedDataQuery, page: { cursor: query.cursor || null, limit: query.limit } }, { fields: TICKET_DATA_FIELDS, defaultLimit: query.limit, maxLimit: 250 });
    const boardSeeds = await prisma.board.findMany({
      where: { archived: false },
      select: { id: true, project: { select: { id: true, source: true, memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true, status: true, startsAt: true, endsAt: true } } } } },
    });
    const authorizedBoardIds = boardSeeds.filter((board: any) => board.project?.source === "system-tickets" || decorated?.isAdmin || hasTargetAccess(user, decorated?.workspaceRole, "board", board.id, board.project, rules, "view")).map((board: any) => board.id);
    const dataWhere = buildTicketDataQueryWhere({ query: dataQuery, authorizedBoardIds });
    const continuation = resolveSemanticCursor(dataQuery.sorts, TICKET_SEMANTIC_CURSOR_FIELDS, { fieldId: "updatedAt", direction: "desc" });
    const page = await ticketRepository.listTicketPage({ limit: query.limit, cursor: query.cursor || null, sort: continuation.cursor, where: dataWhere });
    const decoratedCards = await externalLinks.decorateCards(page.items);
    const items = decoratedCards.map((card: any) => ({
      ...serializeCard(card),
      boardId: card.list.board.id,
      boardName: card.list.board.name,
      projectId: card.list.board.project.id,
      projectName: card.list.board.project.name,
      listTitle: card.list.title,
      // Ticket stage, not Board placement, drives completion in every Ticket API.
      listIsDone: isClosedTicketStage(card.ticketStage),
      boardListIsDone: Boolean(card.list.isDone),
    }));
    const analytics = query.cursor ? null : await ticketDataQueryAnalytics(prisma, dataWhere, dataQuery, authorizedBoardIds);
    reply.header("Cache-Control", "no-store");
    return {
      items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      dataView: {
        resourceKind: "ticket",
        fields: TICKET_DATA_FIELDS,
        query: dataQuery,
        analytics,
        page: { nextCursor: page.nextCursor, hasMore: page.hasMore, cursorSupported: true },
        continuationSort: semanticContinuationSort(continuation.cursor),
        semanticSortApplied: continuation.requestedSortApplied,
      },
    };
  });

  app.get("/api/tickets/assigned-summary", async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }).parse(request.query || {});
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const decorated = await decorateUserForClient(user);
    if (!(decorated?.isAdmin || hasToolPermission(user, decorated?.workspaceRole, "tickets", "view"))) {
      return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "Tickets view access is required." });
    }
    const cards = await prisma.card.findMany({
      where: { archived: false, workItemKind: "ticket", assigneeId: user.id },
      select: {
        id: true, title: true, priority: true, ticketStage: true, dueDate: true, assigneeId: true, updatedAt: true,
        list: { select: { id: true, title: true, isDone: true, board: { select: {
          id: true, name: true, project: { select: {
            id: true, name: true, source: true,
            memberships: { where: { status: "active" }, select: { userId: true, roleKey: true, roleLabel: true, isLead: true, accessLevel: true, status: true, startsAt: true, endsAt: true } },
          } },
        } } } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      // Non-admin rows are authorization-filtered after the lightweight projection.
      // Read a small cushion so an inaccessible newer ticket does not crowd an older
      // visible assignment out of Home's summary window.
      take: decorated?.isAdmin ? query.limit : Math.min(300, query.limit * 3),
    });
    let filteredCards = cards;
    if (!decorated?.isAdmin && cards.length) {
      const projectIds = [...new Set(cards.map((card: any) => String(card.list?.board?.project?.id || "")).filter(Boolean))];
      const boardIds = [...new Set(cards.map((card: any) => String(card.list?.board?.id || "")).filter(Boolean))];
      const ruleOr: any[] = [];
      if (projectIds.length) ruleOr.push({ targetKind: "project", targetId: { in: projectIds } });
      if (boardIds.length) ruleOr.push({ targetKind: "board", targetId: { in: boardIds } });
      // Authorization evidence is mandatory. A failed rule query is not evidence
      // that no restrictive rules exist; do not return assigned Ticket titles.
      const rules = ruleOr.length ? await prisma.accessRule.findMany({ where: { status: "active", OR: ruleOr }, select: AUTHORIZATION_RULE_SELECT }) : [];
      filteredCards = cards.filter((card: any) => {
        const board = card.list?.board;
        const project = board?.project;
        if (!board || !project) return false;
        return String(project.source || "").toLowerCase() === "system-tickets"
          || hasTargetAccess(user, decorated?.workspaceRole, "board", board.id, project, rules, "view");
      });
    }
    filteredCards = filteredCards.slice(0, query.limit);
    const payload = {
      items: filteredCards.map((card: any) => ({
        id: card.id,
        title: card.title,
        priority: card.priority,
        ticketStage: card.ticketStage,
        dueDate: card.dueDate,
        assigneeId: card.assigneeId,
        updatedAt: card.updatedAt,
        listId: card.list.id,
        listTitle: card.list.title,
        listIsDone: isClosedTicketStage(card.ticketStage),
        boardListIsDone: Boolean(card.list.isDone),
        boardId: card.list.board.id,
        boardName: card.list.board.name,
        projectId: card.list.board.project.id,
        projectName: card.list.board.project.name,
      })),
    };
    return sendPrivateRevalidated(request, reply, payload);
  });

  app.get("/api/tickets/workspace", async (request) => {
    const query = z.object({
      boardLimit: z.coerce.number().int().min(1).max(API_CONTRACT.pagination.ticketBoardsMaximum).default(API_CONTRACT.pagination.ticketBoardsDefault),
      userLimit: z.coerce.number().int().min(1).max(API_CONTRACT.pagination.ticketUsersMaximum).default(API_CONTRACT.pagination.ticketUsersDefault),
      detail: z.enum(["summary", "full"]).default("full"),
    }).parse(request.query || {});
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const rules = decorated?.isAdmin ? [] : await ticketRepository.listActiveAccessRules();
    const { boards, users } = await ticketRepository.loadWorkspace({ boardLimit: query.boardLimit, userLimit: query.userLimit, detail: query.detail });
    const visibleBoards = boards.filter((board: any) => board.project?.source === "system-tickets" || decorated?.isAdmin || hasTargetAccess(user, decorated?.workspaceRole, "board", board.id, board.project, rules, "view"));
    const allCards = visibleBoards.flatMap((board: any) => (board.lists || []).flatMap((list: any) => list.cards || []));
    const decoratedCards = await externalLinks.decorateCards(allCards);
    const cardsById = new Map(decoratedCards.map((card: any) => [card.id, card]));
    for (const board of visibleBoards) for (const list of board.lists || []) list.cards = (list.cards || []).map((card: any) => cardsById.get(card.id) || card);
    return {
      boards: visibleBoards.map((board: any) => {
        const serialized = serializeBoard(board);
        if (query.detail !== "summary") return serialized;
        return {
          ...serialized,
          lists: serialized.lists.filter((list: any) => !list.archived).map((list: any) => ({
            ...list,
            cards: list.cards.map((card: any) => ({ ...card, checklistItems: [], comments: [], activity: [] })),
          })),
        };
      }),
      users: users.map((entry: any) => ({
        id: entry.id,
        username: entry.username,
        displayName: entry.displayName,
        preferredName: entry.preferredName,
        department: entry.department,
        archived: entry.archived,
      })),
    };
  });
  
  app.post("/api/tickets", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Sign in to create a Ticket.");
    const decoratedUser = await decorateUserForClient(user);
    if (!(decoratedUser?.isAdmin || hasToolPermission(user, decoratedUser?.workspaceRole, "tickets", "edit"))) {
      return apiError(request, reply, 403, "TICKETS_ACCESS_DENIED", "Ticket editing permission is required to create a Ticket.");
    }
    const body = z
      .object({
        projectId: z.string().optional().nullable(),
        boardId: z.string().optional().nullable(),
        listId: z.string().optional().nullable(),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(100_000).optional().default(""),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
        dueDate: z.string().optional().nullable(),
        labels: z.array(z.string().trim().min(1).max(80)).max(80).default([]),
        assigneeId: z.string().optional().nullable(),
        automationContext: z.object({
          type: z.string().max(180).optional(),
          department: z.string().max(180).optional(),
          severity: z.enum(["low", "medium", "high", "urgent"]).optional(),
          labels: z.string().max(8000).optional(),
          customValues: z.record(z.union([z.string(), z.boolean()])).optional(),
        }).optional(),
        automationActions: z.array(z.object({ ruleId: z.string().min(1).max(180), actionId: z.string().min(1).max(180) })).max(200).optional(),
      })
      .parse(request.body) as TicketCreateRequest & { automationContext?: { type?: string; department?: string; severity?: "low" | "medium" | "high" | "urgent"; labels?: string; customValues?: Record<string, string | boolean> }; automationActions?: Array<{ ruleId: string; actionId: string }> };
  
    const automationPreview = await studioAutomation.previewTicket({
      type: body.automationContext?.type || "Task",
      severity: body.automationContext?.severity || body.priority,
      department: body.automationContext?.department || "",
      assigneeId: body.assigneeId || "",
      labels: body.automationContext?.labels || body.labels.join(","),
      title: body.title,
      projectId: body.projectId || undefined,
      dueDate: body.dueDate || undefined,
      customValues: body.automationContext?.customValues || {},
    });
    body.priority = automationPreview.priority;
    body.assigneeId = automationPreview.assigneeId || body.assigneeId || null;
    body.labels = unique([...body.labels, ...automationPreview.labels, ...(automationPreview.inboxSignals?.length ? ["inbox-attention"] : [])]);
    body.dueDate = automationPreview.dueDate || body.dueDate || null;

    const ticketSettings = await readSettings();
    if (ticketSettings.ticketsRequireProject && !body.projectId && !body.boardId && !body.listId) {
      return apiError(request, reply, 400, "BAD_REQUEST", "A project is required for new tickets by studio policy.");
    }
    if (!body.assigneeId && ticketSettings.ticketsAutoAssignCreator !== false && user?.id) body.assigneeId = user.id;
  
    const destination = await resolveTicketDestination(request, reply, body);
    if (!destination || reply.sent) return;
    // Enforce the Project requirement against the authoritative resolved scope,
    // not untrusted optional request IDs that could name the Studio queue.
    if (ticketSettings.ticketsRequireProject) {
      const targetProject = await prisma.project.findUnique({ where: { id: destination.projectId }, select: { source: true } });
      if (!targetProject || targetProject.source === "system-tickets") {
        return apiError(request, reply, 400, "TICKET_PROJECT_REQUIRED", "Studio policy requires a production Project for this Ticket.");
      }
    }
    const lastCard = await prisma.card.findFirst({
      where: { listId: destination.listId, archived: false },
      orderBy: { position: "desc" },
    });
    const card = await prisma.card.create({
      data: {
        listId: destination.listId,
        title: body.title,
        description: body.description || null,
        workItemKind: "ticket",
        ticketStage: "new",
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        labels: JSON.stringify(unique(["ticket", ...body.labels])),
        assigneeId: body.assigneeId || null,
        position: lastCard ? lastCard.position + 1 : 0,
        activity: { create: { type: "created", message: "Ticket created" } },
      },
      include: {
        checklistItems: true,
        comments: true,
        activity: { orderBy: { createdAt: "desc" }, take: 25 },
        assignee: true,
        list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } },
      },
    });
    await logActivity({
      userId: user?.id,
      projectId: destination.projectId,
      boardId: destination.boardId,
      cardId: card.id,
      type: "created",
      entityType: "ticket",
      entityId: card.id,
      title: "Ticket created",
      message: card.title,
      metadata: { priority: card.priority, list: card.list.title },
    });
    const assignment = workAssignmentActivity({ actorUserId: user?.id, source: { kind: "ticket", id: card.id, projectId: destination.projectId, label: card.title }, assigneeId: card.assigneeId, projectId: destination.projectId, boardId: destination.boardId, cardId: card.id, dueAt: card.dueDate });
    if (assignment) await logActivity(assignment);
    const activationActions = body.automationActions?.length ? body.automationActions : automationPreview.deferredActions || [];
    if (activationActions.length) {
      await studioAutomation.activateTicket(card.id, {
        ...(body.automationContext || {}),
        title: card.title,
        priority: card.priority,
        labels: unique(["ticket", ...body.labels]),
        assigneeId: card.assigneeId || null,
        dueDate: card.dueDate?.toISOString?.() || null,
      }, activationActions, user?.id || null);
    }
    collaborationRuntime.scheduleBroadcast("board", destination.boardId, true);
    const [decoratedCard] = await externalLinks.decorateCards([card]);
    return {
      ...serializeCard(decoratedCard),
      boardId: card.list.board.id,
      boardName: card.list.board.name,
      projectId: card.list.board.project.id,
      projectName: card.list.board.project.name,
      listTitle: card.list.title,
    };
  });
}
