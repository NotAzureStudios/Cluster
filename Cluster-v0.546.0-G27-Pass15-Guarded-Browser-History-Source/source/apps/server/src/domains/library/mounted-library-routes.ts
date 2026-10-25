import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { libraryDisplayTitle, libraryFileExtension } from "../../core/library.js";
import { safeFileName } from "../../core/uploads.js";
import { libraryFolderRelativePath } from "../../core/data-layout.js";
import { createHttpError } from "../../core/http-errors.js";
import { consumeCompletedUpload, copyCompletedUploadToFile, resolveCompletedUpload } from "../uploads/upload-session-runtime.js";
import { createLibraryVersionSnapshot, normalizeLibraryClassification } from "./library-governance.js";
import { scheduleCommittedLibraryStorageRepair } from "./library-storage-scheduling.js";

export function registerMountedLibraryRoutes(deps: { app: FastifyInstance; [key: string]: any }) {
  const {
    app, prisma, requireLibraryTool, readSettings, accessContext, visibleFor, itemInclude, findAccessibleItem,
    rejectMountedWriteWhenLocked, assertValidParent, isManagedLibraryFolder, rejectManagedFolderChange, dataLayout,
    logActivity, clearLibraryContextCache, serializeLibraryItem, storageRuntime, sha256File, jobQueue,
  } = deps;

  app.get("/api/desktop-libraries/mount-manifest", async (request, reply) => {
    const libraryAccess = await requireLibraryTool(request, reply, "view");
    if (!libraryAccess) return;
    const settings = await readSettings();
    if (settings.libraryDesktopMountPolicy === "disabled") return reply.code(403).send({ ok: false, code: "LIBRARY_MOUNT_DISABLED", error: "Mounted Libraries are disabled by this server." });
    const context = await accessContext(request);
    const candidates: any[] = [];
    const manifestBatchSize = 2000;
    const manifestHardLimit = 100000;
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.libraryItem.findMany({
        where: { status: { notIn: ["archived", "trashed"] }, type: { in: ["folder", "file"] } },
        include: itemInclude,
        orderBy: { id: "asc" },
        take: manifestBatchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      candidates.push(...batch);
      if (candidates.length > manifestHardLimit) {
        return reply.code(413).send({ ok: false, code: "LIBRARY_MOUNT_MANIFEST_TOO_LARGE", error: `Mounted Libraries currently supports at most ${manifestHardLimit.toLocaleString()} active file/folder records per server. Archive or split Library content before mounting.` });
      }
      if (batch.length < manifestBatchSize) break;
      cursor = batch[batch.length - 1]?.id;
      if (!cursor) break;
    }
    const accessible = candidates.filter((item: any) => visibleFor(context, item));
    const folders = accessible.filter((item: any) => item.type === "folder");
    const folderById = new Map(folders.map((folder: any) => [folder.id, folder]));
    const safeSegment = (value: string) => safeFileName(value || "Untitled").replace(/[. ]+$/g, "").slice(0, 180) || "Untitled";
    const baseLeafById = new Map<string, string>();
    const siblingGroups = new Map<string, any[]>();
    for (const item of accessible) {
      const leaf = safeSegment(item.type === "file" ? (item.originalName || item.title) : item.title);
      baseLeafById.set(item.id, leaf);
      const key = `${item.parentId || "root"}\0${leaf.toLowerCase()}`;
      const group = siblingGroups.get(key) || [];
      group.push(item);
      siblingGroups.set(key, group);
    }
    const leafById = new Map<string, string>();
    for (const group of siblingGroups.values()) {
      group.sort((left: any, right: any) => String(left.id).localeCompare(String(right.id)));
      for (const item of group) {
        const base = baseLeafById.get(item.id) || "Untitled";
        leafById.set(item.id, group.length > 1 ? `${base} · ${String(item.id).slice(0, 8)}` : base);
      }
    }
    const folderPath = (folderId: string | null | undefined) => {
      const parts: string[] = [];
      const seen = new Set<string>();
      let cursor = folderId || null;
      while (cursor && !seen.has(cursor) && parts.length < 64) {
        seen.add(cursor);
        const folder: any = folderById.get(cursor);
        if (!folder) break;
        parts.unshift(leafById.get(folder.id) || safeSegment(folder.title));
        cursor = folder.parentId || null;
      }
      return parts.join("/");
    };
    const sensitiveOfflineCachePolicy = settings.librarySensitiveOfflineCachePolicy === "protected" ? "protected" : "disabled";
    const entries = accessible.map((item: any) => {
      const parentPath = folderPath(item.parentId);
      const leaf = leafById.get(item.id) || baseLeafById.get(item.id) || "Untitled";
      const relativePath = [parentPath, leaf].filter(Boolean).join("/");
      const classification = normalizeLibraryClassification(item.classification);
      const sensitive = classification === "confidential" || classification === "restricted";
      const offlineCacheMode = item.type === "file" ? (sensitive ? sensitiveOfflineCachePolicy : "standard") : "none";
      return {
        id: item.id,
        parentId: item.parentId,
        kind: item.type,
        relativePath,
        title: item.title,
        originalName: item.originalName,
        mimeType: item.mimeType,
        classification,
        offlineCacheMode,
        sizeBytes: Number(item.sizeBytes || 0),
        checksumSha256: item.checksumSha256,
        revision: Number(item.revision || 0),
        updatedAt: item.updatedAt,
        fileModifiedAt: item.fileModifiedAt,
        readable: true,
        writable: settings.libraryDesktopMountReadOnly !== true && visibleFor(context, item, "contribute"),
        fileUrl: item.fileName && offlineCacheMode !== "disabled" ? `/api/library/${item.id}/file` : null,
      };
    });
    reply.header("Cache-Control", "private, no-store");
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      mountPolicy: settings.libraryDesktopMountPolicy || "user-choice",
      mountIsolation: settings.libraryDesktopMountIsolation || "shared",
      sensitiveOfflineCachePolicy,
      crossServerTransferPolicy: settings.libraryCrossServerTransferPolicy || "disabled",
      readOnly: settings.libraryDesktopMountReadOnly === true,
      entries,
    };
  });

  app.post("/api/desktop-libraries/folders", async (request, reply) => {
    const libraryAccess = await requireLibraryTool(request, reply, "edit");
    if (!libraryAccess) return;
    const { user } = libraryAccess;
    const settings = await readSettings();
    if (settings.libraryDesktopMountPolicy === "disabled" || settings.libraryDesktopMountReadOnly === true) {
      return reply.code(403).send({ ok: false, code: "LIBRARY_MOUNT_READ_ONLY", error: "Mounted Library writes are disabled by this server." });
    }
    const body = z.object({ parentId: z.string().optional().nullable(), title: z.string().trim().min(1).max(240) }).parse(request.body || {});
    if (body.parentId) {
      const parent = await findAccessibleItem(request, reply, body.parentId, "contribute");
      if (!parent) return;
      if (parent.item.type !== "folder") return reply.code(409).send({ ok: false, code: "LIBRARY_PARENT_NOT_FOLDER", error: "Mounted folders can only be created inside a Library folder." });
      if (await rejectMountedWriteWhenLocked(reply, parent.item.id)) return;
    }
    await assertValidParent(null, body.parentId || null);
    const item = await prisma.libraryItem.create({
      data: {
        parentId: body.parentId || null, ownerId: user.id, title: body.title, type: "folder", status: "active", lifecycleState: "active", priority: "medium",
        tags: "[]", visibility: "internal", classification: "internal", source: "desktop-mount", originKind: "desktop-mount", metadata: "{}",
        changelog: JSON.stringify([{ at: new Date().toISOString(), by: user.id, from: null, to: "active", note: "Folder created through mounted Library." }]),
      },
      include: itemInclude,
    });
    const relativeDirectory = await libraryFolderRelativePath(prisma, item.id);
    await fs.mkdir(path.join(dataLayout.libraryFilesRoot, relativeDirectory), { recursive: true });
    await logActivity({ userId: user.id, projectId: item.projectId, type: "created", entityType: "library", entityId: item.id, title: "Mounted Library folder created", message: item.title, metadata: { source: "desktop-mount" } });
    clearLibraryContextCache();
    return { ok: true, item: serializeLibraryItem(item, true) };
  });

  app.patch("/api/desktop-libraries/:itemId/rename", async (request, reply) => {
    const libraryAccess = await requireLibraryTool(request, reply, "edit");
    if (!libraryAccess) return;
    const { user } = libraryAccess;
    const settings = await readSettings();
    if (settings.libraryDesktopMountPolicy === "disabled" || settings.libraryDesktopMountReadOnly === true) {
      return reply.code(403).send({ ok: false, code: "LIBRARY_MOUNT_READ_ONLY", error: "Mounted Library writes are disabled by this server." });
    }
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive(), name: z.string().trim().min(1).max(500) }).parse(request.body || {});
    const accessible = await findAccessibleItem(request, reply, params.itemId, "contribute");
    if (!accessible) return;
    const existing = accessible.item;
    if (await rejectMountedWriteWhenLocked(reply, existing.id)) return;
    if (isManagedLibraryFolder(existing)) return rejectManagedFolderChange(reply);
    if (Number(existing.revision || 0) !== body.expectedRevision) {
      return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "The Library item changed before the mounted rename completed.", currentRevision: Number(existing.revision || 0) });
    }
    const safeName = safeFileName(body.name).replace(/[. ]+$/g, "").slice(0, 500);
    if (!safeName) return reply.code(400).send({ ok: false, code: "INVALID_FILE_NAME", error: "Choose a valid Library name." });
    const data: any = existing.type === "file"
      ? { originalName: safeName, title: libraryDisplayTitle(safeName), extension: libraryFileExtension(safeName), revision: { increment: 1 } }
      : { title: safeName.slice(0, 240), revision: { increment: 1 } };
    const changed = await prisma.libraryItem.updateMany({ where: { id: existing.id, revision: existing.revision }, data });
    if (!changed.count) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "The Library item changed while the mounted rename was being applied." });
    const repair = existing.type === "folder" && existing.title !== safeName
      ? await scheduleCommittedLibraryStorageRepair(jobQueue, user.id, "mounted-folder-rename")
      : null;
    const item = await prisma.libraryItem.findUniqueOrThrow({ where: { id: existing.id }, include: itemInclude });
    await logActivity({ userId: user.id, projectId: item.projectId, type: "updated", entityType: "library", entityId: item.id, title: "Mounted Library item renamed", message: item.title, metadata: { source: "desktop-mount", ...(repair ? { reconciliationQueued: repair.reconciliationQueued, reconciliationJobId: repair.reconciliationJobId } : {}) } });
    clearLibraryContextCache();
    if (repair) reply.code(202);
    return { ok: true, item: serializeLibraryItem(item, true), ...(repair || {}) };
  });

  app.post("/api/desktop-libraries/from-upload", async (request, reply) => {
    const libraryAccess = await requireLibraryTool(request, reply, "edit");
    if (!libraryAccess) return;
    const { user } = libraryAccess;
    const settings = await readSettings();
    if (settings.libraryDesktopMountPolicy === "disabled" || settings.libraryDesktopMountReadOnly === true) return reply.code(403).send({ ok: false, code: "LIBRARY_MOUNT_READ_ONLY", error: "Mounted Library writes are disabled by this server." });
    const body = z.object({
      uploadId: z.string().uuid(),
      itemId: z.string().optional().nullable(),
      parentId: z.string().optional().nullable(),
      originalName: z.string().trim().min(1).max(500),
      mimeType: z.string().trim().min(1).max(200).default("application/octet-stream"),
      expectedRevision: z.number().int().min(0).optional(),
    }).parse(request.body || {});
    const uploadRuntime = { prisma, storageRuntime, dataLayout };
    const upload = await resolveCompletedUpload(uploadRuntime, body.uploadId, user.id, Boolean(user.isAdmin));
    if (!upload) return reply.code(404).send({ ok: false, code: "UPLOAD_NOT_FOUND", error: "Completed upload was not found." });

    let existing: any = null;
    if (body.itemId) {
      const accessible = await findAccessibleItem(request, reply, body.itemId, "contribute");
      if (!accessible) return;
      existing = accessible.item;
      if (existing.type !== "file") return reply.code(409).send({ ok: false, code: "LIBRARY_ITEM_NOT_FILE", error: "Only Library files can be replaced from a mounted Library." });
      if (await rejectMountedWriteWhenLocked(reply, existing.id)) return;
      if (body.expectedRevision !== undefined && Number(existing.revision || 0) !== body.expectedRevision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "The Library file changed on the server before this mounted write completed.", currentRevision: Number(existing.revision || 0) });
    } else if (body.parentId) {
      const parent = await findAccessibleItem(request, reply, body.parentId, "contribute");
      if (!parent) return;
      if (parent.item.type !== "folder") return reply.code(409).send({ ok: false, code: "LIBRARY_PARENT_NOT_FOLDER", error: "Mounted files can only be created inside a Library folder." });
      if (await rejectMountedWriteWhenLocked(reply, parent.item.id)) return;
    }

    const parentId = existing?.parentId || body.parentId || null;
    const relativeDirectory = await libraryFolderRelativePath(prisma, parentId);
    const destinationFolder = path.join(dataLayout.libraryFilesRoot, relativeDirectory);
    await fs.mkdir(destinationFolder, { recursive: true });
    const storedName = `${Date.now()}-${safeFileName(body.originalName)}`;
    const destination = path.join(destinationFolder, storedName);
    await copyCompletedUploadToFile(uploadRuntime, upload, destination);
    const relativeFileName = path.relative(dataLayout.libraryFilesRoot, destination);
    const extension = libraryFileExtension(body.originalName);
    const checksumSha256 = upload.metadata.checksumSha256 || await sha256File(destination);
    const now = new Date();

    let item: any;
    let storageCommitted = false;
    try {
      if (existing) {
        const result = await prisma.$transaction(async (tx: any) => {
          const current = await tx.libraryItem.findUnique({ where: { id: existing.id } });
          if (!current || Number(current.revision || 0) !== Number(existing.revision || 0)) {
            throw createHttpError("REVISION_CONFLICT", "The Library file changed while the mounted write was being finalized.", 409);
          }
          const snapshot = await createLibraryVersionSnapshot(tx, current, { actorId: user.id, note: "Previous version before mounted Library write" });
          const nextNumber = Number(snapshot.versionNumber) + 1;
          const updated = await tx.libraryItem.update({
            where: { id: current.id },
            data: {
              fileName: relativeFileName, originalName: body.originalName, mimeType: body.mimeType, sizeBytes: upload.metadata.totalBytes, checksumSha256, extension,
              fileModifiedAt: now, versionLabel: `v${nextNumber}`, uploaderId: user.id, lastEditorId: user.id, integrityState: "verified", integrityCheckedAt: now,
              originKind: "desktop-mount", originRef: body.uploadId, revision: { increment: 1 },
            },
            include: itemInclude,
          });
          return { updated, versionNumber: nextNumber };
        });
        storageCommitted = true;
        item = result.updated;
      } else {
        item = await prisma.libraryItem.create({
          data: { parentId, ownerId: user.id, title: libraryDisplayTitle(body.originalName), type: "file", status: "active", lifecycleState: "active", priority: "medium", tags: "[]", visibility: "internal", classification: "internal", fileName: relativeFileName, originalName: body.originalName, mimeType: body.mimeType, sizeBytes: upload.metadata.totalBytes, checksumSha256, extension, source: "desktop-mount", originKind: "desktop-mount", originRef: body.uploadId, fileModifiedAt: now, metadata: "{}", changelog: JSON.stringify([{ at: now.toISOString(), by: user.id, from: null, to: "active", note: "File created through mounted Library." }]) },
          include: itemInclude,
        });
        storageCommitted = true;
      }
    } catch (error) {
      if (!storageCommitted) await fs.rm(destination, { force: true }).catch(() => undefined);
      throw error;
    }
    await consumeCompletedUpload(uploadRuntime, body.uploadId).catch(() => undefined);
    // A mounted file is visible as soon as its database write commits.
    // Activity delivery must not cause a false failure or stale cache.
    clearLibraryContextCache();
    try {
      await logActivity({ userId: user.id, projectId: item.projectId, type: existing ? "updated" : "uploaded", entityType: "library", entityId: item.id, title: existing ? "Mounted Library file updated" : "Mounted Library file created", message: item.title, metadata: { source: "desktop-mount", sizeBytes: item.sizeBytes } });
    } catch (error) {
      request.log.warn({ error, itemId: item.id }, "Mounted Library write committed, but Activity projection failed");
    }
    return { ok: true, item: serializeLibraryItem(item, true) };
  });

}
