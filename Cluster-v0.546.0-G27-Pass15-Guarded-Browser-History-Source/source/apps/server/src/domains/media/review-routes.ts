import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ASSET_ARTIFACT_KINDS, ASSET_PROCESSING_JOBS, METADATA_EXPORT_POLICIES, REVIEW_MEDIA, SENSITIVE_METADATA_CATEGORIES } from "@cluster/shared";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { copyrightDisabledResponse, isCopyrightResourceDisabled } from "../../core/copyright-workflow.js";
import { cleanupProjectMediaCache, mediaArtifactRoot, resolveMediaProcessingPolicy, selectMediaQueue } from "../../core/media-processing.js";
import { mediaJobCostUnits } from "../../core/media-resource-budgets.js";
import { registerReviewAssetExportRoutes } from "./review-export-routes.js";
import { videoReviewCarryForwardNotification, videoReviewCommentNotification, videoReviewCommentUpdateNotification, videoReviewMaterializedNotification, videoReviewUpdateNotification, videoReviewUploadNotification } from "../notifications/video-review-notification.js";
import { applyMetadataExportPolicy } from "./metadata-export-policy.js";
import { resolveReviewAssetCapabilities } from "./review-capabilities.js";
import { reviewDecisionEligibility, reviewDecisionGuard } from "./review-decision.js";
import { buildReviewPortableReport, renderReviewPortableReportText } from "./review-portability.js";
import { sendStoredResource } from "./resource-delivery.js";
import { reviewAssetViewableResource } from "./viewable-resource.js";

type ReviewRouteHelpers = {
  parseObject: (value: unknown) => Record<string, any>;
  parseArray: (value: unknown) => any[];
};

export function registerReviewAssetRoutes(deps: ServerRouteRegistrationDeps, helpers: ReviewRouteHelpers) {
  const app = deps.app;
  const { authorization, consumeUploadSession, getCurrentUser, jobQueue, logActivity, prisma, resolveProjectStoredFile, serializeReviewAsset, serializeUserLite, storeCompletedUpload } = deps;
  const { parseArray, parseObject } = helpers;

  const normalizedCoordinate = z.number().finite().min(0).max(1);
  const normalizedPointSchema = z.object({ x: normalizedCoordinate, y: normalizedCoordinate }).strict();
  const normalizedRegionSchema = z.object({ x: normalizedCoordinate, y: normalizedCoordinate, width: normalizedCoordinate, height: normalizedCoordinate }).strict()
    .refine((value) => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, "Normalized review region must remain within the asset surface.");
  const vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .refine((value) => value.every((entry) => Math.abs(entry) <= 1e12), "Spatial coordinates exceed the supported review range.");
  const boundedRecordSchema = z.record(z.string().max(160), z.unknown()).refine((value) => Object.keys(value).length <= 64, "Review state contains too many fields.");
  async function resolveReviewMentionIds(bodyText: string, explicitUserIds: readonly string[] = []) {
    const usernames = [...bodyText.matchAll(/(?:^|\s)@([A-Za-z0-9_.-]{1,64})/g)].map((match) => match[1]).filter(Boolean).slice(0, 24);
    const ids = [...new Set(explicitUserIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 32);
    if (!usernames.length && !ids.length) return [] as string[];
    const users = await prisma.user.findMany({
      where: { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(usernames.length ? [{ username: { in: usernames } }] : [])] },
      select: { id: true },
      take: 32,
    });
    return users.map((entry: any) => entry.id);
  }

  const reviewLocatorSchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("media_time"), timeSeconds: z.number().finite().min(0), endTimeSeconds: z.number().finite().min(0).nullable().optional(),
      frameNumber: z.number().int().min(0).max(10_000_000_000).nullable().optional(), presentedFrame: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
      sourceVersionId: z.string().max(240).nullable().optional(), sourceArtifactId: z.string().max(240).nullable().optional(), audioTrackId: z.string().max(240).nullable().optional(),
      annotation: z.object({ x: normalizedCoordinate, y: normalizedCoordinate, width: normalizedCoordinate, height: normalizedCoordinate, shape: z.enum(["box", "circle", "arrow", "freehand", "text"]).optional(), text: z.string().max(4000).optional(), points: z.array(normalizedPointSchema).max(2048).optional() }).strict().nullable().optional(),
    }).strict(),
    z.object({ type: z.literal("audio_region"), timeSeconds: z.number().finite().min(0), endTimeSeconds: z.number().finite().min(0).nullable().optional(), trackId: z.string().max(240).nullable().optional(), stemId: z.string().max(240).nullable().optional() }).strict(),
    z.object({
      type: z.literal("image_region"), region: normalizedRegionSchema.nullable().optional(), point: normalizedPointSchema.nullable().optional(), path: z.array(normalizedPointSchema).max(4096).nullable().optional(),
      pixel: z.object({ x: z.number().int().min(0).max(1_000_000_000), y: z.number().int().min(0).max(1_000_000_000), rgba: z.tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255).optional()]).optional() }).strict().nullable().optional(),
    }).strict(),
    z.object({ type: z.literal("pdf_region"), page: z.number().int().min(1).max(1_000_000), region: normalizedRegionSchema.nullable().optional(), selectedTextRef: z.string().max(4000).nullable().optional() }).strict(),
    z.object({
      type: z.literal("spatial"), objectId: z.string().max(1200).nullable().optional(), meshId: z.string().max(1200).nullable().optional(), worldPosition: vector3Schema, surfaceNormal: vector3Schema.nullable().optional(),
      camera: boundedRecordSchema.nullable().optional(), visibility: z.record(z.string().max(1200), z.boolean()).refine((value) => Object.keys(value).length <= 2048, "Spatial visibility snapshot is too large.").nullable().optional(),
      animationId: z.string().max(240).nullable().optional(), animationTimeSeconds: z.number().finite().min(0).max(10_000_000).nullable().optional(),
    }).strict(),
  ]);

  async function queueMediaJobsForAsset(input: { asset: any; project: any; jobs: string[]; requestedById?: string | null; accelerationPreference?: unknown; source?: string }) {
    const activeRecords = await prisma.projectControlRecord.findMany({ where: { projectId: input.asset.projectId, kind: "media_job", archived: false, status: { in: ["queued", "processing", "retrying"] } }, orderBy: { createdAt: "desc" }, take: 80 });
    if (activeRecords.length + input.jobs.length > 40) throw Object.assign(new Error("This project already has too many pending media jobs."), { code: "VIDEO_PROCESSING_QUEUE_PRESSURE", statusCode: 429 });
    const existingByKind = new Map<string, any>();
    for (const record of activeRecords) { const payload = parseObject(record.payload); if (record.linkedEntityId === input.asset.id && payload.job && !existingByKind.has(String(payload.job))) existingByKind.set(String(payload.job), record); }
    const queued = [];
    for (const job of input.jobs) {
      const duplicate = existingByKind.get(job);
      if (duplicate) { queued.push({ id: duplicate.id, title: duplicate.title, status: duplicate.status, duplicate: true, backgroundJobId: parseObject(duplicate.payload).backgroundJobId || null }); continue; }
      const routing = await selectMediaQueue(prisma, job as any, input.asset.medium, input.accelerationPreference);
      const record = await prisma.projectControlRecord.create({ data: { projectId: input.asset.projectId, kind: "media_job", title: `${job.replace(/_/g, " ")} · ${input.asset.title}`, status: "queued", priority: job === "proxy" || job === "review_encode" ? "high" : "medium", category: "media-processing", linkedEntityType: "review_asset", linkedEntityId: input.asset.id, payload: JSON.stringify({ job, assetId: input.asset.id, sourceFileName: input.asset.fileName, requestedById: input.requestedById || null, requestedAt: new Date().toISOString(), workerBlock: "H", routing, source: input.source || "manual" }) } });
      try {
        const backgroundJob = await jobQueue.enqueue({
          type: `media.${job}`,
          queue: routing.queue,
          payload: { assetId: input.asset.id, controlRecordId: record.id, requestedById: input.requestedById || null },
          priority: job === "proxy" || job === "review_encode" ? 40 : 20,
          costUnits: mediaJobCostUnits({ sizeBytes: input.asset.sizeBytes, job }),
          maxAttempts: job === "proxy" || job === "review_encode" ? 3 : 5,
          dedupeKey: `media:${input.asset.id}:${job}`,
          createdById: input.requestedById || null,
        });
        const payload = { ...parseObject(record.payload), backgroundJobId: backgroundJob.id, queue: backgroundJob.queue, durableType: backgroundJob.type };
        await prisma.projectControlRecord.update({ where: { id: record.id }, data: { payload: JSON.stringify(payload), revision: { increment: 1 } } });
        queued.push({ id: record.id, title: record.title, status: record.status, backgroundJobId: backgroundJob.id, duplicate: false, routing });
      } catch (error) {
        await prisma.projectControlRecord.update({ where: { id: record.id }, data: { status: "failed", payload: JSON.stringify({ ...parseObject(record.payload), lastError: error instanceof Error ? error.message : String(error) }), revision: { increment: 1 } } });
        throw error;
      }
    }
    if (queued.length) await prisma.reviewAsset.update({ where: { id: input.asset.id }, data: { processingState: "queued" } });
    return queued;
  }

  app.post("/api/projects/:projectId/review-assets", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z
      .object({
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        medium: z.enum(REVIEW_MEDIA).default("video"),
        originalName: z.string().min(1),
        mimeType: z.string().min(1).default("application/octet-stream"),
        sizeBytes: z.number().int().nonnegative().optional(),
        pool: z.enum(["raw", "edited", "final"]).default("raw"),
        status: z.string().min(1).default("review"),
        versionLabel: z.string().max(80).optional().nullable(),
        versionGroupId: z.string().max(120).optional().nullable(),
        versionNumber: z.number().int().min(1).max(100000).optional(),
        reviewRound: z.string().max(80).optional().nullable(),
        assetKind: z.enum(["source", "proxy", "review", "master", "reference"]).default("source"),
        proxyOfId: z.string().max(120).optional().nullable(),
        derivedFromId: z.string().max(120).optional().nullable(),
        processingState: z.enum(["idle", "queued", "processing", "ready", "failed"]).default("idle"),
        platform: z.string().optional().nullable(),
        dueDate: z.string().optional().nullable(),
        reviewerId: z.string().optional().nullable(),
        frameRate: z.number().positive().max(240).optional().nullable(),
        width: z.number().int().positive().max(32768).optional().nullable(),
        height: z.number().int().positive().max(32768).optional().nullable(),
        codec: z.string().max(80).optional().nullable(),
        metadata: z.record(z.unknown()).optional(),
        metadataProvenance: z.record(z.unknown()).optional(),
        fileCreatedAt: z.string().datetime().optional().nullable(),
        capturedAt: z.string().datetime().optional().nullable(),
        modifiedAt: z.string().datetime().optional().nullable(),
        durationSeconds: z.number().nonnegative().optional().nullable(),
        uploadId: z.string().uuid(),
      })
      .parse(request.body);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
  
    const stored = await storeCompletedUpload(user.id, Boolean(user.isAdmin), body.uploadId, params.projectId, "review_asset", body.originalName, body.mimeType, undefined, body.medium);
    let asset: any;
    try {
      asset = await prisma.reviewAsset.create({
      data: {
        projectId: params.projectId,
        medium: body.medium,
        title: body.title,
        description: body.description || null,
        pool: body.pool,
        status: body.status,
        versionLabel: body.versionLabel || null,
        versionGroupId: body.versionGroupId || null,
        versionNumber: body.versionNumber || 1,
        reviewRound: body.reviewRound || null,
        assetKind: body.assetKind,
        proxyOfId: body.proxyOfId || null,
        derivedFromId: body.derivedFromId || body.proxyOfId || null,
        processingState: body.processingState,
        platform: body.platform || null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        reviewerId: body.reviewerId || null,
        approvalState: "pending",
        frameRate: body.frameRate ?? null,
        width: body.width ?? null,
        height: body.height ?? null,
        codec: body.codec || null,
        metadata: JSON.stringify(body.metadata || {}),
        metadataProvenance: JSON.stringify(body.metadataProvenance || {}),
        creatorId: user?.id || null,
        ownerId: user?.id || null,
        lastModifiedById: user?.id || null,
        fileCreatedAt: body.fileCreatedAt ? new Date(body.fileCreatedAt) : null,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
        modifiedAt: body.modifiedAt ? new Date(body.modifiedAt) : null,
        checksumSha256: stored.checksumSha256,
        fileName: stored.storedName,
        originalName: body.originalName,
        mimeType: stored.detectedMime,
        sizeBytes: stored.actualSize,
        durationSeconds: body.durationSeconds ?? null,
        uploadedById: user?.id || null,
        uploadedAt: new Date(),
        versionUploadedAt: new Date(),
      },
        include: { comments: { include: { user: true } } },
      });
    } catch (error) {
      await fs.rm(stored.fullPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await consumeUploadSession(body.uploadId).catch(() => undefined);
    if (!asset.versionGroupId) {
      await prisma.reviewAsset.update({ where: { id: asset.id }, data: { versionGroupId: asset.id } });
      asset.versionGroupId = asset.id;
    }
    if (asset.versionNumber > 1 && asset.versionGroupId) {
      const previous = await prisma.reviewAsset.findFirst({ where: { projectId: params.projectId, versionGroupId: asset.versionGroupId, id: { not: asset.id }, versionNumber: { lt: asset.versionNumber } }, orderBy: { versionNumber: "desc" } });
      if (previous) await prisma.reviewAsset.update({ where: { id: previous.id }, data: { supersededById: asset.id, approvalState: previous.approvalState === "approved" ? "superseded" : previous.approvalState } });
    }
    const uploadNotification = videoReviewUploadNotification(asset, user?.id);
    await logActivity({ userId: user?.id, projectId: params.projectId, type: "uploaded", entityType: "review_asset", entityId: asset.id, ...uploadNotification });
    const policy = await resolveMediaProcessingPolicy(prisma, project.projectType, asset.medium, asset.assetKind);
    if (policy.enabled && policy.jobs.length) {
      const autoQueued = await queueMediaJobsForAsset({ asset, project, jobs: policy.jobs, requestedById: user?.id || null, accelerationPreference: policy.accelerationPreference, source: `policy:${policy.source}` }).catch(() => []);
      if (autoQueued.length) await logActivity({ userId: user?.id, projectId: project.id, type: "queued", entityType: "review_asset_processing", entityId: asset.id, title: "Automatic media processing queued", message: `${autoQueued.length} job${autoQueued.length === 1 ? "" : "s"} from ${asset.assetKind} ingestion policy`, metadata: { projectType: project.projectType, medium: asset.medium, assetRole: asset.assetKind, jobs: policy.jobs } });
    }
    return serializeReviewAsset(await prisma.reviewAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { comments: { include: { user: true } } } }));
  });

  app.patch("/api/review-assets/:assetId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        pool: z.enum(["raw", "edited", "final"]).optional(),
        status: z.string().min(1).optional(),
        versionLabel: z.string().max(80).optional().nullable(),
        reviewRound: z.string().max(80).optional().nullable(),
        assetKind: z.enum(["source", "proxy", "review", "master", "reference"]).optional(),
        proxyOfId: z.string().max(120).optional().nullable(),
        derivedFromId: z.string().max(120).optional().nullable(),
        processingState: z.enum(["idle", "queued", "processing", "ready", "failed"]).optional(),
        platform: z.string().optional().nullable(),
        dueDate: z.string().optional().nullable(),
        reviewerId: z.string().optional().nullable(),
        frameRate: z.number().positive().max(240).optional().nullable(),
        width: z.number().int().positive().max(32768).optional().nullable(),
        height: z.number().int().positive().max(32768).optional().nullable(),
        codec: z.string().max(80).optional().nullable(),
        metadata: z.record(z.unknown()).optional(),
        durationSeconds: z.number().nonnegative().optional().nullable(),
      }).strict()
      .parse(request.body);

    const beforeAsset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!beforeAsset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: beforeAsset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", beforeAsset.id, project, "manage"))) return;

    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description || null;
    if (body.pool !== undefined) data.pool = body.pool;
    if (body.status !== undefined) data.status = body.status;
    if (body.versionLabel !== undefined) data.versionLabel = body.versionLabel || null;
    if (body.reviewRound !== undefined) data.reviewRound = body.reviewRound || null;
    if (body.assetKind !== undefined) data.assetKind = body.assetKind;
    if (body.proxyOfId !== undefined) data.proxyOfId = body.proxyOfId || null;
    if (body.derivedFromId !== undefined) data.derivedFromId = body.derivedFromId || null;
    if (body.processingState !== undefined) data.processingState = body.processingState;
    if (body.platform !== undefined) data.platform = body.platform || null;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.reviewerId !== undefined) data.reviewerId = body.reviewerId || null;
    if (body.frameRate !== undefined) data.frameRate = body.frameRate ?? null;
    if (body.width !== undefined) data.width = body.width ?? null;
    if (body.height !== undefined) data.height = body.height ?? null;
    if (body.codec !== undefined) data.codec = body.codec || null;
    if (body.metadata !== undefined) data.metadata = JSON.stringify(body.metadata || {});
    if (body.durationSeconds !== undefined) data.durationSeconds = body.durationSeconds ?? null;
    data.lastModifiedById = user?.id || null;
  
    const asset = await prisma.reviewAsset.update({
      where: { id: params.assetId },
      data,
      include: {
        comments: {
          orderBy: { createdAt: "asc" },
          include: { user: true },
        },
      },
    });
    const updateNotification = videoReviewUpdateNotification(beforeAsset, asset, body, user?.id);
    await logActivity({ userId: user?.id, projectId: asset.projectId, type: "updated", entityType: "review_asset", entityId: asset.id, ...updateNotification });
    return serializeReviewAsset(asset);
  });

  // Decision evidence is a separate command. An annotation, metadata PATCH or
  // uploaded replacement version is never an approval. The exact asset version
  // and latest server revision must match the reviewer's observation.
  app.post("/api/review-assets/:assetId/decision", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ assetId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      decision: z.enum(["approved", "changes"]),
      reason: z.string().trim().max(2000).optional().nullable(),
      expectedVersionNumber: z.number().int().min(1),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    }).strict().parse(request.body || {});
    const current = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!current) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: current.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", current.id, project, "view"))) return;
    const canManage = await authorization.requestCanTarget(request, "review_asset", current.id, project, "manage");
    const eligible = reviewDecisionEligibility(current, body, user.id, canManage);
    if (!eligible.ok) return reply.code(eligible.status).send({ code: eligible.code, message: eligible.message });
    try {
      const committed = await prisma.$transaction(async (tx) => {
        const update = await tx.reviewAsset.updateMany({
          where: reviewDecisionGuard(current),
          data: {
            approvalState: body.decision,
            approvedAt: body.decision === "approved" ? new Date() : null,
            approvedById: body.decision === "approved" ? user.id : null,
            lastModifiedById: user.id,
          },
        });
        if (update.count !== 1) return null;
        const decision = await tx.reviewAssetDecision.create({ data: {
          reviewAssetId: current.id, versionNumber: current.versionNumber,
          sourceChecksumSha256: current.checksumSha256 || null,
          decision: body.decision, reason: body.reason?.trim() || null, actorId: user.id,
        } });
        const asset = await tx.reviewAsset.findUniqueOrThrow({ where: { id: current.id } });
        return { asset, decision };
      }, { isolationLevel: "Serializable" });
      if (!committed) return reply.code(409).send({ code: "REVIEW_DECISION_STALE", message: "This review changed while you were deciding. Reload before continuing." });
      // Activity notification delivery is secondary. Do not turn a committed
      // review decision into a reported failed save if telemetry is unavailable.
      try {
        const notification = videoReviewUpdateNotification(current, committed.asset, { approvalState: body.decision }, user.id);
        await logActivity({ userId: user.id, projectId: current.projectId, type: "updated", entityType: "review_asset", entityId: current.id,
          ...notification,
          title: body.decision === "approved" ? "Media version approved" : "Media changes requested",
          message: `Version ${current.versionNumber} review decision recorded.`,
          metadata: { ...(notification.metadata || {}), decisionId: committed.decision.id, versionNumber: current.versionNumber, decision: body.decision } });
      } catch (activityError) { app.log?.warn?.({ error: activityError, reviewAssetId: current.id }, "Committed review decision; activity delivery unavailable"); }
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, asset: serializeReviewAsset(committed.asset), decisionId: committed.decision.id };
    } catch (error: any) {
      if (["P2034", "P2025"].includes(String(error?.code || ""))) return reply.code(409).send({ code: "REVIEW_DECISION_STALE", message: "This review changed while you were deciding. Reload before continuing." });
      throw error;
    }
  });

  app.get("/api/review-assets/:assetId/decisions", async (request, reply) => {
    const params = z.object({ assetId: z.string().min(1) }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const rows = await prisma.reviewAssetDecision.findMany({ where: { reviewAssetId: asset.id }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, versionNumber: true, decision: true, reason: true, decidedAt: true, actorId: true } });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, decisions: rows };
  });

  app.delete("/api/review-assets/:assetId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "manage"))) return;
    // Decisions must remain inspectable; a delete must not cascade away signed-off
    // review evidence. Archive the asset instead if review history exists.
    const retainedDecisions = await prisma.reviewAssetDecision.count({ where: { reviewAssetId: asset.id } });
    if (retainedDecisions > 0) return reply.code(409).send({ code: "REVIEW_DECISION_RETENTION", message: "This version has committed review decisions. Archive it instead of deleting its evidence." });
    try { await prisma.reviewAsset.delete({ where: { id: asset.id } }); }
    catch (deleteError: any) {
      if (String(deleteError?.code || "") === "P2003") return reply.code(409).send({ code: "REVIEW_DECISION_RETENTION", message: "Review evidence was committed while deletion was attempted. Archive this version instead." });
      throw deleteError;
    }
    await logActivity({
      userId: user?.id,
      projectId: asset.projectId,
      type: "deleted",
      entityType: "review_asset",
      entityId: asset.id,
      title: "Review asset deleted",
      message: asset.title,
    });
    return { ok: true };
  });

  app.post("/api/review-assets/:assetId/comments", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z.object({
      body: z.string().trim().min(1).max(16_000), locator: reviewLocatorSchema,
      status: z.string().trim().min(1).max(80).default("open"), category: z.string().trim().min(1).max(80).default("edit"), priority: z.string().trim().min(1).max(80).default("medium"),
      assigneeId: z.string().max(240).optional().nullable(), parentCommentId: z.string().max(240).optional().nullable(), mentionedUserIds: z.array(z.string().max(240)).max(32).optional(),
    }).parse(request.body);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "contribute"))) return;
    const parent = body.parentCommentId ? await prisma.reviewComment.findUnique({ where: { id: body.parentCommentId } }) : null;
    if (body.parentCommentId && (!parent || parent.reviewAssetId !== asset.id)) return reply.code(400).send({ code: "REVIEW_THREAD_PARENT_INVALID", message: "Reply parent must belong to the same review asset." });
    const mentionedUserIds = await resolveReviewMentionIds(body.body, body.mentionedUserIds || []);
    const comment = await prisma.reviewComment.create({
      data: { reviewAssetId: asset.id, userId: user?.id || null, body: body.body, locatorType: body.locator.type, locator: JSON.stringify(body.locator), status: body.status, category: body.category, priority: body.priority, assigneeId: body.assigneeId || null, parentCommentId: parent?.id || null, threadRootId: parent ? (parent.threadRootId || parent.id) : null, mentionedUserIds: JSON.stringify(mentionedUserIds) },
      include: { user: true },
    });
    const serializedComment = { ...comment, locator: parseObject(comment.locator), mentionedUserIds, user: serializeUserLite(comment.user) };
    const commentNotification = videoReviewCommentNotification(asset, serializedComment, body, user?.id);
    await logActivity({ userId: user?.id, projectId: asset.projectId, type: parent ? "replied" : "commented", entityType: "review_comment", entityId: comment.id, ...commentNotification, metadata: { ...(commentNotification.metadata || {}), threadRootId: comment.threadRootId || comment.id, parentCommentId: comment.parentCommentId, mentionedUserIds } });
    return serializedComment;
  });

  app.patch("/api/review-comments/:commentId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ commentId: z.string() }).parse(request.params);
    const body = z.object({
      body: z.string().trim().min(1).max(16_000).optional(), locator: reviewLocatorSchema.optional(), status: z.string().trim().min(1).max(80).optional(), category: z.string().trim().min(1).max(80).optional(), priority: z.string().trim().min(1).max(80).optional(), assigneeId: z.string().max(240).optional().nullable(), mentionedUserIds: z.array(z.string().max(240)).max(32).optional(),
    }).parse(request.body);
    const before = await prisma.reviewComment.findUnique({ where: { id: params.commentId }, include: { reviewAsset: true } });
    if (!before) return reply.code(404).send({ code: "REVIEW_NOTE_NOT_FOUND", message: "Review note not found." });
    const project = await prisma.project.findUnique({ where: { id: before.reviewAsset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", before.reviewAsset.id, project, "contribute"))) return;
    const data: any = {};
    if (body.body !== undefined) data.body = body.body;
    if (body.locator !== undefined) { data.locatorType = body.locator.type; data.locator = JSON.stringify(body.locator); }
    if (body.status !== undefined) { data.status = body.status; data.resolvedAt = body.status === "resolved" ? new Date() : null; data.resolvedById = body.status === "resolved" ? user?.id || null : null; }
    if (body.category !== undefined) data.category = body.category;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;
    if (body.body !== undefined || body.mentionedUserIds !== undefined) data.mentionedUserIds = JSON.stringify(await resolveReviewMentionIds(body.body ?? before.body, body.mentionedUserIds ?? parseArray(before.mentionedUserIds).map(String)));
    const comment = await prisma.reviewComment.update({ where: { id: params.commentId }, data, include: { user: true, reviewAsset: true } });
    const mentionedUserIds = parseArray(comment.mentionedUserIds).map(String);
    const serializedComment = { ...comment, locator: parseObject(comment.locator), mentionedUserIds, user: serializeUserLite(comment.user) };
    const commentNotification = videoReviewCommentUpdateNotification({ ...serializedComment, reviewAsset: comment.reviewAsset }, user?.id);
    await logActivity({ userId: user?.id, projectId: comment.reviewAsset.projectId, type: "updated", entityType: "review_comment", entityId: comment.id, ...commentNotification });
    return { ...serializedComment, reviewAsset: undefined };
  });

  app.post("/api/review-comments/:commentId/materialize", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const params = z.object({ commentId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      target: z.enum(["ticket", "card"]).default("ticket"), title: z.string().trim().min(1).max(200).optional(),
      assigneeId: z.string().optional().nullable(),
      destinationBoardId: z.string().min(1), destinationListId: z.string().min(1),
    }).strict().parse(request.body || {});
    const comment = await prisma.reviewComment.findUnique({ where: { id: params.commentId }, include: { reviewAsset: true } });
    if (!comment) return reply.code(404).send({ code: "VIDEO_REVIEW_NOTE_NOT_FOUND", message: "Review note not found." });
    const project = await prisma.project.findUnique({ where: { id: comment.reviewAsset.projectId } });
    if (!project) return reply.code(404).send({ code: "PROJECT_NOT_FOUND", message: "Project not found." });
    if (!(await authorization.requireTarget(request, reply, "review_asset", comment.reviewAsset.id, project, "contribute"))) return;
    if (comment.workEntityId && comment.workEntityType) return { ok: true, duplicate: true, target: comment.workEntityType, entityId: comment.workEntityId };
    const board = await prisma.board.findFirst({ where: { id: body.destinationBoardId, projectId: project.id, archived: false } });
    if (!board) return reply.code(409).send({ code: "REVIEW_DESTINATION_UNAVAILABLE", message: "Choose an active Board belonging to this Project." });
    if (!(await authorization.requireTarget(request, reply, "board", board.id, project, "contribute"))) return;
    const list = await prisma.boardList.findFirst({ where: { id: body.destinationListId, boardId: board.id, archived: false } });
    if (!list) return reply.code(409).send({ code: "REVIEW_DESTINATION_UNAVAILABLE", message: "Choose an active destination List on the selected Board." });
    const locator = parseObject(comment.locator) as any;
    const timeSeconds = Number(locator.timeSeconds || 0);
    const timeLabel = `${Math.max(0, Math.floor(timeSeconds / 60))}:${String(Math.floor(timeSeconds % 60)).padStart(2, "0")}`;
    const title = body.title || `${comment.reviewAsset.title} · ${timeLabel} · ${comment.body.slice(0, 96)}`;
    const origin = { reviewAssetId: comment.reviewAsset.id, reviewCommentId: comment.id, versionGroupId: comment.reviewAsset.versionGroupId, versionNumber: comment.reviewAsset.versionNumber, locator };
    let card: any;
    try {
      card = await prisma.$transaction(async (tx) => {
        // Recheck the destination inside the same write transaction. The G25
        // database admission guard also refuses a concurrent List archive.
        const destination = await tx.boardList.findFirst({ where: { id: list.id, boardId: board.id, archived: false, board: { archived: false, projectId: project.id } } });
        if (!destination) throw Object.assign(new Error("Destination changed"), { code: "REVIEW_DESTINATION_UNAVAILABLE" });
        const latest = await tx.reviewComment.findUnique({ where: { id: comment.id }, select: { workEntityId: true, workEntityType: true } });
        if (!latest || latest.workEntityId) throw Object.assign(new Error("Review work already linked"), { code: "REVIEW_ALREADY_MATERIALIZED" });
        const last = await tx.card.findFirst({ where: { listId: list.id, archived: false }, orderBy: { position: "desc" } });
        const created = await tx.card.create({ data: {
          listId: list.id, title, workItemKind: body.target === "ticket" ? "ticket" : "card", ticketStage: body.target === "ticket" ? "new" : null,
          description: `${comment.body}\n\nReview origin: ${comment.reviewAsset.title} ${comment.reviewAsset.versionLabel || `v${comment.reviewAsset.versionNumber}`} @ ${timeLabel}\ncluster://review/${comment.id}`,
          position: last ? last.position + 1 : 0, priority: ["low", "medium", "high", "urgent"].includes(comment.priority) ? comment.priority : "medium",
          labels: JSON.stringify(body.target === "ticket" ? ["ticket", "review", comment.category] : ["review", comment.category]),
          assigneeId: body.assigneeId || comment.assigneeId || null, externalUrl: `cluster://review/${comment.id}`,
        } });
        const claim = await tx.reviewComment.updateMany({ where: { id: comment.id, workEntityId: null, workEntityType: null }, data: {
          workEntityType: body.target, workEntityId: created.id, assigneeId: body.assigneeId || comment.assigneeId || null,
        } });
        if (claim.count !== 1) throw Object.assign(new Error("Review work already linked"), { code: "REVIEW_ALREADY_MATERIALIZED" });
        await tx.projectRelationship.upsert({ where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: "review_comment", sourceId: comment.id, targetType: body.target, targetId: created.id, relationship: "materializes_as" } }, update: { description: "Work materialized from review feedback.", createdById: user.id }, create: { projectId: project.id, sourceType: "review_comment", sourceId: comment.id, targetType: body.target, targetId: created.id, relationship: "materializes_as", description: "Work materialized from review feedback.", createdById: user.id } });
        await tx.projectRelationship.upsert({ where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: body.target, sourceId: created.id, targetType: "review_asset", targetId: comment.reviewAsset.id, relationship: "originates_from" } }, update: { description: "Work retains its source review asset/version context.", createdById: user.id }, create: { projectId: project.id, sourceType: body.target, sourceId: created.id, targetType: "review_asset", targetId: comment.reviewAsset.id, relationship: "originates_from", description: "Work retains its source review asset/version context.", createdById: user.id } });
        return created;
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      const code = String(error?.code || "");
      if (code === "REVIEW_ALREADY_MATERIALIZED" || code === "P2034") {
        const latest = await prisma.reviewComment.findUnique({ where: { id: comment.id }, select: { workEntityType: true, workEntityId: true } });
        if (latest?.workEntityId) return { ok: true, duplicate: true, target: latest.workEntityType, entityId: latest.workEntityId };
        return reply.code(409).send({ code: "REVIEW_MATERIALIZATION_CONFLICT", message: "The review note changed. Reload before creating work." });
      }
      if (["REVIEW_DESTINATION_UNAVAILABLE", "P2003"].includes(code)) return reply.code(409).send({ code: "REVIEW_DESTINATION_UNAVAILABLE", message: "The destination changed. Select another active Board/List." });
      throw error;
    }
    await logActivity({ userId: user.id, projectId: project.id, boardId: board.id, cardId: card.id, type: "created", entityType: body.target, entityId: card.id, title: `${body.target === "ticket" ? "Ticket" : "Card"} created from review`, message: title, metadata: videoReviewMaterializedNotification(origin, card, body.target, user.id, project.id, comment.reviewAsset.id) });
    return { ok: true, target: body.target, entity: card, origin };
  });

  app.post("/api/review-assets/:assetId/carry-forward", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z.object({ fromAssetId: z.string(), unresolvedOnly: z.boolean().default(true) }).parse(request.body || {});
    const [target, source] = await Promise.all([prisma.reviewAsset.findUnique({ where: { id: params.assetId } }), prisma.reviewAsset.findUnique({ where: { id: body.fromAssetId }, include: { comments: true } })]);
    if (!target || !source || target.projectId !== source.projectId) return reply.code(400).send({ code: "VIDEO_VERSION_CARRY_INVALID", message: "Both versions must belong to the same project." });
    const project = await prisma.project.findUnique({ where: { id: target.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", target.id, project, "contribute"))) return;
    if (!(await authorization.requireTarget(request, reply, "review_asset", source.id, project, "view"))) return;
    if ((target.versionGroupId || target.id) !== (source.versionGroupId || source.id)) return reply.code(400).send({ code: "VIDEO_VERSION_FAMILY_MISMATCH", message: "Feedback can only be carried within the same version family." });
    const sourceNotes = source.comments.filter((note: any) => !body.unresolvedOnly || note.status !== "resolved").slice(0, 500);
    const existing = await prisma.reviewComment.findMany({ where: { reviewAssetId: target.id, carriedFromAssetId: source.id }, select: { carriedFromCommentId: true } });
    const existingIds = new Set(existing.map((row: any) => row.carriedFromCommentId).filter(Boolean));
    const pending = sourceNotes.filter((note: any) => !existingIds.has(note.id));
    if (pending.length) {
      await prisma.reviewComment.createMany({ data: pending.map((note: any) => ({
        reviewAssetId: target.id, userId: note.userId, body: note.body, locatorType: note.locatorType, locator: note.locator, status: "open", category: note.category, priority: note.priority, assigneeId: note.assigneeId,
        mentionedUserIds: note.mentionedUserIds || "[]", carriedFromCommentId: note.id, carriedFromAssetId: source.id,
      })) });
      const copiedRows = await prisma.reviewComment.findMany({ where: { reviewAssetId: target.id, carriedFromAssetId: source.id, carriedFromCommentId: { in: pending.map((note: any) => note.id) } }, select: { id: true, carriedFromCommentId: true } });
      const copiedIdBySourceId = new Map(copiedRows.map((row: any) => [row.carriedFromCommentId, row.id]));
      const threadUpdates = pending.flatMap((note: any) => {
        const copiedId = copiedIdBySourceId.get(note.id);
        if (!copiedId || !note.parentCommentId) return [];
        const parentCommentId = copiedIdBySourceId.get(note.parentCommentId) || null;
        const threadRootId = copiedIdBySourceId.get(note.threadRootId || note.parentCommentId) || parentCommentId;
        return parentCommentId ? [{ id: copiedId, parentCommentId, threadRootId }] : [];
      });
      for (let index = 0; index < threadUpdates.length; index += 50) {
        await Promise.all(threadUpdates.slice(index, index + 50).map((entry: any) => prisma.reviewComment.update({ where: { id: entry.id }, data: { parentCommentId: entry.parentCommentId, threadRootId: entry.threadRootId } })));
      }
    }
    await prisma.reviewAsset.update({ where: { id: source.id }, data: { supersededById: target.id, approvalState: source.approvalState === "approved" ? "superseded" : source.approvalState } });
    const carryNotification = videoReviewCarryForwardNotification(target, source.id, pending.length, user?.id);
    await logActivity({ userId: user?.id, projectId: target.projectId, type: "updated", entityType: "review_asset", entityId: target.id, title: "Review feedback carried forward", message: `${pending.length} unresolved note${pending.length === 1 ? "" : "s"} copied from ${source.title}`, metadata: carryNotification });
    return { ok: true, copied: pending.length, skipped: sourceNotes.length - pending.length };
  });

  app.post("/api/review-assets/:assetId/processing-jobs", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z.object({ jobs: z.array(z.enum(ASSET_PROCESSING_JOBS)).min(1).max(8), accelerationPreference: z.enum(["auto", "software", "nvenc", "qsv", "videotoolbox"]).default("auto") }).parse(request.body || {});
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "contribute"))) return;
    try {
      const queued = await queueMediaJobsForAsset({ asset, project, jobs: body.jobs, requestedById: user?.id || null, accelerationPreference: body.accelerationPreference, source: "manual" });
      await logActivity({ userId: user?.id, projectId: asset.projectId, type: "queued", entityType: "review_asset_processing", entityId: asset.id, title: "Media processing queued", message: `${body.jobs.length} media job${body.jobs.length === 1 ? "" : "s"} routed to the durable media worker pool`, metadata: { jobs: body.jobs, accelerationPreference: body.accelerationPreference } });
      return { ok: true, queued };
    } catch (error: any) {
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ code: error.code || "MEDIA_PROCESSING_REQUEST_REJECTED", message: error.message });
      throw error;
    }
  });

  app.post("/api/projects/:projectId/media-processing/jobs/:recordId/cancel", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project || !(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const record = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: params.projectId, kind: "media_job", archived: false } });
    if (!record) return reply.code(404).send({ code: "MEDIA_JOB_NOT_FOUND", message: "Media processing job not found." });
    const payload = parseObject(record.payload); const backgroundJobId = String(payload.backgroundJobId || "").trim();
    if (!backgroundJobId) return reply.code(409).send({ code: "MEDIA_JOB_NOT_DURABLE", message: "This media job is missing its durable queue record." });
    const cancelled = await jobQueue.cancel(backgroundJobId);
    if (!cancelled) return reply.code(409).send({ code: "MEDIA_JOB_NOT_CANCELLABLE", message: "Media job is already terminal or no longer exists." });
    await prisma.projectControlRecord.update({ where: { id: record.id }, data: { status: cancelled.status === "CANCELLED" ? "cancelled" : record.status, payload: JSON.stringify({ ...payload, cancelRequestedAt: new Date().toISOString() }), revision: { increment: 1 } } });
    if (record.linkedEntityId) await prisma.reviewAsset.update({ where: { id: record.linkedEntityId }, data: { processingState: "processing" } }).catch(() => undefined);
    await logActivity({ userId: user?.id, projectId: params.projectId, type: "updated", entityType: "media_job", entityId: record.id, title: "Media processing cancellation requested", message: record.title });
    return { ok: true, status: cancelled.status };
  });

  app.post("/api/projects/:projectId/media-processing/jobs/:recordId/retry", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), recordId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project || !(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const record = await prisma.projectControlRecord.findFirst({ where: { id: params.recordId, projectId: params.projectId, kind: "media_job", archived: false } });
    if (!record) return reply.code(404).send({ code: "MEDIA_JOB_NOT_FOUND", message: "Media processing job not found." });
    const payload = parseObject(record.payload); const backgroundJobId = String(payload.backgroundJobId || "").trim();
    if (!backgroundJobId) return reply.code(409).send({ code: "MEDIA_JOB_NOT_DURABLE", message: "This media job is missing its durable queue record." });
    const retried = await jobQueue.retry(backgroundJobId);
    if (!retried) return reply.code(409).send({ code: "MEDIA_JOB_NOT_RETRYABLE", message: "Only failed, cancelled, or dead-letter media jobs can be retried." });
    await prisma.projectControlRecord.update({ where: { id: record.id }, data: { status: "queued", progress: 0, completedAt: null, payload: JSON.stringify({ ...payload, lastError: null, retryPending: true, retriedAt: new Date().toISOString() }), revision: { increment: 1 } } });
    if (record.linkedEntityId) await prisma.reviewAsset.update({ where: { id: record.linkedEntityId }, data: { processingState: "queued" } }).catch(() => undefined);
    await logActivity({ userId: user?.id, projectId: params.projectId, type: "queued", entityType: "media_job", entityId: record.id, title: "Media processing retried", message: record.title });
    return { ok: true, status: retried.status };
  });

  app.post("/api/projects/:projectId/media-processing/cache/cleanup", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ all: z.boolean().default(false), olderThanDays: z.number().int().min(1).max(3650).default(30) }).parse(request.body || {});
    const project = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project || !(await authorization.requireProjectResource(request, reply, project, "viewer", "manage"))) return;
    const result = await cleanupProjectMediaCache(prisma, params.projectId, { all: body.all, olderThan: body.all ? null : new Date(Date.now() - body.olderThanDays * 86400000) });
    await logActivity({ userId: user?.id, projectId: params.projectId, type: "updated", entityType: "media_cache", entityId: params.projectId, title: "Generated media cache cleaned", message: `${result.removed} artifact${result.removed === 1 ? "" : "s"} removed`, metadata: result });
    return { ok: true, ...result };
  });

  app.get("/api/review-assets/:assetId/processing-artifacts/:kind", async (request, reply) => {
    const params = z.object({ assetId: z.string(), kind: z.enum(ASSET_ARTIFACT_KINDS) }).parse(request.params);
    const query = z.object({ variant: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).default("default") }).parse(request.query || {});
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    if (await isCopyrightResourceDisabled(prisma, "review_asset", asset.id)) return copyrightDisabledResponse(reply);
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const artifact = await prisma.assetArtifact.findUnique({ where: { reviewAssetId_kind_variantKey: { reviewAssetId: asset.id, kind: params.kind, variantKey: query.variant } } });
    if (!artifact) return reply.code(404).send({ code: "MEDIA_ARTIFACT_NOT_FOUND", message: "Generated media artifact is not available." });
    const root = path.resolve(await mediaArtifactRoot(prisma, asset.projectId));
    const fullPath = path.resolve(artifact.fileName);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) return reply.code(409).send({ code: "MEDIA_ARTIFACT_PATH_INVALID", message: "Generated media artifact path is outside the managed cache." });
    try { await fs.access(fullPath); } catch { return reply.code(404).send({ code: "MEDIA_ARTIFACT_FILE_MISSING", message: "Generated media artifact file is missing." }); }
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: artifact.mimeType || "application/octet-stream",
      originalName: `${asset.title}-${artifact.kind}-${artifact.variantKey}`,
      checksumSha256: artifact.checksumSha256,
      requestedInline: true,
      cacheControl: "private, max-age=300",
    });
  });

  registerReviewAssetExportRoutes(deps, helpers);

  app.get("/api/review-assets/:assetId/review-report", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const query = z.object({ scope: z.enum(["asset", "family"]).default("family"), format: z.enum(["json", "text"]).default("json") }).parse(request.query || {});
    const anchor = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!anchor) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: anchor.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", anchor.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, anchor, project);
    if (!capabilities.viewReviewHistory) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Review history access is not permitted for this asset." });
    const familyId = anchor.versionGroupId || anchor.id;
    const assets = query.scope === "asset"
      ? await prisma.reviewAsset.findMany({ where: { id: anchor.id }, include: { uploadedBy: true, reviewer: true, approvedBy: true, comments: { orderBy: { createdAt: "asc" }, include: { user: true } } }, take: 1 })
      : await prisma.reviewAsset.findMany({ where: { projectId: anchor.projectId, OR: [{ versionGroupId: familyId }, { id: familyId }] }, include: { uploadedBy: true, reviewer: true, approvedBy: true, comments: { orderBy: { createdAt: "asc" }, include: { user: true } } }, orderBy: [{ versionNumber: "asc" }, { uploadedAt: "asc" }], take: 200 });
    const visibleAssets = await authorization.filterTargetsForRequest(request, assets, "review_asset", project, "view");
    const report = buildReviewPortableReport({ assets: visibleAssets, anchor, scope: query.scope });
    if (query.format === "text") {
      const safeName = String(anchor.title || anchor.originalName || "review").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "review";
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${safeName}-review-report.txt"`);
      return reply.send(renderReviewPortableReportText(report));
    }
    return report;
  });

  app.get("/api/review-assets/:assetId/session", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId }, include: { comments: { orderBy: { createdAt: "asc" }, include: { user: true } } } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);
    const reviewer = await getCurrentUser(request);
    if (capabilities.viewAsset && asset.reviewerId && reviewer?.id === asset.reviewerId) capabilities.approve = true;
    const artifacts = await prisma.assetArtifact.findMany({ where: { reviewAssetId: asset.id }, orderBy: { updatedAt: "desc" } });
    return { asset: serializeReviewAsset(asset), capabilities, resource: reviewAssetViewableResource(asset, artifacts) };
  });

  app.post("/api/review-assets/:assetId/metadata-export-policy/preview", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z.object({
      policy: z.enum(METADATA_EXPORT_POLICIES),
      preserveTechnicalRenderingMetadata: z.boolean().optional(),
      includeCategories: z.array(z.string().trim().min(1).max(80)).max(64).optional(),
      excludeSensitiveCategories: z.array(z.enum(SENSITIVE_METADATA_CATEGORIES)).max(SENSITIVE_METADATA_CATEGORIES.length).optional(),
    }).parse(request.body || {});
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);
    const canPreviewStandardDerivative = body.policy === "safe_share" || body.policy === "strip_all";
    if (body.policy === "custom" && !capabilities.chooseMetadataPreservationPolicy) {
      return reply.code(403).send({ code: "ACCESS_DENIED", message: "Choosing custom metadata categories requires review-asset manage permission." });
    }
    if (canPreviewStandardDerivative && !capabilities.exportDerivative) {
      return reply.code(403).send({ code: "ACCESS_DENIED", message: "Metadata export preview requires derivative-export permission." });
    }
    if (body.policy === "preserve" && !capabilities.downloadOriginal) {
      return reply.code(403).send({ code: "ACCESS_DENIED", message: "Preserved export preview requires original-download permission." });
    }
    const canExposeSensitiveValues = Boolean(capabilities.viewSensitiveMetadata);
    const applied = applyMetadataExportPolicy({
      metadata: parseObject(asset.metadata),
      sensitiveMetadata: canExposeSensitiveValues ? parseObject(asset.sensitiveMetadata) : {},
      selection: body,
    });
    return {
      assetId: asset.id,
      policy: body.policy,
      metadata: applied.metadata,
      sensitiveMetadata: canExposeSensitiveValues ? applied.sensitiveMetadata : {},
      sensitiveMetadataRedacted: !canExposeSensitiveValues,
      removedSensitiveCategories: applied.removedSensitiveCategories,
    };
  });

  app.get("/api/review-assets/:assetId/sensitive-metadata", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    const capabilities = project ? await resolveReviewAssetCapabilities(authorization, request, asset, project) : null;
    if (!project || !capabilities?.viewSensitiveMetadata) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Sensitive metadata access requires review-asset manage permission." });
    return { assetId: asset.id, sensitiveMetadata: parseObject(asset.sensitiveMetadata) };
  });

  app.get("/api/review-assets/:assetId/file", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    if (await isCopyrightResourceDisabled(prisma, "review_asset", asset.id)) return copyrightDisabledResponse(reply);
    const fullPath = await resolveProjectStoredFile(asset.projectId, "review_asset", asset.fileName, asset.medium);
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: asset.mimeType || "application/octet-stream",
      originalName: asset.originalName,
      checksumSha256: asset.checksumSha256,
      requestedInline: true,
      cacheControl: "private, max-age=0, must-revalidate",
    });
  });

}
