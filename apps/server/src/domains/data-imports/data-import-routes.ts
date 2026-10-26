import { createHash } from "node:crypto";
import { z } from "zod";
import { CLUSTER_DATA_IMPORT_CONFLICT_POLICIES, CLUSTER_DATA_IMPORT_FORMATS, type ClusterChangeSetPreview, type ClusterCommandIssue, type ClusterDataImportApplyRequest, type ClusterDataImportPreviewEvidence, type ClusterResourceKind } from "@cluster/shared";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { apiError } from "../../core/api-response.js";
import { CLUSTER_DATA_IMPORT_LIMITS, ClusterDataImportRegistry, clusterDataImportSchema, previewClusterDataImport } from "../../core/data-import.js";
import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";
import { serializeBackgroundJob } from "../jobs/job-queue-service.js";
import { createDataImportSourceArtifact, discardDataImportSourceArtifact } from "./data-import-artifact-service.js";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const columnsSchema = z.array(z.object({ source: z.string().trim().min(1).max(240), fieldId: z.string().trim().min(1).max(160).nullable() })).max(CLUSTER_DATA_IMPORT_LIMITS.columns);
const previewSchema = z.object({
  format: z.enum(CLUSTER_DATA_IMPORT_FORMATS).default("csv"),
  conflictPolicy: z.enum(CLUSTER_DATA_IMPORT_CONFLICT_POLICIES).optional(),
  columns: columnsSchema,
  rows: z.array(z.record(z.string(), scalar)).max(CLUSTER_DATA_IMPORT_LIMITS.previewRows * 4),
  sourceName: z.string().trim().max(240).nullable().optional(),
});
const applySchema = z.object({
  format: z.enum(CLUSTER_DATA_IMPORT_FORMATS).default("csv"),
  conflictPolicy: z.enum(CLUSTER_DATA_IMPORT_CONFLICT_POLICIES).optional(),
  columns: columnsSchema,
  rows: z.array(z.record(z.string(), scalar)).min(1).max(CLUSTER_DATA_IMPORT_LIMITS.applyRows),
  sourceName: z.string().trim().max(240).nullable().optional(),
  stageId: z.string().trim().min(1).max(240),
  stageFingerprint: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  confirmed: z.literal(true),
});


function importFingerprint(input: Pick<ClusterDataImportApplyRequest, "resourceKind" | "format" | "columns" | "rows" | "conflictPolicy" | "sourceName">) {
  return createHash("sha256").update(JSON.stringify({
    resourceKind: input.resourceKind,
    format: input.format,
    columns: input.columns,
    rows: input.rows,
    conflictPolicy: input.conflictPolicy || "reject",
    sourceName: input.sourceName || null,
  })).digest("hex");
}

function importStageId(resourceKind: ClusterResourceKind, actorId: string, fingerprint: string) {
  return `data-import:${resourceKind}:${actorId}:${fingerprint.slice(0, 24)}`;
}

function importChangeSetPreview(adapter: { resourceKind: ClusterResourceKind; label: string }, actorId: string, evidence: ClusterDataImportPreviewEvidence, fingerprint: string): ClusterChangeSetPreview {
  const mappingIssues = evidence.issues.filter((entry) => entry.row === 0);
  const rowIssues = evidence.issues.filter((entry) => entry.row > 0);
  const issues: ClusterCommandIssue[] = [
    ...mappingIssues.map((entry) => ({ code: entry.code, message: entry.message, severity: "error" as const, field: entry.fieldId || null })),
    ...rowIssues.slice(0, 100).map((entry) => ({ code: entry.code, message: `Row ${entry.row}: ${entry.message}`, severity: "warning" as const, field: entry.fieldId || null })),
  ];
  const stageId = importStageId(adapter.resourceKind, actorId, fingerprint);
  const impact = {
    summary: `${evidence.validRows} valid row${evidence.validRows === 1 ? "" : "s"} will be queued for ${adapter.label} import; ${evidence.invalidRows} invalid row${evidence.invalidRows === 1 ? "" : "s"} will remain unapplied.`,
    affectedResources: [],
    issues,
    changes: [],
    metadata: {
      resourceKind: adapter.resourceKind,
      sourceRows: evidence.sourceRowCount,
      validRows: evidence.validRows,
      invalidRows: evidence.invalidRows,
      conflictPolicy: evidence.conflictPolicy,
      rowAtomic: true,
      rollbackAvailable: false,
      recovery: "rerun_safe",
      fingerprint,
    },
  };
  return {
    id: stageId,
    title: `Import ${adapter.label}`,
    atomicity: "none",
    executable: evidence.validRows > 0 && mappingIssues.length === 0,
    impact,
    items: [{ key: "apply-import", commandId: stageId, commandType: "data_import.apply", impact, issues }],
  };
}

export function registerDataImportRoutes({ app, registry, queue, prisma, dataLayout, getCurrentUser, decorateUserForClient, logSecurityEvent }: {
  app: any;
  registry: ClusterDataImportRegistry;
  queue: BackgroundJobQueue;
  prisma: any;
  dataLayout: ClusterDataLayout;
  getCurrentUser: (request: any) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  logSecurityEvent?: (input: any) => Promise<unknown>;
}) {
  app.get("/api/data-imports/:resourceKind/schema", async (request: any, reply: any) => {
    const params = z.object({ resourceKind: z.string().trim().min(1).max(100) }).parse(request.params || {});
    const adapter = registry.get(params.resourceKind as ClusterResourceKind);
    if (!adapter) return apiError(request, reply, 404, "DATA_IMPORT_UNSUPPORTED", "This resource does not expose a Data Import adapter.");
    const actor = await adapter.authorize({ request, reply });
    if (!actor) return;
    reply.header("Cache-Control", "no-store");
    return clusterDataImportSchema(adapter);
  });

  app.post("/api/data-imports/:resourceKind/preview", async (request: any, reply: any) => {
    const params = z.object({ resourceKind: z.string().trim().min(1).max(100) }).parse(request.params || {});
    const body = previewSchema.parse(request.body || {});
    const adapter = registry.get(params.resourceKind as ClusterResourceKind);
    if (!adapter) return apiError(request, reply, 404, "DATA_IMPORT_UNSUPPORTED", "This resource does not expose a Data Import adapter.");
    const actor = await adapter.authorize({ request, reply });
    if (!actor) return;
    const previewRequest = { resourceKind: adapter.resourceKind, format: body.format, columns: body.columns, rows: body.rows, conflictPolicy: body.conflictPolicy, sourceName: body.sourceName || null };
    const evidence = previewClusterDataImport(adapter, previewRequest);
    const fingerprint = importFingerprint(previewRequest);
    const changeSet = importChangeSetPreview(adapter, actor.id, evidence, fingerprint);
    const stagedEvidence: ClusterDataImportPreviewEvidence = { ...evidence, stage: { id: changeSet.id, fingerprint, stagedAt: new Date().toISOString(), requiresConfirmation: true, changeSet } };
    await logSecurityEvent?.({ event: "data_import.previewed", actorUserId: actor.id, result: "SUCCESS", reasonCode: "DATA_IMPORT_PREVIEWED", metadata: { resourceKind: adapter.resourceKind, format: body.format, sourceRows: evidence.sourceRowCount, validRows: evidence.validRows, invalidRows: evidence.invalidRows, dryRun: true, changeSetId: changeSet.id, fingerprint } });
    reply.header("Cache-Control", "no-store");
    return stagedEvidence;
  });

  app.post("/api/data-imports/:resourceKind/apply", async (request: any, reply: any) => {
    const params = z.object({ resourceKind: z.string().trim().min(1).max(100) }).parse(request.params || {});
    const body = applySchema.parse(request.body || {});
    const adapter = registry.get(params.resourceKind as ClusterResourceKind);
    if (!adapter) return apiError(request, reply, 404, "DATA_IMPORT_UNSUPPORTED", "This resource does not expose a Data Import adapter.");
    const actor = await adapter.authorize({ request, reply });
    if (!actor) return;
    if (!adapter.authorizeActor || !adapter.applyRow) return apiError(request, reply, 400, "DATA_IMPORT_APPLY_UNSUPPORTED", "This import resource does not expose a durable mutation adapter yet.");

    const applyRequest: ClusterDataImportApplyRequest = {
      resourceKind: adapter.resourceKind,
      format: body.format,
      columns: body.columns,
      rows: body.rows,
      conflictPolicy: body.conflictPolicy,
      sourceName: body.sourceName || null,
      stageId: body.stageId,
      stageFingerprint: body.stageFingerprint,
      confirmed: true,
    };
    const stageFingerprint = importFingerprint(applyRequest);
    const expectedStageId = importStageId(adapter.resourceKind, actor.id, stageFingerprint);
    if (body.stageFingerprint.toLowerCase() !== stageFingerprint || body.stageId !== expectedStageId) {
      return apiError(request, reply, 409, "DATA_IMPORT_STAGE_STALE", "The import changed after its Change Set preview. Validate it again before applying.");
    }
    const preview = previewClusterDataImport(adapter, applyRequest, { maxRows: CLUSTER_DATA_IMPORT_LIMITS.applyRows });
    const mappingIssue = preview.issues.find((issue) => issue.row === 0);
    if (mappingIssue) return apiError(request, reply, 400, mappingIssue.code || "DATA_IMPORT_MAPPING_INVALID", mappingIssue.message || "Import mapping is invalid.");
    if (!preview.validRows) return apiError(request, reply, 400, "DATA_IMPORT_NO_VALID_ROWS", "The import contains no valid rows to apply.");

    const content = Buffer.from(JSON.stringify(applyRequest), "utf8");
    const sourceFingerprint = createHash("sha256").update(content).digest("hex");
    const sourceArtifact = await createDataImportSourceArtifact({
      prisma,
      dataLayout,
      ownerId: actor.id,
      resourceKind: adapter.resourceKind,
      sourceName: body.sourceName,
      sourceFingerprint,
      content,
    });
    const job = await queue.enqueue({
      type: "data-import.apply",
      queue: "default",
      priority: -1,
      costUnits: 4,
      maxAttempts: 5,
      dedupeKey: `${actor.id}:${adapter.resourceKind}:${sourceFingerprint}`,
      createdById: actor.id,
      payload: { resourceKind: adapter.resourceKind, actorId: actor.id, sourceArtifactId: sourceArtifact.libraryItemId, sourceFingerprint },
    });
    let queuedSourceArtifactId = sourceArtifact.libraryItemId;
    try {
      const queuedPayload = JSON.parse(job.payload || "{}");
      if (queuedPayload?.sourceFingerprint === sourceFingerprint && queuedPayload?.sourceArtifactId && queuedPayload.sourceArtifactId !== sourceArtifact.libraryItemId) {
        queuedSourceArtifactId = String(queuedPayload.sourceArtifactId);
        await discardDataImportSourceArtifact({ prisma, dataLayout, artifactId: sourceArtifact.libraryItemId, ownerId: actor.id });
      }
    } catch {}
    await logSecurityEvent?.({ event: "data_import.background_queued", actorUserId: actor.id, result: "SUCCESS", reasonCode: "DATA_IMPORT_BACKGROUND_QUEUED", metadata: { resourceKind: adapter.resourceKind, format: body.format, sourceRows: body.rows.length, validRows: preview.validRows, invalidRows: preview.invalidRows, conflictPolicy: preview.conflictPolicy, sourceArtifactId: queuedSourceArtifactId, sourceFingerprint, jobId: job.id, changeSetId: body.stageId, explicitlyConfirmed: true } });
    return reply.code(202).send({ mode: "background", jobId: job.id, status: "queued", resourceKind: adapter.resourceKind, sourceArtifactId: queuedSourceArtifactId, sourceFingerprint, requestedAt: new Date().toISOString() });
  });

  app.get("/api/data-imports/jobs/:jobId", async (request: any, reply: any) => {
    const params = z.object({ jobId: z.string().trim().min(1).max(200) }).parse(request.params || {});
    const user = await getCurrentUser(request);
    if (!user) return apiError(request, reply, 401, "AUTH_REQUIRED", "Login required.");
    const detail = await queue.get(params.jobId);
    if (!detail || detail.job.type !== "data-import.apply") return apiError(request, reply, 404, "DATA_IMPORT_JOB_NOT_FOUND", "Data import job was not found.");
    const decorated = await decorateUserForClient(user);
    if (detail.job.createdById !== user.id && !decorated?.isAdmin) return apiError(request, reply, 403, "ACCESS_DENIED", "This import belongs to another user.");
    const serialized = serializeBackgroundJob(detail.job, { includeResult: true });
    const result = serialized.result && typeof serialized.result === "object" ? serialized.result as any : null;
    return {
      jobId: detail.job.id,
      status: detail.job.status,
      progress: detail.job.progress,
      progressMessage: detail.job.progressMessage,
      evidence: result?.evidence || null,
      sourceArtifact: result?.sourceArtifact || null,
      reportArtifact: result?.reportArtifact || null,
      error: ["DEAD_LETTER", "FAILED"].includes(detail.job.status) ? detail.job.lastError || "Import execution failed." : null,
    };
  });
}
