import {
  DEFAULT_RESOURCE_BUDGETS,
  VIEWER_CLIENT_RESOURCE_BUDGETS,
  assessViewerColorPath,
  resolveCanonicalViewableFormatAssessment,
  type AssetMetadataEnvelope,
  type ViewerColorAssessment,
  type ViewerRuntimeColorCapabilities,
  type ViewableResource,
} from "@cluster/shared";

function matches(query: string): boolean | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try { return window.matchMedia(query).matches; } catch { return null; }
}

export function viewerRuntimeColorCapabilities(): ViewerRuntimeColorCapabilities {
  const rec2020 = matches("(color-gamut: rec2020)");
  const p3 = matches("(color-gamut: p3)");
  const srgb = matches("(color-gamut: srgb)");
  return {
    displayGamut: rec2020 ? "rec2020" : p3 ? "p3" : srgb ? "srgb" : "unknown",
    highDynamicRange: matches("(dynamic-range: high)"),
    browserManagedColor: typeof document !== "undefined" && typeof HTMLCanvasElement !== "undefined",
  };
}

export function viewerColorAssessment(metadata?: AssetMetadataEnvelope | null): ViewerColorAssessment {
  return assessViewerColorPath(metadata, viewerRuntimeColorCapabilities());
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type ViewerHardeningSnapshot = {
  format: ReturnType<typeof resolveCanonicalViewableFormatAssessment>;
  color: ViewerColorAssessment;
  advisories: string[];
  budget: {
    status: "within" | "warning" | "exceeded";
    checks: Record<string, string | number | boolean | null>;
  };
};

export function buildViewerHardeningSnapshot(input: {
  resource: ViewableResource;
  metadata?: AssetMetadataEnvelope | null;
  adapterDiagnostics?: Record<string, unknown>;
}): ViewerHardeningSnapshot {
  const { resource } = input;
  const format = resolveCanonicalViewableFormatAssessment(resource.source.medium, resource.source.mimeType, resource.source.originalName);
  const color = viewerColorAssessment(input.metadata);
  const diagnostics = input.adapterDiagnostics || {};
  const advisories = [...color.warnings];
  const checks: Record<string, string | number | boolean | null> = {
    sourceBytes: resource.source.sizeBytes,
    sourceSupport: resource.source.support,
  };
  let budgetStatus: "within" | "warning" | "exceeded" = "within";

  if (resource.source.medium === "image") {
    const production = record(input.metadata?.production);
    const probe = record(production?.probe);
    const tracks = Array.isArray(probe?.videoTracks) ? probe.videoTracks : [];
    const track = record(tracks[0]);
    const width = finite(track?.width ?? probe?.width);
    const height = finite(track?.height ?? probe?.height);
    const pixels = width != null && height != null ? width * height : null;
    checks.imagePixels = pixels;
    checks.imagePixelBudget = DEFAULT_RESOURCE_BUDGETS.maxImagePixels;
    if (pixels != null && pixels > VIEWER_CLIENT_RESOURCE_BUDGETS.maxImageInspectionPixels) {
      advisories.push("Image exceeds the interactive inspection pixel budget; pixel/color sampling is intentionally degraded.");
      budgetStatus = "warning";
    }
  }

  if (resource.source.medium === "pdf") {
    const renderPixels = finite(diagnostics.renderPixels);
    checks.pdfRenderPixels = renderPixels;
    checks.pdfCanvasPixelBudget = VIEWER_CLIENT_RESOURCE_BUDGETS.maxPdfCanvasPixels;
    if (renderPixels != null && renderPixels > VIEWER_CLIENT_RESOURCE_BUDGETS.maxPdfCanvasPixels) {
      advisories.push("PDF render resolution exceeded the interactive canvas budget and should be clamped.");
      budgetStatus = "exceeded";
    }
  }

  if (resource.source.medium === "3d") {
    const triangles = finite(diagnostics.triangles);
    const texturePixels = finite(diagnostics.texturePixels);
    const gpuEstimateBytes = finite(diagnostics.gpuEstimateBytes);
    checks.modelTriangles = triangles;
    checks.modelTriangleBudget = DEFAULT_RESOURCE_BUDGETS.maxModelTriangles;
    checks.texturePixels = texturePixels;
    checks.texturePixelBudget = DEFAULT_RESOURCE_BUDGETS.maxTexturePixels;
    checks.gpuEstimateBytes = gpuEstimateBytes;
    checks.gpuEstimateBudget = VIEWER_CLIENT_RESOURCE_BUDGETS.maxModelGpuEstimateBytes;
    if ((triangles != null && triangles > DEFAULT_RESOURCE_BUDGETS.maxModelTriangles) || (texturePixels != null && texturePixels > DEFAULT_RESOURCE_BUDGETS.maxTexturePixels)) budgetStatus = "exceeded";
    else if (gpuEstimateBytes != null && gpuEstimateBytes > VIEWER_CLIENT_RESOURCE_BUDGETS.maxModelGpuEstimateBytes) {
      advisories.push("Estimated 3D GPU footprint exceeds the interactive viewer budget; use an optimized model derivative.");
      budgetStatus = "warning";
    }
  }

  if (format.runtimeDependent) advisories.push(format.reason || "Format support depends on runtime capabilities.");
  return { format, color, advisories: [...new Set(advisories)].slice(0, VIEWER_CLIENT_RESOURCE_BUDGETS.maxRuntimeAdvisories), budget: { status: budgetStatus, checks } };
}
