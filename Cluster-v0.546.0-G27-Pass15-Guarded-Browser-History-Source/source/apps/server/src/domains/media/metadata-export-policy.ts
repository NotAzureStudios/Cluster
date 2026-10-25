import type { MetadataExportSelection, SensitiveMetadataCategory } from "@cluster/shared";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const TECHNICAL_RENDERING_KEYS = new Set([
  "orientation", "rotation", "pixelAspectRatio", "colorProfile", "iccProfile", "colorSpace", "colorPrimaries",
  "colorTransfer", "colorRange", "bitDepth", "frameRate", "sampleRateHz", "channelLayout", "pageSize",
  "durationSeconds", "width", "height", "codec", "bitRate", "bitsPerRawSample", "pixelFormat", "sampleFormat",
  "channels", "formatName", "formatLongName", "pageCount", "pdfFormatVersion", "tagged", "acroFormPresent",
  "xfaPresent", "collectionPresent", "signaturesPresent", "linearized", "format", "gltfVersion", "meshCount",
  "nodeCount", "primitiveCount", "vertexCount", "triangleCount", "materialCount", "textureCount", "imageCount",
  "animationCount", "skinCount", "cameraCount", "externalResourceCount", "bounds", "overTriangleBudget",
  "optimizedRuntimeFormat", "requiresOptimizedDerivative", "index", "profile", "fieldOrder", "language", "type",
]);

function pickTechnicalFields(value: unknown): Record<string, unknown> {
  const source = objectValue(value);
  return Object.fromEntries(Object.entries(source).filter(([key]) => TECHNICAL_RENDERING_KEYS.has(key)));
}

function safeTrackList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).map((item) => pickTechnicalFields(item)).filter((item) => Object.keys(item).length > 0);
}

function safeTechnicalProduction(value: unknown) {
  const production = objectValue(value);
  const direct = pickTechnicalFields(production);
  const probe = objectValue(production.probe);
  if (Object.keys(probe).length) {
    const safeProbe = pickTechnicalFields(probe);
    for (const key of ["videoTracks", "audioTracks", "textTracks"] as const) {
      const tracks = safeTrackList(probe[key]);
      if (tracks.length) safeProbe[key] = tracks;
    }
    if (Object.keys(safeProbe).length) direct.probe = safeProbe;
  }
  for (const key of ["document", "model"] as const) {
    const picked = pickTechnicalFields(production[key]);
    if (Object.keys(picked).length) direct[key] = picked;
  }
  return direct;
}


export function applyMetadataExportPolicy(input: {
  metadata: unknown;
  sensitiveMetadata: unknown;
  selection: MetadataExportSelection;
}) {
  const metadata = objectValue(input.metadata);
  const sensitive = objectValue(input.sensitiveMetadata);
  const selection = input.selection;
  if (selection.policy === "strip_all") return { metadata: {}, sensitiveMetadata: {}, removedSensitiveCategories: Object.keys(sensitive) };

  if (selection.policy === "safe_share") {
    const safeProduction = selection.preserveTechnicalRenderingMetadata === false ? {} : safeTechnicalProduction(metadata.production);
    return {
      metadata: Object.keys(safeProduction).length ? { production: safeProduction } : {},
      sensitiveMetadata: {},
      removedSensitiveCategories: Object.keys(sensitive),
    };
  }

  if (selection.policy === "custom") {
    const include = new Set((selection.includeCategories || []).map((value) => String(value).trim()).filter(Boolean));
    const excludedSensitive = new Set<SensitiveMetadataCategory>(selection.excludeSensitiveCategories || []);
    const nextMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => include.has(key)));
    const nextSensitive = Object.fromEntries(Object.entries(sensitive).filter(([key]) => !excludedSensitive.has(key as SensitiveMetadataCategory) && (include.has(key) || include.has(`sensitive.${key}`))));
    return { metadata: nextMetadata, sensitiveMetadata: nextSensitive, removedSensitiveCategories: Object.keys(sensitive).filter((key) => !(key in nextSensitive)) };
  }

  return { metadata, sensitiveMetadata: sensitive, removedSensitiveCategories: [] };
}
