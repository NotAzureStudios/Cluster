import { CLUSTER_RESOURCE_CHANGE_WIRE_VERSION, clusterResourceChangeSchema, type ClusterResourceChange, type ClusterResourceKind } from "@cluster/shared";

type ChangeRow = {
  id: string;
  sequence: bigint;
  type: string;
  schemaVersion: number;
  resourceKind: string | null;
  resourceId: string | null;
  resourceProjectId: string | null;
  resourceRevision: string | null;
  occurredAt: Date;
};

type ChangeListener = (changes: ClusterResourceChange[]) => void | Promise<void>;
export type ResourceChangeReset = { reason: "cursor_ahead" | "history_replaced"; cursor: string };
type ChangeResetListener = (reset: ResourceChangeReset) => void | Promise<void>;
type ChangeSubscription = { onChanges: ChangeListener; onReset?: ChangeResetListener };

const CHANGE_SELECT = Object.freeze({
  id: true,
  sequence: true,
  type: true,
  schemaVersion: true,
  resourceKind: true,
  resourceId: true,
  resourceProjectId: true,
  resourceRevision: true,
  occurredAt: true,
});

function toChange(row: ChangeRow): ClusterResourceChange | null {
  if (!row.resourceKind || !row.resourceId) return null;
  const projected = {
    wireVersion: CLUSTER_RESOURCE_CHANGE_WIRE_VERSION,
    eventSchemaVersion: Number(row.schemaVersion),
    sequence: row.sequence.toString(),
    ...(row.id ? { cursorIdentity: row.id } : {}),
    eventType: row.type,
    resource: {
      kind: row.resourceKind as ClusterResourceKind,
      id: row.resourceId,
      ...(row.resourceProjectId ? { projectId: row.resourceProjectId } : {}),
    },
    revision: row.resourceRevision,
    occurredAt: row.occurredAt.toISOString(),
  };
  // A malformed outbox identity must never be propagated as an authorized
  // change. Reject the projection so the client will reconcile from the
  // canonical APIs rather than trust an invalid address.
  const parsed = clusterResourceChangeSchema.safeParse(projected);
  if (!parsed.success) throw new Error(`Invalid resource-change outbox record at sequence ${row.sequence.toString()}`);
  return parsed.data;
}

/** A stable identity for a committed outbox sequence, not an authorization grant.
 * Checking the ID as well as the sequence catches restored/replaced history
 * that grew past the former cursor before the next high-water audit. */
export async function resourceChangeSequenceIdentity(prisma: any, sequence: bigint): Promise<string | null> {
  if (sequence <= 0n) return null;
  const record = await prisma.domainEventOutbox.findUnique({ where: { sequence }, select: { id: true } });
  return record?.id ?? null;
}

export async function latestResourceChangeSequence(prisma: any): Promise<bigint> {
  const aggregate = await prisma.domainEventOutbox.aggregate({ _max: { sequence: true } });
  return BigInt(aggregate?._max?.sequence || 0);
}

export async function resourceChangeWindow(prisma: any) {
  const aggregate = await prisma.domainEventOutbox.aggregate({
    where: { resourceKind: { not: null }, resourceId: { not: null } },
    _min: { sequence: true },
    _max: { sequence: true },
  });
  return {
    floor: BigInt(aggregate?._min?.sequence || 0),
    latest: BigInt(aggregate?._max?.sequence || 0),
  };
}

export async function readResourceChanges(prisma: any, after: bigint, limit = 100): Promise<ClusterResourceChange[]> {
  const take = Math.max(1, Math.min(250, Math.trunc(limit || 100)));
  const rows = await prisma.domainEventOutbox.findMany({
    where: {
      sequence: { gt: after },
      resourceKind: { not: null },
      resourceId: { not: null },
    },
    orderBy: { sequence: "asc" },
    take,
    select: CHANGE_SELECT,
  }) as ChangeRow[];
  return rows.map(toChange).filter((entry): entry is ClusterResourceChange => Boolean(entry));
}

/**
 * One database poller per API process. The database remains authoritative;
 * this runtime only fans new envelopes out to SSE clients attached to the
 * current worker. That makes the transport safe to replicate in 30A.7.
 */
export class ResourceChangeRuntime {
  private readonly listeners = new Set<ChangeSubscription>();
  private nextCursorAuditAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextPollAt = 0;
  private started = false;
  private idleDelayMs = 1_000;
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private cursor = 0n;
  private cursorAnchor: { sequence: bigint; id: string } | null = null;
  private polling = false;
  private draining = false;
  private initialized = false;
  private emitted = 0;
  private failures = 0;
  private pollCount = 0;
  private wakeCount = 0;
  private cursorRewinds = 0;
  private historyReplacements = 0;
  private lastCursorRewindAt: string | null = null;
  private lastPollAt: string | null = null;
  private lastWakeAt: string | null = null;

  constructor(
    private readonly prisma: any,
    private readonly logger: { warn?: (payload: unknown, message?: string) => void } = {},
    private readonly options: { pollMs?: number; retentionDays?: number; batchSize?: number; maxIdleMs?: number; cursorAuditMs?: number } = {},
  ) {}

  subscribe(listener: ChangeListener, onReset?: ChangeResetListener) {
    const subscription: ChangeSubscription = { onChanges: listener, onReset };
    this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }

  async start() {
    if (this.started) return;
    this.draining = false;
    this.started = true;
    await this.initialize();
    this.idleDelayMs = Math.max(500, Math.min(5_000, Math.round(this.options.pollMs ?? 750)));
    this.nextCursorAuditAt = 0;
    this.schedulePoll(1);
    this.maintenanceTimer = setInterval(() => { void this.prune(); }, 60 * 60_000);
    this.maintenanceTimer.unref?.();
  }

  wake() {
    if (this.draining || !this.started) return;
    this.wakeCount += 1;
    this.lastWakeAt = new Date().toISOString();
    this.idleDelayMs = Math.max(500, Math.min(5_000, Math.round(this.options.pollMs ?? 750)));
    this.nextCursorAuditAt = 0;
    this.schedulePoll(1);
  }

  private schedulePoll(delayMs: number) {
    if (this.draining || !this.started) return;
    const delay = Math.max(1, Math.round(delayMs));
    const dueAt = Date.now() + delay;
    // A wake may pull the next poll forward, but a burst of wakes must never
    // postpone an already-earlier poll and accidentally debounce realtime work.
    if (this.timer && this.nextPollAt > 0 && this.nextPollAt <= dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextPollAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextPollAt = 0;
      void this.poll();
    }, delay);
    this.timer.unref?.();
  }

  async drain() {
    this.draining = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.timer = null;
    this.nextPollAt = 0;
    this.maintenanceTimer = null;
    const deadline = Date.now() + 5_000;
    while (this.polling && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    this.listeners.clear();
  }

  private async initialize() {
    if (this.initialized) return;
    try {
      this.cursor = await latestResourceChangeSequence(this.prisma);
      const anchor = await resourceChangeSequenceIdentity(this.prisma, this.cursor);
      this.cursorAnchor = anchor ? { sequence: this.cursor, id: anchor } : null;
      this.initialized = true;
    } catch (error) {
      this.failures += 1;
      this.logger.warn?.({ error }, "resource change runtime failed to initialize");
    }
  }

  /**
   * A database can be restored while the API process and its SSE connections
   * are still alive. Reconnect-time checks cannot repair this poller's own
   * remembered cursor. Check the authoritative outbox high-water mark at a
   * bounded cadence, then force every attached client to reconnect and refetch.
   * This is intentionally a control event, never a forged resource change.
   */
  private async reconcileRestoredCursor() {
    const now = Date.now();
    if (now < this.nextCursorAuditAt) return;
    const interval = Math.max(1_000, Math.min(60_000, Math.round(this.options.cursorAuditMs ?? 15_000)));
    // Keep the previous committed-row identity across poll cycles. An outbox
    // restored to an earlier snapshot can regrow ABOVE our cursor before the
    // next check, making a high-water-only test falsely report continuity.
    const latest = await latestResourceChangeSequence(this.prisma);
    const oldAnchor = this.cursorAnchor;
    const currentAnchorId = oldAnchor
      ? await resourceChangeSequenceIdentity(this.prisma, oldAnchor.sequence)
      : null;
    const replaced = Boolean(oldAnchor && currentAnchorId !== oldAnchor.id);
    const rewound = latest < this.cursor;
    // Both successful comparisons and anchor refresh must happen before
    // postponing the next audit. DB outages need an immediate retry.
    const nextAnchorId = !rewound && !replaced && oldAnchor?.sequence === this.cursor
      ? currentAnchorId
      : await resourceChangeSequenceIdentity(this.prisma, rewound || replaced ? latest : this.cursor);
    this.nextCursorAuditAt = now + interval;
    if (!rewound && !replaced) {
      this.cursorAnchor = nextAnchorId ? { sequence: this.cursor, id: nextAnchorId } : null;
      return;
    }
    const previous = this.cursor;
    this.cursor = latest;
    this.cursorAnchor = nextAnchorId ? { sequence: latest, id: nextAnchorId } : null;
    this.cursorRewinds += 1;
    if (replaced) this.historyReplacements += 1;
    this.lastCursorRewindAt = new Date().toISOString();
    const reset: ResourceChangeReset = {
      reason: replaced ? "history_replaced" : "cursor_ahead",
      cursor: latest.toString(),
    };
    this.logger.warn?.({ previousCursor: previous.toString(), cursor: reset.cursor, reason: reset.reason }, "resource change outbox continuity changed; resetting live subscriptions");
    const outcomes = await Promise.allSettled([...this.listeners].filter((subscription) => subscription.onReset).map(async (subscription) => subscription.onReset!(reset)));
    for (const outcome of outcomes) {
      if (outcome.status !== "rejected") continue;
      this.failures += 1;
      this.logger.warn?.({ error: outcome.reason }, "resource change reset subscriber failed");
    }
  }

  private async poll() {
    if (this.polling || this.draining || !this.started) return;
    if (!this.initialized) {
      await this.initialize();
      if (!this.initialized) this.schedulePoll(5_000);
      return;
    }
    this.polling = true;
    this.pollCount += 1;
    let found = 0;
    try {
      await this.reconcileRestoredCursor();
      const batchSize = Math.max(1, Math.min(250, Math.round(this.options.batchSize ?? 100)));
      for (let page = 0; page < 4 && !this.draining; page += 1) {
        const changes = await readResourceChanges(this.prisma, this.cursor, batchSize);
        if (!changes.length) break;
        found += changes.length;
        this.cursor = BigInt(changes.at(-1)?.sequence || this.cursor);
        this.emitted += changes.length;
        const outcomes = await Promise.allSettled([...this.listeners].map((subscription) => subscription.onChanges(changes)));
        for (const outcome of outcomes) {
          if (outcome.status !== "rejected") continue;
          this.failures += 1;
          this.logger.warn?.({ error: outcome.reason }, "resource change subscriber failed");
        }
        if (changes.length < batchSize) break;
      }
      this.lastPollAt = new Date().toISOString();
    } catch (error) {
      this.failures += 1;
      this.logger.warn?.({ error }, "resource change polling failed");
    } finally {
      this.polling = false;
      if (!this.draining) {
        const maxIdleMs = Math.max(5_000, Math.min(5 * 60_000, Math.round(this.options.maxIdleMs ?? 60_000)));
        this.idleDelayMs = found > 0 ? 500 : Math.min(maxIdleMs, Math.max(2_000, this.idleDelayMs * 2));
        this.schedulePoll(this.idleDelayMs);
      }
    }
  }

  private async prune() {
    if (this.draining) return;
    const retentionDays = Math.max(7, Math.min(180, Math.round(this.options.retentionDays ?? 30)));
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
    try {
      const batchSize = Math.max(100, Math.min(10_000, Number(process.env.CLUSTER_RESOURCE_CHANGE_PRUNE_BATCH || 2_000)));
      const candidates = await this.prisma.domainEventOutbox.findMany({
        where: {
          createdAt: { lt: cutoff },
          OR: [{ processedAt: { not: null } }, { deadLetteredAt: { not: null } }],
        },
        orderBy: { sequence: "asc" },
        take: batchSize,
        select: { id: true },
      });
      if (candidates.length) await this.prisma.domainEventOutbox.deleteMany({ where: { id: { in: candidates.map((entry: any) => entry.id) } } });
    } catch (error) {
      this.logger.warn?.({ error }, "resource change retention cleanup failed");
    }
  }

  snapshot() {
    return {
      mode: "event-wake-plus-postgresql-sequence-feed",
      cursor: this.cursor.toString(),
      listeners: this.listeners.size,
      cursorAuditInMs: Math.max(0, this.nextCursorAuditAt - Date.now()),
      cursorRewinds: this.cursorRewinds,
      historyReplacements: this.historyReplacements,
      cursorAnchorSequence: this.cursorAnchor?.sequence.toString() ?? null,
      lastCursorRewindAt: this.lastCursorRewindAt,
      emitted: this.emitted,
      failures: this.failures,
      pollCount: this.pollCount,
      wakeCount: this.wakeCount,
      polling: this.polling,
      idleFallbackMs: this.idleDelayMs,
      nextPollInMs: this.nextPollAt > 0 ? Math.max(0, this.nextPollAt - Date.now()) : null,
      lastPollAt: this.lastPollAt,
      lastWakeAt: this.lastWakeAt,
    };
  }
}
