import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliveryRecordKindSchema } from "@cluster/shared";
import { createProjectDeliveryService } from "./project-delivery-service.js";
import { emitProjectDeliveryAutomationSignals } from "./project-delivery-lifecycle-service.js";
import type { AutomationEvent } from "../automation/studio-automation-service.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import type { ProjectReadModelRuntime } from "../../core/project-read-model-runtime.js";

const paramsSchema = z.object({ projectId: z.string().trim().min(1), kind: deliveryRecordKindSchema });
const entityParamsSchema = paramsSchema.extend({ id: z.string().trim().min(1).max(240) });
const bulkParamsSchema = z.object({ kind: deliveryRecordKindSchema });
const bulkQuerySchema = z.object({ projectIds: z.string().trim().min(1) });
const mutationSchema = z.object({ payload: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().positive().optional() });

export function registerProjectDeliveryRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  logActivity: (input: any) => Promise<unknown>;
  studioAutomation?: { processEvent: (event: AutomationEvent, actorId?: string | null) => Promise<unknown> };
  projectReadModels?: ProjectReadModelRuntime;
}) {
  const service = createProjectDeliveryService(deps.prisma);

  async function projectFor(request: any, reply: any, projectId: string, minimum: "view" | "contribute" | "manage") {
    const project = await deps.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.archived) { reply.code(404); return null; }
    if (!(await deps.enforceTargetAccess(request, reply, "project", project.id, project, minimum))) return null;
    return project;
  }

  function entityType(kind: string) { return kind === "build" ? "build" : kind === "qa-plan" ? "qa_plan" : kind === "qa-session" ? "qa_session" : "release"; }

  deps.app.get("/api/projects/:projectId/delivery/source-options", async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().trim().min(1) }).parse(request.params);
    if (!(await projectFor(request, reply, projectId, "view"))) return;
    const bindings = await deps.prisma.projectSourceBinding.findMany({
      where: { projectId, archived: false },
      select: {
        id: true, defaultBranch: true, isPrimary: true,
        repository: {
          select: {
            id: true, name: true, slug: true, defaultBranch: true, archived: true,
            branches: { where: { archived: false }, select: { id: true, name: true, headRevision: true, isDefault: true, lastCommitAt: true }, orderBy: [{ isDefault: "desc" }, { lastCommitAt: "desc" }], take: 200 },
            commits: { select: { id: true, revision: true, shortRevision: true, message: true, authorName: true, committedAt: true, webUrl: true, branchNames: true }, orderBy: [{ committedAt: "desc" }, { createdAt: "desc" }], take: 600 },
            reviews: { where: { projectId }, select: { id: true, title: true, sourceBranch: true, targetBranch: true, sourceRevision: true, mergedRevision: true, status: true, eligibilityState: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 100 },
          },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    const payload = {
      projectId,
      repositories: bindings.filter((binding: any) => binding.repository && !binding.repository.archived).map((binding: any) => ({
        bindingId: binding.id,
        repositoryId: binding.repository.id,
        name: binding.repository.name,
        slug: binding.repository.slug || null,
        defaultBranch: binding.defaultBranch || binding.repository.defaultBranch || "main",
        isPrimary: Boolean(binding.isPrimary),
        branches: binding.repository.branches.map((branch: any) => ({ id: branch.id, name: branch.name, headRevision: branch.headRevision || null, isDefault: Boolean(branch.isDefault), lastCommitAt: branch.lastCommitAt?.toISOString?.() || branch.lastCommitAt || null })),
        commits: binding.repository.commits.map((commit: any) => ({ id: commit.id, revision: commit.revision, shortRevision: commit.shortRevision, message: commit.message, authorName: commit.authorName || null, committedAt: commit.committedAt?.toISOString?.() || commit.committedAt || null, webUrl: commit.webUrl || null, branchNames: (() => { try { const value = JSON.parse(commit.branchNames || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } })() })),
        reviews: binding.repository.reviews.map((review: any) => ({ id: review.id, title: review.title, sourceBranch: review.sourceBranch, targetBranch: review.targetBranch, sourceRevision: review.sourceRevision, mergedRevision: review.mergedRevision || null, status: review.status, eligibilityState: review.eligibilityState, updatedAt: review.updatedAt?.toISOString?.() || review.updatedAt })),
      })),
    };
    return sendPrivateRevalidated(request, reply, payload);
  });

  deps.app.get("/api/project-delivery/:kind", async (request, reply) => {
    const { kind } = bulkParamsSchema.parse(request.params);
    const { projectIds } = bulkQuerySchema.parse(request.query);
    const ids: string[] = Array.from(new Set<string>(projectIds.split(",").map((id) => id.trim()).filter(Boolean))).slice(0, 100);
    const projects = await deps.prisma.project.findMany({ where: { id: { in: ids }, archived: false } });
    const byId = new Map(projects.map((project: any) => [project.id, project]));
    for (const id of ids) {
      const project = byId.get(id);
      if (!project || !(await deps.enforceTargetAccess(request, reply, "project", id, project, "view"))) return;
    }
    return sendPrivateRevalidated(request, reply, { kind, projectIds: ids, records: await service.list(ids, kind) });
  });

  deps.app.get("/api/projects/:projectId/delivery/:kind", async (request, reply) => {
    const { projectId, kind } = paramsSchema.parse(request.params);
    if (!(await projectFor(request, reply, projectId, "view"))) return;
    return sendPrivateRevalidated(request, reply, { projectId, kind, records: await service.list([projectId], kind) });
  });

  deps.app.get("/api/projects/:projectId/delivery/:kind/:id", async (request, reply) => {
    const { projectId, kind, id } = entityParamsSchema.parse(request.params);
    if (!(await projectFor(request, reply, projectId, "view"))) return;
    const record = await service.find(projectId, kind, id);
    if (!record) { reply.code(404); return { error: "Delivery record not found." }; }
    return sendPrivateRevalidated(request, reply, record);
  });

  deps.app.put("/api/projects/:projectId/delivery/:kind/:id", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, kind, id } = entityParamsSchema.parse(request.params);
    const body = mutationSchema.parse(request.body);
    const previous = await service.find(projectId, kind, id);
    const nextApproval = kind === "build" ? String(body.payload.approval || "") : "";
    const previousApproval = kind === "build" ? String((previous as any)?.approval || "") : "";
    const buildApprovalNeedsManage = kind === "build" && Boolean(previous) && body.payload.approval !== undefined
      && nextApproval !== previousApproval && (["approved", "blocked"].includes(nextApproval) || ["approved", "blocked"].includes(previousApproval));
    const releasePublishNeedsManage = kind === "release" && (String(body.payload.status || "") === "published" || String((previous as any)?.status || "") === "published");
    const minimumAccess = buildApprovalNeedsManage || releasePublishNeedsManage ? "manage" : "contribute";
    if (!(await projectFor(request, reply, projectId, minimumAccess))) return;
    const record = await service.put(projectId, kind, id, body.payload, body.expectedRevision, user?.id || null);
    // Keep local delivery lifecycle/read-model reads strongly fresh after a write;
    // the durable activity event will coordinate invalidation to peer instances.
    deps.projectReadModels?.invalidate(projectId);
    await deps.logActivity({
      userId: user?.id || null,
      projectId,
      type: previous ? "updated" : "created",
      entityType: entityType(kind),
      entityId: id,
      title: `${kind === "build" ? "Build" : kind === "qa-plan" ? "QA plan" : kind === "qa-session" ? "QA session" : "Release"} ${previous ? "updated" : "created"}`,
      message: String((record as any).title || (record as any).build || (record as any).buildVersion || id),
      metadata: { deliveryKind: kind, revision: (record as any).revision, sourceRevision: (record as any).sourceRevision || (record as any).provenance?.revision || null },
    });
    if (["build", "qa-session", "release"].includes(kind)) await emitProjectDeliveryAutomationSignals({ prisma: deps.prisma, logActivity: deps.logActivity, projectId, actorId: user?.id || null }).catch(() => undefined);
    if (deps.studioAutomation && kind === "build") {
      const failed = (record as any).qaStatus === "failed" || (record as any).approval === "blocked";
      const completed = (record as any).qaStatus === "passed" || (record as any).approval === "approved";
      if (failed || completed) await deps.studioAutomation.processEvent({ id: `delivery:${kind}:${id}:${(record as any).revision}:${failed ? "failed" : "completed"}`, trigger: failed ? "build_failed" : "build_completed", entityType: "build", entityId: id, entityLabel: (record as any).title, projectId, context: record, createdAt: new Date().toISOString() }, user?.id || null).catch(() => undefined);
    }
    if (deps.studioAutomation && kind === "qa-session") {
      const failed = ["failed", "blocked"].includes(String((record as any).status)) || (record as any).decision === "no-go";
      const passed = (record as any).status === "passed" || (record as any).decision === "go";
      if (failed || passed) await deps.studioAutomation.processEvent({ id: `delivery:${kind}:${id}:${(record as any).revision}:${failed ? "failed" : "passed"}`, trigger: failed ? "qa_failed" : "qa_passed", entityType: "qa", entityId: id, entityLabel: (record as any).build, projectId, context: record, createdAt: new Date().toISOString() }, user?.id || null).catch(() => undefined);
    }
    if (deps.studioAutomation && kind === "release" && String((record as any).status || "").toLowerCase() === "published" && String((previous as any)?.status || "").toLowerCase() !== "published") {
      await deps.studioAutomation.processEvent({ id: `delivery:release:${id}:${(record as any).revision}:published`, trigger: "release_published", entityType: "release", entityId: id, entityLabel: String((record as any).title || (record as any).buildVersion || id), projectId, context: record, createdAt: new Date().toISOString() }, user?.id || null).catch(() => undefined);
    }
    return record;
  });

  deps.app.delete("/api/projects/:projectId/delivery/:kind/:id", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    const { projectId, kind, id } = entityParamsSchema.parse(request.params);
    const query = z.object({ expectedRevision: z.coerce.number().int().positive().optional() }).parse(request.query || {});
    const previous = await service.find(projectId, kind, id);
    const protectedDeliveryRecord = (kind === "build" && String((previous as any)?.approval || "") === "approved")
      || (kind === "release" && String((previous as any)?.status || "") === "published");
    if (!(await projectFor(request, reply, projectId, protectedDeliveryRecord ? "manage" : "contribute"))) return;
    const result = await service.archive(projectId, kind, id, query.expectedRevision);
    deps.projectReadModels?.invalidate(projectId);
    if (previous) await deps.logActivity({ userId: user?.id || null, projectId, type: "archived", entityType: entityType(kind), entityId: id, title: `${kind} archived`, message: String((previous as any).title || (previous as any).build || id), metadata: { deliveryKind: kind } });
    return result;
  });
}
