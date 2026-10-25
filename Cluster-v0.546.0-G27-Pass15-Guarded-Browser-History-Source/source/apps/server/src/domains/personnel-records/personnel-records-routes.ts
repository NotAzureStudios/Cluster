import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hasValidSecurityVerification } from "../../core/security-verification.js";
import { untrustedFileResponseHeaders } from "../../core/uploads.js";

const idSchema = z.string().trim().min(1).max(240);
const classificationRank: Record<string, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
const classSchema = z.enum(["public", "internal", "confidential", "restricted"]);
const disclosureSchema = z.enum(["internal_only", "subject_visible", "subject_action_required"]);
const statusSchema = z.enum(["draft", "finalized", "amended", "destroyed"]);

function parseJson(value: unknown, fallback: any) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}
function stringify(value: unknown) { return JSON.stringify(value ?? {}); }
function iso(value: any) { return value?.toISOString?.() || value || null; }
function inside(root: string, candidate: string) {
  const a = path.resolve(root), b = path.resolve(candidate);
  return b === a || b.startsWith(`${a}${path.sep}`);
}
function publicUser(user: any) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.preferredName || user.displayName || user.username, avatarUrl: user.avatarUrl || null };
}
function templateFields(template: any) {
  const fields = parseJson(template?.fieldsJson, []);
  return Array.isArray(fields) ? fields : [];
}
function requiredFieldKeys(template: any) {
  return templateFields(template).filter((field: any) => field?.required).map((field: any) => String(field.key || field.id || "").trim()).filter(Boolean);
}
function missingRequiredFields(template: any, values: Record<string, unknown>) {
  return requiredFieldKeys(template).filter((key) => {
    const value = values[key];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}
function serializeRecord(record: any, options: { includeFields?: boolean; includeHistory?: boolean } = {}) {
  return {
    id: record.id,
    templateId: record.templateId || null,
    subjectUserId: record.subjectUserId,
    subject: publicUser(record.subject),
    custodianUserId: record.custodianUserId || null,
    custodian: publicUser(record.custodian),
    title: record.title,
    recordType: record.recordType,
    status: record.status,
    classification: record.classification,
    disclosurePolicy: record.disclosurePolicy,
    effectiveAt: iso(record.effectiveAt),
    finalizedAt: iso(record.finalizedAt),
    retentionUntil: iso(record.retentionUntil),
    legalHold: Boolean(record.legalHold),
    destructionEligibleAt: iso(record.destructionEligibleAt),
    destroyedAt: iso(record.destroyedAt),
    destructionReason: record.destructionReason || null,
    accessReasonRequired: Boolean(record.accessReasonRequired),
    revision: Number(record.revision || 1),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    template: record.template ? {
      id: record.template.id, key: record.template.key, name: record.template.name,
      description: record.template.description || null, fields: templateFields(record.template),
      requiredAttachments: parseJson(record.template.requiredAttachmentsJson, []), actionType: record.template.actionType || null,
    } : null,
    ...(options.includeFields ? { fields: parseJson(record.fieldsJson, {}) } : {}),
    attachments: (record.attachments || []).map((row: any) => ({
      id: row.id, role: row.role, libraryItemId: row.libraryItemId, addedAt: iso(row.createdAt),
      item: row.libraryItem ? { id: row.libraryItem.id, title: row.libraryItem.title, originalName: row.libraryItem.originalName || null, mimeType: row.libraryItem.mimeType || null, sizeBytes: row.libraryItem.sizeBytes || null, classification: row.libraryItem.classification, status: row.libraryItem.status } : null,
      fileUrl: `/api/personnel-records/${record.id}/attachments/${row.id}/file`,
    })),
    actions: (record.actions || []).map((action: any) => ({ id: action.id, userId: action.userId, user: publicUser(action.user), actionType: action.actionType, status: action.status, dueAt: iso(action.dueAt), completedAt: iso(action.completedAt), evidence: parseJson(action.evidenceJson, {}) })),
    ...(options.includeHistory ? {
      amendments: (record.amendments || []).map((row: any) => ({ id: row.id, actor: publicUser(row.actor), reason: row.reason, previous: parseJson(row.previousJson, {}), next: parseJson(row.nextJson, {}), createdAt: iso(row.createdAt) })),
      accessEvents: (record.accessEvents || []).map((row: any) => ({ id: row.id, actor: publicUser(row.actor), action: row.action, reason: row.reason || null, allowed: Boolean(row.allowed), metadata: parseJson(row.metadata, {}), createdAt: iso(row.createdAt) })),
    } : {}),
  };
}

export function registerPersonnelRecordsRoutes(deps: any) {
  const { app, prisma, authorization, getCurrentUser, getCurrentSession, decorateUserForClient, hasToolPermission, logActivity, logSecurityEvent, dataLayout } = deps;
  const include = {
    template: true,
    subject: true,
    custodian: true,
    attachments: { include: { libraryItem: true, addedBy: true }, orderBy: { createdAt: "asc" } },
    actions: { include: { user: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] },
    amendments: { include: { actor: true }, orderBy: { createdAt: "desc" }, take: 100 },
    accessEvents: { include: { actor: true }, orderBy: { createdAt: "desc" }, take: 100 },
  } as const;

  async function identity(request: any, reply: any) {
    const user = await getCurrentUser(request);
    if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Authentication required." }); return null; }
    const decorated = await decorateUserForClient(user);
    const canAdmin = Boolean(decorated?.isAdmin || hasToolPermission(user, decorated?.workspaceRole, "people", "edit"));
    return { user, decorated, canAdmin };
  }
  async function freshVerification(request: any, reply: any, user: any, requiredReason = false) {
    const session = await getCurrentSession(request);
    const reason = String(request.headers?.["x-cluster-access-reason"] || "").trim();
    if (requiredReason && !reason) {
      reply.code(428).send({ ok: false, code: "PERSONNEL_RECORD_REASON_REQUIRED", error: "An access reason is required for this record." });
      return null;
    }
    if (!session || !(await hasValidSecurityVerification(prisma, { sessionId: session.id, userId: user.id, user, purpose: "personnel_records", minimumStrength: "knowledge" }))) {
      reply.code(428).send({ ok: false, code: "SECURITY_VERIFICATION_REQUIRED", error: "Fresh Personnel Records verification is required.", purpose: "personnel_records", reasonRequired: requiredReason });
      return null;
    }
    return { session, reason: reason || null };
  }
  async function recordAccess(request: any, reply: any, recordId: string, mode: "view" | "edit" | "destroy" = "view") {
    const actor = await identity(request, reply); if (!actor) return null;
    const record = await prisma.personnelRecord.findUnique({ where: { id: recordId }, include });
    if (!record) { reply.code(404).send({ ok: false, code: "PERSONNEL_RECORD_NOT_FOUND", error: "Personnel record not found." }); return null; }
    const subjectVisible = record.subjectUserId === actor.user.id && record.disclosurePolicy !== "internal_only";
    const actionVisible = (record.actions || []).some((row: any) => row.userId === actor.user.id);
    const allowed = actor.canAdmin || (mode === "view" && (subjectVisible || actionVisible));
    if (!allowed) {
      await prisma.personnelRecordAccessEvent.create({ data: { recordId, actorUserId: actor.user.id, action: mode, allowed: false } }).catch(() => undefined);
      reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ACCESS_DENIED", error: "Personnel record access denied." }); return null;
    }
    const highSensitivity = record.classification === "restricted" || Boolean(record.accessReasonRequired) || mode !== "view";
    let verification: any = null;
    if (highSensitivity) {
      verification = await freshVerification(request, reply, actor.user, Boolean(record.accessReasonRequired));
      if (!verification) return null;
    }
    await prisma.personnelRecordAccessEvent.create({ data: { recordId, actorUserId: actor.user.id, action: mode, reason: verification?.reason || null, allowed: true } }).catch(() => undefined);
    return { ...actor, record, verification };
  }
  async function protectAttachment(item: any, classification: string) {
    const metadata = parseJson(item.metadata, {});
    const baseline = metadata.personnelRecordBaseline || { classification: item.classification, visibility: item.visibility, retentionUntil: iso(item.retentionUntil), legalHold: Boolean(item.legalHold) };
    const nextClass = (classificationRank[classification] || 0) > (classificationRank[item.classification] || 0) ? classification : item.classification;
    await prisma.libraryItem.update({ where: { id: item.id }, data: {
      classification: nextClass,
      visibility: nextClass === "public" ? "public" : "restricted",
      metadata: stringify({ ...metadata, personnelRecordProtected: true, personnelRecordBaseline: baseline }),
      revision: { increment: 1 },
    } });
  }
  async function restoreAttachmentIfUnowned(libraryItemId: string) {
    const remaining = await prisma.personnelRecordAttachment.count({ where: { libraryItemId } });
    if (remaining) return;
    const item = await prisma.libraryItem.findUnique({ where: { id: libraryItemId } }); if (!item) return;
    const metadata = parseJson(item.metadata, {}), baseline = metadata.personnelRecordBaseline;
    if (!baseline) return;
    const { personnelRecordProtected, personnelRecordBaseline, ...rest } = metadata;
    await prisma.libraryItem.update({ where: { id: item.id }, data: {
      classification: String(baseline.classification || "internal"), visibility: String(baseline.visibility || "internal"),
      retentionUntil: baseline.retentionUntil ? new Date(baseline.retentionUntil) : null, legalHold: Boolean(baseline.legalHold), metadata: stringify(rest), revision: { increment: 1 },
    } });
  }

  app.get("/api/personnel-record-templates", async (request: any, reply: any) => {
    const actor = await identity(request, reply); if (!actor) return;
    if (!actor.canAdmin) return reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ADMIN_REQUIRED", error: "People administration access required." });
    const rows = await prisma.personnelRecordTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return { ok: true, templates: rows.map((row: any) => ({ ...row, fields: templateFields(row), requiredAttachments: parseJson(row.requiredAttachmentsJson, []) })) };
  });

  app.post("/api/personnel-record-templates", async (request: any, reply: any) => {
    const actor = await identity(request, reply); if (!actor?.canAdmin) return actor ? reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ADMIN_REQUIRED", error: "People administration access required." }) : undefined;
    const body = z.object({ key: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable().optional(), fields: z.array(z.object({ key: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(160), type: z.enum(["text","multiline","number","date","boolean","select","person","url"]), required: z.boolean().optional().default(false), options: z.array(z.string().trim().min(1).max(160)).max(100).optional() })).max(100).default([]), requiredAttachments: z.array(z.string().trim().min(1).max(100)).max(30).default([]), classification: classSchema.default("confidential"), disclosurePolicy: disclosureSchema.default("subject_visible"), retentionDays: z.coerce.number().int().min(0).max(36500).nullable().optional(), actionType: z.enum(["acknowledge","sign","review","supply_evidence"]).nullable().optional() }).parse(request.body || {});
    const row = await prisma.personnelRecordTemplate.create({ data: { key: body.key, name: body.name, description: body.description || null, fieldsJson: stringify(body.fields), requiredAttachmentsJson: stringify(body.requiredAttachments), classification: body.classification, disclosurePolicy: body.disclosurePolicy, retentionDays: body.retentionDays ?? null, actionType: body.actionType || null, createdById: actor.user.id } });
    return reply.code(201).send({ ok: true, template: { ...row, fields: body.fields, requiredAttachments: body.requiredAttachments } });
  });

  app.get("/api/admin/people/:userId/records", async (request: any, reply: any) => {
    const actor = await identity(request, reply); if (!actor?.canAdmin) return actor ? reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ADMIN_REQUIRED", error: "People administration access required." }) : undefined;
    const { userId } = z.object({ userId: idSchema }).parse(request.params);
    const query = z.object({ includeDestroyed: z.coerce.boolean().optional().default(false) }).parse(request.query || {});
    const rows = await prisma.personnelRecord.findMany({ where: { subjectUserId: userId, ...(query.includeDestroyed ? {} : { destroyedAt: null }) }, include, orderBy: { updatedAt: "desc" }, take: 500 });
    return { ok: true, records: rows.map((row: any) => serializeRecord(row, { includeFields: true })) };
  });

  app.get("/api/my-records", async (request: any, reply: any) => {
    const actor = await identity(request, reply); if (!actor) return;
    const rows = await prisma.personnelRecord.findMany({ where: { subjectUserId: actor.user.id, destroyedAt: null, OR: [{ disclosurePolicy: { in: ["subject_visible", "subject_action_required"] } }, { actions: { some: { userId: actor.user.id } } }] }, include, orderBy: { updatedAt: "desc" }, take: 500 });
    return { ok: true, records: rows.map((row: any) => serializeRecord(row, { includeFields: row.classification !== "restricted" })) };
  });

  app.get("/api/personnel-records/:recordId", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "view"); if (!access) return;
    return { ok: true, record: serializeRecord(access.record, { includeFields: true, includeHistory: access.canAdmin }) };
  });

  app.post("/api/admin/personnel-records", async (request: any, reply: any) => {
    const actor = await identity(request, reply); if (!actor?.canAdmin) return actor ? reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ADMIN_REQUIRED", error: "People administration access required." }) : undefined;
    const body = z.object({ subjectUserId: idSchema, templateId: idSchema.nullable().optional(), title: z.string().trim().min(1).max(240), recordType: z.string().trim().min(1).max(120), custodianUserId: idSchema.nullable().optional(), fields: z.record(z.any()).default({}), classification: classSchema.optional(), disclosurePolicy: disclosureSchema.optional(), accessReasonRequired: z.boolean().optional(), effectiveAt: z.coerce.date().nullable().optional(), retentionUntil: z.coerce.date().nullable().optional(), legalHold: z.boolean().optional().default(false), action: z.object({ userId: idSchema, actionType: z.enum(["acknowledge","sign","review","supply_evidence"]), dueAt: z.coerce.date().nullable().optional() }).nullable().optional() }).parse(request.body || {});
    const template = body.templateId ? await prisma.personnelRecordTemplate.findUnique({ where: { id: body.templateId } }) : null;
    if (body.templateId && !template) return reply.code(404).send({ ok: false, code: "PERSONNEL_RECORD_TEMPLATE_NOT_FOUND", error: "Record template not found." });
    const retentionUntil = body.retentionUntil || (template?.retentionDays != null ? new Date(Date.now() + Number(template.retentionDays) * 86400000) : null);
    const row = await prisma.personnelRecord.create({ data: {
      templateId: template?.id || null, subjectUserId: body.subjectUserId, custodianUserId: body.custodianUserId || actor.user.id, createdById: actor.user.id, lastModifiedById: actor.user.id,
      title: body.title, recordType: body.recordType, fieldsJson: stringify(body.fields), classification: body.classification || template?.classification || "confidential", disclosurePolicy: body.disclosurePolicy || template?.disclosurePolicy || "subject_visible", accessReasonRequired: Boolean(body.accessReasonRequired), effectiveAt: body.effectiveAt || null, retentionUntil, legalHold: body.legalHold,
      actions: body.action ? { create: { userId: body.action.userId, actionType: body.action.actionType, dueAt: body.action.dueAt || null } } : template?.actionType ? { create: { userId: body.subjectUserId, actionType: template.actionType } } : undefined,
    }, include });
    await logActivity?.({ userId: actor.user.id, type: "personnel_record_created", entityType: "personnel_record", entityId: row.id, title: "Personnel record created", message: row.title, metadata: { subjectUserId: row.subjectUserId, classification: row.classification } });
    return reply.code(201).send({ ok: true, record: serializeRecord(row, { includeFields: true }) });
  });

  app.patch("/api/admin/personnel-records/:recordId", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "edit"); if (!access || !access.canAdmin) return;
    if (access.record.destroyedAt) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_DESTROYED", error: "Destroyed records cannot be edited." });
    const body = z.object({ title: z.string().trim().min(1).max(240).optional(), fields: z.record(z.any()).optional(), classification: classSchema.optional(), disclosurePolicy: disclosureSchema.optional(), accessReasonRequired: z.boolean().optional(), effectiveAt: z.coerce.date().nullable().optional(), retentionUntil: z.coerce.date().nullable().optional(), legalHold: z.boolean().optional(), expectedRevision: z.coerce.number().int().min(1).optional(), amendmentReason: z.string().trim().min(3).max(1000).optional() }).parse(request.body || {});
    if (body.expectedRevision && body.expectedRevision !== access.record.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Personnel record changed since it was opened.", currentRevision: access.record.revision });
    const wasFinal = ["finalized", "amended"].includes(access.record.status);
    if (wasFinal && !body.amendmentReason) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_AMENDMENT_REASON_REQUIRED", error: "Finalized records require an amendment reason." });
    const previous = serializeRecord(access.record, { includeFields: true });
    const updated = await prisma.$transaction(async (tx: any) => {
      const row = await tx.personnelRecord.update({ where: { id: recordId }, data: { title: body.title, fieldsJson: body.fields ? stringify(body.fields) : undefined, classification: body.classification, disclosurePolicy: body.disclosurePolicy, accessReasonRequired: body.accessReasonRequired, effectiveAt: body.effectiveAt === undefined ? undefined : body.effectiveAt, retentionUntil: body.retentionUntil === undefined ? undefined : body.retentionUntil, legalHold: body.legalHold, status: wasFinal ? "amended" : undefined, lastModifiedById: access.user.id, revision: { increment: 1 } }, include });
      if (wasFinal) await tx.personnelRecordAmendment.create({ data: { recordId, actorUserId: access.user.id, reason: body.amendmentReason!, previousJson: stringify(previous), nextJson: stringify(serializeRecord(row, { includeFields: true })) } });
      return row;
    });
    for (const attachment of updated.attachments || []) await protectAttachment(attachment.libraryItem, updated.classification);
    return { ok: true, record: serializeRecord(updated, { includeFields: true, includeHistory: true }) };
  });

  app.post("/api/admin/personnel-records/:recordId/finalize", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "edit"); if (!access || !access.canAdmin) return;
    if (access.record.destroyedAt) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_DESTROYED", error: "Destroyed records cannot be finalized." });
    const fields = parseJson(access.record.fieldsJson, {}), missing = missingRequiredFields(access.record.template, fields);
    if (missing.length) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_REQUIRED_FIELDS", error: "Required record fields are missing.", fields: missing });
    const requiredAttachments = parseJson(access.record.template?.requiredAttachmentsJson, []);
    if (Array.isArray(requiredAttachments) && requiredAttachments.length) {
      const roles = new Set((access.record.attachments || []).map((row: any) => row.role));
      const missingAttachments = requiredAttachments.filter((role: any) => !roles.has(String(role)));
      if (missingAttachments.length) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_REQUIRED_ATTACHMENTS", error: "Required record attachments are missing.", roles: missingAttachments });
    }
    const row = await prisma.personnelRecord.update({ where: { id: recordId }, data: { status: "finalized", finalizedAt: access.record.finalizedAt || new Date(), lastModifiedById: access.user.id, revision: { increment: 1 } }, include });
    return { ok: true, record: serializeRecord(row, { includeFields: true }) };
  });

  app.post("/api/admin/personnel-records/:recordId/attachments", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "edit"); if (!access || !access.canAdmin) return;
    const body = z.object({ libraryItemId: idSchema, role: z.string().trim().min(1).max(100).default("evidence") }).parse(request.body || {});
    const item = await prisma.libraryItem.findUnique({ where: { id: body.libraryItemId } });
    if (!item || item.lifecycleState === "destroyed" || item.status === "trashed") return reply.code(404).send({ ok: false, code: "LIBRARY_ITEM_NOT_FOUND", error: "Library attachment not found." });
    await protectAttachment(item, access.record.classification);
    const attachment = await prisma.personnelRecordAttachment.upsert({ where: { recordId_libraryItemId: { recordId, libraryItemId: item.id } }, update: { role: body.role }, create: { recordId, libraryItemId: item.id, role: body.role, addedById: access.user.id }, include: { libraryItem: true, addedBy: true } });
    return { ok: true, attachment: { id: attachment.id, role: attachment.role, libraryItemId: attachment.libraryItemId, item: attachment.libraryItem, fileUrl: `/api/personnel-records/${recordId}/attachments/${attachment.id}/file` } };
  });

  app.delete("/api/admin/personnel-records/:recordId/attachments/:attachmentId", async (request: any, reply: any) => {
    const { recordId, attachmentId } = z.object({ recordId: idSchema, attachmentId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "edit"); if (!access || !access.canAdmin) return;
    const attachment = await prisma.personnelRecordAttachment.findFirst({ where: { id: attachmentId, recordId } });
    if (!attachment) return reply.code(404).send({ ok: false, code: "PERSONNEL_RECORD_ATTACHMENT_NOT_FOUND", error: "Record attachment not found." });
    await prisma.personnelRecordAttachment.delete({ where: { id: attachment.id } });
    await restoreAttachmentIfUnowned(attachment.libraryItemId);
    return { ok: true };
  });

  app.get("/api/personnel-records/:recordId/attachments/:attachmentId/file", async (request: any, reply: any) => {
    const { recordId, attachmentId } = z.object({ recordId: idSchema, attachmentId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "view"); if (!access) return;
    const attachment = (access.record.attachments || []).find((row: any) => row.id === attachmentId);
    if (!attachment?.libraryItem?.fileName) return reply.code(404).send({ ok: false, code: "PERSONNEL_RECORD_ATTACHMENT_FILE_NOT_FOUND", error: "Attachment file not found." });
    const candidate = path.resolve(dataLayout.libraryFilesRoot, attachment.libraryItem.fileName);
    if (!inside(dataLayout.libraryFilesRoot, candidate)) return reply.code(400).send({ ok: false, code: "PERSONNEL_RECORD_ATTACHMENT_PATH_INVALID", error: "Attachment path is invalid." });
    try { const stat = await fs.stat(candidate); if (!stat.isFile()) throw new Error("not file"); } catch { return reply.code(404).send({ ok: false, code: "PERSONNEL_RECORD_ATTACHMENT_FILE_NOT_FOUND", error: "Attachment file not found." }); }
    for (const [key, value] of Object.entries(untrustedFileResponseHeaders(attachment.libraryItem.mimeType || "application/octet-stream", attachment.libraryItem.originalName || attachment.libraryItem.title))) reply.header(key, value as string);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(createReadStream(candidate));
  });

  app.post("/api/personnel-records/:recordId/actions/:actionId/complete", async (request: any, reply: any) => {
    const { recordId, actionId } = z.object({ recordId: idSchema, actionId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "view"); if (!access) return;
    const action = (access.record.actions || []).find((row: any) => row.id === actionId);
    if (!action || (action.userId !== access.user.id && !access.canAdmin)) return reply.code(403).send({ ok: false, code: "PERSONNEL_RECORD_ACTION_ACCESS_DENIED", error: "This record action is not assigned to you." });
    const body = z.object({ evidence: z.record(z.any()).default({}) }).parse(request.body || {});
    const updated = await prisma.personnelRecordAction.update({ where: { id: actionId }, data: { status: "completed", completedAt: new Date(), evidenceJson: stringify(body.evidence) } });
    return { ok: true, action: { ...updated, evidence: body.evidence } };
  });

  app.get("/api/admin/personnel-records/:recordId/destruction-preview", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "destroy"); if (!access || !access.canAdmin) return;
    const now = Date.now();
    const blockers = [
      ...(access.record.legalHold ? [{ code: "LEGAL_HOLD", message: "Record is under legal/administrative hold." }] : []),
      ...(access.record.retentionUntil && access.record.retentionUntil.getTime() > now ? [{ code: "RETENTION_ACTIVE", message: `Retention remains active until ${access.record.retentionUntil.toISOString()}.` }] : []),
      ...(access.record.destroyedAt ? [{ code: "ALREADY_DESTROYED", message: "Record is already destroyed." }] : []),
    ];
    return { ok: true, eligible: blockers.length === 0, blockers, impact: { attachments: access.record.attachments.length, amendments: access.record.amendments.length, actions: access.record.actions.length, accessEventsPreserved: access.record.accessEvents.length + 1 } };
  });

  app.post("/api/admin/personnel-records/:recordId/destroy", async (request: any, reply: any) => {
    const { recordId } = z.object({ recordId: idSchema }).parse(request.params);
    const access = await recordAccess(request, reply, recordId, "destroy"); if (!access || !access.canAdmin) return;
    const body = z.object({ reason: z.string().trim().min(10).max(2000), expectedRevision: z.coerce.number().int().min(1) }).parse(request.body || {});
    if (body.expectedRevision !== access.record.revision) return reply.code(409).send({ ok: false, code: "REVISION_CONFLICT", error: "Personnel record changed since destruction was previewed." });
    if (access.record.legalHold) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_LEGAL_HOLD", error: "Record cannot be destroyed while legal hold is active." });
    if (access.record.retentionUntil && access.record.retentionUntil.getTime() > Date.now()) return reply.code(409).send({ ok: false, code: "PERSONNEL_RECORD_RETENTION_ACTIVE", error: "Record cannot be destroyed before retention expires." });
    const attachmentIds = access.record.attachments.map((row: any) => row.libraryItemId);
    const tombstone = await prisma.$transaction(async (tx: any) => {
      const current = await tx.personnelRecord.findUnique({ where: { id: recordId } });
      if (!current || current.revision !== body.expectedRevision || current.legalHold || (current.retentionUntil && current.retentionUntil.getTime() > Date.now())) throw Object.assign(new Error("Personnel record destruction preconditions changed."), { code: "PERSONNEL_RECORD_DESTRUCTION_CHANGED" });
      await tx.personnelRecordAttachment.deleteMany({ where: { recordId } });
      await tx.personnelRecordAction.deleteMany({ where: { recordId } });
      await tx.personnelRecordAmendment.deleteMany({ where: { recordId } });
      await tx.personnelRecordAccessEvent.create({ data: { recordId, actorUserId: access.user.id, action: "destroy", reason: body.reason, allowed: true, metadata: stringify({ attachmentsRemoved: attachmentIds.length }) } });
      return tx.personnelRecord.update({ where: { id: recordId }, data: { status: "destroyed", fieldsJson: "{}", destroyedAt: new Date(), destroyedById: access.user.id, destructionReason: body.reason, lastModifiedById: access.user.id, revision: { increment: 1 } }, include });
    });
    for (const libraryItemId of attachmentIds) await restoreAttachmentIfUnowned(libraryItemId);
    await logSecurityEvent?.({ eventType: "personnel_record_destroyed", severity: "warning", actorUserId: access.user.id, targetUserId: access.record.subjectUserId, detail: { recordId, reason: body.reason } }).catch(() => undefined);
    return { ok: true, record: serializeRecord(tombstone, { includeFields: true, includeHistory: true }) };
  });
}
