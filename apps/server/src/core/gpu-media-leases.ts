import { randomUUID } from "node:crypto";

/**
 * PostgreSQL provides the shared source of truth for GPU slots among Cluster
 * media workers. Host/device identity deliberately scopes the quota to a
 * physical adapter, while a DB transaction advisory-lock serializes competing
 * admissions. No media process runs while holding a DB transaction open.
 *
 * If the database cannot grant/renew a lease, the caller must not use GPU.
 */
type Database = {
  $transaction: (run: (tx: any) => Promise<unknown>, options?: { timeout?: number }) => Promise<any>;
  $queryRaw: (parts: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;
  $executeRaw: (parts: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
};

export type GpuMediaLease = { id: string; host: string; deviceId: string; jobId: string };

export class GpuMediaLeaseLost extends Error {
  constructor() { super("GPU_MEDIA_LEASE_LOST: GPU capacity lease could not be renewed."); }
}

export class GpuMediaLeaseCoordinator {
  private readonly db: Database;
  private readonly ttlSeconds: number;
  private readonly renewIntervalMs: number;
  constructor(db: Database, ttlSeconds = 45, renewIntervalMs?: number) {
    this.db = db;
    this.ttlSeconds = ttlSeconds;
    this.renewIntervalMs = renewIntervalMs ?? Math.max(2_000, Math.floor(ttlSeconds * 1_000 / 3));
  }

  async tryAcquire(input: { host: string; deviceId: string; jobId: string; limit: number }): Promise<GpuMediaLease | null> {
    const limit = Math.max(0, Math.min(16, Math.floor(input.limit)));
    if (!limit || !input.host || !input.deviceId || !input.jobId) return null;
    const { host, deviceId, jobId } = input;
    const id = randomUUID();
    const leaseSeconds = Math.max(15, Math.min(120, Math.floor(this.ttlSeconds)));
    return this.db.$transaction(async (tx) => {
      // A single xact-scoped advisory lock serializes admissions per host/card.
      // `pg_try_` refuses admission instead of holding a connection indefinitely.
      const lock = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('cluster-gpu-media'), hashtext(${`${host}|${deviceId}`})) AS acquired`;
      if (lock[0]?.acquired !== true) return null;
      await tx.$executeRaw`DELETE FROM "GpuMediaLease" WHERE "expiresAt" <= clock_timestamp()`;
      const active = await tx.$queryRaw`SELECT count(*)::integer AS count FROM "GpuMediaLease" WHERE "host" = ${host} AND "deviceId" = ${deviceId} AND "expiresAt" > clock_timestamp()`;
      if (Number(active[0]?.count || 0) >= limit) return null;
      await tx.$executeRaw`INSERT INTO "GpuMediaLease" ("id", "host", "deviceId", "jobId", "expiresAt", "createdAt", "updatedAt") VALUES (${id}, ${host}, ${deviceId}, ${jobId}, clock_timestamp() + (${leaseSeconds} * interval '1 second'), clock_timestamp(), clock_timestamp())`;
      return { id, host, deviceId, jobId };
    }, { timeout: 5_000 });
  }

  async renew(lease: GpuMediaLease): Promise<boolean> {
    const seconds = Math.max(15, Math.min(120, Math.floor(this.ttlSeconds)));
    const updated = await this.db.$queryRaw`UPDATE "GpuMediaLease" SET "expiresAt" = clock_timestamp() + (${seconds} * interval '1 second'), "updatedAt" = clock_timestamp() WHERE "id" = ${lease.id} AND "host" = ${lease.host} AND "deviceId" = ${lease.deviceId} AND "jobId" = ${lease.jobId} AND "expiresAt" > clock_timestamp() RETURNING "id"`;
    return updated.length === 1;
  }

  async release(lease: GpuMediaLease): Promise<void> {
    await this.db.$executeRaw`DELETE FROM "GpuMediaLease" WHERE "id" = ${lease.id} AND "host" = ${lease.host} AND "deviceId" = ${lease.deviceId} AND "jobId" = ${lease.jobId}`;
  }

  /** Abort accelerated work before lease expiry if a renewal fails. */
  async run<T>(lease: GpuMediaLease, work: (leaseSignal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let failure: unknown;
    let renewing = false;
    const beat = async () => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      try { if (!await this.renew(lease)) throw new GpuMediaLeaseLost(); }
      catch (error) { failure = error; controller.abort(error); }
      finally { renewing = false; }
    };
    const timer = setInterval(() => { void beat(); }, this.renewIntervalMs);
    // A live hardware job must keep its lease heartbeat alive, even when
    // the current work promise itself has no other Node event-loop handles.
    try {
      const result = await work(controller.signal);
      if (failure) throw failure;
      if (controller.signal.aborted) throw controller.signal.reason || new Error("GPU_MEDIA_LEASE_CANCELLED");
      return result;
    } finally {
      clearInterval(timer);
      signal?.removeEventListener("abort", abort);
      await this.release(lease).catch(() => undefined); // Expiry handles crashed workers.
    }
  }
}