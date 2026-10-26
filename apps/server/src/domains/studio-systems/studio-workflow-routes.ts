import {
  publicApplicationSubmissionSchema,
  studioAnnouncementCreateSchema,
  studioAnnouncementScheduleSchema,
  studioAnnouncementDraftEditSchema,
  studioAnnouncementAudiencePreviewSchema,
  studioApplicationConversionSchema,
  studioApplicationListQuerySchema,
  studioApplicationReviewSchema,
} from "@cluster/shared";
import { z } from "zod";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import { parseStudioAudience, parseStudioJson, resolveStudioAudienceUserIds, studioAudienceMatchesUser } from "../access/studio-audience.js";
import { projectVisibleStudioFormAnswers } from "@cluster/shared";
import { applicationRespondentMetadata, serializeStudioForm, serializeStudioFormVersion, validateStudioFormAnswers } from "./studio-form-runtime.js";
import { createStudioOnboardingAssignment } from "./studio-onboarding-runtime.js";
import { syncUserWorkforceAuthorities } from "../workforce/workforce-normalization.js";
import { createStudioAnnouncementDelivery } from "./studio-announcement-delivery.js";
import { applicationReviewWhere, applicationConversionWhere } from "./studio-application-revisions.js";
import { appendSecurityAuditEvent } from "../../core/security-audit-store.js";
import { loadStudioAudienceUserContext, studioAudienceMatchesContext } from "../access/studio-audience.js";
import { buildApplicationProfile, ApplicationMappingError } from "./studio-application-profile.js";
import { announcementCreateDigest, isAnnouncementCreateUniqueConflict } from "./studio-announcement-create-intents.js";

const APPLICATION_PROFILE_MAPPING_KEYS = new Set([
  "displayName", "email", "legalName", "preferredName", "pronouns", "phoneNumber", "alternatePhoneNumber",
  "addressLine1", "addressLine2", "city", "stateProvince", "postalCode", "country", "emergencyContactName",
  "emergencyContactPhone", "emergencyContactRelation", "title", "workLocation", "timezone", "employmentType",
]);

function serializeApplication(submission: any) {
  const definition = parseStudioJson(submission.formVersion?.schemaJson, { fields: [] });
  const answers = parseStudioJson(submission.answersJson, {});
  const fields = Array.isArray(definition.fields) ? definition.fields : [];
  const mappingCandidates = fields.filter((field: any) => field.profileMappingKey).map((field: any) => ({
    fieldId: String(field.id), label: String(field.label || field.id), profileMappingKey: String(field.profileMappingKey), value: answers[String(field.id)] ?? null,
    allowed: APPLICATION_PROFILE_MAPPING_KEYS.has(String(field.profileMappingKey)),
  }));
  const answerFields = fields.map((field: any) => ({ fieldId: String(field.id), label: String(field.label || field.id), type: String(field.type || "short_text"), value: answers[String(field.id)] ?? null }));
  return {
    id: submission.id, status: submission.status, updatedAt: submission.updatedAt, respondentName: submission.respondentName, respondentEmail: submission.respondentEmail,
    submittedAt: submission.submittedAt, reviewedAt: submission.reviewedAt, reviewedById: submission.reviewedById, reviewNote: submission.reviewNote,
    submissionSource: submission.submissionSource, privacyConsentAt: submission.privacyConsentAt, convertedUserId: submission.convertedUserId,
    convertedAt: submission.convertedAt, conversion: parseStudioJson(submission.conversionJson, {}), answers,
    form: submission.form ? { id: submission.form.id, key: submission.form.key, title: submission.form.title } : null,
    formVersion: submission.formVersion ? { id: submission.formVersion.id, version: submission.formVersion.version } : null,
    answerFields, mappingCandidates,
  };
}

function serializeAnnouncement(record: any) {
  if (!record) return null;
  const { createIntentId: _intent, createPayloadSha256: _digest, ...visible } = record;
  return { ...visible, audience: parseStudioAudience(record.audienceJson), audienceJson: undefined };
}

export function registerStudioWorkflowRoutes(deps: any) {
  const {
    app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent, readSettings, rateLimitKey, hashToken,
    apiRateLimitWindowMs, hashPassword, generateTemporaryPassword, normalizeAuthUsername, events,
  } = deps;

  const announcementDelivery = createStudioAnnouncementDelivery({ prisma, events });

  async function requireAdmin(request: any, reply: any) {
    return authorization.requireTool(request, reply, "settings", "edit");
  }

  app.get("/api/public/v1/studio-cover", async (_request: any, _reply: any) => {
    const settings = await readSettings();
    const forms = await prisma.studioForm.findMany({
      where: { purpose: "application", status: "active" },
      include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } },
      orderBy: { title: "asc" },
    });
    const applications = forms.flatMap((form: any) => {
      const version = form.versions?.[0];
      const formSettings = version ? parseStudioJson(version.settingsJson, {}) : {};
      if (!version || formSettings.publicApplication !== true || formSettings.acceptingResponses === false) return [];
      const serialized = serializeStudioForm(form, { publicView: true });
      return [{ ...serialized, versions: [serializeStudioFormVersion(version, { publicView: true })] }];
    });
    return { ok: true, studioName: String(settings.studioName || settings.workspaceName || "Studio").slice(0, 120), applications };
  });

  app.post("/api/public/v1/applications/:formKey/submissions", async (request: any, reply: any) => {
    const { formKey } = z.object({ formKey: z.string().min(1).max(120) }).parse(request.params);
    const rateKey = `public-application:${formKey}:${hashToken(String(request.ip || "local")).slice(0, 20)}`;
    if (await rateLimitKey(reply, rateKey, 5, Math.max(apiRateLimitWindowMs, 15 * 60_000))) return;
    const body = publicApplicationSubmissionSchema.parse(request.body || {});
    if (body.website) return reply.code(201).send({ ok: true, submitted: true, confirmationMessage: "Application received." });
    const form = await prisma.studioForm.findUnique({ where: { key: formKey } });
    if (!form || form.purpose !== "application" || form.status !== "active") return reply.code(404).send({ ok: false, code: "APPLICATION_NOT_FOUND", error: "Application form not found." });
    const version = await prisma.studioFormVersion.findFirst({ where: { id: body.formVersionId, formId: form.id, status: "published" } });
    if (!version) return reply.code(409).send({ ok: false, code: "FORM_VERSION_STALE", error: "This application form has changed. Reload and try again." });
    const currentVersion = await prisma.studioFormVersion.findFirst({ where: { formId: form.id, status: "published" }, orderBy: { version: "desc" }, select: { id: true } });
    if (currentVersion?.id !== version.id) return reply.code(409).send({ ok: false, code: "FORM_VERSION_STALE", error: "This application has changed. Reload the current version." });
    const settings = parseStudioJson(version.settingsJson, {});
    if (settings.publicApplication !== true || settings.acceptingResponses === false) return reply.code(404).send({ ok: false, code: "APPLICATION_CLOSED", error: "This application is not accepting responses." });
    const definition = parseStudioJson(version.schemaJson, { fields: [] });
    const checked = validateStudioFormAnswers(definition, body.answers);
    if (!checked.ok) return reply.code(400).send({ ok: false, code: "FORM_ANSWERS_INVALID", error: checked.error });
    const effectiveAnswers = projectVisibleStudioFormAnswers(definition.fields || [], body.answers);
    const respondent = applicationRespondentMetadata(definition, effectiveAnswers);
    if (settings.allowMultipleSubmissions !== true && respondent.respondentEmail) {
      const existing = await prisma.studioFormSubmission.findFirst({ where: { formId: form.id, respondentEmail: respondent.respondentEmail, submissionSource: "public_application", status: { not: "rejected" } }, select: { id: true } });
      if (existing) return reply.code(409).send({ ok: false, code: "APPLICATION_ALREADY_SUBMITTED", error: "An application with this email has already been received." });
    }
    const submission = await prisma.studioFormSubmission.create({ data: {
      formId: form.id, formVersionId: version.id, userId: null, respondentName: respondent.respondentName,
      respondentEmail: respondent.respondentEmail, answersJson: JSON.stringify(effectiveAnswers), status: "submitted",
      submissionSource: "public_application", privacyConsentAt: new Date(),
    } });
    const notifyAdmins = settings.notifyAdminsOnSubmission !== false;
    const adminMemberships = notifyAdmins ? await prisma.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } } }, select: { userId: true } }) : [];
    const adminIds = [...new Set(adminMemberships.map((item: any) => String(item.userId)).filter(Boolean))];
    await logActivity?.({ type: "submitted", entityType: "studio_application", entityId: submission.id, title: "Application submitted", message: form.title, metadata: adminIds.length ? { userIds: adminIds, notifyInbox: true, notificationSignal: "application", notificationPriority: "normal", requiresAction: true, notificationGroupKey: `application:${submission.id}` } : {} });
    return reply.code(201).send({ ok: true, submitted: true, confirmationMessage: String(settings.confirmationMessage || "Application received.").slice(0, 1000) });
  });

  app.get("/api/studio-systems/applications", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = studioApplicationListQuerySchema.parse(request.query || {});
    const cursor = decodeCursor(query.cursor || null);
    if (query.cursor && !cursor) return reply.code(400).send({ ok: false, code: "APPLICATION_CURSOR_INVALID", error: "Application review cursor is invalid or expired." });
    const filters: any = { form: { purpose: "application" } };
    if (query.status) filters.status = query.status;
    if (query.formId) filters.formId = query.formId;
    if (query.q) filters.OR = [{ respondentName: { contains: query.q, mode: "insensitive" } }, { respondentEmail: { contains: query.q, mode: "insensitive" } }];
    const position = cursorWhere(cursor, "submittedAt", "desc");
    const where = position ? { AND: [filters, position] } : filters;
    const submissions = await prisma.studioFormSubmission.findMany({ where, include: { form: true, formVersion: true }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
    const page = buildCursorPage(submissions, query.limit, "submittedAt");
    return { applications: page.items.map(serializeApplication), page: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: query.limit } };
  });

  // Deep links must load one record through the same admin authorization as
  // the paginated review queue. Never expose applicant answers in a public
  // resolver or cache a revoked reviewer grant.
  app.get("/api/studio-systems/applications/:submissionId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { submissionId } = z.object({ submissionId: z.string().min(1).max(160) }).parse(request.params);
    const submission = await prisma.studioFormSubmission.findFirst({
      where: { id: submissionId, form: { purpose: "application" } },
      include: { form: true, formVersion: true },
    });
    reply.header("Cache-Control", "no-store");
    if (!submission) return reply.code(404).send({ ok: false, code: "APPLICATION_NOT_FOUND", error: "Application not found or unavailable." });
    return { ok: true, application: serializeApplication(submission) };
  });

  app.patch("/api/studio-systems/applications/:submissionId/review", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { submissionId } = z.object({ submissionId: z.string().min(1) }).parse(request.params);
    const body = studioApplicationReviewSchema.parse(request.body || {});
    const submission = await prisma.studioFormSubmission.findFirst({ where: { id: submissionId, form: { purpose: "application" } }, include: { form: true, formVersion: true } });
    if (!submission) return reply.code(404).send({ ok: false, code: "APPLICATION_NOT_FOUND", error: "Application not found." });
    if (submission.status === "converted" || submission.convertedUserId) return reply.code(409).send({ ok: false, code: "APPLICATION_ALREADY_CONVERTED", error: "Converted applications are read-only." });
    // The compare-and-swap happens inside the UPDATE, not just the preceding read.
    // Another admin may have reviewed or converted this submission meanwhile.
    let saved: any;
    try {
      saved = await prisma.$transaction(async (tx: any) => {
        const changed = await tx.studioFormSubmission.updateMany({
          where: applicationReviewWhere(submission.id, body.expectedUpdatedAt),
          data: { status: body.status, reviewedAt: new Date(), reviewedById: actor?.id || null, reviewNote: body.note || null },
        });
        if (changed.count !== 1) throw Object.assign(new Error("This application changed since you opened it. Refresh before deciding."), { code: "APPLICATION_REVIEW_STALE" });
        const next = await tx.studioFormSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { form: true, formVersion: true } });
        // Keep the approval actionable until conversion; rejected applications
        // have no further action. Preserve historical Inbox evidence.
        if (body.status === "rejected") await tx.notificationInboxItem.updateMany({
          where: { groupKey: `application:${submission.id}`, requiresAction: true },
          data: { requiresAction: false, acknowledgedAt: new Date() },
        });
        await appendSecurityAuditEvent(tx, {
          event: "studio.application_reviewed", actorUserId: actor?.id || null,
          workspaceId: null, result: "SUCCESS", reasonCode: body.status.toUpperCase(),
          metadata: { submissionId: submission.id, status: body.status },
        });
        return next;
      });
    } catch (error: any) {
      if (error?.code === "APPLICATION_REVIEW_STALE") return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    try { await logActivity?.({ userId: actor?.id, type: "reviewed", entityType: "studio_application", entityId: saved.id, title: "Application reviewed", message: `${saved.form.title}: ${body.status}` }); }
    catch { /* Review and its security evidence have already committed. */ }
    return serializeApplication(saved);
  });

  app.post("/api/studio-systems/applications/:submissionId/convert", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { submissionId } = z.object({ submissionId: z.string().min(1) }).parse(request.params);
    const body = studioApplicationConversionSchema.parse(request.body || {});
    const submission = await prisma.studioFormSubmission.findFirst({ where: { id: submissionId, form: { purpose: "application" } }, include: { form: true, formVersion: true } });
    if (!submission) return reply.code(404).send({ ok: false, code: "APPLICATION_NOT_FOUND", error: "Application not found." });
    if (submission.convertedUserId || submission.status === "converted") return reply.code(409).send({ ok: false, code: "APPLICATION_ALREADY_CONVERTED", error: "This application has already been converted." });
    if (submission.status !== "approved") return reply.code(409).send({ ok: false, code: "APPLICATION_APPROVAL_REQUIRED", error: "Approve the application before creating a person." });
    let username = "";
    try { username = normalizeAuthUsername(body.username); } catch (error) { return reply.code(400).send({ ok: false, code: "USERNAME_INVALID", error: error instanceof Error ? error.message : "Invalid username." }); }
    if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) return reply.code(409).send({ ok: false, code: "USERNAME_EXISTS", error: "That username is already assigned." });
    const onboardingVersion = body.onboardingVersionId ? await prisma.studioOnboardingPlanVersion.findUnique({ where: { id: body.onboardingVersionId }, include: { plan: true } }) : null;
    if (body.onboardingVersionId && (!onboardingVersion || onboardingVersion.status !== "published" || onboardingVersion.plan.status !== "active")) return reply.code(400).send({ ok: false, code: "ONBOARDING_VERSION_INVALID", error: "Choose an active published onboarding version." });
    const definition = parseStudioJson(submission.formVersion.schemaJson, { fields: [] });
    const answers = parseStudioJson(submission.answersJson, {});
    let profile: Record<string, unknown>;
    try {
      profile = buildApplicationProfile(definition.fields, answers, body.selectedFieldIds);
    } catch (error: any) {
      if (error instanceof ApplicationMappingError) return reply.code(400).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
    const selected = new Set(body.selectedFieldIds);
    const workspace = await prisma.workspace.findFirstOrThrow();
    const workforceKeys = new Set(["title", "workLocation", "timezone", "employmentType"]);
    const userProfile = Object.fromEntries(Object.entries(profile).filter(([key]) => !workforceKeys.has(key)));
    const workforceProfile = Object.fromEntries(Object.entries(profile).filter(([key]) => workforceKeys.has(key)));
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const convertedAt = new Date();
    let result: any;
    try { result = await prisma.$transaction(async (tx: any) => {
      const claim = await tx.studioFormSubmission.updateMany({ where: applicationConversionWhere(submission.id, body.expectedUpdatedAt), data: { status: "converted", convertedAt } });
      if (!claim.count) throw Object.assign(new Error("This application changed since it was approved or has already been converted. Refresh before creating a person."), { code: "APPLICATION_CONVERSION_CONFLICT" });
      // Never trust a plan fetched before opening the transaction: its status,
      // publication and audience can change while the operator confirms.
      const currentOnboardingVersion = body.onboardingVersionId
        ? await tx.studioOnboardingPlanVersion.findUnique({ where: { id: body.onboardingVersionId }, include: { plan: true } }) : null;
      if (body.onboardingVersionId && (!currentOnboardingVersion || currentOnboardingVersion.status !== "published" || currentOnboardingVersion.plan?.status !== "active"))
        throw Object.assign(new Error("The onboarding version changed. Refresh and select an active published version."), { code: "ONBOARDING_VERSION_STALE" });
      const created = await tx.user.create({ data: {
        username, passwordHash, passwordChangedAt: null, accountState: "PASSWORD_CHANGE_REQUIRED", failedLoginCount: 0, lockedUntil: null,
        invitedById: actor?.id || null, hideLegalName: true, hideLocation: false, toolPermissions: "{}", projectPermissions: "{}",
        ...userProfile, memberships: { create: { workspaceId: workspace.id, role: "member" } },
      }, include: { memberships: true } });
      await syncUserWorkforceAuthorities(tx, { workspaceId: workspace.id, userId: created.id, input: { ...workforceProfile, availability: "available" }, create: true });
      let onboarding: any = null;
      if (currentOnboardingVersion) {
        // Strict audience resolution: DB failures must not become an eligible
        // match for exclusion audiences, or an invisible skipped assignment.
        const context = await loadStudioAudienceUserContext(tx, created, { strict: true });
        const eligible = studioAudienceMatchesContext(currentOnboardingVersion.plan.audienceJson, created.id, context);
        if (!eligible) throw Object.assign(new Error("This onboarding plan does not include the new person. Choose another plan or select no onboarding."), { code: "ONBOARDING_AUDIENCE_DENIED" });
        const assigned = await createStudioOnboardingAssignment(tx, currentOnboardingVersion, created.id, "application_conversion", convertedAt);
        onboarding = { requestedVersionId: currentOnboardingVersion.id, assigned: true, assignmentId: assigned.assignment.id, planTitle: currentOnboardingVersion.plan.title };
        // First-login action is created transactionally with the assignment,
        // not left to an eventually consistent activity worker.
        await tx.notificationInboxItem.create({ data: {
          userId: created.id, category: "action", priority: "normal", title: "Complete your studio onboarding",
          message: currentOnboardingVersion.plan.title, entityType: "studio_onboarding_assignment", entityId: assigned.assignment.id,
          resourceKind: "studio_onboarding_assignment", resourceId: assigned.assignment.id,
          groupKey: `onboarding:${assigned.assignment.id}:assigned`, tool: "people", signal: "onboarding",
          requiresAction: true,
          metadata: JSON.stringify({ onboardingAssignmentId: assigned.assignment.id, onboardingVersionId: currentOnboardingVersion.id }),
        } });
      }
      await tx.studioFormSubmission.update({ where: { id: submission.id }, data: { status: "converted", convertedUserId: created.id, convertedAt, conversionJson: JSON.stringify({ selectedFieldIds: [...selected], mappedKeys: Object.keys(profile), workspaceRole: "member", onboarding }) } });
      // The pending application Inbox action is complete only when conversion
      // AND account/security-audit creation commit successfully.
      await tx.notificationInboxItem.updateMany({
        where: { groupKey: `application:${submission.id}`, requiresAction: true },
        data: { requiresAction: false, acknowledgedAt: convertedAt },
      });
      await appendSecurityAuditEvent(tx, {
        event: "account.created", actorUserId: actor?.id || null,
        targetUserId: created.id, workspaceId: workspace.id, result: "SUCCESS",
        reasonCode: "APPLICATION_CONVERTED",
        metadata: { workspaceRole: "member", applicationSubmissionId: submission.id,
          onboardingVersionId: currentOnboardingVersion?.id || null },
      });
      return { created, onboarding };
    }); } catch (error: any) {
      if (["APPLICATION_CONVERSION_CONFLICT", "ONBOARDING_VERSION_STALE", "ONBOARDING_AUDIENCE_DENIED"].includes(error?.code)) return reply.code(409).send({ ok: false, code: error.code, error: error.message });
      if (error?.code === "P2002") return reply.code(409).send({ ok: false, code: "USERNAME_EXISTS", error: "That username is already assigned." });
      throw error;
    }
    const created = result.created;
    try { await logActivity?.({ userId: actor?.id, type: "converted", entityType: "studio_application", entityId: submission.id, title: "Application converted to person", message: created.displayName || created.username, metadata: { createdUserId: created.id, mappedKeys: Object.keys(profile), onboarding: result.onboarding } }); }
    catch { /* Account and durable security audit have already committed. Never lose the one-time credential response to a non-security activity projection failure. */ }
    return { ok: true, user: { id: created.id, username: created.username, displayName: created.displayName, email: created.email, accountState: created.accountState, workspaceRole: "member" }, temporaryPassword, onboarding: result.onboarding };
  });

  // Announcements are an administrative corpus. The full list must remain
  // accessible without an unadvertised 250-row ceiling, and a direct link to
  // a record must work even when it lies outside the first page.
  app.get("/api/studio-systems/announcements", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().max(500).optional(),
      q: z.string().trim().max(120).default(""),
    }).parse(request.query || {});
    const position = decodeCursor(query.cursor);
    if (query.cursor && !position) return reply.code(400).send({ ok: false, code: "ANNOUNCEMENT_CURSOR_INVALID", error: "Invalid announcement page cursor. Refresh the list." });
    const constraints: any[] = [];
    if (position) constraints.push(cursorWhere(position, "createdAt"));
    if (query.q) constraints.push({ OR: [
      { title: { contains: query.q, mode: "insensitive" } },
      { body: { contains: query.q, mode: "insensitive" } },
    ] });
    const rows = await prisma.studioAnnouncement.findMany({
      ...(constraints.length ? { where: { AND: constraints } } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    });
    const page = buildCursorPage(rows, query.limit, "createdAt");
    reply.header("Cache-Control", "private, no-store");
    return { announcements: page.items.map(serializeAnnouncement), nextCursor: page.nextCursor, hasMore: page.hasMore };
  });

  app.get("/api/studio-systems/announcements/:announcementId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { announcementId } = z.object({ announcementId: z.string().min(1).max(200) }).parse(request.params);
    const announcement = await prisma.studioAnnouncement.findUnique({ where: { id: announcementId } });
    if (!announcement) return reply.code(404).send({ ok: false, code: "ANNOUNCEMENT_UNAVAILABLE", error: "Announcement unavailable." });
    reply.header("Cache-Control", "private, no-store");
    return { announcement: serializeAnnouncement(announcement) };
  });

  // A tab can reload after the server committed a create but before the
  // response arrived. Recover by opaque intent ID, always scoped to the
  // current authenticated author and current administrator permission.
  // This endpoint never starts, repeats, publishes or schedules an operation.
  app.get("/api/studio-systems/announcements/create-intents/:intentId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    if (!actor?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to review announcement creation." });
    const { intentId } = z.object({ intentId: z.string().uuid() }).parse(request.params);
    const prior = await prisma.studioAnnouncement.findFirst({ where: { createdById: actor.id, createIntentId: intentId } });
    reply.header("Cache-Control", "private, no-store");
    if (!prior) return reply.code(404).send({ ok: false, code: "ANNOUNCEMENT_INTENT_UNRESOLVED", error: "No committed announcement was found for this request identity." });
    return { ok: true, announcement: serializeAnnouncement(prior) };
  });

  app.post("/api/studio-systems/announcements", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    if (!actor?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to create announcements." });
    const body = studioAnnouncementCreateSchema.parse(request.body || {});
    const scheduledAt = body.scheduledAt ?? null;
    const digest = announcementCreateDigest(body);
    const lookup = { createdById: actor.id, createIntentId: body.createIntentId };
    const replay = async () => {
      if (!body.createIntentId) return null;
      const prior = await prisma.studioAnnouncement.findFirst({ where: lookup });
      if (!prior) return null;
      if (prior.createPayloadSha256 !== digest) {
        return reply.code(409).send({ ok: false, code: "ANNOUNCEMENT_CREATE_INTENT_CONFLICT", error: "This create request identity was previously used with different content. Start a new creation." });
      }
      // Authorization was checked by requireAdmin above, including on replays.
      reply.header("X-Cluster-Create-Replayed", "true");
      reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send(serializeAnnouncement(prior));
    };
    const prior = await replay();
    if (prior) return prior;
    if (scheduledAt && (scheduledAt.getTime() <= Date.now() + 60_000 || scheduledAt.getTime() > Date.now() + 366 * 86_400_000)) return reply.code(400).send({ ok: false, code: "ANNOUNCEMENT_SCHEDULE_INVALID", error: "Choose a time at least one minute ahead and within one year." });
    try {
      const saved = await prisma.studioAnnouncement.create({ data: { title: body.title, body: body.body, audienceJson: JSON.stringify(body.audience), priority: body.priority, requiresAcknowledgement: body.requiresAcknowledgement, discordDeliveryRequested: body.discordDeliveryRequested, status: scheduledAt ? "scheduled" : "draft", scheduledAt, createdById: actor.id, createIntentId: body.createIntentId ?? null, createPayloadSha256: body.createIntentId ? digest : null } });
      reply.header("Cache-Control", "private, no-store");
      return reply.code(201).send(serializeAnnouncement(saved));
    } catch (error) {
      // Another process may have committed the same intent concurrently.
      // Never retry a database error blindly; only replay a proven unique pair.
      if (body.createIntentId && isAnnouncementCreateUniqueConflict(error)) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
      }
      throw error;
    }
  });

  // A preview reveals ONLY the current eligible recipient count, never a list
  // of people or a cached promise of future delivery. Publication re-evaluates
  // the audience transactionally after any membership / expiry changes.
  app.post("/api/studio-systems/announcements/audience-preview", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { audience } = studioAnnouncementAudiencePreviewSchema.parse(request.body || {});
    const userIds = await resolveStudioAudienceUserIds(prisma, audience, { strict: true });
    if (userIds.length > 5_000) return reply.code(409).send({ ok: false, code: "ANNOUNCEMENT_AUDIENCE_LIMIT", error: "Audience exceeds the 5,000-recipient publication limit." });
    return { ok: true, eligibleNow: userIds.length, limit: 5_000, advisory: true };
  });

  app.put("/api/studio-systems/announcements/:announcementId/draft", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { announcementId } = z.object({ announcementId: z.string().min(1) }).parse(request.params);
    const body = studioAnnouncementDraftEditSchema.parse(request.body || {});
    const result = await prisma.studioAnnouncement.updateMany({
      where: {
        id: announcementId, revision: body.revision,
        // Scheduled messages can be edited until publication is imminent. This
        // predicate is evaluated by the database, not a stale preliminary read.
        OR: [{ status: "draft" }, { status: "scheduled", scheduledAt: { gt: new Date(Date.now() + 60_000) } }],
      },
      data: {
        title: body.title, body: body.body, audienceJson: JSON.stringify(body.audience),
        priority: body.priority, requiresAcknowledgement: body.requiresAcknowledgement,
        discordDeliveryRequested: body.discordDeliveryRequested, revision: { increment: 1 },
      },
    });
    if (result.count !== 1) return reply.code(409).send({ ok: false, code: "ANNOUNCEMENT_DRAFT_STALE", error: "The announcement was published, is about to publish, or has changed. Reload before editing." });
    return { ok: true, announcement: serializeAnnouncement(await prisma.studioAnnouncement.findUnique({ where: { id: announcementId } })) };
  });

  app.get("/api/studio-systems/announcements/:announcementId/report", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { announcementId } = z.object({ announcementId: z.string().min(1) }).parse(request.params);
    const announcement = await prisma.studioAnnouncement.findUnique({ where: { id: announcementId } });
    if (!announcement) return reply.code(404).send({ ok: false, code: "ANNOUNCEMENT_NOT_FOUND", error: "Announcement not found." });
    const groupKey = `announcement:${announcement.id}`;
    const [materialized, read, acknowledged, pendingAcknowledgement] = await Promise.all([
      prisma.notificationInboxItem.count({ where: { groupKey } }),
      prisma.notificationInboxItem.count({ where: { groupKey, readAt: { not: null } } }),
      prisma.notificationInboxItem.count({ where: { groupKey, acknowledgedAt: { not: null } } }),
      announcement.requiresAcknowledgement ? prisma.notificationInboxItem.count({ where: { groupKey, requiresAction: true, acknowledgedAt: null } }) : Promise.resolve(0),
    ]);
    return { announcementId: announcement.id, deliveryCount: announcement.deliveryCount, materialized, read, acknowledged, pendingAcknowledgement, publishedAt: announcement.publishedAt };
  });

  app.put("/api/studio-systems/announcements/:announcementId/schedule", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { announcementId } = z.object({ announcementId: z.string().min(1) }).parse(request.params);
    const { revision, scheduledAt } = studioAnnouncementScheduleSchema.parse(request.body || {});
    if (scheduledAt && (scheduledAt.getTime() <= Date.now() + 60_000 || scheduledAt.getTime() > Date.now() + 366 * 86_400_000))
      return reply.code(400).send({ ok: false, code: "ANNOUNCEMENT_SCHEDULE_INVALID", error: "Choose a time at least one minute ahead and within one year." });
    const result = await prisma.studioAnnouncement.updateMany({
      where: { id: announcementId, revision, status: { in: ["draft", "scheduled"] } },
      data: { status: scheduledAt ? "scheduled" : "draft", scheduledAt, cancelledAt: scheduledAt ? null : new Date(), revision: { increment: 1 } },
    });
    if (result.count !== 1) return reply.code(409).send({ ok: false, code: "ANNOUNCEMENT_SCHEDULE_STALE", error: "This announcement has changed or has already been published. Reload the list." });
    return { ok: true, announcement: serializeAnnouncement(await prisma.studioAnnouncement.findUnique({ where: { id: announcementId } })) };
  });

  app.post("/api/studio-systems/announcements/:announcementId/publish", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { announcementId } = z.object({ announcementId: z.string().min(1) }).parse(request.params);
    const result = await announcementDelivery.publish(announcementId, { actorUserId: actor?.id || null, scheduled: false });
    if (result.outcome !== "published") return reply.code(result.outcome === "not_found" ? 404 : 409).send({ ok: false, code: "ANNOUNCEMENT_NOT_DRAFT", error: "Only an unpublished draft can be published manually. Cancel its schedule first." });
    return { ok: true, announcement: serializeAnnouncement(await prisma.studioAnnouncement.findUnique({ where: { id: announcementId } })), deliveryCount: result.deliveryCount };
  });
}
