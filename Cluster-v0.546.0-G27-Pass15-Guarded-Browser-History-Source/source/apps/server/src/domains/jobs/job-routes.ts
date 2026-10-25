import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ClusterChangeSetPlan } from "@cluster/shared";
import { BackgroundJobQueue, serializeBackgroundJob } from "./job-queue-service.js";
import { BACKGROUND_JOB_DATA_FIELDS } from "./job-types.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import type { DurableJobWorker } from "./job-worker.js";
import { createClusterCommand, type ClusterCommandRuntime } from "../../core/command-runtime.js";
import { backgroundJobToOperation, type ClusterOperationRuntime } from "../../core/operation-runtime.js";
import { ClusterChangeSetRuntime } from "../../core/change-set-runtime.js";

const listQuerySchema = z.object({
  status: z.string().trim().max(32).optional(),
  queue: z.string().trim().max(80).optional(),
  type: z.string().trim().max(120).optional(),
  q: z.string().trim().max(500).optional(),
  sort: z.string().trim().max(500).optional(),
  group: z.string().trim().max(500).optional(),
  facets: z.string().trim().max(500).optional(),
  aggregate: z.string().trim().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional().default(100),
  cursor: z.string().trim().max(2000).optional(),
});

function parseDataSorts(value?: string) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [fieldId, direction] = entry.split(":");
    return { fieldId: String(fieldId || "").trim(), direction: direction === "asc" ? "asc" as const : "desc" as const };
  });
}


function parseDataGroups(value?: string) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [fieldId, direction] = entry.split(":");
    return { fieldId: String(fieldId || "").trim(), direction: direction === "desc" ? "desc" as const : "asc" as const };
  });
}

function parseDataAggregations(value?: string) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    const [id, kind, fieldId] = entry.split(":");
    if (!id || !kind) return [];
    return [{ id: id.trim(), kind: kind.trim() as any, ...(fieldId?.trim() ? { fieldId: fieldId.trim() } : {}) }];
  });
}

export type BackgroundJobRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  queue: BackgroundJobQueue;
  operations: ClusterOperationRuntime;
  commands: ClusterCommandRuntime;
  worker: DurableJobWorker;
  requireAdminUserForRequest: (request: FastifyRequest, reply: FastifyReply) => Promise<any | null>;
  logSecurityEvent?: (input: any) => Promise<unknown>;
};

export function registerBackgroundJobRoutes(deps: BackgroundJobRouteDependencies) {
  const { app, prisma, queue, operations, commands, worker, requireAdminUserForRequest } = deps;
  const changeSets = new ClusterChangeSetRuntime(commands);

  const retryDefinition = (operationId: string) => ({
    type: "operation.retry",
    validate: async () => {
      const operation = await operations.get(operationId);
      if (!operation) return [{ code: "OPERATION_NOT_FOUND", message: "Operation not found.", severity: "error" as const, resource: { kind: "background_job" as const, id: operationId } }];
      if (!["failed", "dead-letter", "cancelled"].includes(operation.status)) return [{ code: "OPERATION_RETRY_NOT_ALLOWED", message: "Only failed, dead-letter, or cancelled operations can be retried.", severity: "error" as const, resource: { kind: "background_job" as const, id: operationId } }];
      return [];
    },
    previewImpact: async () => {
      const operation = await operations.get(operationId);
      const resource = { kind: "background_job" as const, id: operationId };
      return {
        summary: `Retry operation ${operationId}.`,
        affectedResources: [resource],
        issues: [],
        changes: operation ? [{ kind: "update" as const, resource, field: "status", label: "Queue operation for retry", before: operation.status, after: "queued" }] : [],
        metadata: { operationId, action: "retry", previousStatus: operation?.status || null, nextStatus: "queued" },
      };
    },
    execute: async () => {
      const operation = await operations.retry(operationId);
      if (!operation) throw Object.assign(new Error("Only failed, dead-letter, or cancelled operations can be retried."), { code: "OPERATION_RETRY_NOT_ALLOWED", statusCode: 409 });
      return { result: operation, operationIds: [operation.id] };
    },
  });

  app.get("/api/admin/operations/jobs", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const query = listQuerySchema.parse(request.query || {});
    const filterConditions = [
      query.status ? { fieldId: "status", operator: "equals" as const, value: query.status } : null,
      query.queue ? { fieldId: "queue", operator: "equals" as const, value: query.queue } : null,
      query.type ? { fieldId: "type", operator: "equals" as const, value: query.type } : null,
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const dataQuery = normalizeClusterDataQuery({
      search: query.q,
      filters: filterConditions.length ? { logic: "and", conditions: filterConditions } : null,
      sorts: parseDataSorts(query.sort || "createdAt:desc"),
      groups: parseDataGroups(query.group),
      facets: String(query.facets || "").split(",").map((value) => value.trim()).filter(Boolean),
      aggregations: parseDataAggregations(query.aggregate),
      page: { cursor: query.cursor || null, limit: query.limit },
    }, { fields: BACKGROUND_JOB_DATA_FIELDS, defaultLimit: 100, maxLimit: 250 });
    const [jobPage, counts, pressure, workspacePressure, analytics] = await Promise.all([
      queue.listPage({ status: query.status, queue: query.queue, type: query.type, search: dataQuery.search, sorts: dataQuery.sorts, limit: dataQuery.page.limit, cursor: dataQuery.page.cursor }),
      queue.counts(),
      queue.pressure(),
      queue.workspacePressure(),
      queue.analytics({ status: query.status, queue: query.queue, type: query.type, search: dataQuery.search, facets: dataQuery.facets, aggregations: dataQuery.aggregations }),
    ]);
    const jobs = jobPage.rows;
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      counts,
      pressure,
      workspacePressure,
      worker: worker.snapshot(),
      dataView: { resourceKind: "background_job", fields: BACKGROUND_JOB_DATA_FIELDS, query: dataQuery, facets: analytics.facets, aggregations: analytics.aggregations, page: { nextCursor: jobPage.nextCursor, hasMore: jobPage.hasMore, cursorSupported: jobPage.cursorSupported } },
      jobs: jobs.map((job) => serializeBackgroundJob(job)),
      operations: jobs.map((job) => backgroundJobToOperation(job)),
    };
  });

  app.get("/api/admin/operations/jobs/metrics", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    reply.header("Cache-Control", "no-store");
    const [counts, pressure, workspacePressure] = await Promise.all([queue.counts(true), queue.pressure(), queue.workspacePressure()]);
    return { ok: true, counts, pressure, workspacePressure, worker: worker.snapshot() };
  });

  app.get("/api/admin/operations/jobs/:jobId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const record = await queue.get(jobId);
    if (!record) return reply.code(404).send({ ok: false, code: "BACKGROUND_JOB_NOT_FOUND", error: "Background job not found." });
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      job: serializeBackgroundJob(record.job, { includePayload: true, includeResult: true }),
      operation: await operations.get(jobId),
      attempts: record.attempts,
    };
  });

  app.get("/api/admin/operations/traces/:correlationId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { correlationId } = z.object({ correlationId: z.string().trim().min(1).max(200) }).parse(request.params);
    const [jobs, events, receipts] = await Promise.all([
      prisma.backgroundJob.findMany({
        where: { OR: [{ id: correlationId }, { correlationId }, { causationId: correlationId }] },
        select: { id: true, queue: true, type: true, correlationId: true, causationId: true, status: true, progress: true, progressMessage: true, lastError: true, createdAt: true, startedAt: true, finishedAt: true, updatedAt: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
      prisma.domainEventOutbox.findMany({
        where: { OR: [{ id: correlationId }, { correlationId }, { causationId: correlationId }] },
        select: { id: true, sequence: true, type: true, schemaVersion: true, correlationId: true, causationId: true, projectId: true, resourceKind: true, resourceId: true, resourceProjectId: true, attempts: true, lastError: true, occurredAt: true, processedAt: true, deadLetteredAt: true },
        orderBy: { sequence: "asc" },
        take: 200,
      }),
      prisma.apiMutationReceipt.findMany({
        where: { correlationId },
        select: { id: true, method: true, path: true, correlationId: true, state: true, statusCode: true, requestId: true, failureReason: true, createdAt: true, completedAt: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    ]);
    const requestIds = [...new Set(receipts.map((receipt: any) => String(receipt.requestId || "").trim()).filter(Boolean))].slice(0, 100);
    const securityEvents = requestIds.length ? await prisma.securityAuditEvent.findMany({
      where: { requestId: { in: requestIds } },
      select: { id: true, event: true, result: true, reasonCode: true, requestId: true, requestMethod: true, requestPath: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 200,
    }) : [];

    const stages = [
      ...jobs.map((job: any) => ({
        id: `job:${job.id}`,
        kind: "operation",
        at: job.createdAt,
        label: `${job.type} · ${job.queue}`,
        state: job.status,
        resource: { kind: "background_job", id: job.id },
        details: { progress: job.progress, progressMessage: job.progressMessage || null, lastError: job.lastError || null, causationId: job.causationId || null, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null, updatedAt: job.updatedAt },
      })),
      ...events.map((event: any) => ({
        id: `event:${event.id}`,
        kind: "domain-event",
        at: event.occurredAt,
        label: event.type,
        state: event.deadLetteredAt ? "DEAD_LETTER" : event.processedAt ? "PROCESSED" : "PENDING",
        resource: event.resourceKind || event.resourceId ? { kind: event.resourceKind || "resource", id: event.resourceId || null, projectId: event.resourceProjectId || event.projectId || null } : null,
        details: { sequence: String(event.sequence), schemaVersion: event.schemaVersion, attempts: event.attempts, lastError: event.lastError || null, causationId: event.causationId || null, processedAt: event.processedAt || null, deadLetteredAt: event.deadLetteredAt || null },
      })),
      ...receipts.map((receipt: any) => ({
        id: `request:${receipt.id}`,
        kind: "request",
        at: receipt.createdAt,
        label: `${receipt.method} ${receipt.path}`,
        state: receipt.state,
        resource: null,
        details: { requestId: receipt.requestId || null, statusCode: receipt.statusCode ?? null, failureReason: receipt.failureReason || null, completedAt: receipt.completedAt || null },
      })),
      ...securityEvents.map((event: any) => ({
        id: `security:${event.id}`,
        kind: "security",
        at: event.occurredAt,
        label: event.event,
        state: event.result,
        resource: null,
        details: { requestId: event.requestId || null, reasonCode: event.reasonCode, requestMethod: event.requestMethod || null, requestPath: event.requestPath || null },
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 500);

    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      correlationId,
      generatedAt: new Date().toISOString(),
      sanitized: true,
      bounded: stages.length >= 500 || jobs.length >= 100 || events.length >= 200 || receipts.length >= 100 || securityEvents.length >= 200,
      counts: { operations: jobs.length, domainEvents: events.length, requests: receipts.length, securityEvents: securityEvents.length },
      stages,
    };
  });

  app.post("/api/admin/operations/jobs/retry-failed", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const body = z.object({ queue: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(50).default(25), dryRun: z.boolean().optional().default(false) }).parse(request.body || {});
    const [failed, deadLetters] = await Promise.all([
      queue.list({ status: "FAILED", queue: body.queue, limit: body.limit }),
      queue.list({ status: "DEAD_LETTER", queue: body.queue, limit: body.limit }),
    ]);
    const candidates = [...failed, ...deadLetters]
      .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      .slice(0, body.limit);
    const changeSetId = `operation-bulk-retry:${Date.now()}:${admin.id}`;
    const plan: ClusterChangeSetPlan = {
      id: changeSetId,
      title: "Retry failed operations",
      description: body.queue ? `Retry failed operations in ${body.queue}.` : "Retry failed operations.",
      trace: { correlationId: changeSetId },
      atomicity: "none" as const,
      stopOnFailure: false,
      items: candidates.map((candidate, index) => ({
        key: `${index + 1}:${candidate.id}`,
        label: `${candidate.type} · ${candidate.id}`,
        command: createClusterCommand({
          type: "operation.retry",
          actor: { userId: admin.id, source: "user" },
          resource: { kind: "background_job", id: candidate.id },
          correlationId: changeSetId,
          causationId: changeSetId,
          payload: { operationId: candidate.id, queue: body.queue || null },
        }),
      })),
    };
    const resolve = (item: ClusterChangeSetPlan["items"][number]) => ({ command: item.command, definition: retryDefinition(item.command.resource?.id || "") });
    const preview = await changeSets.preview(plan, resolve);
    if (body.dryRun) return { ok: true, dryRun: true, requested: candidates.length, changeSet: preview };
    if (!preview.executable) return reply.code(409).send({ ok: false, code: "CHANGE_SET_NOT_EXECUTABLE", error: "One or more operation retries failed validation.", changeSet: preview });
    const execution = await changeSets.execute(plan, resolve);
    const retriedIds = execution.results.filter((entry) => entry.result.ok).flatMap((entry) => entry.result.ok ? entry.result.operationIds || [] : []);
    await deps.logSecurityEvent?.({ event: "background_job.bulk_retry", actorUserId: admin.id, result: execution.failed ? "FAILURE" : "SUCCESS", reasonCode: "ADMIN_JOB_BULK_RETRY", metadata: { requested: candidates.length, retried: retriedIds.length, failed: execution.failed, queue: body.queue || null, changeSetId } });
    return { ok: execution.failed === 0, requested: candidates.length, retried: retriedIds.length, failed: execution.failed, jobIds: retriedIds, operationIds: retriedIds, changeSet: execution };
  });

  app.post("/api/admin/operations/jobs/:jobId/retry", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const command = createClusterCommand({
      type: "operation.retry",
      actor: { userId: admin.id, source: "user" },
      resource: { kind: "background_job", id: jobId },
      payload: { operationId: jobId },
    });
    const result = await commands.execute(command, retryDefinition(jobId));
    if (!result.ok) return reply.code(409).send({ ok: false, code: result.error.code, error: result.error.message, command: { id: result.commandId, correlationId: result.correlationId } });
    await deps.logSecurityEvent?.({ event: "background_job.retry", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_JOB_RETRY", metadata: { jobId, type: result.result.type, commandId: result.commandId } });
    const record = await queue.get(jobId);
    return { ok: true, job: record ? serializeBackgroundJob(record.job) : null, operation: result.result, command: { id: result.commandId, correlationId: result.correlationId } };
  });

  app.post("/api/admin/operations/jobs/:jobId/cancel", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return;
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(request.params);
    const command = createClusterCommand({
      type: "operation.cancel",
      actor: { userId: admin.id, source: "user" },
      resource: { kind: "background_job", id: jobId },
      payload: { operationId: jobId },
    });
    const result = await commands.execute(command, {
      type: "operation.cancel",
      execute: async () => {
        const operation = await operations.cancel(jobId);
        if (!operation) throw Object.assign(new Error("Only queued or running operations can be cancelled."), { code: "OPERATION_CANCEL_NOT_ALLOWED", statusCode: 409 });
        return { result: operation, operationIds: [operation.id] };
      },
    });
    if (!result.ok) return reply.code(409).send({ ok: false, code: result.error.code, error: result.error.message, command: { id: result.commandId, correlationId: result.correlationId } });
    await deps.logSecurityEvent?.({ event: "background_job.cancel", actorUserId: admin.id, result: "SUCCESS", reasonCode: "ADMIN_JOB_CANCEL", metadata: { jobId, type: result.result.type, commandId: result.commandId } });
    const record = await queue.get(jobId);
    return { ok: true, job: record ? serializeBackgroundJob(record.job) : null, operation: result.result, command: { id: result.commandId, correlationId: result.correlationId } };
  });
}
