import { inferReviewMediumFromResource, resolveViewableFormatSupport, type ReviewMedium, type ViewableResource, type ViewableResourceCompanion, type ViewableResourceDerivative } from "@cluster/shared";
import { libraryDerivativeIsDeliverable } from "../library/library-derivative-version.js";

export const inferReviewMedium = inferReviewMediumFromResource;
export const formatSupportForResource = resolveViewableFormatSupport;

export function validateReviewMediumMatchesFile(medium: ReviewMedium, mimeType: string, originalName: string) {
  return inferReviewMediumFromResource(mimeType, originalName) === medium;
}

function libraryModelCompanions(item: any): ViewableResourceCompanion[] {
  const raw = item?.metadata;
  let metadata: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) metadata = raw as Record<string, unknown>;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
    } catch { /* malformed legacy metadata is ignored at this boundary */ }
  }
  const bundleRaw = metadata.modelBundle;
  let bundle: unknown[] = [];
  if (Array.isArray(bundleRaw)) bundle = bundleRaw;
  else if (typeof bundleRaw === "string" && bundleRaw.trim()) {
    try { const parsed = JSON.parse(bundleRaw); if (Array.isArray(parsed)) bundle = parsed; } catch { /* ignore malformed bundle */ }
  }
  return bundle.slice(0, 128).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const name = typeof value.name === "string" ? value.name.trim().slice(0, 500) : "";
    if (!id || !name) return [];
    return [{
      id,
      name,
      mimeType: typeof value.mimeType === "string" ? value.mimeType.trim().slice(0, 200) : null,
      sizeBytes: Number.isFinite(Number(value.sizeBytes)) ? Number(value.sizeBytes) : null,
      url: `/api/library/${encodeURIComponent(id)}/file`,
    } satisfies ViewableResourceCompanion];
  });
}

function artifactMetadata(value: unknown) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function artifactToDerivative(artifact: any): ViewableResourceDerivative {
  return {
    id: artifact.id,
    kind: artifact.kind,
    variantKey: artifact.variantKey || "default",
    mimeType: artifact.mimeType,
    sizeBytes: Number(artifact.sizeBytes || 0),
    checksumSha256: artifact.checksumSha256,
    generatedAt: new Date(artifact.derivativeGeneratedAt || artifact.createdAt).toISOString(),
    metadataPolicy: artifact.metadataPolicy || "preserve",
    sourceChecksumSha256: artifact.sourceChecksumSha256 || null,
    metadata: artifactMetadata(artifact.metadata),
    url: `/api/review-assets/${artifact.reviewAssetId}/processing-artifacts/${encodeURIComponent(artifact.kind)}?variant=${encodeURIComponent(artifact.variantKey || "default")}`,
  };
}

export function reviewAssetViewableResource(asset: any, artifacts: any[] = []): ViewableResource {
  const support = formatSupportForResource(asset.medium as ReviewMedium, asset.mimeType, asset.originalName);
  const derivatives = artifacts.map(artifactToDerivative);
  const preferred = derivatives.find((item) => ["review_encode", "proxy", "image_preview", "model_optimized"].includes(String(item.kind)));
  return {
    source: {
      id: asset.id,
      provider: "review_asset",
      medium: asset.medium,
      title: asset.title,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes || 0),
      checksumSha256: asset.checksumSha256 || null,
      versionId: asset.id,
      projectId: asset.projectId,
      sourceUrl: `/api/review-assets/${asset.id}/file`,
      locator: { provider: "review_asset", assetId: asset.id },
      support: support.support,
      degradationReason: support.reason || null,
    },
    derivatives,
    preferredDerivativeId: preferred?.id || null,
  };
}

export function projectFileViewableResource(file: any): ViewableResource | null {
  const medium = inferReviewMedium(file.mimeType, file.originalName);
  if (!medium) return null;
  const support = formatSupportForResource(medium, file.mimeType, file.originalName);
  return {
    source: {
      id: file.id,
      provider: "project_file",
      medium,
      title: file.title,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes || 0),
      checksumSha256: file.checksumSha256 || null,
      versionId: file.id,
      projectId: file.projectId,
      sourceUrl: `/api/project-files/${file.id}/file?inline=true`,
      locator: { provider: "project_file", fileId: file.id },
      support: support.support,
      degradationReason: support.reason || null,
    },
    derivatives: [],
    preferredDerivativeId: null,
  };
}


function libraryDerivativeToViewable(itemId: string, derivative: any): ViewableResourceDerivative {
  return {
    id: derivative.id,
    kind: derivative.kind,
    variantKey: derivative.variantKey || "default",
    mimeType: derivative.mimeType || "application/octet-stream",
    sizeBytes: Number(derivative.sizeBytes || 0),
    checksumSha256: derivative.contentChecksumSha256 || derivative.sourceChecksumSha256 || "",
    generatedAt: new Date(derivative.builtAt || derivative.updatedAt || derivative.createdAt || Date.now()).toISOString(),
    metadataPolicy: "preserve",
    sourceChecksumSha256: derivative.sourceChecksumSha256 || null,
    metadata: artifactMetadata(derivative.metadata),
    url: `/api/library/${encodeURIComponent(itemId)}/derivatives/${encodeURIComponent(derivative.id)}/file`,
  };
}

function preferredLibraryDerivative(medium: ReviewMedium, derivatives: ViewableResourceDerivative[]) {
  const order = medium === "video" ? ["review_encode", "proxy"]
    : medium === "image" ? ["image_preview", "thumbnail"]
    : medium === "3d" ? ["model_optimized", "model_preview"]
    : medium === "audio" ? ["review_encode", "proxy"]
    : [];
  for (const kind of order) {
    const match = derivatives.find((entry) => String(entry.kind) === kind);
    if (match) return match;
  }
  return null;
}

export function libraryItemViewableResource(item: any, derivativeRows: any[] = []): ViewableResource | null {
  if (!item?.fileName) return null;
  const medium = inferReviewMedium(item.mimeType, item.originalName || item.title);
  if (!medium) return null;
  const support = formatSupportForResource(medium, item.mimeType, item.originalName || item.title);
  const derivatives = derivativeRows.filter((entry) => libraryDerivativeIsDeliverable(item, entry)).map((entry) => libraryDerivativeToViewable(item.id, entry));
  const preferred = preferredLibraryDerivative(medium, derivatives);
  return {
    source: {
      id: item.id,
      provider: "library_item",
      medium,
      title: item.title,
      originalName: item.originalName || item.title,
      mimeType: item.mimeType || "application/octet-stream",
      sizeBytes: Number(item.sizeBytes || 0),
      checksumSha256: item.checksumSha256 || null,
      projectId: item.projectId || null,
      sourceUrl: `/api/library/${item.id}/file`,
      locator: { provider: "library_item", itemId: item.id },
      support: support.support,
      degradationReason: support.reason || null,
    },
    derivatives,
    companions: medium === "3d" ? libraryModelCompanions(item) : [],
    preferredDerivativeId: preferred?.id || null,
  };
}
