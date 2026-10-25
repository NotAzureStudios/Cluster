import type { FastifyReply, FastifyRequest } from "fastify";
import { collaborationRoomOwner, type CollaborationRuntime, type CollaborationTool } from "../../core/collaboration-runtime.js";
import type { AuthorizationService } from "../access/authorization.js";
import type { LibraryAccessService } from "../library/library-access-service.js";
import { sanitizePresenceForRecipient } from "../presence/presence-policy-service.js";

type CollaborationAccessDependencies = {
  prisma: any;
  authorization: AuthorizationService;
  collaborationRuntime: CollaborationRuntime;
  decorateUserForClient: (user: any) => Promise<any>;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  parseLabels: (value: any) => string[];
  libraryAccess: LibraryAccessService;
  isToolEnabled: (owner: string) => boolean;
};

export function createCollaborationAccessBoundary(deps: CollaborationAccessDependencies) {
  const { prisma, authorization, collaborationRuntime, decorateUserForClient, getCurrentUser, parseLabels, libraryAccess } = deps;
  const roomIsEnabled = (tool: CollaborationTool) => {
    const owner = collaborationRoomOwner(tool);
    return !owner || deps.isToolEnabled(owner);
  };

  async function resolveResourceTarget(tool: CollaborationTool, resourceId: string) {
    let project: any | null = null;
    let targetKind = String(tool);
    let targetId = resourceId;
    let standaloneTool: string | null = null;
    if (tool === "board") {
      const board = await prisma.board.findUnique({ where: { id: resourceId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!board || board.project?.archived) return null;
      project = board.project;
      targetKind = "board";
    } else if (tool === "whiteboard") {
      const whiteboard = await prisma.whiteboard.findUnique({ where: { id: resourceId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!whiteboard || whiteboard.project?.archived) return null;
      if (!whiteboard.project) standaloneTool = "whiteboards";
      else project = whiteboard.project;
      targetKind = "whiteboard";
    } else if (tool === "library") {
      const item = await prisma.libraryItem.findUnique({ where: { id: resourceId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      if (!item || item.lifecycleState === "destroyed" || item.project?.archived) return null;
      project = item.project || null;
      targetKind = "library";
      targetId = item.id;
      return { project, targetKind, targetId, standaloneTool, libraryItem: item };
    } else {
      project = await prisma.project.findUnique({ where: { id: resourceId } });
      if (!project || project.archived) return null;
      const projectRoomTarget: Record<string, string> = {
        project: "project",
        build: "build",
        release: "build",
        qa: "qa",
        timeline: "timeline",
        calendar: "calendar",
        scheduler: "schedule",
        library: "library",
        control: "project",
      };
      targetKind = projectRoomTarget[tool] || "project";
      targetId = targetKind === "project" ? project.id : resourceId;
    }
    return { project, targetKind, targetId, standaloneTool, libraryItem: null };
  }

  async function userCanAccess(user: any, tool: CollaborationTool, resourceId: string, min = "view") {
    if (!roomIsEnabled(tool) || !user || user.archived || String(user.accountState || "").toUpperCase() === "PRIVACY_ERASED") return false;
    const resolved = await resolveResourceTarget(tool, resourceId);
    if (!resolved) return false;
    const action = min === "manage" ? "manage" : min === "contribute" || min === "edit" ? "contribute" : "subscribe";
    if (resolved.standaloneTool) {
      const decision = await authorization.authorize({ user }, action, { kind: "tool", tool: resolved.standaloneTool }, { minimum: min === "view" ? "view" : "edit", surface: "realtime" });
      return decision.allowed;
    }
    if (tool === "library" && resolved.libraryItem) {
      const context = await libraryAccess.contextForUser(user);
      const minimum = min === "manage" ? "manage" : min === "contribute" || min === "edit" ? "contribute" : "view";
      return libraryAccess.explainAccess(context, resolved.libraryItem, minimum).allowed;
    }
    const decision = await authorization.authorize({ user }, action, { kind: "target", targetKind: resolved.targetKind, targetId: resolved.targetId, project: resolved.project }, { minimum: min, surface: "realtime" });
    return decision.allowed;
  }

  function cardEntity(ref: any) {
    const kind = String(ref?.entityType || "").trim().toLowerCase().replaceAll("_", "-");
    return kind === "card" || kind === "ticket";
  }

  async function sanitizeStateForUser(user: any, tool: CollaborationTool, resourceId: string, state: any) {
    if (!state) return state;
    const decorated = await decorateUserForClient(user);
    const role = decorated?.workspaceRole || null;
    const canSeePrivateConnection = Boolean(decorated?.isAdmin || authorization.hasToolPermission(user, role, "people", "manage"));
    const normalized = {
      ...state,
      presence: (state.presence || [])
        .map((presence: any) => sanitizePresenceForRecipient(presence, { self: String(presence?.userId || "") === String(user.id), canSeePrivateConnection }))
        .filter(Boolean),
    };

    if (tool !== "board") return normalized;
    const cardIds = new Set<string>();
    for (const presence of normalized.presence || []) {
      for (const ref of [presence?.selection, presence?.editing]) if (cardEntity(ref) && ref?.entityId) cardIds.add(String(ref.entityId));
    }
    for (const action of normalized.actions || []) if (cardEntity(action?.entity) && action?.entity?.entityId) cardIds.add(String(action.entity.entityId));
    if (!cardIds.size) return normalized;

    const board = await prisma.board.findUnique({ where: { id: resourceId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    if (!board?.project || board.project.archived) return { ...normalized, presence: [], actions: [] };
    if (decorated?.isAdmin) return normalized;
    const cards = await prisma.card.findMany({ where: { id: { in: [...cardIds] } }, include: { list: true } });
    const roomCards = cards.filter((card: any) => card.list?.boardId === resourceId);
    const rules = ((await prisma.accessRule?.findMany?.({
      where: {
        status: "active",
        OR: [
          { targetKind: "project", targetId: board.project.id },
          { targetKind: "board", targetId: board.id },
        ],
      },
    }).catch(() => [])) || []);
    const boardVisible = authorization.hasTargetAccess(user, role, "board", board.id, board.project, rules, "view");
    const ticketsVisible = authorization.hasToolPermission(user, role, "tickets", "view");
    const visibleCardIds = new Set((boardVisible ? roomCards : []).filter((card: any) => card.workItemKind !== "ticket" || ticketsVisible).map((card: any) => String(card.id)));
    const refVisible = (ref: any) => !cardEntity(ref) || visibleCardIds.has(String(ref?.entityId || ""));

    return {
      ...normalized,
      presence: (normalized.presence || []).map((presence: any) => {
        const selectionVisible = refVisible(presence?.selection);
        const editingVisible = refVisible(presence?.editing);
        if (selectionVisible && editingVisible) return presence;
        return {
          ...presence,
          selection: selectionVisible ? presence.selection : null,
          editing: editingVisible ? presence.editing : null,
          activity: "working in board",
        };
      }),
      actions: (normalized.actions || []).filter((action: any) => refVisible(action?.entity)),
    };
  }

  collaborationRuntime.setAccessController({
    authorize: async (recipient, tool, resourceId) => {
      const [session, user] = await Promise.all([
        prisma.session.findUnique({ where: { id: recipient.sessionId }, select: { userId: true, expiresAt: true, revokedAt: true } }).catch(() => null),
        prisma.user.findUnique({ where: { id: recipient.userId } }).catch(() => null),
      ]);
      if (!session || session.userId !== recipient.userId || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return false;
      return userCanAccess(user, tool, resourceId, "view");
    },
    sanitizeState: async (recipient, tool, resourceId, state) => {
      const user = await prisma.user.findUnique({ where: { id: recipient.userId } }).catch(() => null);
      if (!user) return { ...state, presence: [], actions: [] };
      return sanitizeStateForUser(user, tool, resourceId, state);
    },
  });

  return async function enforceCollaborationResourceAccess(
    request: FastifyRequest,
    reply: FastifyReply,
    tool: CollaborationTool,
    resourceId: string,
    min = "view",
    knownUser?: any,
  ) {
    const user = knownUser || (await getCurrentUser(request));
    if (!user) {
      reply.code(401).send({ ok: false, error: "Authentication required" });
      return false;
    }

    // Always check availability before cached access. A previously allowed
    // room must not remain accessible after a Studio-level tool disable.
    if (!roomIsEnabled(tool)) {
      reply.code(503).send({ ok: false, code: "TOOL_DISABLED", error: `${tool} is disabled by Studio policy.` });
      return false;
    }
    const cacheKey = `${user.id}:${tool}:${resourceId}:${min}`;
    const cached = collaborationRuntime.getCachedAccess(cacheKey);
    if (cached !== null) {
      if (!cached) reply.code(403).send({ ok: false, error: `${tool} ${min} access required.` });
      return cached;
    }
    const resolved = await resolveResourceTarget(tool, resourceId);
    if (!resolved) {
      reply.code(404).send({ ok: false, error: `${tool === "board" ? "Board" : tool === "whiteboard" ? "Whiteboard" : "Project collaboration room"} not found.` });
      return false;
    }
    const allowed = await userCanAccess(user, tool, resourceId, min);
    collaborationRuntime.setCachedAccess(cacheKey, allowed);
    if (!allowed) reply.code(403).send({ ok: false, error: `${tool} ${min} access required.` });
    return allowed;
  };
}
