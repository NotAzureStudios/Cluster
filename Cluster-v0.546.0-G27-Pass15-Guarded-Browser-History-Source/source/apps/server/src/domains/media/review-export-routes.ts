import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { METADATA_EXPORT_POLICIES, SENSITIVE_METADATA_CATEGORIES, assetProcessingJobSupportedForMedium, type MetadataExportSelection, type ReviewMedium } from "@cluster/shared";
import type { ServerRouteRegistrationDeps } from "../../app/server-composition-types.js";
import { copyrightDisabledResponse, isCopyrightResourceDisabled } from "../../core/copyright-workflow.js";
import { mediaArtifactRoot, selectMediaQueue } from "../../core/media-processing.js";
import { mediaJobCostUnits } from "../../core/media-resource-budgets.js";
import { resolveReviewAssetCapabilities } from "./review-capabilities.js";
import { sendStoredResource } from "./resource-delivery.js";

type ReviewExportRouteHelpers = {
  parseObject: (value: unknown) => Record<string, any>;
};

function metadataExportVariantKey(asset: any, selection: MetadataExportSelection) {
  const canonical = JSON.stringify({
    policy: selection.policy,
    preserveTechnicalRenderingMetadata: selection.preserveTechnicalRenderingMetadata !== false,
    includeCategories: [...(selection.includeCategories || [])].map(String).sort(),
    excludeSensitiveCategories: [...(selection.excludeSensitiveCategories || [])].map(String).sort(),
    sourceChecksumSha256: asset.checksumSha256 || null,
  });
  return `${selection.policy}-${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`.slice(0, 80);
}

function exportFileName(asset: any, policy: string, filePath: string) {
  const extension = path.extname(filePath).replace(/[^.A-Za-z0-9]/g, "").slice(0, 12);
  const safeBase = String(asset.title || "asset").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "asset";
  return `${safeBase}-${String(policy || "safe-share").replace(/_/g, "-")}${extension}`;
}

export function registerReviewAssetExportRoutes(deps: ServerRouteRegistrationDeps, helpers: ReviewExportRouteHelpers) {
  const app = deps.app;
  const { authorization, getCurrentUser, jobQueue, logActivity, prisma, resolveProjectStoredFile } = deps;
  const { parseObject } = helpers;

  async function queueSanitizedExportForAsset(input: { asset: any; selection: MetadataExportSelection; variantKey: string; requestedById?: string | null }) {
    const activeRecords = await prisma.projectControlRecord.findMany({
      where: { projectId: input.asset.projectId, kind: "media_job", archived: false, status: { in: ["queued", "processing", "retrying"] } },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    if (activeRecords.length >= 40) throw Object.assign(new Error("This project already has too many pending media jobs."), { code: "MEDIA_PROCESSING_QUEUE_PRESSURE", statusCode: 429 });
    const duplicate = activeRecords.find((record: any) => {
      const payload = parseObject(record.payload);
      return record.linkedEntityId === input.asset.id && payload.job === "sanitized_export" && payload.exportVariantKey === input.variantKey;
    });
    if (duplicate) return { id: duplicate.id, title: duplicate.title, status: duplicate.status, duplicate: true, backgroundJobId: parseObject(duplicate.payload).backgroundJobId || null };

    const routing = await selectMediaQueue(prisma, "sanitized_export", input.asset.medium, "software");
    const record = await prisma.projectControlRecord.create({ data: {
      projectId: input.asset.projectId,
      kind: "media_job",
      title: `sanitized export · ${input.asset.title}`,
      status: "queued",
      priority: "medium",
      category: "media-processing",
      linkedEntityType: "review_asset",
      linkedEntityId: input.asset.id,
      payload: JSON.stringify({
        job: "sanitized_export",
        assetId: input.asset.id,
        requestedById: input.requestedById || null,
        requestedAt: new Date().toISOString(),
        workerBlock: "I",
        routing,
        source: "viewer_export",
        metadataPolicy: input.selection.policy,
        exportVariantKey: input.variantKey,
      }),
    } });
    try {
      const backgroundJob = await jobQueue.enqueue({
        type: "media.sanitized_export",
        queue: routing.queue,
        payload: {
          assetId: input.asset.id,
          controlRecordId: record.id,
          requestedById: input.requestedById || null,
          metadataExportSelection: input.selection,
          exportVariantKey: input.variantKey,
        },
        priority: 20,
        costUnits: mediaJobCostUnits({ sizeBytes: input.asset.sizeBytes, job: "sanitized_export" }),
        maxAttempts: 5,
        dedupeKey: `media:${input.asset.id}:sanitized_export:${input.variantKey}`,
        createdById: input.requestedById || null,
      });
      await prisma.projectControlRecord.update({
        where: { id: record.id },
        data: { payload: JSON.stringify({ ...parseObject(record.payload), backgroundJobId: backgroundJob.id, queue: backgroundJob.queue, durableType: backgroundJob.type }), revision: { increment: 1 } },
      });
      await prisma.reviewAsset.update({ where: { id: input.asset.id }, data: { processingState: "queued" } });
      return { id: record.id, title: record.title, status: record.status, backgroundJobId: backgroundJob.id, duplicate: false, routing };
    } catch (error) {
      await prisma.projectControlRecord.update({
        where: { id: record.id },
        data: { status: "failed", payload: JSON.stringify({ ...parseObject(record.payload), lastError: error instanceof Error ? error.message : String(error) }), revision: { increment: 1 } },
      });
      throw error;
    }
  }

  app.get("/api/review-assets/:assetId/download", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);
    if (!capabilities.downloadOriginal) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Original download is not permitted for this asset." });
    if (await isCopyrightResourceDisabled(prisma, "review_asset", asset.id)) return copyrightDisabledResponse(reply);
    const fullPath = await resolveProjectStoredFile(asset.projectId, "review_asset", asset.fileName, asset.medium);
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: asset.mimeType || "application/octet-stream",
      originalName: asset.originalName,
      checksumSha256: asset.checksumSha256,
      requestedInline: false,
      cacheControl: "private, max-age=0, must-revalidate",
    });
  });

  app.post("/api/review-assets/:assetId/exports", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const body = z.object({
      policy: z.enum(METADATA_EXPORT_POLICIES).default("safe_share"),
      preserveTechnicalRenderingMetadata: z.boolean().optional(),
      includeCategories: z.array(z.string().trim().min(1).max(80)).max(64).optional(),
      excludeSensitiveCategories: z.array(z.enum(SENSITIVE_METADATA_CATEGORIES)).max(SENSITIVE_METADATA_CATEGORIES.length).optional(),
    }).strict().parse(request.body || {});
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);

    if (body.policy === "preserve") {
      if (!capabilities.downloadOriginal) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Preserving source metadata requires original-download permission." });
      await logActivity({ userId: user?.id, projectId: asset.projectId, type: "exported", entityType: "review_asset", entityId: asset.id, title: "Original asset export requested", message: "Preserve metadata policy", metadata: { policy: "preserve" } });
      await deps.logSecurityEvent?.({ event: "review_asset.export", actorUserId: user?.id || null, workspaceId: asset.projectId, result: "SUCCESS", reasonCode: "REVIEW_ASSET_EXPORT_PRESERVE", request, metadata: { assetId: asset.id, policy: "preserve" } });
      return { status: "ready", policy: "preserve", downloadUrl: `/api/review-assets/${asset.id}/download`, fileName: asset.originalName, checksumSha256: asset.checksumSha256 || null };
    }

    if (!capabilities.exportDerivative) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Derivative export is not permitted for this asset." });
    if (body.policy === "custom" && !capabilities.chooseMetadataPreservationPolicy) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Custom metadata export policy requires review-asset manage permission." });
    const requestedSensitive = (body.includeCategories || []).some((value) => value.startsWith("sensitive.") || (SENSITIVE_METADATA_CATEGORIES as readonly string[]).includes(value));
    if (requestedSensitive && !capabilities.viewSensitiveMetadata) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Retaining sensitive metadata requires sensitive-metadata permission." });
    if (!assetProcessingJobSupportedForMedium(asset.medium as ReviewMedium, "sanitized_export")) return reply.code(409).send({ code: "MEDIA_SANITIZED_EXPORT_UNSUPPORTED", message: `Sanitized export is not registered for ${asset.medium} assets.` });

    const selection: MetadataExportSelection = {
      policy: body.policy,
      preserveTechnicalRenderingMetadata: body.preserveTechnicalRenderingMetadata !== false,
      includeCategories: body.includeCategories,
      excludeSensitiveCategories: body.excludeSensitiveCategories,
    };
    const variantKey = metadataExportVariantKey(asset, selection);
    const existing = await prisma.assetArtifact.findUnique({ where: { reviewAssetId_kind_variantKey: { reviewAssetId: asset.id, kind: "sanitized_export", variantKey } } });
    if (existing && (!asset.checksumSha256 || existing.sourceChecksumSha256 === asset.checksumSha256)) {
      try {
        await fs.access(existing.fileName);
        return {
          status: "ready",
          policy: body.policy,
          variantKey,
          artifactId: existing.id,
          downloadUrl: `/api/review-assets/${asset.id}/exports/${encodeURIComponent(variantKey)}`,
          fileName: exportFileName(asset, body.policy, existing.fileName),
          checksumSha256: existing.checksumSha256,
        };
      } catch {
        // Missing managed cache artifact is regenerated below.
      }
    }

    try {
      const queued = await queueSanitizedExportForAsset({ asset, selection, variantKey, requestedById: user?.id || null });
      await logActivity({ userId: user?.id, projectId: asset.projectId, type: "queued", entityType: "review_asset_export", entityId: asset.id, title: "Sanitized asset export queued", message: `${body.policy} metadata policy`, metadata: { policy: body.policy, variantKey } });
      await deps.logSecurityEvent?.({ event: "review_asset.export", actorUserId: user?.id || null, workspaceId: asset.projectId, result: "SUCCESS", reasonCode: "REVIEW_ASSET_EXPORT_DERIVATIVE_QUEUED", request, metadata: { assetId: asset.id, policy: body.policy, variantKey } });
      return reply.code(202).send({ status: "queued", policy: body.policy, variantKey, job: queued });
    } catch (error: any) {
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) return reply.code(error.statusCode).send({ code: error.code || "MEDIA_EXPORT_REQUEST_REJECTED", message: error.message });
      throw error;
    }
  });

  app.get("/api/review-assets/:assetId/exports", async (request, reply) => {
    const params = z.object({ assetId: z.string() }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);
    if (!capabilities.exportDerivative) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Derivative export is not permitted for this asset." });
    const artifacts = await prisma.assetArtifact.findMany({ where: { reviewAssetId: asset.id, kind: "sanitized_export" }, orderBy: { updatedAt: "desc" }, take: 32 });
    return {
      items: artifacts.map((artifact: any) => ({
        id: artifact.id,
        variantKey: artifact.variantKey,
        metadataPolicy: artifact.metadataPolicy,
        sizeBytes: Number(artifact.sizeBytes || 0),
        checksumSha256: artifact.checksumSha256,
        sourceChecksumSha256: artifact.sourceChecksumSha256 || null,
        generatedAt: artifact.derivativeGeneratedAt || artifact.updatedAt,
        stale: Boolean(asset.checksumSha256 && artifact.sourceChecksumSha256 !== asset.checksumSha256),
        downloadUrl: `/api/review-assets/${asset.id}/exports/${encodeURIComponent(artifact.variantKey)}`,
        fileName: exportFileName(asset, artifact.metadataPolicy || "safe_share", artifact.fileName),
      })),
    };
  });

  app.get("/api/review-assets/:assetId/exports/:variantKey", async (request, reply) => {
    const params = z.object({ assetId: z.string(), variantKey: z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/) }).parse(request.params);
    const asset = await prisma.reviewAsset.findUnique({ where: { id: params.assetId } });
    if (!asset) return reply.code(404).send({ code: "REVIEW_ASSET_NOT_FOUND", message: "Review asset not found." });
    const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
    if (!project || !(await authorization.requireTarget(request, reply, "review_asset", asset.id, project, "view"))) return;
    const capabilities = await resolveReviewAssetCapabilities(authorization, request, asset, project);
    if (!capabilities.exportDerivative) return reply.code(403).send({ code: "ACCESS_DENIED", message: "Derivative export is not permitted for this asset." });
    if (await isCopyrightResourceDisabled(prisma, "review_asset", asset.id)) return copyrightDisabledResponse(reply);
    const artifact = await prisma.assetArtifact.findUnique({ where: { reviewAssetId_kind_variantKey: { reviewAssetId: asset.id, kind: "sanitized_export", variantKey: params.variantKey } } });
    if (!artifact) return reply.code(404).send({ code: "MEDIA_ARTIFACT_NOT_FOUND", message: "Sanitized export is not available." });
    if (asset.checksumSha256 && artifact.sourceChecksumSha256 !== asset.checksumSha256) return reply.code(409).send({ code: "MEDIA_ARTIFACT_STALE", message: "This export belongs to an older source revision and must be regenerated." });
    const root = path.resolve(await mediaArtifactRoot(prisma, asset.projectId));
    const fullPath = path.resolve(artifact.fileName);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) return reply.code(409).send({ code: "MEDIA_ARTIFACT_PATH_INVALID", message: "Generated export path is outside the managed cache." });
    try {
      await fs.access(fullPath);
    } catch {
      return reply.code(404).send({ code: "MEDIA_ARTIFACT_FILE_MISSING", message: "Generated export file is missing." });
    }
    return sendStoredResource(request, reply, {
      filePath: fullPath,
      mimeType: artifact.mimeType || "application/octet-stream",
      originalName: exportFileName(asset, artifact.metadataPolicy || "safe_share", fullPath),
      checksumSha256: artifact.checksumSha256,
      requestedInline: false,
      cacheControl: "private, max-age=0, must-revalidate",
    });
  });
}
