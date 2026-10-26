import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ClusterDataExportEvidence, ClusterResourceKind } from "@cluster/shared";
import type { ClusterDataLayout } from "../../core/data-layout.js";

function safeFileSegment(value: unknown, fallback = "export") {
  return String(value || fallback).normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 140) || fallback;
}

function exportTitle(fileName: string) {
  return fileName.replace(/\.(csv|json|xlsx)$/i, "").replace(/[-_]+/g, " ").trim() || "Data export";
}

export async function createDataExportLibraryArtifact(input: {
  prisma: any;
  dataLayout: ClusterDataLayout;
  ownerId: string;
  resourceKind: ClusterResourceKind;
  fileName: string;
  mimeType: string;
  content: Buffer;
  evidence: ClusterDataExportEvidence;
}) {
  const ownerId = String(input.ownerId || "").trim();
  if (!ownerId) throw new Error("Data export artifact owner is required.");
  const originalName = safeFileSegment(input.fileName, `data-export.${input.evidence.format}`);
  const extension = originalName.split(".").pop()?.toLowerCase() || input.evidence.format;
  const relativeDirectory = path.join("Data Exports", ownerId);
  const absoluteDirectory = path.join(input.dataLayout.libraryFilesRoot, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${originalName}`;
  const destination = path.join(absoluteDirectory, storedName);
  const temporary = `${destination}.tmp-${randomUUID().slice(0, 8)}`;
  await fs.writeFile(temporary, input.content, { flag: "wx" });
  await fs.rename(temporary, destination);
  const relativeFileName = path.relative(input.dataLayout.libraryFilesRoot, destination);
  const checksumSha256 = createHash("sha256").update(input.content).digest("hex");
  const now = new Date();
  let root: any = null;
  try {
    root = await input.prisma.libraryItem.findFirst({
      where: { type: "folder", source: "data-export-root", ownerId, status: { notIn: ["archived", "trashed"] } },
      orderBy: { createdAt: "asc" },
    });
    if (!root) {
      root = await input.prisma.libraryItem.create({
        data: {
          ownerId,
          creatorId: ownerId,
          lastEditorId: ownerId,
          generatedForUserId: ownerId,
          title: "Data Exports",
          body: "Server-generated exports owned by this user.",
          type: "folder",
          status: "active",
          priority: "medium",
          tags: JSON.stringify(["exports"]),
          visibility: "private",
          classification: "confidential",
          lifecycleState: "active",
          source: "data-export-root",
          originKind: "generated",
          generatedByKind: "data-export",
          metadata: JSON.stringify({ systemFolder: "data-exports", ownerOnly: true }),
          changelog: JSON.stringify([{ at: now.toISOString(), by: ownerId, from: null, to: "active", note: "Data export folder created." }]),
        },
      });
    }
    const item = await input.prisma.libraryItem.create({
      data: {
        parentId: root.id,
        ownerId,
        creatorId: ownerId,
        uploaderId: ownerId,
        lastEditorId: ownerId,
        generatedForUserId: ownerId,
        title: exportTitle(originalName),
        body: `Generated ${input.evidence.format.toUpperCase()} export for ${input.resourceKind}.`,
        type: "file",
        status: "active",
        priority: "medium",
        tags: JSON.stringify(["export", input.resourceKind, input.evidence.format]),
        visibility: "private",
        classification: "confidential",
        lifecycleState: "active",
        fileName: relativeFileName,
        originalName,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
        checksumSha256,
        integrityState: "verified",
        integrityCheckedAt: now,
        extension,
        source: "data-export",
        originKind: "generated",
        generatedByKind: "data-export",
        generatedById: null,
        fileModifiedAt: now,
        metadata: JSON.stringify({ dataExport: input.evidence, ownerOnly: true }),
        changelog: JSON.stringify([{ at: now.toISOString(), by: ownerId, from: null, to: "active", note: "Background data export generated." }]),
      },
    });
    return {
      libraryItemId: item.id,
      fileName: originalName,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
      downloadUrl: `/api/library/${item.id}/file?download=1`,
      evidence: input.evidence,
    };
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}
