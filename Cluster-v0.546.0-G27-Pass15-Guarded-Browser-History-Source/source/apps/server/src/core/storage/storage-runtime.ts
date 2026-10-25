import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { LocalStorageProvider, assertRealDirectoryChain, prepareRealDirectory } from "./local-storage-provider.js";
import { S3StorageProvider } from "./s3-storage-provider.js";
import { chooseStorageTier } from "./storage-policy.js";
import { inspectProviderDispositionSafety } from "./storage-disposition-safety.js";
import type { StorageBrowserUploadCapability, StorageLocator, StoragePlacementInput, StorageProvider, StorageReadRange, StorageTier } from "./storage-types.js";

const MANAGED_TIERS: StorageTier[] = ["hot", "standard", "archive", "cache", "temporary"];

export type ClusterStorageRuntimeInput = {
  dataRoot: string;
  sharedRoot?: string | null;
  objectStorage?: {
    endpoint: string;
    bucket: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | null;
  } | null;
};

export class ClusterStorageRuntime {
  private readonly providers = new Map<string, StorageProvider>();
  private readonly tierProviders = new Map<StorageTier, string>();
  private readonly browserUploadProbes = new Map<string, { expiresAt: number; capability: StorageBrowserUploadCapability }>();

  constructor(input: ClusterStorageRuntimeInput) {
    const local = new LocalStorageProvider(path.join(input.dataRoot, "System", "ManagedBlobs"), {
      id: "local",
      kind: "filesystem",
      sharedAcrossNodes: false,
    });
    this.providers.set(local.id, local);
    for (const tier of MANAGED_TIERS) this.tierProviders.set(tier, local.id);

    if (input.sharedRoot) {
      const shared = new LocalStorageProvider(path.resolve(input.sharedRoot), {
        id: "shared",
        kind: "shared-filesystem",
        sharedAcrossNodes: true,
      });
      this.providers.set(shared.id, shared);
      for (const tier of ["hot", "standard", "archive"] as StorageTier[]) this.tierProviders.set(tier, shared.id);
    }

    if (input.objectStorage) {
      const object = new S3StorageProvider({ id: "object", ...input.objectStorage });
      this.providers.set(object.id, object);
      this.tierProviders.set("standard", object.id);
      this.tierProviders.set("archive", object.id);
      if (!input.sharedRoot) this.tierProviders.set("hot", object.id);
    }

    // Cache and upload staging remain node-local by design. They are disposable
    // and should not tax shared/object storage latency merely for topology purity.
    this.tierProviders.set("cache", local.id);
    this.tierProviders.set("temporary", local.id);
  }

  place(input: StoragePlacementInput, key: string): StorageLocator {
    const tier = chooseStorageTier(input);
    if (tier === "external") throw new Error("External storage objects must be registered by an external provider.");
    return this.locatorForTier(tier, key);
  }

  locatorForTier(tier: Exclude<StorageTier, "external">, key: string): StorageLocator {
    const provider = this.tierProviders.get(tier);
    if (!provider) throw new Error(`No storage provider is configured for ${tier}.`);
    return { provider, tier, key: String(key).replace(/^\/+/, "") };
  }

  provider(locator: StorageLocator) {
    const provider = this.providers.get(locator.provider);
    if (!provider) throw new Error(`Storage provider ${locator.provider} is unavailable.`);
    return provider;
  }

  providerForTier(tier: Exclude<StorageTier, "external">) {
    const providerId = this.tierProviders.get(tier);
    return providerId ? this.providers.get(providerId) || null : null;
  }

  private directUploadProvider() {
    if (String(process.env.CLUSTER_STORAGE_DIRECT_UPLOADS || "true").trim().toLowerCase() === "false") return null;
    for (const provider of this.providers.values()) {
      if (!provider.capabilities.objectStorage || !provider.capabilities.multipartUploads) continue;
      if (!provider.createMultipartUpload || !provider.createMultipartPartUploadUrl || !provider.completeMultipartUpload || !provider.abortMultipartUpload) continue;
      return provider;
    }
    return null;
  }

  async browserDirectUploadCapability(origin: string | null) {
    const provider = this.directUploadProvider();
    if (!provider) {
      return {
        state: "unsupported",
        origin: String(origin || "").trim() || null,
        detail: "No multipart-capable object-storage provider is configured.",
        allowsPut: null,
        exposesEtag: null,
        allowsContentType: null,
        checkedAt: new Date(),
      } satisfies StorageBrowserUploadCapability;
    }
    const normalizedOrigin = String(origin || "").trim() || null;
    if (!provider.browserUploadCapability) {
      return {
        state: "unverified",
        origin: normalizedOrigin,
        detail: `Storage provider ${provider.id} does not expose browser-upload policy inspection.`,
        allowsPut: null,
        exposesEtag: null,
        allowsContentType: null,
        checkedAt: new Date(),
      } satisfies StorageBrowserUploadCapability;
    }
    const cacheKey = `${provider.id}:${normalizedOrigin || "unknown"}`;
    const cached = this.browserUploadProbes.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.capability;
    const capability = await provider.browserUploadCapability(normalizedOrigin);
    this.browserUploadProbes.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, capability });
    return capability;
  }

  async directUploadTargetForBrowser(key: string, origin: string | null) {
    const target = this.directUploadTarget(key);
    if (!target) return { target: null, capability: await this.browserDirectUploadCapability(origin) };
    const capability = await this.browserDirectUploadCapability(origin);
    return { target, capability };
  }

  directUploadTarget(key: string): StorageLocator | null {
    if (String(process.env.CLUSTER_STORAGE_DIRECT_UPLOADS || "true").trim().toLowerCase() === "false") return null;
    const provider = this.directUploadProvider();
    if (provider) return { provider: provider.id, tier: "temporary", key: String(key).replace(/^\/+/, "") };
    return null;
  }

  providerKey(locator: StorageLocator) { return `${locator.tier}/${locator.key}`; }
  async putFile(locator: StorageLocator, sourcePath: string, signal?: AbortSignal) { return this.provider(locator).putFile(this.providerKey(locator), sourcePath, { signal }); }

  async copy(locator: StorageLocator, target: StorageLocator, input: { checksumSha256?: string | null; signal?: AbortSignal } = {}) {
    const sourceProvider = this.provider(locator);
    const targetProvider = this.provider(target);
    const sourceKey = this.providerKey(locator);
    const targetKey = this.providerKey(target);
    if (sourceProvider.id === targetProvider.id && targetProvider.copyObject) {
      return targetProvider.copyObject(sourceKey, targetKey, input);
    }
    const sourceStat = await sourceProvider.stat(sourceKey);
    const sourceStream = await sourceProvider.openRead(sourceKey);
    try {
      return await targetProvider.putStream(targetKey, sourceStream, {
        size: sourceStat.size,
        checksumSha256: input.checksumSha256 || sourceStat.checksumSha256 || null,
        signal: input.signal,
      });
    } catch (error) {
      // An unsuccessful stream does NOT prove the target is ours to remove.
      // Another writer may have completed/claimed the exact key in the meantime.
      // Leave unknown bytes for a separately fenced reconciliation protocol.
      throw error;
    }
  }

  async createMultipartUpload(locator: StorageLocator, input: { contentType?: string | null; signal?: AbortSignal } = {}) {
    const provider = this.provider(locator);
    if (!provider.createMultipartUpload) throw new Error(`Storage provider ${provider.id} does not support multipart upload sessions.`);
    return provider.createMultipartUpload(this.providerKey(locator), input);
  }

  async createMultipartPartUploadUrl(locator: StorageLocator, uploadId: string, partNumber: number, expiresSeconds: number) {
    const provider = this.provider(locator);
    if (!provider.createMultipartPartUploadUrl) throw new Error(`Storage provider ${provider.id} cannot presign multipart parts.`);
    return provider.createMultipartPartUploadUrl(this.providerKey(locator), uploadId, partNumber, expiresSeconds);
  }

  async completeMultipartUpload(locator: StorageLocator, uploadId: string, parts: import("./storage-types.js").StorageMultipartPart[], input: { checksumSha256?: string | null; signal?: AbortSignal } = {}) {
    const provider = this.provider(locator);
    if (!provider.completeMultipartUpload) throw new Error(`Storage provider ${provider.id} cannot complete multipart uploads.`);
    return provider.completeMultipartUpload(this.providerKey(locator), uploadId, parts, input);
  }

  async inspectMultipartUpload(locator: StorageLocator, uploadId: string) {
    const provider = this.provider(locator);
    if (!provider.inspectMultipartUpload) return null;
    return provider.inspectMultipartUpload(this.providerKey(locator), uploadId);
  }

  async abortMultipartUpload(locator: StorageLocator, uploadId: string) {
    const provider = this.provider(locator);
    if (!provider.abortMultipartUpload) throw new Error(`Storage provider ${provider.id} cannot abort multipart uploads.`);
    return provider.abortMultipartUpload(this.providerKey(locator), uploadId);
  }

  async materializeToFile(locator: StorageLocator, targetPath: string, signal?: AbortSignal) {
    const provider = this.provider(locator);
    const providerKey = this.providerKey(locator);
    if (provider.materializeToFile) return provider.materializeToFile(providerKey, targetPath, { signal });
    const sourceStat = await provider.stat(providerKey);
    const target = path.resolve(targetPath);
    // The remote/S3 provider takes this fallback. It must apply the same local
    // destination-parent checks as node-local materialization rather than
    // trusting mkdir() to protect against junctions or symlinked ancestors.
    await prepareRealDirectory(path.dirname(target));
    const partial = `${target}.partial-${process.pid}-${randomUUID()}`;
    try {
      const source = await provider.openRead(providerKey);
      const output = createWriteStream(partial, { flags: "wx", mode: 0o640 });
      if (signal) await pipeline(source as any, output, { signal });
      else await pipeline(source as any, output);
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Materialization cancelled.");
      const copied = await fs.stat(partial);
      if (copied.size !== sourceStat.size) throw new Error(`Materialized file length mismatch: expected ${sourceStat.size}, received ${copied.size}.`);
      const after = await provider.stat(providerKey);
      if (after.size !== sourceStat.size || after.modifiedAt.getTime() !== sourceStat.modifiedAt.getTime()) {
        throw new Error("Remote storage source changed during materialization.");
      }
      await assertRealDirectoryChain(path.dirname(target));
      await fs.rename(partial, target);
      return { size: copied.size, modifiedAt: copied.mtime, method: "copy" as const };
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async stat(locator: StorageLocator) { return this.provider(locator).stat(this.providerKey(locator)); }
  async openRead(locator: StorageLocator, range?: StorageReadRange) { return this.provider(locator).openRead(this.providerKey(locator), range); }
  async delete(locator: StorageLocator) { return this.provider(locator).delete(this.providerKey(locator)); }
  async list(locatorPrefix: StorageLocator) {
    const prefix = this.providerKey(locatorPrefix);
    const items = await this.provider(locatorPrefix).list(prefix);
    const tierPrefix = `${locatorPrefix.tier}/`;
    return items.map((item) => item.startsWith(tierPrefix) ? item.slice(tierPrefix.length) : item);
  }

  async copyToTier(_locator: StorageLocator, _targetTier: Exclude<StorageTier, "external">): Promise<StorageLocator> {
    // The previous helper wrote to a predictable key without a target-generation
    // fence. It must not be re-enabled independently of the tier worker.
    throw new Error("Managed tier migration is disabled pending provider generation fencing and verified recovery.");
  }

  async snapshot() {
    const providers = await Promise.all([...this.providers.values()].map(async (provider) => ({
      id: provider.id,
      kind: provider.kind,
      durable: provider.durable,
      sharedAcrossNodes: provider.sharedAcrossNodes,
      capabilities: provider.capabilities,
      dispositionSafety: inspectProviderDispositionSafety(provider),
      ...(await provider.health()),
    })));
    return {
      automaticPlacement: true,
      // No disposition or tier transition execution is unlocked by capability inventory.
      automaticTierMigration: false,
      physicalManagedBlobGC: false,
      physicalLibraryDisposal: false,
      tiers: Object.fromEntries([...this.tierProviders.entries()]),
      providers,
      browserUploadProbes: [...this.browserUploadProbes.entries()].map(([key, value]) => ({
        key,
        expiresAt: new Date(value.expiresAt).toISOString(),
        ...value.capability,
      })),
    };
  }
}

export function createClusterStorageRuntimeFromEnvironment(dataRoot: string) {
  const sharedRoot = String(process.env.CLUSTER_STORAGE_SHARED_ROOT || "").trim() || null;
  const endpoint = String(process.env.CLUSTER_STORAGE_S3_ENDPOINT || "").trim();
  const bucket = String(process.env.CLUSTER_STORAGE_S3_BUCKET || "").trim();
  const accessKeyId = String(process.env.CLUSTER_STORAGE_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.CLUSTER_STORAGE_S3_SECRET_ACCESS_KEY || "");
  const anyObjectConfig = Boolean(endpoint || bucket || accessKeyId || secretAccessKey);
  if (anyObjectConfig && !(endpoint && bucket && accessKeyId && secretAccessKey)) {
    throw new Error("S3-compatible storage requires endpoint, bucket, access key ID, and secret access key together.");
  }

  return new ClusterStorageRuntime({
    dataRoot,
    sharedRoot,
    objectStorage: anyObjectConfig ? {
      endpoint,
      bucket,
      region: String(process.env.CLUSTER_STORAGE_S3_REGION || "us-east-1").trim() || "us-east-1",
      accessKeyId,
      secretAccessKey,
      sessionToken: String(process.env.CLUSTER_STORAGE_S3_SESSION_TOKEN || "").trim() || null,
    } : null,
  });
}

export function managedWorkspaceBlobStorageKey(workspaceId: string, checksumSha256: string) {
  const workspace = String(workspaceId || "").trim();
  const checksum = String(checksumSha256 || "").trim().toLowerCase();
  if (!workspace || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Managed blob storage requires workspace identity and a SHA-256 checksum.");
  return `workspaces/${workspace}/blobs/sha256/${checksum.slice(0, 2)}/${checksum}`;
}

export function managedProjectStorageKey(workspaceId: string, projectId: string, suffix = "") {
  const workspace = String(workspaceId || "").trim();
  const project = String(projectId || "").trim();
  if (!workspace || !project) throw new Error("Managed project storage requires workspace and project identity.");
  const normalizedSuffix = String(suffix || "").replace(/^\/+/, "");
  return `workspaces/${workspace}/projects/${project}${normalizedSuffix ? `/${normalizedSuffix}` : ""}`;
}

export function storageLocatorForManagedFile(file: any): StorageLocator | null {
  const blob = file?.managedBlob;
  if (!blob?.storageProvider || !blob?.storageTier || !blob?.storageKey) return null;
  return { provider: String(blob.storageProvider), tier: blob.storageTier as StorageTier, key: String(blob.storageKey) };
}
