import { clusterDomainEventDescriptor, clusterResourceAddressSchema, type ClusterDomainEvent, type ClusterDomainEventDescriptor, type ClusterResourceAddress } from "@cluster/shared";
export type { ClusterDomainEvent } from "@cluster/shared";
import { randomUUID } from "node:crypto";
import { currentReliabilityContext, runWithReliabilityContext } from "./reliability-context.js";


export type DomainEventConsumer<T = unknown> = (event: ClusterDomainEvent<T>) => void | Promise<void>;


export function createClusterDomainEvent<TPayload>(
  definition: ClusterDomainEventDescriptor,
  input: Omit<ClusterDomainEvent<TPayload>, "id" | "type" | "schemaVersion" | "occurredAt"> & {
    id?: string;
    occurredAt?: Date;
  },
): ClusterDomainEvent<TPayload> {
  return {
    ...input,
    id: String(input.id || randomUUID()).trim(),
    type: definition.type,
    schemaVersion: definition.schemaVersion,
    occurredAt: input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.getTime()) ? input.occurredAt : new Date(),
  };
}

type RawPrisma = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: RawPrisma) => Promise<T>): Promise<T>;
};

type DomainEventOutboxRecord = {
  id: string;
  sequence: bigint;
  type: string;
  schemaVersion: number;
  workspaceId: string | null;
  correlationId: string | null;
  causationId: string | null;
  actorUserId: string | null;
  projectId: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  resourceProjectId: string | null;
  resourceRevision: string | null;
  payload: string;
  completedConsumers: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  occurredAt: Date;
  processedAt: Date | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Logger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
};

type ConsumerRegistration = {
  key: string;
  type: string;
  handler: DomainEventConsumer;
};

/** Owned outbox obligations are verified by both key and event family. */
export type RequiredDomainEventConsumer = Readonly<{ key: string; type: string }>;


const MAX_PAYLOAD_BYTES = 256 * 1024;

// Outbox sequence values are allocated before commit. Without serializing the
// INSERTs, transaction B can commit sequence N+1 before transaction A commits
// sequence N; a sequence-based SSE/poller cursor would then skip A forever.
// This transaction-scoped lock is acquired immediately before every outbox
// INSERT and held by PostgreSQL until its containing transaction commits.
// Rollbacks may leave harmless sequence gaps, but committed rows cannot pass
// an earlier uncommitted outbox writer. This is the sole canonical writer.
const OUTBOX_COMMIT_ORDER_LOCK_SQL = "SELECT pg_advisory_xact_lock(6192449487634434181::bigint)";


function eventType(value: unknown) {
  const type = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/.test(type)) throw new Error("Domain event type is invalid.");
  return type;
}

function consumerKey(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/.test(key)) throw new Error("Domain event consumer key is invalid.");
  return key;
}

function jsonText(value: unknown) {
  const text = JSON.stringify(value ?? {});
  if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) throw new Error(`Domain event payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  return text;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function completedConsumers(value: string) {
  const parsed = parseJson<unknown>(value, []);
  return new Set(Array.isArray(parsed) ? parsed.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean) : []);
}

class DomainEventLeaseLostError extends Error {
  constructor(id: string) {
    super(`Domain event ${id} lease expired or was claimed by another worker.`);
    this.name = "DomainEventLeaseLostError";
  }
}

export class DurableDomainEventRuntime {
  private readonly consumers = new Map<string, ConsumerRegistration>();
  private readonly workerId = `domain-events:${process.pid}:${randomUUID()}`;
  private readonly leaseMs: number;

  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private idleDelayMs = 1_000;
  private processing = false;
  private draining = false;
  private wakePending = false;
  private wakeCount = 0;
  private fallbackPolls = 0;
  private published = 0;
  private processed = 0;
  private deadLettered = 0;
  private consumerInvocations = 0;
  private consumerFailures = 0;
  private lastPublishedAt: Date | null = null;
  private lastProcessedAt: Date | null = null;
  private lastFailureAt: Date | null = null;
  private wakePublisher: (() => void | Promise<void>) | null = null;

  constructor(
    private readonly prisma: RawPrisma,
    private readonly logger: Logger = {},
    private readonly options: { pollMs?: number; leaseMs?: number; batchSize?: number; drainTimeoutMs?: number } = {},
  ) {
    this.leaseMs = Math.max(5_000, Math.min(10 * 60_000, Math.round(this.options.leaseMs ?? 60_000)));
  }

  setWakePublisher(publisher: (() => void | Promise<void>) | null) {
    this.wakePublisher = publisher;
    return this;
  }

  subscribe<T = unknown>(typeValue: string, keyValue: string, handler: DomainEventConsumer<T>) {
    const type = typeValue === "*" ? "*" : eventType(typeValue);
    const key = consumerKey(keyValue);
    if (this.consumers.has(key)) throw new Error(`Domain event consumer key is already registered: ${key}`);
    // Durable checkpoints are based on the registered consumer set. Changing
    // that set while delivery is live can acknowledge an event without doing
    // its required side effects. Tool disable uses *handler admission*, not
    // unregistering a durable consumer; registry mutation belongs to startup
    // and fully drained shutdown only.
    if (this.started || this.processing) throw new Error("Cannot register a durable domain event consumer while delivery is active.");
    const registration: ConsumerRegistration = { key, type, handler: handler as DomainEventConsumer };
    this.consumers.set(key, registration);
    return () => {
      if (this.started || this.processing) throw new Error("Cannot unregister a durable domain event consumer while delivery is active.");
      // A stale disposer must never remove a later owner of this key.
      if (this.consumers.get(key) === registration) this.consumers.delete(key);
    };
  }

  async append<T>(event: ClusterDomainEvent<T>) {
    const created = await this.prisma.$transaction((tx) => this.appendInTransaction(tx, event));
    this.wake();
    return created;
  }

  async appendInTransaction<T>(tx: RawPrisma, event: ClusterDomainEvent<T>) {
    const id = String(event.id || randomUUID()).trim();
    if (!id) throw new Error("Domain event ID is required.");
    const type = eventType(event.type);
    const occurredAt = event.occurredAt instanceof Date && Number.isFinite(event.occurredAt.getTime()) ? event.occurredAt : new Date();
    const payload = jsonText(event.payload);
    const resource = event.resource ? clusterResourceAddressSchema.parse(event.resource) : null;
    const reliability = currentReliabilityContext();
    const schemaVersion = event.schemaVersion ?? 1;
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1_000_000) {
      throw new Error("Domain event schema version is invalid.");
    }
    const descriptor = clusterDomainEventDescriptor(type);
    if (descriptor && descriptor.schemaVersion !== schemaVersion) {
      throw new Error(`Unsupported schema version for ${type}: ${schemaVersion}.`);
    }
    // Verify the same typed contract at publication and replay boundaries.
    // Never let an invalid known event advance a consumer checkpoint.
    descriptor?.payloadSchema?.parse(event.payload);
    // Source and replay must agree on the resource receiving an assignment.
    // Missing addresses are not a harmless fallback: they can bypass scoped
    // consumers and produce inconsistent cross-tool invalidation.
    if (type === "work.assignment.changed") {
      if (!resource || resource.kind !== (event.payload as any)?.resource?.kind ||
          resource.id !== (event.payload as any)?.resource?.id ||
          (resource.projectId || null) !== ((event.payload as any)?.resource?.projectId || null)) {
        throw new Error("Assignment event resource does not match its durable payload.");
      }
    }
    // Assignment resources use the canonical address, never an unrelated
    // activity/Project context as an implicit resource placement. Global
    // Packet/People assignments may occur within a Project without becoming
    // Project-owned resources.
    // An event's Project context is not a resource ownership assertion.
    // Never turn a standalone/Studio resource into a Project-owned address
    // merely because a domain activity happened while viewing that Project.
    const resourceProjectId = resource?.projectId || null;
    const workspaceId = event.workspaceId ? String(event.workspaceId) : reliability?.workspaceId || null;
    const correlationId = event.correlationId ? String(event.correlationId) : reliability?.correlationId || id;
    const causationId = event.causationId ? String(event.causationId) : reliability?.causationId || null;
    // Acquire inside the caller's transaction, never on the Prisma pool or
    // after the INSERT. The lock must span the commit, not just this method.
    await tx.$queryRawUnsafe(OUTBOX_COMMIT_ORDER_LOCK_SQL);
    const rows = await tx.$queryRawUnsafe<DomainEventOutboxRecord[]>(
      `INSERT INTO "DomainEventOutbox" ("id", "type", "schemaVersion", "workspaceId", "correlationId", "causationId", "actorUserId", "projectId", "resourceKind", "resourceId", "resourceProjectId", "resourceRevision", "payload", "occurredAt", "availableAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), NOW())
       ON CONFLICT ("id") DO NOTHING
       RETURNING *`,
      id,
      type,
      schemaVersion,
      workspaceId,
      correlationId,
      causationId,
      event.actorUserId ? String(event.actorUserId) : reliability?.userId || null,
      event.projectId ? String(event.projectId) : null,
      resource?.kind || null,
      resource?.id || null,
      resourceProjectId,
      event.resourceRevision ? String(event.resourceRevision) : null,
      payload,
      occurredAt,
    );
    let created = rows[0] || null;
    if (!created) {
      const existing = await tx.$queryRawUnsafe<DomainEventOutboxRecord[]>(
        `SELECT * FROM "DomainEventOutbox" WHERE "id" = $1 LIMIT 1`,
        id,
      );
      created = existing[0] || null;
      if (!created) throw new Error(`Domain event ${id} could not be resolved after idempotent insert.`);
      if (created.type !== type || created.payload !== payload || Number(created.schemaVersion || 1) !== schemaVersion ||
          created.workspaceId !== workspaceId || created.correlationId !== correlationId || created.causationId !== causationId ||
          created.actorUserId !== (event.actorUserId ? String(event.actorUserId) : reliability?.userId || null) ||
          created.projectId !== (event.projectId ? String(event.projectId) : null) ||
          created.resourceKind !== (resource?.kind || null) || created.resourceId !== (resource?.id || null) ||
          created.resourceProjectId !== resourceProjectId ||
          created.resourceRevision !== (event.resourceRevision ? String(event.resourceRevision) : null)) {
        throw new Error(`Domain event ID ${id} was reused for a different event.`);
      }
      return created;
    }
    this.published += 1;
    this.lastPublishedAt = new Date();
    // Best-effort local/cross-process fast path. If this append is inside a wider transaction,
    // the recovery timer will retry after commit if the first wake races it.
    this.wake();
    void Promise.resolve(this.wakePublisher?.()).catch((error) => this.logger.warn?.({ error }, "domain event external wake publish failed"));
    return created;
  }

  wake() {
    if (this.draining || !this.started) return;
    this.wakeCount += 1;
    this.wakePending = true;
    this.idleDelayMs = 1_000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    queueMicrotask(() => { void this.pump(); });
  }

  private scheduleFallback(delayMs: number) {
    if (this.draining || !this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fallbackPolls += 1;
      void this.pump();
    }, Math.max(100, Math.round(delayMs)));
    this.timer.unref?.();
  }

  start(requiredConsumers: readonly RequiredDomainEventConsumer[] = []) {
    if (this.started) return;
    if (this.processing) throw new Error("Cannot start durable domain event delivery before the previous worker has drained.");
    // The outbox cannot reconstruct consumer obligations after it has marked
    // an event processed. Require the finite, composition-owned subscribers
    // by BOTH owner key and event family before permitting claims. A key
    // registered against the wrong type is effectively an absent consumer;
    // acknowledging an event in that state could lose its side effects.
    const obligations = new Map<string, string>();
    for (const required of requiredConsumers) {
      const key = consumerKey(required.key);
      const type = required.type === "*" ? "*" : eventType(required.type);
      if (obligations.has(key)) throw new Error(`Duplicate required domain event consumer: ${key}`);
      obligations.set(key, type);
    }
    const missing = [...obligations].filter(([key, type]) => this.consumers.get(key)?.type !== type)
      .map(([key, type]) => `${key} (${type})`);
    if (missing.length) throw new Error(`Cannot start durable domain event delivery: missing required consumers: ${missing.join(", ")}`);
    this.draining = false;
    this.started = true;
    this.idleDelayMs = Math.max(500, Math.min(5_000, Math.round(this.options.pollMs ?? 1_000)));
    this.wake();
  }

  async drain() {
    this.draining = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A drain deadline is not proof that the in-flight handler finished. If
    // it expires, preserve every registered durable consumer and fail the
    // shutdown barrier rather than silently permitting webhook unsubscription
    // while that handler can still acknowledge the outbox event.
    const timeoutMs = Math.max(20, Math.min(60_000, Math.round(this.options.drainTimeoutMs ?? 10_000)));
    const deadline = Date.now() + timeoutMs;
    while (this.processing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(20, Math.max(1, deadline - Date.now()))));
    if (this.processing) {
      throw new Error(`Durable domain event drain timed out after ${timeoutMs} ms; consumers must remain registered until delivery settles.`);
    }
  }

  private matchingConsumers(type: string) {
    return [...this.consumers.values()]
      .filter((consumer) => consumer.type === type || consumer.type === "*")
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  private async claim(): Promise<DomainEventOutboxRecord | null> {
    const leaseMs = this.leaseMs;
    return this.prisma.$transaction(async (tx) => {
      const dead = await tx.$executeRawUnsafe(
        `UPDATE "DomainEventOutbox"
         SET "deadLetteredAt" = COALESCE("deadLetteredAt", NOW()), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW()
         WHERE "processedAt" IS NULL AND "deadLetteredAt" IS NULL AND "attempts" >= "maxAttempts"
           AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())`,
      );
      if (dead > 0) this.deadLettered += dead;
      const rows = await tx.$queryRawUnsafe<DomainEventOutboxRecord[]>(
        `WITH candidate AS (
           SELECT "id" FROM "DomainEventOutbox"
           WHERE "processedAt" IS NULL
             AND "deadLetteredAt" IS NULL
             AND "attempts" < "maxAttempts"
             AND "availableAt" <= NOW()
             AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())
             -- Retries may shift availableAt beyond a later event. Never
             -- deliver two pending revisions of the same canonical resource
             -- in reverse sequence, even across independent workers. A leased
             -- predecessor also blocks the next one; completed/dead-lettered
             -- predecessors release that resource's lane. Null identities do
             -- not create a global bottleneck for unrelated event families.
             AND (
               "resourceKind" IS NULL OR "resourceId" IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM "DomainEventOutbox" AS predecessor
                 WHERE predecessor."resourceKind" = "DomainEventOutbox"."resourceKind"
                   AND predecessor."resourceId" = "DomainEventOutbox"."resourceId"
                   AND predecessor."sequence" < "DomainEventOutbox"."sequence"
                   AND predecessor."processedAt" IS NULL
                   AND predecessor."deadLetteredAt" IS NULL
               )
             )
           ORDER BY "availableAt" ASC, "sequence" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE "DomainEventOutbox" AS event
         SET "leaseOwner" = $1,
             "leaseExpiresAt" = NOW() + ($2::bigint * interval '1 millisecond'),
             "attempts" = event."attempts" + 1,
             "updatedAt" = NOW()
         FROM candidate
         WHERE event."id" = candidate."id"
         RETURNING event.*`,
        this.workerId,
        leaseMs,
      );
      return rows[0] || null;
    });
  }

  // The lease is a fencing token, not just a claim timestamp. Consumer work
  // can outlive the original lease (webhook fanout, remote integrations, etc.).
  // Renew while it runs; never acknowledge an expired/stolen lease. Downstream
  // effects must still be idempotent because a process can die after an effect.
  private async renewLease(row: DomainEventOutboxRecord) {
    const renewed = await this.prisma.$executeRawUnsafe(
      `UPDATE "DomainEventOutbox"
       SET "leaseExpiresAt" = NOW() + ($3::bigint * interval '1 millisecond'), "updatedAt" = NOW()
       WHERE "id" = $1 AND "leaseOwner" = $2 AND "leaseExpiresAt" > NOW()
         AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
      row.id,
      this.workerId,
      this.leaseMs,
    );
    if (renewed !== 1) throw new DomainEventLeaseLostError(row.id);
  }

  private async withLeaseHeartbeat<T>(row: DomainEventOutboxRecord, work: (checkLease: () => void) => Promise<T>): Promise<T> {
    let stopped = false;
    let failure: unknown = null;
    let timer: NodeJS.Timeout | null = null;
    let renewal: Promise<void> = Promise.resolve();
    const checkLease = () => { if (failure) throw failure; };
    const interval = Math.max(1_000, Math.floor(this.leaseMs / 3));
    const schedule = () => {
      if (stopped || failure) return;
      timer = setTimeout(() => {
        timer = null;
        renewal = this.renewLease(row).catch((error) => {
          failure = error;
        }).finally(schedule);
      }, interval);
      timer.unref?.();
    };
    // Prove that this worker still owns the lease before any consumer starts.
    await this.renewLease(row);
    schedule();
    try {
      const result = await work(checkLease);
      await renewal;
      checkLease();
      return result;
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      await renewal;
    }
  }

  private async markConsumerComplete(row: DomainEventOutboxRecord, completed: Set<string>, key: string) {
    const next = new Set(completed);
    next.add(key);
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "DomainEventOutbox" SET "completedConsumers" = $3, "updatedAt" = NOW()
       WHERE "id" = $1 AND "leaseOwner" = $2 AND "leaseExpiresAt" > NOW()
         AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
      row.id,
      this.workerId,
      JSON.stringify([...next].sort()),
    );
    if (changed !== 1) throw new DomainEventLeaseLostError(row.id);
    completed.add(key);
  }

  private async succeed(row: DomainEventOutboxRecord) {
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "DomainEventOutbox"
       SET "processedAt" = NOW(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
       WHERE "id" = $1 AND "leaseOwner" = $2 AND "leaseExpiresAt" > NOW()
         AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
      row.id,
      this.workerId,
    );
    if (changed !== 1) throw new DomainEventLeaseLostError(row.id);
    this.processed += 1;
    this.lastProcessedAt = new Date();
  }

  private async fail(row: DomainEventOutboxRecord, error: unknown) {
    const message = String(error instanceof Error ? error.message : error || "Domain event consumer failed.").slice(0, 2_000);
    const retryDelayMs = Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, Math.min(row.attempts - 1, 9)));
    const terminal = row.attempts >= row.maxAttempts;
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "DomainEventOutbox"
       SET "lastError" = $3,
           "leaseOwner" = NULL,
           "leaseExpiresAt" = NULL,
           "availableAt" = CASE WHEN $4::boolean THEN "availableAt" ELSE NOW() + ($5::bigint * interval '1 millisecond') END,
           "deadLetteredAt" = CASE WHEN $4::boolean THEN NOW() ELSE "deadLetteredAt" END,
           "updatedAt" = NOW()
       WHERE "id" = $1 AND "leaseOwner" = $2 AND "leaseExpiresAt" > NOW()
         AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
      row.id,
      this.workerId,
      message,
      terminal,
      retryDelayMs,
    );
    if (changed !== 1) throw new DomainEventLeaseLostError(row.id);
    if (terminal) this.deadLettered += 1;
    this.consumerFailures += 1;
    this.lastFailureAt = new Date();
    this.logger.warn?.({ eventId: row.id, eventType: row.type, attempt: row.attempts, terminal, error: message }, "durable domain event delivery failed");
  }

  private async deliver(row: DomainEventOutboxRecord, checkLease: () => void = () => {}) {
    const descriptor = clusterDomainEventDescriptor(eventType(row.type));
    if (descriptor && descriptor.schemaVersion !== Number(row.schemaVersion)) {
      throw new Error(`Unsupported persisted schema version for ${row.type}: ${row.schemaVersion}.`);
    }
    // Reject malformed stored events rather than silently replacing corrupt
    // JSON with {}, which would mark all consumers complete without delivery.
    let decodedPayload: unknown;
    try { decodedPayload = JSON.parse(row.payload); }
    catch { throw new Error(`Invalid persisted payload for ${row.type}.`); }
    descriptor?.payloadSchema?.parse(decodedPayload);
    // The outbox is trusted for durability, not blindly for identity: a
    // corrupted/mismatched stored address must never reach a consumer.
    if (Boolean(row.resourceKind) !== Boolean(row.resourceId)) {
      throw new Error(`Invalid persisted resource identity for ${row.type}.`);
    }
    const persistedResource = row.resourceKind && row.resourceId
      ? clusterResourceAddressSchema.parse({
        kind: row.resourceKind, id: row.resourceId,
        ...(row.resourceProjectId ? { projectId: row.resourceProjectId } : {}),
      })
      : null;
    if (row.type === "work.assignment.changed" &&
        (!persistedResource || persistedResource.kind !== (decodedPayload as any)?.resource?.kind ||
          persistedResource.id !== (decodedPayload as any)?.resource?.id ||
          (persistedResource.projectId || null) !== ((decodedPayload as any)?.resource?.projectId || null))) {
      throw new Error("Persisted assignment event resource does not match its durable payload.");
    }
    const event: ClusterDomainEvent = {
      id: row.id,
      type: row.type,
      schemaVersion: row.schemaVersion,
      workspaceId: row.workspaceId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
      actorUserId: row.actorUserId,
      projectId: row.projectId,
      resource: persistedResource,
      resourceRevision: row.resourceRevision,
      payload: decodedPayload,
    };
    const completed = completedConsumers(row.completedConsumers);
    for (const consumer of this.matchingConsumers(event.type)) {
      if (completed.has(consumer.key)) continue;
      checkLease();
      this.consumerInvocations += 1;
      await runWithReliabilityContext({
        correlationId: row.correlationId || row.id,
        causationId: row.id,
        workspaceId: row.workspaceId,
        userId: row.actorUserId,
      }, () => consumer.handler(event));
      checkLease();
      await this.markConsumerComplete(row, completed, consumer.key);
    }
    checkLease();
    await this.succeed(row);
  }

  private async pump() {
    if (this.processing || this.draining || !this.started) return;
    this.processing = true;
    this.wakePending = false;
    let claimed = 0;
    try {
      const batchSize = Math.max(1, Math.min(200, Math.round(this.options.batchSize ?? 50)));
      for (let index = 0; index < batchSize && !this.draining; index += 1) {
        const row = await this.claim();
        if (!row) break;
        claimed += 1;
        try { await this.withLeaseHeartbeat(row, (checkLease) => this.deliver(row, checkLease)); }
        catch (error) {
          // A previous owner cannot mark a newly claimed event failed or
          // dead-lettered. A new worker already owns the recovery attempt.
          if (error instanceof DomainEventLeaseLostError) continue;
          try { await this.fail(row, error); }
          catch (failure) {
            if (!(failure instanceof DomainEventLeaseLostError)) throw failure;
          }
        }
      }
    } catch (error) {
      this.lastFailureAt = new Date();
      this.logger.error?.(error, "durable domain event pump failed");
    } finally {
      this.processing = false;
      if (this.wakePending && !this.draining) {
        queueMicrotask(() => { void this.pump(); });
      } else if (!this.draining) {
        const maxIdleMs = Math.max(15_000, Math.min(5 * 60_000, Number(process.env.CLUSTER_EVENT_MAX_IDLE_POLL_MS || 60_000)));
        this.idleDelayMs = claimed > 0 ? 1_000 : Math.min(maxIdleMs, Math.max(2_000, this.idleDelayMs * 2));
        this.scheduleFallback(this.idleDelayMs);
      }
    }
  }

  snapshot() {
    const byType = new Map<string, string[]>();
    for (const consumer of this.consumers.values()) {
      const list = byType.get(consumer.type) || [];
      list.push(consumer.key);
      byType.set(consumer.type, list);
    }
    return {
      mode: "postgresql-outbox",
      running: this.started && !this.draining,
      processing: this.processing,
      idleFallbackMs: this.idleDelayMs,
      wakeCount: this.wakeCount,
      fallbackPolls: this.fallbackPolls,
      workerId: this.workerId,
      published: this.published,
      processed: this.processed,
      deadLettered: this.deadLettered,
      consumerInvocations: this.consumerInvocations,
      consumerFailures: this.consumerFailures,
      consumers: this.consumers.size,
      lastPublishedAt: this.lastPublishedAt?.toISOString() || null,
      lastProcessedAt: this.lastProcessedAt?.toISOString() || null,
      lastFailureAt: this.lastFailureAt?.toISOString() || null,
      byType: [...byType.entries()].map(([type, keys]) => ({ type, consumers: keys.sort() })).sort((a, b) => a.type.localeCompare(b.type)),
    };
  }
}
