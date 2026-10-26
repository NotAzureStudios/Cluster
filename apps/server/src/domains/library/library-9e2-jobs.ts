import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { libraryFolderRelativePath, type ClusterDataLayout } from "../../core/data-layout.js";
import { libraryDisplayTitle, libraryFileExtension, makeLibraryPreviewText } from "../../core/library.js";
import { inspectMediaTools } from "../../core/media-processing.js";
import { runManagedSubprocess } from "../../core/managed-subprocess.js";
import { readLibraryPdfSnapshot } from "../../core/library-pdf-snapshot.js";
import { safeFileName } from "../../core/uploads.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import { BackgroundJobDeferredError } from "../jobs/job-types.js";
import { createLibraryVersionSnapshot } from "./library-governance.js";
import {
  derivativeCachePath,
  libraryDerivativeIdentity,
  libraryDerivativePlan,
  LIBRARY_TRANSFER_CONFLICT_POLICIES,
  sanitizeLibraryRelativePath,
} from "./library-platform-9e2.js";

const finalizePayloadSchema = z.object({
  uploadId: z.string().uuid(), actorId: z.string().min(1).max(200), workspaceId: z.string().max(200).nullable().optional(),
  parentId: z.string().max(200).nullable().optional(), projectId: z.string().max(200).nullable().optional(), ownerId: z.string().max(200).nullable().optional(),
  originalName: z.string().trim().min(1).max(500), relativePath: z.string().max(4000).nullable().optional(), mimeType: z.string().trim().min(1).max(200).default("application/octet-stream"),
  expectedChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(), conflictPolicy: z.enum(LIBRARY_TRANSFER_CONFLICT_POLICIES).default("rename"),
  classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"), tags: z.array(z.string().trim().min(1).max(80)).max(80).default([]),
});
const derivativePayloadSchema = z.object({ itemId: z.string().min(1).max(200), actorId: z.string().min(1).max(200), sourceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i) });

type StoreCompletedUpload = (ownerId: string, isAdmin: boolean, uploadId: string, projectId: string, kind: "review_asset" | "file", originalName: string, clientMime?: string, destinationFolder?: string, reviewMedium?: any) => Promise<{ uploadId: string; storedName: string; fullPath: string | null; storage?: unknown; actualSize: number; detectedMime: string; declaredMime?: string; checksumSha256: string }>;

function isInside(root: string, candidate: string) { const a = path.resolve(root); const b = path.resolve(candidate); return b === a || b.startsWith(`${a}${path.sep}`); }
async function hashFile(filePath: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer); return hash.digest("hex"); }
function parseObject(value: unknown) { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }

async function ensureFolderTree(prisma: any, input: { parentId?: string | null; projectId?: string | null; actorId: string; directories: string[] }) {
  let parentId = input.parentId || null;
  for (const name of input.directories.slice(0, 64)) {
    const title = name.slice(0, 240);
    let folder = await prisma.libraryItem.findFirst({ where: { parentId, projectId: input.projectId || null, type: "folder", title, lifecycleState: { not: "destroyed" }, status: { not: "trashed" } }, select: { id: true } });
    if (!folder) folder = await prisma.libraryItem.create({ data: { parentId, projectId: input.projectId || null, ownerId: input.actorId, creatorId: input.actorId, lastEditorId: input.actorId, title, type: "folder", status: "active", lifecycleState: "active", classification: "internal", visibility: "internal", source: "folder-upload", originKind: "folder-upload", metadata: "{}", changelog: JSON.stringify([{ at: new Date().toISOString(), by: input.actorId, from: null, to: "active", note: "Created by folder-tree upload." }]) }, select: { id: true } });
    parentId = folder.id;
  }
  return parentId;
}
async function uniqueName(prisma: any, parentId: string | null, projectId: string | null, requested: string) {
  const extension = path.extname(requested); const stem = requested.slice(0, requested.length - extension.length) || requested;
  for (let index = 1; index <= 9999; index += 1) { const candidate = index === 1 ? requested : `${stem} (${index})${extension}`; const exists = await prisma.libraryItem.findFirst({ where: { parentId, projectId, originalName: { equals: candidate, mode: "insensitive" }, lifecycleState: { not: "destroyed" }, status: { not: "trashed" } }, select: { id: true } }); if (!exists) return candidate; }
  throw Object.assign(new Error("Unable to allocate a unique Library file name."), { code: "LIBRARY_NAME_EXHAUSTED" });
}
async function runProcess(command: string, args: string[], signal: AbortSignal, timeoutMs = 10 * 60_000) {
  await runManagedSubprocess({ command, args, signal, timeoutMs,
    maxOutputBytes: 64_000, captureStdout: false });
}

async function boundedTextPreview(filePath: string, mimeType: string, extension: string) {
  if (mimeType === "application/pdf" || extension === "pdf") {
    const info = await fs.stat(filePath); if (info.size > 64 * 1024 * 1024) return { text: "", metadata: { skipped: "pdf-too-large", sizeBytes: info.size } };
    try { const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); const data = await readLibraryPdfSnapshot(filePath); const document = await pdfjs.getDocument({ data }).promise; const pages: string[] = []; const pageLimit = Math.min(40, document.numPages); for (let pageNumber = 1; pageNumber <= pageLimit && pages.join("\n").length < 200_000; pageNumber += 1) { const page = await document.getPage(pageNumber); const content = await page.getTextContent(); pages.push(content.items.map((item: any) => typeof item?.str === "string" ? item.str : "").filter(Boolean).join(" ")); } const text = pages.join("\n\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").slice(0, 200_000); return { text, metadata: { pages: document.numPages, extractedPages: pageLimit, bounded: true } }; }
    catch (error) { return { text: "", metadata: { skipped: "pdf-extraction-failed", error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) } }; }
  }
  const handle = await fs.open(filePath, "r"); try { const maximum = 512 * 1024; const buffer = Buffer.alloc(maximum); const { bytesRead } = await handle.read(buffer, 0, maximum, 0); const text = makeLibraryPreviewText(buffer.subarray(0, bytesRead), mimeType, maximum, extension) || ""; return { text: text.slice(0, 200_000), metadata: { bytesRead, bounded: true } }; } finally { await handle.close(); }
}
async function zipManifest(filePath: string) {
  const info = await fs.stat(filePath); const tailLength = Math.min(info.size, 66_000); const handle = await fs.open(filePath, "r");
  try { const tail = Buffer.alloc(tailLength); await handle.read(tail, 0, tailLength, info.size - tailLength); let eocd = -1; for (let i = tail.length - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } if (eocd < 0) return { entries: [], truncated: false, issue: "zip-central-directory-not-found" }; const totalEntries = tail.readUInt16LE(eocd + 10); const directorySize = tail.readUInt32LE(eocd + 12); const directoryOffset = tail.readUInt32LE(eocd + 16); if (directorySize > 16 * 1024 * 1024) return { entries: [], truncated: true, totalEntries, issue: "zip-central-directory-too-large" }; const directory = Buffer.alloc(directorySize); await handle.read(directory, 0, directorySize, directoryOffset); const entries: any[] = []; let offset = 0; while (offset + 46 <= directory.length && entries.length < 5000 && directory.readUInt32LE(offset) === 0x02014b50) { const compressedSize = directory.readUInt32LE(offset + 20); const uncompressedSize = directory.readUInt32LE(offset + 24); const nameLength = directory.readUInt16LE(offset + 28); const extraLength = directory.readUInt16LE(offset + 30); const commentLength = directory.readUInt16LE(offset + 32); const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/[\u0000-\u001f]/g, "").slice(0, 1000); entries.push({ name, compressedSize, uncompressedSize, directory: name.endsWith("/") }); offset += 46 + nameLength + extraLength + commentLength; } return { entries, totalEntries, truncated: entries.length < totalEntries, bounded: true }; }
  finally { await handle.close(); }
}

export function registerLibrary9E2JobHandlers(input: { worker: DurableJobWorker; prisma: any; dataLayout: ClusterDataLayout; storeCompletedUpload: StoreCompletedUpload; consumeUploadSession: (uploadId: string) => Promise<void>; logActivity?: (input: any) => Promise<unknown> }) {
  input.worker.register("library.transfer.finalize", async ({ job, payload, updateProgress, throwIfCancelled, throwIfToolUnavailable, enqueue }) => {
    await throwIfToolUnavailable();
    const parsed = finalizePayloadSchema.parse(payload || {}); await updateProgress(5, "Verifying completed transfer");
    const upload = await input.prisma.uploadSession.findUnique({ where: { id: parsed.uploadId } });
    if (!upload || upload.ownerId !== parsed.actorId || upload.status !== "COMPLETED" || !upload.checksumSha256) throw Object.assign(new Error("Completed upload is unavailable or no longer belongs to this transfer."), { code: "LIBRARY_TRANSFER_UPLOAD_UNAVAILABLE" });
    const checksum = String(upload.checksumSha256).toLowerCase(); if (parsed.expectedChecksumSha256 && checksum !== parsed.expectedChecksumSha256.toLowerCase()) throw Object.assign(new Error("Completed transfer checksum does not match the Library finalize request."), { code: "LIBRARY_TRANSFER_CHECKSUM_MISMATCH" });
    const relative = sanitizeLibraryRelativePath(parsed.relativePath || parsed.originalName); let requestedFileName = safeFileName(relative.fileName || parsed.originalName); const parentId = await ensureFolderTree(input.prisma, { parentId: parsed.parentId, projectId: parsed.projectId, actorId: parsed.actorId, directories: relative.directories });
    await throwIfToolUnavailable(); await updateProgress(18, "Resolving duplicate and version policy");
    let existing = await input.prisma.libraryItem.findFirst({ where: { parentId, projectId: parsed.projectId || null, originalName: { equals: requestedFileName, mode: "insensitive" }, lifecycleState: { not: "destroyed" }, status: { not: "trashed" } } });
    if (parsed.conflictPolicy === "reuse-identical") { const identical = existing?.checksumSha256 === checksum ? existing : await input.prisma.libraryItem.findFirst({ where: { parentId, projectId: parsed.projectId || null, checksumSha256: checksum, lifecycleState: { not: "destroyed" }, status: { not: "trashed" } } }); if (identical) { await input.consumeUploadSession(parsed.uploadId).catch(() => undefined); await updateProgress(100, "Identical Library content already exists"); return { receipt: { transferCompleted: true, postProcessing: "unchanged", reusedExisting: true, itemId: identical.id, checksumSha256: checksum, conflictPolicy: parsed.conflictPolicy } }; } }
    if (existing && parsed.conflictPolicy === "reject") throw Object.assign(new Error("A Library item with this name already exists in the destination folder."), { code: "LIBRARY_TRANSFER_CONFLICT" });
    if (existing && parsed.conflictPolicy === "rename") { requestedFileName = await uniqueName(input.prisma, parentId, parsed.projectId || null, requestedFileName); existing = null; }
    if (existing && parsed.conflictPolicy === "version" && existing.type !== "file") throw Object.assign(new Error("Only Library files can accept replacement versions."), { code: "LIBRARY_TRANSFER_VERSION_TARGET_INVALID" });
    // Last deferrable boundary: after this point the file move and database
    // publication must be allowed to finish together, even if Library turns off.
    await throwIfToolUnavailable(); await updateProgress(35, "Writing verified content to Library storage");
    const folderRelative = await libraryFolderRelativePath(input.prisma, parentId); const destinationFolder = path.join(input.dataLayout.libraryFilesRoot, folderRelative); await fs.mkdir(destinationFolder, { recursive: true });
    const stored = await input.storeCompletedUpload(parsed.actorId, false, parsed.uploadId, parsed.projectId || "__library__", "file", requestedFileName, parsed.mimeType, destinationFolder);
    if (String(stored.checksumSha256).toLowerCase() !== checksum) { if (stored.fullPath) await fs.rm(stored.fullPath, { force: true }).catch(() => undefined); throw Object.assign(new Error("Stored Library content checksum does not match the completed upload."), { code: "LIBRARY_TRANSFER_CHECKSUM_MISMATCH" }); }
    const fileName = stored.fullPath ? path.relative(input.dataLayout.libraryFilesRoot, stored.fullPath) : stored.storedName; const now = new Date(); const extension = libraryFileExtension(requestedFileName); const tags = JSON.stringify(parsed.tags || []);
    let item: any;
    if (existing && parsed.conflictPolicy === "version") {
      // A snapshot and the new current version are one logical operation.
      // A failed update must not leave a ghost historical version behind,
      // and an independently edited file must not be overwritten by a queued
      // transfer using an out-of-date conflict resolution decision.
      item = await input.prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryItem.findUnique({ where: { id: existing.id } });
        if (!current || current.type !== "file" || current.status === "trashed" || current.lifecycleState === "destroyed" || current.revision !== existing.revision) {
          throw Object.assign(new Error("Library version changed before transfer publication."), { code: "LIBRARY_TRANSFER_VERSION_CONFLICT" });
        }
        const metadata = { ...parseObject(current.metadata), transfer: { uploadId: parsed.uploadId, jobId: job.id, verifiedChecksumSha256: checksum } };
        await createLibraryVersionSnapshot(tx, current, { actorId: parsed.actorId, note: "New version from resumable Library transfer." });
        const changed = await tx.libraryItem.updateMany({ where: { id: current.id, revision: current.revision }, data: { ownerId: parsed.ownerId || current.ownerId || parsed.actorId, uploaderId: parsed.actorId, lastEditorId: parsed.actorId, title: libraryDisplayTitle(requestedFileName), originalName: requestedFileName, fileName, mimeType: stored.detectedMime || parsed.mimeType, sizeBytes: stored.actualSize, checksumSha256: checksum, extension, classification: parsed.classification, integrityState: "verified", integrityCheckedAt: now, fileModifiedAt: now, metadata: JSON.stringify(metadata), tags, source: "upload", originKind: "transfer", revision: { increment: 1 } } });
        if (changed.count !== 1) throw Object.assign(new Error("Library version changed during transfer publication."), { code: "LIBRARY_TRANSFER_VERSION_CONFLICT" });
        return tx.libraryItem.findUniqueOrThrow({ where: { id: current.id } });
      }, { isolationLevel: "Serializable" });
    } else {
      item = await input.prisma.libraryItem.create({ data: { projectId: parsed.projectId || null, ownerId: parsed.ownerId || parsed.actorId, parentId, creatorId: parsed.actorId, uploaderId: parsed.actorId, lastEditorId: parsed.actorId, title: libraryDisplayTitle(requestedFileName), type: "file", status: "active", reviewState: "draft", lifecycleState: "active", priority: "medium", tags, visibility: parsed.classification === "public" ? "internal" : "internal", classification: parsed.classification, fileName, originalName: requestedFileName, mimeType: stored.detectedMime || parsed.mimeType, sizeBytes: stored.actualSize, checksumSha256: checksum, extension, integrityState: "verified", integrityCheckedAt: now, source: "upload", originKind: "transfer", originRef: parsed.uploadId, fileModifiedAt: now, metadata: JSON.stringify({ transfer: { uploadId: parsed.uploadId, jobId: job.id, verifiedChecksumSha256: checksum } }), changelog: JSON.stringify([{ at: now.toISOString(), by: parsed.actorId, from: null, to: "active", note: "Created from resumable Library transfer." }]) } });
    }
    await input.consumeUploadSession(parsed.uploadId).catch(() => undefined); await throwIfCancelled(); await updateProgress(82, "Queueing Library post-processing");
    const derivativeJob = await enqueue({ type: "library.derivative.build", queue: "library-derivative", workspaceId: parsed.workspaceId || null, payload: { itemId: item.id, actorId: parsed.actorId, sourceChecksumSha256: checksum }, priority: 10, costUnits: 3, maxAttempts: 4, dedupeKey: `library-derivatives:${item.id}:${checksum}`, createdById: parsed.actorId, authorization: { actorUserId: parsed.actorId, action: "view", resource: { kind: "target", targetKind: "library", targetId: item.id, projectId: item.projectId || null }, minimum: "view", tool: "library" } });
    await input.logActivity?.({ userId: parsed.actorId, projectId: item.projectId, type: "created", entityType: "library", entityId: item.id, title: "Library transfer complete", message: item.title, metadata: { checksumSha256: checksum, derivativeJobId: derivativeJob.id } }).catch(() => undefined);
    await updateProgress(100, "Transfer complete; previews queued"); return { receipt: { transferCompleted: true, postProcessing: "queued", reusedExisting: false, itemId: item.id, checksumSha256: checksum, conflictPolicy: parsed.conflictPolicy, derivativeOperationId: derivativeJob.id } };
  });

  input.worker.register("library.derivative.build", async ({ job, payload, updateProgress, throwIfToolUnavailable, signal }) => {
    await throwIfToolUnavailable();
    const parsed = derivativePayloadSchema.parse(payload || {}); const item = await input.prisma.libraryItem.findUnique({ where: { id: parsed.itemId } }); if (!item || item.type !== "file" || !item.fileName) throw Object.assign(new Error("Library derivative source no longer exists."), { code: "LIBRARY_DERIVATIVE_SOURCE_MISSING" });
    if (String(item.checksumSha256 || "").toLowerCase() !== parsed.sourceChecksumSha256.toLowerCase()) return { stale: true, itemId: item.id, expectedChecksumSha256: parsed.sourceChecksumSha256, currentChecksumSha256: item.checksumSha256 || null };
    const sourcePath = path.resolve(input.dataLayout.libraryFilesRoot, item.fileName); if (!isInside(input.dataLayout.libraryFilesRoot, sourcePath)) throw Object.assign(new Error("Library source path escaped storage root."), { code: "LIBRARY_DERIVATIVE_PATH_INVALID" });
    const sourceInfo = await fs.stat(sourcePath); const sourceChecksum = await hashFile(sourcePath); if (sourceChecksum !== parsed.sourceChecksumSha256.toLowerCase()) throw Object.assign(new Error("Library source bytes no longer match the recorded checksum."), { code: "LIBRARY_DERIVATIVE_SOURCE_CHECKSUM" });
    const extension = String(item.extension || libraryFileExtension(item.originalName || item.title)).toLowerCase(); const kinds = libraryDerivativePlan(item); const tools = await inspectMediaTools().catch(() => null); const results: any[] = [];
    for (let index = 0; index < kinds.length; index += 1) {
      const kind = kinds[index]; await throwIfToolUnavailable(); await updateProgress(Math.max(5, Math.round((index) / Math.max(1, kinds.length) * 88)), `Building ${kind.replaceAll("-", " ")}`);
      const id = libraryDerivativeIdentity({ itemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, kind }); const base = { id, itemId: item.id, kind, variantKey: "default", sourceChecksumSha256: parsed.sourceChecksumSha256, generatedByJobId: job.id };
      let status = "ready"; let mimeType: string | null = "application/json"; let storagePath: string | null = null; let sizeBytes: number | null = null; let contentChecksumSha256: string | null = null; let metadata: Record<string, unknown> = { sourceItemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, generatedAt: new Date().toISOString(), generator: "cluster.library.derivative.v1" };
      try {
        if (kind === "metadata" || kind === "model-metadata") metadata = { ...metadata, originalName: item.originalName || item.title, mimeType: item.mimeType, extension, sizeBytes: sourceInfo.size, model: kind === "model-metadata" ? { probe: "basic", extension } : undefined };
        else if (kind === "text-preview" || kind === "pdf-preview") { const preview = await boundedTextPreview(sourcePath, String(item.mimeType || "application/octet-stream"), extension); const output = derivativeCachePath(input.dataLayout.runtimeRoot, { itemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, kind, extension: "txt" }); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, preview.text, { mode: 0o640 }); storagePath = output; mimeType = "text/plain; charset=utf-8"; sizeBytes = Buffer.byteLength(preview.text); contentChecksumSha256 = await hashFile(output); metadata = { ...metadata, ...preview.metadata, characters: preview.text.length }; if (preview.text && (!item.previewText || kind === "text-preview")) await input.prisma.libraryItem.updateMany({ where: { id: item.id, checksumSha256: parsed.sourceChecksumSha256, revision: item.revision }, data: { previewText: preview.text.slice(0, 250_000) } }); }
        else if (kind === "archive-manifest" && extension === "zip") { const manifest = await zipManifest(sourcePath); const output = derivativeCachePath(input.dataLayout.runtimeRoot, { itemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, kind, extension: "json" }); await fs.mkdir(path.dirname(output), { recursive: true }); const body = JSON.stringify(manifest); await fs.writeFile(output, body, { mode: 0o640 }); storagePath = output; mimeType = "application/json"; sizeBytes = Buffer.byteLength(body); contentChecksumSha256 = await hashFile(output); metadata = { ...metadata, totalEntries: (manifest as any).totalEntries ?? (manifest as any).entries?.length ?? 0, truncated: Boolean((manifest as any).truncated) }; }
        else if (["thumbnail", "poster-frame", "waveform", "album-art"].includes(kind) && tools?.ffmpegVersion) { const outputExt = kind === "waveform" ? "png" : "jpg"; const output = derivativeCachePath(input.dataLayout.runtimeRoot, { itemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, kind, extension: outputExt }); await fs.mkdir(path.dirname(output), { recursive: true }); const args = kind === "waveform" ? ["-y", "-v", "error", "-i", sourcePath, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1600x240", "-frames:v", "1", "-map_metadata", "-1", output] : kind === "album-art" ? ["-y", "-v", "error", "-i", sourcePath, "-map", "0:v:0", "-frames:v", "1", "-map_metadata", "-1", output] : ["-y", "-v", "error", ...(kind === "poster-frame" ? ["-ss", "1"] : []), "-i", sourcePath, "-vf", "scale='min(1280,iw)':-2", "-frames:v", "1", "-map_metadata", "-1", "-q:v", "4", output]; await runProcess(tools.ffmpegPath, args, signal); const info = await fs.stat(output); storagePath = output; mimeType = outputExt === "png" ? "image/png" : "image/jpeg"; sizeBytes = info.size; contentChecksumSha256 = await hashFile(output); metadata = { ...metadata, tool: "ffmpeg", toolVersion: tools.ffmpegVersion }; }
        else { status = "deferred"; metadata = { ...metadata, reason: kind === "archive-manifest" ? "archive-format-not-yet-server-parsed" : kind.startsWith("model-") ? "model-renderer-required" : "derivative-tool-unavailable", rebuildable: true }; }
      } catch (error) {
        // Lease loss, cancellation and disabled tools are control-flow, not
        // failed derivatives. Never persist a synthetic failure for a pause.
        if (signal.aborted || error instanceof BackgroundJobDeferredError) throw error;
        status = "failed"; metadata = { ...metadata, error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), rebuildable: true }; }
      // The derivative may be rebuilt idempotently after re-enable; stop before
      // publishing this result if a different server has disabled Library.
      await throwIfToolUnavailable();
      const currentSource = await input.prisma.libraryItem.findUnique({ where: { id: item.id }, select: { checksumSha256: true, revision: true, lifecycleState: true } });
      if (!currentSource || currentSource.revision !== item.revision || currentSource.lifecycleState === "destroyed" ||
          String(currentSource.checksumSha256 || "").toLowerCase() !== parsed.sourceChecksumSha256.toLowerCase()) {
        return { stale: true, itemId: item.id, expectedChecksumSha256: parsed.sourceChecksumSha256, completedBeforeSourceChange: results };
      }
      const row = await input.prisma.libraryDerivative.upsert({ where: { itemId_kind_variantKey_sourceChecksumSha256: { itemId: item.id, kind, variantKey: "default", sourceChecksumSha256: parsed.sourceChecksumSha256 } }, create: { ...base, status, mimeType, storagePath, sizeBytes, contentChecksumSha256, metadata: JSON.stringify(metadata), builtAt: status === "ready" ? new Date() : null }, update: { status, mimeType, storagePath, sizeBytes, contentChecksumSha256, metadata: JSON.stringify(metadata), generatedByJobId: job.id, builtAt: status === "ready" ? new Date() : null, invalidatedAt: null } }); results.push({ id: row.id, kind, status, mimeType, sizeBytes });
    }
    await updateProgress(100, "Library derivatives complete"); return { itemId: item.id, sourceChecksumSha256: parsed.sourceChecksumSha256, derivatives: results, complete: results.every((entry) => entry.status === "ready"), rebuildable: results.some((entry) => entry.status !== "ready") };
  });
}
