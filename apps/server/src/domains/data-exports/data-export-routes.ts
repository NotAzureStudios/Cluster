import { z } from "zod";
import { CLUSTER_DATA_EXPORT_DELIVERIES, CLUSTER_DATA_EXPORT_FORMATS, CLUSTER_DATA_EXPORT_SCOPES, type ClusterDataQuery, type ClusterResourceKind } from "@cluster/shared";
import { apiError } from "../../core/api-response.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { CLUSTER_DATA_EXPORT_LIMITS, ClusterDataExportRegistry, prepareClusterDerivedExport, renderClusterDataExport } from "../../core/data-export.js";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import { serializeBackgroundJob } from "../jobs/job-queue-service.js";

const requestSchema = z.object({
  format: z.enum(CLUSTER_DATA_EXPORT_FORMATS).default("csv"),
  scope: z.enum(CLUSTER_DATA_EXPORT_SCOPES).default("view"),
  delivery: z.enum(CLUSTER_DATA_EXPORT_DELIVERIES).default("download"),
  fieldIds: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
  query: z.unknown().optional(),
  selectedIds: z.array(z.string().trim().min(1).max(200)).max(CLUSTER_DATA_EXPORT_LIMITS.selectedRows).optional(),
  fileName: z.string().trim().max(160).nullable().optional(),
});

export function registerDataExportRoutes({ app, registry, queue, getCurrentUser, decorateUserForClient, logSecurityEvent }: {
  app: any;
  registry: ClusterDataExportRegistry;
  queue: BackgroundJobQueue;
  getCurrentUser: (request: any) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  logSecurityEvent?: (input: any) => Promise<unknown>;
}) {
  app.post("/api/data-exports/:resourceKind", async (request: any, reply: any) => {
    const params = z.object({ resourceKind: z.string().trim().min(1).max(100) }).parse(request.params || {});
    const body = requestSchema.parse(request.body || {});
    const adapter = registry.get(params.resourceKind as ClusterResourceKind);
    if (!adapter) return apiError(request, reply, 404, "DATA_EXPORT_UNSUPPORTED", "This resource does not expose a Data Export adapter.");
    const actor = await adapter.authorize({ request, reply });
    if (!actor) return;
    const selectedIds: string[] = [...new Set<string>((body.selectedIds || []).map((value) => String(value)))];
    if (body.scope === "selection" && !selectedIds.length) return apiError(request, reply, 400, "DATA_EXPORT_SELECTION_REQUIRED", "Selected-row exports require at least one selected resource.");

    const requiresBackground = body.delivery === "library" || body.format === "xlsx";
    if (body.format === "xlsx" && body.delivery !== "library") {
      return apiError(request, reply, 400, "DATA_EXPORT_LIBRARY_REQUIRED", "XLSX exports are generated as durable Library artifacts. Choose Save to Library.");
    }
    if (requiresBackground) {
      if (!adapter.authorizeActor) return apiError(request, reply, 400, "DATA_EXPORT_BACKGROUND_UNSUPPORTED", "This resource does not support background export authorization yet.");
      const job = await queue.enqueue({
        type: "data-export.generate",
        queue: "default",
        priority: -2,
        costUnits: body.format === "xlsx" ? 4 : 2,
        maxAttempts: 3,
        createdById: actor.id,
        payload: {
          resourceKind: adapter.resourceKind,
          actorId: actor.id,
          format: body.format,
          scope: body.scope,
          fieldIds: body.fieldIds,
          query: body.query || {},
          selectedIds: body.scope === "selection" ? selectedIds : undefined,
          fileName: body.fileName,
        },
      });
      await logSecurityEvent?.({ event: "data_export.background_queued", actorUserId: actor.id, result: "SUCCESS", reasonCode: "DATA_EXPORT_BACKGROUND_QUEUED", metadata: { resourceKind: adapter.resourceKind, format: body.format, scope: body.scope, delivery: "library", jobId: job.id } });
      return reply.code(202).send({ mode: "background", jobId: job.id, status: "queued", resourceKind: adapter.resourceKind, format: body.format, scope: body.scope, delivery: "library", requestedAt: new Date().toISOString() });
    }

    const maxRows = body.scope === "selection" ? CLUSTER_DATA_EXPORT_LIMITS.selectedRows : CLUSTER_DATA_EXPORT_LIMITS.immediateRows;
    const rawQuery = (body.query || {}) as ClusterDataQuery;
    const query = normalizeClusterDataQuery({ ...rawQuery, page: { cursor: null, limit: maxRows } }, { fields: adapter.fields, defaultLimit: maxRows, maxLimit: maxRows });
    const loaded = await adapter.loadRows({ context: { request, reply, actor }, query, selectedIds, limit: maxRows });
    const derived = prepareClusterDerivedExport({ baseFields: adapter.fields, query, rows: loaded.rows });
    const rendered = renderClusterDataExport({ resourceKind: adapter.resourceKind, adapterLabel: adapter.label, format: body.format, scope: body.scope, delivery: "download", fields: derived.fields, requestedFieldIds: body.fieldIds, rows: derived.rows, truncated: loaded.truncated, fileName: body.fileName, maxRows });
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", rendered.contentType);
    reply.header("Content-Disposition", `attachment; filename="${rendered.fileName}"`);
    reply.header("X-Cluster-Export-Rows", String(rendered.evidence.rowCount));
    reply.header("X-Cluster-Export-Scope", rendered.evidence.scope);
    reply.header("X-Cluster-Export-Truncated", rendered.evidence.truncated ? "1" : "0");
    await logSecurityEvent?.({ event: "data_export.generated", actorUserId: actor.id, result: "SUCCESS", reasonCode: "DATA_EXPORT_GENERATED", metadata: rendered.evidence });
    return reply.send(rendered.body);
  });

  app.get("/api/data-exports/jobs/:jobId", async (request: any, reply: any) => {
    const params = z.object({ jobId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    const detail = await queue.get(params.jobId);
    if (!detail || detail.job.type !== "data-export.generate") return apiError(request, reply, 404, "DATA_EXPORT_JOB_NOT_FOUND", "Data export job was not found.");
    const decorated = await decorateUserForClient(user);
    if (detail.job.createdById !== user.id && !decorated?.isAdmin) return apiError(request, reply, 403, "ACCESS_DENIED", "This export belongs to another user.");
    const serialized = serializeBackgroundJob(detail.job, { includeResult: true });
    const result = serialized.result && typeof serialized.result === "object" ? serialized.result as any : null;
    return {
      jobId: detail.job.id,
      status: detail.job.status,
      progress: detail.job.progress,
      progressMessage: detail.job.progressMessage,
      artifact: result?.artifact || null,
      error: ["DEAD_LETTER", "FAILED"].includes(detail.job.status) ? detail.job.lastError || "Export generation failed." : null,
    };
  });
}
