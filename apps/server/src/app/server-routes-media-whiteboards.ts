import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { REVIEW_MEDIA } from "@cluster/shared";
import { copyrightDisabledResponse, isCopyrightResourceDisabled } from "../core/copyright-workflow.js";
import { mediaLimits, mediaStorageIdentity, resolveMediaProcessingPolicy } from "../core/media-processing.js";
import { registerMediaOperationsRoutes } from "../domains/media/media-operations-routes.js";
import { registerReviewAssetRoutes } from "../domains/media/review-routes.js";
import { summarizeProjectMediaPayload } from "../domains/media/media-payload-summary.js";
import { projectFileViewableResource } from "../domains/media/viewable-resource.js";
import { sendStorageResource, sendStoredResource } from "../domains/media/resource-delivery.js";
import { serializeProjectAsset } from "../domains/projects/project-asset-routes.js";
import { finalizeProjectAssetRecord } from "../domains/projects/project-asset-finalization.js";
import { registerEntityCommentRoutes } from "../domains/comments/entity-comment-routes.js";
import { registerSharedWorkRoutes } from "../domains/comments/shared-work-routes.js";
import { createEntityCommentAccess } from "../domains/comments/entity-comment-access.js";
import { registerWhiteboardOperationRoutes } from "../domains/collaboration/whiteboard-operation-routes.js";

import { buildCursorPage, cursorWhere, decodeCursor } from "../core/cursor-pagination.js";
import { sendPrivateRevalidated } from "../core/http-cache.js";

import type { ServerRouteRegistrationDeps } from "./server-composition-types.js";

export function registerMediaWhiteboardRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    AUTH_REQUIRED,
    collaborationRuntime,
    decorateUserForClient,
    authorization,
    enforceCardAccess,
    enforceTargetAccess,
    getCurrentUser,
    hasTargetAccess,
    logActivity,
    prisma,
    resolveProjectStoredFile,
    storageRuntime,
      discardStoredProjectFile,
    discardPreparedManagedBlob,
    projectFileStorageLocator,
    sendRevisionConflict,
    serializeReviewAsset,
    serializeWhiteboard,
    storeCompletedUpload,
    consumeUploadSession
  } = deps;
  const VIDEO_PRODUCTION_KINDS = ["episode", "sequence", "scene", "shot", "take", "review_session", "deliverable", "media_job"] as const;
  const VIDEO_PRODUCTION_TEMPLATES: Record<string, Array<{ kind: "episode" | "sequence" | "scene" | "shot" | "deliverable"; title: string; status?: string; payload?: Record<string, unknown> }>> = {
    youtube: [{ kind: "sequence", title: "Editorial" }, { kind: "shot", title: "Primary edit" }, { kind: "shot", title: "Thumbnail / graphics" }, { kind: "deliverable", title: "YouTube master", payload: { format: "1920x1080 · H.264" } }],
    commercial: [{ kind: "sequence", title: "Editorial" }, { kind: "sequence", title: "VFX / finishing" }, { kind: "sequence", title: "Color / audio" }, { kind: "deliverable", title: "Client master", payload: { format: "Master specification" } }],
    short_film: [{ kind: "episode", title: "Film" }, { kind: "sequence", title: "Picture edit" }, { kind: "sequence", title: "Post-production" }, { kind: "deliverable", title: "Archive master", payload: { format: "High-quality master" } }],
    social_campaign: [{ kind: "sequence", title: "Campaign edit" }, { kind: "deliverable", title: "16:9 master", payload: { format: "1920x1080" } }, { kind: "deliverable", title: "9:16 vertical", payload: { format: "1080x1920" } }, { kind: "deliverable", title: "1:1 square", payload: { format: "1080x1080" } }],
  };

  registerMediaOperationsRoutes(deps);

  const parseObject = (value: unknown): Record<string, any> => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
    try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  };
  const parseArray = (value: unknown): any[] => {
    if (Array.isArray(value)) return value;
    try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  };

  app.get("/api/projects/:projectId/media", async (request) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const videos = await prisma.reviewAsset.findMany({
      where: { projectId: params.projectId },
      include: {
        comments: {
          orderBy: { createdAt: "asc" },
          include: { user: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const files = await prisma.projectFile.findMany({
      where: { projectId: params.projectId, archived: false },
      orderBy: { updatedAt: "desc" },
    });
    const productionRecords = await prisma.projectControlRecord.findMany({
      where: { projectId: params.projectId, archived: false, kind: { in: [...VIDEO_PRODUCTION_KINDS] } },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: 2000,
    });
    const workerCutoff = new Date(Date.now() - 45_000);
    const workers = await prisma.mediaWorkerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 24 });
    const projectAccess = await prisma.project.findUnique({ where: { id: params.projectId } });
    const aclVideos = projectAccess ? await authorization.filterTargetsForRequest(request, videos, "review_asset", projectAccess, "view") : [];
    const aclFiles = projectAccess ? await authorization.filterTargetsForRequest(request, files, "file", projectAccess, "view") : [];
    const restrictions = await prisma.copyrightResourceRestriction.findMany({
      where: { state: "disabled", OR: [
        { resourceType: "review_asset", resourceId: { in: aclVideos.map((item: any) => item.id) } },
        { resourceType: "project_file", resourceId: { in: aclFiles.map((item: any) => item.id) } },
      ] },
      select: { resourceType: true, resourceId: true },
    });
    const blocked = new Set(restrictions.map((item: any) => `${item.resourceType}:${item.resourceId}`));
    const visibleVideoRows = aclVideos.filter((item: any) => !blocked.has(`review_asset:${item.id}`));
    const visibleVideos = visibleVideoRows.map(serializeReviewAsset);
    const visibleVideoIds = visibleVideos.map((video: any) => video.id);
    const artifacts = visibleVideoIds.length ? await prisma.assetArtifact.findMany({ where: { reviewAssetId: { in: visibleVideoIds } }, orderBy: { updatedAt: "desc" }, take: 4000 }) : [];
    const parsePayload = (value: unknown) => { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
    const records = productionRecords.map((record: any) => ({ ...record, payload: parsePayload(record.payload) }));
    const project = await prisma.project.findUnique({ where: { id: params.projectId }, select: { projectType: true } });
    const roles = ["source", "proxy", "review", "master", "reference"] as const;
    const policies = project ? await Promise.all(REVIEW_MEDIA.flatMap((medium) => roles.map(async (role) => ({ ...(await resolveMediaProcessingPolicy(prisma, project.projectType, medium, role)), assetRole: role })))) : [];
    const limits = mediaLimits();
    const storageIdentity = mediaStorageIdentity();
    const assetBytes = visibleVideoRows.reduce((sum: number, asset: any) => sum + Number(asset.sizeBytes || 0), 0);
    const artifactBytes = artifacts.reduce((sum: number, artifact: any) => sum + Number(artifact.sizeBytes || 0), 0);
    const mismatchedWorkerIds = workers.filter((worker: any) => worker.storageTopology === "remote" || (worker.storageFingerprint && worker.storageFingerprint !== storageIdentity.fingerprint)).map((worker: any) => worker.id);
    const mediaSummary = summarizeProjectMediaPayload(records, visibleVideos);
    return {
      reviewAssets: visibleVideos,
      files: aclFiles.filter((item: any) => !blocked.has(`project_file:${item.id}`)).map((item: any) => serializeProjectAsset(item)),
      production: {
        records,
        summary: mediaSummary.production,
      },
      mediaProcessing: {
        workers: workers.map((worker: any) => ({ id: worker.id, hostname: worker.hostname, status: worker.lastSeenAt >= workerCutoff ? worker.status : "offline", online: worker.lastSeenAt >= workerCutoff, desiredState: worker.desiredState, concurrency: worker.concurrency, activeJobs: worker.activeJobs, capabilities: parseArray(worker.capabilities), labels: parseArray(worker.labels), accelerationProfiles: parseArray(worker.accelerationProfiles), selectedAcceleration: worker.selectedAcceleration, storageTopology: worker.storageTopology, storageFingerprint: worker.storageFingerprint, ffmpegVersion: worker.ffmpegVersion, ffprobeVersion: worker.ffprobeVersion, toolVersions: parseObject(worker.toolVersions), resourceBudgets: parseObject(worker.resourceBudgets), startedAt: worker.startedAt, lastSeenAt: worker.lastSeenAt })),
        artifacts: artifacts.map((artifact: any) => ({ id: artifact.id, reviewAssetId: artifact.reviewAssetId, kind: artifact.kind, variantKey: artifact.variantKey, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, checksumSha256: artifact.checksumSha256, sourceChecksumSha256: artifact.sourceChecksumSha256, generatedByJobId: artifact.generatedByJobId, metadataPolicy: artifact.metadataPolicy, toolchain: parsePayload(artifact.toolchain), metadata: parsePayload(artifact.metadata), generatedAt: artifact.derivativeGeneratedAt, updatedAt: artifact.updatedAt, url: `/api/review-assets/${artifact.reviewAssetId}/processing-artifacts/${artifact.kind}?variant=${encodeURIComponent(artifact.variantKey || "default")}` })),
        queue: mediaSummary.queue,
        policies,
        storage: { assetBytes, artifactBytes, usedBytes: assetBytes + artifactBytes, projectLimitBytes: limits.projectBytes, cacheLimitBytes: limits.cacheBytes, resourceBudgets: limits.resources, topology: storageIdentity.topology, fingerprint: storageIdentity.fingerprint, mismatchedWorkerIds },
      },
    };
  });

  app.post("/api/projects/:projectId/video-production/records", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const body = z.object({
      kind: z.enum(VIDEO_PRODUCTION_KINDS), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).optional().nullable(), status: z.string().trim().min(1).max(48).default("planned"),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), ownerId: z.string().optional().nullable(), parentId: z.string().optional().nullable(), category: z.string().trim().max(80).optional().nullable(),
      startDate: z.string().optional().nullable(), dueDate: z.string().optional().nullable(), progress: z.number().int().min(0).max(100).default(0), sortOrder: z.number().int().min(0).max(100000).default(0), payload: z.record(z.unknown()).optional(),
    }).parse(request.body);
    if (body.parentId) {
      const parent = await prisma.projectControlRecord.findFirst({ where: { id: body.parentId, projectId: project.id, archived: false, kind: { in: [...VIDEO_PRODUCTION_KINDS] } }, select: { id: true } });
      if (!parent) return reply.code(400).send({ code: "VIDEO_PRODUCTION_PARENT_INVALID", message: "The selected parent does not belong to this production." });
    }
    const record = await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: body.kind, title: body.title, description: body.description || null, status: body.status, priority: body.priority, ownerId: body.ownerId || null, parentId: body.parentId || null, category: body.category || null, startDate: body.startDate ? new Date(body.startDate) : null, dueDate: body.dueDate ? new Date(body.dueDate) : null, progress: body.progress, sortOrder: body.sortOrder, payload: JSON.stringify(body.payload || {}) } });
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: body.kind, entityId: record.id, title: `${body.kind.replace(/_/g, " ")} created`, message: record.title });
    return { ...record, payload: body.payload || {} };
  });

  app.patch("/api/projects/:projectId/video-production/records/:recordId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const existing = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: project.id, archived: false, kind: { in: [...VIDEO_PRODUCTION_KINDS] } } });
    if (!existing) return reply.code(404).send({ code: "VIDEO_PRODUCTION_RECORD_NOT_FOUND", message: "Production record not found." });
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(4000).optional().nullable(), status: z.string().trim().min(1).max(48).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional(), ownerId: z.string().optional().nullable(), parentId: z.string().optional().nullable(), category: z.string().trim().max(80).optional().nullable(), startDate: z.string().optional().nullable(), dueDate: z.string().optional().nullable(), progress: z.number().int().min(0).max(100).optional(), sortOrder: z.number().int().min(0).max(100000).optional(), payload: z.record(z.unknown()).optional(), archived: z.boolean().optional() }).parse(request.body);
    if (body.parentId) { const parent = await prisma.projectControlRecord.findFirst({ where: { id: body.parentId, projectId: project.id, archived: false, kind: { in: [...VIDEO_PRODUCTION_KINDS] } }, select: { id: true } }); if (!parent || parent.id === existing.id) return reply.code(400).send({ code: "VIDEO_PRODUCTION_PARENT_INVALID", message: "The selected parent is invalid." }); }
    const data: any = { ...body, revision: { increment: 1 } };
    if (body.description !== undefined) data.description = body.description || null; if (body.ownerId !== undefined) data.ownerId = body.ownerId || null; if (body.parentId !== undefined) data.parentId = body.parentId || null; if (body.category !== undefined) data.category = body.category || null;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null; if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null; if (body.payload !== undefined) data.payload = JSON.stringify(body.payload || {});
    const record = await prisma.projectControlRecord.update({ where: { id: existing.id }, data });
    await logActivity({ userId: user?.id, projectId: project.id, type: body.archived ? "archived" : "updated", entityType: existing.kind, entityId: existing.id, title: `${existing.kind.replace(/_/g, " ")} updated`, message: record.title });
    let payload: Record<string, unknown> = {}; try { payload = JSON.parse(record.payload || "{}"); } catch {}
    return { ...record, payload };
  });

  app.post("/api/projects/:projectId/video-production/apply-template", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ template: z.enum(["youtube", "commercial", "short_film", "social_campaign"]) }).parse(request.body || {});
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const template = VIDEO_PRODUCTION_TEMPLATES[body.template];
    const created = [];
    for (let index = 0; index < template.length; index += 1) {
      const item = template[index];
      created.push(await prisma.projectControlRecord.create({ data: { projectId: project.id, kind: item.kind, title: item.title, status: item.status || "planned", priority: "medium", sortOrder: index * 100, category: `template:${body.template}`, payload: JSON.stringify({ ...(item.payload || {}), template: body.template }) } }));
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: "created", entityType: "video_production_template", entityId: project.id, title: "Video production template applied", message: `${body.template.replace(/_/g, " ")} · ${created.length} production records` });
    return { ok: true, template: body.template, created: created.map((record: any) => ({ id: record.id, kind: record.kind, title: record.title })) };
  });

  registerReviewAssetRoutes(deps, { parseObject, parseArray });

  app.get("/api/projects/:projectId/files", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "library", "view"))) return;
    const files = await prisma.projectFile.findMany({
      where: { projectId: params.projectId, archived: false },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const visibleFiles = await authorization.filterTargetsForRequest(request, files, "file", project, "view");
    const restrictions = await prisma.copyrightResourceRestriction.findMany({
      where: { state: "disabled", resourceType: "project_file", resourceId: { in: visibleFiles.map((item: any) => item.id) } },
      select: { resourceId: true },
    });
    const blocked = new Set(restrictions.map((item: any) => item.resourceId));
    return visibleFiles.filter((item: any) => !blocked.has(item.id)).map((item: any) => serializeProjectAsset(item));
  });

  app.post("/api/projects/:projectId/files", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "library", "contribute"))) return;
    const body = z
      .object({
        title: z.string().min(1),
        description: z.string().optional().nullable(), originalName: z.string().min(1),
        mimeType: z.string().min(1).default("application/octet-stream"), sizeBytes: z.number().int().nonnegative().optional(),
        category: z.string().trim().min(1).max(80).default("shared"),
        assetRole: z.enum(["source", "derived", "proxy", "export", "reference", "deliverable"]).default("source"),
        status: z.enum(["active", "review", "approved", "superseded", "archived"]).default("active"),
        tags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
        versionGroupId: z.string().nullable().optional(), versionNumber: z.number().int().positive().default(1),
        versionLabel: z.string().trim().max(80).nullable().optional(), derivedFromId: z.string().nullable().optional(),
        proxyOfId: z.string().nullable().optional(), exportOfId: z.string().nullable().optional(),
        duplicatePolicy: z.enum(["keep", "reuse", "reject"]).default("keep"),
        uploadId: z.string().uuid(),
      })
      .parse(request.body);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const existingByUpload = await prisma.projectFile.findUnique({ where: { ingestSessionId: body.uploadId } });
    if (existingByUpload) {
      if (existingByUpload.projectId !== params.projectId || (existingByUpload.uploadedById && existingByUpload.uploadedById !== user.id && !user.isAdmin)) return reply.code(403).send({ code: "UPLOAD_ACCESS_DENIED", message: "This upload belongs to another scope." });
      return { ...serializeProjectAsset(existingByUpload), finalizedReplay: true };
    }
    const referencedAssetIds = [body.versionGroupId, body.derivedFromId, body.proxyOfId, body.exportOfId].filter(Boolean) as string[];
    if (referencedAssetIds.length) {
      const ids = [...new Set(referencedAssetIds)];
      const validAssets = await prisma.projectFile.count({ where: { projectId: params.projectId, id: { in: ids } } });
      if (validAssets !== ids.length) return reply.code(400).send({ code: "ASSET_LINEAGE_INVALID", message: "Lineage targets must belong to this project." });
    }
    const stored = await storeCompletedUpload(user.id, Boolean(user.isAdmin), body.uploadId, params.projectId, "file", body.originalName, body.mimeType);
    let finalized: Awaited<ReturnType<typeof finalizeProjectAssetRecord>>;
    try {
      finalized = await finalizeProjectAssetRecord(prisma, {
        projectId: params.projectId, title: body.title, description: body.description || null, category: body.category, assetRole: body.assetRole, status: body.status, tags: body.tags,
        versionGroupId: body.versionGroupId || null, versionLabel: body.versionLabel || null, derivedFromId: body.derivedFromId || null, proxyOfId: body.proxyOfId || null, exportOfId: body.exportOfId || null,
        duplicatePolicy: body.duplicatePolicy, checksumSha256: stored.checksumSha256, fileName: stored.storedName, originalName: body.originalName, mimeType: stored.detectedMime, sizeBytes: stored.actualSize, uploadedById: user.id, ingestSessionId: body.uploadId,
        metadata: {},
        managedBlob: stored.managedBlob ? {
          workspaceId: stored.managedBlob.workspaceId,
          storageProvider: stored.managedBlob.storageProvider,
          storageTier: stored.managedBlob.storageTier,
          storageKey: stored.managedBlob.storageKey,
          reused: Boolean(stored.managedBlob.reused),
        } : null,
      });
    } catch (error) {
      if (stored.managedBlob && stored.storage) {
        await discardPreparedManagedBlob({
          workspaceId: stored.managedBlob.workspaceId,
          checksumSha256: stored.checksumSha256,
          storage: stored.storage,
        }).catch(() => undefined);
      } else if (stored.storage) {
        await discardStoredProjectFile(stored.storage).catch(() => undefined);
      }
      if (stored.fullPath) await fs.rm(stored.fullPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (finalized.duplicateReused || finalized.duplicateRejected || finalized.idempotentReplay) {
      if (stored.managedBlob && stored.storage) {
        await discardPreparedManagedBlob({
          workspaceId: stored.managedBlob.workspaceId,
          checksumSha256: stored.checksumSha256,
          storage: stored.storage,
        }).catch(() => undefined);
      } else if (stored.storage) {
        await discardStoredProjectFile(stored.storage).catch(() => undefined);
      }
      if (stored.fullPath) await fs.rm(stored.fullPath, { force: true }).catch(() => undefined);
    }
    await consumeUploadSession(body.uploadId).catch(() => undefined);
    if (finalized.duplicateRejected) return reply.code(409).send({ code: "DUPLICATE_ASSET", message: "This exact file already exists in the project.", duplicate: serializeProjectAsset(finalized.file) });
    if (finalized.duplicateReused) return { ...serializeProjectAsset(finalized.file), duplicateReused: true };
    await logActivity({ userId: user?.id, projectId: params.projectId, type: "uploaded", entityType: "file", entityId: finalized.file.id, title: "File uploaded", message: finalized.file.title });
    return serializeProjectAsset(finalized.file);
  });

  app.get("/api/project-files/:fileId/file", async (request, reply) => {
    const params = z.object({ fileId: z.string() }).parse(request.params);
    const file = await prisma.projectFile.findUnique({
      where: { id: params.fileId },
      include: { project: { include: { memberships: { where: { status: "active" } } } }, managedBlob: true },
    });
    if (!file) return reply.code(404).send({ code: "PROJECT_FILE_NOT_FOUND", message: "Project file not found." });
    if (!(await authorization.requireTarget(request, reply, "file", file.id, file.project, "view"))) return;
    if (await isCopyrightResourceDisabled(prisma, "project_file", file.id)) return copyrightDisabledResponse(reply);
    const query = z.object({ inline: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).optional().default(false) }).parse(request.query || {});
    const locator = projectFileStorageLocator(file);
    if (locator) {
      const managed = await storageRuntime.stat(locator).catch(() => null);
      if (managed && managed.size === Number(file.sizeBytes || 0)) return sendStorageResource(request, reply, {
        storage: storageRuntime, locator, mimeType: file.mimeType || "application/octet-stream", originalName: file.originalName,
        checksumSha256: file.checksumSha256, requestedInline: query.inline, cacheControl: "private, max-age=0, must-revalidate",
      });
    }
    const fullPath = await resolveProjectStoredFile(file.projectId, "file", file.fileName);
    return sendStoredResource(request, reply, { filePath: fullPath, mimeType: file.mimeType || "application/octet-stream", originalName: file.originalName, checksumSha256: file.checksumSha256, requestedInline: query.inline, cacheControl: "private, max-age=0, must-revalidate" });
  });

  app.get("/api/project-files/:fileId/viewable-resource", async (request, reply) => {
    const params = z.object({ fileId: z.string() }).parse(request.params);
    const file = await prisma.projectFile.findUnique({ where: { id: params.fileId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, managedBlob: true } });
    if (!file) return reply.code(404).send({ code: "PROJECT_FILE_NOT_FOUND", message: "Project file not found." });
    if (!(await authorization.requireTarget(request, reply, "file", file.id, file.project, "view"))) return;
    if (await isCopyrightResourceDisabled(prisma, "project_file", file.id)) return copyrightDisabledResponse(reply);
    const resource = projectFileViewableResource(file);
    if (!resource) return reply.code(415).send({ code: "RESOURCE_NOT_VIEWABLE", message: "This project file does not have a registered viewer format." });
    return { resource };
  });

  app.get("/api/whiteboards", async (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(250).optional().default(100),
      cursor: z.string().max(500).optional(),
      paged: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).optional().default(false),
      projectId: z.string().min(1).optional(),
    }).parse(request.query || {});
    const cursor = decodeCursor(query.cursor);
    const whiteboards = await prisma.whiteboard.findMany({
      where: { ...cursorWhere(cursor, "updatedAt", "desc"), ...(query.projectId ? { projectId: query.projectId } : {}) },
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        canvasWidth: true,
        canvasHeight: true,
        operationSequence: true,
        updatedAt: true,
        revision: true,
        project: {
          select: {
            id: true,
            source: true,
            memberships: {
              where: { status: "active" },
              select: { userId: true, accessLevel: true, isLead: true, status: true },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(query.limit * 3 + 1, 751),
    });
    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;
    const rules = user && !decorated?.isAdmin ? ((await (prisma as any).accessRule?.findMany?.({
      where: { status: "active" },
      select: { targetKind: true, targetId: true, projectId: true, subjectKind: true, subjectId: true, subjectName: true, effect: true, level: true, status: true, expiresAt: true },
    }).catch(() => [])) || []) : [];
    const visible = !user || !AUTH_REQUIRED || decorated?.isAdmin
      ? whiteboards
      : whiteboards.filter((item: any) => !item.project || hasTargetAccess(user, decorated?.workspaceRole, "whiteboard", item.id, item.project, rules, "view"));
    const page = buildCursorPage(visible, query.limit, "updatedAt");
    const items = page.items.map(({ project: _project, ...summary }: any) => summary);
    if (!query.paged && !query.cursor) {
      if (page.nextCursor) reply.header("X-Next-Cursor", page.nextCursor);
      return sendPrivateRevalidated(request, reply, items);
    }
    return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
  });

  app.get("/api/whiteboards/:whiteboardId", async (request, reply) => {
    const params = z.object({ whiteboardId: z.string() }).parse(request.params);
    const whiteboard = await prisma.whiteboard.findUniqueOrThrow({
      where: { id: params.whiteboardId },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    if (whiteboard.project && !(await enforceTargetAccess(request, reply, "whiteboard", whiteboard.id, whiteboard.project, "view"))) return;
    return serializeWhiteboard(whiteboard);
  });

  app.post("/api/whiteboards", async (request, reply) => {
    const user = await getCurrentUser(request);
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        projectId: z.string().optional().nullable(),
        elements: z.array(z.unknown()).optional(),
        categories: z.array(z.object({ id: z.string(), name: z.string().min(1).max(80), color: z.string().max(32), hidden: z.boolean().optional() })).optional(),
        labels: z.array(z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(60).optional(),
        productionLinks: z.record(z.unknown()).optional(),
        backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        gridColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        gridStyle: z.enum(["lines", "dots", "none"]).optional(),
        canvasWidth: z.number().int().min(600).max(4000).optional(),
        canvasHeight: z.number().int().min(400).max(2400).optional(),
      })
      .parse(request.body);
  
    if (body.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: body.projectId },
      });
      if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
      if (!(await authorization.requireProjectResource(request, reply, project, "whiteboards", "contribute"))) return;
    }
  
    const whiteboard = await prisma.whiteboard.create({
      data: {
        name: body.name,
        description: body.description || null,
        projectId: body.projectId || null,
        elements: JSON.stringify(body.elements || []),
        categories: JSON.stringify(body.categories || []),
        labels: JSON.stringify(body.labels || []),
        productionLinks: JSON.stringify(body.productionLinks || {}),
        backgroundColor: body.backgroundColor || "#f8fafc",
        gridColor: body.gridColor || "#cbd5e1",
        gridStyle: body.gridStyle || "lines",
        canvasWidth: body.canvasWidth || 1800,
        canvasHeight: body.canvasHeight || 950,
      },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    await logActivity({
      userId: user?.id,
      projectId: whiteboard.projectId,
      whiteboardId: whiteboard.id,
      type: "created",
      entityType: "whiteboard",
      entityId: whiteboard.id,
      title: "Whiteboard created",
      message: whiteboard.name,
    });
    return serializeWhiteboard(whiteboard);
  });

  app.patch("/api/whiteboards/:whiteboardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ whiteboardId: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        projectId: z.string().optional().nullable(),
        elements: z.array(z.unknown()).optional(),
        categories: z.array(z.object({ id: z.string(), name: z.string().min(1).max(80), color: z.string().max(32), hidden: z.boolean().optional() })).optional(),
        labels: z.array(z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(60).optional(),
        productionLinks: z.record(z.unknown()).optional(),
        backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        gridColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        gridStyle: z.enum(["lines", "dots", "none"]).optional(),
        canvasWidth: z.number().int().min(600).max(4000).optional(),
        canvasHeight: z.number().int().min(400).max(2400).optional(),
        expectedRevision: z.number().int().min(1).optional(),
      })
      .parse(request.body);
  
    const existingWhiteboard = await prisma.whiteboard.findUnique({
      where: { id: params.whiteboardId },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    if (!existingWhiteboard) return reply.code(404).send({ ok: false, error: "Whiteboard not found." });
    if (existingWhiteboard.project && !(await enforceTargetAccess(request, reply, "whiteboard", existingWhiteboard.id, existingWhiteboard.project, "contribute"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== existingWhiteboard.revision) return sendRevisionConflict(reply, "whiteboard", serializeWhiteboard(existingWhiteboard));
  
    const updated = await prisma.whiteboard.updateMany({
      where: { id: params.whiteboardId, revision: existingWhiteboard.revision },
      data: {
        name: body.name,
        description: body.description,
        projectId: body.projectId,
        elements: body.elements === undefined ? undefined : JSON.stringify(body.elements),
        categories: body.categories === undefined ? undefined : JSON.stringify(body.categories),
        labels: body.labels === undefined ? undefined : JSON.stringify(body.labels),
        productionLinks: body.productionLinks === undefined ? undefined : JSON.stringify(body.productionLinks),
        backgroundColor: body.backgroundColor,
        gridColor: body.gridColor,
        gridStyle: body.gridStyle,
        canvasWidth: body.canvasWidth,
        canvasHeight: body.canvasHeight,
        revision: { increment: 1 },
      },
    });
    if (!updated.count) {
      const current = await prisma.whiteboard.findUnique({
        where: { id: params.whiteboardId },
        include: { project: { include: { memberships: { where: { status: "active" } } } } },
      });
      return sendRevisionConflict(reply, "whiteboard", current ? serializeWhiteboard(current) : null);
    }
    const whiteboard = await prisma.whiteboard.findUniqueOrThrow({
      where: { id: params.whiteboardId },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    await logActivity({
      userId: user?.id,
      projectId: whiteboard.projectId,
      whiteboardId: whiteboard.id,
      type: "updated",
      entityType: "whiteboard",
      entityId: whiteboard.id,
      title: "Whiteboard updated",
      message: whiteboard.name,
      metadata: { revision: whiteboard.revision },
    });
    collaborationRuntime.scheduleBroadcast("whiteboard", whiteboard.id, true);
    return serializeWhiteboard(whiteboard);
  });

  app.delete("/api/whiteboards/:whiteboardId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ whiteboardId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const whiteboard = await prisma.whiteboard.findUnique({
      where: { id: params.whiteboardId },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    if (!whiteboard) return reply.code(404).send({ ok: false, error: "Whiteboard not found." });
    if (whiteboard.project && !(await enforceTargetAccess(request, reply, "whiteboard", whiteboard.id, whiteboard.project, "manage"))) return;
    if (body.expectedRevision !== undefined && body.expectedRevision !== whiteboard.revision) return sendRevisionConflict(reply, "whiteboard", serializeWhiteboard(whiteboard));
    const whiteboardAudience = whiteboard.projectId
      ? "[]"
      : JSON.stringify((await prisma.user.findMany({ where: { archived: false }, select: { id: true } })).map((entry: any) => entry.id));
    const removed = await prisma.$transaction(async (transaction: any) => {
      const deleted = await transaction.whiteboard.deleteMany({ where: { id: params.whiteboardId, revision: whiteboard.revision } });
      if (!deleted.count) return false;
      await transaction.syncTombstone.create({ data: { workspaceId: whiteboard.project?.workspaceId || null, projectId: whiteboard.projectId, entityType: "whiteboard", entityId: whiteboard.id, visibleToUserIds: whiteboardAudience } });
      return true;
    });
    if (!removed) {
      const current = await prisma.whiteboard.findUnique({ where: { id: params.whiteboardId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
      return sendRevisionConflict(reply, "whiteboard", current ? serializeWhiteboard(current) : null);
    }
    await logActivity({
      userId: user?.id,
      projectId: whiteboard.projectId,
      whiteboardId: params.whiteboardId,
      type: "deleted",
      entityType: "whiteboard",
      entityId: params.whiteboardId,
      title: "Whiteboard deleted",
      message: whiteboard.name || params.whiteboardId,
    });
    return { ok: true };
  });

  const enforceEntityCommentAccess = createEntityCommentAccess({ prisma, authRequired: AUTH_REQUIRED, getCurrentUser, authorization, enforceCardAccess, enforceTargetAccess });
  registerEntityCommentRoutes({ ...deps, enforceEntityCommentAccess });
  registerSharedWorkRoutes({ ...deps, enforceEntityCommentAccess });
  registerWhiteboardOperationRoutes(deps);

}
