import { z } from "zod";
import { lockPeopleProfile, PeopleGovernanceError } from "./people-governance.js";
import { requireRenewableAccount, requireRenewalFresh, validateRenewalWindow } from "./studio-access-renewal-policy.js";
import { resolveAccessExpiryActions } from "./studio-access-renewal-closeout.js";

const PAGE_SIZE = 50;
const requestSchema = z.object({ userId: z.string().min(1), requestedExpiresAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(12).max(2000), expectedProfileRevision: z.number().int().positive() });
const reviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(8).max(2000) });
const view = (row: any) => ({ id: row.id, userId: row.subjectUserId, subject: row.subject ? { id: row.subject.id, displayName: row.subject.displayName || row.subject.username, accountType: row.subject.accountType, accessExpiresAt: row.subject.accessExpiresAt, accountState: row.subject.accountState, profileRevision: row.subject.profileRevision } : null, status: row.status, previousExpiresAt: row.previousExpiresAt, requestedExpiresAt: row.requestedExpiresAt, expectedProfileRevision: row.expectedProfileRevision, reason: row.reason, reviewReason: row.reviewReason, requestedById: row.requestedById, reviewedById: row.reviewedById, requestedAt: row.requestedAt, reviewedAt: row.reviewedAt, personnelRecordId: row.personnelRecordId });
export function registerStudioAccessRenewalRoutes({ app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent }: any) {
  async function requireManager(request: any, reply: any) { return authorization.requireTool(request, reply, "people", "manage"); }
  async function execute<T>(reply: any, action: () => Promise<T>) {
    try { return await action(); } catch (error) {
      if (error instanceof PeopleGovernanceError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message, ...error.details });
      throw error;
    }
  }
  app.get("/api/studio-systems/access-renewals", async (request: any, reply: any) => {
    if (!(await requireManager(request, reply))) return;
    const query = z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
      search: z.string().trim().max(100).optional(), cursor: z.string().max(512).optional() }).parse(request.query || {});
    let after: { date: Date; id: string } | null = null;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
        if (typeof decoded?.id !== "string" || !decoded.id || decoded.id.length > 160 ||
          typeof decoded?.date !== "string" || !Number.isFinite(new Date(decoded.date).getTime())) throw new Error("Invalid cursor");
        after = { id: decoded.id, date: new Date(decoded.date) };
      } catch { return reply.code(400).send({ ok: false, code: "ACCESS_RENEWAL_CURSOR_INVALID", error: "Refresh the access renewal list." }); }
    }
    const where: any = { archived: false, accessExpiresAt: { not: null, lte: new Date(Date.now() + 30 * 86_400_000) },
      accountState: { notIn: ["DISABLED", "PRIVACY_ERASED"] } };
    if (query.search) where.OR = [
      { username: { contains: query.search, mode: "insensitive" } },
      { displayName: { contains: query.search, mode: "insensitive" } },
      { preferredName: { contains: query.search, mode: "insensitive" } },
    ];
    if (after) where.AND = [{ OR: [
      { accessExpiresAt: { gt: after.date } },
      { accessExpiresAt: after.date, id: { gt: after.id } },
    ] }];
    const [rows, candidates] = await Promise.all([
      prisma.studioAccessRenewal.findMany({ where: query.status ? { status: query.status } : {}, include: { subject: { select: { id: true, username: true, displayName: true, accountType: true, accountState: true, accessExpiresAt: true, profileRevision: true } } }, orderBy: { requestedAt: "desc" }, take: 200 }),
      prisma.user.findMany({ where, select: { id: true, username: true, displayName: true, accountType: true, accountState: true, accessExpiresAt: true, profileRevision: true }, orderBy: [{ accessExpiresAt: "asc" }, { id: "asc" }], take: PAGE_SIZE + 1 }),
    ]);
    const expiring = candidates.slice(0, PAGE_SIZE);
    const tail = expiring[expiring.length - 1];
    const nextCursor = candidates.length > PAGE_SIZE && tail ? Buffer.from(JSON.stringify({ date: tail.accessExpiresAt.toISOString(), id: tail.id })).toString("base64url") : null;
    reply.header("Cache-Control", "no-store");
    return { requests: rows.map(view), expiring, nextCursor };
  });
  app.post("/api/studio-systems/access-renewals", async (request: any, reply: any) => {
    if (!(await requireManager(request, reply))) return;
    const actor = await getCurrentUser(request);
    const body = requestSchema.parse(request.body || {});
    return execute(reply, async () => {
      const result = await prisma.$transaction(async (tx: any) => {
        await lockPeopleProfile(tx, body.userId);
        const subject = await tx.user.findUnique({ where: { id: body.userId } });
        const prior = requireRenewableAccount(subject);
        if (Number(subject.profileRevision) !== body.expectedProfileRevision) throw new PeopleGovernanceError("ACCESS_RENEWAL_STALE", "The person's profile changed. Refresh before requesting renewal.", 409);
        const proposed = new Date(body.requestedExpiresAt);
        validateRenewalWindow(prior, proposed);
        const existing = await tx.studioAccessRenewal.findFirst({ where: { subjectUserId: subject.id, status: "pending" }, select: { id: true } });
        if (existing) throw new PeopleGovernanceError("ACCESS_RENEWAL_PENDING", "This person already has an open renewal request.", 409);
        const created = await tx.studioAccessRenewal.create({ data: { subjectUserId: subject.id, requestedById: actor.id, requestedExpiresAt: proposed, previousExpiresAt: prior, expectedProfileRevision: subject.profileRevision, reason: body.reason } });
        const admins = await tx.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] } }, select: { userId: true }, take: 501 });
        if (admins.length > 500) throw new PeopleGovernanceError("ACCESS_RENEWAL_ADMIN_LIMIT", "Renewal notification requires paginated reviewer delivery.", 409);
        const reviewers = [...new Set(admins.map((row: any) => String(row.userId)))].filter((id) => id !== actor.id && id !== subject.id);
        if (!reviewers.length) throw new PeopleGovernanceError("ACCESS_RENEWAL_REVIEWER_REQUIRED", "Another currently active Studio administrator is required to review this renewal.", 409);
        await tx.notificationInboxItem.createMany({ data: reviewers.map((userId) => ({ userId, category: "action", priority: "high", title: "Access renewal needs review", message: `${subject.displayName || subject.username} · requested expiry ${proposed.toISOString()}. Review in Studio Settings → Access Renewals.`, entityType: "user", entityId: subject.id, resourceKind: "user", resourceId: subject.id, groupKey: `access-renewal:${created.id}`, tool: "people", signal: "access_renewal_review", requiresAction: true })) });
        return created;
      });
      await logActivity?.({ userId: actor.id, entityType: "user", entityId: body.userId, type: "access_renewal_requested", title: "Access renewal requested", metadata: { renewalId: result.id } });
      return { ok: true, renewal: view(result) };
    });
  });
  app.post("/api/studio-systems/access-renewals/:renewalId/review", async (request: any, reply: any) => {
    if (!(await requireManager(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { renewalId } = z.object({ renewalId: z.string().min(1) }).parse(request.params);
    const body = reviewSchema.parse(request.body || {});
    return execute(reply, async () => {
      const committed = await prisma.$transaction(async (tx: any) => {
        const candidate = await tx.studioAccessRenewal.findUnique({ where: { id: renewalId }, select: { subjectUserId: true } });
        if (!candidate) throw new PeopleGovernanceError("ACCESS_RENEWAL_NOT_FOUND", "Renewal request not found.", 404);
        await lockPeopleProfile(tx, candidate.subjectUserId);
        const row = await tx.studioAccessRenewal.findUnique({ where: { id: renewalId } });
        if (row.status !== "pending") throw new PeopleGovernanceError("ACCESS_RENEWAL_ALREADY_REVIEWED", "This renewal has already been reviewed.", 409);
        if (row.requestedById === actor.id || row.subjectUserId === actor.id) throw new PeopleGovernanceError("ACCESS_RENEWAL_SEPARATION", "Requesters and subjects cannot approve their own access renewal.", 403);
        const subject = await tx.user.findUnique({ where: { id: row.subjectUserId } });
        if (body.decision === "approved") {
          requireRenewalFresh(row, subject);
          const applied = await tx.user.updateMany({ where: { id: subject.id, profileRevision: row.expectedProfileRevision, accessExpiresAt: row.previousExpiresAt, archived: false }, data: { accessExpiresAt: row.requestedExpiresAt, profileRevision: { increment: 1 }, ...(new Date(row.previousExpiresAt) <= new Date() ? { authenticationGeneration: { increment: 1 } } : {}) } });
          if (applied.count !== 1) throw new PeopleGovernanceError("ACCESS_RENEWAL_STALE", "The access window changed while being reviewed.", 409);
          if (new Date(row.previousExpiresAt) <= new Date()) await tx.session.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: new Date() } });
          await resolveAccessExpiryActions(tx, subject.id, new Date());
        }
        const updated = await tx.studioAccessRenewal.update({ where: { id: renewalId }, data: { status: body.decision, reviewReason: body.reason, reviewedById: actor.id, reviewedAt: new Date() } });
        const record = await tx.personnelRecord.create({ data: { subjectUserId: row.subjectUserId, custodianUserId: actor.id, createdById: actor.id, lastModifiedById: actor.id, title: `Access renewal ${body.decision}`, recordType: "access_renewal", sourceKind: "studio_access_renewal", sourceId: renewalId, classification: "confidential", disclosurePolicy: "internal_only", status: "finalized", finalizedAt: new Date(), fieldsJson: JSON.stringify({ requesterId: row.requestedById, reviewerId: actor.id, status: body.decision, requestedAt: row.requestedAt, previousExpiresAt: row.previousExpiresAt, requestedExpiresAt: row.requestedExpiresAt, requestReason: row.reason, reviewReason: body.reason, automaticGrants: false }) } });
        await tx.studioAccessRenewal.update({ where: { id: renewalId }, data: { personnelRecordId: record.id } });
        // Resolve the review action at the same commit boundary as its decision.
        await tx.notificationInboxItem.updateMany({ where: { groupKey: `access-renewal:${renewalId}`, requiresAction: true }, data: { requiresAction: false, acknowledgedAt: new Date(), readAt: new Date() } });
        const recipientIds = [...new Set([row.requestedById, row.subjectUserId])];
        const activeRecipients = await tx.user.findMany({ where: { id: { in: recipientIds }, archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] }, select: { id: true } });
        if (activeRecipients.length) await tx.notificationInboxItem.createMany({ data: activeRecipients.map((recipient: any) => ({ userId: recipient.id, category: "notification", priority: "normal", title: `Access renewal ${body.decision}`, message: "The Studio access renewal decision is available in your account history.", entityType: "user", entityId: row.subjectUserId, resourceKind: "user", resourceId: row.subjectUserId, groupKey: `access-renewal-decision:${renewalId}`, tool: "people", signal: "access_renewal_decision", requiresAction: false })) });
        return { ...updated, personnelRecordId: record.id };
      });
      await logSecurityEvent?.({ event: "account.access_renewal_reviewed", actorUserId: actor.id, targetUserId: committed.subjectUserId, result: "SUCCESS", reasonCode: body.decision.toUpperCase(), request, metadata: { renewalId, personnelRecordId: committed.personnelRecordId } });
      await logActivity?.({ userId: actor.id, entityType: "user", entityId: committed.subjectUserId, type: "access_renewal_reviewed", title: `Access renewal ${body.decision}`, metadata: { renewalId } });
      return { ok: true, renewal: view(committed) };
    });
  });
}
