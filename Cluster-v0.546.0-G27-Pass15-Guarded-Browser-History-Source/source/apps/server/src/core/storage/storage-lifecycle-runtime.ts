import { chooseStorageTier } from "./storage-policy.js";
import type { ClusterStorageRuntime } from "./storage-runtime.js";
import type { StorageTier } from "./storage-types.js";

type LifecycleSnapshot = {
  state: "idle" | "running" | "healthy" | "degraded";
  startedAt: string | null;
  completedAt: string | null;
  scanned: number;
  eligible: number;
  migrated: number;
  migratedBytes: number;
  conflicts: number;
  skippedBudget: number;
  failures: number;
  managedBlobsScanned: number;
  managedBlobsEligible: number;
  managedBlobsMigrated: number;
  zeroReferenceBlobs: number;
  gcEligible: number;
  gcDeleted: number;
  gcBytes: number;
  gcConflicts: number;
  gcFailures: number;
  gcDeferred: number;
  sourceCopiesRetained: number;
  tierMigrationDeferred: number;
  tierMigrationDeferredBytes: number;
  gcDeferredBytes: number;
  lastError: string | null;
};

export class StorageLifecycleRuntime {
  private snapshotValue: LifecycleSnapshot = {
    state: "idle",
    startedAt: null,
    completedAt: null,
    scanned: 0,
    eligible: 0,
    migrated: 0,
    migratedBytes: 0,
    conflicts: 0,
    skippedBudget: 0,
    failures: 0,
    managedBlobsScanned: 0,
    managedBlobsEligible: 0,
    managedBlobsMigrated: 0,
    zeroReferenceBlobs: 0,
    gcEligible: 0,
    gcDeleted: 0,
    gcBytes: 0,
    gcConflicts: 0,
    gcFailures: 0,
    gcDeferred: 0,
    sourceCopiesRetained: 0,
    tierMigrationDeferred: 0,
    tierMigrationDeferredBytes: 0,
    gcDeferredBytes: 0,
    lastError: null,
  };
  private inFlight: Promise<LifecycleSnapshot> | null = null;

  constructor(
    private readonly prisma: any,
    private readonly storage: ClusterStorageRuntime,
    private readonly options: {
      scanLimit?: number;
      byteBudget?: number;
      hotWindowDays?: number;
      concurrency?: number;
    } = {},
  ) {}

  snapshot() { return { ...this.snapshotValue }; }

  async run() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.execute().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async execute(): Promise<LifecycleSnapshot> {
    const startedAt = new Date();
    const scanLimit = Math.max(25, Math.min(2_000, this.options.scanLimit ?? Number(process.env.CLUSTER_STORAGE_LIFECYCLE_SCAN_LIMIT || 250)));
    const hotWindowMs = Math.max(1, this.options.hotWindowDays ?? Number(process.env.CLUSTER_STORAGE_HOT_WINDOW_DAYS || 30)) * 24 * 60 * 60_000;
    const hotAfter = Date.now() - hotWindowMs;
    const gcGraceMs = Math.max(1, Number(process.env.CLUSTER_MANAGED_BLOB_GC_GRACE_HOURS || 24)) * 60 * 60_000;
    const gcStaleMs = Math.max(1, Number(process.env.CLUSTER_MANAGED_BLOB_GC_STALE_HOURS || 6)) * 60 * 60_000;
    const gcGraceCutoff = new Date(Date.now() - gcGraceMs);
    const gcStaleCutoff = new Date(Date.now() - gcStaleMs);

    this.snapshotValue = { ...this.snapshotValue, state: "running", startedAt: startedAt.toISOString(), lastError: null };

    try {
      const managedBlobs = await this.prisma.managedBlob.findMany({
        where: { referenceCount: { gt: 0 }, gcState: "ACTIVE" },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: scanLimit,
      });
      const blobIds = managedBlobs.map((blob: any) => blob.id);
      const blobReferences = blobIds.length ? await this.prisma.projectFile.findMany({
        where: { managedBlobId: { in: blobIds } },
        select: {
          managedBlobId: true,
          archived: true,
          updatedAt: true,
          project: { select: { archived: true, status: true, updatedAt: true } },
        },
        take: Math.max(scanLimit * 20, 2_000),
      }) : [];
      const referencesByBlob = new Map<string, any[]>();
      for (const reference of blobReferences) {
        const key = String(reference.managedBlobId || "");
        if (!key) continue;
        const bucket = referencesByBlob.get(key) || [];
        bucket.push(reference);
        referencesByBlob.set(key, bucket);
      }
      const zeroReferenceBlobs = await this.prisma.managedBlob.count({ where: { referenceCount: 0 } });
      const gcCandidates = await this.prisma.managedBlob.findMany({
        where: {
          referenceCount: 0,
          OR: [
            { gcState: "ACTIVE", updatedAt: { lt: gcGraceCutoff } },
            { gcState: "CLAIMED", gcClaimedAt: { lt: gcStaleCutoff } },
          ],
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: scanLimit,
      });

      const candidates: Array<{ blob: any; locator: any; targetTier: Exclude<StorageTier, "external">; size: number }> = [];
      for (const blob of managedBlobs) {
        const references = referencesByBlob.get(String(blob.id)) || [];
        if (!references.length) continue;
        const anyActiveRecent = references.some((reference: any) => {
          const archived = Boolean(reference.archived || reference.project?.archived || String(reference.project?.status || "").toLowerCase() === "archived");
          const updatedAt = new Date(reference.project?.updatedAt || reference.updatedAt).getTime();
          return !archived && updatedAt >= hotAfter;
        });
        const allArchived = references.every((reference: any) =>
          Boolean(reference.archived || reference.project?.archived || String(reference.project?.status || "").toLowerCase() === "archived")
        );
        const locator = { provider: blob.storageProvider, tier: blob.storageTier, key: blob.storageKey };
        const targetTier = chooseStorageTier({
          purpose: "source",
          sizeBytes: Number(blob.sizeBytes || 0),
          regenerable: false,
          archived: allArchived,
          activeProject: anyActiveRecent,
        });
        if (targetTier === "external" || (targetTier === locator.tier && this.storage.provider(locator).id === this.storage.providerForTier(targetTier)?.id)) continue;
        candidates.push({ blob, locator, targetTier, size: Number(blob.sizeBytes || 0) });
      }

      // R68: automatic tier transitions are observational until provider
      // generation/CAS checks, target exclusivity, and restore guarantees exist.
      // The previous runtime copied to a fixed destination key and then CASed
      // the database pointer. Two workers could overwrite the same destination
      // before either CAS, even though neither can safely remove that object.
      // No environment variable may turn these mutations back on.
      const migrated = 0;
      const migratedBytes = 0;
      const sourceCopiesRetained = 0;
      const conflicts = 0;
      const skippedBudget = 0;
      const failures = 0;
      const tierMigrationDeferred = candidates.length;
      const tierMigrationDeferredBytes = candidates.reduce((total, candidate) => total + candidate.size, 0);

      // R67 safety gate: physical ManagedBlob GC cannot rely on a cached
      // referenceCount + age alone. Snapshot retention, provider generations,
      // in-flight uploads and concurrent writers remain unproven. Inspect and
      // report candidates, but DO NOT claim rows or call a storage delete.
      // There is deliberately no environment override for this gate.
      const gcDeleted = 0;
      const gcBytes = 0;
      const gcConflicts = 0;
      const gcFailures = 0;
      const gcDeferred = gcCandidates.length;
      const gcDeferredBytes = gcCandidates.reduce((total: number, blob: any) => total + Number(blob.sizeBytes || 0), 0);

      this.snapshotValue = {
        state: failures || gcFailures ? "degraded" : "healthy",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        scanned: managedBlobs.length,
        eligible: candidates.length,
        migrated,
        migratedBytes,
        conflicts,
        skippedBudget,
        failures,
        managedBlobsScanned: managedBlobs.length,
        managedBlobsEligible: candidates.length,
        managedBlobsMigrated: migrated,
        zeroReferenceBlobs: Number(zeroReferenceBlobs || 0),
        gcEligible: gcCandidates.length,
        gcDeleted,
        gcBytes,
        gcConflicts,
        gcFailures,
        gcDeferred,
        sourceCopiesRetained,
        tierMigrationDeferred,
        tierMigrationDeferredBytes,
        gcDeferredBytes,
        lastError: this.snapshotValue.lastError,
      };
      return this.snapshot();
    } catch (error) {
      this.snapshotValue = {
        ...this.snapshotValue,
        state: "degraded",
        completedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      };
      return this.snapshot();
    }
  }
}
