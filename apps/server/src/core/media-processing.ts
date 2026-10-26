import { ASSET_PROCESSING_JOBS, REVIEW_MEDIA, assetProcessingJobRequirements, assetProcessingJobSupportedForMedium, type AssetProcessingCapability, type AssetProcessingJob, type ReviewMedium, type WaveformData } from "@cluster/shared";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { projectStorageDirectory } from "./data-layout.js";
import { createModelGlbDerivative } from "./blender-preview.js";
import { normalizedMetadataExportSelection, sanitizedExportExtension, writeSanitizedMediaDerivative } from "./media-sanitized-export.js";
import { storyboardManifest } from "./media-storyboard.js";
import { renderVideoThumbnail, supportsCudaThumbnail } from "./media-gpu-thumbnail.js";
import { parseMediaRate as parseRate, safeMediaJsonArray as safeJsonArray } from "./media-value-utils.js";
import { mediaLimits, mediaResourceBudgets } from "./media-resource-budgets.js";
import { runMediaProcess as runProcess, type MediaCancellationCheck as CancellationCheck } from "./media-process-runtime.js";
import { extractWaveformData as extractWaveform } from "./media-waveform-runtime.js";
import { captureMediaCommand as captureCommand } from "./media-probe-runtime.js";
import {
  hashMediaFile,
  mediaArtifactFilePath,
  mediaDataLayout,
  mediaDerivativeRecipeKey,
  mediaStorageIdentity,
  pruneProjectCache,
  reusableArtifact,
  upsertArtifact,
} from "./media-artifact-cache.js";
export {
  cleanupExpiredAssetArtifacts,
  cleanupProjectMediaCache,
  mediaArtifactRoot,
  mediaStorageDiagnostics,
  mediaStorageIdentity,
} from "./media-artifact-cache.js";
export { mediaLimits, mediaResourceBudgets } from "./media-resource-budgets.js";

const IMPLEMENTED_MEDIA_JOB_SET = new Set<AssetProcessingJob>(["metadata", "thumbnail", "waveform", "storyboard", "captions", "proxy", "review_encode", "image_preview", "pdf_index", "model_optimize", "sanitized_export"]);
export const MEDIA_JOB_KINDS = ASSET_PROCESSING_JOBS.filter((kind) => IMPLEMENTED_MEDIA_JOB_SET.has(kind));
export type MediaJobKind = AssetProcessingJob;
export type MediaAccelerationProfile = "software" | "nvenc" | "amf" | "qsv" | "videotoolbox";
export type MediaToolStatus = {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  accelerationProfiles: MediaAccelerationProfile[];
  /** Verified FFmpeg filter availability, not proof that every codec supports hardware decoding. */
  thumbnailAcceleration?: "cuda" | "software";
  capabilities: AssetProcessingCapability[];
  toolVersions: Record<string, string | null>;
  ready: boolean;
};

type PrismaLike = any;
type ProgressUpdate = (progress: number, message: string) => Promise<void>;

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const require = createRequire(import.meta.url);

function workspaceRoot(cwd = process.cwd()) {
  if (path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === "apps") return path.resolve(cwd, "../..");
  return cwd;
}

function executableCandidate(name: "ffmpeg" | "ffprobe", cwd = process.cwd()) {
  const explicit = String(process.env[name === "ffmpeg" ? "CLUSTER_FFMPEG_PATH" : "CLUSTER_FFPROBE_PATH"] || "").trim();
  if (explicit) return explicit;
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const bundled = path.join(workspaceRoot(cwd), "runtime", "ffmpeg", "bin", file);
  return bundled;
}

async function executableExists(candidate: string) {
  if (!path.isAbsolute(candidate)) return false;
  try { await fs.access(candidate); return true; } catch { return false; }
}


async function resolveTool(name: "ffmpeg" | "ffprobe", cwd = process.cwd()) {
  const candidate = executableCandidate(name, cwd);
  const command = await executableExists(candidate) ? candidate : name;
  try {
    const output = await captureCommand(command, ["-version"]);
    return { path: command, version: output.split(/\r?\n/)[0]?.slice(0, 240) || null };
  } catch {
    return { path: command, version: null };
  }
}

function installedPackageVersion(packageName: string, probeSpecifier = packageName) {
  try {
    require.resolve(probeSpecifier);
  } catch {
    return null;
  }
  try {
    const packageJson = require(`${packageName}/package.json`) as { version?: string };
    return typeof packageJson?.version === "string" ? packageJson.version : "installed";
  } catch {
    return "installed";
  }
}

const MEDIA_TOOL_INSPECTION_TTL_MS = 60_000;
const mediaToolInspectionCache = new Map<string, { expiresAt: number; value?: MediaToolStatus; inflight?: Promise<MediaToolStatus> }>();

async function inspectMediaToolsUncached(cwd = process.cwd()): Promise<MediaToolStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([resolveTool("ffmpeg", cwd), resolveTool("ffprobe", cwd)]);
  const accelerationProfiles: MediaAccelerationProfile[] = ["software"];
  let thumbnailAcceleration: "cuda" | "software" = "software";
  if (ffmpeg.version) {
    const encoders = await captureCommand(ffmpeg.path, ["-hide_banner", "-encoders"], 15_000).catch(() => "");
    if (/\bh264_nvenc\b/.test(encoders)) accelerationProfiles.push("nvenc");
    if (/\bh264_amf\b/.test(encoders)) accelerationProfiles.push("amf");
    if (/\bh264_qsv\b/.test(encoders)) accelerationProfiles.push("qsv");
    if (/\bh264_videotoolbox\b/.test(encoders)) accelerationProfiles.push("videotoolbox");
    const [hwaccels, filters] = await Promise.all([
      captureCommand(ffmpeg.path, ["-hide_banner", "-hwaccels"], 8_000).catch(() => ""),
      captureCommand(ffmpeg.path, ["-hide_banner", "-filters"], 8_000).catch(() => ""),
    ]);
    if (supportsCudaThumbnail(hwaccels, filters)) thumbnailAcceleration = "cuda";
  }
  const pdfjsVersion = installedPackageVersion("pdfjs-dist", "pdfjs-dist/legacy/build/pdf.mjs");
  const pdfLibVersion = installedPackageVersion("pdf-lib");
  const assimpVersion = installedPackageVersion("assimpjs");
  const capabilities: AssetProcessingCapability[] = ["probe.model"];
  if (ffprobe.version) capabilities.push("probe.av");
  if (ffmpeg.version) capabilities.push("derive.thumbnail.av", "derive.waveform", "derive.storyboard", "derive.captions", "encode.h264", "metadata.strip.av");
  if (ffmpeg.version && ffprobe.version) capabilities.push("process.image", "metadata.strip.image");
  if (pdfjsVersion) capabilities.push("parse.pdf");
  if (pdfLibVersion) capabilities.push("metadata.strip.pdf");
  if (assimpVersion) capabilities.push("convert.model");
  return {
    ffmpegPath: ffmpeg.path,
    ffprobePath: ffprobe.path,
    ffmpegVersion: ffmpeg.version,
    ffprobeVersion: ffprobe.version,
    accelerationProfiles,
    thumbnailAcceleration,
    capabilities: [...new Set(capabilities)],
    toolVersions: { ffmpeg: ffmpeg.version, ffprobe: ffprobe.version, pdfjs: pdfjsVersion, pdfLib: pdfLibVersion, assimpjs: assimpVersion, clusterModelProbe: "1" },
    ready: capabilities.length > 0,
  };
}

export async function inspectMediaTools(cwd = process.cwd()): Promise<MediaToolStatus> {
  const key = path.resolve(cwd);
  const now = Date.now();
  const cached = mediaToolInspectionCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.inflight) return cached.inflight;
  const inflight = inspectMediaToolsUncached(cwd).then((value) => {
    mediaToolInspectionCache.set(key, { value, expiresAt: Date.now() + MEDIA_TOOL_INSPECTION_TTL_MS });
    return value;
  }).catch((error) => {
    mediaToolInspectionCache.delete(key);
    throw error;
  });
  mediaToolInspectionCache.set(key, { value: cached?.value, expiresAt: cached?.expiresAt || 0, inflight });
  return inflight;
}

export function selectedMediaAcceleration(tools: MediaToolStatus): MediaAccelerationProfile {
  const configured = String(process.env.CLUSTER_MEDIA_ACCELERATION || "auto").trim().toLowerCase();
  if (configured !== "auto" && tools.accelerationProfiles.includes(configured as MediaAccelerationProfile)) return configured as MediaAccelerationProfile;
  for (const preferred of ["nvenc", "amf", "qsv", "videotoolbox"] as MediaAccelerationProfile[]) if (tools.accelerationProfiles.includes(preferred)) return preferred;
  return "software";
}

export function mediaWorkerLabels() {
  return [...new Set(String(process.env.CLUSTER_MEDIA_WORKER_LABELS || "local").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[a-z0-9][a-z0-9._-]{0,39}$/.test(item)))].slice(0, 16);
}

function safeJson(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

export const DEFAULT_MEDIA_PROCESSING_POLICIES: Record<ReviewMedium, Record<string, MediaJobKind[]>> = {
  video: {
    source: ["metadata", "thumbnail", "waveform", "storyboard", "captions", "proxy"],
    review: ["metadata", "thumbnail", "waveform", "storyboard", "captions"],
    master: ["metadata", "thumbnail", "waveform", "storyboard", "captions"],
    proxy: ["metadata", "thumbnail", "waveform"],
    reference: ["metadata", "thumbnail", "waveform", "storyboard", "captions"],
  },
  audio: {
    source: ["metadata", "waveform"],
    review: ["metadata", "waveform"],
    master: ["metadata", "waveform"],
    proxy: ["metadata", "waveform"],
    reference: ["metadata", "waveform"],
  },
  image: {
    source: ["metadata", "image_preview"],
    review: ["metadata", "image_preview"],
    master: ["metadata", "image_preview"],
    proxy: ["metadata", "image_preview"],
    reference: ["metadata", "image_preview"],
  },
  pdf: { source: ["metadata", "pdf_index"], review: ["metadata", "pdf_index"], master: ["metadata", "pdf_index"], proxy: [], reference: ["metadata", "pdf_index"] },
  "3d": { source: ["metadata"], review: ["metadata"], master: ["metadata"], proxy: ["metadata"], reference: ["metadata"] },
};

export async function resolveMediaProcessingPolicy(prisma: PrismaLike, projectType: string, medium: ReviewMedium, assetRole: string) {
  const canonicalType = String(projectType || "general").trim().toLowerCase();
  const canonicalMedium = String(medium || "video").trim().toLowerCase() as ReviewMedium;
  const role = String(assetRole || "source").trim().toLowerCase();
  const stored = await prisma.mediaProcessingPolicy.findUnique({ where: { projectType_medium_assetRole: { projectType: canonicalType, medium: canonicalMedium, assetRole: role } } }).catch(() => null);
  if (stored) return { enabled: Boolean(stored.enabled), medium: canonicalMedium, jobs: (safeJsonArray(stored.jobs).filter((job) => MEDIA_JOB_KINDS.includes(job as MediaJobKind)) as MediaJobKind[]).slice(0, 8), accelerationPreference: normalizeAccelerationPreference(stored.accelerationPreference), retentionDays: stored.retentionDays ?? null, source: "studio" as const };
  const jobs = (DEFAULT_MEDIA_PROCESSING_POLICIES[canonicalMedium]?.[role] || []).slice(0, 8);
  return { enabled: jobs.length > 0, medium: canonicalMedium, jobs, accelerationPreference: "auto" as const, retentionDays: null, source: "default" as const };
}

export function normalizeAccelerationPreference(value: unknown): "auto" | MediaAccelerationProfile {
  const normalized = String(value || "auto").trim().toLowerCase();
  return ["software", "nvenc", "amf", "qsv", "videotoolbox"].includes(normalized) ? normalized as MediaAccelerationProfile : "auto";
}

export function supportedMediaJobRoutes(tools: MediaToolStatus): Array<{ medium: ReviewMedium; kind: MediaJobKind }> {
  const capabilities = new Set(tools.capabilities);
  const routes: Array<{ medium: ReviewMedium; kind: MediaJobKind }> = [];
  for (const medium of REVIEW_MEDIA) {
    for (const kind of MEDIA_JOB_KINDS) {
      if (!assetProcessingJobSupportedForMedium(medium, kind)) continue;
      if (assetProcessingJobRequirements(medium, kind).every((capability) => capabilities.has(capability))) routes.push({ medium, kind });
    }
  }
  return routes;
}

export function supportedMediaJobs(tools: MediaToolStatus): MediaJobKind[] {
  return [...new Set(supportedMediaJobRoutes(tools).map((route) => route.kind))];
}

export async function selectMediaQueue(prisma: PrismaLike, kind: MediaJobKind, medium: ReviewMedium, preference: unknown = "auto") {
  if (!MEDIA_JOB_KINDS.includes(kind)) throw Object.assign(new Error(`Processing job ${kind} is not implemented by this Cluster build.`), { code: "MEDIA_PROCESSING_JOB_UNIMPLEMENTED", statusCode: 409 });
  if (!assetProcessingJobSupportedForMedium(medium, kind)) throw Object.assign(new Error(`Processing job ${kind} is not supported for ${medium} assets.`), { code: "MEDIA_PROCESSING_JOB_UNSUPPORTED_FOR_MEDIUM", statusCode: 409 });
  const required = assetProcessingJobRequirements(medium, kind);
  if (kind !== "proxy" && kind !== "review_encode") return { queue: `media.${medium}.${kind}`, acceleration: "software" as MediaAccelerationProfile, requiredCapabilities: required, reason: "capability-queue" };
  const requested = normalizeAccelerationPreference(preference);
  const cutoff = new Date(Date.now() - 35_000);
  const workers = await prisma.mediaWorkerHeartbeat.findMany({ where: { lastSeenAt: { gte: cutoff }, status: { in: ["ready", "busy"] }, desiredState: "active" }, orderBy: { lastSeenAt: "desc" }, take: 64 }).catch(() => []);
  const serverStorage = mediaStorageIdentity();
  const candidates = workers.filter((worker: any) => {
    const capabilities = new Set(safeJsonArray(worker.capabilities));
    return required.every((capability) => capabilities.has(capability))
      && Number(worker.activeJobs || 0) < Math.max(1, Number(worker.concurrency || 1))
      && worker.storageTopology !== "remote"
      && (!worker.storageFingerprint || worker.storageFingerprint === serverStorage.fingerprint);
  });
  const profiles = requested === "auto" ? (["nvenc", "amf", "qsv", "videotoolbox", "software"] as MediaAccelerationProfile[]) : [requested, "software"].filter((value, index, all) => all.indexOf(value) === index) as MediaAccelerationProfile[];
  for (const profile of profiles) {
    const eligible = candidates.filter((worker: any) => safeJsonArray(worker.accelerationProfiles).includes(profile) && (profile === "software" || worker.selectedAcceleration === profile));
    if (eligible.length) {
      eligible.sort((a: any, b: any) => (Number(a.activeJobs || 0) / Math.max(1, Number(a.concurrency || 1))) - (Number(b.activeJobs || 0) / Math.max(1, Number(b.concurrency || 1))));
      return { queue: `media.${profile}`, acceleration: profile, requiredCapabilities: required, reason: requested === "auto" ? "capacity" : requested === profile ? "requested" : "fallback" };
    }
  }
  return { queue: "media.software", acceleration: "software" as MediaAccelerationProfile, requiredCapabilities: required, reason: "no-online-capacity" };
}

async function resolveSourcePath(prisma: PrismaLike, asset: any, layout = mediaDataLayout()) {
  const projectDirectory = await projectStorageDirectory(prisma, layout, asset.projectId);
  const medium = String(asset.medium || "video");
  const current = path.join(projectDirectory, "Media", medium, path.basename(asset.fileName));
  try { await fs.access(current); return current; } catch {}
  throw new Error(`Source ${medium} review asset is missing from Cluster storage.`);
}

async function ffprobeJson(tool: MediaToolStatus, filePath: string) {
  const budgets = mediaResourceBudgets();
  const output = await captureCommand(tool.ffprobePath, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", filePath], budgets.probeTimeoutMs, budgets.maxProbeOutputBytes);
  return JSON.parse(output);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedText(value: unknown, maximum = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
}

function probeTagValue(tags: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const found = Object.entries(tags).find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (found) return boundedText(found[1], 1000);
  }
  return null;
}

function parseProbeMetadata(probe: any, asset: any) {
  const streams = Array.isArray(probe?.streams) ? probe.streams.slice(0, 64) : [];
  const formatTags = probe?.format?.tags && typeof probe.format.tags === "object" ? probe.format.tags as Record<string, unknown> : {};
  const videoTracks = streams.filter((stream: any) => stream.codec_type === "video").map((stream: any, index: number) => {
    const pixelFormat = boundedText(stream.pix_fmt, 80);
    const rawBits = finiteNumber(stream.bits_per_raw_sample);
    const pixelBits = pixelFormat?.match(/(?:^|[^0-9])(10|12|14|16)(?:le|be)?(?:$|[^0-9])/i);
    const sideData = (Array.isArray(stream.side_data_list) ? stream.side_data_list : []).slice(0, 16).map((entry: any) => ({
      type: boundedText(entry?.side_data_type, 120),
      maxContent: finiteNumber(entry?.max_content),
      maxAverage: finiteNumber(entry?.max_average),
      minLuminance: finiteNumber(entry?.min_luminance),
      maxLuminance: finiteNumber(entry?.max_luminance),
    })).filter((entry: any) => entry.type);
    const colorTransfer = boundedText(stream.color_transfer, 80);
    const colorPrimaries = boundedText(stream.color_primaries, 80);
    const hdr = /smpte2084|arib-std-b67|pq|hlg/i.test(colorTransfer || "") || sideData.some((entry: any) => /mastering display|content light/i.test(entry.type || ""));
    return {
      index: Number(stream.index ?? index), codec: boundedText(stream.codec_name, 80), profile: boundedText(stream.profile, 120), width: finiteNumber(stream.width), height: finiteNumber(stream.height), pixelFormat, frameRate: parseRate(stream.avg_frame_rate || stream.r_frame_rate), bitRate: finiteNumber(stream.bit_rate), bitsPerRawSample: rawBits, bitDepth: rawBits || (pixelBits ? Number(pixelBits[1]) : pixelFormat ? 8 : null), colorSpace: boundedText(stream.color_space, 80), colorTransfer, colorPrimaries, colorRange: boundedText(stream.color_range, 80), hdr, hdrMetadata: sideData, fieldOrder: boundedText(stream.field_order, 80), language: boundedText(stream.tags?.language, 32), title: boundedText(stream.tags?.title, 240), disposition: stream.disposition && typeof stream.disposition === "object" ? stream.disposition : {},
    };
  });
  const audioTracks = streams.filter((stream: any) => stream.codec_type === "audio").map((stream: any, index: number) => {
    const streamIndex = Number(stream.index ?? index);
    const disposition = stream.disposition && typeof stream.disposition === "object" ? stream.disposition : {};
    const title = boundedText(stream.tags?.title, 240);
    return {
      id: `stream:${streamIndex}`, index: streamIndex, label: title || boundedText(stream.tags?.language, 32) || `Track ${index + 1}`, codec: boundedText(stream.codec_name, 80), profile: boundedText(stream.profile, 120), channels: finiteNumber(stream.channels), channelLayout: boundedText(stream.channel_layout, 120), sampleRateHz: finiteNumber(stream.sample_rate), bitRate: finiteNumber(stream.bit_rate), sampleFormat: boundedText(stream.sample_fmt, 80), language: boundedText(stream.tags?.language, 32), title, disposition, default: Boolean((disposition as any).default), commentary: Boolean((disposition as any).comment),
    };
  });
  const textTracks = streams.filter((stream: any) => ["subtitle", "data"].includes(String(stream.codec_type))).map((stream: any, index: number) => ({ index: Number(stream.index ?? index), type: boundedText(stream.codec_type, 40), codec: boundedText(stream.codec_name, 80), language: boundedText(stream.tags?.language, 32), title: boundedText(stream.tags?.title, 240) }));
  const chapters = (Array.isArray(probe?.chapters) ? probe.chapters : []).slice(0, 2000).map((chapter: any, index: number) => ({ index, startSeconds: finiteNumber(chapter.start_time), endSeconds: finiteNumber(chapter.end_time), title: boundedText(chapter.tags?.title, 240) }));
  const video = videoTracks[0] || null;
  const audio = audioTracks[0] || null;
  const durationSeconds = finiteNumber(probe?.format?.duration) ?? finiteNumber(streams[0]?.duration) ?? finiteNumber(asset.durationSeconds);
  const technicalTags = Object.fromEntries(Object.entries(formatTags).filter(([key]) => /^(?:icc_profile|color(?:space|_space|primaries|_primaries|transfer|_transfer|range|_range)|gamma|white_point|orientation)$/i.test(key)).slice(0, 32).map(([key, value]) => [key.slice(0, 120), boundedText(value, 1000)]));
  const measured = {
    durationSeconds,
    frameRate: video?.frameRate ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec || audio?.codec || boundedText(asset.codec, 80),
    bitRate: finiteNumber(probe?.format?.bit_rate),
    formatName: boundedText(probe?.format?.format_name, 160),
    formatLongName: boundedText(probe?.format?.format_long_name, 240),
    colorProfile: boundedText((technicalTags as any).icc_profile, 1000),
    videoTracks,
    audioTracks,
    textTracks,
    chapters,
    technicalTags,
  };
  const sensitive: Record<string, Record<string, unknown>> = {};
  const sensitiveEntries: Array<[string, string, unknown]> = [];
  for (const [key, value] of Object.entries(formatTags)) {
    const lower = key.toLowerCase();
    if (/location|gps|latitude|longitude|iso6709/.test(lower)) sensitiveEntries.push(["location", key, value]);
    else if (/serial|device|camera|make|model/.test(lower)) sensitiveEntries.push(["device_identifier", key, value]);
    else if (/author|artist|composer|owner|creator/.test(lower)) sensitiveEntries.push(["private_author", key, value]);
    else if (/path|filename|directory/.test(lower)) sensitiveEntries.push(["filesystem_path", key, value]);
    else if (/encoder|software|history|comment/.test(lower)) sensitiveEntries.push(["editing_history", key, value]);
  }
  for (const [category, key, value] of sensitiveEntries.slice(0, 128)) {
    sensitive[category] ||= {};
    sensitive[category][key.slice(0, 160)] = boundedText(value, 1000);
  }
  const creationTime = probeTagValue(formatTags, "creation_time", "date", "com.apple.quicktime.creationdate");
  const capturedAt = creationTime && Number.isFinite(new Date(creationTime).getTime()) ? new Date(creationTime) : null;
  return { measured, sensitive, capturedAt };
}


let pdfJsPromise: Promise<any> | null = null;
async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((error) => {
      pdfJsPromise = null;
      throw new Error(`MEDIA_PDF_PARSER_UNAVAILABLE: ${error instanceof Error ? error.message : "pdfjs-dist unavailable"}`);
    });
  }
  return pdfJsPromise;
}

function pdfDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const compact = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(text);
  if (compact) {
    const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = compact;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function openPdfForProcessing(filePath: string) {
  const budgets = mediaResourceBudgets();
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("MEDIA_PDF_SOURCE_INVALID: PDF source is not a file.");
  if (stat.size > budgets.maxPdfSourceBytes) throw new Error("MEDIA_PDF_SOURCE_TOO_LARGE: PDF exceeds the configured parser byte budget.");
  const header = Buffer.alloc(Math.min(8, stat.size));
  const handle = await fs.open(filePath, "r");
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  if (!header.toString("latin1").startsWith("%PDF-")) throw new Error("MEDIA_PDF_SIGNATURE_INVALID: file does not contain a PDF signature.");
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const document = await task.promise;
  if (document.numPages > budgets.maxPdfPages) {
    await document.destroy().catch(() => undefined);
    throw new Error("MEDIA_PDF_PAGE_BUDGET_EXCEEDED: PDF contains more pages than the configured parser budget.");
  }
  return document;
}

async function parsePdfMetadata(document: any) {
  const metadataResult = await document.getMetadata().catch(() => ({ info: {} }));
  const info = metadataResult?.info && typeof metadataResult.info === "object" ? metadataResult.info as Record<string, unknown> : {};
  const safeInfo: Record<string, unknown> = {};
  const sensitive: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(info).slice(0, 128)) {
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    const bounded = typeof value === "string" ? boundedText(value, 1000) : value;
    if (bounded == null) continue;
    const lower = key.toLowerCase();
    if (/author|creator/.test(lower)) { sensitive.private_author ||= {}; sensitive.private_author[key] = bounded; }
    else if (/producer|creator|moddate/.test(lower)) { sensitive.editing_history ||= {}; sensitive.editing_history[key] = bounded; }
    else if (/path|filename|directory/.test(lower)) { sensitive.filesystem_path ||= {}; sensitive.filesystem_path[key] = bounded; }
    else if (["title", "subject", "keywords"].includes(lower)) { sensitive.document_private_field ||= {}; sensitive.document_private_field[key] = bounded; }
    else safeInfo[key] = bounded;
  }
  const creationDate = pdfDate(info.CreationDate);
  return {
    measured: {
      pageCount: Number(document.numPages || 0),
      pdfFormatVersion: boundedText(info.PDFFormatVersion, 40),
      tagged: Boolean(info.IsTagged),
      acroFormPresent: Boolean(info.IsAcroFormPresent),
      xfaPresent: Boolean(info.IsXFAPresent),
      collectionPresent: Boolean(info.IsCollectionPresent),
      signaturesPresent: Boolean(info.IsSignaturesPresent),
      linearized: Boolean(info.IsLinearized),
      safeDocumentInfo: safeInfo,
    },
    sensitive,
    capturedAt: creationDate,
  };
}

async function extractPdfTextIndex(document: any, cancellationRequested: CancellationCheck) {
  const budgets = mediaResourceBudgets();
  const pages: Array<{ page: number; text: string }> = [];
  let characters = 0;
  let truncated = false;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (await cancellationRequested()) throw new Error("MEDIA_JOB_CANCELLED: PDF indexing was cancelled.");
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const chunks: string[] = [];
    for (const item of Array.isArray(content?.items) ? content.items : []) {
      const text = typeof item?.str === "string" ? item.str : "";
      if (!text) continue;
      const remaining = budgets.maxPdfTextCharacters - characters;
      if (remaining <= 0) { truncated = true; break; }
      const piece = text.slice(0, remaining);
      chunks.push(piece);
      characters += piece.length;
      if (piece.length < text.length) { truncated = true; break; }
    }
    pages.push({ page: pageNumber, text: chunks.join(" ") });
    page.cleanup?.();
    if (truncated) break;
  }
  return { version: 1, pageCount: Number(document.numPages || 0), indexedPages: pages.length, characters, truncated, pages };
}

function gltfTriangleCount(gltf: any) {
  const accessors = Array.isArray(gltf?.accessors) ? gltf.accessors : [];
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of Array.isArray(gltf?.meshes) ? gltf.meshes : []) {
    for (const primitive of Array.isArray(mesh?.primitives) ? mesh.primitives : []) {
      primitives += 1;
      const positionAccessor = Number(primitive?.attributes?.POSITION);
      const indexAccessor = Number(primitive?.indices);
      const vertexCount = Number.isInteger(positionAccessor) && accessors[positionAccessor] ? Number(accessors[positionAccessor].count || 0) : 0;
      const elementCount = Number.isInteger(indexAccessor) && accessors[indexAccessor] ? Number(accessors[indexAccessor].count || 0) : vertexCount;
      vertices += Math.max(0, vertexCount);
      const mode = Number.isInteger(primitive?.mode) ? Number(primitive.mode) : 4;
      if (mode === 4) triangles += Math.floor(elementCount / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, elementCount - 2);
    }
  }
  return { triangles, vertices, primitives };
}

function gltfBounds(gltf: any) {
  const accessors = Array.isArray(gltf?.accessors) ? gltf.accessors : [];
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const accessor of accessors) {
    if (accessor?.type !== "VEC3" || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) continue;
    for (let i = 0; i < 3; i += 1) {
      const min = Number(accessor.min[i]); const max = Number(accessor.max[i]);
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      mins[i] = Math.min(mins[i], min); maxs[i] = Math.max(maxs[i], max); found = true;
    }
  }
  return found ? { min: mins, max: maxs } : null;
}

async function readFileHandleFully(handle: import("node:fs/promises").FileHandle, buffer: Buffer, position: number) {
  let offset = 0;
  while (offset < buffer.length) {
    const read = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!read.bytesRead) break;
    offset += read.bytesRead;
  }
  return offset;
}

async function readGltfJson(filePath: string) {
  const budgets = mediaResourceBudgets();
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("MEDIA_MODEL_SOURCE_INVALID: model source is not a file.");
  if (stat.size > budgets.maxModelSourceBytes) throw new Error("MEDIA_MODEL_SOURCE_TOO_LARGE: model exceeds the configured source byte budget.");
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".gltf") {
    if (stat.size > budgets.maxModelJsonBytes) throw new Error("MEDIA_MODEL_JSON_TOO_LARGE: glTF JSON exceeds the configured parser budget.");
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  }
  if (extension !== ".glb") return null;
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(20);
    const headerBytes = await readFileHandleFully(handle, header, 0);
    if (headerBytes < 20 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2) throw new Error("MEDIA_MODEL_GLB_INVALID: GLB header is invalid or unsupported.");
    const declaredLength = header.readUInt32LE(8);
    const jsonLength = header.readUInt32LE(12);
    const chunkType = header.readUInt32LE(16);
    if (declaredLength > stat.size || jsonLength <= 0 || jsonLength > budgets.maxModelJsonBytes || chunkType !== 0x4e4f534a || 20 + jsonLength > stat.size) throw new Error("MEDIA_MODEL_GLB_INVALID: GLB JSON chunk is invalid or exceeds parser budgets.");
    const json = Buffer.alloc(jsonLength);
    if (await readFileHandleFully(handle, json, 20) !== jsonLength) throw new Error("MEDIA_MODEL_GLB_INVALID: GLB JSON chunk is truncated.");
    return JSON.parse(json.toString("utf8").replace(/[\u0000\u0020]+$/g, ""));
  } finally { await handle.close(); }
}

async function parseModelMetadata(filePath: string, originalName: string) {
  const extension = path.extname(originalName || filePath).toLowerCase().replace(/^\./, "");
  const gltf = await readGltfJson(filePath);
  if (!gltf) return { measured: { format: extension || "unknown", optimizedRuntimeFormat: false, requiresOptimizedDerivative: true }, sensitive: {} };
  const geometry = gltfTriangleCount(gltf);
  const budgets = mediaResourceBudgets();
  const buffers = Array.isArray(gltf.buffers) ? gltf.buffers : [];
  const images = Array.isArray(gltf.images) ? gltf.images : [];
  const externalResourceCount = [...buffers, ...images].filter((item: any) => typeof item?.uri === "string" && !item.uri.startsWith("data:")).length;
  return {
    measured: {
      format: extension || "gltf",
      generator: boundedText(gltf?.asset?.generator, 240),
      gltfVersion: boundedText(gltf?.asset?.version, 40),
      meshCount: Array.isArray(gltf.meshes) ? gltf.meshes.length : 0,
      nodeCount: Array.isArray(gltf.nodes) ? gltf.nodes.length : 0,
      primitiveCount: geometry.primitives,
      vertexCount: geometry.vertices,
      triangleCount: geometry.triangles,
      materialCount: Array.isArray(gltf.materials) ? gltf.materials.length : 0,
      textureCount: Array.isArray(gltf.textures) ? gltf.textures.length : 0,
      imageCount: images.length,
      animationCount: Array.isArray(gltf.animations) ? gltf.animations.length : 0,
      skinCount: Array.isArray(gltf.skins) ? gltf.skins.length : 0,
      cameraCount: Array.isArray(gltf.cameras) ? gltf.cameras.length : 0,
      externalResourceCount,
      bounds: gltfBounds(gltf),
      overTriangleBudget: geometry.triangles > budgets.maxModelTriangles,
      optimizedRuntimeFormat: true,
      requiresOptimizedDerivative: false,
    },
    sensitive: {},
  };
}


async function updateAssetProcessingState(prisma: PrismaLike, assetId: string) {
  const active = await prisma.projectControlRecord.count({ where: { kind: "media_job", linkedEntityType: "review_asset", linkedEntityId: assetId, archived: false, status: { in: ["queued", "processing", "retrying"] } } });
  const failed = active ? 0 : await prisma.projectControlRecord.count({ where: { kind: "media_job", linkedEntityType: "review_asset", linkedEntityId: assetId, archived: false, status: "failed" } });
  await prisma.reviewAsset.update({ where: { id: assetId }, data: { processingState: active ? "processing" : failed ? "failed" : "ready" } });
}

async function updateControl(prisma: PrismaLike, controlRecordId: string, patch: Record<string, unknown>) {
  const existing = await prisma.projectControlRecord.findUnique({ where: { id: controlRecordId } });
  if (!existing) return;
  const payload = safeJson(existing.payload);
  const patchPayload = patch.payload && typeof patch.payload === "object" ? patch.payload as Record<string, unknown> : null;
  await prisma.projectControlRecord.update({
    where: { id: controlRecordId },
    data: {
      ...patch,
      ...(patchPayload ? { payload: JSON.stringify({ ...payload, ...patchPayload }) } : {}),
      revision: { increment: 1 },
    },
  });
}

export type MediaJobPayload = { assetId: string; controlRecordId: string; requestedById?: string | null; metadataExportSelection?: unknown; exportVariantKey?: string };

export async function executeMediaJob(input: {
  prisma: PrismaLike;
  kind: MediaJobKind;
  payload: MediaJobPayload;
  durableJobId: string;
  attempt: number;
  maxAttempts: number;
  cancellationRequested: CancellationCheck;
  updateProgress: ProgressUpdate;
  tools?: MediaToolStatus;
  accelerationProfile?: MediaAccelerationProfile;
  /** Only accepted for video-frame thumbnails after worker GPU admission. */
  thumbnailAcceleration?: "cuda" | "software";
  /** Verified physical device selected by the shared PostgreSQL GPU lease. */
  nvidiaGpuUuid?: string;
  /** Defer CPU fallback to the worker after it drops the hardware lease. */
  deferSoftwareFallback?: boolean;
  onGpuThumbnailFallback?: (message: string) => void;
}) {
  const { prisma, kind, payload } = input;
  const tools = input.tools ?? await inspectMediaTools();
  if (!MEDIA_JOB_KINDS.includes(kind)) throw new Error(`MEDIA_PROCESSING_JOB_UNIMPLEMENTED: ${kind} is not implemented by this Cluster build.`);
  const asset = await prisma.reviewAsset.findUnique({ where: { id: payload.assetId } });
  if (!asset) throw new Error("MEDIA_ASSET_NOT_FOUND: review asset no longer exists.");
  const medium = REVIEW_MEDIA.includes(asset.medium as ReviewMedium) ? asset.medium as ReviewMedium : null;
  if (!medium) throw new Error(`MEDIA_ASSET_MEDIUM_INVALID: ${String(asset.medium || "unknown")}.`);
  if (!assetProcessingJobSupportedForMedium(medium, kind)) throw new Error(`MEDIA_PROCESSING_JOB_UNSUPPORTED_FOR_MEDIUM: ${kind} is not registered for ${medium}.`);
  const requiredCapabilities = assetProcessingJobRequirements(medium, kind);
  const availableCapabilities = new Set(tools.capabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !availableCapabilities.has(capability));
  if (missingCapabilities.length) throw new Error(`MEDIA_PROCESSING_CAPABILITY_UNAVAILABLE: ${missingCapabilities.join(", ")} required for ${medium}/${kind}.`);
  await updateControl(prisma, payload.controlRecordId, { status: "processing", progress: 3, payload: { durableJobId: input.durableJobId, attempt: input.attempt, workerStartedAt: new Date().toISOString(), requiredCapabilities } });
  await prisma.reviewAsset.update({ where: { id: asset.id }, data: { processingState: "processing" } });
  const update = async (progress: number, message: string) => {
    const bounded = Math.max(0, Math.min(100, Math.round(progress)));
    await Promise.all([input.updateProgress(bounded, message), updateControl(prisma, payload.controlRecordId, { progress: bounded, payload: { progressMessage: message } })]);
  };
  try {
    if (await input.cancellationRequested()) throw new Error("MEDIA_JOB_CANCELLED: media processing was cancelled.");
    const sourcePath = await resolveSourcePath(prisma, asset);
    const sourceStat = await fs.stat(sourcePath);
    const resourceBudgets = mediaResourceBudgets();
    if (medium === "image" && sourceStat.size > resourceBudgets.maxImageSourceBytes) throw new Error(`MEDIA_IMAGE_SOURCE_TOO_LARGE: ${sourceStat.size} bytes exceeds ${resourceBudgets.maxImageSourceBytes}.`);
    const sourceChecksumSha256 = asset.checksumSha256 || await hashMediaFile(sourcePath);
    const metadata = safeJson(asset.metadata);
    const sensitiveMetadata = safeJson(asset.sensitiveMetadata);
    const metadataProvenance = safeJson(asset.metadataProvenance);
    const extractedAt = new Date().toISOString();
    const artifactContext = {
      sourceChecksumSha256,
      generatedByJobId: input.durableJobId,
      toolchain: tools.toolVersions,
    };
    const recipeKey = (artifactKind: string, variantKey = "default", options: Record<string, unknown> = {}) =>
      mediaDerivativeRecipeKey({ kind: artifactKind, variantKey, medium, toolVersions: tools.toolVersions, options });
    await update(8, `Inspecting ${asset.originalName}`);

    if (kind === "sanitized_export") {
      if (medium === "3d") throw new Error("MEDIA_SANITIZED_EXPORT_UNSUPPORTED: 3d does not have a sanitizer executor.");
      const exportBudgets = mediaResourceBudgets();
      if (medium === "pdf" && sourceStat.size > exportBudgets.maxPdfSourceBytes) throw new Error(`MEDIA_PDF_SOURCE_TOO_LARGE: ${sourceStat.size} bytes exceeds ${exportBudgets.maxPdfSourceBytes}.`);
      if (medium === "image") {
        const probe = await ffprobeJson(tools, sourcePath);
        const imageStream = Array.isArray(probe?.streams) ? probe.streams.find((stream: any) => stream?.codec_type === "video" && Number(stream?.width) > 0 && Number(stream?.height) > 0) : null;
        const pixels = imageStream ? Number(imageStream.width) * Number(imageStream.height) : 0;
        if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new Error("MEDIA_IMAGE_DIMENSIONS_INVALID: image dimensions could not be safely established before export.");
        if (pixels > exportBudgets.maxImagePixels) throw new Error(`MEDIA_IMAGE_PIXEL_BUDGET_EXCEEDED: ${pixels} pixels exceeds ${exportBudgets.maxImagePixels}.`);
      }
      const selection = normalizedMetadataExportSelection(payload), variantKey = String(payload.exportVariantKey || selection.policy).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "safe_share";
      await pruneProjectCache(prisma, asset.projectId, medium === "pdf" ? Math.min(sourceStat.size * 2, exportBudgets.maxArtifactBytes) : Math.min(Math.max(sourceStat.size, 32 * 1024 * 1024), exportBudgets.maxArtifactBytes));
      const outputPath = await mediaArtifactFilePath(prisma, asset, "sanitized_export", variantKey, sanitizedExportExtension(asset));
      const sanitizedRecipeKey = recipeKey("sanitized_export", variantKey, {
        policy: selection.policy,
        preserveTechnicalRenderingMetadata: selection.preserveTechnicalRenderingMetadata,
        includeCategories: selection.includeCategories || [],
        excludeSensitiveCategories: selection.excludeSensitiveCategories || [],
      });
      const reused = await reusableArtifact(prisma, {
        reviewAssetId: asset.id,
        kind: "sanitized_export",
        variantKey,
        recipeKey: sanitizedRecipeKey,
        outputPath,
        mimeType: asset.mimeType || "application/octet-stream",
        metadataPolicy: selection.policy,
        metadata: { sourceAssetId: asset.id, policy: selection.policy },
        ...artifactContext,
      });
      if (reused) {
        await update(96, "Reused identical sanitized derivative");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, exportVariantKey: variantKey, policy: selection.policy, reused: true, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: reused.id, variantKey, sizeBytes: reused.sizeBytes, policy: selection.policy, reused: true };
      }
      await update(28, medium === "pdf" ? "Rewriting PDF without private document metadata" : selection.policy === "strip_all" ? "Stripping export metadata" : "Building privacy-safe export derivative");
      const rewrite = await writeSanitizedMediaDerivative({ medium, sourcePath, outputPath, ffmpegPath: tools.ffmpegPath, cancellationRequested: input.cancellationRequested, runProcess });
      const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "sanitized_export", variantKey, fileName: outputPath, mimeType: rewrite.mimeType || asset.mimeType || "application/octet-stream", metadataPolicy: selection.policy, recipeKey: sanitizedRecipeKey, metadata: { sourceAssetId: asset.id, policy: selection.policy, selection: { preserveTechnicalRenderingMetadata: selection.preserveTechnicalRenderingMetadata, includeCategories: selection.includeCategories || [], excludeSensitiveCategories: selection.excludeSensitiveCategories || [] }, rewritten: rewrite.rewritten, streamCopied: rewrite.streamCopied, ...(rewrite.rewrite ? { rewrite: rewrite.rewrite } : {}) }, ...artifactContext });
      await update(96, "Sanitized export ready"); await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, exportVariantKey: variantKey, policy: selection.policy, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id); return { kind, assetId: asset.id, artifactId: artifact.id, variantKey, sizeBytes: artifact.sizeBytes, policy: selection.policy };
    }

    if (medium === "pdf") {
      const document = await openPdfForProcessing(sourcePath);
      try {
        const parsedPdf = await parsePdfMetadata(document);
        const nextSensitive = { ...sensitiveMetadata };
        for (const [category, values] of Object.entries(parsedPdf.sensitive)) nextSensitive[category] = { ...safeJson(nextSensitive[category]), ...values };
        const nextMetadata = {
          ...metadata,
          production: { ...safeJson(metadata.production), document: parsedPdf.measured },
          derived: { ...safeJson(metadata.derived), lastPdfParseAt: extractedAt },
        };
        const nextProvenance = { ...metadataProvenance, documentMetadata: { source: "probe", capturedAt: extractedAt, tool: "pdfjs", confidence: "reported" } };
        await prisma.reviewAsset.update({ where: { id: asset.id }, data: { checksumSha256: sourceChecksumSha256, metadata: JSON.stringify(nextMetadata), sensitiveMetadata: JSON.stringify(nextSensitive), metadataProvenance: JSON.stringify(nextProvenance), capturedAt: asset.capturedAt || parsedPdf.capturedAt || null, modifiedAt: asset.modifiedAt || sourceStat.mtime } });
        if (kind === "metadata") {
          await update(96, "PDF metadata extracted");
          await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { result: parsedPdf.measured, completedAt: new Date().toISOString() } });
          await updateAssetProcessingState(prisma, asset.id);
          return { kind, assetId: asset.id, metadata: parsedPdf.measured };
        }
        if (kind !== "pdf_index") throw new Error(`MEDIA_PROCESSING_JOB_UNIMPLEMENTED: ${kind} is not a PDF executor path.`);
        await pruneProjectCache(prisma, asset.projectId, 64 * 1024 * 1024);
        const outputPath = await mediaArtifactFilePath(prisma, asset, "pdf_text_index", "visible-text", "json");
        const pdfRecipeKey = recipeKey("pdf_text_index", "visible-text", { boundedTextIndex: true });
        const reused = await reusableArtifact(prisma, {
          reviewAssetId: asset.id, kind: "pdf_text_index", variantKey: "visible-text",
          recipeKey: pdfRecipeKey, outputPath, mimeType: "application/vnd.cluster.pdf-text-index+json",
          metadataPolicy: "strip_all", metadata: { sourceAssetId: asset.id }, ...artifactContext,
        });
        if (reused) {
          const reusedMetadata = safeJson(reused.metadata);
          await update(96, "Reused identical PDF text index");
          await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
          await updateAssetProcessingState(prisma, asset.id);
          return { kind, assetId: asset.id, artifactId: reused.id, sizeBytes: reused.sizeBytes, reused: true, metadata: reusedMetadata };
        }
        await update(30, "Indexing bounded PDF text");
        const index = await extractPdfTextIndex(document, input.cancellationRequested);
        await fs.writeFile(outputPath, JSON.stringify(index), { mode: 0o640 });
        const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "pdf_text_index", variantKey: "visible-text", fileName: outputPath, mimeType: "application/vnd.cluster.pdf-text-index+json", metadataPolicy: "strip_all", recipeKey: pdfRecipeKey, metadata: { pageCount: index.pageCount, indexedPages: index.indexedPages, characters: index.characters, truncated: index.truncated }, ...artifactContext });
        await update(96, "PDF text index ready");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, truncated: index.truncated, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: artifact.id, sizeBytes: artifact.sizeBytes, indexedPages: index.indexedPages, truncated: index.truncated };
      } finally { await document.destroy().catch(() => undefined); }
    }

    if (medium === "3d") {
      const parsedModel = await parseModelMetadata(sourcePath, asset.originalName);
      const nextMetadata = {
        ...metadata,
        production: { ...safeJson(metadata.production), model: parsedModel.measured },
        derived: { ...safeJson(metadata.derived), lastModelProbeAt: extractedAt },
      };
      const nextProvenance = { ...metadataProvenance, modelMetadata: { source: "probe", capturedAt: extractedAt, tool: "cluster-model-probe", confidence: "reported" } };
      await prisma.reviewAsset.update({ where: { id: asset.id }, data: { checksumSha256: sourceChecksumSha256, metadata: JSON.stringify(nextMetadata), metadataProvenance: JSON.stringify(nextProvenance), modifiedAt: asset.modifiedAt || sourceStat.mtime } });
      if (kind === "metadata") {
        await update(96, "Model metadata extracted");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { result: parsedModel.measured, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, metadata: parsedModel.measured };
      }
      if (kind !== "model_optimize") throw new Error(`MEDIA_PROCESSING_JOB_UNIMPLEMENTED: ${kind} is not a model executor path.`);
      await pruneProjectCache(prisma, asset.projectId, Math.min(mediaResourceBudgets().maxModelSourceBytes, 512 * 1024 * 1024));
      const outputPath = await mediaArtifactFilePath(prisma, asset, "model_optimized", "runtime-glb", "glb");
      const modelRecipeKey = recipeKey("model_optimized", "runtime-glb", { maxSourceBytes: mediaResourceBudgets().maxModelSourceBytes });
      const reused = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "model_optimized", variantKey: "runtime-glb",
        recipeKey: modelRecipeKey, outputPath, mimeType: "model/gltf-binary", metadataPolicy: "preserve",
        metadata: { sourceAssetId: asset.id }, ...artifactContext,
      });
      if (reused) {
        await update(96, "Reused identical optimized model");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: reused.id, sizeBytes: reused.sizeBytes, reused: true };
      }
      await update(30, "Converting model to bounded runtime GLB");
      await createModelGlbDerivative({ sourcePath, sourceRelativeName: asset.originalName, outputPath, maxSourceBytes: mediaResourceBudgets().maxModelSourceBytes });
      const optimized = await parseModelMetadata(outputPath, "runtime.glb");
      const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "model_optimized", variantKey: "runtime-glb", fileName: outputPath, mimeType: "model/gltf-binary", metadataPolicy: "preserve", recipeKey: modelRecipeKey, metadata: { model: optimized.measured }, ...artifactContext });
      await prisma.reviewAsset.update({ where: { id: asset.id }, data: { metadata: JSON.stringify({ ...nextMetadata, derived: { ...safeJson(nextMetadata.derived), optimizedModel: optimized.measured, lastModelOptimizeAt: new Date().toISOString() } }) } });
      await update(96, "Optimized model ready");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: artifact.id, sizeBytes: artifact.sizeBytes, metadata: optimized.measured };
    }

    const probe = await ffprobeJson(tools, sourcePath);
    const parsedProbe = parseProbeMetadata(probe, asset);
    const measured = parsedProbe.measured;
    const videoStream = measured.videoTracks[0] || null;
    const audioStream = measured.audioTracks[0] || null;
    const durationSeconds = measured.durationSeconds;
    const probedAt = extractedAt;
    const production = metadata.production && typeof metadata.production === "object" && !Array.isArray(metadata.production) ? metadata.production : {};
    const nextSensitive = { ...sensitiveMetadata };
    for (const [category, values] of Object.entries(parsedProbe.sensitive)) nextSensitive[category] = { ...(safeJson(nextSensitive[category])), ...values };
    const nextMetadata = {
      ...metadata,
      production: { ...production, probe: measured },
      derived: { ...(safeJson(metadata.derived)), lastProbeAt: probedAt },
    };
    const nextProvenance = {
      ...metadataProvenance,
      productionProbe: { source: "probe", capturedAt: probedAt, tool: "ffprobe", confidence: "reported" },
    };
    await prisma.reviewAsset.update({
      where: { id: asset.id },
      data: {
        durationSeconds: measured.durationSeconds,
        frameRate: measured.frameRate,
        width: measured.width,
        height: measured.height,
        codec: measured.codec,
        checksumSha256: sourceChecksumSha256,
        metadata: JSON.stringify(nextMetadata),
        sensitiveMetadata: JSON.stringify(nextSensitive),
        metadataProvenance: JSON.stringify(nextProvenance),
        capturedAt: asset.capturedAt || parsedProbe.capturedAt || null,
        modifiedAt: asset.modifiedAt || sourceStat.mtime,
      },
    });
    if (kind === "metadata") {
      await update(96, "Metadata extracted");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { result: measured, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, metadata: measured };
    }

    if (kind === "thumbnail") {
      if (!videoStream) throw new Error("MEDIA_VIDEO_STREAM_MISSING: thumbnail generation requires a visual stream.");
      await pruneProjectCache(prisma, asset.projectId, 16 * 1024 * 1024);
      const outputPath = await mediaArtifactFilePath(prisma, asset, "thumbnail", "default", "jpg");
      const thumbnailSeekSeconds = asset.medium === "image" ? 0 : Math.max(0, Math.min(5, (durationSeconds || 0) * 0.1));
      const thumbnailRecipeKey = recipeKey("thumbnail", "default", { width: 1280, quality: 3, seekSeconds: Number(thumbnailSeekSeconds.toFixed(3)) });
      const reused = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "thumbnail", variantKey: "default",
        recipeKey: thumbnailRecipeKey, outputPath, mimeType: "image/jpeg", metadataPolicy: "strip_all",
        metadata: { sourceAssetId: asset.id, width: 1280 }, ...artifactContext,
      });
      if (reused) {
        await update(96, "Reused identical thumbnail");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: reused.id, sizeBytes: reused.sizeBytes, reused: true };
      }
      // For small frames the PCIe/upload/download overhead usually outweighs
      // GPU savings; leave those on CPU while reserving hardware for HD+ work.
      const pixels = Math.max(0, Number(videoStream.width || 0)) * Math.max(0, Number(videoStream.height || 0));
      const attemptGpu = asset.medium === "video" && pixels >= 1280 * 720
        && input.thumbnailAcceleration === "cuda" && tools.thumbnailAcceleration === "cuda";
      await update(30, attemptGpu ? "Generating GPU video thumbnail" : "Generating thumbnail");
      const result = await renderVideoThumbnail({
        sourcePath, outputPath, seekSeconds: thumbnailSeekSeconds, mode: attemptGpu ? "cuda" : "software",
        run: (args) => runProcess({ command: tools.ffmpegPath, args, cancellationRequested: input.cancellationRequested, timeoutMs: 10 * 60 * 1000, nvidiaGpuUuid: args.includes("cuda") ? input.nvidiaGpuUuid : undefined }),
        gpuBound: Boolean(input.nvidiaGpuUuid),
        deferSoftwareFallback: input.deferSoftwareFallback,
        removePartial: () => fs.rm(outputPath, { force: true }),
        cancelled: input.cancellationRequested,
        onFallback: (message) => { input.onGpuThumbnailFallback?.(message); void update(40, "GPU thumbnail unavailable; retrying on CPU").catch(() => undefined); },
      });
      if (!result) return null; // Hardware lease released before CPU retry.
      const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "thumbnail", fileName: outputPath, mimeType: "image/jpeg", metadataPolicy: "strip_all", recipeKey: thumbnailRecipeKey, metadata: { generatedAt: new Date().toISOString(), sourceAssetId: asset.id, width: 1280, acceleration: result.acceleration }, ...artifactContext });
      await update(96, "Thumbnail ready");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: artifact.id, sizeBytes: artifact.sizeBytes };
    }

    if (kind === "image_preview") {
      if (asset.medium !== "image" || !videoStream) throw new Error("MEDIA_IMAGE_STREAM_MISSING: image preview generation requires an image review asset.");
      await pruneProjectCache(prisma, asset.projectId, 32 * 1024 * 1024);
      const budgets = mediaResourceBudgets();
      const maxDimension = Math.max(512, Math.floor(Math.sqrt(budgets.maxImagePixels)));
      const outputPath = await mediaArtifactFilePath(prisma, asset, "image_preview", "display", "png");
      const previewRecipeKey = recipeKey("image_preview", "display", { maxImagePixels: budgets.maxImagePixels, maxDimension });
      const reused = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "image_preview", variantKey: "display",
        recipeKey: previewRecipeKey, outputPath, mimeType: "image/png", metadataPolicy: "strip_all",
        metadata: { sourceAssetId: asset.id, maxImagePixels: budgets.maxImagePixels }, ...artifactContext,
      });
      if (reused) {
        await update(96, "Reused identical image preview");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: reused.id, sizeBytes: reused.sizeBytes, reused: true };
      }
      const args = ["-y", "-i", sourcePath, "-frames:v", "1", "-vf", `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`, "-map_metadata", "-1", outputPath];
      await update(30, "Generating bounded image preview");
      await runProcess({ command: tools.ffmpegPath, args, cancellationRequested: input.cancellationRequested, timeoutMs: 10 * 60 * 1000 });
      const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "image_preview", variantKey: "display", fileName: outputPath, mimeType: "image/png", metadataPolicy: "strip_all", recipeKey: previewRecipeKey, metadata: { generatedAt: new Date().toISOString(), sourceAssetId: asset.id, maxImagePixels: budgets.maxImagePixels }, ...artifactContext });
      await update(96, "Image preview ready");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: artifact.id, sizeBytes: artifact.sizeBytes };
    }

    if (kind === "waveform") {
      if (!audioStream) {
        await update(96, "No audio stream; waveform skipped");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { skipped: true, reason: "no-audio-stream", completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, skipped: true, reason: "no-audio-stream" };
      }
      await pruneProjectCache(prisma, asset.projectId, 32 * 1024 * 1024);
      const dataPath = await mediaArtifactFilePath(prisma, asset, "waveform", "mix", "json");
      const waveformRecipeKey = recipeKey("waveform", "mix", { bounded: true });
      let dataArtifact = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "waveform", variantKey: "mix",
        recipeKey: waveformRecipeKey, outputPath: dataPath, mimeType: "application/vnd.cluster.waveform+json",
        metadataPolicy: "strip_all", metadata: { sourceAssetId: asset.id }, ...artifactContext,
      });
      if (!dataArtifact) {
        await update(25, "Extracting bounded waveform data");
        const waveform = await extractWaveform({ ffmpegPath: tools.ffmpegPath, sourcePath, durationSeconds, cancellationRequested: input.cancellationRequested, maxWaveformBins: mediaResourceBudgets().maxWaveformBins });
        await fs.writeFile(dataPath, JSON.stringify(waveform), { mode: 0o640 });
        dataArtifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "waveform", variantKey: "mix", fileName: dataPath, mimeType: "application/vnd.cluster.waveform+json", metadataPolicy: "strip_all", recipeKey: waveformRecipeKey, metadata: { version: waveform.version, durationSeconds: waveform.durationSeconds, binsPerSecond: waveform.binsPerSecond, channels: waveform.channels.length }, ...artifactContext });
      } else {
        await update(55, "Reused identical waveform data");
      }
      const previewPath = await mediaArtifactFilePath(prisma, asset, "waveform_preview", "mix", "png");
      const waveformPreviewRecipeKey = recipeKey("waveform_preview", "mix", { width: 1600, height: 240, channelLayout: "mono" });
      let previewArtifact = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "waveform_preview", variantKey: "mix",
        recipeKey: waveformPreviewRecipeKey, outputPath: previewPath, mimeType: "image/png",
        metadataPolicy: "strip_all", metadata: { waveformArtifactId: dataArtifact.id }, ...artifactContext,
      });
      if (!previewArtifact) {
        await update(70, "Rendering waveform preview");
        await runProcess({ command: tools.ffmpegPath, args: ["-y", "-i", sourcePath, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1600x240:colors=white", "-frames:v", "1", "-map_metadata", "-1", previewPath], cancellationRequested: input.cancellationRequested, timeoutMs: 10 * 60 * 1000 });
        previewArtifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "waveform_preview", variantKey: "mix", fileName: previewPath, mimeType: "image/png", metadataPolicy: "strip_all", recipeKey: waveformPreviewRecipeKey, metadata: { generatedAt: new Date().toISOString(), waveformArtifactId: dataArtifact.id }, ...artifactContext });
      }
      await update(96, "Waveform ready");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: dataArtifact.id, previewArtifactId: previewArtifact.id, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: dataArtifact.id, previewArtifactId: previewArtifact.id, sizeBytes: dataArtifact.sizeBytes + previewArtifact.sizeBytes };
    }

    if (kind === "storyboard") {
      if (asset.medium !== "video" || !videoStream) throw new Error("MEDIA_STORYBOARD_UNSUPPORTED: storyboard generation requires a video review asset.");
      const duration = Math.max(0.001, Number(durationSeconds || 0));
      const frameCount = Math.min(mediaResourceBudgets().maxStoryboardFrames, 24);
      const columns = Math.min(6, frameCount);
      const rows = Math.ceil(frameCount / columns);
      const frameWidth = 320;
      const frameHeight = Math.max(1, Math.round(frameWidth * Math.max(1, Number(videoStream.height || 180)) / Math.max(1, Number(videoStream.width || 320))));
      const manifest = storyboardManifest(duration, columns, rows, frameWidth, frameHeight, frameCount);
      await pruneProjectCache(prisma, asset.projectId, 48 * 1024 * 1024);
      const outputPath = await mediaArtifactFilePath(prisma, asset, "storyboard", "contact-sheet", "jpg");
      const storyboardRecipeKey = recipeKey("storyboard", "contact-sheet", { frameCount, columns, rows, frameWidth, frameHeight, duration: Number(duration.toFixed(3)) });
      const reused = await reusableArtifact(prisma, {
        reviewAssetId: asset.id, kind: "storyboard", variantKey: "contact-sheet",
        recipeKey: storyboardRecipeKey, outputPath, mimeType: "image/jpeg", metadataPolicy: "strip_all",
        metadata: { manifest }, ...artifactContext,
      });
      if (reused) {
        await update(96, "Reused identical storyboard");
        await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
        await updateAssetProcessingState(prisma, asset.id);
        return { kind, assetId: asset.id, artifactId: reused.id, sizeBytes: reused.sizeBytes, manifest, reused: true };
      }
      const fps = Math.max(0.000001, frameCount / duration);
      const filter = `fps=${fps.toFixed(8)},scale=${frameWidth}:${frameHeight},tile=${columns}x${rows}:padding=${manifest.padding || 0}:margin=${manifest.margin || 0}`;
      await update(30, "Generating timeline storyboard");
      await runProcess({ command: tools.ffmpegPath, args: ["-y", "-i", sourcePath, "-vf", filter, "-frames:v", "1", "-map_metadata", "-1", "-q:v", "4", outputPath], cancellationRequested: input.cancellationRequested, timeoutMs: 15 * 60 * 1000 });
      const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "storyboard", variantKey: "contact-sheet", fileName: outputPath, mimeType: "image/jpeg", metadataPolicy: "strip_all", recipeKey: storyboardRecipeKey, metadata: { manifest }, ...artifactContext });
      await update(96, "Storyboard ready");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: artifact.id, sizeBytes: artifact.sizeBytes, manifest };
    }

    if (kind === "captions") {
      if (asset.medium !== "video" || !videoStream) throw new Error("MEDIA_CAPTIONS_UNSUPPORTED: caption extraction requires a video review asset.");
      const subtitleStreams = (Array.isArray(probe?.streams) ? probe.streams : []).filter((stream: any) => stream?.codec_type === "subtitle").slice(0, 16);
      await pruneProjectCache(prisma, asset.projectId, Math.max(8 * 1024 * 1024, subtitleStreams.length * 4 * 1024 * 1024));
      const artifacts: any[] = [];
      const failures: Array<{ index: number; error: string }> = [];
      await update(24, subtitleStreams.length ? `Extracting ${subtitleStreams.length} caption track${subtitleStreams.length === 1 ? "" : "s"}` : "No embedded caption tracks found");
      for (let position = 0; position < subtitleStreams.length; position += 1) {
        if (await input.cancellationRequested()) throw new Error("MEDIA_JOB_CANCELLED: media processing was cancelled.");
        const stream = subtitleStreams[position];
        const streamIndex = Number.isInteger(Number(stream.index)) ? Number(stream.index) : position;
        const variantKey = `stream-${streamIndex}`;
        const outputPath = await mediaArtifactFilePath(prisma, asset, "captions_vtt", variantKey, "vtt");
        try {
          const disposition = stream.disposition && typeof stream.disposition === "object" ? stream.disposition : {};
          const captionTrack = {
            id: `stream:${streamIndex}`,
            index: streamIndex,
            label: boundedText(stream.tags?.title, 160) || boundedText(stream.tags?.language, 32) || `Captions ${position + 1}`,
            language: boundedText(stream.tags?.language, 32),
            codec: boundedText(stream.codec_name, 80),
            default: Boolean((disposition as any).default),
            forced: Boolean((disposition as any).forced),
          };
          const captionRecipeKey = recipeKey("captions_vtt", variantKey, { streamIndex, codec: captionTrack.codec });
          let artifact = await reusableArtifact(prisma, {
            reviewAssetId: asset.id, kind: "captions_vtt", variantKey,
            recipeKey: captionRecipeKey, outputPath, mimeType: "text/vtt", metadataPolicy: "strip_all",
            metadata: { captionTrack }, ...artifactContext,
          });
          if (!artifact) {
            await runProcess({ command: tools.ffmpegPath, args: ["-y", "-i", sourcePath, "-map", `0:${streamIndex}`, "-c:s", "webvtt", "-map_metadata", "-1", outputPath], cancellationRequested: input.cancellationRequested, timeoutMs: 15 * 60 * 1000 });
            artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind: "captions_vtt", variantKey, fileName: outputPath, mimeType: "text/vtt", metadataPolicy: "strip_all", recipeKey: captionRecipeKey, metadata: { captionTrack }, ...artifactContext });
          }
          artifacts.push(artifact);
        } catch (error) {
          await fs.rm(outputPath, { force: true }).catch(() => undefined);
          failures.push({ index: streamIndex, error: String(error instanceof Error ? error.message : error).slice(0, 320) });
        }
        await update(24 + ((position + 1) / Math.max(1, subtitleStreams.length)) * 68, `Caption track ${position + 1} of ${subtitleStreams.length}`);
      }
      await update(96, artifacts.length ? `${artifacts.length} caption track${artifacts.length === 1 ? "" : "s"} ready` : "Caption scan complete");
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactIds: artifacts.map((artifact) => artifact.id), failures, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactIds: artifacts.map((artifact) => artifact.id), extractedTracks: artifacts.length, failures };
    }

    if (kind !== "proxy" && kind !== "review_encode") throw new Error(`MEDIA_PROCESSING_JOB_UNIMPLEMENTED: ${kind} reached an unsupported executor path.`);
    if (asset.medium !== "video" || !videoStream) throw new Error("MEDIA_VIDEO_ENCODE_UNSUPPORTED: proxy and review encodes require a video review asset.");
    const variantKey = kind === "proxy" ? "720p-h264" : "1080p-h264";
    const outputPath = await mediaArtifactFilePath(prisma, asset, kind, variantKey, "mp4");
    await pruneProjectCache(prisma, asset.projectId, Math.max(64 * 1024 * 1024, Math.min(asset.sizeBytes || 0, 1536 * 1024 * 1024)));
    const scale = kind === "proxy" ? "scale=-2:'min(720,ih)'" : "scale=-2:'min(1080,ih)'";
    const crf = kind === "proxy" ? "28" : "20";
    const preset = kind === "proxy" ? "veryfast" : "medium";
    const encodeRecipeKey = recipeKey(kind, variantKey, { scale, crf, preset, audioCodec: "aac", audioBitrate: "160k", pixelFormat: "yuv420p" });
    const reused = await reusableArtifact(prisma, {
      reviewAssetId: asset.id, kind, variantKey,
      recipeKey: encodeRecipeKey, outputPath, mimeType: "video/mp4", metadataPolicy: "strip_all",
      metadata: { sourceAssetId: asset.id, profile: kind }, ...artifactContext,
    });
    if (reused) {
      await update(97, `${kind === "proxy" ? "Proxy" : "Review encode"} reused`);
      await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: reused.id, reused: true, completedAt: new Date().toISOString() } });
      await updateAssetProcessingState(prisma, asset.id);
      return { kind, assetId: asset.id, artifactId: reused.id, fileName: path.basename(reused.fileName), sizeBytes: reused.sizeBytes, reused: true };
    }
    const requestedAcceleration = input.accelerationProfile && tools.accelerationProfiles.includes(input.accelerationProfile) ? input.accelerationProfile : "software";
    const encodeArgs = (profile: MediaAccelerationProfile) => {
      const codec = profile === "nvenc" ? ["-c:v", "h264_nvenc", "-preset", kind === "proxy" ? "p4" : "p5", ...(input.nvidiaGpuUuid ? ["-gpu", "0"] : []), "-cq", crf] : profile === "amf" ? ["-c:v", "h264_amf", "-quality", "balanced", "-qp_i", crf, "-qp_p", crf] : profile === "qsv" ? ["-c:v", "h264_qsv", "-global_quality", crf] : profile === "videotoolbox" ? ["-c:v", "h264_videotoolbox", "-q:v", crf] : ["-c:v", "libx264", "-preset", preset, "-crf", crf];
      return ["-y", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "-1", "-vf", scale, ...codec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outputPath];
    };
    await update(20, `${kind === "proxy" ? "Encoding editing proxy" : "Encoding review copy"} · ${requestedAcceleration}`);
    let accelerationUsed = requestedAcceleration;
    try {
      await runProcess({ command: tools.ffmpegPath, args: encodeArgs(requestedAcceleration), durationSeconds, cancellationRequested: input.cancellationRequested, nvidiaGpuUuid: requestedAcceleration === "nvenc" ? input.nvidiaGpuUuid : undefined, onProgress: async (fraction) => update(20 + fraction * 70, `${kind === "proxy" ? "Proxy" : "Review encode"} ${Math.round(fraction * 100)}% · ${requestedAcceleration}`) });
    } catch (error) {
      if (requestedAcceleration === "software" || await input.cancellationRequested()) throw error;
      if (input.deferSoftwareFallback) {
        await fs.rm(outputPath, { force: true }).catch(() => undefined);
        await update(22, `${requestedAcceleration} unavailable; software retry after hardware lease release`);
        return null;
      }
      accelerationUsed = "software";
      await update(22, `${requestedAcceleration} unavailable for this job; retrying with software encoding`);
      await fs.rm(outputPath, { force: true }).catch(() => undefined);
      await runProcess({ command: tools.ffmpegPath, args: encodeArgs("software"), durationSeconds, cancellationRequested: input.cancellationRequested, onProgress: async (fraction) => update(22 + fraction * 68, `${kind === "proxy" ? "Proxy" : "Review encode"} ${Math.round(fraction * 100)}% · software fallback`) });
    }
    const resultProbe = await ffprobeJson(tools, outputPath);
    const resultVideo = Array.isArray(resultProbe.streams) ? resultProbe.streams.find((stream: any) => stream.codec_type === "video") : null;
    const encodeMetadata = {
      profile: kind,
      durationSeconds: Number(resultProbe.format?.duration) || durationSeconds,
      frameRate: parseRate(resultVideo?.avg_frame_rate || resultVideo?.r_frame_rate),
      width: Number(resultVideo?.width) || null,
      height: Number(resultVideo?.height) || null,
      codec: String(resultVideo?.codec_name || "h264"),
      accelerationProfile: accelerationUsed,
      sourceAssetId: asset.id,
    };
    const artifact = await upsertArtifact(prisma, { reviewAssetId: asset.id, kind, variantKey, fileName: outputPath, mimeType: "video/mp4", metadataPolicy: "strip_all", recipeKey: encodeRecipeKey, metadata: { video: encodeMetadata }, ...artifactContext });
    await update(97, `${kind === "proxy" ? "Proxy" : "Review encode"} ready`);
    await updateControl(prisma, payload.controlRecordId, { status: "complete", progress: 100, completedAt: new Date(), payload: { artifactId: artifact.id, completedAt: new Date().toISOString() } });
    await updateAssetProcessingState(prisma, asset.id);
    return { kind, assetId: asset.id, artifactId: artifact.id, fileName: path.basename(artifact.fileName), sizeBytes: artifact.sizeBytes, metadata: encodeMetadata };
  } catch (error) {
    const cancelled = await input.cancellationRequested().catch(() => false);
    const terminal = cancelled || input.attempt >= input.maxAttempts;
    await updateControl(prisma, payload.controlRecordId, { status: cancelled ? "cancelled" : terminal ? "failed" : "retrying", progress: 0, payload: { lastError: String(error instanceof Error ? error.message : error).slice(0, 2000), attempt: input.attempt, retryPending: !terminal } });
    await updateAssetProcessingState(prisma, payload.assetId).catch(() => undefined);
    throw error;
  }
}

export async function mediaWorkerHeartbeat(prisma: PrismaLike, input: { workerId: string; tools: MediaToolStatus; concurrency: number; activeJobs: number; status?: string; selectedAcceleration?: MediaAccelerationProfile; labels?: string[]; lastError?: string | null }) {
  const storage = mediaStorageIdentity();
  const selectedAcceleration = input.selectedAcceleration || selectedMediaAcceleration(input.tools);
  const state = input.status || (input.tools.ready ? (input.activeJobs ? "busy" : "ready") : "degraded");
  const workerMetadata = { capabilities: JSON.stringify(input.tools.capabilities), toolVersions: JSON.stringify(input.tools.toolVersions), resourceBudgets: JSON.stringify(mediaResourceBudgets()) };
  return prisma.mediaWorkerHeartbeat.upsert({
    where: { id: input.workerId },
    update: { hostname: hostname(), pid: process.pid, status: state, ...workerMetadata, labels: JSON.stringify(input.labels || mediaWorkerLabels()), accelerationProfiles: JSON.stringify(input.tools.accelerationProfiles), selectedAcceleration, storageTopology: storage.topology, storageFingerprint: storage.fingerprint, lastError: input.lastError || null, ffmpegVersion: input.tools.ffmpegVersion, ffprobeVersion: input.tools.ffprobeVersion, concurrency: input.concurrency, activeJobs: input.activeJobs, lastSeenAt: new Date() },
    create: { id: input.workerId, hostname: hostname(), pid: process.pid, status: state, ...workerMetadata, labels: JSON.stringify(input.labels || mediaWorkerLabels()), accelerationProfiles: JSON.stringify(input.tools.accelerationProfiles), selectedAcceleration, desiredState: "active", storageTopology: storage.topology, storageFingerprint: storage.fingerprint, lastError: input.lastError || null, ffmpegVersion: input.tools.ffmpegVersion, ffprobeVersion: input.tools.ffprobeVersion, concurrency: input.concurrency, activeJobs: input.activeJobs, startedAt: new Date(), lastSeenAt: new Date() },
  });
}


