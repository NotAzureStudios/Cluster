import { resolveViewableFormatSupport } from "./viewable-resource.js";
import type { AssetMetadataEnvelope, ViewableResourceSupport } from "./viewable-resource.js";
import type { ReviewMedium } from "./review-domain.js";

export const VIEWER_HARDENING_CONTRACT_VERSION = 1 as const;

export type ViewerDisplayGamut = "srgb" | "p3" | "rec2020" | "unknown";
export type ViewerColorPathStatus = "unknown" | "managed" | "degraded";

export type ViewerColorSignal = {
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorRange: string | null;
  pixelFormat: string | null;
  bitDepth: number | null;
  hdr: boolean;
  wideGamut: boolean;
};

export type ViewerRuntimeColorCapabilities = {
  displayGamut: ViewerDisplayGamut;
  highDynamicRange: boolean | null;
  browserManagedColor: boolean;
};

export type ViewerColorAssessment = {
  status: ViewerColorPathStatus;
  signal: ViewerColorSignal;
  runtime: ViewerRuntimeColorCapabilities;
  authoritative: false;
  warnings: string[];
};

export const VIEWER_CLIENT_RESOURCE_BUDGETS = Object.freeze({
  maxPdfCanvasPixels: 40_000_000,
  maxPdfComparisonCanvasPixels: 24_000_000,
  maxPdfDevicePixelRatio: 2,
  maxImageInspectionPixels: 160_000_000,
  maxModelGpuEstimateBytes: 2 * 1024 * 1024 * 1024,
  maxDetachedViewerWindowsPerWorkspace: 8,
  maxRuntimeAdvisories: 8,
});

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function inferBitDepth(pixelFormat: string | null, raw: unknown) {
  const direct = number(raw);
  if (direct && direct <= 64) return direct;
  const match = pixelFormat?.match(/(?:p|yuv|gbr|gray|rgb|bgr)[a-z0-9_]*?(10|12|14|16)(?:le|be)?$/i) || pixelFormat?.match(/(10|12|14|16)(?:le|be)/i);
  return match ? Number(match[1]) : pixelFormat ? 8 : null;
}

export function extractViewerColorSignal(metadata?: AssetMetadataEnvelope | null): ViewerColorSignal {
  const production = record(metadata?.production);
  const probe = record(production?.probe);
  const tracks = Array.isArray(probe?.videoTracks) ? probe?.videoTracks : [];
  const track = record(tracks[0]);
  const image = record(production?.image);
  const source = track || image || probe || {};
  const colorSpace = text(source.colorSpace);
  const colorPrimaries = text(source.colorPrimaries);
  const colorTransfer = text(source.colorTransfer);
  const colorRange = text(source.colorRange);
  const pixelFormat = text(source.pixelFormat);
  const bitDepth = inferBitDepth(pixelFormat, source.bitDepth ?? source.bitsPerRawSample);
  const normalizedTransfer = (colorTransfer || "").toLowerCase();
  const normalizedPrimaries = (colorPrimaries || "").toLowerCase();
  const hdr = /smpte2084|pq|arib-std-b67|hlg/.test(normalizedTransfer) || /bt2020/.test(normalizedPrimaries) && Boolean(bitDepth && bitDepth > 8);
  const wideGamut = /bt2020|p3|dci/.test(normalizedPrimaries) || /bt2020/.test((colorSpace || "").toLowerCase());
  return { colorSpace, colorPrimaries, colorTransfer, colorRange, pixelFormat, bitDepth, hdr, wideGamut };
}

export function assessViewerColorPath(metadata: AssetMetadataEnvelope | null | undefined, runtime: ViewerRuntimeColorCapabilities): ViewerColorAssessment {
  const signal = extractViewerColorSignal(metadata);
  const hasSignal = Boolean(signal.colorSpace || signal.colorPrimaries || signal.colorTransfer || signal.pixelFormat || signal.bitDepth);
  const warnings: string[] = [];
  if (signal.hdr && runtime.highDynamicRange === false) warnings.push("HDR source is being viewed through a display path that does not report high dynamic range support.");
  if (signal.wideGamut && runtime.displayGamut === "srgb") warnings.push("Wide-gamut source is being viewed on a runtime that reports only an sRGB display gamut.");
  if (signal.hdr && !runtime.browserManagedColor) warnings.push("The runtime does not expose a managed HDR/color path; color should not be treated as reference-authoritative.");
  return {
    status: !hasSignal ? "unknown" : warnings.length ? "degraded" : "managed",
    signal,
    runtime,
    authoritative: false,
    warnings: warnings.slice(0, VIEWER_CLIENT_RESOURCE_BUDGETS.maxRuntimeAdvisories),
  };
}

export type ViewableFormatAssessment = {
  policyVersion: 1;
  medium: ReviewMedium;
  mimeType: string;
  extension: string;
  support: ViewableResourceSupport;
  reason?: string;
  runtimeDependent: boolean;
  derivativeKinds: string[];
};

export function resolveCanonicalViewableFormatAssessment(medium: ReviewMedium, mimeType: string, originalName: string): ViewableFormatAssessment {
  const normalizedMime = String(mimeType || "").trim().toLowerCase().split(";", 1)[0];
  const base = String(originalName || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
  const support = resolveViewableFormatSupport(medium, normalizedMime, originalName);
  const derivativeKinds = support.support !== "derivative" ? []
    : medium === "video" ? ["review_encode", "proxy"]
    : medium === "image" ? ["image_preview"]
    : medium === "3d" ? ["model_optimized"]
    : [];
  return {
    policyVersion: VIEWER_HARDENING_CONTRACT_VERSION,
    medium,
    mimeType: normalizedMime,
    extension,
    support: support.support,
    ...(support.reason ? { reason: support.reason } : {}),
    runtimeDependent: support.support === "degraded",
    derivativeKinds,
  };
}
