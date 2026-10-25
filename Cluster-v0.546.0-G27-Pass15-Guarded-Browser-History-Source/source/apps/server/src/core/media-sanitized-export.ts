import type { MetadataExportSelection, ReviewMedium } from "@cluster/shared";
import { writeSanitizedPdfDerivative } from "./pdf-sanitized-export.js";

type CancellationCheck = (() => Promise<boolean>) & { signal?: AbortSignal };
type ProcessRunner = (input: {
  command: string;
  args: string[];
  cancellationRequested: CancellationCheck;
  timeoutMs?: number;
}) => Promise<unknown>;

export function normalizedMetadataExportSelection(value: unknown): MetadataExportSelection {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const raw = payload.metadataExportSelection;
  const selection = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Partial<MetadataExportSelection> : null;
  if (!selection || !["safe_share", "strip_all", "custom"].includes(String(selection.policy))) return { policy: "safe_share", preserveTechnicalRenderingMetadata: true };
  return {
    policy: selection.policy as MetadataExportSelection["policy"],
    preserveTechnicalRenderingMetadata: selection.preserveTechnicalRenderingMetadata !== false,
    includeCategories: Array.isArray(selection.includeCategories) ? selection.includeCategories.map(String).filter(Boolean).slice(0, 64) : undefined,
    excludeSensitiveCategories: Array.isArray(selection.excludeSensitiveCategories) ? selection.excludeSensitiveCategories.slice(0, 16) : undefined,
  };
}

export function sanitizedExportExtension(asset: { medium?: string; originalName?: string }) {
  const extension = String(asset.originalName || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
  const allowed: Record<string, Set<string>> = {
    video: new Set(["mp4", "mov", "m4v", "mkv", "webm", "mxf", "avi"]),
    audio: new Set(["wav", "wave", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aif", "aiff"]),
    image: new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"]),
    pdf: new Set(["pdf"]),
  };
  return allowed[String(asset.medium || "")]?.has(extension) ? extension : asset.medium === "pdf" ? "pdf" : asset.medium === "image" ? "png" : asset.medium === "audio" ? "m4a" : "mp4";
}

export async function writeSanitizedMediaDerivative(input: {
  medium: ReviewMedium;
  sourcePath: string;
  outputPath: string;
  ffmpegPath: string;
  cancellationRequested: CancellationCheck;
  runProcess: ProcessRunner;
}) {
  if (input.medium === "pdf") {
    const rewrite = await writeSanitizedPdfDerivative({ sourcePath: input.sourcePath, outputPath: input.outputPath });
    return { mimeType: "application/pdf", rewritten: true, streamCopied: false, rewrite };
  }
  if (!["video", "audio", "image"].includes(input.medium)) throw new Error(`MEDIA_SANITIZED_EXPORT_UNSUPPORTED: ${input.medium} does not have a sanitizer executor.`);
  const image = input.medium === "image";
  const args = image
    ? ["-y", "-i", input.sourcePath, "-map", "0", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", input.outputPath]
    : ["-y", "-i", input.sourcePath, "-map", "0", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-c", "copy", input.outputPath];
  await input.runProcess({ command: input.ffmpegPath, args, cancellationRequested: input.cancellationRequested, timeoutMs: 60 * 60 * 1000 });
  return { mimeType: null, rewritten: image, streamCopied: !image, rewrite: null };
}
