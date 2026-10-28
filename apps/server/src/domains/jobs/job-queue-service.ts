import { randomUUID } from "node:crypto";
import { currentReliabilityContext } from "../../core/reliability-context.js";
import { decodeCursor, encodeCursor } from "../../core/cursor-pagination.js";
import { assertBackgroundJobTransition, BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY } from "./job-types.js";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
import type { ClusterDataAggregation, ClusterDataFacetResult, ClusterDataSort } from "@cluster/shared";
import type {
  BackgroundJobAttemptRecord,
  BackgroundJobQueueCounts,
  BackgroundJobRecord,
  EnqueueBackgroundJobInput,
  BackgroundJobStatus,
} from "./job-types.js";

type RawPrisma = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: RawPrisma) => Promise<T>): Promise<T>;
};

type QueueLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

const ACTIVE_STATUSES = ["QUEUED", "RUNNING"] as const;
const TERMINAL_STATUSES = ["SUCCEEDED", "DEAD_LETTER", "CANCELLED"] as const;
const MAX_PAYLOAD_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;

type QueueWakeListener = () => void;
const queueWakeListeners = new Set<QueueWakeListener>();

export function subscribeBackgroundJobQueueWake(listener: QueueWakeListener) {
  queueWakeListeners.add(listener);
  return () => { queueWakeListeners.delete(listener); };
}

function signalBackgroundJobQueueWake() {
  for (const listener of [...queueWakeListeners]) {
    try { listener(); } catch { /* wake signals are best-effort; PostgreSQL remains authoritative */ }
  }
}

function boundedString(value: unknown, maximum: number) {
  return String(value ?? "").trim().slice(0, maximum);
}

function jsonText(value: unknown, maximumBytes: number, label: string) {
  const text = JSON.stringify(value ?? {});
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
  return text;
}

function normalizeQueue(value: unknown) {
  const queue = boundedString(value || "default", 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(queue)) throw new Error("Background job queue name is invalid.");
  return queue;
}

function normalizeType(value: unknown) {
  const type = boundedString(value, 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(type)) throw new Error("Background job type is invalid.");
  return type;
}

function normalizePriority(value: unknown) {
  const priority = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return Math.max(-100, Math.min(100, priority));
}


function normalizeCostUnits(value: unknown) {
  const units = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 1;
  return Math.max(1, Math.min(256, units));
}

function workspaceQueuedCostLimit() {
  const configured = Number(process.env.CLUSTER_JOB_WORKSPACE_QUEUED_COST_LIMIT || 256);
  return Math.max(16, Math.min(100_000, Number.isFinite(configured) ? Math.round(configured) : 256));
}

function normalizeAttempts(value: unknown) {
  const attempts = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 5;
  return Math.max(1, Math.min(20, attempts));
}


function backgroundJobListQuery(input: { status?: string; queue?: string; type?: string; search?: string; sorts?: readonly ClusterDataSort[]; limit?: number }, maximumLimit: number, cursor?: { field: "createdAt" | "updatedAt"; direction: "asc" | "desc"; at: Date; id: string } | null) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
  if (input.status) add(`"status" = ?`, boundedString(input.status, 32).toUpperCase());
  if (input.queue) add(`"queue" = ?`, normalizeQueue(input.queue));
  if (input.type) add(`"type" = ?`, normalizeType(input.type));
  const search = boundedString(input.search, 500);
  if (search) {
    values.push(`%${search.replace(/[\%_]/g, "\\$&")}%`);
    const parameter = `$${values.length}`;
    clauses.push(`("id" ILIKE ${parameter} ESCAPE '\\' OR "queue" ILIKE ${parameter} ESCAPE '\\' OR "type" ILIKE ${parameter} ESCAPE '\\' OR "status" ILIKE ${parameter} ESCAPE '\\' OR COALESCE("correlationId", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("causationId", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("progressMessage", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("lastError", '') ILIKE ${parameter} ESCAPE '\\')`);
  }
  if (cursor) {
    const column = cursor.field === "updatedAt" ? '"updatedAt"' : '"createdAt"';
    const operator = cursor.direction === "asc" ? ">" : "<";
    values.push(cursor.at, cursor.id);
    const atParameter = `$${values.length - 1}`;
    const idParameter = `$${values.length}`;
    clauses.push(`(${column} ${operator} ${atParameter} OR (${column} = ${atParameter} AND "id" ${operator} ${idParameter}))`);
  }
  const sortableColumns: Record<string, string> = { id: '"id"', status: '"status"', queue: '"queue"', type: '"type"', priority: '"priority"', attempts: '"attempts"', maxAttempts: '"maxAttempts"', progress: '"progress"', createdAt: '"createdAt"', updatedAt: '"updatedAt"' };
  const orderParts = (input.sorts || []).flatMap((sort) => sortableColumns[sort.fieldId] ? [`${sortableColumns[sort.fieldId]} ${sort.direction === "asc" ? "ASC" : "DESC"}`] : []);
  const stableTemporalSort = input.sorts?.length === 1 && (input.sorts[0]?.fieldId === "createdAt" || input.sorts[0]?.fieldId === "updatedAt") ? input.sorts[0] : null;
  if (stableTemporalSort && !orderParts.some((part) => part.startsWith('"id" '))) orderParts.push(`"id" ${stableTemporalSort.direction === "asc" ? "ASC" : "DESC"}`);
  const orderBy = orderParts.length ? orderParts.join(", ") : '"createdAt" DESC, "id" DESC';
  const limit = Math.max(1, Math.min(maximumLimit, Math.round(Number(input.limit) || 100)));
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql: `SELECT * FROM "BackgroundJob" ${where} ORDER BY ${orderBy} LIMIT $${values.length}`, values };
}
function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function payloadForStorage(input: EnqueueBackgroundJobInput) {
  const value = input.payload ?? {};
  if (!input.authorization) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Authorized background jobs require an object payload.");
  if (Object.prototype.hasOwnProperty.call(value, BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY)) throw new Error(`Background job payload field ${BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY} is reserved.`);
  return { ...(value as Record<string, unknown>), [BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY]: input.authorization };
}

function payloadForClient(value: string | null) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const result = { ...(parsed as Record<string, unknown>) };
  delete result[BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY];
  return result;
}

export function serializeBackgroundJob(job: BackgroundJobRecord, options: { includePayload?: boolean; includeResult?: boolean } = {}) {
  return {
    id: job.id,
    queue: job.queue,
    type: job.type,
    workspaceId: job.workspaceId,
    correlationId: job.correlationId,
    causationId: job.causationId,
    status: job.status,
    priority: job.priority,
    costUnits: job.costUnits,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    leaseOwner: job.leaseOwner,
    leaseExpiresAt: job.leaseExpiresAt,
    cancelRequestedAt: job.cancelRequestedAt,
    progress: job.progress,
    progressMessage: job.progressMessage,
    lastError: job.lastError,
    dedupeKey: job.dedupeKey,
    createdById: job.createdById,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(options.includePayload ? { payload: payloadForClient(job.payload) } : {}),
    ...(options.includeResult ? { result: parseJson(job.result) } : {}),
  };
}

export class BackgroundJobQueue {
  private cachedCounts: { at: number; value: BackgroundJobQueueCounts } | null = null;
  // An in-flight counts() read must not repopulate a cache after a committed
  // queue mutation invalidated it. Track the read generation across await.
  private countsGeneration = 0;

  constructor(
    private readonly prisma: RawPrisma,
    private readonly logger: QueueLogger = {},
    private readonly options: { wakePublisher?: () => void | Promise<void> } = {},
  ) {}

  /** Both synchronous and asynchronous telemetry failures must be detached
   * from committed job state, including failures inside wake publisher catches. */
  private log(level: keyof QueueLogger, payload: unknown, message: string) {
    try {
      const outcome: unknown = this.logger[level]?.(payload, message);
      if (outcome && typeof (outcome as { then?: unknown }).then === "function") {
        void Promise.resolve(outcome).catch(() => undefined);
      }
    } catch { /* diagnostics cannot alter durable queue outcomes */ }
  }

  async enqueue(input: EnqueueBackgroundJobInput): Promise<BackgroundJobRecord> {
    const type = normalizeType(input.type);
    const queue = normalizeQueue(input.queue);
    const payload = jsonText(payloadForStorage(input), MAX_PAYLOAD_BYTES, "Background job payload");
    const priority = normalizePriority(input.priority);
    const costUnits = normalizeCostUnits(input.costUnits);
    const maxAttempts = normalizeAttempts(input.maxAttempts);
    const runAfter = input.runAfter instanceof Date && Number.isFinite(input.runAfter.getTime()) ? input.runAfter : new Date();
    const dedupeKey = input.dedupeKey ? boundedString(input.dedupeKey, 200) : null;
    const createdById = input.createdById ? boundedString(input.createdById, 200) : null;
    const reliability = currentReliabilityContext();
    const workspaceId = input.workspaceId ? boundedString(input.workspaceId, 200) : reliability?.workspaceId || null;
    const correlationId = input.correlationId ? boundedString(input.correlationId, 200) : reliability?.correlationId || null;
    const causationId = input.causationId ? boundedString(input.causationId, 200) : reliability?.causationId || null;

    const { job: created, inserted } = await this.prisma.$transaction(async (tx) => {
      if (dedupeKey) {
        const dedupeScope = `cluster-job:${workspaceId || "global"}:${type}:${dedupeKey}`;
        await acquireTransactionAdvisoryLock(tx, dedupeScope);
        const existing = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
          `SELECT * FROM "BackgroundJob"
           WHERE "dedupeKey" = $1 AND "type" = $2 AND "workspaceId" IS NOT DISTINCT FROM $3
             AND "status" = ANY($4::text[])
           ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`,
          dedupeKey,
          type,
          workspaceId,
          [...ACTIVE_STATUSES],
        );
        if (existing[0]) return { job: existing[0], inserted: false };
      }

      if (workspaceId) {
        const budgetLock = `cluster-job-workspace-budget:${workspaceId}`;
        await acquireTransactionAdvisoryLock(tx, budgetLock);
        const budgetRows = await tx.$queryRawUnsafe<Array<{ activeCost: number }>>(
          `SELECT COALESCE(SUM("costUnits"), 0)::int AS "activeCost"
           FROM "BackgroundJob"
           WHERE "workspaceId" = $1 AND "status" = ANY($2::text[])`,
          workspaceId,
          [...ACTIVE_STATUSES],
        );
        const activeCost = Number(budgetRows[0]?.activeCost || 0);
        const limit = workspaceQueuedCostLimit();
        if (activeCost + costUnits > limit) {
          throw Object.assign(
            new Error(`Workspace background-work budget is full (${activeCost}/${limit} cost units active).`),
            { code: "BACKGROUND_WORKSPACE_BUDGET", statusCode: 429, retryable: true },
          );
        }
      }

      const id = randomUUID();
      const rows = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
        `INSERT INTO "BackgroundJob" ("id", "queue", "type", "workspaceId", "correlationId", "causationId", "status", "priority", "costUnits", "payload", "maxAttempts", "runAfter", "dedupeKey", "createdById", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING *`,
        id,
        queue,
        type,
        workspaceId,
        correlationId,
        causationId,
        priority,
        costUnits,
        payload,
        maxAttempts,
        runAfter,
        dedupeKey,
        createdById,
      );
      return { job: rows[0], inserted: true };
    });
    // Neither cache invalidation nor external diagnostics belongs inside the
    // transaction. An exception from a logger must not undo an otherwise
    // successful durable enqueue, nor misreport a committed mutation.
    if (inserted) {
      this.invalidateCounts();
      this.log("info", { jobId: created.id, queue, type, priority, costUnits, workspaceId }, "background job enqueued");
    }
    signalBackgroundJobQueueWake();
    // Wake publication is advisory. A synchronous publisher exception must
    // never make callers believe that a successfully committed enqueue failed.
    try {
      void Promise.resolve(this.options.wakePublisher?.()).catch((error) => {
        this.log("warn", { error }, "background job external wake publish failed");
      });
    } catch (error) {
      this.log("warn", { error }, "background job external wake publish failed");
    }
    return created;
  }

  async claim(workerId: string, leaseMs = 60_000, queues: string[] = ["default"], workspaceConcurrency = 2, workspaceCostBudget = 64, excludedTypes: string[] = []): Promise<BackgroundJobRecord | null> {
    const owner = boundedString(workerId, 160);
    if (!owner) throw new Error("Background job worker ID is required.");
    const normalizedQueues = [...new Set(queues.map(normalizeQueue))];
    const blockedTypes = [...new Set(excludedTypes.map(normalizeType))];
    // A new token on every claim fences old attempts, including deferred jobs
    // whose numeric attempt counter is intentionally restored on pause.
    const claimToken = `${owner.slice(0, 110)}:${randomUUID()}`;
    const boundedLeaseMs = Math.max(5_000, Math.min(15 * 60_000, Math.round(leaseMs)));
    const boundedWorkspaceConcurrency = Math.max(1, Math.min(128, Math.round(workspaceConcurrency || 1)));
    const boundedWorkspaceCostBudget = Math.max(1, Math.min(100_000, Math.round(workspaceCostBudget || 1)));
    const claimed = await this.prisma.$transaction(async (tx) => {
      // Reconcile abandoned cancellations AND exhausted leases in the same
      // bounded, nonblocking sweep. A cancelled RUNNING job cannot be claimed
      // again (cancelRequestedAt excludes it), so without this recovery it can
      // remain RUNNING indefinitely if its worker dies before acknowledging.
      // Cancellation takes precedence over exhaustion, including when the
      // request arrives on the final attempt. A queued cancellation is
      // terminal immediately, even if its runAfter is in the future.
      // Job and attempt state are committed together; independent claimers
      // use SKIP LOCKED to avoid duplicate recovery work.
      await tx.$executeRawUnsafe(
        `WITH stale AS (
           SELECT "id" FROM "BackgroundJob"
           WHERE (
             "status" = 'QUEUED' AND (
               "cancelRequestedAt" IS NOT NULL OR
               ("attempts" >= "maxAttempts" AND "runAfter" <= NOW())
             )
           ) OR (
             "status" = 'RUNNING' AND "leaseExpiresAt" IS NOT NULL
             AND "leaseExpiresAt" < NOW()
             AND ("cancelRequestedAt" IS NOT NULL OR "attempts" >= "maxAttempts")
           )
           ORDER BY "updatedAt", "id"
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         ), exhausted AS (
           UPDATE "BackgroundJob" AS job
           SET "status" = CASE WHEN job."cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' ELSE 'DEAD_LETTER' END,
               "finishedAt" = COALESCE(job."finishedAt", NOW()),
               "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW()
           FROM stale WHERE job."id" = stale."id"
           RETURNING job."id", job."status"
         )
         UPDATE "BackgroundJobAttempt" AS attempt
         SET "status" = CASE WHEN exhausted."status" = 'CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END,
             "finishedAt" = NOW(),
             "durationMs" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - attempt."startedAt")) * 1000)::int),
             "error" = CASE WHEN exhausted."status" = 'CANCELLED' THEN attempt."error"
                            ELSE COALESCE(attempt."error", 'Worker lease expired; retry budget exhausted.') END
         FROM exhausted
         WHERE attempt."jobId" = exhausted."id" AND attempt."status" = 'RUNNING'`,
        64,
      );
      // SKIP LOCKED fences *job rows*, not per-workspace capacity. Two server
      // processes can otherwise read the same workspace_load snapshot and
      // each claim a different job, exceeding both running count and cost.
      // Lock exactly ONE candidate row, acquire that workspace's transaction-
      // scoped advisory lock, then recheck its capacity in a NEW statement and
      // snapshot. Locking at most one workspace per transaction avoids lock-
      // ordering deadlocks between concurrent workers. All
      // claimers use the same key, including workers consuming other queues.
      // A null-workspace job has no workspace-specific budget to coordinate.
      const candidates = await tx.$queryRawUnsafe<Array<{ id: string; workspaceId: string | null }>>(
        `WITH workspace_load AS (
           SELECT "workspaceId", COUNT(*)::int AS running, COALESCE(SUM("costUnits"), 0)::int AS "runningCost"
           FROM "BackgroundJob"
           WHERE "status" = 'RUNNING' AND "leaseExpiresAt" >= NOW() AND "workspaceId" IS NOT NULL
           GROUP BY "workspaceId"
         )
         SELECT job."id", job."workspaceId"
         FROM "BackgroundJob" AS job
         LEFT JOIN workspace_load AS load ON load."workspaceId" = job."workspaceId"
         WHERE job."queue" = ANY($1::text[])
           AND NOT (job."type" = ANY($2::text[]))
           AND job."attempts" < job."maxAttempts"
           AND job."cancelRequestedAt" IS NULL
           AND (job."workspaceId" IS NULL OR (
             COALESCE(load.running, 0) < $3
             AND COALESCE(load."runningCost", 0) + job."costUnits" <= $4
           ))
           AND ((job."status" = 'QUEUED' AND job."runAfter" <= NOW()) OR
                (job."status" = 'RUNNING' AND job."leaseExpiresAt" < NOW()))
         ORDER BY COALESCE(load."runningCost", 0), COALESCE(load.running, 0),
                  job."priority" DESC, job."runAfter", job."createdAt", job."id"
         FOR UPDATE OF job SKIP LOCKED
         LIMIT 1`,
        normalizedQueues, blockedTypes, boundedWorkspaceConcurrency, boundedWorkspaceCostBudget,
      );
      const candidate = candidates[0];
      if (!candidate) return null;
      if (candidate.workspaceId) {
        await acquireTransactionAdvisoryLock(tx, `cluster-job-workspace-running:${candidate.workspaceId}`);
      }
      // Candidate selection is only a hint. This statement MUST recheck
      // live capacity and row ownership after obtaining the workspace lock.
      // PostgreSQL READ COMMITTED gives this second statement a fresh snapshot
      // including any other worker's committed claim during our lock wait.
      const rows = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
        `WITH workspace_load AS (
           SELECT "workspaceId", COUNT(*)::int AS running, COALESCE(SUM("costUnits"), 0)::int AS "runningCost"
           FROM "BackgroundJob"
           WHERE "status" = 'RUNNING'
             AND "leaseExpiresAt" IS NOT NULL
             AND "leaseExpiresAt" >= NOW()
             AND "workspaceId" IS NOT NULL
           GROUP BY "workspaceId"
         ),
         candidate AS (
           SELECT job."id"
           FROM "BackgroundJob" AS job
           LEFT JOIN workspace_load AS load ON load."workspaceId" = job."workspaceId"
           WHERE job."id" = $7 AND job."queue" = ANY($1::text[])
             AND NOT (job."type" = ANY($5::text[]))
             AND job."attempts" < job."maxAttempts"
             AND job."cancelRequestedAt" IS NULL
             AND (
               job."workspaceId" IS NULL OR (
                 COALESCE(load.running, 0) < $3
                 AND COALESCE(load."runningCost", 0) + job."costUnits" <= $4
               )
             )
             AND (
               (job."status" = 'QUEUED' AND job."runAfter" <= NOW()) OR
               (job."status" = 'RUNNING' AND job."leaseExpiresAt" IS NOT NULL AND job."leaseExpiresAt" < NOW())
             )
           ORDER BY COALESCE(load."runningCost", 0) ASC, COALESCE(load.running, 0) ASC, job."priority" DESC, job."runAfter" ASC, job."createdAt" ASC
           FOR UPDATE OF job SKIP LOCKED
           LIMIT 1
         )
         UPDATE "BackgroundJob" AS job
         SET "status" = 'RUNNING',
             "leaseOwner" = $6,
             "leaseExpiresAt" = NOW() + ($2::bigint * interval '1 millisecond'),
             "attempts" = job."attempts" + 1,
             "startedAt" = COALESCE(job."startedAt", NOW()),
             "updatedAt" = NOW(),
             "lastError" = CASE WHEN job."status" = 'RUNNING' THEN COALESCE(job."lastError", 'Previous worker lease expired; job was reclaimed.') ELSE job."lastError" END
         FROM candidate
         WHERE job."id" = candidate."id"
         RETURNING job.*`,
        normalizedQueues,
        boundedLeaseMs,
        boundedWorkspaceConcurrency,
        boundedWorkspaceCostBudget,
        blockedTypes,
        claimToken,
        candidate.id,
      );
      const job = rows[0] || null;
      if (!job) return null;
      // A reclaimed lease has a new attempt number, but its previous attempt
      // record stayed RUNNING forever when the worker died or lost PostgreSQL.
      // Reconciliation happens under the claim's row lock and transaction.
      await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJobAttempt"
         SET "status" = 'FAILED', "finishedAt" = NOW(),
             "durationMs" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int),
             "error" = COALESCE("error", 'Worker lease expired; next attempt reclaimed the job.')
         WHERE "jobId" = $1 AND "attempt" < $2 AND "status" = 'RUNNING'`,
        job.id, job.attempts,
      );
      await tx.$queryRawUnsafe<BackgroundJobAttemptRecord[]>(
        `INSERT INTO "BackgroundJobAttempt" ("id", "jobId", "attempt", "workerId", "status", "startedAt")
         VALUES ($1, $2, $3, $4, 'RUNNING', NOW())
         ON CONFLICT ("jobId", "attempt") DO UPDATE SET "workerId" = EXCLUDED."workerId", "status" = 'RUNNING', "startedAt" = NOW(), "finishedAt" = NULL, "durationMs" = NULL, "error" = NULL
         RETURNING *`,
        randomUUID(),
        job.id,
        job.attempts,
        owner,
      );
      return job;
    });
    // The recovery sweep may have terminalized expired jobs even if there was
    // no candidate to claim. Invalidate only after its transaction commits.
    this.invalidateCounts();
    return claimed;
  }

  async workspacePressure(limit = 50) {
    return this.prisma.$queryRawUnsafe<Array<{ workspaceId: string | null; queued: number; running: number; queuedCost: number; runningCost: number }>>(
      `SELECT "workspaceId",
              COUNT(*) FILTER (WHERE "status" = 'QUEUED')::int AS queued,
              COUNT(*) FILTER (WHERE "status" = 'RUNNING' AND "leaseExpiresAt" >= NOW())::int AS running,
              COALESCE(SUM("costUnits") FILTER (WHERE "status" = 'QUEUED'), 0)::int AS "queuedCost",
              COALESCE(SUM("costUnits") FILTER (WHERE "status" = 'RUNNING' AND "leaseExpiresAt" >= NOW()), 0)::int AS "runningCost"
       FROM "BackgroundJob"
       WHERE "status" IN ('QUEUED', 'RUNNING')
       GROUP BY "workspaceId"
       ORDER BY "runningCost" DESC, "queuedCost" DESC, running DESC, queued DESC
       LIMIT $1`,
      Math.max(1, Math.min(500, Math.round(limit))),
    );
  }

  /** Give back a claimed job at a retryable boundary. Its unique claim token
   * prevents a superseded execution from changing a subsequent attempt. */
  async deferDisabled(job: BackgroundJobRecord, workerId: string, delayMs = 30_000): Promise<"DEFERRED" | "CANCELLED" | null> {
    const delay = Math.max(1_000, Math.min(5 * 60_000, Math.round(delayMs)));
    if (!job.leaseOwner) return null;
    const deferred = await this.prisma.$transaction<"DEFERRED" | "CANCELLED" | null>(async (tx) => {
      const current = await tx.$queryRawUnsafe<Array<{ cancelRequestedAt: Date | null }>>(
        `SELECT "cancelRequestedAt" FROM "BackgroundJob" WHERE "id" = $1 AND "status" = 'RUNNING'
           AND "leaseOwner" = $2 AND "leaseExpiresAt" > NOW() AND "attempts" = $3 FOR UPDATE`,
        job.id, job.leaseOwner, job.attempts,
      );
      if (!current[0]) return null;
      const cancelled = Boolean(current[0].cancelRequestedAt);
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJob"
         SET "status" = CASE WHEN $3 THEN 'CANCELLED' ELSE 'QUEUED' END,
             "attempts" = CASE WHEN $3 THEN "attempts" ELSE GREATEST(0, "attempts" - 1) END,
             "runAfter" = CASE WHEN $3 THEN "runAfter" ELSE NOW() + ($4::bigint * interval '1 millisecond') END,
             "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
             "finishedAt" = CASE WHEN $3 THEN NOW() ELSE NULL END,
             "updatedAt" = NOW()
         WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
           AND "leaseExpiresAt" > NOW() AND "attempts" = $5`,
        job.id, job.leaseOwner, cancelled, delay, job.attempts,
      );
      if (!updated) return null;
      if (!cancelled) {
        // The claim is not an executed attempt. Preserve the retry budget and
        // avoid colliding with the (jobId, attempt) unique key on later reclaim.
        await tx.$executeRawUnsafe(
          `DELETE FROM "BackgroundJobAttempt" WHERE "jobId" = $1 AND "attempt" = $2 AND "workerId" = $3 AND "status" = 'RUNNING'`,
          job.id, job.attempts, workerId,
        );
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE "BackgroundJobAttempt" SET "status" = 'CANCELLED', "finishedAt" = NOW(),
             "durationMs" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int)
           WHERE "jobId" = $1 AND "attempt" = $2 AND "workerId" = $3`,
          job.id, job.attempts, workerId,
        );
      }
      return cancelled ? "CANCELLED" : "DEFERRED";
    });
    if (deferred !== null) this.invalidateCounts();
    return deferred;
  }

  /** Renew only the current, unexpired claim; an expired claim cannot be
   * resurrected even when its previous worker is still running. */
  async heartbeat(job: BackgroundJobRecord, leaseMs = 60_000) {
    if (!job.leaseOwner) return false;
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "BackgroundJob" SET "leaseExpiresAt" = NOW() + ($3::bigint * interval '1 millisecond'), "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
         AND "leaseExpiresAt" > NOW() AND "attempts" = $4`,
      job.id,
      job.leaseOwner,
      Math.max(5_000, Math.min(15 * 60_000, Math.round(leaseMs))),
      job.attempts,
    );
    return changed > 0;
  }

  async updateProgress(job: BackgroundJobRecord, progress: number, message?: string | null) {
    if (!job.leaseOwner) return false;
    const boundedProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    const boundedMessage = message ? boundedString(message, 500) : null;
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "BackgroundJob" SET "progress" = $3, "progressMessage" = $4, "updatedAt" = NOW()
       WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
         AND "leaseExpiresAt" > NOW() AND "attempts" = $5`,
      job.id,
      job.leaseOwner,
      boundedProgress,
      boundedMessage,
      job.attempts,
    );
    return changed > 0;
  }

  async cancellationRequested(jobId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ requested: boolean }>>(
      `SELECT ("cancelRequestedAt" IS NOT NULL OR "status" = 'CANCELLED') AS requested FROM "BackgroundJob" WHERE "id" = $1 LIMIT 1`,
      jobId,
    );
    return Boolean(rows[0]?.requested);
  }

  async succeed(job: BackgroundJobRecord, workerId: string, result: unknown) {
    if (!job.leaseOwner) return null;
    let committedStatus: "SUCCEEDED" | "CANCELLED" | null = null;
    const resultText = jsonText(result ?? null, MAX_RESULT_BYTES, "Background job result");
    await this.prisma.$transaction(async (tx) => {
      const cancellation = await tx.$queryRawUnsafe<Array<{ status: BackgroundJobStatus; cancelRequestedAt: Date | null }>>(
        `SELECT "status", "cancelRequestedAt" FROM "BackgroundJob"
         WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
           AND "leaseExpiresAt" > NOW() AND "attempts" = $3 FOR UPDATE`, job.id, job.leaseOwner, job.attempts,
      );
      if (!cancellation[0]) return;
      const cancelled = Boolean(cancellation[0].cancelRequestedAt);
      assertBackgroundJobTransition(cancellation[0].status, cancelled ? "CANCELLED" : "SUCCEEDED");
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJob"
         SET "status" = $3, "result" = $4, "progress" = CASE WHEN $3 = 'SUCCEEDED' THEN 100 ELSE "progress" END,
             "progressMessage" = CASE WHEN $3 = 'SUCCEEDED' THEN COALESCE("progressMessage", 'Completed') ELSE COALESCE("progressMessage", 'Cancelled') END,
             "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "finishedAt" = NOW(), "updatedAt" = NOW()
         WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
           AND "leaseExpiresAt" > NOW() AND "attempts" = $5`,
        job.id,
        job.leaseOwner,
        cancelled ? "CANCELLED" : "SUCCEEDED",
        resultText,
        job.attempts,
      );
      if (!updated) return;
      committedStatus = cancelled ? "CANCELLED" : "SUCCEEDED";
      await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJobAttempt" SET "status" = $4, "finishedAt" = NOW(),
             "durationMs" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int)
         WHERE "jobId" = $1 AND "attempt" = $2 AND "workerId" = $3`,
        job.id,
        job.attempts,
        workerId,
        cancelled ? "CANCELLED" : "SUCCEEDED",
      );
    });
    if (committedStatus !== null) this.invalidateCounts();
    return committedStatus;
  }

  async fail(job: BackgroundJobRecord, workerId: string, error: unknown) {
    if (!job.leaseOwner) return null;
    let committedStatus: "QUEUED" | "DEAD_LETTER" | "CANCELLED" | null = null;
    const message = boundedString(error instanceof Error ? error.message : String(error), 2_000) || "Background job failed.";
    const terminal = job.attempts >= job.maxAttempts || (error as { terminalJobFailure?: unknown } | null)?.terminalJobFailure === true;
    const requestedRetryDelayMs = Number((error as { retryDelayMs?: unknown } | null)?.retryDelayMs);
    const retryDelayMs = Number.isFinite(requestedRetryDelayMs) && requestedRetryDelayMs >= 0
      ? Math.max(1_000, Math.min(24 * 60 * 60_000, Math.round(requestedRetryDelayMs)))
      : Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, Math.min(job.attempts - 1, 8)));
    let cancelled = false;
    await this.prisma.$transaction(async (tx) => {
      const locks = await tx.$queryRawUnsafe<Array<{ status: BackgroundJobStatus; cancelRequestedAt: Date | null }>>(
        `SELECT "status", "cancelRequestedAt" FROM "BackgroundJob"
         WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
           AND "leaseExpiresAt" > NOW() AND "attempts" = $3 FOR UPDATE`,
        job.id,
        job.leaseOwner,
        job.attempts,
      );
      if (!locks[0]) return;
      cancelled = Boolean(locks[0].cancelRequestedAt);
      const nextStatus: BackgroundJobStatus = cancelled ? "CANCELLED" : terminal ? "DEAD_LETTER" : "QUEUED";
      assertBackgroundJobTransition(locks[0].status, nextStatus);
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJob"
         SET "status" = $3, "lastError" = $4, "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
             "runAfter" = CASE WHEN $3 = 'QUEUED' THEN NOW() + ($5::bigint * interval '1 millisecond') ELSE "runAfter" END,
             "finishedAt" = CASE WHEN $3 IN ('DEAD_LETTER', 'CANCELLED') THEN NOW() ELSE NULL END,
             "updatedAt" = NOW()
         WHERE "id" = $1 AND "status" = 'RUNNING' AND "leaseOwner" = $2
           AND "leaseExpiresAt" > NOW() AND "attempts" = $6`,
        job.id,
        job.leaseOwner,
        nextStatus,
        message,
        retryDelayMs,
        job.attempts,
      );
      if (!updated) return;
      committedStatus = nextStatus;
      await tx.$executeRawUnsafe(
        `UPDATE "BackgroundJobAttempt" SET "status" = $4, "finishedAt" = NOW(),
             "durationMs" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int), "error" = $5
         WHERE "jobId" = $1 AND "attempt" = $2 AND "workerId" = $3`,
        job.id,
        job.attempts,
        workerId,
        cancelled ? "CANCELLED" : "FAILED",
        message,
      );
    });
    if (committedStatus !== null) {
      this.invalidateCounts();
      this.log("warn", { jobId: job.id, type: job.type, attempt: job.attempts, terminal, cancelled, error: message }, "background job failed");
    }
    return committedStatus;
  }

  async retry(jobId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<BackgroundJobRecord>>(
        `SELECT * FROM "BackgroundJob" WHERE "id" = $1 FOR UPDATE`,
        jobId,
      );
      const current = rows[0] || null;
      if (!current || !["FAILED", "DEAD_LETTER", "CANCELLED"].includes(current.status)) return null;
      assertBackgroundJobTransition(current.status, "QUEUED");
      const updated = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
        `UPDATE "BackgroundJob"
         SET "status" = 'QUEUED',
             "maxAttempts" = LEAST(100, "attempts" + LEAST(5, GREATEST("maxAttempts", 1))),
             "runAfter" = NOW(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
             "cancelRequestedAt" = NULL, "finishedAt" = NULL, "lastError" = NULL, "progress" = 0, "progressMessage" = NULL, "updatedAt" = NOW()
         WHERE "id" = $1 RETURNING *`,
        jobId,
      );
      return updated[0] || null;
    });
    this.invalidateCounts();
    return result;
  }

  async cancel(jobId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
        `SELECT * FROM "BackgroundJob" WHERE "id" = $1 FOR UPDATE`,
        jobId,
      );
      const current = rows[0] || null;
      if (!current || !["QUEUED", "RUNNING"].includes(current.status)) return null;
      assertBackgroundJobTransition(current.status, "CANCELLED");
      const updated = await tx.$queryRawUnsafe<BackgroundJobRecord[]>(
        `UPDATE "BackgroundJob"
         SET "cancelRequestedAt" = COALESCE("cancelRequestedAt", NOW()),
             "status" = CASE WHEN "status" = 'QUEUED' THEN 'CANCELLED' ELSE "status" END,
             "finishedAt" = CASE WHEN "status" = 'QUEUED' THEN NOW() ELSE "finishedAt" END,
             "updatedAt" = NOW()
         WHERE "id" = $1 RETURNING *`,
        jobId,
      );
      return updated[0] || null;
    });
    this.invalidateCounts();
    return result;
  }

  async runNow(jobId: string) {
    const retried = await this.retry(jobId);
    if (retried) return retried;
    const rows = await this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(
      `UPDATE "BackgroundJob" SET "runAfter" = NOW(), "updatedAt" = NOW() WHERE "id" = $1 AND "status" = 'QUEUED' RETURNING *`,
      jobId,
    );
    this.invalidateCounts();
    return rows[0] || null;
  }

  async clearTerminalByType(typeInput: string) {
    const type = normalizeType(typeInput);
    const removed = await this.prisma.$executeRawUnsafe(
      `DELETE FROM "BackgroundJob" WHERE "type" = $1 AND "status" = ANY($2::text[])`,
      type,
      [...TERMINAL_STATUSES],
    );
    this.invalidateCounts();
    return removed;
  }

  async get(jobId: string) {
    const [jobs, attempts] = await Promise.all([
      this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(`SELECT * FROM "BackgroundJob" WHERE "id" = $1 LIMIT 1`, jobId),
      this.prisma.$queryRawUnsafe<BackgroundJobAttemptRecord[]>(`SELECT * FROM "BackgroundJobAttempt" WHERE "jobId" = $1 ORDER BY "attempt" DESC LIMIT 50`, jobId),
    ]);
    return jobs[0] ? { job: jobs[0], attempts } : null;
  }

  async listByIds(jobIds: readonly string[]) {
    const ids = [...new Set(jobIds.map((id) => boundedString(id, 200)).filter(Boolean))].slice(0, 500);
    if (!ids.length) return [] as BackgroundJobRecord[];
    const rows = await this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(
      `SELECT * FROM "BackgroundJob" WHERE "id" = ANY($1::text[]) ORDER BY "updatedAt" DESC`,
      ids,
    );
    const rank = new Map(ids.map((id, index) => [id, index] as const));
    return rows.sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }

  async list(input: { status?: string; queue?: string; type?: string; search?: string; sorts?: readonly ClusterDataSort[]; limit?: number } = {}) {
    const query = backgroundJobListQuery(input, 250);
    return this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(query.sql, ...query.values);
  }

  async listPage(input: { status?: string; queue?: string; type?: string; search?: string; sorts?: readonly ClusterDataSort[]; limit?: number; cursor?: string | null } = {}) {
    const requestedLimit = Math.max(1, Math.min(250, Math.round(Number(input.limit) || 100)));
    const sorts = input.sorts || [];
    const primary = sorts.length === 1 && (sorts[0]?.fieldId === "createdAt" || sorts[0]?.fieldId === "updatedAt") ? sorts[0] : null;
    if (!primary) {
      if (input.cursor) throw Object.assign(new Error("Cursor paging requires one createdAt or updatedAt sort."), { code: "DATA_CURSOR_SORT_UNSUPPORTED", statusCode: 400 });
      const rows = await this.list({ ...input, limit: requestedLimit });
      return { rows, nextCursor: null, hasMore: false, cursorSupported: false };
    }
    const decoded = decodeCursor(input.cursor);
    if (input.cursor && !decoded) throw Object.assign(new Error("The Data View cursor is invalid or expired."), { code: "DATA_CURSOR_INVALID", statusCode: 400 });
    const cursor = decoded ? { field: primary.fieldId as "createdAt" | "updatedAt", direction: primary.direction, at: decoded.at, id: decoded.id } : null;
    const query = backgroundJobListQuery({ ...input, limit: requestedLimit + 1 }, 251, cursor);
    const records = await this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(query.sql, ...query.values);
    const hasMore = records.length > requestedLimit;
    const rows = hasMore ? records.slice(0, requestedLimit) : records;
    const last = rows.at(-1);
    return {
      rows,
      hasMore,
      cursorSupported: true,
      nextCursor: hasMore && last ? encodeCursor({ at: last[primary.fieldId as "createdAt" | "updatedAt"], id: last.id }) : null,
    };
  }

  async listForExport(input: { status?: string; queue?: string; type?: string; search?: string; sorts?: readonly ClusterDataSort[]; limit?: number } = {}) {
    const requestedLimit = Math.max(1, Math.min(10_000, Math.round(Number(input.limit) || 10_000)));
    const query = backgroundJobListQuery({ ...input, limit: requestedLimit + 1 }, 10_001);
    const rows = await this.prisma.$queryRawUnsafe<BackgroundJobRecord[]>(query.sql, ...query.values);
    return { rows: rows.slice(0, requestedLimit), truncated: rows.length > requestedLimit };
  }

  async analytics(input: { status?: string; queue?: string; type?: string; search?: string; facets?: readonly string[]; aggregations?: readonly ClusterDataAggregation[] } = {}) {
    const buildWhere = () => {
      const clauses: string[] = [];
      const values: unknown[] = [];
      const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
      if (input.status) add(`"status" = ?`, boundedString(input.status, 32).toUpperCase());
      if (input.queue) add(`"queue" = ?`, normalizeQueue(input.queue));
      if (input.type) add(`"type" = ?`, normalizeType(input.type));
      const search = boundedString(input.search, 500);
      if (search) {
        values.push(`%${search.replace(/[\%_]/g, "\\$&")}%`);
        const parameter = `$${values.length}`;
        clauses.push(`("id" ILIKE ${parameter} ESCAPE '\\' OR "queue" ILIKE ${parameter} ESCAPE '\\' OR "type" ILIKE ${parameter} ESCAPE '\\' OR "status" ILIKE ${parameter} ESCAPE '\\' OR COALESCE("correlationId", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("causationId", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("progressMessage", '') ILIKE ${parameter} ESCAPE '\\' OR COALESCE("lastError", '') ILIKE ${parameter} ESCAPE '\\')`);
      }
      return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
    };

    const facetColumns: Record<string, string> = { status: '"status"', queue: '"queue"', type: '"type"' };
    const facets: ClusterDataFacetResult[] = [];
    for (const fieldId of (input.facets || []).slice(0, 12)) {
      const column = facetColumns[fieldId];
      if (!column) continue;
      const filter = buildWhere();
      const rows = await this.prisma.$queryRawUnsafe<Array<{ value: string | null; count: bigint | number | string }>>(
        `SELECT ${column} AS value, COUNT(*)::bigint AS count FROM "BackgroundJob" ${filter.where} GROUP BY ${column} ORDER BY count DESC, value ASC LIMIT 50`,
        ...filter.values,
      );
      facets.push({ fieldId, buckets: rows.map((row) => ({ value: row.value, count: Number(row.count || 0) })) });
    }

    const numericColumns: Record<string, string> = { priority: '"priority"', attempts: '"attempts"', maxAttempts: '"maxAttempts"', progress: '"progress"' };
    const expressions: string[] = [];
    const ids: string[] = [];
    for (const aggregation of (input.aggregations || []).slice(0, 16)) {
      const alias = `a${ids.length}`;
      let expression = "";
      if (aggregation.kind === "count" && !aggregation.fieldId) expression = "COUNT(*)";
      else {
        const column = aggregation.fieldId ? numericColumns[aggregation.fieldId] : null;
        if (!column) continue;
        if (aggregation.kind === "count") expression = `COUNT(${column})`;
        else if (aggregation.kind === "count_distinct") expression = `COUNT(DISTINCT ${column})`;
        else if (aggregation.kind === "sum") expression = `SUM(${column})`;
        else if (aggregation.kind === "average") expression = `AVG(${column})`;
        else if (aggregation.kind === "min") expression = `MIN(${column})`;
        else if (aggregation.kind === "max") expression = `MAX(${column})`;
      }
      if (!expression) continue;
      expressions.push(`${expression} AS "${alias}"`);
      ids.push(aggregation.id);
    }
    const aggregations: Record<string, number | null> = {};
    if (expressions.length) {
      const filter = buildWhere();
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, bigint | number | string | null>>>(`SELECT ${expressions.join(", ")} FROM "BackgroundJob" ${filter.where}`, ...filter.values);
      const row = rows[0] || {};
      ids.forEach((id, index) => { const raw = row[`a${index}`]; aggregations[id] = raw == null ? null : Number(raw); });
    }
    return { facets, aggregations };
  }

  async pressure() {
    const [ageRows, stalledRows, queueRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ oldestQueuedAt: Date | null; oldestQueuedAgeMs: bigint | number | string | null }>>(
        `SELECT MIN("createdAt") AS "oldestQueuedAt",
                CASE WHEN MIN("createdAt") IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - MIN("createdAt"))) * 1000)::bigint END AS "oldestQueuedAgeMs"
         FROM "BackgroundJob" WHERE "status" = 'QUEUED' AND "runAfter" <= NOW()`,
      ),
      this.prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
        `SELECT COUNT(*)::bigint AS count FROM "BackgroundJob" WHERE "status" = 'RUNNING' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < NOW()`,
      ),
      this.prisma.$queryRawUnsafe<Array<{ queue: string; status: string; count: bigint | number | string }>>(
        `SELECT "queue", "status", COUNT(*)::bigint AS count FROM "BackgroundJob" GROUP BY "queue", "status" ORDER BY "queue" ASC`,
      ),
    ]);
    const grouped = new Map<string, { queue: string; queued: number; running: number; failed: number; deadLetter: number; total: number }>();
    for (const row of queueRows) {
      const current = grouped.get(row.queue) || { queue: row.queue, queued: 0, running: 0, failed: 0, deadLetter: 0, total: 0 };
      const count = Number(row.count || 0);
      current.total += count;
      if (row.status === "QUEUED") current.queued += count;
      else if (row.status === "RUNNING") current.running += count;
      else if (row.status === "FAILED") current.failed += count;
      else if (row.status === "DEAD_LETTER") current.deadLetter += count;
      grouped.set(row.queue, current);
    }
    const oldestQueuedAt = ageRows[0]?.oldestQueuedAt || null;
    const oldestQueuedAgeMs = ageRows[0]?.oldestQueuedAgeMs == null ? null : Number(ageRows[0].oldestQueuedAgeMs);
    return {
      oldestQueuedAt: oldestQueuedAt instanceof Date ? oldestQueuedAt.toISOString() : oldestQueuedAt,
      oldestQueuedAgeMs,
      stalledLeases: Number(stalledRows[0]?.count || 0),
      byQueue: [...grouped.values()].sort((a, b) => (b.deadLetter + b.failed + b.queued + b.running) - (a.deadLetter + a.failed + a.queued + a.running) || a.queue.localeCompare(b.queue)).slice(0, 24),
    };
  }

  async counts(force = false): Promise<BackgroundJobQueueCounts> {
    if (!force && this.cachedCounts && Date.now() - this.cachedCounts.at < 2_000) return this.cachedCounts.value;
    const readGeneration = this.countsGeneration;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ status: string; count: bigint | number | string }>>(
      `SELECT "status", COUNT(*)::bigint AS count FROM "BackgroundJob" GROUP BY "status"`,
    );
    const map = new Map(rows.map((row) => [String(row.status), Number(row.count)]));
    const value: BackgroundJobQueueCounts = {
      queued: map.get("QUEUED") || 0,
      running: map.get("RUNNING") || 0,
      succeeded: map.get("SUCCEEDED") || 0,
      failed: map.get("FAILED") || 0,
      deadLetter: map.get("DEAD_LETTER") || 0,
      cancelled: map.get("CANCELLED") || 0,
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
    };
    if (this.countsGeneration === readGeneration) {
      this.cachedCounts = { at: Date.now(), value };
    }
    return value;
  }

  async pruneHistory(retentionDays = 30, options: { batchSize?: number; maxRows?: number } = {}) {
    const days = Math.max(1, Math.min(365, Math.round(retentionDays)));
    const batchSize = Math.max(100, Math.min(5_000, Math.round(options.batchSize ?? 1_000)));
    const maxRows = Math.max(batchSize, Math.min(100_000, Math.round(options.maxRows ?? 10_000)));
    let removed = 0;
    while (removed < maxRows) {
      const limit = Math.min(batchSize, maxRows - removed);
      const count = await this.prisma.$executeRawUnsafe(
        `WITH doomed AS (
           SELECT "id" FROM "BackgroundJob"
           WHERE "status" = ANY($1::text[])
             AND "finishedAt" < NOW() - ($2::bigint * interval '1 day')
           ORDER BY "finishedAt" ASC
           LIMIT $3
         )
         DELETE FROM "BackgroundJob" job
         USING doomed
         WHERE job."id" = doomed."id"`,
        [...TERMINAL_STATUSES],
        days,
        limit,
      );
      removed += Number(count || 0);
      if (Number(count || 0) < limit) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.invalidateCounts();
    return removed;
  }

  snapshot() {
    return this.cachedCounts?.value || null;
  }

  private invalidateCounts() {
    this.countsGeneration += 1;
    this.cachedCounts = null;
  }
}
