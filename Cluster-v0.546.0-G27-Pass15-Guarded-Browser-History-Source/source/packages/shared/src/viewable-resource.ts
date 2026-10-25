import type { MetadataExportPolicy, ReviewMedium, SensitiveMetadataCategory } from "./review-domain.js";

export const VIEWABLE_RESOURCE_PROVIDERS = ["review_asset", "project_file", "library_item", "mounted_handle"] as const;
export type ViewableResourceProvider = typeof VIEWABLE_RESOURCE_PROVIDERS[number];

export const VIEWABLE_RESOURCE_SUPPORT = ["native", "derivative", "degraded", "unsupported"] as const;
export type ViewableResourceSupport = typeof VIEWABLE_RESOURCE_SUPPORT[number];

export const VIEWABLE_FORMAT_POLICY = {
  video: {
    nativeMimeTypes: ["video/mp4", "video/webm"],
    derivativeMimeTypes: ["video/quicktime", "video/x-matroska", "video/x-msvideo", "video/x-m4v"],
    extensions: ["mp4", "webm", "mov", "mkv", "avi", "m4v"],
  },
  audio: {
    nativeMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/webm"],
    degradedMimeTypes: ["audio/flac", "application/ogg"],
    extensions: ["mp3", "m4a", "aac", "ogg", "oga", "wav", "webm", "flac"],
  },
  image: {
    nativeMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"],
    derivativeMimeTypes: ["image/svg+xml", "image/tiff", "image/heic", "image/heif"],
    derivativeExtensions: ["tif", "tiff", "exr", "dpx", "hdr", "heic", "heif", "svg"],
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "tif", "tiff", "exr", "dpx", "hdr", "heic", "heif", "svg"],
  },
  pdf: {
    nativeMimeTypes: ["application/pdf"],
    extensions: ["pdf"],
  },
  "3d": {
    nativeMimeTypes: ["model/gltf-binary", "model/gltf+json"],
    nativeExtensions: ["glb", "gltf"],
    derivativeExtensions: ["fbx", "obj", "dae", "stl", "ply", "blend", "3ds"],
    extensions: ["glb", "gltf", "fbx", "obj", "dae", "stl", "ply", "blend", "3ds"],
  },
} as const;

function resourceExtension(originalName: string) {
  const base = String(originalName || "").split(/[\/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
}

function includesString(values: readonly string[] | undefined, value: string) {
  return Boolean(values?.includes(value));
}

export function inferReviewMediumFromResource(mimeType: string, originalName: string): ReviewMedium | null {
  const mime = String(mimeType || "").trim().toLowerCase().split(";", 1)[0];
  const extension = resourceExtension(originalName);
  if (mime.startsWith("video/") || includesString(VIEWABLE_FORMAT_POLICY.video.extensions, extension)) return "video";
  if (mime.startsWith("audio/") || mime === "application/ogg" || includesString(VIEWABLE_FORMAT_POLICY.audio.extensions, extension)) return "audio";
  if (mime.startsWith("image/") || includesString(VIEWABLE_FORMAT_POLICY.image.extensions, extension)) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("model/") || includesString(VIEWABLE_FORMAT_POLICY["3d"].extensions, extension)) return "3d";
  return null;
}

export function resolveViewableFormatSupport(medium: ReviewMedium, mimeType: string, originalName: string): { support: ViewableResourceSupport; reason?: string } {
  const mime = String(mimeType || "").trim().toLowerCase().split(";", 1)[0];
  const extension = resourceExtension(originalName);
  const policy = VIEWABLE_FORMAT_POLICY[medium];
  if (medium === "video") {
    if (includesString(policy.nativeMimeTypes, mime)) return { support: "native" };
    if (includesString(VIEWABLE_FORMAT_POLICY.video.derivativeMimeTypes, mime) || includesString(["mov", "mkv", "avi", "m4v"], extension)) return { support: "derivative", reason: "A browser-compatible review/proxy encode is required." };
  }
  if (medium === "audio") {
    if (includesString(VIEWABLE_FORMAT_POLICY.audio.nativeMimeTypes, mime)) return { support: "native" };
    if (includesString(VIEWABLE_FORMAT_POLICY.audio.degradedMimeTypes, mime) || extension === "flac") return { support: "degraded", reason: "Playback support depends on the runtime codec set." };
  }
  if (medium === "image") {
    if (includesString(VIEWABLE_FORMAT_POLICY.image.nativeMimeTypes, mime)) return { support: "native" };
    if (includesString(VIEWABLE_FORMAT_POLICY.image.derivativeMimeTypes, mime) || includesString(VIEWABLE_FORMAT_POLICY.image.derivativeExtensions, extension)) {
      return { support: "derivative", reason: mime === "image/svg+xml" || extension === "svg" ? "SVG is untrusted active content and must be rasterized before viewing." : "A bounded display derivative is required for this production image format." };
    }
  }
  if (medium === "pdf") return mime === "application/pdf" || extension === "pdf" ? { support: "native" } : { support: "unsupported", reason: "The document adapter accepts PDF resources only." };
  if (medium === "3d") {
    if (includesString(VIEWABLE_FORMAT_POLICY["3d"].nativeMimeTypes, mime) || includesString(VIEWABLE_FORMAT_POLICY["3d"].nativeExtensions, extension)) return { support: "native" };
    if (includesString(VIEWABLE_FORMAT_POLICY["3d"].derivativeExtensions, extension)) return { support: "derivative", reason: "An optimized GLB/glTF derivative is required." };
  }
  return { support: "unsupported", reason: "No safe viewer path is registered for this format." };
}

export type ViewableResourceLocator =
  | { provider: "review_asset"; assetId: string }
  | { provider: "project_file"; fileId: string }
  | { provider: "library_item"; itemId: string }
  | { provider: "mounted_handle"; handleId: string; revision?: string | null };

export type ViewableResourceSource = {
  id: string;
  provider: ViewableResourceProvider;
  medium: ReviewMedium;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string | null;
  versionId?: string | null;
  projectId?: string | null;
  sourceUrl?: string | null;
  locator: ViewableResourceLocator;
  support: ViewableResourceSupport;
  degradationReason?: string | null;
};

export type ViewableResourceDerivative = {
  id: string;
  kind: AssetArtifactKind | string;
  variantKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  generatedAt: string;
  metadataPolicy: MetadataExportPolicy;
  sourceChecksumSha256?: string | null;
  metadata?: Record<string, unknown>;
  url?: string | null;
};

export type ViewableResourceCompanion = {
  id: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  url: string;
};

export type ViewableResource = {
  source: ViewableResourceSource;
  derivatives: ViewableResourceDerivative[];
  companions?: ViewableResourceCompanion[];
  preferredDerivativeId?: string | null;
};

export const ASSET_ARTIFACT_KINDS = [
  "thumbnail",
  "waveform",
  "waveform_preview",
  "audio_stem",
  "storyboard",
  "captions_vtt",
  "proxy",
  "review_encode",
  "image_preview",
  "pdf_page_thumbnail",
  "pdf_text_index",
  "model_optimized",
  "model_preview",
  "sanitized_export",
] as const;
export type AssetArtifactKind = typeof ASSET_ARTIFACT_KINDS[number];

export const ASSET_PROCESSING_CAPABILITIES = [
  "probe.av",
  "derive.thumbnail.av",
  "derive.waveform",
  "derive.storyboard",
  "derive.captions",
  "encode.h264",
  "process.image",
  "parse.pdf",
  "render.pdf",
  "probe.model",
  "convert.model",
  "render.model",
  "metadata.strip.av",
  "metadata.strip.image",
  "metadata.strip.pdf",
] as const;
export type AssetProcessingCapability = typeof ASSET_PROCESSING_CAPABILITIES[number];

export const ASSET_PROCESSING_JOBS = [
  "metadata",
  "thumbnail",
  "waveform",
  "storyboard",
  "captions",
  "proxy",
  "review_encode",
  "image_preview",
  "pdf_index",
  "pdf_thumbnails",
  "model_optimize",
  "model_preview",
  "sanitized_export",
] as const;
export type AssetProcessingJob = typeof ASSET_PROCESSING_JOBS[number];

export const ASSET_PROCESSING_JOB_REQUIREMENTS_BY_MEDIUM: Record<ReviewMedium, Partial<Record<AssetProcessingJob, readonly AssetProcessingCapability[]>>> = {
  video: {
    metadata: ["probe.av"], thumbnail: ["probe.av", "derive.thumbnail.av"], waveform: ["probe.av", "derive.waveform"], storyboard: ["probe.av", "derive.storyboard"], captions: ["probe.av", "derive.captions"],
    proxy: ["probe.av", "encode.h264"], review_encode: ["probe.av", "encode.h264"], sanitized_export: ["metadata.strip.av"],
  },
  audio: {
    metadata: ["probe.av"], waveform: ["probe.av", "derive.waveform"], sanitized_export: ["metadata.strip.av"],
  },
  image: {
    metadata: ["process.image"], image_preview: ["process.image"], sanitized_export: ["metadata.strip.image"],
  },
  pdf: {
    metadata: ["parse.pdf"], pdf_index: ["parse.pdf"], pdf_thumbnails: ["render.pdf"], sanitized_export: ["metadata.strip.pdf"],
  },
  "3d": {
    metadata: ["probe.model"], model_optimize: ["convert.model"], model_preview: ["render.model"],
  },
};

export function assetProcessingJobRequirements(medium: ReviewMedium, job: AssetProcessingJob): readonly AssetProcessingCapability[] {
  return ASSET_PROCESSING_JOB_REQUIREMENTS_BY_MEDIUM[medium]?.[job] || [];
}

export function assetProcessingJobSupportedForMedium(medium: ReviewMedium, job: AssetProcessingJob): boolean {
  return Object.prototype.hasOwnProperty.call(ASSET_PROCESSING_JOB_REQUIREMENTS_BY_MEDIUM[medium] || {}, job);
}


export type MetadataFieldProvenance = {
  source: "cluster" | "filesystem" | "embedded" | "probe" | "derived" | "user";
  capturedAt?: string | null;
  tool?: string | null;
  confidence?: "authoritative" | "reported" | "derived" | "unknown";
};

export type AssetMetadataEnvelope = {
  identity?: Record<string, unknown>;
  production?: Record<string, unknown>;
  review?: Record<string, unknown>;
  derived?: Record<string, unknown>;
  provenance?: Record<string, MetadataFieldProvenance>;
};

export type SensitiveMetadataEnvelope = Partial<Record<SensitiveMetadataCategory, Record<string, unknown>>>;


export type EmbeddedAudioTrackMetadata = {
  id: string;
  index: number;
  label?: string | null;
  language?: string | null;
  codec?: string | null;
  profile?: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  sampleRateHz?: number | null;
  bitRate?: number | null;
  sampleFormat?: string | null;
  default?: boolean;
  commentary?: boolean;
};

export const AUDIO_STEM_ROLES = ["mix", "dialogue", "music", "sfx", "vo", "production", "custom"] as const;
export type AudioStemRole = typeof AUDIO_STEM_ROLES[number];

export type ProductionAudioStemMetadata = {
  id: string;
  label: string;
  role: AudioStemRole;
  derivativeId?: string | null;
  variantKey?: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  defaultGainDb?: number | null;
};

export const AUDIO_MONITORING_PRESETS = ["full_mix", "dialogue_focus", "music_effects", "mono_check", "custom"] as const;
export type AudioMonitoringPreset = typeof AUDIO_MONITORING_PRESETS[number];
export const AUDIO_OUTPUT_MODES = ["stereo", "mono", "left", "right"] as const;
export type AudioOutputMode = typeof AUDIO_OUTPUT_MODES[number];

export type WaveformChannel = {
  id: string;
  label?: string | null;
  samples: number[];
  peak?: number | null;
  rms?: number | null;
};

export type WaveformData = {
  version: 1;
  durationSeconds: number;
  sampleRateHz: number;
  binsPerSecond: number;
  channels: WaveformChannel[];
};

export type StoryboardFrame = {
  index: number;
  timeSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StoryboardManifest = {
  version: 1;
  durationSeconds: number;
  imageMimeType: string;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  padding?: number;
  margin?: number;
  sheetWidth?: number;
  sheetHeight?: number;
  frames: StoryboardFrame[];
};

export type MetadataExportSelection = {
  policy: MetadataExportPolicy;
  preserveTechnicalRenderingMetadata?: boolean;
  includeCategories?: string[];
  excludeSensitiveCategories?: SensitiveMetadataCategory[];
};

export const DEFAULT_RESOURCE_BUDGETS = {
  probeTimeoutMs: 60_000,
  maxProbeOutputBytes: 2 * 1024 * 1024,
  maxImagePixels: 160_000_000,
  maxImageSourceBytes: 512 * 1024 * 1024,
  maxPdfSourceBytes: 512 * 1024 * 1024,
  maxPdfPages: 20_000,
  maxPdfCachedPages: 96,
  maxPdfTextCharacters: 5_000_000,
  maxModelSourceBytes: 512 * 1024 * 1024,
  maxModelJsonBytes: 32 * 1024 * 1024,
  maxModelTriangles: 25_000_000,
  maxTexturePixels: 268_435_456,
  maxWaveformBins: 60_000,
  maxStoryboardFrames: 120,
  maxArtifactBytes: 4 * 1024 * 1024 * 1024,
} as const;
export type ResourceBudgets = typeof DEFAULT_RESOURCE_BUDGETS;
