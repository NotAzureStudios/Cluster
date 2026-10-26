import { requireClusterProjectRole, resolveClusterProjectRole } from "@cluster/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { API_CONTRACT, CLUSTER_PROJECT_STATUSES, PROJECT_DATA_FIELDS, canTransitionClusterProjectStatus, resolveClusterProductionProfile, resolveClusterProjectDefinitionForProfile, resolveClusterProjectPurposeTypes, resolveClusterProjectType } from "@cluster/shared";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createProjectRepository } from "./project-repository.js";
import { createProjectCapabilitySerializer } from "./project-capabilities.js";
import { replaceProjectMemberships, writeProjectMembershipsInTransaction } from "./project-membership.js";
import { createHttpError } from "../../core/http-errors.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { createDecisionService } from "../decisions/decision-service.js";
import { projectTypeTemplateSeeds } from "./project-type-workspace-routes.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { parseClusterDataQueryParameter } from "../../core/data-query-http.js";
import { buildProjectDataQueryWhere, PROJECT_SEMANTIC_CURSOR_FIELDS, projectDataQueryAnalytics } from "./project-data-query.js";
import { resolveSemanticCursor, semanticContinuationSort } from "../../core/semantic-cursor-pagination.js";
import { createProjectDeliveryLifecycleService } from "./project-delivery-lifecycle-service.js";
import { projectSourceControlPlan, provisionClusterManagedProjectRepository, type ClusterManagedGitRuntime } from "./project-source-provisioning.js";
import { projectStorageDirectory, type ClusterDataLayout } from "../../core/data-layout.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";
import { createProjectSnapshotService } from "./project-snapshot-service.js";
type ProjectRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasTargetAccess: (...args: any[]) => boolean;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  serializeProjectSummary: (project: any) => any;
  normalizeProjectType: (value: unknown) => string;
  normalizeProjectStatus: (value: unknown) => string;
  configuredProjectType: (type: string) => Promise<any>;
  unique: (items: string[]) => string[];
  safeUrl: (value: string, label: string) => string;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  sendRevisionConflict: (reply: FastifyReply, entityType: string, current: unknown) => unknown;
  verifyUserPin: (...args: any[]) => Promise<unknown>;
  canArchiveProject: (...args: any[]) => boolean;
  hasToolPermission: (...args: any[]) => boolean;
  hasProjectPermission: (...args: any[]) => boolean;
  readSettings: () => Promise<Record<string, any>>;
  buildPersistenceStorageData: (...args: any[]) => Record<string, unknown>;
  parseLabels: (value: string | null | undefined) => string[];
  verifyStorage: () => Promise<unknown>;
  authorization: any;
  gitRuntime?: ClusterManagedGitRuntime | null;
  dataLayout: ClusterDataLayout;
};
class ProjectRevisionWriteConflict extends Error {
  readonly code = "PROJECT_REVISION_CONFLICT";
}

export function registerProjectRoutes(deps: ProjectRouteDependencies) {
  const { app, prisma, getCurrentUser, decorateUserForClient, hasTargetAccess, enforceTargetAccess, serializeProjectSummary, normalizeProjectType, normalizeProjectStatus, configuredProjectType, unique, safeUrl, logActivity, sendRevisionConflict, verifyUserPin, hasToolPermission, readSettings, buildPersistenceStorageData, parseLabels, verifyStorage, authorization, gitRuntime } = deps;
  const projectRepository = createProjectRepository(prisma);
  const deliveryLifecycleService = createProjectDeliveryLifecycleService(prisma);
  const projectSnapshots = createProjectSnapshotService({ prisma, authorization, hasToolPermission });
  const decisions = createDecisionService(prisma);
  const serializeWithCapabilities = createProjectCapabilitySerializer({ hasTargetAccess, serializeProjectSummary, isExternalCollaboratorRole: authorization?.isExternalCollaboratorRole?.bind(authorization) });
  app.get("/api/project-types", async (request, reply) => {
    const settings = await readSettings();
    const types = resolveClusterProjectPurposeTypes(settings.projectTypePresets);
    const defaultType = resolveClusterProjectType(settings.defaultProjectTypeId || "general", settings.projectTypePresets);
    return sendPrivateRevalidated(request, reply, { types, defaultTypeId: defaultType.id, concepts: { projectType: "purpose", productionProfile: "technology", blueprint: "reusable-content", workspacePreset: "workspace-shape" } });
  });
  app.get("/api/production-profiles", async (request, reply) => {
    const settings = await readSettings();
    const types = resolveClusterProjectPurposeTypes(settings.projectTypePresets);
    const profiles = (await import("@cluster/shared")).enabledClusterProductionProfiles(settings.studioEnabledProductionProfileIds);
    return sendPrivateRevalidated(request, reply, { profiles, purposeTypes: types.map((item: any) => ({ id: item.id, label: item.label })) });
  });
  app.get("/api/projects", async (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(API_CONTRACT.pagination.projectsMaximum).optional(),
      cursor: z.string().trim().max(2000).optional(),
      paged: z.enum(["1", "true"]).optional(),
      dataQuery: z.string().max(16_000).optional(),
    }).parse(request.query || {});
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const accessRules = await projectRepository.listActiveAccessRules();
    const kioskProfile = (request as FastifyRequest & { clusterKioskProfile?: { allowedProjectIds?: string[] } }).clusterKioskProfile;
    const canSeeProject = (project: any) => {
      const permissionVisible = Boolean(decorated?.isAdmin || hasTargetAccess(user, decorated?.workspaceRole, "project", project.id, project, accessRules, "view"));
      if (!permissionVisible) return false;
      return !kioskProfile?.allowedProjectIds?.length || kioskProfile.allowedProjectIds.includes(project.id);
    };

    if (query.paged || query.cursor) {
      const pageLimit = query.limit || Math.min(80, API_CONTRACT.pagination.projectsMaximum);
      const requestedDataQuery = parseClusterDataQueryParameter(query.dataQuery);
      const dataQuery = normalizeClusterDataQuery({ ...requestedDataQuery, page: { cursor: query.cursor || null, limit: pageLimit } }, { fields: PROJECT_DATA_FIELDS, defaultLimit: pageLimit, maxLimit: API_CONTRACT.pagination.projectsMaximum });
      const authorizationSeeds = decorated?.isAdmin && !kioskProfile?.allowedProjectIds?.length ? null : await prisma.project.findMany({
        where: decorated?.isAdmin ? {} : { archived: false },
        select: { id: true, source: true, archived: true, memberships: { where: { status: "active" } } },
      });
      const authorizedProjectIds = authorizationSeeds ? authorizationSeeds.filter(canSeeProject).map((project: any) => project.id) : null;
      const dataWhere = await buildProjectDataQueryWhere({ prisma, query: dataQuery, authorizedProjectIds, includeArchived: Boolean(decorated?.isAdmin) });
      const continuation = resolveSemanticCursor(dataQuery.sorts, PROJECT_SEMANTIC_CURSOR_FIELDS, { fieldId: "updatedAt", direction: "desc" });
      const page = await projectRepository.listProjectsPage({ includeArchived: Boolean(decorated?.isAdmin), limit: pageLimit, cursor: query.cursor || null, sort: continuation.cursor, where: dataWhere });
      const items = page.items.map((project: any) => serializeWithCapabilities(project, user, decorated, accessRules));
      const analytics = query.cursor ? null : await projectDataQueryAnalytics(prisma, dataWhere, dataQuery);
      reply.header("Cache-Control", "no-store");
      return {
        items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        dataView: {
          resourceKind: "project",
          fields: PROJECT_DATA_FIELDS,
          query: dataQuery,
          analytics,
          page: { nextCursor: page.nextCursor, hasMore: page.hasMore, cursorSupported: true },
          continuationSort: semanticContinuationSort(continuation.cursor),
          semanticSortApplied: continuation.requestedSortApplied,
        },
      };
    }

    const projects = await projectRepository.listProjects({
      includeArchived: Boolean(decorated?.isAdmin),
      limit: query.limit,
    });
    const visibleProjects = projects.filter(canSeeProject);
    const payload = visibleProjects.map((project: any) => serializeWithCapabilities(project, user, decorated, accessRules));
    return sendPrivateRevalidated(request, reply, payload);
  });
  app.get("/api/projects/snapshots", async (request, reply) => {
    const query = z.object({ ids: z.string().trim().max(12_000).optional() }).parse(request.query || {});
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const accessRules = await projectRepository.listActiveAccessRules();
    const kioskProfile = (request as FastifyRequest & { clusterKioskProfile?: { allowedProjectIds?: string[] } }).clusterKioskProfile;
    const requestedIds = query.ids ? [...new Set(query.ids.split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 250) : [];
    const projects = await prisma.project.findMany({
      where: requestedIds.length ? { id: { in: requestedIds } } : { archived: false },
      select: { id: true, source: true, archived: true, memberships: { where: { status: "active" } } },
      orderBy: { updatedAt: "desc" },
      take: requestedIds.length ? undefined : 250,
    });
    const visibleProjectIds = projects.filter((project: any) => {
      const permissionVisible = Boolean(decorated?.isAdmin || hasTargetAccess(user, decorated?.workspaceRole, "project", project.id, project, accessRules, "view"));
      if (!permissionVisible) return false;
      return !kioskProfile?.allowedProjectIds?.length || kioskProfile.allowedProjectIds.includes(project.id);
    }).map((project: any) => String(project.id));
    const snapshots = await projectSnapshots.snapshotsForRequest({ request, user, decorated, projectIds: visibleProjectIds });
    return sendPrivateRevalidated(request, reply, { schema: 1, generatedAt: new Date().toISOString(), snapshots });
  });

  app.get("/api/projects/:projectId/snapshot", async (request, reply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId }, select: { id: true, source: true, archived: true, memberships: { where: { status: "active" } } } });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const [snapshot] = await projectSnapshots.snapshotsForRequest({ request, user, decorated, projectIds: [project.id] });
    if (!snapshot) return reply.code(404).send({ ok: false, error: "Project snapshot unavailable." });
    return sendPrivateRevalidated(request, reply, snapshot);
  });

  app.get("/api/projects/:projectId/overview", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId }, include: { memberships: { where: { status: "active" } } } });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const role = decorated?.workspaceRole;
    const hasTool = (tool: string, level = "view") => Boolean(decorated?.isAdmin || hasToolPermission(user, role, tool, level));
    const canBoards = hasTool("boards");
    const canWhiteboards = hasTool("whiteboards");
    const canLibrary = hasTool("library");
    const canVideo = hasTool("viewer");
    const canCalendar = hasTool("calendar");
    const canTimeline = hasTool("timeline");
    const canScheduler = hasTool("scheduler");
    const canManageScheduler = hasTool("scheduler", "manage");
    const canActivity = hasTool("activity");
    const canBuilds = hasTool("builds");
    const canQa = hasTool("qa");
    const canPeople = hasTool("people");
    const now = new Date();
    const unrestrictedOverview = Boolean(decorated?.isAdmin || ["owner", "admin"].includes(String(role || "")));

    if (unrestrictedOverview) {
      const relationships = await prisma.projectRelationship.findMany({
        where: { projectId: project.id },
        select: { sourceType: true, sourceId: true, targetType: true, targetId: true, relationship: true, critical: true },
        take: 1000,
      });
      const referenced = new Map<string, Set<string>>();
      const addReferenced = (type: unknown, id: unknown) => {
        const kind = String(type || "").toLowerCase().replaceAll("-", "_");
        const targetId = String(id || "").trim();
        if (!targetId) return;
        const key = ["ticket"].includes(kind) ? "card" : ["column"].includes(kind) ? "list" : ["asset", "project_file"].includes(kind) ? "file" : kind;
        const set = referenced.get(key) || new Set<string>();
        set.add(targetId);
        referenced.set(key, set);
      };
      for (const relationship of relationships) {
        addReferenced(relationship.sourceType, relationship.sourceId);
        addReferenced(relationship.targetType, relationship.targetId);
      }
      const ids = (kind: string) => [...(referenced.get(kind) || new Set<string>())];
      const [cardMetricsRows, assetCountRows, validCards, validBoards, validLists, validWhiteboards, validFiles, validVideos, timeline, overdueTimelineCount, loggedTime, activity, buildGroups, qaPlanCount, qaSessionGroups] = await Promise.all([
        canBoards ? (prisma.$queryRawUnsafe(`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE l."isDone" = FALSE)::int AS open,
            count(*) FILTER (WHERE l."isDone" = TRUE)::int AS completed,
            count(*) FILTER (WHERE l."isDone" = FALSE AND c."dueDate" IS NOT NULL AND c."dueDate" < $2)::int AS overdue,
            count(*) FILTER (WHERE l."isDone" = FALSE AND c."priority" = 'urgent')::int AS urgent,
            count(*) FILTER (WHERE l."isDone" = FALSE AND (c."labels" ILIKE '%"blocked"%' OR c."labels" ILIKE '%"blocker"%'))::int AS blocked
          FROM "Card" c
          INNER JOIN "BoardList" l ON l."id" = c."listId"
          INNER JOIN "Board" b ON b."id" = l."boardId"
          WHERE b."projectId" = $1 AND b."archived" = FALSE AND c."archived" = FALSE
        `, project.id, now) as Promise<Array<Record<string, number | bigint | string>>>) : Promise.resolve([{ total: 0, open: 0, completed: 0, overdue: 0, urgent: 0, blocked: 0 }]),
        (prisma.$queryRawUnsafe(`
          SELECT
            (SELECT count(*)::int FROM "Board" WHERE "projectId" = $1 AND "archived" = FALSE) AS boards,
            (SELECT count(*)::int FROM "Whiteboard" WHERE "projectId" = $1) AS whiteboards,
            (SELECT count(*)::int FROM "ProjectFile" WHERE "projectId" = $1) AS files,
            (SELECT count(*)::int FROM "ReviewAsset" WHERE "projectId" = $1) AS videos
        `, project.id) as Promise<Array<Record<string, number | bigint | string>>>),
        canBoards && ids("card").length ? prisma.card.findMany({ where: { id: { in: ids("card") }, archived: false, list: { board: { projectId: project.id, archived: false } } }, select: { id: true } }) : Promise.resolve([]),
        canBoards && ids("board").length ? prisma.board.findMany({ where: { id: { in: ids("board") }, projectId: project.id, archived: false }, select: { id: true } }) : Promise.resolve([]),
        canBoards && ids("list").length ? prisma.boardList.findMany({ where: { id: { in: ids("list") }, board: { projectId: project.id, archived: false } }, select: { id: true } }) : Promise.resolve([]),
        canWhiteboards && ids("whiteboard").length ? prisma.whiteboard.findMany({ where: { id: { in: ids("whiteboard") }, projectId: project.id }, select: { id: true } }) : Promise.resolve([]),
        canLibrary && ids("file").length ? prisma.projectFile.findMany({ where: { id: { in: ids("file") }, projectId: project.id }, select: { id: true } }) : Promise.resolve([]),
        canVideo && ids("review_asset").length ? prisma.reviewAsset.findMany({ where: { id: { in: ids("review_asset") }, projectId: project.id }, select: { id: true } }) : Promise.resolve([]),
        canTimeline ? prisma.timelineItem.findMany({ where: { projectId: project.id, startsAt: { gte: new Date(now.getTime() - 1000 * 60 * 60 * 24) } }, orderBy: { startsAt: "asc" }, take: 8 }) : Promise.resolve([]),
        canTimeline ? prisma.timelineItem.count({ where: { projectId: project.id, startsAt: { lt: now }, type: { in: ["milestone", "deadline", "release", "build"] } } }) : Promise.resolve(0),
        canScheduler ? prisma.timeEntry.aggregate({ where: { projectId: project.id, ...(canManageScheduler ? {} : { userId: user?.id || "__none__" }) }, _sum: { durationMinutes: true } }) : Promise.resolve({ _sum: { durationMinutes: null } }),
        canActivity ? prisma.activityEvent.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: { id: true, type: true, entityType: true, title: true, message: true, createdAt: true, user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        }) : Promise.resolve([]),
        canBuilds ? prisma.deliveryBuild.groupBy({ by: ["qaStatus", "approval"], where: { projectId: project.id, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
        canQa ? prisma.deliveryQaPlan.count({ where: { projectId: project.id, archived: false } }) : Promise.resolve(0),
        canQa ? prisma.deliveryQaSession.groupBy({ by: ["status", "decision"], where: { projectId: project.id, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
      ]);
      const toNumber = (value: unknown) => Number(value || 0);
      const cardMetrics = cardMetricsRows[0] || {};
      const assetCounts = assetCountRows[0] || {};
      const buildTotal = (buildGroups as any[]).reduce((sum, row) => sum + toNumber(row?._count?._all), 0);
      const failedBuilds = (buildGroups as any[]).reduce((sum, row) => sum + ((row.qaStatus === "failed" || row.approval === "blocked") ? toNumber(row?._count?._all) : 0), 0);
      const qaSessions = (qaSessionGroups as any[]).reduce((sum, row) => sum + toNumber(row?._count?._all), 0);
      const qaAttention = (qaSessionGroups as any[]).reduce((sum, row) => sum + (["failed", "blocked"].includes(String(row.status || "").toLowerCase()) || String(row.decision || "").toLowerCase() === "no-go" ? toNumber(row?._count?._all) : 0), 0);
      const deliveryLifecycle = canBuilds ? await deliveryLifecycleService.snapshot(project.id) : null;
      const validCardIds = new Set((validCards as any[]).map((row) => String(row.id)));
      const validBoardIds = new Set((validBoards as any[]).map((row) => String(row.id)));
      const validListIds = new Set((validLists as any[]).map((row) => String(row.id)));
      const validWhiteboardIds = new Set((validWhiteboards as any[]).map((row) => String(row.id)));
      const validFileIds = new Set((validFiles as any[]).map((row) => String(row.id)));
      const validVideoIds = new Set((validVideos as any[]).map((row) => String(row.id)));
      const relationshipEndpointVisible = (type: unknown, id: unknown) => {
        const kind = String(type || "").toLowerCase().replaceAll("-", "_");
        const targetId = String(id || "");
        if (kind === "project") return targetId === String(project.id);
        if (["card", "ticket"].includes(kind)) return canBoards && validCardIds.has(targetId);
        if (kind === "board") return canBoards && validBoardIds.has(targetId);
        if (["list", "column"].includes(kind)) return canBoards && validListIds.has(targetId);
        if (kind === "whiteboard") return canWhiteboards && validWhiteboardIds.has(targetId);
        if (["file", "asset", "project_file"].includes(kind)) return canLibrary && validFileIds.has(targetId);
        if (kind === "review_asset") return canVideo && validVideoIds.has(targetId);
        if (["calendar", "calendar_event"].includes(kind)) return canCalendar;
        if (["build", "buildartifact", "build_artifact", "release"].includes(kind)) return canBuilds;
        if (["qa", "qaplan", "qa_plan", "qasession", "qa_session"].includes(kind)) return canQa;
        if (["timeline", "timelineitem", "timeline_item"].includes(kind)) return canTimeline;
        if (["time", "timeentry", "time_entry", "schedule", "scheduleblock", "schedule_block"].includes(kind)) return canScheduler;
        return false;
      };
      const visibleRelationships = relationships.filter((relationship: any) => relationshipEndpointVisible(relationship.sourceType, relationship.sourceId) && relationshipEndpointVisible(relationship.targetType, relationship.targetId));
      const totalCards = toNumber(cardMetrics.total);
      const completedCards = toNumber(cardMetrics.completed);
      return {
        projectId: project.id,
        generatedAt: now.toISOString(),
        progress: totalCards ? Math.round((completedCards / totalCards) * 100) : 0,
        cards: { total: totalCards, open: toNumber(cardMetrics.open), completed: completedCards, overdue: toNumber(cardMetrics.overdue), urgent: toNumber(cardMetrics.urgent), blocked: toNumber(cardMetrics.blocked) },
        assets: { boards: canBoards ? toNumber(assetCounts.boards) : 0, whiteboards: canWhiteboards ? toNumber(assetCounts.whiteboards) : 0, files: canLibrary ? toNumber(assetCounts.files) : 0, videos: canVideo ? toNumber(assetCounts.videos) : 0 },
        timeline: { upcoming: timeline, overdue: toNumber(overdueTimelineCount) },
        time: { loggedMinutes: loggedTime._sum.durationMinutes || 0 },
        workflow: {
          builds: { total: buildTotal, failed: failedBuilds, releaseReady: deliveryLifecycle?.releaseReady ? 1 : 0 },
          delivery: deliveryLifecycle ? {
            ready: Boolean(deliveryLifecycle.releaseReady),
            recommendedAction: String(deliveryLifecycle.recommendedAction || ""),
            blocked: Number(deliveryLifecycle.readiness?.blocked || 0),
            activeHold: Boolean(deliveryLifecycle.readiness?.activeHold),
            channel: String(deliveryLifecycle.readiness?.channel || "internal"),
            published: String(deliveryLifecycle.release?.status || "").toLowerCase() === "published",
            releaseId: deliveryLifecycle.release?.id || null,
            latestBuildId: deliveryLifecycle.latestBuild?.id || null,
          } : null,
          qa: { plans: toNumber(qaPlanCount), sessions: qaSessions, attention: qaAttention },
          relationships: { total: visibleRelationships.length, blockers: visibleRelationships.filter((relationship: any) => ["blocks", "blocked_by", "depends_on"].includes(String(relationship.relationship || "").toLowerCase())).length, critical: visibleRelationships.filter((relationship: any) => relationship.critical).length },
          team: { assigned: canPeople ? (project.memberships || []).length : 0 },
        },
        activity,
      };
    }

    const accessRules = await projectRepository.listActiveAccessRulesForProject(project.id);
    const [boards, whiteboards, files, videos, timelineCandidates, overdueTimelineCandidates, loggedTime, activityCandidates, builds, qaPlans, qaSessions, relationships] = await Promise.all([
      canBoards ? prisma.board.findMany({
        where: { projectId: project.id, archived: false },
        select: {
          id: true,
          lists: {
            select: {
              id: true,
              isDone: true,
              cards: {
                where: { archived: false },
                select: { id: true, priority: true, dueDate: true, labels: true, workItemKind: true },
              },
            },
          },
        },
      }) : Promise.resolve([]),
      canWhiteboards ? prisma.whiteboard.findMany({ where: { projectId: project.id }, select: { id: true, projectId: true } }) : Promise.resolve([]),
      canLibrary ? prisma.projectFile.findMany({ where: { projectId: project.id }, select: { id: true, projectId: true } }) : Promise.resolve([]),
      canVideo ? prisma.reviewAsset.findMany({ where: { projectId: project.id }, select: { id: true, projectId: true } }) : Promise.resolve([]),
      canTimeline ? prisma.timelineItem.findMany({
        where: { projectId: project.id, startsAt: { gte: new Date(now.getTime() - 1000 * 60 * 60 * 24) } },
        orderBy: { startsAt: "asc" },
        take: 8,
      }) : Promise.resolve([]),
      canTimeline ? prisma.timelineItem.count({ where: { projectId: project.id, startsAt: { lt: now }, type: { in: ["milestone", "deadline", "release", "build"] } } }) : Promise.resolve(0),
      canScheduler ? prisma.timeEntry.aggregate({ where: { projectId: project.id, ...(canManageScheduler ? {} : { userId: user?.id || "__none__" }) }, _sum: { durationMinutes: true } }) : Promise.resolve({ _sum: { durationMinutes: null } }),
      canActivity ? prisma.activityEvent.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 48,
        select: {
          id: true, userId: true, projectId: true, boardId: true, whiteboardId: true, cardId: true, type: true, entityType: true, entityId: true, title: true, message: true, createdAt: true,
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          project: { select: { id: true, source: true, memberships: { where: { status: "active", userId: user?.id || "__none__" }, select: { userId: true, roleKey: true, roleLabel: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true } } } },
          card: { select: { id: true, workItemKind: true, list: { select: { board: { select: { id: true, project: { select: { id: true, source: true, memberships: { where: { status: "active", userId: user?.id || "__none__" }, select: { userId: true, roleKey: true, roleLabel: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true } } } } } } } } } },
        },
      }) : Promise.resolve([]),
      canBuilds ? prisma.deliveryBuild.groupBy({ by: ["qaStatus", "approval"], where: { projectId: project.id, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
      canQa ? prisma.deliveryQaPlan.count({ where: { projectId: project.id, archived: false } }) : Promise.resolve(0),
      canQa ? prisma.deliveryQaSession.groupBy({ by: ["status", "decision"], where: { projectId: project.id, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
      prisma.projectRelationship.findMany({
        where: { projectId: project.id },
        select: { sourceType: true, sourceId: true, targetType: true, targetId: true, relationship: true, critical: true },
        take: 1000,
      }),
    ]);
    const canView = (kind: string, target: any) => Boolean(decorated?.isAdmin || hasTargetAccess(user, role, kind, target.id, project, accessRules, "view"));
    const visibleBoards = canBoards ? boards.filter((board: any) => canView("board", board)) : [];
    const visibleWhiteboards = canWhiteboards ? whiteboards.filter((item: any) => canView("whiteboard", item)) : [];
    const visibleFiles = canLibrary ? files.filter((item: any) => canView("file", item)) : [];
    const visibleVideos = canVideo ? videos.filter((item: any) => canView("review_asset", item)) : [];
    const cardCandidates = visibleBoards.flatMap((board: any) => board.lists.flatMap((list: any) => list.cards.map((card: any) => ({ ...card, boardId: board.id, done: Boolean(list.isDone) }))));
    const cards = await authorization.filterCardsForRequest(request, cardCandidates, project, "view", accessRules);
    const timeline = canTimeline ? timelineCandidates.slice(0, 8) : [];
    const overdueTimelineCount = canTimeline ? Number(overdueTimelineCandidates || 0) : 0;
    const visibleActivity = canActivity ? (await authorization.filterActivityEventsForRequest(request, activityCandidates, "view")).slice(0, 12) : [];
    const activity = visibleActivity.map((event: any) => ({ id: event.id, type: event.type, entityType: event.entityType, title: event.title, message: event.message, createdAt: event.createdAt, user: event.user || null }));
    const completed = cards.filter((card: any) => card.done).length;
    const open = cards.length - completed;
    const overdue = cards.filter((card: any) => !card.done && card.dueDate && new Date(card.dueDate).getTime() < now.getTime()).length;
    const urgent = cards.filter((card: any) => !card.done && card.priority === "urgent").length;
    const blocked = cards.filter((card: any) => !card.done && parseLabels(card.labels).some((label) => ["blocked", "blocker"].includes(label.toLowerCase()))).length;
    const buildTotal = (builds as any[]).reduce((sum, record) => sum + Number(record?._count?._all || 0), 0);
    const failedBuilds = (builds as any[]).reduce((sum, record) => sum + ((record.qaStatus === "failed" || record.approval === "blocked") ? Number(record?._count?._all || 0) : 0), 0);
    const deliveryLifecycle = canBuilds ? await deliveryLifecycleService.snapshot(project.id) : null;
    const releaseReadyBuilds = deliveryLifecycle?.releaseReady ? 1 : 0;
    const qaSessionCount = (qaSessions as any[]).reduce((sum, record) => sum + Number(record?._count?._all || 0), 0);
    const qaAttention = (qaSessions as any[]).reduce((sum, record) => sum + (["failed", "blocked"].includes(String(record.status || "").toLowerCase()) || String(record.decision || "").toLowerCase() === "no-go" ? Number(record?._count?._all || 0) : 0), 0);
    const visibleCardIds = new Set(cards.map((card: any) => String(card.id)));
    const visibleBoardIds = new Set(visibleBoards.map((board: any) => String(board.id)));
    const visibleListIds = new Set(visibleBoards.flatMap((board: any) => (board.lists || []).map((list: any) => String(list.id))));
    const visibleWhiteboardIds = new Set(visibleWhiteboards.map((item: any) => String(item.id)));
    const visibleFileIds = new Set(visibleFiles.map((item: any) => String(item.id)));
    const visibleVideoIds = new Set(visibleVideos.map((item: any) => String(item.id)));
    const referencedCalendarIds = [...new Set(relationships.flatMap((relationship: any) => [relationship.sourceType, relationship.targetType].some((type: any) => ["calendar", "calendar_event"].includes(String(type || "").toLowerCase().replaceAll("-", "_"))) ? [
      ["calendar", "calendar_event"].includes(String(relationship.sourceType || "").toLowerCase().replaceAll("-", "_")) ? String(relationship.sourceId || "") : "",
      ["calendar", "calendar_event"].includes(String(relationship.targetType || "").toLowerCase().replaceAll("-", "_")) ? String(relationship.targetId || "") : "",
    ] : []).filter(Boolean))];
    const visibleCalendarRelationshipIds = new Set<string>();
    if (canCalendar && referencedCalendarIds.length) {
      const calendarCandidates = await prisma.calendarEvent.findMany({ where: { id: { in: referencedCalendarIds }, projectId: project.id }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      for (const event of calendarCandidates) if (await canAccessCalendarEvent(authorization, request, event, "view")) visibleCalendarRelationshipIds.add(String(event.id));
    }
    const relationshipEndpointVisible = (type: unknown, id: unknown) => {
      const kind = String(type || "").toLowerCase().replaceAll("-", "_");
      const targetId = String(id || "");
      if (kind === "project") return targetId === String(project.id);
      if (["card", "ticket"].includes(kind)) return visibleCardIds.has(targetId);
      if (kind === "board") return visibleBoardIds.has(targetId);
      if (["list", "column"].includes(kind)) return visibleListIds.has(targetId);
      if (kind === "whiteboard") return visibleWhiteboardIds.has(targetId);
      if (["file", "asset", "project_file"].includes(kind)) return visibleFileIds.has(targetId);
      if (["review_asset"].includes(kind)) return visibleVideoIds.has(targetId);
      if (["calendar", "calendar_event"].includes(kind)) return visibleCalendarRelationshipIds.has(targetId);
      if (["build", "buildartifact", "build_artifact", "release"].includes(kind)) return canBuilds && canView("build", { id: targetId });
      if (["qa", "qaplan", "qa_plan", "qasession", "qa_session"].includes(kind)) return canQa && canView("qa", { id: targetId });
      if (["timeline", "timelineitem", "timeline_item"].includes(kind)) return canTimeline && canView("timeline", { id: targetId });
      if (["time", "timeentry", "time_entry", "schedule", "scheduleblock", "schedule_block"].includes(kind)) return canScheduler && canView(kind.startsWith("schedule") ? "schedule" : "time", { id: targetId });
      return false;
    };
    const visibleRelationships = relationships.filter((relationship: any) => relationshipEndpointVisible(relationship.sourceType, relationship.sourceId) && relationshipEndpointVisible(relationship.targetType, relationship.targetId));
    const blockerRelationships = visibleRelationships.filter((relationship: any) => ["blocks", "blocked_by", "depends_on"].includes(String(relationship.relationship || "").toLowerCase())).length;
    const assignedCount = canPeople ? (project.memberships || []).length : 0;
    return {
      projectId: project.id,
      generatedAt: now.toISOString(),
      progress: cards.length ? Math.round((completed / cards.length) * 100) : 0,
      cards: { total: cards.length, open, completed, overdue, urgent, blocked },
      assets: { boards: visibleBoards.length, whiteboards: visibleWhiteboards.length, files: visibleFiles.length, videos: visibleVideos.length },
      timeline: { upcoming: timeline, overdue: overdueTimelineCount },
      time: { loggedMinutes: loggedTime._sum.durationMinutes || 0 },
      workflow: {
        builds: { total: buildTotal, failed: failedBuilds, releaseReady: releaseReadyBuilds },
        delivery: deliveryLifecycle ? {
          ready: Boolean(deliveryLifecycle.releaseReady),
          recommendedAction: String(deliveryLifecycle.recommendedAction || ""),
          blocked: Number(deliveryLifecycle.readiness?.blocked || 0),
          activeHold: Boolean(deliveryLifecycle.readiness?.activeHold),
          channel: String(deliveryLifecycle.readiness?.channel || "internal"),
          published: String(deliveryLifecycle.release?.status || "").toLowerCase() === "published",
          releaseId: deliveryLifecycle.release?.id || null,
          latestBuildId: deliveryLifecycle.latestBuild?.id || null,
        } : null,
        qa: { plans: Number(qaPlans || 0), sessions: qaSessionCount, attention: qaAttention },
        relationships: { total: visibleRelationships.length, blockers: blockerRelationships, critical: visibleRelationships.filter((relationship: any) => relationship.critical).length },
        team: { assigned: assignedCount },
      },
      activity,
    };
  });
  app.post("/api/projects", async (request) => {
    const user = await getCurrentUser(request);
    const workspace = await prisma.workspace.findFirst();
    if (!workspace) {
      throw createHttpError("WORKSPACE_NOT_READY", "No workspace exists. Complete setup before creating projects.", 409);
    }
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        externalName: z.string().trim().max(200).optional().nullable(),
        codename: z.string().trim().max(120).optional().nullable(),
        aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
        description: z.string().optional().nullable(),
        objective: z.string().max(4000).optional().nullable(),
        clientName: z.string().max(160).optional().nullable(),
        startDate: z.coerce.date().optional().nullable(),
        targetDate: z.coerce.date().optional().nullable(),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
        tags: z.array(z.string().trim().min(1).max(48)).max(24).optional().default([]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
        healthNote: z.string().max(1000).optional().nullable(),
        memberRoles: z.record(z.string().max(80)).optional().default({}),
        projectType: z.string().min(1).max(64).default("general"),
        productionProfile: z.string().min(1).max(64).optional(),
        blueprintKey: z.string().trim().max(120).optional().nullable(),
        workspacePresetKey: z.string().trim().max(120).optional().nullable(),
        provisioningKey: z.string().trim().min(8).max(160).optional().nullable(),
        status: z.enum(CLUSTER_PROJECT_STATUSES).default("active"),
        external: z.boolean().default(false),
        createDefaultBoard: z.boolean().default(true),
        boardName: z.string().optional().default("Main Board"),
        createWhiteboard: z.boolean().default(false),
        whiteboardName: z.string().optional().nullable(),
        whiteboardDescription: z.string().optional().nullable(),
        whiteboardCanvasWidth: z.number().int().min(600).max(4000).optional(),
        whiteboardCanvasHeight: z.number().int().min(400).max(2400).optional(),
        createLibraryFolder: z.boolean().default(true),
        libraryFolderName: z.string().optional().nullable(),
        libraryFolderDescription: z.string().optional().nullable(),
        libraryFolderUrl: z.string().optional().nullable(),
        memberIds: z.array(z.string().trim().min(1)).min(1, "Project lead is required."),
        productionTracks: z.array(z.string()).optional(),
        boardColumns: z.array(z.string()).optional(),
        projectTypeTemplate: z.string().trim().min(1).max(120).optional().nullable(),
        sourceControl: z.enum(["auto", "enabled", "disabled"]).default("auto"),
      })
      .parse(request.body);
    if (body.startDate && body.targetDate && body.targetDate.getTime() < body.startDate.getTime()) {
      throw createHttpError("VALIDATION_FAILED", "Project target date must be on or after the start date.", 400);
    }
    const leadIds = unique(body.memberIds.map((value) => value.trim()).filter(Boolean));
    for (const [userId, value] of Object.entries(body.memberRoles)) {
      if (!leadIds.includes(userId)) continue;
      if (!resolveClusterProjectRole(value)) return reply.code(400).send({ ok: false, code: "PROJECT_ROLE_INVALID", error: `Unsupported role for project member ${userId}.` });
    }
    if (leadIds.slice(1).some((id: string) => resolveClusterProjectRole(body.memberRoles[id])?.key === "lead")) {
      return reply.code(400).send({ ok: false, code: "MULTIPLE_PROJECT_LEADS", error: "Only the first selected member can be Project Lead. Choose Producer for additional managers." });
    }
    const validLeads = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: workspace.id,
        userId: { in: leadIds },
        user: { archived: false },
      },
      select: { userId: true },
    });
    if (validLeads.length !== leadIds.length) {
      throw createHttpError("PROJECT_LEAD_REQUIRED", "Select an active workspace member as the project lead.", 400);
    }
    try {
      await verifyStorage();
    } catch (error) {
      app.log.error({ err: error }, "project create storage preflight failed");
      throw createHttpError("STORAGE_VERIFY_FAILED", "Cluster could not verify the PostgreSQL schema for project creation.", 500);
    }
    const projectType = normalizeProjectType(body.projectType);
    const configuredType = await configuredProjectType(projectType);
    const productionProfile = resolveClusterProductionProfile(body.productionProfile || "generic", configuredType);
    const enabledProfiles = (await import("@cluster/shared")).enabledClusterProductionProfiles((await readSettings()).studioEnabledProductionProfileIds, configuredType);
    if (!enabledProfiles.some((profile) => profile.id === (body.productionProfile || "generic"))) {
      throw createHttpError("PROJECT_TECHNOLOGY_DISABLED", "Enable this technology profile in Studio Settings before creating a Project with it.", 400);
    }
    const productionBehaviorType = resolveClusterProjectDefinitionForProfile(configuredType, productionProfile.id);
    const sourcePlan = projectSourceControlPlan(configuredType, productionProfile.id, body.sourceControl);
    const projectCapabilities = sourcePlan.capabilities;
    const sourceControlDefaults = sourcePlan.defaults;
    if (sourcePlan.required && body.sourceControl === "disabled") throw createHttpError("PROJECT_SOURCE_REQUIRED", `${configuredType.label} projects require Cluster Source Control.`, 400);
    const shouldProvisionSource = sourcePlan.shouldProvision;
    const columns =
      Array.isArray(body.boardColumns) && body.boardColumns.length
        ? body.boardColumns
            .map((item: unknown) => String(item).trim())
            .filter(Boolean)
            .slice(0, 12)
        : productionBehaviorType.boardColumns || configuredType.boardColumns;
    let project: any;
    try {
      project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: body.name,
        externalName: body.externalName || null,
        codename: body.codename || null,
        aliases: JSON.stringify(unique(body.aliases)),
        description: body.description || null,
        objective: body.objective || null,
        clientName: body.clientName || null,
        startDate: body.startDate || null,
        targetDate: body.targetDate || null,
        priority: body.priority,
        tags: JSON.stringify(unique(body.tags)),
        color: body.color || null,
        healthNote: body.healthNote || null,
        projectType,
        productionProfile: productionProfile.id,
        blueprintKey: body.blueprintKey || body.projectTypeTemplate || null,
        workspacePresetKey: body.workspacePresetKey || "standard",
        provisioningKey: body.provisioningKey || null,
        status: normalizeProjectStatus(body.status),
        productionTracks: JSON.stringify(
          (body.productionTracks?.length ? body.productionTracks : Array.from(new Set([...(configuredType.tracks || []), ...(productionProfile.tracks || [])])))
            .map((item: unknown) => String(item).trim())
            .filter(Boolean)
            .slice(0, 12),
        ),
        memberships: {
          create: leadIds.map((userId: string, index: number) => {
            const isLead = index === 0;
            const role = requireClusterProjectRole(isLead ? "lead" : body.memberRoles?.[userId] || "contributor");
            return { userId, roleKey: role.key, roleLabel: role.label, isLead, accessLevel: role.accessLevel, allocationPercent: 100, status: "active" };
          }),
        },
        source: body.external ? "external" : "manual",
        boards: body.createDefaultBoard
          ? {
              create: {
                name: body.boardName || "Main Board",
                      lists: {
                  create: columns.map((title: string, position: number) => ({
                    title,
                    position,
                    isDone: ["Done", "Approved", "Release", "Publish"].includes(title),
                  })),
                },
              },
            }
          : undefined,
        whiteboards: body.createWhiteboard
          ? {
              create: {
                name: body.whiteboardName?.trim() || `${body.name} Whiteboard`,
                description: body.whiteboardDescription?.trim() || body.description || null,
                elements: "[]",
                canvasWidth: body.whiteboardCanvasWidth || 1800,
                canvasHeight: body.whiteboardCanvasHeight || 950,
              },
            }
          : undefined,
      },
      include: {
        boards: { include: { lists: true } },
        whiteboards: true,
        memberships: { where: { status: "active" }, orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      },
      });
    } catch (error) {
      app.log.error({ err: error }, "project workspace creation failed");
      const detail = error instanceof Error ? error.message : "";
      if (/P2021|P2022|relation .+ does not exist|column .+ does not exist|schema|migration/i.test(detail)) {
        throw createHttpError("STORAGE_SCHEMA_OUT_OF_DATE", "Project storage is missing required database fields. Run Verify storage, restart Cluster if requested, and retry.", 503);
      }
      throw createHttpError("PROJECT_CREATE_FAILED", "Cluster could not create the project workspace. No project was saved.", 500);
    }
    let provisionedSource: any = null;
    if (shouldProvisionSource) {
      try {
        if (!gitRuntime) throw new Error("Cluster Git runtime is unavailable.");
        const projectDirectory = await projectStorageDirectory(prisma, deps.dataLayout, project.id);
        provisionedSource = await provisionClusterManagedProjectRepository({ prisma, gitRuntime, workspaceId: workspace.id, project, projectDirectory, definition: configuredType, productionProfile: productionProfile.id, defaults: sourceControlDefaults });
        project.sourceBindings = [{ ...provisionedSource.binding, repository: provisionedSource.repository }];
      } catch (error) {
        app.log.error({ err: error, projectId: project.id }, "project source-control provisioning failed");
        await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
        throw createHttpError("PROJECT_SOURCE_PROVISION_FAILED", "Cluster could not provision the project repository. The project was rolled back and no partial workspace was kept.", 500);
      }
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: "project", entityId: project.id, title: "Project created", message: project.name, metadata: { sourceControl: shouldProvisionSource ? "provisioned" : projectCapabilities.sourceControl, repositoryId: provisionedSource?.repository?.id || null } });
    if (provisionedSource) await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: "source_repository", entityId: provisionedSource.repository.id, title: "Project repository created", message: `${provisionedSource.repository.name} · ${provisionedSource.initialized.defaultBranch}`, metadata: { hostingMode: "cluster", lfs: provisionedSource.initialized.lfs, projectType: configuredType.id } });
    const starterWhiteboard = project.whiteboards?.[0];
    if (starterWhiteboard) {
      await logActivity({
        userId: user?.id,
        projectId: project.id,
        whiteboardId: starterWhiteboard.id,
        type: "created",
        entityType: "whiteboard",
        entityId: starterWhiteboard.id,
        title: "Starter whiteboard created",
        message: starterWhiteboard.name,
      });
    }
    let libraryFolder: any = null;
    const creationWarnings: Array<{ code: string; message: string }> = [];
    if (body.createLibraryFolder) {
      try {
        libraryFolder = await prisma.libraryItem.create({
        data: {
          projectId: project.id,
          ownerId: user?.id || null,
          title: body.libraryFolderName?.trim() || `${body.name} Library`,
          body: body.libraryFolderDescription?.trim() || body.description || "Project-bound library folder for specs, references, decisions, links, and shared context.",
          type: "folder",
          status: "active",
          priority: "medium",
          tags: JSON.stringify(unique(["project-library", "folder", projectType])),
          externalUrl: body.libraryFolderUrl ? safeUrl(body.libraryFolderUrl, "Library folder URL") : null,
          pinned: true,
          source: "project-folder",
        },
        include: { project: { include: { memberships: { where: { status: "active" } } } }, owner: true, reviewer: true },
      });
      await prisma.project.update({ where: { id: project.id }, data: { libraryFolderId: libraryFolder.id } });
      project.libraryFolderId = libraryFolder.id;
      for (const userId of leadIds) {
        await (prisma as any).folderPermission.upsert({
          where: { folderId_userId: { folderId: libraryFolder.id, userId } },
          update: { access: "manage" },
          create: { folderId: libraryFolder.id, userId, access: "manage" },
        });
      }
      await logActivity({
        userId: user?.id,
        projectId: project.id,
        type: "created",
        entityType: "library",
        entityId: libraryFolder.id,
        title: "Bound library folder created",
        message: libraryFolder.title,
        metadata: { type: libraryFolder.type, status: libraryFolder.status },
      });
    } catch (error) {
      app.log.error({ err: error, projectId: project.id }, "project library folder creation deferred");
        creationWarnings.push({
          code: "PROJECT_LIBRARY_DEFERRED",
          message: "The project was created, but its linked Library folder could not be created. Verify storage from Server Configuration, then open the project Library to retry.",
        });
      }
    }
    if (body.projectTypeTemplate && (configuredType.workspaceEntities || []).length) {
      const availableTemplate = (configuredType.productionTemplates || []).find((template: string) => template.toLowerCase() === body.projectTypeTemplate!.toLowerCase());
      if (!availableTemplate) {
        creationWarnings.push({ code: "PROJECT_TYPE_TEMPLATE_INVALID", message: `The project was created, but ${body.projectTypeTemplate} is no longer available for ${configuredType.label}.` });
      } else {
        try {
          const seeds = projectTypeTemplateSeeds(configuredType, availableTemplate).slice(0, 20);
          for (const [index, seed] of seeds.entries()) {
            const entity = (configuredType.workspaceEntities || []).find((item: any) => item.id === seed.entityKind);
            if (!entity) continue;
            const status = seed.status && entity.statuses.includes(seed.status) ? seed.status : entity.defaultStatus;
            const stage = seed.stage && configuredType.deliveryStages?.includes(seed.stage) ? seed.stage : entity.stage || null;
            await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: entity.baseKind, title: seed.title, description: seed.description || null, status, priority: seed.priority || "medium", category: `type-workspace:${configuredType.id}:${entity.id}`, completedAt: ["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"].includes(String(status).toLowerCase()) ? new Date() : null, progress: ["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"].includes(String(status).toLowerCase()) ? 100 : 0, sortOrder: index * 100, payload: JSON.stringify({ ...(seed.payload || {}), projectTypeId: configuredType.id, projectTypeEntityKind: entity.id, projectTypeEntityLabel: entity.label, projectTypeStage: stage, projectTypeTemplate: availableTemplate, seededAtCreation: true }) } });
          }
          await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: "project_type_template", entityId: project.id, title: `${configuredType.label} project initialized`, message: availableTemplate, metadata: { projectTypeId: configuredType.id, template: availableTemplate, dashboardWidgets: configuredType.dashboardWidgets || [], stageOwnership: configuredType.stageOwnership || {} } });
        } catch (error) {
          app.log.error({ err: error, projectId: project.id }, "project type creation template deferred");
          creationWarnings.push({ code: "PROJECT_TYPE_TEMPLATE_DEFERRED", message: `The project was created, but its ${configuredType.label} starter workflow could not be initialized. Apply ${availableTemplate} from the Project production workspace.` });
        }
      }
    }
    const decorated = await decorateUserForClient(user);
    const accessRules = decorated?.isAdmin ? [] : await projectRepository.listActiveAccessRulesForProject(project.id);
    return { ...serializeWithCapabilities(project, user, decorated, accessRules), creationWarnings, projectTypeSetup: { typeId: configuredType.id, capabilities: projectCapabilities, sourceControlDefaults, sourceControlProvisioned: Boolean(provisionedSource), repositoryId: provisionedSource?.repository?.id || null, defaultTools: configuredType.defaultTools || [], optionalTools: configuredType.optionalTools || [], dashboardWidgets: configuredType.dashboardWidgets || [], stageOwnership: configuredType.stageOwnership || {}, productionTemplate: body.projectTypeTemplate || null } };
  });
  app.patch("/api/projects/:projectId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        externalName: z.string().trim().max(200).optional().nullable(),
        codename: z.string().trim().max(120).optional().nullable(),
        aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
        description: z.string().optional().nullable(),
        objective: z.string().max(4000).optional().nullable(),
        clientName: z.string().max(160).optional().nullable(),
        startDate: z.coerce.date().optional().nullable(),
        targetDate: z.coerce.date().optional().nullable(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
        healthNote: z.string().max(1000).optional().nullable(),
        memberRoles: z.record(z.string().max(80)).optional(),
        projectType: z.string().min(1).max(64).optional(),
        productionProfile: z.string().min(1).max(64).optional(),
        blueprintKey: z.string().trim().max(120).optional().nullable(),
        workspacePresetKey: z.string().trim().max(120).optional().nullable(),
        status: z.enum(CLUSTER_PROJECT_STATUSES).optional(),
        external: z.boolean().optional(),
        memberIds: z.array(z.string()).optional(),
        archived: z.boolean().optional(),
        pin: z.string().optional(),
        expectedRevision: z.number().int().positive().optional(),
      })
      .parse(request.body);
    const existingProject = await prisma.project.findUnique({
      where: { id: params.projectId },
      include: { memberships: { where: { status: "active" }, orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] } },
    });
    if (!existingProject) {
      reply.code(404).send({ ok: false, error: "Project not found." });
      return;
    }
    const decorated = await decorateUserForClient(user);
    const role = decorated?.workspaceRole;
    const accessRules = decorated?.isAdmin ? [] : await projectRepository.listActiveAccessRulesForProject(existingProject.id);
    const canManageProject = Boolean(decorated?.isAdmin || hasTargetAccess(user, role, "project", existingProject.id, existingProject, accessRules, "manage"));
    const changedKeys = Object.keys(body).filter((key) => (body as any)[key] !== undefined);
    const touchesProjectManagementFields = body.memberIds !== undefined || body.memberRoles !== undefined;
    const touchesAdminOnlyFields = body.projectType !== undefined;
    const changesArchiveState = body.archived !== undefined && Boolean(body.archived) !== Boolean(existingProject.archived);
    const changesNonArchiveFields = changedKeys.some((key) => !["archived", "pin", "expectedRevision"].includes(key));
    if (touchesAdminOnlyFields && !decorated?.isAdmin) {
      reply.code(403).send({ ok: false, code: "PROJECT_TYPE_ADMIN_REQUIRED", error: "Admin role required to change the project type." });
      return;
    }
    if (touchesProjectManagementFields && !canManageProject) {
      reply.code(403).send({ ok: false, code: "PROJECT_MANAGE_REQUIRED", error: "Project manage permission required to change the project team or project roles." });
      return;
    }
    if (changesArchiveState && !canManageProject) {
      reply.code(403).send({ ok: false, code: "PROJECT_MANAGE_REQUIRED", error: "Project manage permission required to archive or restore this project." });
      return;
    }
    if (changesNonArchiveFields && !hasToolPermission(user, role, "projects", "edit") && !canManageProject) {
      reply.code(403).send({ ok: false, code: "PROJECT_EDIT_REQUIRED", error: "Project edit or project manage permission required." });
      return;
    }

    const effectiveStart = body.startDate === undefined ? existingProject.startDate : body.startDate;
    const effectiveTarget = body.targetDate === undefined ? existingProject.targetDate : body.targetDate;
    if (effectiveStart && effectiveTarget && new Date(effectiveTarget).getTime() < new Date(effectiveStart).getTime()) {
      reply.code(400).send({ ok: false, error: "Project target date must be on or after the start date." });
      return;
    }
    if (body.memberIds) {
      const memberIds = unique(body.memberIds);
      const activeMembers = await prisma.workspaceMember.findMany({
        where: { workspaceId: existingProject.workspaceId, userId: { in: memberIds }, user: { archived: false } },
        select: { userId: true },
      });
      if (activeMembers.length !== memberIds.length) {
        reply.code(400).send({ ok: false, error: "Project team members must be active workspace members." });
        return;
      }
      body.memberIds = memberIds;
      if (body.memberRoles) body.memberRoles = Object.fromEntries(Object.entries(body.memberRoles).filter(([userId]) => memberIds.includes(userId)));
    }
    // Reject invalid/project-lead changes BEFORE incrementing the Project revision.
    // A failed crew write must never leave the Project header committed alone.
    if (touchesProjectManagementFields) {
      const newIds = body.memberIds || (existingProject.memberships || []).map((row: any) => row.userId);
      const existingRoles = Object.fromEntries((existingProject.memberships || []).map((row: any) => [row.userId, row.roleKey || "contributor"]));
      const proposedRoles: Record<string, string> = { ...existingRoles, ...(body.memberRoles || {}) };
      if (!newIds.length) return reply.code(400).send({ ok: false, code: "PROJECT_LEAD_REQUIRED", error: "At least one project member is required." });
      const selected = newIds.map((id: string) => ({ id, role: resolveClusterProjectRole(proposedRoles[id] || "contributor") }));
      if (selected.some((item: any) => !item.role)) return reply.code(400).send({ ok: false, code: "PROJECT_ROLE_INVALID", error: "Choose a supported role for every Project member." });
      if (selected.filter((item: any) => item.role.key === "lead").length > 1) return reply.code(400).send({ ok: false, code: "MULTIPLE_PROJECT_LEADS", error: "Select exactly one Project Lead." });
    }
    if (body.expectedRevision !== undefined && body.expectedRevision !== existingProject.revision) {
      return sendRevisionConflict(reply, "project", serializeProjectSummary(existingProject));
    }
    if (body.projectType !== undefined) {
      const currentType = normalizeProjectType(existingProject.projectType || "general");
      const requestedType = normalizeProjectType(body.projectType);
      if (requestedType !== currentType) {
        reply.code(409).send({ ok: false, code: "PROJECT_TYPE_MIGRATION_REQUIRED", error: "Preview and apply Project Type changes from the specialized workspace so existing records, tools, and stages are migrated safely." });
        return;
      }
    }
    if (body.status && body.status !== existingProject.status && ["completed", "cancelled"].includes(body.status)) {
      return reply.code(409).send({ ok: false, code: body.status === "completed" ? "PROJECT_COMPLETION_CLOSEOUT_REQUIRED" : "PROJECT_CANCELLATION_LIFECYCLE_REQUIRED", error: body.status === "completed" ? "Complete projects from the Closeout workspace so verification and approval evidence remain authoritative." : "Cancel projects through the explicit lifecycle action so the reason and audit event are preserved." });
    }
    if (body.status && existingProject.status === "cancelled" && body.status !== "cancelled") {
      return reply.code(409).send({ ok: false, code: "PROJECT_REACTIVATION_LIFECYCLE_REQUIRED", error: "Reactivate cancelled projects through the explicit lifecycle action." });
    }
    if (body.status && !canTransitionClusterProjectStatus(existingProject.status, body.status)) {
      return reply.code(409).send({ ok: false, code: "PROJECT_LIFECYCLE_TRANSITION_INVALID", error: `Project cannot transition directly from ${existingProject.status} to ${body.status}.` });
    }
    const { external, pin, expectedRevision, memberIds: requestedMemberIds, memberRoles, ...projectUpdateBody } = body;
    if (changesArchiveState) await verifyUserPin(user, pin || "", body.archived ? "archive_project" : "restore_project", request);
    if (body.status === "completed" && existingProject.status !== "completed") await verifyUserPin(user, pin || "", "submit_project_completion", request);
    if (body.status === "completed" && existingProject.status !== "completed" && !decorated?.isAdmin) {
      const settings = await readSettings();
      if (settings.approvalProjectCompletion !== false) {
        const existingRequest = await decisions.findPending({
          resource: { kind: "project", id: existingProject.id, projectId: existingProject.id },
          type: "project_completion",
        });
        const payload = {
          type: "project_completion",
          requestedById: user?.id || null,
          requestedByName: decorated?.displayName || decorated?.username || null,
          targetType: "project",
          targetId: existingProject.id,
          projectId: existingProject.id,
          reason: `Complete ${existingProject.name}`,
          previousStatus: existingProject.status,
          requestedStatus: "completed",
        };
        const requestRecord =
          existingRequest ||
          (await decisions.request({
            type: "project_completion",
            title: `Complete project: ${existingProject.name}`,
            projectId: existingProject.id,
            resource: { kind: "project", id: existingProject.id, projectId: existingProject.id },
            requestedById: user?.id || null,
            requestedByName: decorated?.displayName || decorated?.username || null,
            reason: `Complete ${existingProject.name}`,
            sourceKey: `project-completion:${existingProject.id}`,
            payload,
            storageData: buildPersistenceStorageData("approvalRequest", payload),
          }));
        await logActivity({
          userId: user?.id,
          projectId: existingProject.id,
          type: "approval_requested",
          entityType: "project",
          entityId: existingProject.id,
          title: "Project completion requested",
          message: existingProject.name,
          metadata: {
            approvalId: requestRecord.id,
            approvalType: "project_completion",
          },
        });
        return reply.code(202).send({
          ...serializeWithCapabilities(existingProject, user, decorated, accessRules),
          approvalRequested: true,
          approvalId: requestRecord.id,
        });
      }
    }
    const configuredTypeUpdate = body.projectType ? await configuredProjectType(normalizeProjectType(body.projectType)) : null;
    const profileTypeDefinition = configuredTypeUpdate || (body.productionProfile ? await configuredProjectType(existingProject.projectType) : null);
    const productionProfileUpdate = body.productionProfile ? resolveClusterProductionProfile(body.productionProfile, profileTypeDefinition || existingProject.projectType) : configuredTypeUpdate ? resolveClusterProductionProfile(existingProject.productionProfile || "generic", configuredTypeUpdate) : null;
    if (body.productionProfile && body.productionProfile !== (existingProject.productionProfile || "generic")) {
      const enabledProfiles = (await import("@cluster/shared")).enabledClusterProductionProfiles((await readSettings()).studioEnabledProductionProfileIds, profileTypeDefinition || existingProject.projectType);
      if (!enabledProfiles.some((profile) => profile.id === body.productionProfile)) {
        throw createHttpError("PROJECT_TECHNOLOGY_DISABLED", "Enable this technology profile in Studio Settings before assigning it to a Project.", 400);
      }
    }
    const projectData = {
        ...projectUpdateBody,
        projectType: body.projectType ? normalizeProjectType(body.projectType) : undefined,
        productionProfile: productionProfileUpdate?.id,
        status: body.status ? normalizeProjectStatus(body.status) : undefined,
        source: external !== undefined ? (external ? "external" : "manual") : undefined,
        productionTracks: configuredTypeUpdate || productionProfileUpdate ? JSON.stringify(Array.from(new Set([...(configuredTypeUpdate?.tracks || parseLabels(existingProject.productionTracks)), ...(productionProfileUpdate?.tracks || [])]))) : undefined,
        tags: body.tags ? JSON.stringify(unique(body.tags)) : undefined,
        aliases: body.aliases ? JSON.stringify(unique(body.aliases)) : undefined,
        revision: { increment: 1 },
      };
    // Optimistic header CAS and crew replacement MUST commit or roll back together.
    // A database interruption can no longer leave the header advanced with stale crew.
    const currentMemberships = existingProject.memberships || [];
    const memberIds = requestedMemberIds ? unique(requestedMemberIds) : currentMemberships.map((membership: any) => membership.userId);
    const roles = { ...Object.fromEntries(currentMemberships.map((membership: any) => [membership.userId, membership.roleKey || "contributor"])), ...(memberRoles || {}) };
    const chosenLeads = touchesProjectManagementFields ? memberIds.filter((userId: string) => requireClusterProjectRole(roles[userId] || "contributor").key === "lead") : [];
    if (chosenLeads.length > 1) return reply.code(400).send({ ok: false, code: "MULTIPLE_PROJECT_LEADS", error: "A Project has one primary Project Lead. Assign Producer for additional managers." });
    const priorLeadId = currentMemberships.find((membership: any) => membership.isLead)?.userId;
    const leadId = chosenLeads[0] || (memberIds.includes(priorLeadId) ? priorLeadId : memberIds[0]);
    if (touchesProjectManagementFields && !leadId) return reply.code(400).send({ ok: false, code: "PROJECT_LEAD_REQUIRED", error: "Project membership changes must retain an active project lead." });
    try {
      await prisma.$transaction(async (tx: any) => {
        const updated = await tx.project.updateMany({ where: { id: params.projectId, revision: existingProject.revision }, data: projectData });
        if (!updated.count) throw new ProjectRevisionWriteConflict();
        if (touchesProjectManagementFields) {
          await writeProjectMembershipsInTransaction(tx, { projectId: params.projectId, memberIds, leadId, roleLabels: roles });
        }
      });
    } catch (error) {
      if (!(error instanceof ProjectRevisionWriteConflict)) throw error;
      const current = await prisma.project.findUnique({ where: { id: params.projectId }, include: { memberships: { where: { status: "active" } } } });
      return sendRevisionConflict(reply, "project", current ? serializeProjectSummary(current) : null);
    }
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: params.projectId },
      include: {
        boards: { include: { lists: true } },
        whiteboards: true,
        sourceBindings: {
          where: { archived: false },
          include: { repository: { include: { connection: true } } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        integrationBindings: {
          where: { archived: false },
          include: { connection: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        versions: { orderBy: { createdAt: "desc" }, take: 1 },
        memberships: { where: { status: "active" }, orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] },
      },
    });
    await logActivity({
      userId: user?.id,
      projectId: project.id,
      type: changesArchiveState ? (project.archived ? "archived" : "restored") : "updated",
      entityType: "project",
      entityId: project.id,
      title: changesArchiveState ? (project.archived ? "Project archived" : "Project restored") : "Project updated",
      message: project.name,
    });
    return serializeWithCapabilities(project, user, decorated, accessRules);
  });
  app.post("/api/projects/:projectId/lifecycle", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({
      action: z.enum(["cancel", "reactivate"]),
      reason: z.string().trim().max(1000).optional().nullable(),
      expectedRevision: z.number().int().positive().optional(),
    }).parse(request.body || {});
    const project = await prisma.project.findUnique({ where: { id: params.projectId }, include: { memberships: { where: { status: "active" } } } });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== project.revision) return sendRevisionConflict(reply, "project", serializeProjectSummary(project));
    const targetStatus = body.action === "cancel" ? "cancelled" : "active";
    if (body.action === "cancel" && !body.reason) return reply.code(400).send({ ok: false, code: "PROJECT_CANCELLATION_REASON_REQUIRED", error: "Cancellation requires a reason." });
    if (body.action === "cancel" && ["completed", "cancelled"].includes(String(project.status))) return reply.code(409).send({ ok: false, code: "PROJECT_LIFECYCLE_TRANSITION_INVALID", error: `Project cannot be cancelled from ${project.status}.` });
    if (body.action === "reactivate" && project.status !== "cancelled") return reply.code(409).send({ ok: false, code: "PROJECT_LIFECYCLE_TRANSITION_INVALID", error: "Only cancelled projects can be reactivated through this action." });
    if (!canTransitionClusterProjectStatus(project.status, targetStatus)) return reply.code(409).send({ ok: false, code: "PROJECT_LIFECYCLE_TRANSITION_INVALID", error: `Project cannot transition directly from ${project.status} to ${targetStatus}.` });
    const changed = await prisma.project.updateMany({ where: { id: project.id, revision: project.revision }, data: { status: targetStatus, revision: { increment: 1 } } });
    if (!changed.count) {
      const current = await prisma.project.findUnique({ where: { id: project.id } });
      return sendRevisionConflict(reply, "project", current ? serializeProjectSummary(current) : null);
    }
    const updated = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: { memberships: { where: { status: "active" }, orderBy: [{ isLead: "desc" }, { createdAt: "asc" }] } } });
    await logActivity({ userId: user?.id, projectId: project.id, type: body.action === "cancel" ? "cancelled" : "reactivated", entityType: "project", entityId: project.id, title: body.action === "cancel" ? "Project cancelled" : "Project reactivated", message: body.reason || project.name, metadata: { previousStatus: project.status, status: targetStatus, reason: body.reason || null } });
    const decorated = await decorateUserForClient(user);
    const accessRules = decorated?.isAdmin ? [] : await projectRepository.listActiveAccessRulesForProject(project.id);
    return serializeWithCapabilities(updated, user, decorated, accessRules);
  });

  app.delete("/api/projects/:projectId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const project = await prisma.project.findUnique({
      where: { id: params.projectId }, include: { memberships: { where: { status: "active" } } },
    });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== project.revision) {
      return sendRevisionConflict(reply, "project", serializeProjectSummary(project));
    }
    const [workspaceMembers, projectRules] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId: project.workspaceId }, include: { user: true } }),
      prisma.accessRule.findMany({ where: { status: "active", targetKind: "project", targetId: project.id }, select: { targetKind: true, targetId: true, projectId: true, subjectKind: true, subjectId: true, subjectName: true, effect: true, level: true, status: true, expiresAt: true } }).catch(() => []),
    ]);
    const tombstoneAudience = workspaceMembers
      .filter((membership: any) => !membership.user?.archived && hasTargetAccess(membership.user, membership.role, "project", project.id, project, projectRules, "view"))
      .map((membership: any) => String(membership.userId));
    const removed = await prisma.$transaction(async (transaction: any) => {
      const deleted = await transaction.project.deleteMany({ where: { id: params.projectId, revision: project.revision } });
      if (!deleted.count) return false;
      await transaction.syncTombstone.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          entityType: "project",
          entityId: project.id,
          visibleToUserIds: JSON.stringify(tombstoneAudience),
        },
      });
      return true;
    });
    if (!removed) {
      const current = await prisma.project.findUnique({ where: { id: params.projectId } });
      return sendRevisionConflict(reply, "project", current ? serializeProjectSummary(current) : null);
    }
    await logActivity({
      userId: user?.id,
      type: "deleted",
      entityType: "project",
      entityId: params.projectId,
      title: "Project deleted",
      message: project.name || params.projectId,
    });
    return { ok: true };
  });
}
