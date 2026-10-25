import { DEFAULT_RESOURCE_BUDGETS } from "@cluster/shared";

const DEFAULT_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_PROJECT_MEDIA_LIMIT_BYTES = 100 * 1024 * 1024 * 1024;

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

export function mediaResourceBudgets() {
  return {
    probeTimeoutMs: boundedNumber(process.env.CLUSTER_MEDIA_PROBE_TIMEOUT_MS, DEFAULT_RESOURCE_BUDGETS.probeTimeoutMs, 5_000, 5 * 60_000),
    maxProbeOutputBytes: boundedNumber(process.env.CLUSTER_MEDIA_PROBE_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxProbeOutputBytes, 256 * 1024, 16 * 1024 * 1024),
    maxImagePixels: boundedNumber(process.env.CLUSTER_MEDIA_IMAGE_MAX_PIXELS, DEFAULT_RESOURCE_BUDGETS.maxImagePixels, 1_000_000, 1_000_000_000),
    maxImageSourceBytes: boundedNumber(process.env.CLUSTER_MEDIA_IMAGE_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxImageSourceBytes, 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxPdfSourceBytes: boundedNumber(process.env.CLUSTER_MEDIA_PDF_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxPdfSourceBytes, 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxPdfPages: boundedNumber(process.env.CLUSTER_MEDIA_PDF_MAX_PAGES, DEFAULT_RESOURCE_BUDGETS.maxPdfPages, 1, 100_000),
    maxPdfCachedPages: boundedNumber(process.env.CLUSTER_MEDIA_PDF_CACHE_PAGES, DEFAULT_RESOURCE_BUDGETS.maxPdfCachedPages, 4, 2_000),
    maxPdfTextCharacters: boundedNumber(process.env.CLUSTER_MEDIA_PDF_TEXT_MAX_CHARACTERS, DEFAULT_RESOURCE_BUDGETS.maxPdfTextCharacters, 10_000, 50_000_000),
    maxModelSourceBytes: boundedNumber(process.env.CLUSTER_MEDIA_MODEL_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxModelSourceBytes, 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxModelJsonBytes: boundedNumber(process.env.CLUSTER_MEDIA_MODEL_JSON_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxModelJsonBytes, 1024 * 1024, 256 * 1024 * 1024),
    maxModelTriangles: boundedNumber(process.env.CLUSTER_MEDIA_MODEL_MAX_TRIANGLES, DEFAULT_RESOURCE_BUDGETS.maxModelTriangles, 10_000, 250_000_000),
    maxTexturePixels: boundedNumber(process.env.CLUSTER_MEDIA_TEXTURE_MAX_PIXELS, DEFAULT_RESOURCE_BUDGETS.maxTexturePixels, 1_000_000, 2_000_000_000),
    maxWaveformBins: boundedNumber(process.env.CLUSTER_MEDIA_WAVEFORM_MAX_BINS, DEFAULT_RESOURCE_BUDGETS.maxWaveformBins, 256, 250_000),
    maxStoryboardFrames: boundedNumber(process.env.CLUSTER_MEDIA_STORYBOARD_MAX_FRAMES, DEFAULT_RESOURCE_BUDGETS.maxStoryboardFrames, 4, 240),
    maxArtifactBytes: boundedNumber(process.env.CLUSTER_MEDIA_ARTIFACT_MAX_BYTES, DEFAULT_RESOURCE_BUDGETS.maxArtifactBytes, 16 * 1024 * 1024, 16 * 1024 * 1024 * 1024),
  };
}

export function mediaLimits() {
  return {
    cacheBytes: boundedNumber(process.env.CLUSTER_MEDIA_CACHE_MAX_BYTES, DEFAULT_CACHE_LIMIT_BYTES, 64 * 1024 * 1024, 100 * 1024 * 1024 * 1024),
    projectBytes: boundedNumber(process.env.CLUSTER_MEDIA_PROJECT_MAX_BYTES, DEFAULT_PROJECT_MEDIA_LIMIT_BYTES, 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024 * 1024),
    concurrency: boundedNumber(process.env.CLUSTER_MEDIA_WORKER_CONCURRENCY, 1, 1, 4),
    resources: mediaResourceBudgets(),
  };
}


export function mediaJobCostUnits(input: { sizeBytes?: unknown; job?: unknown }) {
  const sizeBytes = Math.max(0, Number(input.sizeBytes || 0));
  const base = Math.max(1, Math.ceil(sizeBytes / (256 * 1024 * 1024)));
  const job = String(input.job || "").toLowerCase();
  const multiplier = ["proxy", "review_encode", "sanitized_export"].includes(job) ? 2 : ["storyboard", "waveform"].includes(job) ? 1.25 : 1;
  return Math.max(1, Math.min(256, Math.ceil(base * multiplier)));
}
