import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  COPYRIGHT_EVIDENCE_MAX_FILES,
  COPYRIGHT_REPEAT_REVIEW_COUNT,
  COPYRIGHT_RESOURCE_TYPES,
  addBusinessDays,
  copyrightCounterNoticeHash,
  copyrightDisabledResponse,
  copyrightNoticeHash,
  generateCopyrightCaseReference,
  generateCopyrightCaseToken,
  hashCopyrightCaseToken,
  resolveCopyrightEvidencePath,
  safePublicCopyrightCase,
  sanitizeCopyrightEventMetadata,
  writeCopyrightEvidence,
} from "../../core/copyright-workflow.js";
import { safeFileName, untrustedFileResponseHeaders } from "../../core/uploads.js";

const resourceTypeSchema = z.enum(COPYRIGHT_RESOURCE_TYPES);
const evidenceSchema = z.object({
  originalName: z.string().trim().min(1).max(180),
  dataUrl: z.string().min(1).max(3_000_000),
  evidenceType: z.string().trim().min(1).max(64).optional().default("supporting"),
});
const publicNoticeSchema = z.object({
  reporterName: z.string().trim().min(2).max(200),
  reporterEmail: z.string().trim().email().max(320),
  reporterCompany: z.string().trim().max(200).optional().nullable(),
  reporterAddress: z.string().trim().min(5).max(1000),
  reporterPhone: z.string().trim().max(80).optional().nullable(),
  copyrightOwnerName: z.string().trim().min(2).max(200),
  authorizedAgent: z.boolean().default(false),
  copyrightWorkDescription: z.string().trim().min(10).max(30_000),
  infringingMaterialDescription: z.string().trim().min(10).max(30_000),
  infringingLocation: z.string().trim().min(3).max(4_000),
  resourceType: resourceTypeSchema.optional().nullable(),
  resourceId: z.string().trim().min(1).max(120).optional().nullable(),
  resourceUrl: z.string().trim().max(4_000).optional().nullable(),
  signatureText: z.string().trim().min(2).max(300),
  goodFaithAttested: z.literal(true),
  accuracyAuthorityAttested: z.literal(true),
  evidence: z.array(evidenceSchema).max(COPYRIGHT_EVIDENCE_MAX_FILES).optional().default([]),
});
const counterSchema = z.object({
  submitterName: z.string().trim().min(2).max(200),
  submitterEmail: z.string().trim().email().max(320),
  submitterAddress: z.string().trim().min(5).max(1000),
  submitterPhone: z.string().trim().max(80).optional().nullable(),
  signatureText: z.string().trim().min(2).max(300),
  materialDescription: z.string().trim().min(10).max(30_000),
  previousLocation: z.string().trim().min(3).max(4_000),
  mistakeAttested: z.literal(true),
  jurisdictionAttested: z.literal(true),
  serviceAttested: z.literal(true),
  evidence: z.array(evidenceSchema).max(COPYRIGHT_EVIDENCE_MAX_FILES).optional().default([]),
});

function tokenMatches(expectedHash: string, token: string) {
  const actual = Buffer.from(hashCopyrightCaseToken(token), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

async function addEvent(prisma: any, caseId: string, eventType: string, message: string, options: { actorUserId?: string | null; audience?: "internal" | "public" | "both"; metadata?: Record<string, unknown> } = {}) {
  return prisma.copyrightCaseEvent.create({
    data: {
      caseId,
      actorUserId: options.actorUserId || null,
      eventType,
      audience: options.audience || "internal",
      message: String(message || "").slice(0, 2000),
      metadata: sanitizeCopyrightEventMetadata(options.metadata || {}),
    },
  });
}

async function resolveResource(prisma: any, resourceType?: string | null, resourceId?: string | null) {
  if (!resourceType || !resourceId) return null;
  if (resourceType === "library") {
    const item = await prisma.libraryItem.findUnique({ where: { id: resourceId }, select: { id: true, title: true, ownerId: true, projectId: true } });
    return item ? { resourceType, resourceId: item.id, uploaderUserId: item.ownerId || null, title: item.title, projectId: item.projectId || null } : null;
  }
  if (resourceType === "project_file") {
    const item = await prisma.projectFile.findUnique({ where: { id: resourceId }, select: { id: true, title: true, uploadedById: true, projectId: true } });
    return item ? { resourceType, resourceId: item.id, uploaderUserId: item.uploadedById || null, title: item.title, projectId: item.projectId } : null;
  }
  if (resourceType === "review_asset") {
    const item = await prisma.reviewAsset.findUnique({ where: { id: resourceId }, select: { id: true, title: true, uploadedById: true, projectId: true } });
    return item ? { resourceType, resourceId: item.id, uploaderUserId: item.uploadedById || null, title: item.title, projectId: item.projectId } : null;
  }
  return null;
}

function serializeAdminCase(record: any, strikeCount = 0) {
  return {
    ...record,
    publicTokenHash: undefined,
    activeStrikeCount: strikeCount,
    repeatInfringerReviewRecommended: strikeCount >= COPYRIGHT_REPEAT_REVIEW_COUNT,
  };
}

export function registerCopyrightWorkflowRoutes(deps: Record<string, any>) {
  const app: FastifyInstance = deps.app;
  const { prisma, dataLayout, getCurrentUser, authorization, logActivity, logSecurityEvent } = deps;
  const uploadsRoot = dataLayout?.uploadsRoot;

  app.post("/api/public/copyright/reports", async (request, reply) => {
    const body = publicNoticeSchema.parse(request.body || {});
    const caseId = crypto.randomUUID();
    const publicReference = generateCopyrightCaseReference();
    const publicToken = generateCopyrightCaseToken();
    const linked = await resolveResource(prisma, body.resourceType, body.resourceId).catch(() => null);
    let evidence: Awaited<ReturnType<typeof writeCopyrightEvidence>> = [];
    try {
      evidence = await writeCopyrightEvidence({ uploadsRoot, caseId, entries: body.evidence });
      const noticePayload = {
        reporterName: body.reporterName,
        reporterEmail: body.reporterEmail.toLowerCase(),
        reporterCompany: body.reporterCompany || null,
        reporterAddress: body.reporterAddress,
        reporterPhone: body.reporterPhone || null,
        copyrightOwnerName: body.copyrightOwnerName,
        authorizedAgent: body.authorizedAgent,
        copyrightWorkDescription: body.copyrightWorkDescription,
        infringingMaterialDescription: body.infringingMaterialDescription,
        infringingLocation: body.infringingLocation,
        resourceType: linked?.resourceType || body.resourceType || null,
        resourceId: linked?.resourceId || body.resourceId || null,
        resourceUrl: body.resourceUrl || null,
        signatureText: body.signatureText,
        goodFaithAttested: true,
        accuracyAuthorityAttested: true,
        evidence: evidence.map((entry) => ({ sha256: entry.sha256, sizeBytes: entry.sizeBytes, mimeType: entry.mimeType })),
      };
      const created = await prisma.$transaction(async (tx: any) => {
        const copyrightCase = await tx.copyrightCase.create({
          data: {
            id: caseId,
            publicReference,
            publicTokenHash: hashCopyrightCaseToken(publicToken),
            jurisdiction: "us_dmca",
            status: "submitted",
            ...noticePayload,
            uploaderUserId: linked?.uploaderUserId || null,
            noticeHash: copyrightNoticeHash(noticePayload),
          },
        });
        if (evidence.length) await tx.copyrightEvidence.createMany({ data: evidence.map((entry) => ({ caseId, ...entry })) });
        await tx.copyrightCaseEvent.create({ data: { caseId, eventType: "notice_submitted", audience: "both", message: "Copyright notice received for operator review.", metadata: "{}" } });
        return copyrightCase;
      });
      await logSecurityEvent?.({ event: "copyright.notice_submitted", result: "SUCCESS", reasonCode: "PUBLIC_COPYRIGHT_NOTICE", request, metadata: { caseId: created.id, publicReference } }).catch(() => undefined);
      reply.header("Cache-Control", "no-store");
      reply.code(201);
      return {
        ok: true,
        caseReference: publicReference,
        accessToken: publicToken,
        statusPath: "/legal/copyright/report",
        message: "Copyright notice received. Save the case reference and private access token to view case updates.",
      };
    } catch (error) {
      await fs.rm(path.resolve(uploadsRoot, "copyright-cases", caseId), { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });

  app.post("/api/public/copyright/cases/status", async (request, reply) => {
    const body = z.object({ reference: z.string().trim().min(8).max(80), token: z.string().trim().min(20).max(200) }).parse(request.body || {});
    const record = await prisma.copyrightCase.findUnique({
      where: { publicReference: body.reference },
      include: { counterNotice: true, events: { orderBy: { createdAt: "asc" }, take: 200 } },
    });
    if (!record || !tokenMatches(record.publicTokenHash, body.token)) return reply.code(404).send({ ok: false, code: "COPYRIGHT_CASE_NOT_FOUND", error: "Copyright case reference or access token is invalid." });
    const publicCase: any = safePublicCopyrightCase(record);
    if (record.counterNotice?.forwardedAt) {
      publicCase.forwardedCounterNotice = {
        submitterName: record.counterNotice.submitterName,
        submitterEmail: record.counterNotice.submitterEmail,
        submitterAddress: record.counterNotice.submitterAddress,
        submitterPhone: record.counterNotice.submitterPhone,
        signatureText: record.counterNotice.signatureText,
        materialDescription: record.counterNotice.materialDescription,
        previousLocation: record.counterNotice.previousLocation,
        mistakeAttested: record.counterNotice.mistakeAttested,
        jurisdictionAttested: record.counterNotice.jurisdictionAttested,
        serviceAttested: record.counterNotice.serviceAttested,
        contentHash: record.counterNotice.contentHash,
      };
    }
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, case: publicCase };
  });

  app.get("/api/copyright/cases", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." });
    const items = await prisma.copyrightCase.findMany({ where: { uploaderUserId: user.id }, include: { counterNotice: true, restriction: true }, orderBy: { submittedAt: "desc" }, take: 100 });
    return { ok: true, items: items.map((item: any) => ({ id: item.id, reference: item.publicReference, status: item.status, submittedAt: item.submittedAt, disabledAt: item.disabledAt, restoredAt: item.restoredAt, resourceType: item.resourceType, resourceId: item.resourceId, counterNotice: item.counterNotice ? { status: item.counterNotice.status, submittedAt: item.counterNotice.submittedAt, restorationEligibleAt: item.counterNotice.restorationEligibleAt, restorationDeadlineAt: item.counterNotice.restorationDeadlineAt } : null })) };
  });

  app.get("/api/copyright/cases/:caseId", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." });
    const params = z.object({ caseId: z.string().min(1).max(100) }).parse(request.params);
    const item = await prisma.copyrightCase.findUnique({ where: { id: params.caseId }, include: { counterNotice: true, events: { where: { audience: { in: ["both", "uploader"] } }, orderBy: { createdAt: "asc" } } } });
    if (!item || item.uploaderUserId !== user.id) return reply.code(404).send({ ok: false, code: "COPYRIGHT_CASE_NOT_FOUND", error: "Copyright case not found." });
    return { ok: true, case: { id: item.id, reference: item.publicReference, status: item.status, infringingMaterialDescription: item.infringingMaterialDescription, infringingLocation: item.infringingLocation, resourceType: item.resourceType, resourceId: item.resourceId, disabledAt: item.disabledAt, restoredAt: item.restoredAt, counterNotice: item.counterNotice, events: item.events } };
  });

  app.post("/api/copyright/cases/:caseId/counter-notice", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." });
    const params = z.object({ caseId: z.string().min(1).max(100) }).parse(request.params);
    const body = counterSchema.parse(request.body || {});
    const copyrightCase = await prisma.copyrightCase.findUnique({ where: { id: params.caseId }, include: { counterNotice: true } });
    if (!copyrightCase || copyrightCase.uploaderUserId !== user.id) return reply.code(404).send({ ok: false, code: "COPYRIGHT_CASE_NOT_FOUND", error: "Copyright case not found." });
    if (!copyrightCase.disabledAt || copyrightCase.restoredAt) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_AVAILABLE", error: "A counter-notice is available only while the material is disabled." });
    if (copyrightCase.counterNotice) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_ALREADY_SUBMITTED", error: "A counter-notice has already been submitted for this case." });
    const submittedAt = new Date();
    const restorationEligibleAt = addBusinessDays(submittedAt, 10);
    const restorationDeadlineAt = addBusinessDays(submittedAt, 14);
    const contentPayload = {
      submitterName: body.submitterName,
      submitterEmail: body.submitterEmail.toLowerCase(),
      submitterAddress: body.submitterAddress,
      submitterPhone: body.submitterPhone || null,
      signatureText: body.signatureText,
      materialDescription: body.materialDescription,
      previousLocation: body.previousLocation,
      mistakeAttested: true,
      jurisdictionAttested: true,
      serviceAttested: true,
    };
    let evidence: Awaited<ReturnType<typeof writeCopyrightEvidence>> = [];
    try {
      evidence = await writeCopyrightEvidence({ uploadsRoot, caseId: copyrightCase.id, entries: body.evidence.map((entry) => ({ ...entry, evidenceType: entry.evidenceType || "counter_supporting" })) });
      const counter = await prisma.$transaction(async (tx: any) => {
        const created = await tx.copyrightCounterNotice.create({ data: { caseId: copyrightCase.id, submitterUserId: user.id, ...contentPayload, contentHash: copyrightCounterNoticeHash(contentPayload), submittedAt, restorationEligibleAt, restorationDeadlineAt } });
        if (evidence.length) await tx.copyrightEvidence.createMany({ data: evidence.map((entry) => ({ caseId: copyrightCase.id, counterNoticeId: created.id, ...entry })) });
        await tx.copyrightCase.update({ where: { id: copyrightCase.id }, data: { status: "counter_received" } });
        await tx.copyrightCaseEvent.create({ data: { caseId: copyrightCase.id, actorUserId: user.id, eventType: "counter_notice_received", audience: "both", message: "A counter-notice was received and is awaiting operator forwarding to the original reporter.", metadata: JSON.stringify({ restorationEligibleAt: restorationEligibleAt.toISOString(), restorationDeadlineAt: restorationDeadlineAt.toISOString() }) } });
        return created;
      });
      await logActivity?.({ userId: user.id, type: "copyright", entityType: "copyright-case", entityId: copyrightCase.id, title: "Copyright counter-notice submitted", message: copyrightCase.publicReference, metadata: { targetUserId: copyrightCase.reviewerUserId || undefined } }).catch(() => undefined);
      return { ok: true, counterNotice: { id: counter.id, status: counter.status, submittedAt, restorationEligibleAt, restorationDeadlineAt } };
    } catch (error) {
      await Promise.all(evidence.map((entry) => fs.rm(path.resolve(uploadsRoot, "copyright-cases", copyrightCase.id, entry.storedName), { force: true }).catch(() => undefined)));
      throw error;
    }
  });

  app.get("/api/admin/copyright/cases", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply); if (!admin) return;
    const query = z.object({ status: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(250).optional().default(100) }).parse(request.query || {});
    const items = await prisma.copyrightCase.findMany({ where: query.status && query.status !== "all" ? { status: query.status } : {}, include: { counterNotice: true, restriction: true, strikes: { where: { status: "active" } } }, orderBy: { submittedAt: "desc" }, take: query.limit });
    return { ok: true, items: items.map((item: any) => serializeAdminCase(item, item.strikes?.length || 0)) };
  });

  app.get("/api/admin/copyright/cases/:caseId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply); if (!admin) return;
    const params = z.object({ caseId: z.string().min(1).max(100) }).parse(request.params);
    const item = await prisma.copyrightCase.findUnique({ where: { id: params.caseId }, include: { counterNotice: true, restriction: true, evidence: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } }, strikes: true } });
    if (!item) return reply.code(404).send({ ok: false, code: "COPYRIGHT_CASE_NOT_FOUND", error: "Copyright case not found." });
    const activeStrikeCount = item.uploaderUserId ? await prisma.copyrightStrike.count({ where: { userId: item.uploaderUserId, status: "active" } }) : 0;
    return { ok: true, case: serializeAdminCase(item, activeStrikeCount) };
  });

  app.get("/api/admin/copyright/cases/:caseId/evidence/:evidenceId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply); if (!admin) return;
    const params = z.object({ caseId: z.string().min(1).max(100), evidenceId: z.string().min(1).max(100) }).parse(request.params);
    const evidence = await prisma.copyrightEvidence.findFirst({ where: { id: params.evidenceId, caseId: params.caseId } });
    if (!evidence) return reply.code(404).send({ ok: false, code: "COPYRIGHT_EVIDENCE_NOT_FOUND", error: "Copyright evidence not found." });
    const resolved = await resolveCopyrightEvidencePath(uploadsRoot, params.caseId, evidence.storedName);
    reply.header("Content-Type", evidence.mimeType);
    reply.header("Content-Length", String(resolved.stat.size));
    reply.header("Content-Disposition", `attachment; filename="${safeFileName(evidence.originalName)}"`);
    reply.header("Cache-Control", "private, no-store");
    for (const [key, value] of Object.entries(untrustedFileResponseHeaders(evidence.mimeType, evidence.originalName))) reply.header(key, value);
    return reply.send(createReadStream(resolved.path));
  });

  app.post("/api/admin/copyright/cases/:caseId/actions", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply); if (!admin) return;
    const actor = await getCurrentUser(request);
    const params = z.object({ caseId: z.string().min(1).max(100) }).parse(request.params);
    const body = z.object({
      action: z.enum(["acknowledge", "request_info", "assign_reviewer", "link_resource", "disable_access", "reject_notice", "forward_counter", "record_legal_action", "restore_access", "close", "apply_strike", "rescind_strike"]),
      note: z.string().trim().max(4000).optional().nullable(),
      reviewerUserId: z.string().trim().max(100).optional().nullable(),
      resourceType: resourceTypeSchema.optional().nullable(),
      resourceId: z.string().trim().max(120).optional().nullable(),
      externalDeliveryConfirmed: z.boolean().optional().default(false),
      restoreReason: z.enum(["counter_window", "notice_rejected", "administrative_correction"]).optional(),
    }).parse(request.body || {});
    const item = await prisma.copyrightCase.findUnique({ where: { id: params.caseId }, include: { counterNotice: true, restriction: true } });
    if (!item) return reply.code(404).send({ ok: false, code: "COPYRIGHT_CASE_NOT_FOUND", error: "Copyright case not found." });
    const actorId = actor?.id || null;
    const now = new Date();

    if (body.action === "acknowledge") {
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { status: "under_review", acknowledgedAt: item.acknowledgedAt || now } });
      await addEvent(prisma, item.id, "notice_acknowledged", "Copyright notice acknowledged for review.", { actorUserId: actorId, audience: "both" });
    } else if (body.action === "request_info") {
      if (!body.note) return reply.code(400).send({ ok: false, code: "COPYRIGHT_ACTION_NOTE_REQUIRED", error: "A request-for-information note is required." });
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { status: "needs_info", needsInfoNote: body.note, acknowledgedAt: item.acknowledgedAt || now } });
      await addEvent(prisma, item.id, "more_information_requested", "The operator requested additional information from the reporter.", { actorUserId: actorId, audience: "public" });
    } else if (body.action === "assign_reviewer") {
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { reviewerUserId: body.reviewerUserId || null } });
      await addEvent(prisma, item.id, "reviewer_assigned", "Copyright case reviewer assignment changed.", { actorUserId: actorId, metadata: { reviewerUserId: body.reviewerUserId || null } });
    } else if (body.action === "link_resource") {
      if (item.restriction) return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESOURCE_LOCKED", error: "A case that has already restricted material cannot be relinked to a different resource." });
      const linked = await resolveResource(prisma, body.resourceType, body.resourceId);
      if (!linked) return reply.code(404).send({ ok: false, code: "COPYRIGHT_RESOURCE_NOT_FOUND", error: "The Cluster resource could not be resolved." });
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { resourceType: linked.resourceType, resourceId: linked.resourceId, uploaderUserId: linked.uploaderUserId } });
      await addEvent(prisma, item.id, "resource_linked", "The reported material was linked to a Cluster-managed resource.", { actorUserId: actorId, metadata: { resourceType: linked.resourceType, resourceId: linked.resourceId } });
    } else if (body.action === "disable_access") {
      const linked = await resolveResource(prisma, item.resourceType, item.resourceId);
      if (!linked) return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESOURCE_REQUIRED", error: "Link the case to a Cluster-managed resource before disabling access." });
      const occupied = await prisma.copyrightResourceRestriction.findFirst({ where: { resourceType: linked.resourceType, resourceId: linked.resourceId, state: "disabled" } });
      if (occupied && occupied.caseId !== item.id) return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESOURCE_ALREADY_DISABLED", error: "This resource is already disabled by another copyright case." });
      try {
        await prisma.$transaction(async (tx: any) => {
          await tx.copyrightResourceRestriction.upsert({
          where: { caseId: item.id },
          create: { caseId: item.id, resourceType: linked.resourceType, resourceId: linked.resourceId, state: "disabled", disabledAt: now, disabledById: actorId, reason: body.note || "Copyright review" },
          update: { resourceType: linked.resourceType, resourceId: linked.resourceId, state: "disabled", disabledAt: now, disabledById: actorId, restoredAt: null, restoredById: null, reason: body.note || "Copyright review" },
        });
        await tx.copyrightCase.update({ where: { id: item.id }, data: { status: "disabled", disabledAt: now, restoredAt: null, uploaderUserId: linked.uploaderUserId } });
          await tx.copyrightCaseEvent.create({ data: { caseId: item.id, actorUserId: actorId, eventType: "access_disabled", audience: "both", message: "Access to the reported material was disabled while the copyright matter is handled.", metadata: JSON.stringify({ resourceType: linked.resourceType, resourceId: linked.resourceId }) } });
        });
      } catch (error: any) {
        if (String(error?.code || "") === "P2002") return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESOURCE_ALREADY_DISABLED", error: "This resource was concurrently disabled by another copyright case." });
        throw error;
      }
      if (linked.uploaderUserId) await logActivity?.({ userId: actorId, projectId: linked.projectId || undefined, type: "copyright", entityType: linked.resourceType, entityId: linked.resourceId, title: "Content access disabled for copyright review", message: item.publicReference, metadata: { targetUserId: linked.uploaderUserId, href: `/legal/copyright/counter?case=${encodeURIComponent(item.id)}` } }).catch(() => undefined);
    } else if (body.action === "reject_notice") {
      if (item.restriction?.state === "disabled") return reply.code(409).send({ ok: false, code: "COPYRIGHT_ACTIVE_RESTRICTION", error: "Restore access before rejecting a case that currently disables material." });
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { status: "rejected", closedAt: now } });
      await addEvent(prisma, item.id, "notice_rejected", "The operator closed the copyright notice without disabling the reported material.", { actorUserId: actorId, audience: "public" });
    } else if (body.action === "forward_counter") {
      if (!item.counterNotice) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_AVAILABLE", error: "No counter-notice has been submitted." });
      if (item.counterNotice.forwardedAt) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_AVAILABLE", error: "This counter-notice is already recorded as forwarded." });
      if (!body.externalDeliveryConfirmed) return reply.code(400).send({ ok: false, code: "COPYRIGHT_COUNTER_FORWARD_CONFIRMATION_REQUIRED", error: "Confirm that the counter-notice copy was forwarded to the original reporter using the recorded contact information." });
      await prisma.$transaction(async (tx: any) => {
        await tx.copyrightCounterNotice.update({ where: { id: item.counterNotice.id }, data: { status: "forwarded", forwardedAt: now } });
        await tx.copyrightCase.update({ where: { id: item.id }, data: { status: "counter_forwarded" } });
        await tx.copyrightCaseEvent.create({ data: { caseId: item.id, actorUserId: actorId, eventType: "counter_notice_forwarded", audience: "both", message: "The counter-notice was forwarded to the original reporter. The restoration window is being tracked.", metadata: JSON.stringify({ restorationEligibleAt: item.counterNotice.restorationEligibleAt, restorationDeadlineAt: item.counterNotice.restorationDeadlineAt }) } });
      });
    } else if (body.action === "record_legal_action") {
      if (!item.counterNotice) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_AVAILABLE", error: "No counter-notice exists for this case." });
      if (!item.counterNotice.forwardedAt) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_FORWARDED", error: "Record counter-notice forwarding before recording legal action in the counter-notice workflow." });
      if (!body.note) return reply.code(400).send({ ok: false, code: "COPYRIGHT_ACTION_NOTE_REQUIRED", error: "Record the court-action reference or review note." });
      await prisma.$transaction(async (tx: any) => {
        await tx.copyrightCounterNotice.update({ where: { id: item.counterNotice.id }, data: { status: "legal_hold", legalActionReceivedAt: now } });
        await tx.copyrightCase.update({ where: { id: item.id }, data: { status: "legal_hold", legalActionReceivedAt: now } });
        await tx.copyrightCaseEvent.create({ data: { caseId: item.id, actorUserId: actorId, eventType: "legal_action_recorded", audience: "both", message: "The operator recorded notice of legal action; automatic restoration is blocked pending legal review.", metadata: sanitizeCopyrightEventMetadata({ note: body.note }) } });
      });
    } else if (body.action === "restore_access") {
      if (!item.restriction || item.restriction.state !== "disabled") return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESOURCE_NOT_DISABLED", error: "The linked resource is not currently disabled by this case." });
      const reason = body.restoreReason || "administrative_correction";
      if (reason === "counter_window") {
        if (!item.counterNotice?.forwardedAt) return reply.code(409).send({ ok: false, code: "COPYRIGHT_COUNTER_NOT_FORWARDED", error: "The counter-notice must be forwarded before using the counter-notice restoration window." });
        if (item.counterNotice.legalActionReceivedAt || item.legalActionReceivedAt) return reply.code(409).send({ ok: false, code: "COPYRIGHT_LEGAL_HOLD", error: "Recorded legal action blocks restoration through the counter-notice window." });
        if (!item.counterNotice.restorationEligibleAt || now < new Date(item.counterNotice.restorationEligibleAt)) return reply.code(409).send({ ok: false, code: "COPYRIGHT_RESTORE_TOO_EARLY", error: "The 10-business-day minimum restoration period has not elapsed." });
      } else if (!body.note) {
        return reply.code(400).send({ ok: false, code: "COPYRIGHT_ACTION_NOTE_REQUIRED", error: "Administrative restoration requires a reason note." });
      }
      await prisma.$transaction(async (tx: any) => {
        await tx.copyrightResourceRestriction.update({ where: { id: item.restriction.id }, data: { state: "restored", restoredAt: now, restoredById: actorId } });
        await tx.copyrightCase.update({ where: { id: item.id }, data: { status: "restored", restoredAt: now } });
        if (item.counterNotice) await tx.copyrightCounterNotice.update({ where: { id: item.counterNotice.id }, data: { status: "restored" } });
        await tx.copyrightCaseEvent.create({ data: { caseId: item.id, actorUserId: actorId, eventType: "access_restored", audience: "both", message: "Access to the reported material was restored.", metadata: sanitizeCopyrightEventMetadata({ restoreReason: reason, note: body.note }) } });
      });
      if (item.uploaderUserId) await logActivity?.({ userId: actorId, type: "copyright", entityType: item.resourceType || "copyright-case", entityId: item.resourceId || item.id, title: "Content access restored", message: item.publicReference, metadata: { targetUserId: item.uploaderUserId } }).catch(() => undefined);
    } else if (body.action === "close") {
      if (item.restriction?.state === "disabled") return reply.code(409).send({ ok: false, code: "COPYRIGHT_ACTIVE_RESTRICTION", error: "Restore access before closing a case that currently disables material." });
      await prisma.copyrightCase.update({ where: { id: item.id }, data: { status: "closed", closedAt: now } });
      await addEvent(prisma, item.id, "case_closed", "The copyright case was closed.", { actorUserId: actorId, audience: "both" });
    } else if (body.action === "apply_strike") {
      if (!item.uploaderUserId) return reply.code(409).send({ ok: false, code: "COPYRIGHT_UPLOADER_UNKNOWN", error: "No Cluster user is associated with the reported material." });
      await prisma.copyrightStrike.upsert({ where: { caseId_userId: { caseId: item.id, userId: item.uploaderUserId } }, create: { caseId: item.id, userId: item.uploaderUserId, status: "active", reason: body.note || null, createdById: actorId }, update: { status: "active", reason: body.note || null, createdById: actorId, rescindedAt: null, rescindedById: null } });
      await addEvent(prisma, item.id, "repeat_infringer_strike_applied", "The operator recorded this case in the deployment's repeat-infringer review history.", { actorUserId: actorId });
    } else if (body.action === "rescind_strike") {
      if (!item.uploaderUserId) return reply.code(409).send({ ok: false, code: "COPYRIGHT_UPLOADER_UNKNOWN", error: "No Cluster user is associated with the reported material." });
      await prisma.copyrightStrike.updateMany({ where: { caseId: item.id, userId: item.uploaderUserId, status: "active" }, data: { status: "rescinded", rescindedAt: now, rescindedById: actorId } });
      await addEvent(prisma, item.id, "repeat_infringer_strike_rescinded", "The operator rescinded this case from active repeat-infringer review history.", { actorUserId: actorId });
    }
    await logSecurityEvent?.({ event: `copyright.case_${body.action}`, actorUserId: actorId, result: "SUCCESS", reasonCode: "COPYRIGHT_WORKFLOW_ACTION", request, metadata: { caseId: item.id, action: body.action } }).catch(() => undefined);
    const refreshed = await prisma.copyrightCase.findUnique({ where: { id: item.id }, include: { counterNotice: true, restriction: true, strikes: { where: { status: "active" } } } });
    return { ok: true, case: refreshed ? serializeAdminCase(refreshed, refreshed.strikes?.length || 0) : null };
  });

  app.get("/api/admin/copyright/repeat-infringers", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply); if (!admin) return;
    const grouped = await prisma.copyrightStrike.groupBy({ by: ["userId"], where: { status: "active" }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 250 });
    const users = await prisma.user.findMany({ where: { id: { in: grouped.map((entry: any) => entry.userId) } }, select: { id: true, username: true, displayName: true, archived: true, accountState: true } });
    const userMap = new Map(users.map((user: any) => [user.id, user]));
    return { ok: true, reviewThreshold: COPYRIGHT_REPEAT_REVIEW_COUNT, items: grouped.map((entry: any) => ({ user: userMap.get(entry.userId) || { id: entry.userId }, activeStrikes: entry._count._all, reviewRecommended: entry._count._all >= COPYRIGHT_REPEAT_REVIEW_COUNT })) };
  });

  // Exposed for other route modules that need the standard 451 shape without duplicating it.
  void copyrightDisabledResponse;
}
