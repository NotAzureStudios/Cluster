import { createHash } from "node:crypto";
import {
  PACKET_COMPLIANCE_DATA_FIELDS,
  POLICY_COMPLIANCE_DATA_FIELDS,
  STUDIO_FORM_TEMPLATES,
  projectVisibleStudioFormAnswers,
  studioAudienceSchema,
  studioFormCreateSchema,
  studioFormTemplateCreateSchema,
  studioFormSubmissionSchema,
  studioFormVersionCreateSchema,
  studioPolicyAcceptanceSchema,
  studioPolicyCreateSchema,
  studioPolicyVersionCreateSchema,
} from "@cluster/shared";
import { z } from "zod";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { parseStudioJson as parseJson, studioAudienceMatchesUser as audienceMatchesUser, parseStudioAudience, loadStudioAudienceUserContext, studioAudienceMatchesContext } from "../access/studio-audience.js";
import { serializeStudioForm as serializeForm, serializeStudioFormVersion as serializeFormVersion, validateStudioFormAnswers as validateAnswers } from "./studio-form-runtime.js";
import { reconcileStudioKnowledgeAssignments } from "./studio-knowledge-runtime.js";
import { summarizeStudioOnboardingAttention } from "./studio-onboarding-attention.js";
import { summarizeStudioKnowledgeAttention } from "./studio-knowledge-attention.js";
import { ensureStudioKnowledgePersonnelRecord } from "./studio-knowledge-evidence.js";
import { resolveAuthorizedStudioFormTarget } from "./studio-form-target-admission.js";
import { applyStudioKnowledgeComplianceQuery, studioKnowledgeComplianceRows } from "./studio-knowledge-compliance.js";

function contentHash(body: string) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function serializePolicy(policy: any) {
  return {
    ...policy,
    audience: studioAudienceSchema.parse(parseJson(policy.audienceJson, { mode: "all", targets: [] })),
    audienceJson: undefined,
    versions: Array.isArray(policy.versions) ? policy.versions.map(serializePolicyVersion) : undefined,
  };
}

function serializePolicyVersion(version: any) {
  return { ...version };
}

export function registerStudioSystemsRoutes(deps: any) {
  const { app, prisma, authorization, getCurrentUser, logActivity } = deps;

  async function requireAdmin(request: any, reply: any) {
    return authorization.requireTool(request, reply, "settings", "edit");
  }

  async function requireUser(request: any, reply: any) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." }); return null; }
    return user;
  }


  // Narrow review access is NOT Studio Settings edit authority. The grant must
  // remain active on every request, including bookmarked response URLs.
  function eligibleFormReviewerUser(user: any) {
    return Boolean(user?.id && !user.archived && !["SUSPENDED", "DISABLED", "PRIVACY_ERASED"].includes(String(user.accountState || ""))
      && (!user.accessExpiresAt || new Date(user.accessExpiresAt) > new Date()));
  }

  async function formReviewGrant(userId: string, formId: string, db: any = prisma) {
    const row = await db.studioFormReviewer.findUnique({ where: { formId_userId: { formId, userId } },
      select: { status: true, form: { select: { purpose: true, status: true } } } });
    return Boolean(row?.status === "active" && row.form?.purpose !== "application" && row.form?.status === "active");
  }

  async function hasStudioSettingsEdit(request: any) {
    if (typeof authorization.authorize === "function") {
      const decision = await authorization.authorize(request, "contribute", { kind: "tool", tool: "settings" }, { minimum: "edit" });
      return Boolean(decision?.allowed);
    }
    // Controlled source-test harness only: suppress the permission-rejection
    // reply while checking whether a scoped delegate also has admin rights.
    const quietReply = { code(_status: number) { return this; }, send(_value: any) { return this; } };
    return Boolean(await authorization.requireTool(request, quietReply, "settings", "edit"));
  }

  async function canReviewForm(request: any, formId: string) {
    const user = await getCurrentUser(request);
    if (await hasStudioSettingsEdit(request)) return true;
    return Boolean(eligibleFormReviewerUser(user) && await formReviewGrant(user.id, formId));
  }

  async function requireFormReviewer(request: any, reply: any, formId: string) {
    if (await canReviewForm(request, formId)) return true;
    reply.code(403).send({ ok: false, code: "FORM_REVIEW_ACCESS_DENIED", error: "You do not have review access to this Form." });
    return false;
  }

  // Non-administrative discovery intentionally returns form labels only, never
  // respondent names, answers, reviewer notes or unpublished form versions.
  app.get("/api/forms/review-assignments", async (request: any, reply: any) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    reply.header("Cache-Control", "private, no-store");
    if (!eligibleFormReviewerUser(user)) return { forms: [] };
    const grants = await prisma.studioFormReviewer.findMany({ where: { userId: user.id, status: "active", form: { purpose: { not: "application" }, status: "active" } },
      select: { formId: true, form: { select: { title: true } } }, orderBy: [{ formId: "asc" }], take: 100 });
    return { forms: grants.map((row: any) => ({ id: row.formId, title: row.form.title })) };
  });

  // Only a Studio administrator can grant or revoke private response access.
  app.get("/api/studio-systems/forms/:formId/reviewers", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId } = z.object({ formId: z.string().min(1).max(160) }).parse(request.params);
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { purpose: true } });
    if (!form || form.purpose === "application") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND" });
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(25), userId: z.string().min(1).max(160).optional() }).parse(request.query || {});
    const rows = await prisma.studioFormReviewer.findMany({ where: { formId, ...(query.userId ? { userId: query.userId } : {}) }, include: { user: { select: { id: true, username: true, displayName: true, accountState: true, archived: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (query.page-1)*query.limit, take: query.limit+1 });
    reply.header("Cache-Control", "private, no-store");
    return { reviewers: rows.slice(0,query.limit).map((row: any) => ({ id: row.id, userId: row.userId,
      user: row.user, revision: row.revision, status: row.status, updatedAt: row.updatedAt })), hasMore: rows.length>query.limit, page: query.page };
  });

  app.put("/api/studio-systems/forms/:formId/reviewers/:userId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, userId } = z.object({ formId: z.string().min(1).max(160), userId: z.string().min(1).max(160) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().min(0) }).strict().parse(request.body || {});
    const [form, user] = await Promise.all([
      prisma.studioForm.findUnique({ where: { id: formId }, select: { purpose: true, status: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!form || form.purpose === "application" || form.status !== "active" || !eligibleFormReviewerUser(user))
      return reply.code(404).send({ ok: false, code: "FORM_REVIEWER_UNAVAILABLE", error: "Choose an active member and a published non-application Form." });
    let saved: any;
    try {
      saved = await prisma.$transaction(async (tx: any) => {
        const currentForm = await tx.studioForm.findUnique({ where: { id: formId }, select: { purpose: true, status: true } });
        const currentUser = await tx.user.findUnique({ where: { id: userId } });
        if (!currentForm || currentForm.purpose === "application" || currentForm.status !== "active" || !eligibleFormReviewerUser(currentUser)) return null;
        if (body.expectedRevision === 0) {
          if (await tx.studioFormReviewer.findUnique({ where: { formId_userId: { formId, userId } }, select: { id: true } })) return null;
          return tx.studioFormReviewer.create({ data: { formId, userId } });
        }
        const changed = await tx.studioFormReviewer.updateMany({ where: { formId, userId, revision: body.expectedRevision },
          data: { status: "active", revision: { increment: 1 } } });
        return changed.count === 1 ? tx.studioFormReviewer.findUnique({ where: { formId_userId: { formId, userId } } }) : null;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (["P2002", "P2034"].includes(String((error as any)?.code || ""))) return reply.code(409).send({ ok: false, code: "FORM_REVIEWER_STALE" });
      throw error;
    }
    if (!saved) return reply.code(409).send({ ok: false, code: "FORM_REVIEWER_STALE", error: "Reviewer assignment changed. Reload before trying again." });
    await logActivity?.({ userId: (await getCurrentUser(request))?.id, type: "assigned", entityType: "studio_form", entityId: formId,
      title: "Form reviewer access granted", metadata: { userIds: [userId], notificationSignal: "assigned" } });
    reply.header("Cache-Control", "private, no-store");
    return { userId, status: saved.status, revision: saved.revision };
  });

  app.delete("/api/studio-systems/forms/:formId/reviewers/:userId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, userId } = z.object({ formId: z.string().min(1).max(160), userId: z.string().min(1).max(160) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().min(1) }).strict().parse(request.body || {});
    const changed = await prisma.studioFormReviewer.updateMany({ where: { formId, userId, revision: body.expectedRevision, status: "active" },
      data: { status: "revoked", revision: { increment: 1 } } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "FORM_REVIEWER_STALE", error: "Reviewer access changed. Reload first." });
    await logActivity?.({ userId: (await getCurrentUser(request))?.id, type: "revoked", entityType: "studio_form", entityId: formId,
      title: "Form reviewer access revoked", metadata: { userIds: [userId] } });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, revision: body.expectedRevision+1 };
  });

  app.get("/api/studio-systems/forms", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const forms = await prisma.studioForm.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" } });
    return { forms: forms.map(serializeForm) };
  });

  app.post("/api/studio-systems/forms", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = studioFormCreateSchema.parse(request.body || {});
    const existing = await prisma.studioForm.findUnique({ where: { key: body.key }, select: { id: true } });
    if (existing) return reply.code(409).send({ ok: false, code: "FORM_KEY_EXISTS", error: "A form already uses this key." });
    const form = await prisma.studioForm.create({ data: { key: body.key, title: body.title, description: body.description || null, purpose: body.purpose, audienceJson: JSON.stringify(body.audience) }, include: { versions: true } });
    const actor = await getCurrentUser(request);
    await logActivity?.({ userId: actor?.id, type: "created", entityType: "studio_form", entityId: form.id, title: "Form created", message: form.title });
    return reply.code(201).send(serializeForm(form));
  });

  app.patch("/api/studio-systems/forms/:formId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { formId } = z.object({ formId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(4000).default(""),
      audience: studioAudienceSchema,
    }).parse(request.body || {});
    if (body.audience.mode !== "all" && !body.audience.targets?.length) return reply.code(400).send({ ok: false, code: "FORM_AUDIENCE_REQUIRED", error: "Choose audience targets or use the whole studio." });
    const changed = await prisma.studioForm.updateMany({ where: { id: formId, updatedAt: new Date(body.expectedUpdatedAt) }, data: { title: body.title, description: body.description || null, audienceJson: JSON.stringify(body.audience) } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "FORM_ACCESS_STALE", error: "This form changed since you opened it. Refresh before editing its audience." });
    const updated = await prisma.studioForm.findUniqueOrThrow({ where: { id: formId }, include: { versions: { orderBy: { version: "desc" }, take: 20 } } });
    await logActivity?.({ userId: actor?.id, type: "updated", entityType: "studio_form", entityId: formId, title: "Form details and audience updated", message: body.title });
    return serializeForm(updated);
  });

  app.post("/api/studio-systems/forms/from-template", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = studioFormTemplateCreateSchema.parse(request.body || {});
    const template: any = STUDIO_FORM_TEMPLATES.find((item) => item.key === body.templateKey);
    if (!template) return reply.code(404).send({ ok: false, code: "FORM_TEMPLATE_NOT_FOUND", error: "Form template not found." });
    const key = body.key || template.key; const title = body.title || template.title;
    if (await prisma.studioForm.findUnique({ where: { key }, select: { id: true } })) return reply.code(409).send({ ok: false, code: "FORM_KEY_EXISTS", error: "A form already uses this key." });
    const settings = { allowDrafts: true, allowMultipleSubmissions: false, confirmationMessage: template.purpose === "application" ? "Application received." : "Submitted.", publicApplication: false, acceptingResponses: true, privacyNotice: "", notifyAdminsOnSubmission: true };
    const form = await prisma.$transaction(async (tx: any) => {
      const created = await tx.studioForm.create({ data: { key, title, description: template.description || null, purpose: template.purpose, audienceJson: JSON.stringify(body.audience) } });
      await tx.studioFormVersion.create({ data: { formId: created.id, version: 1, schemaJson: JSON.stringify({ fields: template.fields }), settingsJson: JSON.stringify(settings), status: "draft", publishedAt: null } });
      return tx.studioForm.findUniqueOrThrow({ where: { id: created.id }, include: { versions: { orderBy: { version: "desc" }, take: 20 } } });
    });
    const actor = await getCurrentUser(request);
    await logActivity?.({ userId: actor?.id, type: "created", entityType: "studio_form", entityId: form.id, title: "Form created from starter", message: `${form.title} · ${template.title}` });
    return reply.code(201).send(serializeForm(form));
  });

  app.post("/api/studio-systems/forms/:formId/versions", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId } = z.object({ formId: z.string().min(1) }).parse(request.params);
    const body = studioFormVersionCreateSchema.parse(request.body || {});
    const form = await prisma.studioForm.findUnique({ where: { id: formId } });
    if (!form) return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    const latest = await prisma.studioFormVersion.findFirst({ where: { formId }, orderBy: { version: "desc" }, select: { version: true } });
    const version = Number(latest?.version || 0) + 1;
    const created = await prisma.$transaction(async (tx: any) => {
      const record = await tx.studioFormVersion.create({ data: { formId, version, schemaJson: JSON.stringify(body.schema), settingsJson: JSON.stringify(body.settings), status: body.publish ? "published" : "draft", publishedAt: body.publish ? new Date() : null } });
      if (body.publish) await tx.studioForm.update({ where: { id: formId }, data: { status: "active" } });
      return record;
    });
    const actor = await getCurrentUser(request);
    await logActivity?.({ userId: actor?.id, type: body.publish ? "published" : "created", entityType: "studio_form_version", entityId: created.id, title: body.publish ? "Form version published" : "Form version created", message: `${form.title} v${version}` });
    return reply.code(201).send(serializeFormVersion(created));
  });

  async function assignmentAudienceAuthorized(form: any, user: any) {
    const audience = parseStudioAudience(form.audienceJson);
    if (audience.mode === "all") return true;
    const context = await loadStudioAudienceUserContext(prisma, user, { strict: true });
    return studioAudienceMatchesContext(audience, String(user.id), context);
  }

  // Assignment is an obligation/deadline overlay, NOT a second authorization channel.
  // Even the administrator cannot assign a form to a person outside its audience.
  app.get("/api/studio-systems/forms/:formId/assignments", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId } = z.object({ formId: z.string().min(1).max(160) }).parse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(["active", "revoked", "all"]).default("active"), userId: z.string().min(1).max(160).optional() }).parse(request.query || {});
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { id: true, purpose: true } });
    if (!form || form.purpose === "application") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "No assignable form." });
    const rows = await prisma.studioFormAssignment.findMany({ where: { formId, ...(query.userId ? { userId: query.userId } : {}), ...(query.status === "all" ? {} : { status: query.status }) },
      include: { user: { select: { id: true, username: true, displayName: true, archived: true, accountState: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit + 1 });
    const visible = rows.slice(0, query.limit);
    const recent = await Promise.all(visible.map((row: any) => prisma.studioFormSubmission.findFirst({
      where: { formId, userId: row.userId }, select: { id: true, status: true, submittedAt: true },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    })));
    const lastByUser = new Map<string, any>();
    visible.forEach((row: any, index: number) => { if (recent[index]) lastByUser.set(row.userId, recent[index]); });
    reply.header("Cache-Control", "private, no-store");
    return { assignments: visible.map((row: any) => ({ id: row.id, user: row.user, status: row.status, required: row.required, dueAt: row.dueAt,
      revision: row.revision, updatedAt: row.updatedAt, lastSubmission: lastByUser.get(row.userId) || null })), page: query.page, hasMore: rows.length > query.limit };
  });

  app.put("/api/studio-systems/forms/:formId/assignments/:userId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, userId } = z.object({ formId: z.string().min(1).max(160), userId: z.string().min(1).max(160) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().min(0), required: z.boolean().default(true), dueAt: z.string().datetime({ offset: true }).nullable().default(null) }).parse(request.body || {});
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { id: true, purpose: true, status: true, audienceJson: true,
      versions: { where: { status: "published" }, take: 1, orderBy: { version: "desc" } } } });
    if (!form || form.purpose === "application" || form.status !== "active" || !form.versions?.length)
      return reply.code(409).send({ ok: false, code: "FORM_NOT_PUBLISHED", error: "Publish the form before assigning people." });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.archived || ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"].includes(user.accountState) || (user.accessExpiresAt && new Date(user.accessExpiresAt) <= new Date()) || !(await assignmentAudienceAuthorized(form, user)))
      return reply.code(404).send({ ok: false, code: "FORM_ASSIGNMENT_PERSON_UNAVAILABLE", error: "Person is unavailable or outside the published audience." });
    let saved: any;
    try {
      saved = await prisma.$transaction(async (tx: any) => {
        // Form publication and eligibility can change while the editor is open.
        const [currentForm, currentUser] = await Promise.all([
          tx.studioForm.findUnique({ where: { id: formId }, select: { id: true, status: true, purpose: true, audienceJson: true,
            versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } } }),
          tx.user.findUnique({ where: { id: userId } }),
        ]);
        if (!currentForm || currentForm.purpose === "application" || currentForm.status !== "active" || !currentForm.versions?.length
          || !currentUser || currentUser.archived || ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"].includes(currentUser.accountState)
          || (currentUser.accessExpiresAt && new Date(currentUser.accessExpiresAt) <= new Date())
          || !(await assignmentAudienceAuthorized(currentForm, currentUser))) return null;
        if (body.expectedRevision === 0) {
          const existing = await tx.studioFormAssignment.findUnique({ where: { formId_userId: { formId, userId } }, select: { id: true } });
          if (existing) return null;
          return tx.studioFormAssignment.create({ data: { formId, userId, assignedById: (await getCurrentUser(request))?.id || null, required: body.required, dueAt: body.dueAt ? new Date(body.dueAt) : null } });
        }
        const changed = await tx.studioFormAssignment.updateMany({ where: { formId, userId, revision: body.expectedRevision }, data: {
          status: "active", required: body.required, dueAt: body.dueAt ? new Date(body.dueAt) : null, revision: { increment: 1 } } });
        return changed.count === 1 ? tx.studioFormAssignment.findUnique({ where: { formId_userId: { formId, userId } } }) : null;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (["P2002", "P2034"].includes(String((error as any)?.code || ""))) return reply.code(409).send({ ok: false, code: "FORM_ASSIGNMENT_STALE", error: "Another assignment update won. Refresh before retrying." });
      throw error;
    }
    if (!saved) return reply.code(409).send({ ok: false, code: "FORM_ASSIGNMENT_STALE", error: "Assignment changed. Refresh before retrying." });
    await logActivity?.({ userId: (await getCurrentUser(request))?.id, type: "assigned", entityType: "studio_form", entityId: formId, title: "Form assignment updated",
      metadata: { userIds: [userId], notifyInbox: true, notificationSignal: "assigned", notificationPriority: "normal", requiresAction: saved.required, notificationGroupKey: `studio-form-assignment:${formId}:${userId}:${saved.revision}` } });
    reply.header("Cache-Control", "private, no-store");
    return saved;
  });

  app.delete("/api/studio-systems/forms/:formId/assignments/:userId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, userId } = z.object({ formId: z.string().min(1).max(160), userId: z.string().min(1).max(160) }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive() }).parse(request.body || {});
    const changed = await prisma.studioFormAssignment.updateMany({ where: { formId, userId, revision: body.expectedRevision, status: "active" }, data: { status: "revoked", revision: { increment: 1 } } });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "FORM_ASSIGNMENT_STALE", error: "Assignment changed or is already revoked." });
    await logActivity?.({ userId: (await getCurrentUser(request))?.id, type: "revoked", entityType: "studio_form", entityId: formId, title: "Form assignment revoked", metadata: { userIds: [userId] } });
    return { ok: true };
  });

  // Studio members only see current, published, audience-authorized forms.
  // Applications have their own public workflow; they are not general assigned forms.
  app.get("/api/forms/available", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    const candidates = await prisma.studioForm.findMany({
      where: { status: "active", purpose: { not: "application" }, versions: { some: { status: "published" } } },
      include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ title: "asc" }, { id: "asc" }], take: 200,
    });
    const accessible = [];
    for (const form of candidates) if (form.versions?.[0] && await audienceMatchesUser(prisma, form.audienceJson, user)) accessible.push(form);
    const submissions = accessible.length ? await prisma.studioFormSubmission.findMany({
      where: { userId: user.id, formId: { in: accessible.map((form: any) => form.id) } },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      select: { id: true, formId: true, status: true, submittedAt: true, formVersionId: true },
    }) : [];
    const drafts = accessible.length ? await prisma.studioFormResponseDraft.findMany({
      where: { userId: user.id, formId: { in: accessible.map((form: any) => form.id) } },
      select: { formId: true, formVersionId: true, updatedAt: true },
    }) : [];
    const assigned = accessible.length ? await prisma.studioFormAssignment.findMany({
      where: { userId: user.id, status: "active", formId: { in: accessible.map((form: any) => form.id) } },
      select: { formId: true, dueAt: true, required: true },
    }) : [];
    const assignmentByForm = new Map<string, any>(assigned.map((row: any) => [row.formId, row]));
    const draftsByForm = new Map<string, any>();
    for (const entry of drafts) draftsByForm.set(entry.formId, entry);
    const history = new Map<string, any>();
    for (const entry of submissions) if (!history.has(entry.formId)) history.set(entry.formId, entry);
    reply.header("Cache-Control", "private, no-store");
    return { forms: accessible.map((form: any) => {
      const version = form.versions[0];
      const settings = parseJson(version.settingsJson, {});
      const previous = history.get(form.id) || null;
      const assignment = assignmentByForm.get(form.id) || null;
      const effectiveDue = assignment?.dueAt || settings.dueAt || null;
      return {
        form: { id: form.id, key: form.key, title: form.title, description: form.description, purpose: form.purpose },
        version: serializeFormVersion(version, { publicView: true }),
        lastSubmission: previous,
        assigned: Boolean(assignment), required: Boolean(assignment?.required),
        dueAt: effectiveDue,
        dueState: previous && ["submitted", "under_review", "approved"].includes(previous.status)
          ? "completed"
          : !effectiveDue ? "none" : new Date(effectiveDue) < new Date() ? "overdue" : "upcoming",
        // Summary only, never responses. A form list must not leak draft answers.
        savedDraft: settings.allowDrafts !== false && settings.acceptingResponses !== false && draftsByForm.has(form.id)
          ? { updatedAt: draftsByForm.get(form.id).updatedAt, stale: draftsByForm.get(form.id).formVersionId !== version.id }
          : null,
        acceptingResponses: settings.acceptingResponses !== false,
        canSubmit: settings.acceptingResponses !== false && (settings.allowMultipleSubmissions === true || !submissions.some((entry: any) => entry.formId === form.id && ["submitted", "under_review", "approved"].includes(entry.status))),
      };
    }) };
  });

  // Only return the owning Form ID after live, per-Form review authorization.
  // A missing, application or unauthorized response shares the same 404 so
  // guessed submission IDs cannot disclose even the existence of a record.
  app.get("/api/studio-systems/submissions/:submissionId/target", async (request: any, reply: any) => {
    const { submissionId } = z.object({ submissionId: z.string().min(1).max(160) }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    const target = await resolveAuthorizedStudioFormTarget({
      submissionId,
      lookup: (id) => prisma.studioFormSubmission.findUnique({ where: { id },
        select: { formId: true, form: { select: { purpose: true } } } }),
      mayReview: (formId) => canReviewForm(request, formId),
    });
    if (!target) return reply.code(404).send({ ok: false, code: "FORM_RESPONSE_NOT_FOUND", error: "Response unavailable." });
    return target;
  });

  // Administrative delivery evidence only. This never exposes draft answers,
  // and old/superseded version reminders are intentionally excluded.
  app.get("/api/studio-systems/forms/:formId/deadline-status", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId } = z.object({ formId: z.string().min(1).max(160) }).parse(request.params);
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { purpose: true } });
    if (!form || form.purpose === "application") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    const version = await prisma.studioFormVersion.findFirst({ where: { formId, status: "published" }, orderBy: { version: "desc" }, select: { id: true, version: true, settingsJson: true } });
    reply.header("Cache-Control", "private, no-store");
    if (!version) return { version: null, dueAt: null, beforeDue: 0, overdue: 0, pending: 0 };
    const counts = await prisma.studioFormReminderDelivery.groupBy({ by: ["stage", "state"], where: { formVersionId: version.id }, _count: { _all: true } });
    const count = (stage: string, state: string) => counts.filter((row: any) => row.stage === stage && row.state === state).reduce((total: number, row: any) => total + row._count._all, 0);
    const settings = parseJson(version.settingsJson, {});
    return { version: version.version, dueAt: settings.dueAt || null,
      beforeDue: count("before_due", "sent"), overdue: count("overdue", "sent"),
      pending: counts.filter((row: any) => row.state !== "sent").reduce((total: number, row: any) => total + row._count._all, 0) };
  });

  app.get("/api/studio-systems/forms/:formId/submissions/:submissionId", async (request: any, reply: any) => {
    if (!(await requireFormReviewer(request, reply, String(request.params?.formId || "")))) return;
    const { formId, submissionId } = z.object({ formId: z.string().min(1).max(160), submissionId: z.string().min(1).max(160) }).parse(request.params);
    const submission = await prisma.studioFormSubmission.findFirst({ where: { id: submissionId, formId, form: { purpose: { not: "application" } } },
      include: { formVersion: { select: { version: true, schemaJson: true } } } });
    reply.header("Cache-Control", "private, no-store");
    if (!submission) return reply.code(404).send({ ok: false, code: "FORM_RESPONSE_NOT_FOUND", error: "Response unavailable." });
    return { submission: {
      id: submission.id, formId: submission.formId, formVersionId: submission.formVersionId,
      version: submission.formVersion.version, submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt, status: submission.status,
      respondentName: submission.respondentName, respondentEmail: submission.respondentEmail, userId: submission.userId,
      answers: parseJson(submission.answersJson, {}), fields: parseJson(submission.formVersion.schemaJson, { fields: [] }).fields || [],
      reviewedAt: submission.reviewedAt, reviewedById: submission.reviewedById, reviewNote: submission.reviewNote,
    } };
  });

  app.get("/api/studio-systems/forms/:formId/submissions", async (request: any, reply: any) => {
    if (!(await requireFormReviewer(request, reply, String(request.params?.formId || "")))) return;
    const { formId } = z.object({ formId: z.string().min(1) }).parse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(25), status: z.enum(["submitted", "under_review", "approved", "rejected"]).optional() }).parse(request.query || {});
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { id: true, purpose: true } });
    if (!form || form.purpose === "application") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Use the Applications workspace to review applications." });
    const where = { formId, ...(query.status ? { status: query.status } : {}) };
    // A queue is not a bulk export of private response answers. Only the
    // explicitly opened detail route returns answers and versioned fields.
    const rows = await prisma.studioFormSubmission.findMany({ where,
      select: { id: true, formId: true, formVersionId: true, formVersion: { select: { version: true } },
        submittedAt: true, updatedAt: true, status: true, respondentName: true, respondentEmail: true },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit + 1 });
    reply.header("Cache-Control", "private, no-store");
    return { submissions: rows.slice(0, query.limit).map((item: any) => ({
      id: item.id, formId: item.formId, formVersionId: item.formVersionId, version: item.formVersion.version,
      submittedAt: item.submittedAt, updatedAt: item.updatedAt, status: item.status,
      respondentName: item.respondentName, respondentEmail: item.respondentEmail,
    })), page: query.page, hasMore: rows.length > query.limit };
  });

  app.patch("/api/studio-systems/forms/:formId/submissions/:submissionId/review", async (request: any, reply: any) => {
    if (!(await requireFormReviewer(request, reply, String(request.params?.formId || "")))) return;
    const actor = await getCurrentUser(request);
    const { formId, submissionId } = z.object({ formId: z.string().min(1), submissionId: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }), status: z.enum(["under_review", "approved", "rejected"]), note: z.string().trim().max(5000).default("") }).parse(request.body || {});
    const form = await prisma.studioForm.findUnique({ where: { id: formId }, select: { purpose: true } });
    if (!form || form.purpose === "application") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Use the Applications workspace to review applications." });
    if (body.status === "rejected" && !body.note) return reply.code(400).send({ ok: false, code: "FORM_REVIEW_REASON_REQUIRED", error: "Explain why this submission is rejected." });
    const changed = await prisma.$transaction(async (tx: any) => {
      // Review and delegated grant inspection share the same serializable view.
      // Revocation racing a decision cannot silently authorize a new edit.
      if (!actor?.id) return { count: 0 };
      const grant = await formReviewGrant(actor.id, formId, tx);
      if (!grant && !(await hasStudioSettingsEdit(request))) return { count: 0 };
      return tx.studioFormSubmission.updateMany({
        where: { id: submissionId, formId, updatedAt: new Date(body.expectedUpdatedAt), status: body.status === "under_review" ? "submitted" : { in: ["submitted", "under_review"] } },
        data: { status: body.status, reviewNote: body.note || null, reviewedById: actor.id, reviewedAt: new Date() },
      });
    }, { isolationLevel: "Serializable" });
    if (changed.count !== 1) return reply.code(409).send({ ok: false, code: "FORM_REVIEW_STALE", error: "This submission was already reviewed or changed. Refresh before deciding." });
    const saved = await prisma.studioFormSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: { id: true, userId: true, status: true, updatedAt: true, reviewedAt: true, reviewNote: true } });
    await logActivity?.({ userId: actor?.id, type: "reviewed", entityType: "studio_form_submission", entityId: saved.id, title: "Form reviewed", message: `${formId}: ${saved.status}`, metadata: saved.userId && saved.status !== "under_review" ? { userIds: [saved.userId], notifyInbox: true, notificationSignal: "review", notificationPriority: "normal", requiresAction: saved.status === "rejected", notificationGroupKey: `studio-form-review:${saved.id}` } : {} });
    return saved;
  });

  // Reviewer-initiated, deliberately privacy-separated handoff: Project members
  // receive a neutral issue, never respondent answers, email, Form ID or review notes.
  // The private join is readable only through this Studio-admin surface.
  app.get("/api/studio-systems/forms/:formId/submissions/:submissionId/project-followups", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, submissionId } = z.object({ formId: z.string().min(1).max(160), submissionId: z.string().min(1).max(160) }).parse(request.params);
    const submission = await prisma.studioFormSubmission.findFirst({ where: { id: submissionId, formId, form: { purpose: { not: "application" } } }, select: { id: true } });
    if (!submission) return reply.code(404).send({ ok: false, code: "FORM_SUBMISSION_NOT_FOUND", error: "Form response not found." });
    const records = await prisma.studioFormProjectFollowup.findMany({ where: { submissionId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, projectId: true, controlRecordId: true, createdAt: true } });
    reply.header("Cache-Control", "private, no-store");
    return { followups: records };
  });

  app.post("/api/studio-systems/forms/:formId/submissions/:submissionId/project-followups", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, submissionId } = z.object({ formId: z.string().min(1).max(160), submissionId: z.string().min(1).max(160) }).parse(request.params);
    const body = z.object({ projectId: z.string().min(1).max(160), expectedUpdatedAt: z.string().datetime({ offset: true }),
      title: z.string().trim().min(3).max(180), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium") }).strict().parse(request.body || {});
    const actor = await getCurrentUser(request);
    if (!actor?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to create Project follow-up." });
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project || project.archived || !["active", "on_hold", "on hold"].includes(String(project.status || "").toLowerCase()))
      return reply.code(404).send({ ok: false, code: "FORM_FOLLOWUP_PROJECT_UNAVAILABLE", error: "Choose an active Project." });
    if (!(await authorization.requireProjectResource(request, reply, project, "viewer", "contribute"))) return;
    const existing = await prisma.studioFormProjectFollowup.findUnique({ where: { submissionId_projectId: { submissionId, projectId: project.id } },
      select: { id: true, projectId: true, controlRecordId: true, createdAt: true } });
    if (existing) { reply.header("Cache-Control", "private, no-store"); return { ...existing, alreadyExists: true }; }
    let result: any;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        // The submission must have entered an explicit reviewer state and remain
        // on the revision the reviewer saw. A user cannot manufacture a follow-up
        // for an unpublished draft or silently act on stale review evidence.
        const submission = await tx.studioFormSubmission.findFirst({ where: { id: submissionId, formId,
          form: { purpose: { not: "application" } }, updatedAt: new Date(body.expectedUpdatedAt),
          status: { in: ["under_review", "approved", "rejected"] } }, select: { id: true } });
        if (!submission) return null;
        const activeProject = await tx.project.findFirst({ where: { id: project.id, archived: false,
          status: { in: ["active", "on_hold", "on hold"] } }, select: { id: true } });
        if (!activeProject) return null;
        const control = await tx.projectControlRecord.create({ data: { projectId: project.id, kind: "issue", title: body.title,
          description: "Studio reviewer requested Project follow-up. Contact the reviewer for authorized details.",
          category: "form-review-followup", status: "open", priority: body.priority, progress: 0, payload: "{}" } });
        return tx.studioFormProjectFollowup.create({ data: { submissionId, projectId: project.id, controlRecordId: control.id },
          select: { id: true, projectId: true, controlRecordId: true, createdAt: true } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (["P2002", "P2034"].includes(String((error as any)?.code || "")))
        return reply.code(409).send({ ok: false, code: "FORM_FOLLOWUP_CONFLICT", error: "A follow-up was created or modified concurrently. Refresh before retrying." });
      throw error;
    }
    if (!result) return reply.code(409).send({ ok: false, code: "FORM_FOLLOWUP_STALE", error: "Submission review or Project availability changed. Refresh before retrying." });
    await logActivity?.({ userId: actor.id, projectId: project.id, type: "created", entityType: "control", entityId: result.controlRecordId,
      title: "Project review follow-up created", message: body.title, metadata: { source: "studio-form-review", sourcePrivate: true } });
    reply.header("Cache-Control", "private, no-store");
    return reply.code(201).send({ ...result, alreadyExists: false });
  });

  // Editable drafts, immutable published versions. All state transitions use a revision claim.
  app.patch("/api/studio-systems/forms/:formId/versions/:versionId", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { formId, versionId } = z.object({ formId: z.string().min(1), versionId: z.string().min(1) }).parse(request.params);
    const body = studioFormVersionCreateSchema.omit({ publish: true }).extend({ expectedUpdatedAt: z.string().datetime({ offset: true }), publish: z.boolean().default(false) }).parse(request.body || {});
    const actor = await getCurrentUser(request);
    const updated = await prisma.$transaction(async (tx: any) => {
      const latest = await tx.studioFormVersion.findFirst({ where: { formId }, orderBy: { version: "desc" }, select: { id: true } });
      if (latest?.id !== versionId) return null;
      const changed = await tx.studioFormVersion.updateMany({ where: { id: versionId, formId, status: "draft", updatedAt: new Date(body.expectedUpdatedAt) }, data: { schemaJson: JSON.stringify(body.schema), settingsJson: JSON.stringify(body.settings), ...(body.publish ? { status: "published", publishedAt: new Date() } : {}) } });
      if (changed.count !== 1) return null;
      if (body.publish) await tx.studioForm.update({ where: { id: formId }, data: { status: "active" } });
      return tx.studioFormVersion.findUniqueOrThrow({ where: { id: versionId } });
    });
    if (!updated) return reply.code(409).send({ ok: false, code: "FORM_DRAFT_STALE", error: "The draft changed or was published. Refresh before saving." });
    await logActivity?.({ userId: actor?.id, type: body.publish ? "published" : "updated", entityType: "studio_form_version", entityId: versionId, title: body.publish ? "Form draft published" : "Form draft saved", message: `Form ${formId}` });
    return serializeFormVersion(updated);
  });

  app.get("/api/forms/:formKey", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { formKey } = z.object({ formKey: z.string().min(1).max(120) }).parse(request.params);
    const form = await prisma.studioForm.findUnique({ where: { key: formKey }, include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } } });
    if (!form || form.status !== "active" || !form.versions?.[0]) return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    if (!(await audienceMatchesUser(prisma, form.audienceJson, user))) return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    return serializeForm(form, { publicView: true });
  });

  // Drafts are private to the authenticated respondent. Public applications cannot use
  // this endpoint and drafts never enter submission/reviewer/audit projections.
  async function formDraftContext(request: any, reply: any, requireEnabled = true) {
    const user = await requireUser(request, reply); if (!user) return null;
    const { formKey } = z.object({ formKey: z.string().min(1).max(120) }).parse(request.params);
    const form = await prisma.studioForm.findUnique({ where: { key: formKey } });
    if (!form || form.status !== "active" || form.purpose === "application" || !(await audienceMatchesUser(prisma, form.audienceJson, user))) {
      reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." }); return null;
    }
    const version = await prisma.studioFormVersion.findFirst({ where: { formId: form.id, status: "published" }, orderBy: { version: "desc" } });
    if (!version) { reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." }); return null; }
    const settings = parseJson(version.settingsJson, {});
    if (requireEnabled && (settings.allowDrafts === false || settings.acceptingResponses === false)) {
      reply.code(403).send({ ok: false, code: "FORM_DRAFTS_DISABLED", error: "This form does not allow saving drafts." }); return null;
    }
    return { user, form, version, settings };
  }

  app.get("/api/forms/:formKey/draft", async (request: any, reply: any) => {
    const ctx = await formDraftContext(request, reply); if (!ctx) return;
    const stored = await prisma.studioFormResponseDraft.findUnique({ where: { formId_userId: { formId: ctx.form.id, userId: ctx.user.id } } });
    reply.header("Cache-Control", "private, no-store");
    return { draft: stored ? { formVersionId: stored.formVersionId, answers: parseJson(stored.answersJson, {}), revision: stored.revision, updatedAt: stored.updatedAt, stale: stored.formVersionId !== ctx.version.id } : null };
  });

  app.put("/api/forms/:formKey/draft", async (request: any, reply: any) => {
    const ctx = await formDraftContext(request, reply); if (!ctx) return;
    const body = z.object({ formVersionId: z.string().min(1).max(160), expectedRevision: z.number().int().min(1).nullable(), answers: z.record(z.unknown()) }).parse(request.body || {});
    if (body.formVersionId !== ctx.version.id) return reply.code(409).send({ ok: false, code: "FORM_VERSION_STALE", error: "The form changed. Reload its current version before saving." });
    const encoded = JSON.stringify(body.answers);
    if (Buffer.byteLength(encoded, "utf8") > 65_536) return reply.code(413).send({ ok: false, code: "FORM_DRAFT_TOO_LARGE", error: "Form draft exceeds the 64 KiB limit." });
    const checked = validateAnswers(parseJson(ctx.version.schemaJson, { fields: [] }), body.answers, { partial: true });
    if (!checked.ok) return reply.code(400).send({ ok: false, code: "FORM_DRAFT_INVALID", error: checked.error });
    // The no-duplicate-response rule and the draft write share one SERIALIZABLE
    // transaction with final submission. A late autosave cannot resurrect a
    // private draft after the member successfully submitted that form.
    let saved: any = null;
    let rejected: string | null = null;
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        if (ctx.settings.allowMultipleSubmissions !== true) {
          const submitted = await tx.studioFormSubmission.findFirst({ where: { formId: ctx.form.id, userId: ctx.user.id, status: { in: ["submitted", "under_review", "approved"] } }, select: { id: true } });
          if (submitted) return { rejected: "FORM_ALREADY_SUBMITTED" };
        }
        if (body.expectedRevision === null) {
          const existing = await tx.studioFormResponseDraft.findUnique({ where: { formId_userId: { formId: ctx.form.id, userId: ctx.user.id } } });
          if (existing) return { rejected: "FORM_DRAFT_CONFLICT" };
          const created = await tx.studioFormResponseDraft.create({ data: { formId: ctx.form.id, formVersionId: ctx.version.id, userId: ctx.user.id, answersJson: encoded } });
          return { saved: created };
        }
        const changed = await tx.studioFormResponseDraft.updateMany({ where: { formId: ctx.form.id, userId: ctx.user.id, formVersionId: ctx.version.id, revision: body.expectedRevision }, data: { answersJson: encoded, revision: { increment: 1 } } });
        if (changed.count !== 1) return { rejected: "FORM_DRAFT_CONFLICT" };
        return { saved: await tx.studioFormResponseDraft.findUniqueOrThrow({ where: { formId_userId: { formId: ctx.form.id, userId: ctx.user.id } } }) };
      }, { isolationLevel: "Serializable" });
      saved = result.saved; rejected = result.rejected;
    } catch (cause) {
      if (!["P2002", "P2034"].includes(String((cause as any)?.code || ""))) throw cause;
      rejected = "FORM_DRAFT_CONFLICT";
    }
    if (rejected) return reply.code(409).send({ ok: false, code: rejected, error: rejected === "FORM_ALREADY_SUBMITTED" ? "This form has already been submitted." : "This draft changed elsewhere. Reload it before saving to avoid overwriting newer answers." });
    reply.header("Cache-Control", "private, no-store");
    return { revision: saved.revision, updatedAt: saved.updatedAt, formVersionId: saved.formVersionId };
  });

  app.delete("/api/forms/:formKey/draft", async (request: any, reply: any) => {
    const ctx = await formDraftContext(request, reply, false); if (!ctx) return;
    const body = z.object({ expectedRevision: z.number().int().min(1) }).parse(request.body || {});
    const deleted = await prisma.studioFormResponseDraft.deleteMany({ where: { formId: ctx.form.id, userId: ctx.user.id, revision: body.expectedRevision } });
    if (deleted.count !== 1) return reply.code(409).send({ ok: false, code: "FORM_DRAFT_CONFLICT", error: "The draft changed or was already removed. Refresh before discarding." });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true };
  });

  app.post("/api/forms/:formKey/submissions", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { formKey } = z.object({ formKey: z.string().min(1).max(120) }).parse(request.params);
    const body = studioFormSubmissionSchema.parse(request.body || {});
    const form = await prisma.studioForm.findUnique({ where: { key: formKey } });
    if (!form || form.status !== "active") return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    if (!(await audienceMatchesUser(prisma, form.audienceJson, user))) return reply.code(404).send({ ok: false, code: "FORM_NOT_FOUND", error: "Form not found." });
    const version = await prisma.studioFormVersion.findFirst({ where: { id: body.formVersionId, formId: form.id, status: "published" } });
    if (!version) return reply.code(409).send({ ok: false, code: "FORM_VERSION_STALE", error: "This form version is no longer available." });
    // Submission is bound to the current published revision; older versions cannot bypass updated rules.
    const currentVersion = await prisma.studioFormVersion.findFirst({ where: { formId: form.id, status: "published" }, orderBy: { version: "desc" }, select: { id: true } });
    if (currentVersion?.id !== version.id) return reply.code(409).send({ ok: false, code: "FORM_VERSION_STALE", error: "This form has changed. Reload the latest version." });
    const definition = parseJson(version.schemaJson, { fields: [] });
    const checked = validateAnswers(definition, body.answers);
    if (!checked.ok) return reply.code(400).send({ ok: false, code: "FORM_ANSWERS_INVALID", error: checked.error });
    const effectiveAnswers = projectVisibleStudioFormAnswers(definition.fields || [], body.answers);
    const settings = parseJson(version.settingsJson, {});
    if (settings.acceptingResponses === false) return reply.code(409).send({ ok: false, code: "FORM_CLOSED", error: "This form is not accepting responses." });
    // Serializable write protects the one-response rule across multiple tabs/clients.
    // Checking for a previous submission outside this transaction is not sufficient.
    let outcome: { submission?: any; code?: string };
    try {
      outcome = await prisma.$transaction(async (tx: any) => {
        const current = await tx.studioFormVersion.findFirst({ where: { formId: form.id, status: "published" }, orderBy: { version: "desc" }, select: { id: true } });
        if (current?.id !== version.id) return { code: "FORM_VERSION_STALE" };
        if (settings.allowMultipleSubmissions !== true) {
          const existing = await tx.studioFormSubmission.findFirst({ where: { formId: form.id, userId: user.id, status: { in: ["submitted", "under_review", "approved"] } }, select: { id: true } });
          if (existing) return { code: "FORM_ALREADY_SUBMITTED" };
        }
        const submission = await tx.studioFormSubmission.create({ data: { formId: form.id, formVersionId: version.id, userId: user.id, respondentName: body.respondentName || user.displayName || user.username || null, respondentEmail: body.respondentEmail || user.email || null, answersJson: JSON.stringify(effectiveAnswers), status: "submitted" } });
        await tx.studioFormResponseDraft.deleteMany({ where: { formId: form.id, userId: user.id } });
        return { submission };
      }, { isolationLevel: "Serializable" });
    } catch (cause) {
      if (String((cause as any)?.code || "") === "P2034") return reply.code(409).send({ ok: false, code: "FORM_SUBMISSION_CONFLICT", error: "Another submission was processed at the same time. Refresh the form before trying again." });
      throw cause;
    }
    if (outcome.code) return reply.code(409).send({ ok: false, code: outcome.code, error: outcome.code === "FORM_ALREADY_SUBMITTED" ? "This form has already been submitted." : "This form version changed. Reload it before submitting." });
    const submission = outcome.submission!;
    const adminMemberships = settings.notifyAdminsOnSubmission !== false ? await prisma.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } } }, select: { userId: true } }) : [];
    const adminIds = [...new Set(adminMemberships.map((item: any) => String(item.userId)).filter(Boolean))];
    await logActivity?.({ userId: user.id, type: "submitted", entityType: "studio_form_submission", entityId: submission.id, title: "Form submitted", message: form.title, metadata: { formId: form.id, formVersionId: version.id, ...(adminIds.length ? { userIds: adminIds, notifyInbox: true, notificationSignal: "review", notificationPriority: "normal", requiresAction: true, notificationGroupKey: `studio-form:${submission.id}` } : {}) } });
    return reply.code(201).send({ id: submission.id, formId: form.id, formVersionId: version.id, status: submission.status, submittedAt: submission.submittedAt });
  });

  app.get("/api/studio-systems/policies", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const policies = await prisma.studioPolicy.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" } });
    return { policies: policies.map(serializePolicy) };
  });

  app.post("/api/studio-systems/policies", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = studioPolicyCreateSchema.parse(request.body || {});
    const existing = await prisma.studioPolicy.findUnique({ where: { key: body.key }, select: { id: true } });
    if (existing) return reply.code(409).send({ ok: false, code: "POLICY_KEY_EXISTS", error: "A studio policy already uses this key." });
    const policy = await prisma.studioPolicy.create({ data: { key: body.key, title: body.title, summary: body.summary || null, audienceJson: JSON.stringify(body.audience), requiredForAccess: body.requiredForAccess, recordAcceptance: body.recordAcceptance }, include: { versions: true } });
    const actor = await getCurrentUser(request);
    await logActivity?.({ userId: actor?.id, type: "created", entityType: "studio_policy", entityId: policy.id, title: "Studio policy created", message: policy.title });
    return reply.code(201).send(serializePolicy(policy));
  });

  app.post("/api/studio-systems/policies/:policyId/versions", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { policyId } = z.object({ policyId: z.string().min(1) }).parse(request.params);
    const body = studioPolicyVersionCreateSchema.parse(request.body || {});
    const policy = await prisma.studioPolicy.findUnique({ where: { id: policyId } });
    if (!policy) return reply.code(404).send({ ok: false, code: "POLICY_NOT_FOUND", error: "Studio policy not found." });
    if (body.acceptanceMode === "form" && !body.formVersionId) return reply.code(400).send({ ok: false, code: "POLICY_FORM_REQUIRED", error: "A form-backed policy requires a form version." });
    if (policy.requiredForAccess && body.acceptanceMode === "none") return reply.code(400).send({ ok: false, code: "POLICY_ACCEPTANCE_REQUIRED", error: "Access-blocking policies require an acceptance method." });
    if (body.formVersionId) {
      const formVersion = await prisma.studioFormVersion.findFirst({ where: { id: body.formVersionId, status: "published" }, select: { id: true } });
      if (!formVersion) return reply.code(400).send({ ok: false, code: "POLICY_FORM_INVALID", error: "Choose a published form version." });
    }
    const latest = await prisma.studioPolicyVersion.findFirst({ where: { policyId }, orderBy: { version: "desc" }, select: { version: true } });
    const versionNumber = Number(latest?.version || 0) + 1;
    const hash = contentHash(body.bodyMarkdown);
    const created = await prisma.$transaction(async (tx: any) => {
      const record = await tx.studioPolicyVersion.create({ data: { policyId, version: versionNumber, versionLabel: body.versionLabel, bodyMarkdown: body.bodyMarkdown, contentHash: hash, acceptanceMode: body.acceptanceMode, formVersionId: body.formVersionId || null, effectiveAt: body.effectiveAt || null, status: body.publish ? "published" : "draft", publishedAt: body.publish ? new Date() : null } });
      if (body.publish) await tx.studioPolicy.update({ where: { id: policyId }, data: { status: "active" } });
      return record;
    });
    const actor = await getCurrentUser(request);
    if (body.publish) await reconcileStudioKnowledgeAssignments({ prisma, logActivity, resourceKind: "policy", resourceId: policy.id });
    await logActivity?.({ userId: actor?.id, type: body.publish ? "published" : "created", entityType: "studio_policy_version", entityId: created.id, title: body.publish ? "Studio policy published" : "Studio policy version created", message: `${policy.title} ${body.versionLabel}` });
    return reply.code(201).send(serializePolicyVersion(created));
  });

  app.get("/api/studio-policies/required", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    const policies = await prisma.studioPolicy.findMany({ where: { status: "active" }, include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { title: "asc" } });
    const visible = [] as any[];
    for (const policy of policies) {
      const version = policy.versions?.[0];
      if (!version || !(await audienceMatchesUser(prisma, policy.audienceJson, user))) continue;
      const acceptance = await prisma.studioPolicyAcceptance.findUnique({ where: { policyVersionId_userId: { policyVersionId: version.id, userId: user.id } } });
      const accepted = version.acceptanceMode === "none" || Boolean(acceptance && acceptance.policyContentHash === version.contentHash);
      let formDocument = null;
      let existingFormSubmissionId = null;
      if (version.acceptanceMode === "form" && version.formVersionId) {
        const formVersion = await prisma.studioFormVersion.findUnique({ where: { id: version.formVersionId }, include: { form: true } });
        if (formVersion?.form?.status === "active" && await audienceMatchesUser(prisma, formVersion.form.audienceJson, user)) {
          formDocument = { form: serializeForm({ ...formVersion.form, versions: undefined }, { publicView: true }), version: serializeFormVersion(formVersion, { publicView: true }) };
          const submission = await prisma.studioFormSubmission.findFirst({ where: { userId: user.id, formVersionId: version.formVersionId, status: { in: ["submitted", "under_review", "approved"] } }, orderBy: { submittedAt: "desc" }, select: { id: true } });
          existingFormSubmissionId = submission?.id || null;
        }
      }
      visible.push({ policy: serializePolicy({ ...policy, versions: undefined }), version: serializePolicyVersion(version), formDocument, existingFormSubmissionId, accepted, acceptance: acceptance ? { acceptedAt: acceptance.acceptedAt, acceptanceMode: acceptance.acceptanceMode } : null });
    }
    return { policies: visible, blocking: visible.filter((entry) => entry.policy.requiredForAccess && !entry.accepted).map((entry) => entry.version.id) };
  });

  app.get("/api/my-knowledge", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity, userIds: [user.id] });
    const assignments = await prisma.studioKnowledgeAssignment.findMany({
      where: { userId: user.id, state: "active" },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 500,
    });
    const packetIds = assignments.filter((row: any) => row.resourceKind === "packet").map((row: any) => row.resourceId);
    const policyIds = assignments.filter((row: any) => row.resourceKind === "policy").map((row: any) => row.resourceId);
    const [packetDefinitions, policies] = await Promise.all([
      packetIds.length ? prisma.packetDefinition.findMany({ where: { libraryFolderId: { in: packetIds } }, include: { libraryFolder: { select: { id: true, title: true, body: true, status: true } } } }) : [],
      policyIds.length ? prisma.studioPolicy.findMany({ where: { id: { in: policyIds } }, include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } } }) : [],
    ]);
    const packetById = new Map(packetDefinitions.map((row: any) => [String(row.libraryFolderId), row]));
    const policyById = new Map(policies.map((row: any) => [String(row.id), row]));
    const now = Date.now();
    return {
      assignments: assignments.map((assignment: any) => {
        if (assignment.resourceKind === "packet") {
          const packet: any = packetById.get(String(assignment.resourceId));
          return { id: assignment.id, kind: "packet", resourceId: assignment.resourceId, resourceVersionId: null, title: packet?.libraryFolder?.title || "Required packet", description: packet?.libraryFolder?.body || null, versionLabel: packet?.versionLabel || assignment.versionKey, state: assignment.state, dueAt: assignment.dueAt, overdue: Boolean(assignment.dueAt && new Date(assignment.dueAt).getTime() < now), cycleStartedAt: assignment.cycleStartedAt, nextRequiredAt: assignment.nextRequiredAt, navigation: { screen: "packets", packetId: assignment.resourceId } };
        }
        const policy: any = policyById.get(String(assignment.resourceId));
        const version = policy?.versions?.[0] || null;
        return { id: assignment.id, kind: "policy", resourceId: assignment.resourceId, resourceVersionId: assignment.resourceVersionId, title: policy?.title || "Required policy", description: policy?.summary || null, versionLabel: version?.versionLabel || assignment.versionKey, state: assignment.state, dueAt: assignment.dueAt, overdue: Boolean(assignment.dueAt && new Date(assignment.dueAt).getTime() < now), cycleStartedAt: assignment.cycleStartedAt, nextRequiredAt: null, navigation: { screen: "packets", policyId: assignment.resourceId } };
      }),
    };
  });

  app.post("/api/studio-systems/knowledge/compliance/query", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = z.object({ kind: z.enum(["packet", "policy"]), query: z.unknown().optional() }).parse(request.body || {});
    const fields = body.kind === "packet" ? PACKET_COMPLIANCE_DATA_FIELDS : POLICY_COMPLIANCE_DATA_FIELDS;
    const query = normalizeClusterDataQuery(body.query || {}, { fields, defaultLimit: 100, maxLimit: 500 });
    const rows = await studioKnowledgeComplianceRows(prisma, body.kind);
    const result = applyStudioKnowledgeComplianceQuery(rows, query, query.page?.limit || 100);
    return {
      ok: true,
      dataView: {
        resourceKind: body.kind,
        fields,
        query,
        page: { returned: result.rows.length, total: result.total, truncated: result.truncated },
      },
      rows: result.rows,
    };
  });

  app.get("/api/studio-systems/knowledge/operations-summary", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity });
    reply.header("Cache-Control", "private, no-store");
    const now = new Date();
    const [knowledge, onboarding, pendingApplications, approvedApplications, draftAnnouncements, scheduledAnnouncements, reminderDispatches24h, attendeeReminderEvents] = await Promise.all([
      summarizeStudioKnowledgeAttention(prisma, now),
      summarizeStudioOnboardingAttention(prisma, now),
      prisma.studioFormSubmission.count({ where: { status: { in: ["submitted", "under_review", "approved"] }, form: { purpose: "application" } } }),
      prisma.studioFormSubmission.count({ where: { status: "approved", convertedUserId: null, form: { purpose: "application" } } }),
      prisma.studioAnnouncement.count({ where: { status: "draft" } }),
      prisma.studioAnnouncement.count({ where: { status: "scheduled" } }),
      prisma.calendarEventReminderDispatch.count({ where: { sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
      prisma.calendarEvent.count({ where: { status: "scheduled", reminderMinutes: { not: null }, reminderAudience: "participants" } }),
    ]);
    // Only resolve metadata for the 12 overdue rows actually displayed. No
    // unbounded Packet/Policy catalog fetch, and no truncated responsibility list.
    const packetIds = [...new Set(knowledge.overdueItems.filter((item: any) => item.resourceKind === "packet").map((item: any) => String(item.resourceId)))];
    const policyIds = [...new Set(knowledge.overdueItems.filter((item: any) => item.resourceKind === "policy").map((item: any) => String(item.resourceId)))];
    const [packetDefinitions, policies] = await Promise.all([
      packetIds.length ? prisma.packetDefinition.findMany({ where: { libraryFolderId: { in: packetIds } }, select: { libraryFolderId: true, versionLabel: true, libraryFolder: { select: { title: true } } } }) : [],
      policyIds.length ? prisma.studioPolicy.findMany({ where: { id: { in: policyIds } }, select: { id: true, title: true, versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1, select: { versionLabel: true } } } }) : [],
    ]);
    const packetMap = new Map(packetDefinitions.map((item: any) => [String(item.libraryFolderId), item]));
    const policyMap = new Map(policies.map((item: any) => [String(item.id), item]));
    const overdueItems = knowledge.overdueItems.map((item: any) => {
      const resource: any = item.resourceKind === "packet" ? packetMap.get(String(item.resourceId)) : policyMap.get(String(item.resourceId));
      return { id: item.id, kind: item.resourceKind, resourceId: item.resourceId,
        title: item.resourceKind === "packet" ? resource?.libraryFolder?.title || item.resourceId : resource?.title || item.resourceId,
        versionLabel: item.resourceKind === "packet" ? resource?.versionLabel || null : resource?.versions?.[0]?.versionLabel || null,
        user: item.user, dueAt: item.dueAt, cycleStartedAt: item.cycleStartedAt };
    });
    return {
      generatedAt: now.toISOString(),
      knowledge: { ...knowledge, overdueItems },
      onboarding,
      applications: { pending: pendingApplications, awaitingConversion: approvedApplications },
      announcements: { drafts: draftAnnouncements, scheduled: scheduledAnnouncements },
      calendarReminders: { dispatchedLast24Hours: reminderDispatches24h, attendeeEnabledEvents: attendeeReminderEvents },
      exportKinds: ["packet", "policy"],
    };
  });

  app.post("/api/studio-policies/:versionId/accept", async (request: any, reply: any) => {
    const user = await requireUser(request, reply); if (!user) return;
    const { versionId } = z.object({ versionId: z.string().min(1) }).parse(request.params);
    const body = studioPolicyAcceptanceSchema.parse(request.body || {});
    const version = await prisma.studioPolicyVersion.findUnique({ where: { id: versionId }, include: { policy: true } });
    if (!version || version.status !== "published" || version.policy?.status !== "active") return reply.code(404).send({ ok: false, code: "POLICY_NOT_FOUND", error: "Studio policy version not found." });
    if (!(await audienceMatchesUser(prisma, version.policy.audienceJson, user))) return reply.code(404).send({ ok: false, code: "POLICY_NOT_FOUND", error: "Studio policy version not found." });
    if (version.acceptanceMode === "none") return reply.code(409).send({ ok: false, code: "POLICY_ACCEPTANCE_NOT_REQUIRED", error: "This policy does not require acceptance." });
    if (body.mode !== version.acceptanceMode) return reply.code(409).send({ ok: false, code: "POLICY_ACCEPTANCE_MODE_MISMATCH", error: "Use the acceptance method required by this policy version." });
    if (body.mode === "initials" && !body.initials) return reply.code(400).send({ ok: false, code: "POLICY_INITIALS_REQUIRED", error: "Initials are required." });
    if (body.mode === "signature" && !body.signature) return reply.code(400).send({ ok: false, code: "POLICY_SIGNATURE_REQUIRED", error: "A signature is required." });
    if (body.mode === "form") {
      if (!version.formVersionId || !body.formSubmissionId) return reply.code(400).send({ ok: false, code: "POLICY_FORM_REQUIRED", error: "Complete the required policy form first." });
      const submission = await prisma.studioFormSubmission.findFirst({ where: { id: body.formSubmissionId, userId: user.id, formVersionId: version.formVersionId, status: { in: ["submitted", "under_review", "approved"] } }, select: { id: true } });
      if (!submission) return reply.code(409).send({ ok: false, code: "POLICY_FORM_INCOMPLETE", error: "Complete the required policy form before accepting this policy." });
    }
    const existingAcceptance = await prisma.studioPolicyAcceptance.findUnique({ where: { policyVersionId_userId: { policyVersionId: version.id, userId: user.id } } });
    if (existingAcceptance?.policyContentHash === version.contentHash) {
      return { ok: true, alreadyAccepted: true, acceptedAt: existingAcceptance.acceptedAt, contentHash: existingAcceptance.policyContentHash };
    }
    const acceptance = await prisma.studioPolicyAcceptance.create({
      data: { policyVersionId: version.id, userId: user.id, acceptanceMode: body.mode, initials: body.initials || null, signature: body.signature || null, formSubmissionId: body.formSubmissionId || null, policyContentHash: version.contentHash, evidenceJson: JSON.stringify({ source: "cluster", versionLabel: version.versionLabel }) },
    });
    if (version.policy.recordAcceptance) {
      await ensureStudioKnowledgePersonnelRecord(prisma, { sourceKind: "policy_acceptance", sourceId: acceptance.id, subjectUserId: user.id, actorUserId: user.id, title: `${version.policy.title} acceptance`, recordType: "policy_acceptance", effectiveAt: acceptance.acceptedAt, fields: { policyId: version.policyId, policyVersionId: version.id, policyTitle: version.policy.title, versionLabel: version.versionLabel, contentHash: version.contentHash, acceptanceMode: body.mode } });
    }
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity, resourceKind: "policy", resourceId: version.policyId, userIds: [user.id] });
    await logActivity?.({ userId: user.id, type: "accepted", entityType: "studio_policy_version", entityId: version.id, title: "Studio policy accepted", message: version.policy.title, metadata: { policyId: version.policyId, acceptanceMode: body.mode, acceptanceId: acceptance.id } });
    return { ok: true, acceptedAt: acceptance.acceptedAt, contentHash: acceptance.policyContentHash };
  });
}
