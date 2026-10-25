import { z } from "zod";
import { CLUSTER_ACCESS_TARGET_KINDS, clusterResourceKindFromEntityType } from "@cluster/shared";

import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { updateCommentAtRevision, nextCommentReactions } from "./comment-revisions.js";
import { decodeCommentCursor, commentCursorWhere, commentPage } from "./comment-pages.js";

const entityTypeSchema = z.enum(["project", "ticket", "card", "board", "whiteboard", "timeline", "library", "project_control", "build", "qa_plan", "qa_session", "source_review", "workspace"]);
const evidenceLinkSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  id: z.string().trim().min(1).max(240),
  label: z.string().trim().max(240).nullable().optional(),
  href: z.string().trim().max(1200).nullable().optional(),
});

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function parseReactionMap(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, string[]>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => !["__proto__", "prototype", "constructor"].includes(key)).map(([key, ids]) => [key, Array.isArray(ids) ? ids.map(String) : []]));
  } catch { return {}; }
}

export function registerEntityCommentRoutes(deps: ServerRouteRegistrationDeps) {
  const {
    app,
    collaborationRuntime,
    decorateUserForClient,
    enforceEntityCommentAccess,
    getCurrentUser,
    hasTargetAccess,
    authorization,
    recordCommentActivityInTransaction,
    wakeCommentActivity,
    prisma,
    parseJsonObject,
    serializeUserLite,
  } = deps;

  function serializeEntityComment(comment: any) {
    const canonicalKind = comment.entityType === "workspace" ? "workspace" : clusterResourceKindFromEntityType(comment.entityType);
    return {
      id: comment.id,
      revision: comment.revision,
      entityType: comment.entityType,
      entityId: comment.entityId,
      entity: canonicalKind ? { kind: canonicalKind, id: comment.entityId } : undefined,
      userId: comment.deletedAt ? null : comment.userId || null,
      body: comment.deletedAt ? "" : comment.body,
      deletedAt: comment.deletedAt?.toISOString?.() || comment.deletedAt || null,
      pinned: Boolean(comment.pinned),
      resolved: Boolean(comment.resolved),
      resolvedAt: comment.resolvedAt?.toISOString?.() || comment.resolvedAt || null,
      resolvedById: comment.resolvedById || null,
      assigneeId: comment.assigneeId || null,
      parentCommentId: comment.parentCommentId || null,
      threadRootId: comment.threadRootId || comment.id,
      mentionedUserIds: comment.deletedAt ? [] : parseJsonArray(comment.mentionedUserIds).map(String),
      reactions: parseReactionMap(comment.reactions),
      evidenceLinks: comment.deletedAt ? [] : parseJsonArray(comment.evidenceLinks),
      anchor: comment.deletedAt ? {} : parseJsonObject(comment.anchor),
      createdAt: comment.createdAt?.toISOString?.() || comment.createdAt,
      updatedAt: comment.updatedAt?.toISOString?.() || comment.updatedAt,
      user: !comment.deletedAt && comment.user ? serializeUserLite(comment.user) : null,
      assignee: comment.assignee ? serializeUserLite(comment.assignee) : null,
      resolvedBy: comment.resolvedBy ? serializeUserLite(comment.resolvedBy) : null,
    };
  }

  async function resolveEntityCommentContext(entityType: z.infer<typeof entityTypeSchema>, entityId: string) {
    if (entityType === "project") {
      const project = await prisma.project.findUnique({
        where: { id: entityId },
        include: { memberships: { where: { status: "active" } } },
      });
      return project && !project.archived
        ? { project, projectId: project.id, targetKind: "project", targetId: project.id, sourceKind: "project", collaboration: { tool: "project", resourceId: project.id } }
        : null;
    }
    if (entityType === "ticket" || entityType === "card") {
      const card = await prisma.card.findUnique({ where: { id: entityId }, include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } } });
      return card ? {
        project: card.list.board.project || null,
        projectId: card.list.board.projectId || null,
        targetKind: entityType === "ticket" ? "ticket" : "card",
        targetId: card.id,
        sourceKind: entityType === "ticket" ? "ticket" : "card",
        collaboration: { tool: "board", resourceId: card.list.board.id },
      } : null;
    }
    if (entityType === "board") {
      const board = await prisma.board.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return board ? { project: board.project || null, projectId: board.projectId || null, targetKind: "board", targetId: board.id, sourceKind: "board", collaboration: { tool: "board", resourceId: board.id } } : null;
    }
    if (entityType === "whiteboard") {
      const whiteboard = await prisma.whiteboard.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return whiteboard ? { project: whiteboard.project || null, projectId: whiteboard.projectId || null, targetKind: "whiteboard", targetId: whiteboard.id, sourceKind: "whiteboard", collaboration: { tool: "whiteboard", resourceId: whiteboard.id } } : null;
    }
    if (entityType === "timeline") {
      const item = await prisma.timelineItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return item ? { project: item.project || null, projectId: item.projectId || null, targetKind: "timeline", targetId: item.id, sourceKind: "timeline", collaboration: item.projectId ? { tool: "timeline", resourceId: item.projectId } : null } : null;
    }
    if (entityType === "library") {
      const item = await prisma.libraryItem.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return item ? { project: item.project || null, projectId: item.projectId || null, targetKind: "library", targetId: item.id, sourceKind: "library", collaboration: { tool: "library", resourceId: item.id } } : null;
    }
    if (entityType === "project_control") {
      const record = await prisma.projectControlRecord.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return record ? { project: record.project || null, projectId: record.projectId || null, targetKind: "project", targetId: record.projectId, sourceKind: "control", collaboration: { tool: "control", resourceId: record.projectId } } : null;
    }
    if (entityType === "source_review") {
      const review = await prisma.sourceReview.findUnique({ where: { id: entityId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return review?.project ? { project: review.project, projectId: review.projectId, targetKind: "source_review", targetId: review.id, sourceKind: "source_review", collaboration: { tool: "project", resourceId: review.projectId } } : null;
    }
    if (entityType === "build" || entityType === "qa_plan" || entityType === "qa_session") {
      const record = entityType === "build"
        ? await prisma.deliveryBuild.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } })
        : entityType === "qa_plan"
          ? await prisma.deliveryQaPlan.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } })
          : await prisma.deliveryQaSession.findFirst({ where: { id: entityId, archived: false }, select: { projectId: true } });
      if (!record?.projectId) return null;
      const project = await prisma.project.findUnique({ where: { id: record.projectId } });
      const tool = entityType === "build" ? "build" : "qa";
      return project ? { project, projectId: project.id, targetKind: entityType, targetId: entityId, sourceKind: entityType, collaboration: { tool, resourceId: project.id } } : null;
    }
    return { project: null, projectId: null, targetKind: "workspace", targetId: entityId, sourceKind: "workspace", collaboration: null };
  }

  const commentTargetLabel: Record<string, string> = {
    project: "Project", ticket: "Ticket", card: "Card", board: "Board", whiteboard: "Whiteboard", timeline: "Timeline item", project_control: "Project record",
    build: "Build", qa_plan: "QA plan", qa_session: "QA session", source_review: "Source review", workspace: "Workspace", library: "Library item",
  };

  function publishCommentChange(context: any) {
    if (!context?.collaboration?.tool || !context?.collaboration?.resourceId) return;
    collaborationRuntime?.scheduleBroadcast?.(context.collaboration.tool, context.collaboration.resourceId, true);
  }

  async function accessibleMentionUserIds(input: {
    userIds: string[];
    actorUserId?: string | null;
    context: Awaited<ReturnType<typeof resolveEntityCommentContext>>;
  }) {
    const requested = Array.from(new Set(input.userIds.map(String).map((value) => value.trim()).filter(Boolean))).filter((id) => id !== input.actorUserId).slice(0, 50);
    if (!requested.length) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: requested }, archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } },
      include: { memberships: { take: 1 } },
      take: 50,
    });
    const context = input.context;
    if (!context?.project) {
      return users.filter((candidate: any) => ["owner", "admin"].includes(String(candidate.memberships?.[0]?.role || ""))).map((candidate: any) => candidate.id);
    }
    const { project, projectId, targetKind, targetId } = context;
    const supportedTargets = new Set<string>(CLUSTER_ACCESS_TARGET_KINDS as readonly string[]);
    const ruleOr: any[] = [];
    if (projectId) ruleOr.push({ targetKind: "project", targetId: projectId });
    if (supportedTargets.has(targetKind)) ruleOr.push({ targetKind, targetId });
    const boardId = ["card", "ticket"].includes(String(context.sourceKind || "")) ? String(context.collaboration?.resourceId || "") : "";
    if (boardId) ruleOr.push({ targetKind: "board", targetId: boardId });
    const rules = ruleOr.length ? await prisma.accessRule.findMany({ where: { status: "active", OR: ruleOr } }).catch(() => []) : [];
    return users.filter((candidate: any) => {
      const role = candidate.memberships?.[0]?.role || null;
      // Mention notifications must not reveal thread text to people who lack
      // the tool even when their underlying Project relationship is valid.
      const requiredTool = context.sourceKind === "project" ? "projects"
        : ["board", "card"].includes(String(context.sourceKind || "")) ? "boards"
          : context.sourceKind === "whiteboard" ? "whiteboards" : null;
      if (requiredTool && !authorization.hasToolPermission(candidate, role, requiredTool, "view")) return false;
      if (boardId && !hasTargetAccess(candidate, role, "board", boardId, project, rules, "view")) return false;
      if (String(context.sourceKind || "") === "ticket" && !authorization.hasToolPermission(candidate, role, "tickets", "view")) return false;
      return hasTargetAccess(candidate, role, targetKind, targetId, project, rules, "view");
    }).map((candidate: any) => candidate.id);
  }

  // G24: never return draft content until the requesting author passes the
  // resource's *contribute* gate. Drafts have no presence or notification events.
  const draftSlotSchema = z.string().regex(/^(root|reply:[A-Za-z0-9_-]{1,200})$/).max(206);
  const draftQuerySchema = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1).max(200), slotKey: draftSlotSchema });
  const draftIdentity = (userId: string, query: z.infer<typeof draftQuerySchema>) => ({
    userId_entityType_entityId_slotKey: { userId, entityType: query.entityType, entityId: query.entityId, slotKey: query.slotKey },
  });
  async function checkDraftScope(request: any, reply: any, query: z.infer<typeof draftQuerySchema>) {
    if (!(await enforceEntityCommentAccess(request, reply, query.entityType, query.entityId, "contribute"))) return false;
    if (query.slotKey !== "root") {
      const parentId = query.slotKey.slice(6);
      const parent = await prisma.entityComment.findFirst({ where: { id: parentId, entityType: query.entityType, entityId: query.entityId } });
      if (!parent) { reply.code(404).send({ ok: false, code: "COMMENT_DRAFT_PARENT_MISSING", error: "Reply target unavailable." }); return false; }
    }
    return true;
  }
  const serializeDraft = (row: any) => row ? ({ body: row.body, revision: row.revision, updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt }) : { body: "", revision: null, updatedAt: null };

  app.get("/api/entity-comments/draft", async (request, reply) => {
    const query = draftQuerySchema.parse(request.query);
    if (!(await checkDraftScope(request, reply, query))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    return serializeDraft(await prisma.entityCommentDraft.findUnique({ where: draftIdentity(actor.id, query) }));
  });

  app.put("/api/entity-comments/draft", async (request, reply) => {
    const body = draftQuerySchema.extend({ body: z.string().min(1).max(8000), expectedRevision: z.number().int().min(1).nullable() }).parse(request.body);
    if (!(await checkDraftScope(request, reply, body))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const key = { userId: actor.id, entityType: body.entityType, entityId: body.entityId, slotKey: body.slotKey };
    if (body.expectedRevision === null) {
      try {
        const row = await prisma.entityCommentDraft.create({ data: { ...key, body: body.body } });
        return serializeDraft(row);
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        return reply.code(409).send({ ok: false, code: "COMMENT_DRAFT_CONFLICT", error: "Draft changed in another session. Review before replacing it." });
      }
    }
    // Fetch the new revision in the SAME transaction as the CAS write. Reading
    // after commit could accidentally return a newer concurrent writer's body
    // and revision, allowing this tab to overwrite a change it never saw.
    const updated = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.entityCommentDraft.updateMany({ where: { ...key, revision: body.expectedRevision }, data: { body: body.body, revision: { increment: 1 } } });
      if (changed.count !== 1) return null;
      return tx.entityCommentDraft.findUnique({ where: draftIdentity(actor.id, body) });
    });
    if (!updated) return reply.code(409).send({ ok: false, code: "COMMENT_DRAFT_CONFLICT", error: "Draft changed in another session. Review before replacing it." });
    return serializeDraft(updated);
  });

  app.delete("/api/entity-comments/draft", async (request, reply) => {
    const body = draftQuerySchema.extend({ expectedRevision: z.number().int().min(1) }).parse(request.body);
    if (!(await checkDraftScope(request, reply, body))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const changed = await prisma.entityCommentDraft.deleteMany({ where: { userId: actor.id, entityType: body.entityType, entityId: body.entityId, slotKey: body.slotKey, revision: body.expectedRevision } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "COMMENT_DRAFT_CONFLICT", error: "Draft changed in another session." });
    return { ok: true };
  });

  app.get("/api/entity-comments/read-state", async (request, reply) => {
    const query = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1).max(200) }).parse(request.query);
    if (!(await enforceEntityCommentAccess(request, reply, query.entityType, query.entityId, "view"))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const snapshotAt = new Date();
    const current = await prisma.entityCommentReadState.findUnique({ where: { userId_entityType_entityId: { userId: actor.id, entityType: query.entityType, entityId: query.entityId } } });
    const unreadCount = await prisma.entityComment.count({ where: {
      entityType: query.entityType, entityId: query.entityId, deletedAt: null,
      userId: { not: actor.id }, createdAt: { ...(current ? { gt: current.lastReadAt } : {}), lte: snapshotAt },
    } });
    return { lastReadAt: current?.lastReadAt?.toISOString?.() || null, unreadCount, snapshotAt: snapshotAt.toISOString() };
  });

  app.post("/api/entity-comments/read-state", async (request, reply) => {
    const body = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1).max(200), through: z.string().datetime() }).parse(request.body);
    if (!(await enforceEntityCommentAccess(request, reply, body.entityType, body.entityId, "view"))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const through = new Date(body.through);
    if (!Number.isFinite(through.getTime()) || through.getTime() > Date.now() + 1000) return reply.code(400).send({ ok: false, code: "READ_STATE_TIME_INVALID" });
    const key = { userId: actor.id, entityType: body.entityType, entityId: body.entityId };
    const existing = await prisma.entityCommentReadState.findUnique({ where: { userId_entityType_entityId: key } });
    if (!existing) {
      try { await prisma.entityCommentReadState.create({ data: { ...key, lastReadAt: through } }); }
      catch (error: any) { if (error?.code !== "P2002") throw error; }
    }
    // Monotonic even if two tabs race: never regress the stored watermark.
    await prisma.entityCommentReadState.updateMany({ where: { ...key, lastReadAt: { lt: through } }, data: { lastReadAt: through } });
    return { ok: true };
  });

  // Explicitly scoped read markers for one thread. The root must belong to
  // the authorized resource, including a deleted/tombstoned root. A root in
  // another Project cannot be probed using a guessed ID.
  const threadReadScope = z.object({
    entityType: entityTypeSchema,
    entityId: z.string().min(1).max(200),
    threadRootId: z.string().min(1).max(200),
  });
  async function canReadThread(request: any, reply: any, input: z.infer<typeof threadReadScope>) {
    if (!(await enforceEntityCommentAccess(request, reply, input.entityType, input.entityId, "view"))) return false;
    const root = await prisma.entityComment.findFirst({ where: {
      id: input.threadRootId, entityType: input.entityType, entityId: input.entityId, parentCommentId: null,
    }, select: { id: true } });
    if (!root) { reply.code(404).send({ ok: false, code: "COMMENT_THREAD_NOT_FOUND" }); return false; }
    return true;
  }

  app.get("/api/entity-comments/thread-read-state", async (request, reply) => {
    const query = threadReadScope.parse(request.query);
    if (!(await canReadThread(request, reply, query))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const snapshotAt = new Date();
    const key = { userId: actor.id, ...query };
    const current = await prisma.entityCommentThreadReadState.findUnique({ where: { userId_entityType_entityId_threadRootId: key } });
    const unreadCount = await prisma.entityComment.count({ where: {
      entityType: query.entityType, entityId: query.entityId, threadRootId: query.threadRootId,
      deletedAt: null, userId: { not: actor.id },
      createdAt: { ...(current ? { gt: current.lastReadAt } : {}), lte: snapshotAt },
    } });
    return { threadRootId: query.threadRootId, lastReadAt: current?.lastReadAt?.toISOString?.() || null,
      unreadCount, snapshotAt: snapshotAt.toISOString() };
  });

  app.post("/api/entity-comments/thread-read-state", async (request, reply) => {
    const body = threadReadScope.extend({ through: z.string().datetime() }).parse(request.body);
    if (!(await canReadThread(request, reply, body))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const through = new Date(body.through);
    if (!Number.isFinite(through.getTime()) || through.getTime() > Date.now() + 1000)
      return reply.code(400).send({ ok: false, code: "READ_STATE_TIME_INVALID" });
    const key = { userId: actor.id, entityType: body.entityType, entityId: body.entityId, threadRootId: body.threadRootId };
    try { await prisma.entityCommentThreadReadState.create({ data: { ...key, lastReadAt: through } }); }
    catch (error: any) { if (error?.code !== "P2002") throw error; }
    // Compare on the DB server. Racing tabs may only advance, never regress.
    await prisma.entityCommentThreadReadState.updateMany({ where: { ...key, lastReadAt: { lt: through } }, data: { lastReadAt: through } });
    return { ok: true };
  });

  app.get("/api/entity-comments/collaboration-room", async (request, reply) => {
    const query = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1) }).parse(request.query);
    if (!(await enforceEntityCommentAccess(request, reply, query.entityType, query.entityId, "view"))) return;
    const context = await resolveEntityCommentContext(query.entityType, query.entityId);
    return { room: context?.collaboration ? { ...context.collaboration, projectId: context.projectId || null } : null };
  });

  // Paginate whole threads, not an arbitrary first 500 comments. Replies are
  // fetched only when opened, so giant threads cannot starve other roots.
  app.get("/api/entity-comments", async (request, reply) => {
    const query = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).optional().default(25), cursor: z.string().max(512).optional() }).parse(request.query);
    if (!(await enforceEntityCommentAccess(request, reply, query.entityType, query.entityId, "view"))) return;
    let cursor;
    try { cursor = decodeCommentCursor(query.cursor, "roots"); }
    catch { return reply.code(400).send({ ok: false, code: "COMMENT_CURSOR_INVALID", error: "Invalid discussion page cursor." }); }
    const rows = await prisma.entityComment.findMany({
      where: { entityType: query.entityType, entityId: query.entityId, parentCommentId: null, ...commentCursorWhere(cursor, "roots") },
      include: { user: true, assignee: true, resolvedBy: true },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = commentPage(rows, query.limit, "roots");
    const counts = page.items.length ? await prisma.entityComment.groupBy({
      by: ["threadRootId"],
      where: { entityType: query.entityType, entityId: query.entityId, threadRootId: { in: page.items.map((row: any) => row.id) }, parentCommentId: { not: null } },
      _count: { _all: true },
    }) : [];
    const countByRoot = new Map<string, number>(counts.map((row: any) => [String(row.threadRootId), Number(row._count._all)]));
    return { ...page, items: page.items.map((row: any) => ({ ...serializeEntityComment(row), replyCount: countByRoot.get(row.id) || 0 })) };
  });

  app.get("/api/entity-comments/:commentId/replies", async (request, reply) => {
    const params = z.object({ commentId: z.string().min(1) }).parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional().default(25), cursor: z.string().max(512).optional() }).parse(request.query);
    const root = await prisma.entityComment.findUnique({ where: { id: params.commentId } });
    if (!root || root.parentCommentId) return reply.code(404).send({ ok: false, code: "COMMENT_THREAD_NOT_FOUND", error: "Discussion thread not found." });
    if (!(await enforceEntityCommentAccess(request, reply, root.entityType, root.entityId, "view"))) return;
    let cursor;
    try { cursor = decodeCommentCursor(query.cursor, "replies"); }
    catch { return reply.code(400).send({ ok: false, code: "COMMENT_CURSOR_INVALID", error: "Invalid reply page cursor." }); }
    const rows = await prisma.entityComment.findMany({
      where: { entityType: root.entityType, entityId: root.entityId, threadRootId: root.id, parentCommentId: { not: null }, ...commentCursorWhere(cursor, "replies") },
      include: { user: true, assignee: true, resolvedBy: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    });
    const page = commentPage(rows, query.limit, "replies");
    return { ...page, items: page.items.map(serializeEntityComment) };
  });

  app.post("/api/entity-comments", async (request, reply) => {
    const body = z.object({
      entityType: entityTypeSchema,
      entityId: z.string().min(1),
      body: z.string().trim().min(1).max(8000),
      mentionedUserIds: z.array(z.string().trim().min(1).max(200)).max(50).optional().default([]),
      assigneeId: z.string().trim().min(1).max(200).nullable().optional(),
      parentCommentId: z.string().trim().min(1).max(200).nullable().optional(),
      evidenceLinks: z.array(evidenceLinkSchema).max(20).optional().default([]),
      draftRevision: z.number().int().min(1).nullable().optional(),
      anchor: z.object({ kind: z.string().trim().min(1).max(80), ids: z.array(z.string().trim().min(1).max(200)).max(50).optional(), label: z.string().trim().max(240).optional(), x: z.number().finite().optional(), y: z.number().finite().optional() }).passthrough().optional().nullable(),
    }).parse(request.body);
    if (!(await enforceEntityCommentAccess(request, reply, body.entityType, body.entityId, "contribute"))) return;
    const user = await getCurrentUser(request);
    const commentContext = await resolveEntityCommentContext(body.entityType, body.entityId);
    if (body.entityType === "project" && !commentContext?.project) {
      return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project is unavailable." });
    }
    const mentionedUserIds = await accessibleMentionUserIds({ userIds: body.mentionedUserIds, actorUserId: user?.id || null, context: commentContext });
    const assigneeIds = body.assigneeId ? await accessibleMentionUserIds({ userIds: [body.assigneeId], actorUserId: null, context: commentContext }) : [];
    if (body.assigneeId && !assigneeIds.includes(body.assigneeId)) return reply.code(400).send({ ok: false, code: "COMMENT_ASSIGNEE_UNAVAILABLE", error: "The selected assignee cannot access this resource." });
    const parent = body.parentCommentId ? await prisma.entityComment.findFirst({ where: { id: body.parentCommentId, entityType: body.entityType, entityId: body.entityId } }) : null;
    if (body.parentCommentId && !parent) return reply.code(400).send({ ok: false, code: "COMMENT_PARENT_INVALID", error: "The reply target is not part of this thread." });

    const commentProjectId = commentContext?.projectId || null;
    const root = parent?.threadRootId && parent.threadRootId !== parent.id
      ? await prisma.entityComment.findUnique({ where: { id: parent.threadRootId } })
      : parent;
    const participantUserIds = parent
      ? await accessibleMentionUserIds({
        userIds: [parent.deletedAt ? null : parent.userId, parent.assigneeId, root?.deletedAt ? null : root?.userId, root?.assigneeId].filter(Boolean).map(String),
        actorUserId: user?.id || null,
        context: commentContext,
      })
      : [];
    const notifyUserIds = Array.from(new Set([
      ...mentionedUserIds,
      ...(body.assigneeId ? [body.assigneeId] : []),
      ...participantUserIds,
    ])).filter((id) => id !== user?.id);
    // Commit the comment, activity history and domain event together. An activity
    // failure rolls back the comment rather than leaving silent missing history.
    let draftCleared = body.draftRevision == null;
    const comment = await prisma.$transaction(async (tx: any) => {
      let comment = await tx.entityComment.create({
        data: {
          entityType: body.entityType,
          entityId: body.entityId,
          userId: user?.id || null,
          body: body.body,
          anchor: JSON.stringify(body.anchor || {}),
          mentionedUserIds: JSON.stringify(mentionedUserIds),
          assigneeId: body.assigneeId || null,
          parentCommentId: parent?.id || null,
          threadRootId: parent?.threadRootId || parent?.id || null,
          evidenceLinks: JSON.stringify(body.evidenceLinks),
        },
        include: { user: true, assignee: true, resolvedBy: true },
      });
      if (!comment.threadRootId) {
        comment = await tx.entityComment.update({ where: { id: comment.id }, data: { threadRootId: comment.id }, include: { user: true, assignee: true, resolvedBy: true } });
      }
      if (body.draftRevision) {
        const deletedDraft = await tx.entityCommentDraft.deleteMany({ where: {
          userId: user?.id, entityType: body.entityType, entityId: body.entityId,
          slotKey: body.parentCommentId ? `reply:${body.parentCommentId}` : "root",
          revision: body.draftRevision,
        } });
        draftCleared = deletedDraft.count === 1;
      }
      await recordCommentActivityInTransaction(tx, {
        userId: user?.id,
        projectId: commentProjectId,
        type: body.parentCommentId ? "comment_reply" : "comment",
        entityType: body.entityType,
        entityId: body.entityId,
        title: notifyUserIds.length ? `${commentTargetLabel[body.entityType] || "Work item"} thread update` : `${commentTargetLabel[body.entityType] || "Work item"} commented`,
        message: null, // Comment bodies live only in the revision-guarded comment store.
        metadata: {
          ...(notifyUserIds.length ? { userIds: notifyUserIds, mentionedUserIds, assignedUserId: body.assigneeId || null, mention: mentionedUserIds.length > 0, notifyInbox: true } : {}),
          ...(commentContext ? { source: { kind: commentContext.sourceKind, id: body.entityId, projectId: commentProjectId } } : {}),
          commentId: comment.id,
          threadRootId: comment.threadRootId,
        },
      });
      return comment;
    });
    wakeCommentActivity();
    publishCommentChange(commentContext);
    return { ...serializeEntityComment(comment), draftCleared };
  });

  app.patch("/api/entity-comments/:commentId", async (request, reply) => {
    const params = z.object({ commentId: z.string() }).parse(request.params);
    const body = z.object({
      body: z.string().trim().min(1).max(8000).optional(),
      pinned: z.boolean().optional(),
      resolved: z.boolean().optional(),
      assigneeId: z.string().trim().min(1).max(200).nullable().optional(),
      evidenceLinks: z.array(evidenceLinkSchema).max(20).optional(),
      expectedRevision: z.number().int().min(1),
    }).parse(request.body);
    const current = await prisma.entityComment.findUnique({ where: { id: params.commentId } });
    if (!current || current.deletedAt) return reply.code(404).send({ ok: false, error: "Comment not found." });
    if (!(await enforceEntityCommentAccess(request, reply, current.entityType, current.entityId, "contribute"))) return;
    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;
    if (body.body !== undefined && current.userId !== user?.id && !decorated?.isAdmin) {
      return reply.code(403).send({ ok: false, error: "Only the author or an administrator can edit this comment." });
    }
    const commentContext = await resolveEntityCommentContext(current.entityType as z.infer<typeof entityTypeSchema>, current.entityId);
    if (body.assigneeId) {
      const accessible = await accessibleMentionUserIds({ userIds: [body.assigneeId], actorUserId: null, context: commentContext });
      if (!accessible.includes(body.assigneeId)) return reply.code(400).send({ ok: false, code: "COMMENT_ASSIGNEE_UNAVAILABLE", error: "The selected assignee cannot access this resource." });
    }
    const resolving = body.resolved !== undefined ? body.resolved : current.resolved;
    const assignmentChanged = body.assigneeId !== undefined && (body.assigneeId || null) !== (current.assigneeId || null);
    const resolutionChanged = body.resolved !== undefined && Boolean(body.resolved) !== Boolean(current.resolved);
    // Compare-and-swap: a stale editor cannot overwrite an intervening mutation.
    // The same revision protects body, assignments, resolution and reactions.
    const updated = await prisma.$transaction(async (tx: any) => {
      const changed = await updateCommentAtRevision(tx, params.commentId, body.expectedRevision, {
        body: body.body,
          pinned: body.pinned,
          assigneeId: body.assigneeId === undefined ? undefined : body.assigneeId || null,
          evidenceLinks: body.evidenceLinks === undefined ? undefined : JSON.stringify(body.evidenceLinks),
          resolved: body.resolved,
          resolvedAt: body.resolved === undefined ? undefined : resolving ? new Date() : null,
          resolvedById: body.resolved === undefined ? undefined : resolving ? user?.id || null : null,
      });
      if (!changed) return null;
      const updated = await tx.entityComment.findUniqueOrThrow({ where: { id: params.commentId }, include: { user: true, assignee: true, resolvedBy: true } });
      const updateType = assignmentChanged ? "comment_assignment" : resolutionChanged ? (updated.resolved ? "comment_resolved" : "comment_reopened") : "comment_updated";
      const directNotifyIds = assignmentChanged && updated.assigneeId && updated.assigneeId !== user?.id ? [updated.assigneeId] : [];
      await recordCommentActivityInTransaction(tx, {
        userId: user?.id,
        projectId: commentContext?.projectId || null,
        type: updateType,
        entityType: current.entityType,
        entityId: current.entityId,
        title: assignmentChanged
          ? `${commentTargetLabel[current.entityType] || "Work item"} thread assigned`
          : resolutionChanged
            ? `${commentTargetLabel[current.entityType] || "Work item"} thread ${updated.resolved ? "resolved" : "reopened"}`
            : `${commentTargetLabel[current.entityType] || "Work item"} thread updated`,
        message: null, // Do not persist private text again in activity/notification history.
        metadata: {
          ...(directNotifyIds.length ? { userIds: directNotifyIds, assignedUserId: updated.assigneeId, notifyInbox: true } : {}),
          ...(commentContext ? { source: { kind: commentContext.sourceKind, id: current.entityId, projectId: commentContext.projectId || null } } : {}),
          commentId: updated.id,
          threadRootId: updated.threadRootId || updated.id,
          assignmentChanged,
          resolutionChanged,
        },
      });
      return updated;
    });
    if (!updated) return reply.code(409).send({ ok: false, code: "COMMENT_REVISION_CONFLICT", error: "This thread changed. Refresh it before trying again." });
    wakeCommentActivity();
    publishCommentChange(commentContext);
    return serializeEntityComment(updated);
  });

  app.post("/api/entity-comments/:commentId/reactions", async (request, reply) => {
    const params = z.object({ commentId: z.string() }).parse(request.params);
    const body = z.object({ reaction: z.string().trim().min(1).max(32).refine((value) => !["__proto__", "prototype", "constructor"].includes(value)), active: z.boolean().optional().default(true) }).parse(request.body || {});
    let current = await prisma.entityComment.findUnique({ where: { id: params.commentId } });
    if (!current || current.deletedAt) return reply.code(404).send({ ok: false, error: "Comment not found." });
    if (!(await enforceEntityCommentAccess(request, reply, current.entityType, current.entityId, "view"))) return;
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, error: "Login required." });
    // Merge independent user reactions after concurrent writes. A blind update
    // could silently erase another editor's reaction.
    for (let attempt = 0; attempt < 6; attempt++) {
      const reactions = nextCommentReactions(parseReactionMap(current.reactions), body.reaction, user.id, body.active);
      const changed = await updateCommentAtRevision(prisma, current.id, current.revision, { reactions: JSON.stringify(reactions) });
      if (changed) {
        const updated = await prisma.entityComment.findUniqueOrThrow({ where: { id: current.id }, include: { user: true, assignee: true, resolvedBy: true } });
        publishCommentChange(await resolveEntityCommentContext(current.entityType as z.infer<typeof entityTypeSchema>, current.entityId));
        return serializeEntityComment(updated);
      }
      const fresh = await prisma.entityComment.findUnique({ where: { id: params.commentId } });
      if (!fresh || fresh.deletedAt) return reply.code(404).send({ ok: false, error: "Comment no longer exists." });
      current = fresh;
    }
    return reply.code(409).send({ ok: false, code: "COMMENT_REVISION_CONFLICT", error: "This thread is busy. Try again after it refreshes." });
  });

  app.delete("/api/entity-comments/:commentId", async (request, reply) => {
    const params = z.object({ commentId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.coerce.number().int().min(1) }).parse(request.query || {});
    const current = await prisma.entityComment.findUnique({ where: { id: params.commentId } });
    if (!current || current.deletedAt) return reply.code(404).send({ ok: false, error: "Comment not found." });
    if (!(await enforceEntityCommentAccess(request, reply, current.entityType, current.entityId, "contribute"))) return;
    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;
    if (current.userId !== user?.id && !decorated?.isAdmin) {
      return reply.code(403).send({ ok: false, error: "Only the author or an administrator can delete this comment." });
    }
    const context = await resolveEntityCommentContext(current.entityType as z.infer<typeof entityTypeSchema>, current.entityId);
    // A tombstone preserves the root/reply graph and strips sensitive content.
    // Deletion evidence is persisted in the same transaction as the tombstone.
    if (current.deletedAt) return reply.code(404).send({ ok: false, code: "COMMENT_DELETED", error: "Comment already deleted." });
    const deleted = await prisma.$transaction(async (tx: any) => {
      const changed = await updateCommentAtRevision(tx, params.commentId, body.expectedRevision, {
        deletedAt: new Date(), body: "", userId: null, mentionedUserIds: "[]",
        evidenceLinks: "[]", anchor: "{}", reactions: "{}", assigneeId: null,
        pinned: false, resolvedById: null,
      });
      if (!changed) return false;
      await recordCommentActivityInTransaction(tx, {
        userId: user?.id,
        projectId: context?.projectId || null,
        type: "comment_deleted",
        entityType: current.entityType,
        entityId: current.entityId,
        title: `${commentTargetLabel[current.entityType] || "Work item"} comment deleted`,
        message: null,
        metadata: {
          ...(context ? { source: { kind: context.sourceKind, id: current.entityId, projectId: context.projectId || null } } : {}),
          commentId: current.id,
          threadRootId: current.threadRootId || current.id,
          formerRevision: current.revision,
        },
      });
      return true;
    });
    if (!deleted) return reply.code(409).send({ ok: false, code: "COMMENT_REVISION_CONFLICT", error: "This thread changed. Refresh it before deleting." });
    wakeCommentActivity();
    publishCommentChange(context);
    return { ok: true };
  });
}
