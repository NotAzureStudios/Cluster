import { createHash } from "node:crypto";
import type { ClusterStorageRuntime } from "./storage/storage-runtime.js";
import { storageLocatorForManagedFile } from "./storage/storage-runtime.js";

type IntegrityIssue = {
  kind: "missing-storage" | "size-mismatch" | "checksum-mismatch";
  projectId: string;
  assetId: string;
  detail: string;
};

export type DataIntegritySnapshot = {
  state: "unknown" | "healthy" | "degraded";
  checkedAt: string | null;
  durationMs: number;
  scannedAssets: number;
  checksumSamples: number;
  issues: IntegrityIssue[];
  issueCount: number;
  uncertainMutations: number;
  deadLetterEvents: number;
  deadLetterJobs: number;
  deadLetterWebhooks: number;
  zeroReferenceManagedBlobs: number;
  managedBlobReferenceDrift: number;
  claimedManagedBlobs: number;
  staleManagedBlobClaims: number;
  error: string | null;
};

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sha256Storage(storage: ClusterStorageRuntime, locator: any) {
  const hash = createHash("sha256");
  const stream = await storage.openRead(locator);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export class DataIntegrityRuntime {
  private current: DataIntegritySnapshot = {
    state: "unknown",
    checkedAt: null,
    durationMs: 0,
    scannedAssets: 0,
    checksumSamples: 0,
    issues: [],
    issueCount: 0,
    uncertainMutations: 0,
    deadLetterEvents: 0,
    deadLetterJobs: 0,
    deadLetterWebhooks: 0,
    zeroReferenceManagedBlobs: 0,
    managedBlobReferenceDrift: 0,
    claimedManagedBlobs: 0,
    staleManagedBlobClaims: 0,
    error: null,
  };
  private inFlight: Promise<DataIntegritySnapshot> | null = null;

  constructor(
    private readonly prisma: any,
    private readonly storage: ClusterStorageRuntime,
    private readonly options: { assetLimit?: number; checksumSamples?: number; issueLimit?: number; concurrency?: number } = {},
  ) {}

  snapshot() {
    return { ...this.current, issues: [...this.current.issues] };
  }

  async scan(force = false) {
    if (this.inFlight && !force) return this.inFlight;
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(): Promise<DataIntegritySnapshot> {
    const started = performance.now();
    const assetLimit = Math.max(25, Math.min(5_000, this.options.assetLimit ?? 500));
    const checksumLimit = Math.max(0, Math.min(assetLimit, this.options.checksumSamples ?? 24));
    const issueLimit = Math.max(10, Math.min(1_000, this.options.issueLimit ?? 100));
    const concurrency = Math.max(1, Math.min(32, this.options.concurrency ?? 8));

    try {
      const gcStaleCutoff = new Date(Date.now() - Math.max(1, Number(process.env.CLUSTER_MANAGED_BLOB_GC_STALE_HOURS || 6)) * 60 * 60_000);
      const [assets, uncertainMutations, deadLetterEvents, deadLetterJobs, deadLetterWebhooks, zeroReferenceManagedBlobs, managedBlobSamples, claimedManagedBlobs, staleManagedBlobClaims] = await Promise.all([
        this.prisma.projectFile.findMany({
          where: { archived: false },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: assetLimit,
          select: { id: true, projectId: true, metadata: true, sizeBytes: true, checksumSha256: true, managedBlob: { select: { storageProvider: true, storageTier: true, storageKey: true } } },
        }),
        this.prisma.apiMutationReceipt.count({ where: { state: "uncertain" } }),
        this.prisma.domainEventOutbox.count({ where: { deadLetteredAt: { not: null }, processedAt: null } }),
        this.prisma.backgroundJob.count({ where: { status: "DEAD_LETTER" } }),
        this.prisma.integrationWebhookDelivery.count({ where: { status: "DEAD_LETTER" } }),
        this.prisma.managedBlob.count({ where: { referenceCount: 0 } }),
        this.prisma.managedBlob.findMany({
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: Math.max(25, Math.min(1_000, assetLimit)),
          select: { id: true, referenceCount: true },
        }),
        this.prisma.managedBlob.count({ where: { gcState: "CLAIMED" } }),
        this.prisma.managedBlob.count({ where: { gcState: "CLAIMED", gcClaimedAt: { lt: gcStaleCutoff } } }),
      ]);

      const managedBlobIds = managedBlobSamples.map((blob: any) => blob.id);
      const actualBlobReferences = managedBlobIds.length ? await this.prisma.projectFile.groupBy({
        by: ["managedBlobId"],
        where: { managedBlobId: { in: managedBlobIds } },
        _count: { _all: true },
      }).catch(() => []) : [];
      const actualReferenceCount = new Map(
        actualBlobReferences.map((row: any) => [String(row.managedBlobId), Number(row?._count?._all || 0)])
      );
      const managedBlobReferenceDrift = managedBlobSamples.filter((blob: any) =>
        Number(blob.referenceCount || 0) !== Number(actualReferenceCount.get(String(blob.id)) || 0)
      ).length;

      let checksumSamples = 0;
      const checked = await mapConcurrent(assets, concurrency, async (asset: any, index) => {
        const locator = storageLocatorForManagedFile(asset);
        if (!locator) {
          return { kind: "missing-storage", projectId: asset.projectId, assetId: asset.id, detail: "Managed storage locator is missing." } as IntegrityIssue;
        }
        try {
          const info = await this.storage.stat(locator);
          const expectedSize = Number(asset.sizeBytes || 0);
          if (expectedSize !== info.size) {
            return { kind: "size-mismatch", projectId: asset.projectId, assetId: asset.id, detail: `Expected ${expectedSize} bytes, found ${info.size}.` } as IntegrityIssue;
          }
          if (index < checksumLimit && asset.checksumSha256) {
            checksumSamples += 1;
            const actual = await sha256Storage(this.storage, locator);
            if (actual !== String(asset.checksumSha256)) {
              return { kind: "checksum-mismatch", projectId: asset.projectId, assetId: asset.id, detail: "Stored bytes do not match the recorded SHA-256." } as IntegrityIssue;
            }
          }
          return null;
        } catch (error) {
          return {
            kind: "missing-storage",
            projectId: asset.projectId,
            assetId: asset.id,
            detail: error instanceof Error ? error.message.slice(0, 300) : "Storage object could not be inspected.",
          } as IntegrityIssue;
        }
      });

      const issues = checked.filter((issue): issue is IntegrityIssue => Boolean(issue)).slice(0, issueLimit);
      const issueCount = checked.filter(Boolean).length;
      const degraded = issueCount > 0 || Number(uncertainMutations) > 0 || Number(deadLetterEvents) > 0 || Number(deadLetterJobs) > 0 || Number(deadLetterWebhooks) > 0 || managedBlobReferenceDrift > 0 || Number(staleManagedBlobClaims) > 0;
      this.current = {
        state: degraded ? "degraded" : "healthy",
        checkedAt: new Date().toISOString(),
        durationMs: Number((performance.now() - started).toFixed(1)),
        scannedAssets: assets.length,
        checksumSamples,
        issues,
        issueCount,
        uncertainMutations: Number(uncertainMutations || 0),
        deadLetterEvents: Number(deadLetterEvents || 0),
        deadLetterJobs: Number(deadLetterJobs || 0),
        deadLetterWebhooks: Number(deadLetterWebhooks || 0),
        zeroReferenceManagedBlobs: Number(zeroReferenceManagedBlobs || 0),
        managedBlobReferenceDrift,
        claimedManagedBlobs: Number(claimedManagedBlobs || 0),
        staleManagedBlobClaims: Number(staleManagedBlobClaims || 0),
        error: null,
      };
      return this.snapshot();
    } catch (error) {
      this.current = {
        ...this.current,
        state: "degraded",
        checkedAt: new Date().toISOString(),
        durationMs: Number((performance.now() - started).toFixed(1)),
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      };
      return this.snapshot();
    }
  }
}
