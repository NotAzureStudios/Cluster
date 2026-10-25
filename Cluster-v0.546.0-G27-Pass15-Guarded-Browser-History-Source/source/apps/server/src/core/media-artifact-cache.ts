import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createClusterDataLayout, ensureClusterDataLayout, projectStorageDirectory, storageOverridesFromSettings } from "./data-layout.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { mediaLimits, mediaResourceBudgets } from "./media-resource-budgets.js";
import { recordEfficiencyMetric } from "./efficiency-metrics.js";

type PrismaLike = any;

export const MEDIA_DERIVATIVE_RECIPE_VERSION = "31j.1";

type MediaHashCacheEntry = { size: number; mtimeMs: number; checksum: string; touchedAt: number };
const MEDIA_HASH_CACHE_MAX_ENTRIES = 1024;
const mediaHashCache = new Map<string, MediaHashCacheEntry>();

function rememberMediaHash(key: string, entry: MediaHashCacheEntry) {
  mediaHashCache.delete(key);
  mediaHashCache.set(key, entry);
  while (mediaHashCache.size > MEDIA_HASH_CACHE_MAX_ENTRIES) {
    const oldest = mediaHashCache.keys().next().value as string | undefined;
    if (!oldest) break;
    mediaHashCache.delete(oldest);
  }
}

let cachedMediaLayout: { cwd: string; layout: ReturnType<typeof createClusterDataLayout> } | null = null;

export function mediaDataLayout(cwd = process.cwd()) {
  const normalizedCwd = path.resolve(cwd);
  if (cachedMediaLayout?.cwd === normalizedCwd) return cachedMediaLayout.layout;
  const runtime = loadRuntimeConfig({ cwd: normalizedCwd });
  const settings = runtime.bootSettings || {};
  const root = path.resolve(process.env.CLUSTER_DATA_DIR || settings.dataRootOverride || path.join(runtime.bootWorkspaceRoot, "data"));
  const layout = createClusterDataLayout(root, {
    configFile: runtime.bootConfigFilePath,
    storageOverrides: storageOverridesFromSettings(settings),
  });
  cachedMediaLayout = { cwd: normalizedCwd, layout };
  return layout;
}

export function mediaStorageIdentity(cwd = process.cwd()) {
  const topology = ["local", "shared", "remote"].includes(String(process.env.CLUSTER_MEDIA_STORAGE_TOPOLOGY || "local").toLowerCase()) ? String(process.env.CLUSTER_MEDIA_STORAGE_TOPOLOGY || "local").toLowerCase() : "local";
  const root = mediaDataLayout(cwd).root;
  const stableId = String(process.env.CLUSTER_MEDIA_STORAGE_ID || "").trim();
  const fingerprint = crypto.createHash("sha256").update(stableId || path.resolve(root)).digest("hex").slice(0, 16);
  return { topology, fingerprint };
}

export async function hashMediaFile(filePath: string) {
  const resolved = path.resolve(filePath);
  const info = await fs.stat(resolved);
  const cached = mediaHashCache.get(resolved);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
    rememberMediaHash(resolved, { ...cached, touchedAt: Date.now() });
    return cached.checksum;
  }
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resolved);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const checksum = hash.digest("hex");
  rememberMediaHash(resolved, { size: info.size, mtimeMs: info.mtimeMs, checksum, touchedAt: Date.now() });
  return checksum;
}

function stableRecipeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableRecipeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableRecipeValue(nested)]));
  }
  return value;
}

export function mediaDerivativeRecipeKey(input: {
  kind: string;
  variantKey?: string;
  medium: string;
  toolVersions?: Record<string, string | null>;
  options?: Record<string, unknown>;
}) {
  const payload = JSON.stringify(stableRecipeValue({
    recipeVersion: MEDIA_DERIVATIVE_RECIPE_VERSION,
    kind: input.kind,
    variantKey: input.variantKey || "default",
    medium: input.medium,
    toolVersions: input.toolVersions || {},
    options: input.options || {},
  }));
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function mediaArtifactRoot(prisma: PrismaLike, projectId: string, layout = mediaDataLayout()) {
  const directory = await projectStorageDirectory(prisma, layout, projectId);
  const root = path.join(directory, "Media", ".cluster-viewer-cache");
  await fs.mkdir(root, { recursive: true, mode: 0o750 });
  return root;
}

export async function mediaArtifactFilePath(prisma: PrismaLike, asset: { id: string; projectId: string }, kind: string, variantKey = "default", extension = "bin") {
  const root = await mediaArtifactRoot(prisma, asset.projectId);
  const safeKind = String(kind || "artifact").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "artifact";
  const safeVariant = String(variantKey || "default").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "default";
  const safeExtension = String(extension || "bin").replace(/[^a-z0-9]+/gi, "").slice(0, 12) || "bin";
  return path.join(root, `${asset.id}-${safeKind}-${safeVariant}.${safeExtension}`);
}

export async function upsertArtifact(prisma: PrismaLike, input: {
  reviewAssetId: string;
  kind: string;
  variantKey?: string;
  fileName: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
  metadataPolicy?: string;
  sourceChecksumSha256?: string | null;
  recipeKey?: string;
  generatedByJobId?: string | null;
  toolchain?: Record<string, unknown>;
  checksumSha256?: string | null;
}) {
  const stat = await fs.stat(input.fileName);
  const limits = mediaResourceBudgets();
  if (stat.size > limits.maxArtifactBytes) throw new Error("MEDIA_ARTIFACT_TOO_LARGE: generated artifact exceeds the configured artifact budget.");
  const checksumSha256 = input.checksumSha256 || await hashMediaFile(input.fileName);
  const variantKey = input.variantKey || "default";
  const data = {
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: stat.size,
    checksumSha256,
    sourceChecksumSha256: input.sourceChecksumSha256 || null,
    recipeKey: input.recipeKey || "unversioned",
    generatedByJobId: input.generatedByJobId || null,
    toolchain: JSON.stringify(input.toolchain || {}),
    metadataPolicy: input.metadataPolicy || "preserve",
    metadata: JSON.stringify(input.metadata || {}),
    derivativeGeneratedAt: new Date(),
  };
  return prisma.assetArtifact.upsert({
    where: { reviewAssetId_kind_variantKey: { reviewAssetId: input.reviewAssetId, kind: input.kind, variantKey } },
    update: data,
    create: { reviewAssetId: input.reviewAssetId, kind: input.kind, variantKey, ...data },
  });
}

export async function reusableArtifact(prisma: PrismaLike, input: {
  reviewAssetId: string;
  sourceChecksumSha256: string;
  kind: string;
  variantKey?: string;
  recipeKey: string;
  outputPath: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
  metadataPolicy?: string;
  generatedByJobId?: string | null;
  toolchain?: Record<string, unknown>;
}) {
  const variantKey = input.variantKey || "default";
  const candidates = await prisma.assetArtifact.findMany({
    where: { kind: input.kind, variantKey, sourceChecksumSha256: input.sourceChecksumSha256, recipeKey: input.recipeKey },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, checksumSha256: true, metadataPolicy: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  }).catch(() => []);

  for (const candidate of candidates) {
    const info = await fs.stat(candidate.fileName).catch(() => null);
    if (!info?.isFile() || info.size !== Number(candidate.sizeBytes || 0)) continue;
    const actual = await hashMediaFile(candidate.fileName).catch(() => null);
    if (!actual || actual !== candidate.checksumSha256) continue;

    if (path.resolve(candidate.fileName) !== path.resolve(input.outputPath)) {
      await fs.mkdir(path.dirname(input.outputPath), { recursive: true, mode: 0o750 });
      await fs.rm(input.outputPath, { force: true }).catch(() => undefined);
      try { await fs.link(candidate.fileName, input.outputPath); }
      catch { await fs.copyFile(candidate.fileName, input.outputPath); }
    }

    const reused = await upsertArtifact(prisma, {
      reviewAssetId: input.reviewAssetId,
      kind: input.kind,
      variantKey,
      fileName: input.outputPath,
      mimeType: input.mimeType || candidate.mimeType,
      metadataPolicy: input.metadataPolicy || candidate.metadataPolicy || "preserve",
      metadata: {
        ...(input.metadata || {}),
        derivativeReuse: { reusedFromArtifactId: candidate.id, recipeKey: input.recipeKey, reusedAt: new Date().toISOString() },
      },
      sourceChecksumSha256: input.sourceChecksumSha256,
      recipeKey: input.recipeKey,
      generatedByJobId: input.generatedByJobId || null,
      toolchain: input.toolchain || {},
      checksumSha256: candidate.checksumSha256,
    });
    void recordEfficiencyMetric(prisma, "derivative_reuse", Number(candidate.sizeBytes || 0), 1).catch(() => undefined);
    return reused;
  }
  return null;
}

export async function pruneProjectCache(prisma: PrismaLike, projectId: string, requiredBytes = 0) {
  const limit = mediaLimits().cacheBytes;
  const tracked = await prisma.assetArtifact.aggregate({
    where: { reviewAsset: { projectId } },
    _sum: { sizeBytes: true },
  }).catch(() => ({ _sum: { sizeBytes: 0 } }));
  let used = Number(tracked?._sum?.sizeBytes || 0);
  if (used + requiredBytes <= limit) return { usedBytes: used, limitBytes: limit, removed: 0, accounting: "tracked" };
  const artifacts = await prisma.assetArtifact.findMany({
    where: { reviewAsset: { projectId } },
    select: { id: true, fileName: true, sizeBytes: true },
    orderBy: { updatedAt: "asc" },
    take: 5000,
  });
  let removed = 0;
  const target = Math.max(0, Math.floor(limit * 0.8) - requiredBytes);
  for (const artifact of artifacts) {
    if (used <= target) break;
    await fs.rm(artifact.fileName, { force: true }).catch(() => undefined);
    await prisma.assetArtifact.delete({ where: { id: artifact.id } }).catch(() => undefined);
    used = Math.max(0, used - Math.max(0, Number(artifact.sizeBytes || 0)));
    mediaHashCache.delete(path.resolve(artifact.fileName));
    removed += 1;
  }
  if (used + requiredBytes > limit) throw new Error("MEDIA_CACHE_QUOTA_EXCEEDED: generated preview cache has reached its configured quota.");
  return { usedBytes: used, limitBytes: limit, removed, accounting: "tracked" };
}

export async function mediaStorageDiagnostics(prisma: PrismaLike) {
  const layout = mediaDataLayout();
  await ensureClusterDataLayout(layout);
  const [assetBytes, artifactBytes, workers, reusableArtifacts] = await Promise.all([
    prisma.reviewAsset.aggregate({ _sum: { sizeBytes: true } }).then((row: any) => Number(row?._sum?.sizeBytes || 0)).catch(() => 0),
    prisma.assetArtifact.aggregate({ _sum: { sizeBytes: true } }).then((row: any) => Number(row?._sum?.sizeBytes || 0)).catch(() => 0),
    prisma.mediaWorkerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 64 }).catch(() => []),
    prisma.assetArtifact.count({ where: { recipeKey: { not: "unversioned" }, sourceChecksumSha256: { not: null } } }).catch(() => 0),
  ]);
  const local = mediaStorageIdentity();
  const mismatchedWorkers = workers.filter((worker: any) => worker.storageTopology === "remote" || (worker.storageFingerprint && worker.storageFingerprint !== local.fingerprint)).map((worker: any) => worker.id);
  return {
    topology: local.topology,
    fingerprint: local.fingerprint,
    assetBytes,
    artifactBytes,
    usedBytes: assetBytes + artifactBytes,
    reusableArtifacts,
    recipeVersion: MEDIA_DERIVATIVE_RECIPE_VERSION,
    projectLimitBytes: mediaLimits().projectBytes,
    cacheLimitBytes: mediaLimits().cacheBytes,
    resourceBudgets: mediaResourceBudgets(),
    mismatchedWorkers,
  };
}

export async function cleanupExpiredAssetArtifacts(prisma: PrismaLike, maximum = 500) {
  const policies = await prisma.mediaProcessingPolicy.findMany({ where: { enabled: true, retentionDays: { not: null } }, orderBy: { updatedAt: "asc" }, take: 200 }).catch(() => []);
  let removed = 0;
  let bytes = 0;
  for (const policy of policies) {
    if (removed >= maximum) break;
    const days = Math.max(1, Math.min(3650, Number(policy.retentionDays || 0)));
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const artifacts = await prisma.assetArtifact.findMany({ where: { updatedAt: { lt: cutoff }, reviewAsset: { assetKind: policy.assetRole, medium: policy.medium, project: { projectType: policy.projectType } } }, select: { id: true, fileName: true, sizeBytes: true }, orderBy: { updatedAt: "asc" }, take: Math.min(100, maximum - removed) }).catch(() => []);
    for (const artifact of artifacts) {
      bytes += Math.max(0, Number(artifact.sizeBytes || 0));
      await fs.rm(artifact.fileName, { force: true }).catch(() => undefined);
      mediaHashCache.delete(path.resolve(artifact.fileName));
      await prisma.assetArtifact.delete({ where: { id: artifact.id } }).catch(() => undefined);
      removed += 1;
    }
  }
  return { removed, bytes, policies: policies.length };
}

export async function cleanupProjectMediaCache(prisma: PrismaLike, projectId: string, options: { olderThan?: Date | null; all?: boolean } = {}) {
  const artifacts = await prisma.assetArtifact.findMany({ where: { reviewAsset: { projectId }, ...(options.all ? {} : options.olderThan ? { updatedAt: { lt: options.olderThan } } : {}) }, select: { id: true, fileName: true, sizeBytes: true }, take: 10_000 });
  let bytes = 0;
  for (const artifact of artifacts) {
    bytes += Math.max(0, Number(artifact.sizeBytes || 0));
    await fs.rm(artifact.fileName, { force: true }).catch(() => undefined);
    mediaHashCache.delete(path.resolve(artifact.fileName));
  }
  if (artifacts.length) await prisma.assetArtifact.deleteMany({ where: { id: { in: artifacts.map((artifact: any) => artifact.id) } } });
  return { removed: artifacts.length, bytes };
}
