import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ClusterDataImportApplyEvidence, ClusterResourceKind } from "@cluster/shared";
import type { ClusterDataLayout } from "../../core/data-layout.js";

function safeFileSegment(value: unknown, fallback = "import") {
  return String(value || fallback).normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 140) || fallback;
}

async function importRoot(prisma: any, ownerId: string) {
  const existing = await prisma.libraryItem.findFirst({
    where: { type: "folder", source: "data-import-root", ownerId, status: { notIn: ["archived", "trashed"] } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  const now = new Date();
  return prisma.libraryItem.create({
    data: {
      ownerId,
      creatorId: ownerId,
      lastEditorId: ownerId,
      generatedForUserId: ownerId,
      title: "Data Imports",
      body: "Server-managed import sources and reports owned by this user.",
      type: "folder",
      status: "active",
      priority: "medium",
      tags: JSON.stringify(["imports"]),
      visibility: "private",
      classification: "confidential",
      lifecycleState: "active",
      source: "data-import-root",
      originKind: "generated",
      generatedByKind: "data-import",
      metadata: JSON.stringify({ systemFolder: "data-imports", ownerOnly: true }),
      changelog: JSON.stringify([{ at: now.toISOString(), by: ownerId, from: null, to: "active", note: "Data import folder created." }]),
    },
  });
}

async function writeArtifact(input: {
  prisma: any;
  dataLayout: ClusterDataLayout;
  ownerId: string;
  title: string;
  originalName: string;
  source: "data-import-source" | "data-import-report";
  resourceKind: ClusterResourceKind;
  content: Buffer;
  metadata: Record<string, unknown>;
}) {
  const root = await importRoot(input.prisma, input.ownerId);
  const originalName = safeFileSegment(input.originalName, input.source === "data-import-source" ? "import-source.json" : "import-report.json");
  const relativeDirectory = path.join("Data Imports", input.ownerId);
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
  try {
    const item = await input.prisma.libraryItem.create({
      data: {
        parentId: root.id,
        ownerId: input.ownerId,
        creatorId: input.ownerId,
        uploaderId: input.ownerId,
        lastEditorId: input.ownerId,
        generatedForUserId: input.ownerId,
        title: input.title,
        body: input.source === "data-import-source" ? `Import source for ${input.resourceKind}.` : `Import execution report for ${input.resourceKind}.`,
        type: "file",
        status: "active",
        priority: "medium",
        tags: JSON.stringify(["import", input.resourceKind, input.source === "data-import-source" ? "source" : "report"]),
        visibility: "private",
        classification: "confidential",
        lifecycleState: "active",
        fileName: relativeFileName,
        originalName,
        mimeType: "application/json; charset=utf-8",
        sizeBytes: input.content.length,
        checksumSha256,
        integrityState: "verified",
        integrityCheckedAt: now,
        extension: "json",
        source: input.source,
        originKind: "generated",
        generatedByKind: "data-import",
        generatedById: input.source,
        fileModifiedAt: now,
        metadata: JSON.stringify({ ...input.metadata, ownerOnly: true }),
        changelog: JSON.stringify([{ at: now.toISOString(), by: input.ownerId, from: null, to: "active", note: input.source === "data-import-source" ? "Durable data import source saved." : "Durable data import report generated." }]),
      },
    });
    return {
      libraryItemId: item.id,
      fileName: originalName,
      mimeType: "application/json; charset=utf-8",
      sizeBytes: input.content.length,
      downloadUrl: `/api/library/${item.id}/file?download=1`,
    };
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createDataImportSourceArtifact(input: {
  prisma: any;
  dataLayout: ClusterDataLayout;
  ownerId: string;
  resourceKind: ClusterResourceKind;
  sourceName?: string | null;
  sourceFingerprint: string;
  content: Buffer;
}) {
  const requested = safeFileSegment(input.sourceName || `${input.resourceKind}-import-source.json`, `${input.resourceKind}-import-source.json`).replace(/\.(csv|json|xlsx)$/i, "");
  return writeArtifact({
    prisma: input.prisma,
    dataLayout: input.dataLayout,
    ownerId: input.ownerId,
    title: `${requested} · source`,
    originalName: `${requested}.json`,
    source: "data-import-source",
    resourceKind: input.resourceKind,
    content: input.content,
    metadata: { dataImportSource: { resourceKind: input.resourceKind, sourceFingerprint: input.sourceFingerprint } },
  });
}

export async function createDataImportReportArtifact(input: {
  prisma: any;
  dataLayout: ClusterDataLayout;
  ownerId: string;
  resourceKind: ClusterResourceKind;
  sourceFingerprint: string;
  evidence: ClusterDataImportApplyEvidence;
  report: unknown;
}) {
  const content = Buffer.from(JSON.stringify(input.report, null, 2), "utf8");
  return writeArtifact({
    prisma: input.prisma,
    dataLayout: input.dataLayout,
    ownerId: input.ownerId,
    title: `${input.resourceKind} import report`,
    originalName: `${input.resourceKind}-import-report-${input.sourceFingerprint.slice(0, 12)}.json`,
    source: "data-import-report",
    resourceKind: input.resourceKind,
    content,
    metadata: { dataImport: input.evidence },
  });
}

export async function readDataImportSourceArtifact(input: { prisma: any; dataLayout: ClusterDataLayout; artifactId: string; ownerId: string }) {
  const item = await input.prisma.libraryItem.findFirst({
    where: { id: input.artifactId, ownerId: input.ownerId, source: "data-import-source", type: "file", status: { notIn: ["archived", "trashed"] } },
  });
  if (!item?.fileName) throw Object.assign(new Error("The durable import source artifact is unavailable."), { code: "DATA_IMPORT_SOURCE_MISSING" });
  const absolute = path.resolve(input.dataLayout.libraryFilesRoot, item.fileName);
  const root = path.resolve(input.dataLayout.libraryFilesRoot);
  if (!(absolute === root || absolute.startsWith(`${root}${path.sep}`))) throw Object.assign(new Error("The import source path is invalid."), { code: "DATA_IMPORT_SOURCE_INVALID" });
  const content = await fs.readFile(absolute);
  if (item.checksumSha256) {
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== item.checksumSha256) throw Object.assign(new Error("The import source artifact failed checksum verification."), { code: "DATA_IMPORT_SOURCE_INTEGRITY" });
  }
  return { item, content };
}

export async function discardDataImportSourceArtifact(input: { prisma: any; dataLayout: ClusterDataLayout; artifactId: string; ownerId: string }) {
  const item = await input.prisma.libraryItem.findFirst({
    where: { id: input.artifactId, ownerId: input.ownerId, source: "data-import-source", type: "file" },
    select: { id: true, fileName: true },
  });
  if (!item) return false;
  if (item.fileName) {
    const root = path.resolve(input.dataLayout.libraryFilesRoot);
    const absolute = path.resolve(root, item.fileName);
    if (absolute === root || absolute.startsWith(`${root}${path.sep}`)) await fs.rm(absolute, { force: true }).catch(() => undefined);
  }
  await input.prisma.libraryItem.delete({ where: { id: item.id } }).catch(() => undefined);
  return true;
}
