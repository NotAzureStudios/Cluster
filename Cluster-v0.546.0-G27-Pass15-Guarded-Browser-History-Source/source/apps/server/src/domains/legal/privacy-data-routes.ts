import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";
import { z } from "zod";
import {
  PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY,
  PRIVACY_EXPORT_SCHEMA_VERSION,
  boundedPrivacyRecords,
  privacyConnectedAccounts,
  privacyExportFilename,
  privacyProfileSnapshot,
} from "../../core/privacy-data-control.js";
import { buildPrivacyErasurePlan, fulfillPrivacyErasure } from "../../core/privacy-erasure.js";

const dataRequestSchema = z.object({
  requestType: z.literal("deletion"),
  note: z.string().trim().max(1000).optional(),
});
const requestParams = z.object({ requestId: z.string().min(1) });
const adminRequestUpdateSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  resolutionNote: z.string().trim().min(1).max(2000),
});
const legalHoldSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  authorityRef: z.string().trim().max(500).optional(),
});
const legalHoldParams = z.object({ holdId: z.string().min(1) });
const legalHoldReleaseSchema = z.object({ releaseNote: z.string().trim().min(3).max(2000) });

async function privacyCounts(prisma: any, userId: string) {
  const [
    memberships, assignedCards, cardComments, entityComments, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formSubmissions, formReminders, activityEvents, timelineItems, timeEntries,
    scheduleBlocks, libraryOwned, libraryReviewing, reviewComments, avatarAudits,
    folderPermissions, uploadedFiles, shareLinks, sessionRecords, securityEvents, dataRequests, policyAcceptances, analyticsEvents, notificationInbox, packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders,
  ] = await Promise.all([
    prisma.workspaceMember.count({ where: { userId } }),
    prisma.card.count({ where: { assigneeId: userId } }),
    prisma.cardComment.count({ where: { userId } }),
    prisma.entityComment.count({ where: { userId } }),
    prisma.entityCommentDraft.count({ where: { userId } }),
    prisma.entityCommentReadState.count({ where: { userId } }),
    prisma.entityCommentThreadReadState.count({ where: { userId } }),
    prisma.studioFormAssignment.count({ where: { userId } }),
    prisma.studioFormReviewer.count({ where: { userId } }),
    prisma.studioFormResponseDraft.count({ where: { userId } }),
    prisma.studioFormSubmission.count({ where: { userId } }),
    prisma.studioFormReminderDelivery.count({ where: { userId } }),
    prisma.activityEvent.count({ where: { userId } }),
    prisma.timelineItem.count({ where: { userId } }),
    prisma.timeEntry.count({ where: { userId } }),
    prisma.scheduleBlock.count({ where: { userId } }),
    prisma.libraryItem.count({ where: { ownerId: userId } }),
    prisma.libraryItem.count({ where: { reviewerId: userId } }),
    prisma.reviewComment.count({ where: { userId } }),
    prisma.avatarAudit.count({ where: { userId } }),
    prisma.folderPermission.count({ where: { userId } }),
    prisma.projectFile.count({ where: { uploadedById: userId } }),
    prisma.projectShareLink.count({ where: { createdById: userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.securityAuditEvent.count({ where: { OR: [{ actorUserId: userId }, { targetUserId: userId }] } }),
    prisma.privacyDataRequest.count({ where: { userId } }),
    prisma.policyAcceptance.count({ where: { userId } }),
    prisma.behavioralAnalyticsEvent.count({ where: { userId } }),
    prisma.notificationInboxItem.count({ where: { userId } }),
    prisma.packetDeliveryReceipt.count({ where: { recipientId: userId } }),
    prisma.packetReleaseAcknowledgment.count({ where: { recipientId: userId } }),
    prisma.packetReleaseRequirement.count({ where: { recipientId: userId } }),
    prisma.packetReleaseReminderDelivery.count({ where: { recipientId: userId } }),
  ]);
  return { memberships, assignedCards, cardComments, entityComments, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formSubmissions, formReminders, activityEvents, timelineItems, timeEntries, scheduleBlocks, libraryOwned, libraryReviewing, reviewComments, avatarAudits, folderPermissions, uploadedFiles, shareLinks, sessionRecords, securityEvents, dataRequests, policyAcceptances, analyticsEvents, notificationInbox, packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders };
}

function categoryRows(counts: Record<string, number>) {
  return [
    { id: "profile", label: "Profile & contact", count: 1, description: "Account identity, contact, employment, profile, and preference fields." },
    { id: "workspace", label: "Workspace membership", count: counts.memberships, description: "Workspace roles and memberships associated with your account." },
    { id: "assignments", label: "Assignments", count: counts.assignedCards + counts.formAssignments + counts.formReviewGrants, description: "Cards and studio Forms assigned to your account." },
    { id: "authored-content", label: "Comments & activity", count: counts.cardComments + counts.entityComments + counts.reviewComments + counts.activityEvents, description: "Comments and activity records attributed to your account." },
    { id: "forms", label: "Form responses, drafts & reminders", count: counts.formDrafts + counts.formSubmissions + counts.formReminders, description: "Your submitted Form answers, unpublished drafts, and reminder delivery records." },
    { id: "discussion-private", label: "Discussion drafts & read state", count: counts.entityCommentDrafts + counts.entityCommentReadStates + counts.entityCommentThreadReadStates, description: "Private unpublished discussion drafts and per-resource and per-thread read watermarks." },
    { id: "schedule-time", label: "Time & scheduling", count: counts.timelineItems + counts.timeEntries + counts.scheduleBlocks, description: "Timeline, time-entry, and schedule records tied to your account." },
    { id: "library-files", label: "Library & files", count: counts.libraryOwned + counts.libraryReviewing + counts.folderPermissions + counts.uploadedFiles, description: "Library ownership/review metadata, folder access, and uploaded-file metadata." },
    { id: "packet-delivery", label: "Published Packet evidence", count: counts.packetDeliveryIssuances + counts.packetReleaseAcknowledgments + counts.packetReleaseRequirements + counts.packetReleaseReminders,
      description: "Detached file issuances, required release assignments, reminder deliveries and explicit acknowledgments associated with your account, scoped to immutable Packet releases." },
    { id: "sharing", label: "Sharing links", count: counts.shareLinks, description: "Project share links created by your account. Exported records include only the token preview, never the share secret." },
    { id: "security", label: "Security & sessions", count: counts.securityEvents + counts.sessionRecords, description: "Session history and security-event references tied to your account. Sensitive server evidence is not exposed in self-service exports." },
    { id: "policy-acceptance", label: "Policy acknowledgements", count: counts.policyAcceptances, description: "Immutable evidence of policy versions you acknowledged or accepted." },
    { id: "behavioral-analytics", label: "Behavioral analytics", count: counts.analyticsEvents, description: "Consent-gated first-party usage events containing coarse screen/event identifiers, client type, and timestamps." },
    { id: "notification-inbox", label: "Notification inbox", count: counts.notificationInbox, description: "Server-backed inbox delivery and state records, including read, snooze, and dismissal timestamps." },
    { id: "requests", label: "Privacy requests", count: counts.dataRequests, description: "Your privacy/data-control request history." },
  ];
}

async function getUserOr401(getCurrentUser: (request: FastifyRequest) => Promise<any | null>, request: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(request);
  if (!user?.id) {
    reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    return null;
  }
  return user;
}

export function registerPrivacyDataRoutes(deps: {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  getCurrentSession: (request: FastifyRequest) => Promise<any | null>;
  requireConfirmation: (request: FastifyRequest, reply: FastifyReply, expected: string) => boolean;
  logSecurityEvent: (input: any) => Promise<unknown>;
  clearSessionCookies: (reply: FastifyReply) => void;
  onUserSessionsRevoked: (userId: string, reason: string, exceptSessionId?: string | null) => void;
  requireDiscordLink: boolean;
  authorization: AuthorizationService;
}) {
  const { app, prisma, getCurrentUser, getCurrentSession, requireConfirmation, logSecurityEvent, clearSessionCookies, onUserSessionsRevoked, requireDiscordLink, authorization } = deps;

  app.get("/api/privacy/data-summary", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    const now = new Date();
    const [counts, consent, sessions, requests, policy, policyAcceptances] = await Promise.all([
      privacyCounts(prisma, user.id),
      prisma.privacyConsentPreference.findUnique({ where: { userId: user.id } }),
      prisma.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, authMethod: true, userAgent: true, ipAddress: true } }),
      prisma.privacyDataRequest.findMany({ where: { userId: user.id }, orderBy: { requestedAt: "desc" }, take: 25 }),
      prisma.legalPolicyVersion.findFirst({ where: { kind: "privacy", status: "published", effectiveAt: { lte: now } }, orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }] }),
      prisma.policyAcceptance.findMany({ where: { userId: user.id }, orderBy: { acceptedAt: "desc" }, take: 50, select: { id: true, policyId: true, policyKind: true, policyVersion: true, policyContentHash: true, acceptanceMode: true, acceptanceAudience: true, requirementHash: true, acceptedAt: true, source: true, evidenceHash: true } }),
    ]);
    const currentSession = await getCurrentSession(request).catch(() => null);
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      profile: privacyProfileSnapshot(user),
      connectedAccounts: privacyConnectedAccounts(user, requireDiscordLink),
      consent: consent ? { schemaVersion: consent.schemaVersion, noticeVersion: consent.noticeVersion, preferences: consent.preferences, analytics: consent.analytics === true, externalContent: consent.externalContent, source: consent.source, decidedAt: consent.decidedAt, updatedAt: consent.updatedAt } : null,
      privacyPolicy: policy ? { version: policy.version, title: policy.title, contentHash: policy.contentHash, effectiveAt: policy.effectiveAt, publishedAt: policy.publishedAt } : null,
      policyAcceptances,
      sessions: sessions.map((session: any) => ({ ...session, current: session.id === currentSession?.id })),
      categories: categoryRows(counts),
      requests,
      controls: {
        exportAvailable: true,
        exportRequiresRecentAuthentication: true,
        deletionIsRequestBased: true,
        deletionAutomatic: false,
        deletionFulfillmentAvailable: true,
        maximumExportRecordsPerCategory: PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY,
      },
    };
  });

  app.post("/api/privacy/data-export", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    const exportedAt = new Date();
    const limit = PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY + 1;
    const [consent, memberships, sessions, cards, cardComments, entityComments, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formSubmissions, formReminders, activityEvents, timelineItems, timeEntries, scheduleBlocks, libraryOwned, libraryReviewing, reviewComments, avatarAudits, folderPermissions, uploadedFiles, shareLinks, requests, policyAcceptances, analyticsEvents, notificationInbox, packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders, securityEventCount] = await Promise.all([
      prisma.privacyConsentPreference.findUnique({ where: { userId: user.id } }),
      prisma.workspaceMember.findMany({ where: { userId: user.id }, include: { workspace: { select: { id: true, name: true, archived: true, createdAt: true } } }, take: limit }),
      prisma.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, revocationReason: true, authMethod: true, userAgent: true, ipAddress: true }, take: limit }),
      prisma.card.findMany({ where: { assigneeId: user.id }, select: { id: true, listId: true, title: true, priority: true, dueDate: true, startDate: true, archived: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.cardComment.findMany({ where: { userId: user.id }, select: { id: true, cardId: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.entityComment.findMany({ where: { userId: user.id }, select: { id: true, entityType: true, entityId: true, body: true, pinned: true, resolved: true, anchor: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.entityCommentDraft.findMany({ where: { userId: user.id }, select: { id: true, entityType: true, entityId: true, slotKey: true, body: true, revision: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.entityCommentReadState.findMany({ where: { userId: user.id }, select: { entityType: true, entityId: true, lastReadAt: true }, orderBy: { lastReadAt: "desc" }, take: limit }),
      prisma.entityCommentThreadReadState.findMany({ where: { userId: user.id }, select: { entityType: true, entityId: true, threadRootId: true, lastReadAt: true }, orderBy: { lastReadAt: "desc" }, take: limit }),
      prisma.studioFormAssignment.findMany({ where: { userId: user.id }, select: { formId: true, status: true, required: true, dueAt: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.studioFormReviewer.findMany({ where: { userId: user.id }, select: { formId: true, status: true, revision: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.studioFormResponseDraft.findMany({ where: { userId: user.id }, select: { formId: true, formVersionId: true, answersJson: true, revision: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.studioFormSubmission.findMany({ where: { userId: user.id }, select: { id: true, formId: true, formVersionId: true, status: true, answersJson: true, submittedAt: true, reviewedAt: true, reviewNote: true }, orderBy: { submittedAt: "desc" }, take: limit }),
      prisma.studioFormReminderDelivery.findMany({ where: { userId: user.id }, select: { formId: true, formVersionId: true, stage: true, state: true, deliveredAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.activityEvent.findMany({ where: { userId: user.id }, select: { id: true, projectId: true, boardId: true, whiteboardId: true, cardId: true, type: true, entityType: true, entityId: true, title: true, message: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.timelineItem.findMany({ where: { userId: user.id }, select: { id: true, projectId: true, title: true, description: true, startsAt: true, endsAt: true, type: true, source: true, createdAt: true, updatedAt: true }, orderBy: { startsAt: "desc" }, take: limit }),
      prisma.timeEntry.findMany({ where: { userId: user.id }, include: { breaks: true }, orderBy: { startedAt: "desc" }, take: limit }),
      prisma.scheduleBlock.findMany({ where: { userId: user.id }, orderBy: { startsAt: "desc" }, take: limit }),
      prisma.libraryItem.findMany({ where: { ownerId: user.id }, select: { id: true, projectId: true, parentId: true, title: true, body: true, type: true, status: true, priority: true, tags: true, externalUrl: true, pinned: true, versionLabel: true, visibility: true, source: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.libraryItem.findMany({ where: { reviewerId: user.id }, select: { id: true, projectId: true, title: true, type: true, status: true, reviewDueAt: true, approvedAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.reviewComment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.avatarAudit.findMany({ where: { userId: user.id }, select: { id: true, previousUrl: true, newUrl: true, originalName: true, mimeType: true, sizeBytes: true, status: true, reviewNote: true, reviewedAt: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.folderPermission.findMany({ where: { userId: user.id }, select: { id: true, folderId: true, access: true, createdAt: true, updatedAt: true }, take: limit }),
      prisma.projectFile.findMany({ where: { uploadedById: user.id }, select: { id: true, projectId: true, title: true, description: true, category: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.projectShareLink.findMany({ where: { createdById: user.id }, select: { id: true, projectId: true, tokenPreview: true, accessLevel: true, allowedSections: true, expiresAt: true, maxUses: true, useCount: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.privacyDataRequest.findMany({ where: { userId: user.id }, orderBy: { requestedAt: "desc" }, take: limit }),
      prisma.policyAcceptance.findMany({ where: { userId: user.id }, orderBy: { acceptedAt: "desc" }, take: limit, select: { id: true, policyId: true, policyKind: true, policyVersion: true, policyContentHash: true, acceptanceMode: true, acceptanceAudience: true, requirementHash: true, acceptedAt: true, sessionId: true, authMethod: true, ipAddress: true, userAgent: true, source: true, requestId: true, evidenceHash: true, createdAt: true } }),
      prisma.behavioralAnalyticsEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, providerId: true, eventName: true, surface: true, client: true, occurredAt: true, createdAt: true } }),
      prisma.notificationInboxItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, activityEventId: true, category: true, priority: true, title: true, message: true, projectId: true, projectLabel: true, boardId: true, cardId: true, entityType: true, entityId: true, actorLabel: true, readAt: true, dismissedAt: true, snoozedUntil: true, createdAt: true, updatedAt: true } }),
      prisma.packetDeliveryReceipt.findMany({ where: { recipientId: user.id },
        select: { id: true, releaseId: true, kind: true, position: true, derivativeHash: true, sizeBytes: true, issuedAt: true },
        orderBy: { issuedAt: "desc" }, take: limit }),
      prisma.packetReleaseAcknowledgment.findMany({ where: { recipientId: user.id },
        select: { id: true, releaseId: true, versionLabel: true, manifestSha256: true, acknowledgedAt: true },
        orderBy: { acknowledgedAt: "desc" }, take: limit }),
      prisma.packetReleaseRequirement.findMany({ where: { recipientId: user.id },
        select: { id: true, releaseId: true, assignedAt: true, dueAt: true, manifestSha256: true },
        orderBy: { assignedAt: "desc" }, take: limit }),
      prisma.packetReleaseReminderDelivery.findMany({ where: { recipientId: user.id },
        select: { id: true, releaseId: true, requirementId: true, manifestSha256: true, sentAt: true },
        orderBy: { sentAt: "desc" }, take: limit }),
      prisma.securityAuditEvent.count({ where: { OR: [{ actorUserId: user.id }, { targetUserId: user.id }] } }),
    ]);

    const collections: Record<string, { records: unknown[]; truncated: boolean }> = {};
    const uploadedFileRecords = uploadedFiles.map((row: any) => ({ ...row, sizeBytes: Number(row.sizeBytes || 0) }));
    for (const [name, rows] of Object.entries({ memberships, sessions, assignedCards: cards, cardComments, entityComments, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formSubmissions, formReminders, activityEvents, timelineItems, timeEntries, scheduleBlocks, libraryOwned, libraryReviewing, reviewComments, avatarAudits, folderPermissions, uploadedFiles: uploadedFileRecords, createdShareLinks: shareLinks, privacyRequests: requests, policyAcceptances, behavioralAnalyticsEvents: analyticsEvents, notificationInbox, packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders })) {
      collections[name] = boundedPrivacyRecords(rows as unknown[]);
    }
    const exportBody = {
      schemaVersion: PRIVACY_EXPORT_SCHEMA_VERSION,
      exportedAt: exportedAt.toISOString(),
      clusterScope: "self-service-personal-data",
      consistency: "best-effort point-in-time; active collaboration may change while export is assembled",
      profile: privacyProfileSnapshot(user),
      connectedAccounts: privacyConnectedAccounts(user, requireDiscordLink),
      privacyConsent: consent ? { ...consent, analytics: consent.analytics === true } : null,
      collections,
      securityAuditSummary: { eventsReferencingAccount: securityEventCount, rawSecurityEvidenceExcluded: true },
      exclusions: ["password hashes", "PIN hashes", "session token hashes", "server secrets", "security-audit evidence payloads", "other users' private profile data"],
    };
    await logSecurityEvent({ event: "privacy.data_exported", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "SELF_SERVICE_EXPORT", request, metadata: { schemaVersion: PRIVACY_EXPORT_SCHEMA_VERSION, maximumRecordsPerCategory: PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY } });
    const filename = privacyExportFilename(user.username, exportedAt);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return { ok: true, filename, export: exportBody };
  });

  app.get("/api/privacy/data-requests", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    return { ok: true, requests: await prisma.privacyDataRequest.findMany({ where: { userId: user.id }, orderBy: { requestedAt: "desc" }, take: 50 }) };
  });

  app.post("/api/privacy/data-requests", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    if (!requireConfirmation(request, reply, "REQUEST DATA DELETION")) return;
    const parsed = dataRequestSchema.parse(request.body || {});
    const existing = await prisma.privacyDataRequest.findFirst({ where: { userId: user.id, requestType: parsed.requestType, status: { in: ["pending", "approved"] } }, orderBy: { requestedAt: "desc" } });
    if (existing) return reply.code(409).send({ ok: false, code: "PRIVACY_DATA_REQUEST_EXISTS", error: "An active account-data deletion request already exists.", request: existing });
    const created = await prisma.privacyDataRequest.create({ data: { userId: user.id, requestType: parsed.requestType, note: parsed.note || null, status: "pending" } });
    await logSecurityEvent({ event: "privacy.data_deletion_requested", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "SELF_SERVICE_REQUEST", request, metadata: { requestId: created.id } });
    return { ok: true, request: created, automaticDeletion: false };
  });

  app.delete("/api/privacy/data-requests/:requestId", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    if (!requireConfirmation(request, reply, "CANCEL DATA REQUEST")) return;
    const { requestId } = requestParams.parse(request.params);
    const existing = await prisma.privacyDataRequest.findUnique({ where: { id: requestId } });
    if (!existing || existing.userId !== user.id) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Privacy request not found." });
    if (existing.status !== "pending") return reply.code(409).send({ ok: false, code: "PRIVACY_DATA_REQUEST_FINAL", error: "Only pending privacy requests can be cancelled." });
    const updated = await prisma.privacyDataRequest.update({ where: { id: existing.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    await logSecurityEvent({ event: "privacy.data_request_cancelled", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "SELF_SERVICE_CANCEL", request, metadata: { requestId: existing.id } });
    return { ok: true, request: updated };
  });


  app.get("/api/admin/privacy/data-requests", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = z.object({ status: z.enum(["pending", "approved", "fulfilled", "rejected", "cancelled"]).optional() }).parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    return {
      ok: true,
      requests: await prisma.privacyDataRequest.findMany({
        where: query.status ? { status: query.status } : undefined,
        include: { user: { select: { id: true, username: true, displayName: true, email: true, accountState: true, archived: true } } },
        orderBy: { requestedAt: "desc" },
        take: 250,
      }),
    };
  });

  app.patch("/api/admin/privacy/data-requests/:requestId", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const { requestId } = requestParams.parse(request.params);
    const body = adminRequestUpdateSchema.parse(request.body || {});
    const existing = await prisma.privacyDataRequest.findUnique({ where: { id: requestId } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Privacy request not found." });
    if (existing.status !== "pending") return reply.code(409).send({ ok: false, code: "PRIVACY_DATA_REQUEST_FINAL", error: "Only pending privacy requests can be approved or rejected." });
    const updated = await prisma.privacyDataRequest.update({
      where: { id: existing.id },
      data: { status: body.status, resolutionNote: body.resolutionNote, resolvedAt: new Date(), approvedAt: body.status === "approved" ? new Date() : null },
    });
    await logSecurityEvent({
      event: body.status === "approved" ? "privacy.data_request_approved" : "privacy.data_request_rejected",
      actorUserId: admin.id,
      targetUserId: existing.userId,
      result: "SUCCESS",
      reasonCode: "ADMIN_REVIEW",
      request,
      metadata: { requestId: existing.id, requestType: existing.requestType },
    });
    return { ok: true, request: updated };
  });

  app.get("/api/admin/privacy/data-requests/:requestId/erasure-plan", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const { requestId } = requestParams.parse(request.params);
    const existing = await prisma.privacyDataRequest.findUnique({ where: { id: requestId } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Privacy request not found." });
    const [plan, receipt] = await Promise.all([
      buildPrivacyErasurePlan(prisma, existing.userId),
      prisma.privacyErasureReceipt.findUnique({ where: { requestId } }),
    ]);
    reply.header("Cache-Control", "no-store");
    return { ok: true, request: existing, plan, receipt };
  });

  app.post("/api/admin/privacy/data-requests/:requestId/fulfill", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "FULFILL PRIVACY ERASURE")) return;
    const { requestId } = requestParams.parse(request.params);
    const result = await fulfillPrivacyErasure(prisma, { requestId, actorUserId: admin.id });
    if (!result.ok) return reply.code(result.code === "RESOURCE_NOT_FOUND" ? 404 : 409).send(result);
    const targetUserId = result.receipt.userId;
    onUserSessionsRevoked(targetUserId, "privacy_erasure_fulfilled");
    await logSecurityEvent({
      event: "privacy.erasure_fulfilled",
      actorUserId: admin.id,
      targetUserId,
      result: "SUCCESS",
      reasonCode: result.alreadyFulfilled ? "ALREADY_FULFILLED" : "ADMIN_FULFILLMENT",
      request,
      metadata: { requestId, receiptId: result.receipt.id, evidenceHash: result.receipt.evidenceHash, mode: result.receipt.mode },
    });
    return { ok: true, alreadyFulfilled: result.alreadyFulfilled, receipt: result.receipt, counts: (result as any).counts || null };
  });

  app.get("/api/admin/privacy/legal-holds", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    const query = z.object({ userId: z.string().optional(), status: z.enum(["active", "released"]).optional() }).parse(request.query || {});
    reply.header("Cache-Control", "no-store");
    return { ok: true, holds: await prisma.privacyLegalHold.findMany({ where: { ...(query.userId ? { userId: query.userId } : {}), ...(query.status ? { status: query.status } : {}) }, include: { user: { select: { id: true, username: true, displayName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 250 }) };
  });

  app.post("/api/admin/privacy/users/:userId/legal-holds", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "CREATE PRIVACY LEGAL HOLD")) return;
    const { userId } = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = legalHoldSchema.parse(request.body || {});
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "User not found." });
    const hold = await prisma.privacyLegalHold.create({ data: { userId, reason: body.reason, authorityRef: body.authorityRef || null, createdById: admin.id, status: "active" } });
    await logSecurityEvent({ event: "privacy.legal_hold_created", actorUserId: admin.id, targetUserId: userId, result: "SUCCESS", reasonCode: "ADMIN_LEGAL_HOLD", request, metadata: { holdId: hold.id, authorityRef: hold.authorityRef } });
    return { ok: true, hold };
  });

  app.patch("/api/admin/privacy/legal-holds/:holdId/release", async (request, reply) => {
    const admin = await authorization.requireAdmin(request, reply);
    if (!admin) return;
    if (!requireConfirmation(request, reply, "RELEASE PRIVACY LEGAL HOLD")) return;
    const { holdId } = legalHoldParams.parse(request.params);
    const body = legalHoldReleaseSchema.parse(request.body || {});
    const existing = await prisma.privacyLegalHold.findUnique({ where: { id: holdId } });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Legal hold not found." });
    if (existing.status !== "active") return reply.code(409).send({ ok: false, code: "PRIVACY_LEGAL_HOLD_FINAL", error: "Only an active legal hold can be released." });
    const hold = await prisma.privacyLegalHold.update({ where: { id: holdId }, data: { status: "released", releasedAt: new Date(), releasedById: admin.id, releaseNote: body.releaseNote } });
    await logSecurityEvent({ event: "privacy.legal_hold_released", actorUserId: admin.id, targetUserId: existing.userId, result: "SUCCESS", reasonCode: "ADMIN_LEGAL_HOLD_RELEASE", request, metadata: { holdId } });
    return { ok: true, hold };
  });

  app.delete("/api/privacy/integrations/discord", async (request, reply) => {
    const user = await getUserOr401(getCurrentUser, request, reply);
    if (!user) return;
    if (!requireConfirmation(request, reply, "DISCONNECT DISCORD")) return;
    if (requireDiscordLink) return reply.code(409).send({ ok: false, code: "PRIVACY_INTEGRATION_REQUIRED", error: "Discord is required by this studio and cannot be disconnected from self-service privacy controls." });
    if (!user.discordUserId) return { ok: true, disconnected: false };
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { discordUserId: null, discordUsername: null, discordDisplayName: null, discordAvatar: null, discordLinkedAt: null, discordLastVerifiedAt: null } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "discord_link_self_cleared" } }),
    ]);
    onUserSessionsRevoked(user.id, "discord_link_self_cleared");
    await logSecurityEvent({ event: "discord.link_self_cleared", actorUserId: user.id, targetUserId: user.id, result: "SUCCESS", reasonCode: "PRIVACY_CONTROL", request });
    clearSessionCookies(reply);
    return { ok: true, disconnected: true, signedOut: true };
  });
}
