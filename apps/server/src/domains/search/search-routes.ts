import type { FastifyInstance, FastifyRequest } from "fastify";
import { commandSearchQuerySchema } from "./search-schemas.js";
import { createSearchRepository } from "./search-repository.js";
import { createSearchService } from "./search-service.js";
import { createHttpError } from "../../core/http-errors.js";
import type { LibraryAccessService } from "../library/library-access-service.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import type { ClusterOperationRuntime } from "../../core/operation-runtime.js";
import { workforceAuthorityProjection } from "../workforce/workforce-user-authority.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";
import { createSearchSensitiveAccess } from "./search-sensitive-access.js";
import { createSearchLiveAdmission } from "./search-live-admission.js";

type SearchRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  authorization: any;
  libraryAccess: LibraryAccessService;
  parseLabels: (value: any) => string[];
  serializeUserLite: (user: any) => any;
  serializeProjectSummary: (project: any) => any;
  subscribeToSearchChanges?: (handler: (event: any) => void) => void;
  jobWorker: DurableJobWorker;
  operations: ClusterOperationRuntime;
};

export function registerSearchRoutes(deps: SearchRouteDependencies) {
  const repository = createSearchRepository(deps.prisma);
  const service = createSearchService({
    loadCorpus: repository.loadCorpus,
    loadProjectCorpus: repository.loadProjectCorpus,
    loadUserCorpus: repository.loadUserCorpus,
    loadAccessRules: repository.loadAccessRules,
    serializeUserLite: deps.serializeUserLite,
    serializeProjectSummary: deps.serializeProjectSummary,
  });
  deps.subscribeToSearchChanges?.((event) => service.invalidateChange(event));

  deps.jobWorker.register("system.search-rebuild", async ({ updateProgress, throwIfCancelled }) => {
    await updateProgress(5, "Preparing search corpus");
    throwIfCancelled();
    const before = service.diagnostics();
    await updateProgress(20, "Rebuilding search index");
    const snapshot = await service.rebuild();
    throwIfCancelled();
    await updateProgress(95, "Finalizing search index");
    const after = service.diagnostics();
    await updateProgress(100, "Search index rebuilt");
    return {
      indexed: snapshot.items.length,
      previousRevision: before.indexRevision,
      indexRevision: after.indexRevision,
      fullRebuilds: after.fullRebuilds,
      completedAt: new Date().toISOString(),
    };
  });

  deps.app.post("/api/admin/operations/search/rebuild", async (request, reply) => {
    const decision = await deps.authorization.authorize(request, "admin", { kind: "workspace" }, { minimum: "manage", surface: "api" });
    if (!decision.allowed) throw createHttpError(decision.code || "PERMISSION_DENIED", decision.reason || "Admin role required to rebuild search.", decision.code === "AUTH_REQUIRED" ? 401 : 403);
    const body = ((request.body || {}) as { dryRun?: boolean; reason?: string });
    const diagnostics = service.diagnostics();
    if (body.dryRun === true) {
      return {
        ok: true,
        dryRun: true,
        preview: {
          summary: `Rebuild the global search index at revision ${diagnostics.indexRevision}.`,
          currentRevision: diagnostics.indexRevision,
          totalIndexed: diagnostics.totalIndexed,
          rebuilding: diagnostics.rebuilding,
          dirty: diagnostics.dirty,
          reason: String(body.reason || "").trim() || null,
        },
      };
    }
    const currentUser = await deps.getCurrentUser(request);
    const operation = await deps.operations.enqueue({
      type: "system.search-rebuild",
      queue: "system",
      createdById: currentUser.id,
      payload: { reason: String(body.reason || "").trim() || null, requestedAt: new Date().toISOString() },
      maxAttempts: 1,
      costUnits: 4,
      authorization: { action: "admin", resource: { kind: "workspace" }, actorUserId: currentUser.id },
    });
    reply.code(202);
    return { ok: true, dryRun: false, operation };
  });

  deps.app.get("/api/command/search/diagnostics", async (request) => {
    const decision = await deps.authorization.authorize(request, "admin", { kind: "workspace" }, { minimum: "manage", surface: "api" });
    if (!decision.allowed) throw createHttpError(decision.code || "PERMISSION_DENIED", decision.reason || "Admin role required for search diagnostics.", decision.code === "AUTH_REQUIRED" ? 401 : 403);
    return { ok: true, diagnostics: service.diagnostics() };
  });

  deps.app.get("/api/command/search", async (request, reply) => {
    // Search can disclose titles, People metadata and private Calendar events.
    // Use the existing in-process cache, not browser/shared HTTP caches.
    reply.header("Cache-Control", "private, no-store");
    const currentUser = await deps.getCurrentUser(request);
    const decorated = await deps.decorateUserForClient(currentUser);
    const query = commandSearchQuerySchema.parse(request.query || {});
    const role = decorated?.workspaceRole || null;
    const actor = { user: currentUser, decorated, role };
    const targetAccess = new Map<string, Promise<boolean>>();
    const toolAccess = new Map<string, Promise<boolean>>();
    const canViewTarget = (kind: string, id: string, project: any, rules: any[]) => {
      const key = `${kind}:${id}:${project?.id || ""}`;
      const cached = targetAccess.get(key);
      if (cached) return cached;
      const pending: Promise<boolean> = deps.authorization.authorize(actor, "view", { kind: "target", targetKind: kind, targetId: id, project }, { minimum: "view", rules, surface: "search" }).then((decision: any) => Boolean(decision.allowed));
      targetAccess.set(key, pending);
      return pending;
    };
    const canViewTool = (tool: string) => {
      const cached = toolAccess.get(tool);
      if (cached) return cached;
      const pending: Promise<boolean> = deps.authorization.authorize(actor, "view", { kind: "tool", tool }, { minimum: "view", surface: "search" }).then((decision: any) => Boolean(decision.allowed));
      toolAccess.set(tool, pending);
      return pending;
    };
    const liveAdmission = createSearchLiveAdmission(deps.prisma);
    const sensitiveAccess = createSearchSensitiveAccess({
      prisma: deps.prisma, request, currentUser, libraryAccess: deps.libraryAccess, canViewTool,
    });
    const currentWorkforce = workforceAuthorityProjection(currentUser);
    const visibilityContextKey = [
      role || "none",
      decorated?.isAdmin ? "admin" : "member",
      String(currentUser.updatedAt || ""),
      String(currentUser.accessExpiresAt || ""),
      String(currentWorkforce.department || ""),
      String(currentUser.projectPermissions || ""),
      String(currentUser.toolPermissions || ""),
    ].join("|");
    return service.search({
      ...query,
      userId: currentUser.id,
      visibilityContextKey,
      prepareBatch: async (items) => {
        await Promise.all([liveAdmission.prepareBatch(items), sensitiveAccess.prepareBatch(items)]);
      },
      canViewItem: async (item, project, accessRules) => {
        // Ranking is eventually consistent; never disclose obsolete record
        // content or a stale placement even if an ACL still grants access.
        if (!liveAdmission.admit(item)) return false;
        // Calendar titles/locations are private data. Apply the canonical event
        // visibility policy, even for admins, before the generic target ACL.
        if (item.kind === "calendar") return canAccessCalendarEvent(deps.authorization, request, item.raw, "view");
        const sensitiveDecision = await sensitiveAccess.evaluate(item, project);
        if (sensitiveDecision !== null) return sensitiveDecision;
        if (item.kind === "approval") {
          // The approval queue is an administrator-only destination. Project
          // membership or generic target access must never disclose requests.
          return Boolean(decorated?.isAdmin);
        }
        if (item.kind === "studio_form" || item.kind === "form_submission") {
          if (!decorated?.isAdmin) return false;
          const decision = await deps.authorization.authorize(actor, "edit", { kind: "tool", tool: "settings" },
            { minimum: "edit", surface: "search" });
          return Boolean(decision.allowed);
        }
        if (item.kind === "source_review") {
          // Domain-owned tool + Project authorization; membership alone is not
          // a Source Control entitlement, even for a privileged actor.
          if (!project || !(await canViewTool("sourceControl"))) return false;
          return canViewTarget("project", item.projectId || item.id, project, accessRules);
        }
        if (item.kind === "source_commit") {
          if (!project || !(await canViewTool("sourceControl"))) return false;
          return canViewTarget("project", item.projectId || item.id, project, accessRules);
        }
        if (decorated?.isAdmin) return true;
        if (item.kind === "person") return canViewTarget("user", item.id, null, accessRules);
        if (!project) return Boolean(item.ownerId === currentUser.id || item.memberIds.includes(currentUser.id) || item.authorIds.includes(currentUser.id));
        if (item.kind === "project") return canViewTarget("project", item.id, project, accessRules);
        if (item.kind === "board") return canViewTarget("board", item.boardId || item.id, project, accessRules);
        if (item.kind === "whiteboard") return canViewTarget("whiteboard", item.whiteboardId || item.id.split(":", 1)[0], project, accessRules);
        if (item.kind === "card" || item.kind === "ticket") {
          if (item.boardId && !(await canViewTarget("board", item.boardId, project, accessRules))) return false;
          if (!(await canViewTarget("card", item.cardId || item.id, project, accessRules))) return false;
          return item.kind !== "ticket" || await canViewTool("tickets");
        }
        if (item.kind === "comment") {
          if (item.boardId && !(await canViewTarget("board", item.boardId, project, accessRules))) return false;
          if (!(item.cardId && await canViewTarget("card", item.cardId, project, accessRules))) return false;
          if (item.raw?.card?.workItemKind === "ticket" && !(await canViewTool("tickets"))) return false;
          return true;
        }
        if (item.kind === "activity") {
          if (!(await canViewTool("activity"))) return false;
          return (await deps.authorization.authorizeActivityEvent(actor, item.raw, { minimum: "view", rules: accessRules, surface: "search" })).allowed;
        }
        if (item.kind === "file") {
          const targetKind = item.resource?.kind === "review_asset" ? "review_asset" : item.resource?.kind === "file" ? "file" : "library";
          return canViewTarget(targetKind, item.resource?.id || item.id, project, accessRules);
        }
        if (item.kind === "timeline") return canViewTarget("timeline", item.id, project, accessRules);
        if (item.kind === "control") return canViewTarget("control", item.id, project, accessRules);
        if (item.kind === "build") return canViewTarget("build", item.id, project, accessRules);
        if (item.kind === "qa") return canViewTarget("qa", item.id, project, accessRules);
        if (item.kind === "release") return canViewTarget("release", item.id, project, accessRules);
        return false;
      },
    });
  });
}
