import { createHash, createPublicKey, verify } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const PACKAGE_MAX_BYTES = 4 * 1024 * 1024;
// MSI envelopes have a separate bounded ceiling. Generic content packages retain
// the smaller budget; this is NOT a streaming multi-GB artifact protocol.
export const PACKAGE_MSI_MAX_BYTES = 32 * 1024 * 1024;
export function packageArtifactLimit(manifest: Pick<ClusterPackageManifest, "installer">) {
  return manifest.installer ? PACKAGE_MSI_MAX_BYTES : PACKAGE_MAX_BYTES;
}
export const PACKAGE_SIGNING_CONTEXT = "CLUSTER_MANAGED_PACKAGE_V1\n";
export type ClusterPackageDependency = { packageKey: string; version: string; requirement: "content-selected" | "msi-installed" };
export type ClusterPackageInstaller = { kind: "windows-msi"; path: string; sha256: string; productCode: string; productVersion: string; scope: "user" };
export type ClusterPackageManifest = { schema: 1; packageKey: string; version: string; platform: "windows-x64" | "linux-x64" | "macos-arm64"; artifactSha256: string; artifactSize: number; filename: string; dependencies?: ClusterPackageDependency[]; installer?: ClusterPackageInstaller };
const PACKAGE_KEY_PATTERN = /^[a-z][a-z0-9-]{2,79}$/;
const PACKAGE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/;
/** Dependencies are part of the release signature, never an editable rollout hint. */
export function validatePackageDependencies(manifest: ClusterPackageManifest) {
  const deps = manifest.dependencies;
  if (deps === undefined) return [];
  if (!Array.isArray(deps) || deps.length === 0 || deps.length > 12) throw new Error("PACKAGE_DEPENDENCIES_INVALID");
  const unique = new Set<string>();
  for (const dep of deps) {
    if (!dep || typeof dep !== "object" || Array.isArray(dep)
      || Object.keys(dep).sort().join(",") !== "packageKey,requirement,version"
      || typeof dep.packageKey !== "string" || typeof dep.version !== "string"
      || (dep.requirement !== "content-selected" && dep.requirement !== "msi-installed")
      || (dep.requirement === "msi-installed" && (manifest.platform !== "windows-x64" || !manifest.installer))
      || !PACKAGE_KEY_PATTERN.test(dep.packageKey) || !PACKAGE_VERSION_PATTERN.test(dep.version)
      || dep.packageKey === manifest.packageKey || unique.has(dep.packageKey))
      throw new Error("PACKAGE_DEPENDENCIES_INVALID");
    unique.add(dep.packageKey);
  }
  return deps;
}

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function packageKeyFingerprint(pem: string) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("PACKAGE_KEY_UNSUPPORTED");
  return sha(key.export({ format: "der", type: "spki" }) as Buffer);
}
/** Inspect ZIP index without extracting or executing entries. ZIP64/multidisk/
 * encrypted/unsupported compression is deliberately out of scope. */
export function inspectManagedPackageZip(data: Buffer, installer?: ClusterPackageInstaller) {
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) throw new Error("PACKAGE_ARCHIVE_INVALID");
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { eocd = i; break; }
  }
  if (eocd < 0 || data.readUInt16LE(eocd + 4) !== 0 || data.readUInt16LE(eocd + 6) !== 0) throw new Error("PACKAGE_ZIP_MULTIDISK_UNSUPPORTED");
  const count = data.readUInt16LE(eocd + 10);
  const declared = data.readUInt16LE(eocd + 8);
  const centralLength = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (!count || count > 500 || declared !== count || centralOffset + centralLength !== eocd || centralOffset >= eocd) throw new Error("PACKAGE_ZIP_INDEX_INVALID");
  let at = centralOffset, expanded = 0, files = 0, matchedInstaller = false;
  const localIntervals: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || data.readUInt32LE(at) !== 0x02014b50) throw new Error("PACKAGE_ZIP_INDEX_INVALID");
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10);
    const compressed = data.readUInt32LE(at + 20), uncompressed = data.readUInt32LE(at + 24);
    const nameLen = data.readUInt16LE(at + 28), extraLen = data.readUInt16LE(at + 30), commentLen = data.readUInt16LE(at + 32);
    const externalAttrs = data.readUInt32LE(at + 38), localAt = data.readUInt32LE(at + 42);
    const next = at + 46 + nameLen + extraLen + commentLen;
    if (next > eocd || !nameLen || (flags & 1) || (flags & 0x08) || (flags & 0x40) || ![0,8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || localAt === 0xffffffff) throw new Error("PACKAGE_ZIP_ENTRY_UNSUPPORTED");
    const expectedCrc = data.readUInt32LE(at + 16);
    const name = data.toString("utf8", at + 46, at + 46 + nameLen);
    const parts = name.split("/");
    if (name.includes("\\") || name.startsWith("/") || /[\u0000-\u001f\u007f:]/.test(name) || parts.some((part, i) => part === ".." || part === "." || (!part && i < parts.length - 1))) throw new Error("PACKAGE_ZIP_PATH_UNSAFE");
    if (!Buffer.from(name, "utf8").equals(data.subarray(at + 46, at + 46 + nameLen))) throw new Error("PACKAGE_ZIP_FILENAME_UNSUPPORTED");
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) throw new Error("PACKAGE_ZIP_DUPLICATE_ENTRY");
    seen.add(normalized);
    const fileMode = (externalAttrs >>> 16) & 0xf000;
    if (fileMode && fileMode !== 0x8000 && fileMode !== 0x4000) throw new Error("PACKAGE_ZIP_SPECIAL_FILE_UNSUPPORTED");
    if (name.endsWith("/") && (compressed || uncompressed)) throw new Error("PACKAGE_ZIP_DIRECTORY_INVALID");
    if (!name.endsWith("/")) {
      files++;
      expanded += uncompressed;
      if (expanded > 64 * 1024 * 1024 || (compressed === 0 && uncompressed > 0) || (compressed > 0 && uncompressed > compressed * 100) || (method === 0 && compressed !== uncompressed)) throw new Error("PACKAGE_ZIP_EXPANSION_UNSAFE");
    }
    if (localAt + 30 > centralOffset || data.readUInt32LE(localAt) !== 0x04034b50) throw new Error("PACKAGE_ZIP_LOCAL_INVALID");
    const localNameLen = data.readUInt16LE(localAt + 26), localExtraLen = data.readUInt16LE(localAt + 28);
    const end = localAt + 30 + localNameLen + localExtraLen + compressed;
    if (end > centralOffset || localNameLen !== nameLen || !data.subarray(localAt + 30, localAt + 30 + nameLen).equals(data.subarray(at + 46, at + 46 + nameLen))) throw new Error("PACKAGE_ZIP_LOCAL_INVALID");
    if (data.readUInt16LE(localAt + 6) !== flags || data.readUInt16LE(localAt + 8) !== method ||
      data.readUInt32LE(localAt + 14) !== expectedCrc || data.readUInt32LE(localAt + 18) !== compressed ||
      data.readUInt32LE(localAt + 22) !== uncompressed)
      throw new Error("PACKAGE_ZIP_HEADER_CONFLICT");
    localIntervals.push({ start: localAt, end });
    const encoded = data.subarray(localAt + 30 + localNameLen + localExtraLen, end);
    let decoded: Buffer;
    try {
      decoded = method === 0 ? encoded : inflateRawSync(encoded, { maxOutputLength: uncompressed || 1 });
    } catch { throw new Error("PACKAGE_ZIP_PAYLOAD_INVALID"); }
    if (decoded.length !== uncompressed || crc32(decoded) !== expectedCrc) throw new Error("PACKAGE_ZIP_PAYLOAD_INTEGRITY_FAILED");
    if (installer && name === installer.path) {
      if (matchedInstaller || sha(decoded) !== installer.sha256 || decoded.length < 8
        || !decoded.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
        throw new Error("PACKAGE_INSTALLER_BYTES_INVALID");
      matchedInstaller = true;
    }
    at = next;
  }
  localIntervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < localIntervals.length; i++) {
    if (localIntervals[i].start < localIntervals[i - 1].end) throw new Error("PACKAGE_ZIP_LOCAL_OVERLAP");
  }
  if (!files || at !== eocd) throw new Error("PACKAGE_ZIP_INDEX_INVALID");
  if (installer && !matchedInstaller) throw new Error("PACKAGE_INSTALLER_MISSING");
  return { files, expandedBytes: expanded };
}

export function validatePackageInstaller(manifest: ClusterPackageManifest) {
  const value = manifest.installer;
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "kind,path,productCode,productVersion,scope,sha256"
    || manifest.platform !== "windows-x64" || value.kind !== "windows-msi" || value.scope !== "user"
    || typeof value.path !== "string" || value.path.length > 220 || !/^[a-zA-Z0-9_./-]+\.msi$/i.test(value.path)
    || value.path.split("/").some((p) => !p || p === "." || p === ".." || p.endsWith(".") || p.endsWith(" "))
    || typeof value.productCode !== "string" || !/^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(value.productCode)
    || typeof value.productVersion !== "string" || !/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(value.productVersion)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256))
    throw new Error("PACKAGE_INSTALLER_MANIFEST_INVALID");
  return value;
}
export function packageSigningInput(manifest: ClusterPackageManifest) {
  return Buffer.from(PACKAGE_SIGNING_CONTEXT + JSON.stringify(manifest), "utf8");
}
export function validateSignedPackage(input: { manifest: ClusterPackageManifest; artifactBase64: string; signatureBase64: string; publicKeyPem: string }) {
  const { manifest, artifactBase64, signatureBase64, publicKeyPem } = input;
  if (manifest?.schema !== 1 || !/^[a-z][a-z0-9-]{2,79}$/.test(manifest.packageKey)
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)
    || !["windows-x64", "linux-x64", "macos-arm64"].includes(manifest.platform)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}\.zip$/.test(manifest.filename)
    || manifest.filename.includes("..") || !/^[a-f0-9]{64}$/.test(manifest.artifactSha256)
    || !Number.isSafeInteger(manifest.artifactSize) || manifest.artifactSize < 1 || manifest.artifactSize > packageArtifactLimit(manifest))
    throw new Error("PACKAGE_MANIFEST_INVALID");
  if (Object.keys(manifest).some((key) => !["schema", "packageKey", "version", "platform", "artifactSha256", "artifactSize", "filename", "dependencies", "installer"].includes(key)))
    throw new Error("PACKAGE_MANIFEST_INVALID");
  validatePackageDependencies(manifest);
  const installer = validatePackageInstaller(manifest);
  // Repeated 4-byte regex groups can overflow V8's regexp stack on real MSI
  // envelopes. Bound first, then use a linear alphabet/padding check and a
  // canonical re-encode (also rejects hidden non-zero trailing pad bits).
  if (typeof artifactBase64 !== "string" || artifactBase64.length !== Math.ceil(manifest.artifactSize / 3) * 4
    || artifactBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(artifactBase64))
    throw new Error("PACKAGE_ARTIFACT_ENCODING_INVALID");
  const bytes = Buffer.from(artifactBase64, "base64");
  if (bytes.length !== manifest.artifactSize || bytes.toString("base64") !== artifactBase64 || sha(bytes) !== manifest.artifactSha256) throw new Error("PACKAGE_ARTIFACT_INTEGRITY_FAILED");
  inspectManagedPackageZip(bytes, installer || undefined);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64)) throw new Error("PACKAGE_SIGNATURE_INVALID");
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, packageSigningInput(manifest), key, Buffer.from(signatureBase64, "base64")))
    throw new Error("PACKAGE_SIGNATURE_INVALID");
  return { bytes, manifestJson: JSON.stringify(manifest), manifestSha256: sha(packageSigningInput(manifest)), keyFingerprint: packageKeyFingerprint(publicKeyPem) };
}
export function eligibleForPackageRollout(packageId: string, deviceId: string, percentage: number) {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("INVALID_ROLLOUT_PERCENTAGE");
  if (percentage === 100) return true;
  if (percentage === 0) return false;
  const bucket = createHash("sha256").update(JSON.stringify([packageId, deviceId])).digest().readUInt32BE(0) % 10000;
  return bucket < percentage * 100;
}
export function selectPackageTarget(input: { packageId: string; deviceId: string; platform: string; policy?: { state: string; percentage: number; releaseId: string } | null; pinned?: { id: string; platform: string } | null; release?: { id: string; platform: string; revokedAt?: Date | null } | null }) {
  const target = input.pinned || (input.policy?.state === "active" && eligibleForPackageRollout(input.packageId, input.deviceId, input.policy.percentage) ? input.release : null);
  if (!target || target.platform !== input.platform || ("revokedAt" in target && target.revokedAt)) return null;
  return target.id;
}
