/** Immutable SHA-256 keyed release artifacts, using Cluster's existing storage providers.
 * Release rows contain a locator, not the object bytes. Old DB-backed releases
 * remain readable until an explicitly governed migration is implemented.
 * Physical deletion/GC is deliberately NOT performed from request handlers.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { Readable } from "node:stream";
import type { ClusterStorageRuntime } from "../../core/storage/storage-runtime.js";
import type { StorageLocator } from "../../core/storage/storage-types.js";
import { packageArtifactLimit, packageKeyFingerprint, packageSigningInput, validatePackageDependencies, validatePackageInstaller, validateSignedPackage, type ClusterPackageManifest } from "./managed-package-policy.js";

export const PACKAGE_ARTIFACT_KEY_PREFIX = "packages/sha256";
export const packageArtifactKey = (sha: string) => {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("PACKAGE_BLOB_ID_INVALID");
  return `${PACKAGE_ARTIFACT_KEY_PREFIX}/${sha.slice(0, 2)}/${sha}`;
};

export type PackageReleaseArtifactRow = {
  artifact?: Uint8Array | null; artifactSha256: string; artifactSize: number;
  artifactStorageProvider?: string | null; artifactStorageTier?: string | null; artifactStorageKey?: string | null;
  signature: string; manifestSha256: string; signingKeyFingerprint: string;
};

export function packageReleaseBlobLocator(row: PackageReleaseArtifactRow): StorageLocator | null {
  const entries = [row.artifactStorageProvider, row.artifactStorageTier, row.artifactStorageKey];
  if (entries.every((value) => value == null)) return null;
  if (entries.some((value) => typeof value !== "string" || !value)) throw new Error("PACKAGE_BLOB_LOCATOR_INVALID");
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(row.artifactStorageProvider!) ||
    !["hot", "standard", "archive"].includes(row.artifactStorageTier!) ||
    row.artifactStorageKey !== packageArtifactKey(row.artifactSha256)) throw new Error("PACKAGE_BLOB_LOCATOR_INVALID");
  if (row.artifact != null) throw new Error("PACKAGE_BLOB_DUAL_AUTHORITY");
  return { provider: row.artifactStorageProvider!, tier: row.artifactStorageTier! as StorageLocator["tier"], key: row.artifactStorageKey! };
}

/** Write before a database transaction and do not delete on DB failures: an
 * identical concurrent publisher might reference the same content-address.
 * Orphan reconciliation requires a separate fenced lifecycle protocol. */
export async function publishPackageArtifact(storage: ClusterStorageRuntime, bytes: Buffer, checksum: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("PACKAGE_BLOB_CHECKSUM_INVALID");
  const locator = storage.locatorForTier("hot", packageArtifactKey(checksum));
  const provider = storage.provider(locator);
  if (!provider.capabilities.streamingWrites || !provider.capabilities.rangeReads || !provider.durable) throw new Error("PACKAGE_BLOB_PROVIDER_UNSUPPORTED");
  await provider.putStream(storage.providerKey(locator), Readable.from([bytes]), { size: bytes.length, checksumSha256: checksum });
  await verifyPackageBlob(storage, locator, bytes.length, checksum);
  return { artifactStorageProvider: locator.provider, artifactStorageTier: locator.tier, artifactStorageKey: locator.key };
}

/** Verify expected size and SHA-256 *as a stream* before issuing any bytes.
 * A damaged provider object fails closed. Zero-copy persistent reads are a
 * separate client capability; current download endpoints still return buffers. */
export async function verifyPackageBlob(storage: ClusterStorageRuntime, locator: StorageLocator, size: number, sha: string) {
  const actual = await storage.stat(locator);
  if (!Number.isSafeInteger(size) || size < 1 || actual.size !== size) throw new Error("PACKAGE_BLOB_SIZE_MISMATCH");
  const hash = createHash("sha256");
  let length = 0;
  for await (const chunk of await storage.openRead(locator)) {
    length += chunk.length;
    if (length > size) throw new Error("PACKAGE_BLOB_SIZE_MISMATCH");
    hash.update(chunk);
  }
  if (length !== size || hash.digest("hex") !== sha) throw new Error("PACKAGE_BLOB_INTEGRITY_FAILED");
}

function verifyMetadata(row: PackageReleaseArtifactRow, manifest: ClusterPackageManifest, publicKeyPem: string) {
  if (manifest.schema !== 1 || manifest.artifactSha256 !== row.artifactSha256 || manifest.artifactSize !== row.artifactSize ||
    !/^[a-z][a-z0-9-]{2,79}$/.test(manifest.packageKey) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version) ||
    !["windows-x64", "linux-x64", "macos-arm64"].includes(manifest.platform) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}\.zip$/.test(manifest.filename) || manifest.filename.includes("..") ||
    Object.keys(manifest).some((key) => !["schema", "packageKey", "version", "platform", "artifactSha256", "artifactSize", "filename", "dependencies", "installer"].includes(key)) ||
    !/^[0-9a-f]{64}$/.test(row.artifactSha256) || !Number.isSafeInteger(row.artifactSize) || row.artifactSize < 1 ||
    row.artifactSize > packageArtifactLimit(manifest))
    throw new Error("PACKAGE_BLOB_MANIFEST_MISMATCH");
  validatePackageDependencies(manifest);
  validatePackageInstaller(manifest);
  const signingInput = packageSigningInput(manifest);
  if (createHash("sha256").update(signingInput).digest("hex") !== row.manifestSha256 ||
      packageKeyFingerprint(publicKeyPem) !== row.signingKeyFingerprint ||
      !/^[A-Za-z0-9+/]{86}==$/.test(row.signature) ||
      createPublicKey(publicKeyPem).asymmetricKeyType !== "ed25519" ||
      !verify(null, signingInput, createPublicKey(publicKeyPem), Buffer.from(row.signature, "base64")))
    throw new Error("PACKAGE_BLOB_SIGNATURE_INVALID");
}

/** Common verified read path, supporting legacy SQL bytes and CAS objects.
 * Metadata authorization must occur separately at the calling endpoint. */
export async function readVerifiedPackageArtifact(
  storage: ClusterStorageRuntime | null | undefined, row: PackageReleaseArtifactRow,
  manifest: ClusterPackageManifest, publicKeyPem: string, range?: { start: number; end: number },
): Promise<Buffer> {
  verifyMetadata(row, manifest, publicKeyPem);
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 ||
      range.end < range.start || range.end >= row.artifactSize)) throw new Error("PACKAGE_BLOB_RANGE_INVALID");
  const locator = packageReleaseBlobLocator(row);
  if (!locator) {
    if (!row.artifact) throw new Error("PACKAGE_BLOB_BYTES_MISSING");
    const checked = validateSignedPackage({ manifest, artifactBase64: Buffer.from(row.artifact).toString("base64"),
      signatureBase64: row.signature, publicKeyPem });
    if (checked.manifestSha256 !== row.manifestSha256 || checked.keyFingerprint !== row.signingKeyFingerprint) throw new Error("PACKAGE_BLOB_METADATA_INVALID");
    return range ? checked.bytes.subarray(range.start, range.end + 1) : checked.bytes;
  }
  if (!storage) throw new Error("PACKAGE_BLOB_STORAGE_UNAVAILABLE");
  await verifyPackageBlob(storage, locator, row.artifactSize, row.artifactSha256);
  const expected = range ? range.end - range.start + 1 : row.artifactSize;
  const parts: Buffer[] = [];
  let received = 0;
  for await (const part of await storage.openRead(locator, range)) {
    received += part.length;
    if (received > expected) throw new Error("PACKAGE_BLOB_RANGE_OVERRUN");
    parts.push(Buffer.from(part));
  }
  if (received !== expected) throw new Error("PACKAGE_BLOB_RANGE_SHORT");
  return Buffer.concat(parts, received);
}
