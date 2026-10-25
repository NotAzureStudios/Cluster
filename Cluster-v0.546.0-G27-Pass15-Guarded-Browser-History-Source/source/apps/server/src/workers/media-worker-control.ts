/**
 * Authoritative control posture for Cluster's standalone media worker.
 * Control reads are single-flight and fail closed. A previously active value
 * must not authorize new claims after a lost control connection or stale poll.
 * This does not interrupt media jobs already committing an artifact.
 */
export type MediaWorkerControlState = "active" | "drain" | "maintenance";

export class MediaWorkerControl {
  private resolved: MediaWorkerControlState = "maintenance";
  private verifiedAt: number | null = null;
  private pending: Promise<MediaWorkerControlState> | null = null;
  private stopped = false;

  constructor(
    private readonly read: () => Promise<MediaWorkerControlState>,
    private readonly clock: () => number = Date.now,
    private readonly maximumAgeMs = 15_000,
  ) {
    if (!Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) throw new Error("Media control freshness must be positive.");
  }

  current(): MediaWorkerControlState {
    if (this.stopped) return "drain";
    if (this.verifiedAt === null || this.clock() - this.verifiedAt > this.maximumAgeMs) return "maintenance";
    return this.resolved;
  }

  refresh(): Promise<MediaWorkerControlState> {
    if (this.stopped) return Promise.resolve("drain");
    if (this.pending) return this.pending;
    const attempt = (async (): Promise<MediaWorkerControlState> => {
      try {
        const next = await this.read();
        if (next !== "active" && next !== "drain" && next !== "maintenance") {
          throw new Error("Media worker directive contains an unrecognized state.");
        }
        if (!this.stopped) {
          this.resolved = next;
          this.verifiedAt = this.clock();
        }
        return this.current();
      } catch (error) {
        if (!this.stopped) {
          this.resolved = "maintenance";
          this.verifiedAt = null;
        }
        throw error;
      }
    })();
    this.pending = attempt;
    void attempt.finally(() => { if (this.pending === attempt) this.pending = null; }).catch(() => undefined);
    return attempt;
  }

  stop() {
    this.stopped = true;
    this.resolved = "drain";
    this.verifiedAt = null;
  }
}

/**
 * Read the authoritative media-worker posture without masking database errors.
 * A missing, malformed, or unreachable control row must never mean "active".
 * The worker creates its row with its first heartbeat before reading control.
 */
export async function mediaWorkerDirective(prisma: {
  mediaWorkerHeartbeat: {
    findUnique: (query: { where: { id: string }; select: { desiredState: true } }) => PromiseLike<{ desiredState: unknown } | null>;
  };
}, workerId: string): Promise<MediaWorkerControlState> {
  const row = await prisma.mediaWorkerHeartbeat.findUnique({ where: { id: workerId }, select: { desiredState: true } });
  if (row?.desiredState === "active" || row?.desiredState === "drain" || row?.desiredState === "maintenance") {
    return row.desiredState;
  }
  throw new Error(row ? "Media worker directive is invalid." : "Media worker control record is unavailable.");
}

/**
 * Track the worker's *existing* periodic maintenance callbacks while draining.
 * Intervals alone are not enough: clearing one does not stop its running I/O.
 * Coalescing by task key also avoids overlapping heartbeat/retention writes.
 */
export class MediaWorkerPeriodicTasks {
  private readonly pending = new Map<string, Promise<void>>();
  private stopped = false;

  run(key: string, callback: () => Promise<unknown>): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const active = this.pending.get(key);
    if (active) return active;
    const task = Promise.resolve().then(callback).then(() => undefined);
    const observed = task.finally(() => { if (this.pending.get(key) === observed) this.pending.delete(key); });
    this.pending.set(key, observed);
    return observed;
  }

  async stopAndDrain(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.pending.values()]);
  }
}
