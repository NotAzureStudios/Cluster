import { decidePendingAvatarAudit } from "../domains/users/avatar-approval.js";
import crypto from "node:crypto";import { type FastifyInstance } from "fastify";

import { z } from "zod";
import { CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS, CLUSTER_EXTERNAL_PORTAL_SECTIONS, normalizeClusterExternalPortalSections } from "@cluster/shared";

import type { ServerRouteRegistrationDeps } from "./server-composition-types.js";
import { createDecisionService } from "../domains/decisions/decision-service.js";

const externalPortalSectionSchema = z.enum(CLUSTER_EXTERNAL_PORTAL_SECTIONS);

export function registerAccessAndApprovalRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    WEB_ORIGIN,
    canManageProjectAccess,
    decorateUserForClient,
    getCurrentUser,
    hashShareToken,
    logActivity,
    parseJsonObject,
    parseLabels,
    prisma,
    serializeProjectShareLink,
    shareLinkExpired,
    unique
  } = deps;

  const decisions = createDecisionService(prisma);

  async function adminForApprovals(request: any, reply: any) {
    const actor = await getCurrentUser(request);
    const decorated = actor ? await decorateUserForClient(actor) : null;
    if (!actor || !decorated?.isAdmin) {
      reply.code(403).send({ ok: false, error: "Administrator access is required." });
      return null;
    }
    return actor;
  }

  app.get("/api/projects/:projectId/share-links", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
    });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await canManageProjectAccess(request, project))) return reply.code(403).send({ ok: false, error: "Project manage access required." });
    const rows = await (prisma as any).projectShareLink.findMany({
      where: { projectId: params.projectId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(serializeProjectShareLink);
  });
  
  
  app.post("/api/projects/:projectId/share-links", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z
      .object({
        accessLevel: z.enum(["viewer", "commenter", "reviewer"]).optional().default("viewer"),
        allowedSections: z.array(externalPortalSectionSchema).min(1).max(CLUSTER_EXTERNAL_PORTAL_SECTIONS.length).optional().default([...CLUSTER_EXTERNAL_PORTAL_DEFAULT_SECTIONS]),
        expiresAt: z.string().optional().nullable(),
        maxUses: z.coerce.number().int().min(1).max(10000).optional().nullable(),
      })
      .parse(request.body);
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
    });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await canManageProjectAccess(request, project))) return reply.code(403).send({ ok: false, error: "Project manage access required." });
    const rawToken = crypto.randomBytes(30).toString("base64url");
    const created = await (prisma as any).projectShareLink.create({
      data: {
        projectId: params.projectId,
        tokenHash: hashShareToken(rawToken),
        tokenPreview: `${rawToken.slice(0, 6)}…${rawToken.slice(-4)}`,
        accessLevel: body.accessLevel,
        allowedSections: JSON.stringify(unique(body.allowedSections)),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        maxUses: body.maxUses ?? null,
        createdById: actor?.id || null,
      },
    });
    await logActivity({
      userId: actor?.id,
      projectId: params.projectId,
      type: "access",
      entityType: "project",
      entityId: params.projectId,
      title: "Share link created",
      message: `${body.accessLevel} access · ${body.expiresAt ? `expires ${body.expiresAt}` : "no expiry"}`,
    });
    return {
      ...serializeProjectShareLink(created),
      token: rawToken,
      shareUrl: `${WEB_ORIGIN}/?share=${encodeURIComponent(rawToken)}`,
    };
  });
  
  
  app.patch("/api/projects/:projectId/share-links/:linkId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), linkId: z.string() }).parse(request.params);
    const body = z
      .object({
        accessLevel: z.enum(["viewer", "commenter", "reviewer"]).optional(),
        allowedSections: z.array(externalPortalSectionSchema).min(1).max(CLUSTER_EXTERNAL_PORTAL_SECTIONS.length).optional(),
        expiresAt: z.string().optional().nullable(),
        maxUses: z.coerce.number().int().min(1).max(10000).optional().nullable(),
        status: z.enum(["active", "revoked"]).optional(),
      })
      .parse(request.body);
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
    });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await canManageProjectAccess(request, project))) return reply.code(403).send({ ok: false, error: "Project manage access required." });
    const existingLink = await (prisma as any).projectShareLink.findFirst({
      where: { id: params.linkId, projectId: params.projectId },
    });
    if (!existingLink) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Share link not found." });
    const data: any = { ...body };
    if (body.allowedSections) data.allowedSections = JSON.stringify(unique(body.allowedSections));
    if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    const updated = await (prisma as any).projectShareLink.update({
      where: { id: existingLink.id },
      data,
    });
    await logActivity({
      userId: actor?.id,
      projectId: params.projectId,
      type: "access",
      entityType: "project",
      entityId: params.projectId,
      title: body.status === "revoked" ? "Share link revoked" : "Share link updated",
      message: updated.tokenPreview,
    });
    return serializeProjectShareLink(updated);
  });
  
  
  app.delete("/api/projects/:projectId/share-links/:linkId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    const params = z.object({ projectId: z.string(), linkId: z.string() }).parse(request.params);
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
    });
    if (!project) return reply.code(404).send({ ok: false, error: "Project not found." });
    if (!(await canManageProjectAccess(request, project))) return reply.code(403).send({ ok: false, error: "Project manage access required." });
    const existingLink = await (prisma as any).projectShareLink.findFirst({
      where: { id: params.linkId, projectId: params.projectId },
    });
    if (!existingLink) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Share link not found." });
    await (prisma as any).projectShareLink.update({
      where: { id: existingLink.id },
      data: { status: "revoked" },
    });
    await logActivity({
      userId: actor?.id,
      projectId: params.projectId,
      type: "access",
      entityType: "project",
      entityId: params.projectId,
      title: "Share link revoked",
      message: params.linkId,
    });
    return { ok: true };
  });
  
  
  app.get("/api/public/share/:token", { exposeHeadRoute: false }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store, max-age=0");
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    const params = z.object({ token: z.string().min(20).max(200) }).parse(request.params);
    const link = await (prisma as any).projectShareLink.findUnique({
      where: { tokenHash: hashShareToken(params.token) },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
    });
    if (!link || shareLinkExpired(link))
      return reply.code(404).send({ ok: false, error: "This share link is invalid, expired, exhausted, or revoked." });

    const sections = normalizeClusterExternalPortalSections(parseLabels(link.allowedSections));
    const project = link.project;
    const claimWhere: any = { id: link.id, status: "active" };
    if (link.maxUses != null) claimWhere.useCount = { lt: link.maxUses };
    if (link.expiresAt) claimWhere.expiresAt = { gt: new Date() };
    const claimed = await (prisma as any).projectShareLink.updateMany({ where: claimWhere, data: { useCount: { increment: 1 } } });
    if (!claimed?.count)
      return reply.code(404).send({ ok: false, error: "This share link is expired, exhausted, or revoked." });

    await logActivity({
      projectId: project.id,
      type: "access",
      entityType: "project",
      entityId: project.id,
      title: "Share link opened",
      message: link.tokenPreview,
    });

    const wantsTimeline = sections.includes("timeline") || sections.includes("threads");
    const wantsDelivery = sections.includes("delivery") || sections.includes("threads");
    const wantsLibrary = sections.includes("library") || sections.includes("threads");
    const wantsTickets = sections.includes("tickets") || sections.includes("threads");
    const wantsReviews = sections.includes("reviews") || sections.includes("threads");

    const [timelineRows, buildRows, releaseRows, libraryRows, ticketRows, reviewRows, sourceReviewRows] = await Promise.all([
      wantsTimeline ? prisma.timelineItem.findMany({ where: { projectId: project.id }, select: { id: true, title: true, description: true, startsAt: true, endsAt: true, type: true }, orderBy: { startsAt: "asc" }, take: 80 }) : Promise.resolve([]),
      wantsDelivery ? prisma.deliveryBuild.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true, version: true, lane: true, platform: true, channel: true, qaStatus: true, approval: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 60 }) : Promise.resolve([]),
      sections.includes("delivery") ? prisma.deliveryRelease.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true, status: true, publishedAt: true, body: true }, orderBy: { updatedAt: "desc" }, take: 40 }) : Promise.resolve([]),
      wantsLibrary ? prisma.libraryItem.findMany({ where: { projectId: project.id, deletedAt: null, status: { not: "archived" }, visibility: { in: ["external", "public"] }, classification: { notIn: ["confidential", "restricted"] } }, select: { id: true, title: true, type: true, status: true, reviewState: true, versionLabel: true, mimeType: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 80 }) : Promise.resolve([]),
      wantsTickets ? prisma.card.findMany({ where: { workItemKind: "ticket", archived: false, list: { board: { projectId: project.id, archived: false } } }, select: { id: true, title: true, priority: true, dueDate: true, completedAt: true, updatedAt: true, list: { select: { title: true } } }, orderBy: { updatedAt: "desc" }, take: 80 }) : Promise.resolve([]),
      wantsReviews ? prisma.reviewAsset.findMany({ where: { projectId: project.id, status: { not: "archived" } }, select: { id: true, title: true, medium: true, status: true, approvalState: true, versionLabel: true, dueDate: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 80 }) : Promise.resolve([]),
      sections.includes("threads") ? prisma.sourceReview.findMany({ where: { projectId: project.id }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: 120 }) : Promise.resolve([]),
    ]);

    const restrictionOr: any[] = [];
    if (libraryRows.length) restrictionOr.push({ resourceType: "library", resourceId: { in: libraryRows.map((item: any) => item.id) } });
    if (reviewRows.length) restrictionOr.push({ resourceType: "review_asset", resourceId: { in: reviewRows.map((item: any) => item.id) } });
    const disabledResources = restrictionOr.length
      ? await prisma.copyrightResourceRestriction.findMany({ where: { state: "disabled", OR: restrictionOr }, select: { resourceType: true, resourceId: true } })
      : [];
    const disabledKeys = new Set(disabledResources.map((entry: any) => `${entry.resourceType}:${entry.resourceId}`));
    const safeLibraryRows = libraryRows.filter((item: any) => !disabledKeys.has(`library:${item.id}`));
    const safeReviewRows = reviewRows.filter((item: any) => !disabledKeys.has(`review_asset:${item.id}`));

    const entityCommentScopes = sections.includes("threads") ? [
      { entityType: "ticket", ids: ticketRows.map((item: any) => item.id) },
      { entityType: "timeline", ids: timelineRows.map((item: any) => item.id) },
      { entityType: "library", ids: safeLibraryRows.map((item: any) => item.id) },
      { entityType: "build", ids: buildRows.map((item: any) => item.id) },
      { entityType: "source_review", ids: sourceReviewRows.map((item: any) => item.id) },
    ].filter((scope) => scope.ids.length) : [];

    const [reviewComments, entityComments] = sections.includes("threads") ? await Promise.all([
      safeReviewRows.length ? prisma.reviewComment.findMany({ where: { reviewAssetId: { in: safeReviewRows.map((item: any) => item.id) } }, select: { body: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 120 }) : Promise.resolve([]),
      entityCommentScopes.length ? prisma.entityComment.findMany({ where: { OR: entityCommentScopes.map((scope) => ({ entityType: scope.entityType, entityId: { in: scope.ids } })) }, select: { body: true, resolved: true, entityType: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 120 }) : Promise.resolve([]),
    ]) : [[], []];

    const publicText = (value: unknown, max = 1200) => String(value || "").trim().slice(0, max);
    return {
      access: {
        level: link.accessLevel,
        sections,
        expiresAt: link.expiresAt,
        remainingUses: link.maxUses == null ? null : Math.max(0, Number(link.maxUses) - Number(link.useCount || 0) - 1),
      },
      project: {
        name: project.name,
        description: sections.includes("overview") ? project.description : null,
        status: sections.includes("overview") ? project.status : null,
        projectType: sections.includes("overview") ? project.projectType : null,
        updatedAt: sections.includes("overview") ? project.updatedAt : null,
        timeline: sections.includes("timeline") ? timelineRows.map((item: any) => ({ title: publicText(item.title, 240), description: item.description ? publicText(item.description) : null, startsAt: item.startsAt, endsAt: item.endsAt, type: publicText(item.type, 80) })) : [],
        builds: sections.includes("delivery") ? buildRows.map((item: any) => ({ title: publicText(item.title, 240), version: publicText(item.version, 120), lane: publicText(item.lane, 80), platform: publicText(item.platform, 80), channel: publicText(item.channel, 80), qaStatus: publicText(item.qaStatus, 80), approval: publicText(item.approval, 80), updatedAt: item.updatedAt })) : [],
        releases: sections.includes("delivery") ? releaseRows.map((item: any) => ({ title: publicText(item.title, 240), status: publicText(item.status, 80), publishedAt: item.publishedAt, body: item.body ? publicText(item.body, 2000) : null })) : [],
        library: sections.includes("library") ? safeLibraryRows.map((item: any) => ({ title: publicText(item.title, 240), type: publicText(item.type, 80), status: publicText(item.status, 80), reviewState: publicText(item.reviewState, 80), versionLabel: item.versionLabel ? publicText(item.versionLabel, 120) : null, mimeType: item.mimeType ? publicText(item.mimeType, 160) : null, updatedAt: item.updatedAt })) : [],
        tickets: sections.includes("tickets") ? ticketRows.map((item: any) => ({ title: publicText(item.title, 240), priority: publicText(item.priority, 80), state: publicText(item.list?.title, 120), dueDate: item.dueDate, completedAt: item.completedAt, updatedAt: item.updatedAt })) : [],
        reviews: sections.includes("reviews") ? safeReviewRows.map((item: any) => ({ title: publicText(item.title, 240), medium: publicText(item.medium, 80), status: publicText(item.status, 80), approvalState: publicText(item.approvalState, 80), versionLabel: item.versionLabel ? publicText(item.versionLabel, 120) : null, dueDate: item.dueDate, updatedAt: item.updatedAt })) : [],
        threads: sections.includes("threads") ? [
          ...reviewComments.map((item: any) => ({ body: publicText(item.body), status: publicText(item.status, 80), source: "review", resourceType: "review", createdAt: item.createdAt })),
          ...entityComments.map((item: any) => ({ body: publicText(item.body), status: item.resolved ? "resolved" : "open", source: "shared", resourceType: publicText(item.entityType, 80), createdAt: item.createdAt })),
        ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 160) : [],
      },
    };
  });
  
  
  app.get("/api/admin/approvals", async (request, reply) => {
    const actor = await adminForApprovals(request, reply);
    if (!actor) return;
    const query = z
      .object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query || {});
    const warnings: string[] = [];
    const records = await decisions.list({ status: query.status || null, limit: query.limit || 200 })
      .catch((error: unknown) => {
        request.log.error({ error }, "approval request source failed");
        warnings.push("Approval request records could not be read.");
        return [] as any[];
      });
    const avatarAudits = await prisma.avatarAudit
      .findMany({
        where: query.status && query.status !== "all" ? { status: query.status } : {},
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
      .catch((error: unknown) => {
        request.log.error({ error }, "avatar approval source failed");
        warnings.push("Profile icon audits could not be read.");
        return [] as any[];
      });
    return {
      requests: records,
      avatarAudits: avatarAudits.map((audit: any) => ({
        id: `avatar:${audit.id}`,
        type: "avatar_change",
        title: `Profile icon for ${audit.user?.displayName || audit.user?.username || "user"}`,
        status: audit.status,
        requestedById: audit.userId,
        requestedByName: audit.user?.displayName || audit.user?.username || null,
        reason: audit.originalName || "Profile image upload",
        payload: {
          auditId: audit.id,
          newUrl: audit.newUrl,
          previousUrl: audit.previousUrl,
          mimeType: audit.mimeType,
          sizeBytes: audit.sizeBytes,
        },
        createdAt: audit.createdAt,
        updatedAt: audit.reviewedAt || audit.createdAt,
      })),
      warnings,
    };
  });
  
  app.get("/api/admin/approvals/:approvalId", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const actor = await adminForApprovals(request, reply);
    if (!actor) return;
    const { approvalId } = z.object({ approvalId: z.string().trim().min(1).max(200) }).parse(request.params);
    if (approvalId.startsWith("avatar:")) {
      const audit = await prisma.avatarAudit.findUnique({ where: { id: approvalId.slice(7) }, include: { user: true } });
      if (!audit) return reply.code(404).send({ ok: false, error: "Approval request not found." });
      return { approval: {
        id: `avatar:${audit.id}`, type: "avatar_change", title: `Profile icon for ${audit.user?.displayName || audit.user?.username || "user"}`,
        status: audit.status, requestedById: audit.userId,
        requestedByName: audit.user?.displayName || audit.user?.username || null,
        reason: audit.originalName || "Profile image upload", createdAt: audit.createdAt,
      } };
    }
    const approval = await decisions.get(approvalId);
    if (!approval) return reply.code(404).send({ ok: false, error: "Approval request not found." });
    return { approval };
  });

  app.post("/api/admin/approvals/:approvalId/decision", async (request, reply) => {
    const actor = await adminForApprovals(request, reply);
    if (!actor) return;
    const params = z.object({ approvalId: z.string() }).parse(request.params);
    const body = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        note: z.string().max(2000).optional().nullable(),
      })
      .parse(request.body || {});
    if (params.approvalId.startsWith("avatar:")) {
      const auditId = params.approvalId.slice("avatar:".length);
      const audit = await prisma.avatarAudit.findUniqueOrThrow({
        where: { id: auditId },
        include: { user: true },
      });
      const updated = await decidePendingAvatarAudit(prisma, audit, actor.id, body.decision, body.note || null);
      if (!updated) return reply.code(409).send({ ok: false, code: "APPROVAL_ALREADY_REVIEWED", error: "This avatar request was already reviewed. Refresh approvals." });
      await logActivity({
        userId: actor.id,
        type: `avatar_${body.decision}`,
        entityType: "avatar_audit",
        entityId: audit.id,
        title: `Profile icon ${body.decision}`,
        message: audit.user?.displayName || audit.user?.username || audit.userId,
      });
      return { ok: true };
    }
    const pending = await decisions.get(params.approvalId);
    if (!pending) return reply.code(404).send({ ok: false, error: "Approval request not found." });
    if (pending.status !== "pending") return reply.code(409).send({ ok: false, error: "This request has already been reviewed." });
    const updated = await decisions.decide({
      id: params.approvalId,
      decision: body.decision,
      actorId: actor.id,
      note: body.note || null,
      apply: async (tx, requestRecord) => {
        const payload = requestRecord.payload as Record<string, any>;
        if (body.decision !== "approved") return;
        if (requestRecord.type === "project_completion" && (requestRecord.projectId || payload.projectId)) {
          await tx.project.update({
            where: { id: String(requestRecord.projectId || payload.projectId) },
            data: { status: "completed" },
          });
        }
        if (requestRecord.type === "time_off") {
          const startsAt = new Date(String(payload.startsAt));
          const endsAt = new Date(String(payload.endsAt));
          if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error("The time-off request contains an invalid date range.");
          await tx.scheduleBlock.create({
            data: {
              userId: String(payload.userId || requestRecord.requestedById),
              projectId: payload.projectId ? String(payload.projectId) : null,
              title: String(payload.title || "Time off"),
              description: payload.description ? String(payload.description) : null,
              startsAt,
              endsAt,
              type: "time-off",
              color: payload.color ? String(payload.color) : "#7c8aa5",
            },
          });
        }
      },
    });
    await logActivity({
      userId: actor.id,
      projectId: updated.projectId || null,
      type: `approval_${body.decision}`,
      entityType: updated.resource?.kind || "approval",
      entityId: updated.resource?.id || updated.id,
      title: `${updated.title} ${body.decision}`,
      message: body.note || String(updated.reason || ""),
      metadata: { approvalId: updated.id, approvalType: updated.type, requestedById: updated.requestedById },
    });
    return updated;
  });
}
