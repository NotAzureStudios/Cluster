import { z } from "zod";
import { buildPacketReleaseManifest, buildPacketTextDerivatives, packetRecipientCatalog, publishedPacketAudience, verifyPacketDerivative } from "./packet-publication.js";
import { buildPacketDerivativeBundle } from "./packet-bundle.js";
import { buildPacketNotePdfDerivatives, renderPacketTextPdfDerivatives } from "./packet-pdf-derivative.js";
import { buildPacketFileTextDerivatives } from "./packet-file-text-derivative.js";
import { buildPacketFileImageDerivatives } from "./packet-file-image-derivative.js";
import { buildPacketFilePdfDerivatives } from "./packet-file-pdf-derivative.js";
import { buildPacketFileAudioDerivatives } from "./packet-file-audio-derivative.js";
import { packetCompletionInputSchema, packetDefinitionInputSchema, packetDefinitionPatchSchema, studioAudienceSchema } from "@cluster/shared";
import { studioAudienceMatchesUser, loadStudioAudienceUserContext, studioAudienceMatchesContext } from "../access/studio-audience.js";
import { packetCompletionState, reconcileStudioKnowledgeAssignments } from "../studio-systems/studio-knowledge-runtime.js";
import { commitPacketDeliveryIssuance } from "./packet-delivery-issuance.js";
import { ensureStudioKnowledgePersonnelRecord } from "../studio-systems/studio-knowledge-evidence.js";

/**
 * Release-scoped, server-authorized Packet requirement outcome projections.
 * Only a route that has authorized Packet edit access may call these helpers.
 * These are READ-ONLY reports. They neither assert review nor enqueue reminders.
 * Every count is computed across the whole release, not the loaded UI page.
 */
export const PACKET_REQUIREMENT_STATUSES = ["all", "awaiting", "overdue", "due_soon", "acknowledged", "no_deadline", "integrity_issue"] as const;
export type PacketRequirementStatus = typeof PACKET_REQUIREMENT_STATUSES[number];

export function requirementReportClock(now: Date = new Date()): { asOf: Date; dueSoonBefore: Date } {
  if (!Number.isFinite(now.getTime())) throw new Error("PACKET_REQUIREMENT_CLOCK_INVALID");
  return { asOf: now, dueSoonBefore: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

function safeCount(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("PACKET_REQUIREMENT_COUNT_UNSAFE");
  return n;
}

export async function summarizePacketReleaseRequirements(db: any, releaseId: string, manifestSha256: string, now: Date = new Date()) {
  const { asOf, dueSoonBefore } = requirementReportClock(now);
  // Exact manifest comparisons matter: unrelated release acceptance must never
  // satisfy an assignment, including if historical database rows are corrupt.
  const rows = await db.$queryRaw`
    SELECT COUNT(*) AS "total",
      COUNT(*) FILTER (WHERE r."manifestSha256" <> ${manifestSha256}) AS "integrityIssues",
      COUNT(*) FILTER (WHERE r."manifestSha256" = ${manifestSha256} AND a."id" IS NOT NULL) AS "acknowledged",
      COUNT(*) FILTER (WHERE r."manifestSha256" = ${manifestSha256} AND a."id" IS NULL) AS "awaiting",
      COUNT(*) FILTER (WHERE r."manifestSha256" = ${manifestSha256} AND a."id" IS NULL AND r."dueAt" < ${asOf}) AS "overdue",
      COUNT(*) FILTER (WHERE r."manifestSha256" = ${manifestSha256} AND a."id" IS NULL AND r."dueAt" >= ${asOf} AND r."dueAt" < ${dueSoonBefore}) AS "dueSoon",
      COUNT(*) FILTER (WHERE r."manifestSha256" = ${manifestSha256} AND a."id" IS NULL AND r."dueAt" IS NULL) AS "noDeadline"
    FROM "PacketReleaseRequirement" r
    LEFT JOIN "PacketReleaseAcknowledgment" a ON a."releaseId" = r."releaseId"
      AND a."recipientId" = r."recipientId" AND a."manifestSha256" = r."manifestSha256"
    WHERE r."releaseId" = ${releaseId}`;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("PACKET_REQUIREMENT_REPORT_INCOMPLETE");
  const row = rows[0];
  const summary = { total: safeCount(row.total), integrityIssues: safeCount(row.integrityIssues),
    acknowledged: safeCount(row.acknowledged), awaiting: safeCount(row.awaiting),
    overdue: safeCount(row.overdue), dueSoon: safeCount(row.dueSoon), noDeadline: safeCount(row.noDeadline) };
  if (summary.total !== summary.integrityIssues + summary.acknowledged + summary.awaiting ||
    summary.overdue + summary.dueSoon + summary.noDeadline > summary.awaiting)
    throw new Error("PACKET_REQUIREMENT_REPORT_INCONSISTENT");
  return { ...summary, asOf: asOf.toISOString(), evidenceType: "explicit_release_acknowledgment_not_download_or_read_proof" as const };
}

export async function pagePacketReleaseRequirements(db: any, args: {
  releaseId: string; manifestSha256: string; status: PacketRequirementStatus;
  asOf: Date; cursor: { id: string; assignedAt: Date } | null; limit: number;
}) {
  const { asOf, dueSoonBefore } = requirementReportClock(args.asOf);
  const cursorAt = args.cursor?.assignedAt ?? null;
  const cursorId = args.cursor?.id ?? "";
  // Parameters are bound by Prisma's tagged template implementation, never
  // interpolated into SQL text. Status is separately validated by the route.
  const rows = await db.$queryRaw`
    WITH matching AS (
      SELECT r."id", r."releaseId", r."recipientId", r."assignedAt", r."dueAt", r."manifestSha256",
        a."acknowledgedAt"
      FROM "PacketReleaseRequirement" r
      LEFT JOIN "PacketReleaseAcknowledgment" a ON a."releaseId" = r."releaseId"
        AND a."recipientId" = r."recipientId" AND a."manifestSha256" = r."manifestSha256"
      WHERE r."releaseId" = ${args.releaseId}
      AND (${cursorAt}::timestamp IS NULL OR r."assignedAt" < ${cursorAt}::timestamp OR
        (r."assignedAt" = ${cursorAt}::timestamp AND r."id" < ${cursorId}))
      AND (
        ${args.status} = 'all'
        OR (${args.status} = 'integrity_issue' AND r."manifestSha256" <> ${args.manifestSha256})
        OR (${args.status} = 'acknowledged' AND r."manifestSha256" = ${args.manifestSha256} AND a."id" IS NOT NULL)
        OR (${args.status} = 'awaiting' AND r."manifestSha256" = ${args.manifestSha256} AND a."id" IS NULL)
        OR (${args.status} = 'overdue' AND r."manifestSha256" = ${args.manifestSha256} AND a."id" IS NULL AND r."dueAt" < ${asOf})
        OR (${args.status} = 'due_soon' AND r."manifestSha256" = ${args.manifestSha256} AND a."id" IS NULL AND r."dueAt" >= ${asOf} AND r."dueAt" < ${dueSoonBefore})
        OR (${args.status} = 'no_deadline' AND r."manifestSha256" = ${args.manifestSha256} AND a."id" IS NULL AND r."dueAt" IS NULL)
      )
      ORDER BY r."assignedAt" DESC, r."id" DESC LIMIT ${args.limit + 1}
    )
    SELECT m."id", m."recipientId", m."assignedAt", m."dueAt", m."manifestSha256",
      m."acknowledgedAt", reminders."lastRemindedAt"
    FROM matching m
    LEFT JOIN LATERAL (
      SELECT MAX(d."sentAt") AS "lastRemindedAt" FROM "PacketReleaseReminderDelivery" d
      WHERE d."requirementId" = m."id" AND d."releaseId" = m."releaseId"
    ) reminders ON TRUE
    ORDER BY m."assignedAt" DESC, m."id" DESC`;
  if (!Array.isArray(rows) || rows.length > args.limit + 1) throw new Error("PACKET_REQUIREMENT_REPORT_INCOMPLETE");
  return { page: rows.slice(0, args.limit), nextCursor: rows.length > args.limit ? rows[args.limit - 1]?.id : null };
}

function serializePacketDefinition(definition: any) {
  if (!definition) return { kind: "knowledge", versionLabel: "1.0", audience: { mode: "all", targets: [] }, completionMode: "none", completionFormId: null, required: false, dueDays: null, recertifyDays: null, recordCompletion: false };
  let audience: any = { mode: "all", targets: [] };
  try { audience = studioAudienceSchema.parse(JSON.parse(String(definition.audienceJson || "{}"))); } catch {}
  return { id: definition.id, kind: definition.kind, versionLabel: definition.versionLabel, audience, completionMode: definition.completionMode, completionFormId: definition.completionFormId, required: Boolean(definition.required), dueDays: definition.dueDays ?? null, recertifyDays: definition.recertifyDays ?? null, recordCompletion: Boolean(definition.recordCompletion), updatedAt: definition.updatedAt };
}

export function registerPacketRoutes(deps: any) {
  const {
    app,
    prisma,
    libraryFilesRoot,
    readSettings,
    accessContext,
    hasToolPermission,
    visibleFor,
    ensurePacketsRoot,
    serializeLibraryItem,
    itemInclude,
    clearLibraryContextCache,
    logActivity,
    notificationService,
  } = deps;

  async function requirePacketsAccess(request: any, reply: any, minimum = "view") {
    const settings = await readSettings();
    if (settings.packetsEnabled === false) {
      reply.code(503).send({ ok: false, code: "TOOL_DISABLED", error: "Packets is disabled." });
      return null;
    }
    const context = await accessContext(request);
    if (!context.user) {
      reply.code(401).send({ ok: false, error: "Login required." });
      return null;
    }
    if (!context.decorated?.isAdmin && !hasToolPermission(context.user, context.decorated?.workspaceRole, "packets", minimum)) {
      reply.code(403).send({ ok: false, error: `Packets ${minimum} access required.` });
      return null;
    }
    return context;
  }

  async function listPacketPublicationSources(db: any, packetId: string, context: any) {
    const all: any[] = [];
    let frontier = [packetId];
    const visited = new Set<string>([packetId]);
    while (frontier.length) {
      const rows = await db.libraryItem.findMany({
        where: { parentId: { in: frontier }, status: { notIn: ["archived", "trashed"] } },
        include: { project: { include: { memberships: { where: { status: "active" } } } } },
        orderBy: { id: "asc" }, take: 2001,
      });
      if (rows.length > 2000 || all.length + rows.length > 2000) throw new Error("PACKET_TOO_LARGE");
      if (rows.some((row: any) => !visibleFor(context, row, "edit"))) throw new Error("PACKET_SOURCE_ACCESS_REQUIRED");
      // Personnel Records have an independent authorization/distribution
      // policy. Merely nesting a referenced attachment inside a Packet must
      // never turn it into a publicly deliverable derivative.
      if (rows.length) {
        const protectedFiles = await db.personnelRecordAttachment.findFirst({
          where: { libraryItemId: { in: rows.map((row: any) => row.id) } }, select: { id: true },
        });
        if (protectedFiles) throw new Error("PACKET_SOURCE_POLICY_BLOCKED");
      }
      all.push(...rows);
      const folders = rows.filter((row: any) => row.type === "folder").map((row: any) => String(row.id));
      // Bad imported folder cycles must fail rather than publish a partial tree.
      if (folders.some((id: string) => visited.has(id))) throw new Error("PACKET_FOLDER_CYCLE");
      frontier = folders;
      frontier.forEach((id: string) => visited.add(id));
    }
    return all;
  }

  app.get("/api/packets", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply);
    if (!context) return;
    const root = await ensurePacketsRoot();
    const packetCandidates = await prisma.libraryItem.findMany({
      where: { parentId: root.id, type: "folder", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
      orderBy: [{ pinned: "desc" }, { title: "asc" }]
    });
    // One strict People authority snapshot per recipient read, not one set of
    // Employment/Team/Project queries for every Packet in the catalogue.
    const audienceContext = !context.decorated?.isAdmin && packetCandidates.some((item: any) => visibleFor(context, item))
      ? await loadStudioAudienceUserContext(prisma, context.user, { strict: true }) : null;
    const packets: any[] = [];
    for (const item of packetCandidates) {
      if (!visibleFor(context, item)) continue;
      try {
        if (context.decorated?.isAdmin || (audienceContext && studioAudienceMatchesContext(item.packetDefinition?.audienceJson, context.user.id, audienceContext))) packets.push(item);
      } catch {
        // A damaged Packet audience is not a Studio-wide entitlement, and one
        // corrupt definition must not take down the entire catalogue.
      }
    }
    const packetIds = packets.map((item: any) => item.id);
    const definitionIds = packets.flatMap((item: any) => item.packetDefinition?.id ? [String(item.packetDefinition.id)] : []);
    const completions = definitionIds.length ? await prisma.packetCompletion.findMany({
      where: { userId: context.user.id, packetDefinitionId: { in: definitionIds } },
      select: { id: true, packetDefinitionId: true, mode: true, formSubmissionId: true, packetVersionLabel: true, validUntil: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }) : [];
    const completionsByDefinition = new Map<string, any[]>();
    for (const entry of completions) { const rows = completionsByDefinition.get(String(entry.packetDefinitionId)) || []; rows.push(entry); completionsByDefinition.set(String(entry.packetDefinitionId), rows); }
    const completionFormIds = [...new Set(packets.flatMap((item: any) => item.packetDefinition?.completionFormId ? [String(item.packetDefinition.completionFormId)] : []))];
    const completionForms = completionFormIds.length ? await prisma.studioForm.findMany({ where: { id: { in: completionFormIds }, status: "active" }, select: { id: true, key: true, title: true } }) : [];
    const completionFormById = new Map(completionForms.map((form: any) => [String(form.id), form]));
    const priorFormSubmissions = completionFormIds.length ? await prisma.studioFormSubmission.findMany({ where: { userId: context.user.id, formId: { in: completionFormIds }, status: { in: ["submitted", "approved"] } }, orderBy: { submittedAt: "desc" }, select: { id: true, formId: true } }) : [];
    const submissionByFormId = new Map<string, any>();
    for (const submission of priorFormSubmissions) if (!submissionByFormId.has(String(submission.formId))) submissionByFormId.set(String(submission.formId), submission);
    // Packet content counts belong to author tooling. Recipients see the
    // detached published delivery catalogue instead, so don't read thousands
    // of source Library children merely to discard their counts.
    const authorPacketIds = packets.filter((item: any) =>
      (context.decorated?.isAdmin || hasToolPermission(context.user, context.decorated?.workspaceRole, "packets", "edit"))
      && visibleFor(context, item, "edit")).map((item: any) => item.id);
    const childCandidates = authorPacketIds.length ? await prisma.libraryItem.findMany({
      where: { parentId: { in: authorPacketIds }, status: { not: "archived" } },
      include: { project: { include: { memberships: { where: { status: "active" } } } } },
      orderBy: { updatedAt: "desc" },
      take: 5000
    }) : [];
    const visibleChildren = childCandidates.filter((item: any) => visibleFor(context, item));
    const stats = new Map<string, { total: number; pdfs: number; videos: number; links: number; files: number; updatedAt: Date | null }>();
    for (const item of visibleChildren) {
      const key = item.parentId as string;
      const current = stats.get(key) || { total: 0, pdfs: 0, videos: 0, links: 0, files: 0, updatedAt: null };
      current.total += 1;
      const extension = String(item.extension || "").toLowerCase();
      if (item.mimeType === "application/pdf" || extension === "pdf") current.pdfs += 1;
      else if (item.type === "youtube-video" || item.type === "youtube-playlist") current.videos += 1;
      else if (item.type === "link") current.links += 1;
      else if (item.fileName) current.files += 1;
      if (!current.updatedAt || new Date(item.updatedAt).getTime() > current.updatedAt.getTime()) current.updatedAt = new Date(item.updatedAt);
      stats.set(key, current);
    }
    return {
      root: serializeLibraryItem(root, true),
      packets: packets.map((item: any) => ({
        ...serializeLibraryItem(item, true),
        packetDefinition: serializePacketDefinition(item.packetDefinition),
        // Audience membership authorizes detached Packet delivery only. Source
        // browsing and publishing additionally require Packet edit + Library edit.
        canAuthor: Boolean((context.decorated?.isAdmin || hasToolPermission(context.user, context.decorated?.workspaceRole, "packets", "edit")) && visibleFor(context, item, "edit")),
        completion: item.packetDefinition?.id ? packetCompletionState(item.packetDefinition, completionsByDefinition.get(String(item.packetDefinition.id)) || []).completion || null : null,
        completionState: item.packetDefinition?.id ? packetCompletionState(item.packetDefinition, completionsByDefinition.get(String(item.packetDefinition.id)) || []).state : "pending",
        completionForm: item.packetDefinition?.completionFormId ? completionFormById.get(String(item.packetDefinition.completionFormId)) || null : null,
        completionFormSubmissionId: item.packetDefinition?.completionFormId ? submissionByFormId.get(String(item.packetDefinition.completionFormId))?.id || null : null,
        packetStats: ((context.decorated?.isAdmin || hasToolPermission(context.user, context.decorated?.workspaceRole, "packets", "edit")) && visibleFor(context, item, "edit"))
          ? stats.get(item.id) || { total: 0, pdfs: 0, videos: 0, links: 0, files: 0, updatedAt: null }
          : { total: 0, pdfs: 0, videos: 0, links: 0, files: 0, updatedAt: null }
      }))
    };
  });

  app.get("/api/packets/completion-forms", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const forms = await prisma.studioForm.findMany({ where: { status: "active" }, include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { title: "asc" }, take: 500 });
    return { forms: forms.filter((form: any) => form.versions?.[0]).map((form: any) => ({ id: form.id, key: form.key, title: form.title, purpose: form.purpose, audience: studioAudienceSchema.parse(JSON.parse(String(form.audienceJson || "{}"))), version: form.versions[0].version })) };
  });

  app.post("/api/packets", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const body = packetDefinitionInputSchema.parse(request.body || {});
    if (body.completionMode === "form" && !body.completionFormId) return reply.code(400).send({ ok: false, code: "PACKET_FORM_REQUIRED", error: "Form completion requires a reusable form." });
    if (body.completionMode === "form" && body.completionFormId) {
      const form = await prisma.studioForm.findFirst({ where: { id: body.completionFormId, status: "active" }, select: { id: true } });
      if (!form) return reply.code(400).send({ ok: false, code: "PACKET_FORM_INVALID", error: "Choose an active reusable form." });
    }
    const root = await ensurePacketsRoot();
    const existing = await prisma.libraryItem.findFirst({ where: { parentId: root.id, type: "folder", status: { not: "archived" }, title: body.title } });
    if (existing) return reply.code(409).send({ ok: false, error: "A packet with that name already exists." });
    const item = await prisma.$transaction(async (tx: any) => {
      const folder = await tx.libraryItem.create({
        data: {
          parentId: root.id,
          ownerId: context.user.id,
          title: body.title,
          body: body.description || null,
          type: "folder",
          status: "active",
          priority: "medium",
          tags: JSON.stringify(["packet", body.kind]),
          visibility: "internal",
          versionLabel: body.versionLabel,
          metadata: JSON.stringify({ packet: true, folderColor: "#7aa8ff", folderIcon: "note" }),
          source: "packet"
        },
        include: itemInclude
      });
      const definition = await tx.packetDefinition.create({ data: { libraryFolderId: folder.id, kind: body.kind, versionLabel: body.versionLabel, audienceJson: JSON.stringify(body.audience), completionMode: body.completionMode, completionFormId: body.completionMode === "form" ? body.completionFormId || null : null, required: body.required, dueDays: body.dueDays ?? null, recertifyDays: body.recertifyDays ?? null, recordCompletion: body.recordCompletion } });
      return { ...folder, packetDefinition: definition };
    });
    clearLibraryContextCache();
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity, resourceKind: "packet", resourceId: item.id });
    await logActivity({ userId: context.user.id, type: "created", entityType: "packet", entityId: item.id, title: "Packet created", message: item.title });
    return { ...serializeLibraryItem(item, true), packetDefinition: serializePacketDefinition(item.packetDefinition), completion: null, packetStats: { total: 0, pdfs: 0, videos: 0, links: 0, files: 0, updatedAt: null } };
  });

  app.patch("/api/packets/:packetId/definition", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const body = packetDefinitionPatchSchema.parse(request.body || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { packetDefinition: true } });
    if (!packet) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND", error: "Packet not found." });
    const current = packet.packetDefinition || { kind: "knowledge", versionLabel: packet.versionLabel || "1.0", audienceJson: JSON.stringify({ mode: "all", targets: [] }), completionMode: "none", completionFormId: null, required: false, dueDays: null, recertifyDays: null, recordCompletion: false };
    // Released version labels are immutable. Editors must advance the label before editing a published snapshot.
    if (packet.packetDefinition) {
      const reserved = await prisma.packetRelease.findFirst({ where: { packetDefinitionId: current.id, versionLabel: body.versionLabel ?? current.versionLabel }, select: { id: true } });
      if (reserved) return reply.code(409).send({ ok: false, code: "PACKET_VERSION_PUBLISHED", error: "Create a new version label before changing a published Packet." });
    }
    const nextCompletionMode = body.completionMode ?? current.completionMode;
    let nextCompletionFormId = body.completionFormId === undefined ? current.completionFormId : body.completionFormId;
    if (nextCompletionMode !== "form") nextCompletionFormId = null;
    if (nextCompletionMode === "form" && !nextCompletionFormId) return reply.code(400).send({ ok: false, code: "PACKET_FORM_REQUIRED", error: "Form completion requires a reusable form." });
    if (nextCompletionFormId) {
      const form = await prisma.studioForm.findFirst({ where: { id: nextCompletionFormId, status: "active" }, select: { id: true } });
      if (!form) return reply.code(400).send({ ok: false, code: "PACKET_FORM_INVALID", error: "Choose an active reusable form." });
    }
    const nextAudience = body.audience ? JSON.stringify(body.audience) : current.audienceJson;
    const definition = await prisma.$transaction(async (tx: any) => {
      const saved = await tx.packetDefinition.upsert({
        where: { libraryFolderId: packet.id },
        update: { kind: body.kind ?? current.kind, versionLabel: body.versionLabel ?? current.versionLabel, audienceJson: nextAudience, completionMode: nextCompletionMode, completionFormId: nextCompletionFormId, required: body.required ?? current.required, dueDays: body.dueDays === undefined ? current.dueDays : body.dueDays, recertifyDays: body.recertifyDays === undefined ? current.recertifyDays : body.recertifyDays, recordCompletion: body.recordCompletion ?? current.recordCompletion },
        create: { libraryFolderId: packet.id, kind: body.kind ?? current.kind, versionLabel: body.versionLabel ?? current.versionLabel, audienceJson: nextAudience, completionMode: nextCompletionMode, completionFormId: nextCompletionFormId, required: body.required ?? current.required, dueDays: body.dueDays === undefined ? current.dueDays : body.dueDays, recertifyDays: body.recertifyDays === undefined ? current.recertifyDays : body.recertifyDays, recordCompletion: body.recordCompletion ?? current.recordCompletion },
      });
      await tx.libraryItem.update({ where: { id: packet.id }, data: { ...(body.title ? { title: body.title } : {}), ...(body.description !== undefined ? { body: body.description || null } : {}), ...(body.versionLabel ? { versionLabel: body.versionLabel } : {}), ...(body.kind ? { tags: JSON.stringify(["packet", body.kind]) } : {}) } });
      return saved;
    });
    clearLibraryContextCache();
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity, resourceKind: "packet", resourceId: packet.id });
    await logActivity({ userId: context.user.id, type: "updated", entityType: "packet", entityId: packet.id, title: "Packet updated", message: body.title || packet.title });
    return { ok: true, packetDefinition: serializePacketDefinition(definition) };
  });

  // This preview is advisory; publication reruns the same rules transactionally.
  // It is intentionally author-only and never returned to Packet recipients.
  app.get("/api/packets/:packetId/releases/preview", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    try {
      const all = await listPacketPublicationSources(prisma, packet.id, context);
      const snapshot = buildPacketReleaseManifest(packet, packet.packetDefinition, all);
      const notes = buildPacketTextDerivatives(snapshot.manifestJson, all);
      const files = await buildPacketFileTextDerivatives(snapshot.manifestJson, all, libraryFilesRoot, notes);
      const images = await buildPacketFileImageDerivatives(snapshot.manifestJson, all, libraryFilesRoot, [...notes, ...files]);
      const audio = await buildPacketFileAudioDerivatives(snapshot.manifestJson, all, libraryFilesRoot, [...notes, ...files, ...images]);
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, preview: { versionLabel: packet.packetDefinition.versionLabel, sourceCount: all.length,
        eligibleNotes: notes.length, noteBytes: notes.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        eligibleTextFiles: files.length, textFileBytes: files.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        eligibleImages: images.length, imageBytes: images.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        eligibleAudioPreviews: audio.length, audioPreviewBytes: audio.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        candidateSourcePdfs: all.filter((item: any) => item.fileName && item.extension?.toLowerCase() === "pdf" && item.mimeType?.toLowerCase() === "application/pdf" && ["public", "internal"].includes(String(item.classification || "internal")) && Number(item.sizeBytes) >= 20 && Number(item.sizeBytes) <= 1_048_576).length,
        pendingDerivatives: all.length - notes.length - files.length - images.length - audio.length, snapshotSha256: snapshot.manifestSha256 } };
    } catch (error: any) {
      const code = String(error?.message || "");
      if (["PACKET_TOO_LARGE", "PACKET_SOURCE_ACCESS_REQUIRED", "PACKET_SOURCE_POLICY_BLOCKED", "PACKET_SOURCE_UNVERIFIED", "PACKET_SOURCE_INACTIVE", "PACKET_DERIVATIVES_TOO_LARGE", "PACKET_FILE_ROOT_UNSAFE", "PACKET_FILE_PATH_UNSAFE", "PACKET_FILE_SOURCE_CHANGED", "PACKET_FILE_TEXT_INVALID", "PACKET_IMAGE_LIMIT", "PACKET_IMAGE_INVALID", "PACKET_IMAGE_OUTPUT_INVALID", "PACKET_IMAGE_WATERMARK_TOO_SMALL", "PACKET_IMAGE_WATERMARK_INVALID", "PACKET_AUDIO_INVALID", "PACKET_AUDIO_UNSUPPORTED", "PACKET_AUDIO_LIMIT", "PACKET_FOLDER_CYCLE", "PACKET_PDF_WATERMARK_INVALID", "PACKET_SOURCE_PDF_INVALID", "PACKET_SOURCE_PDF_UNSAFE", "PACKET_SOURCE_PDF_TOO_LARGE", "PACKET_SOURCE_PDF_LIMIT", "PACKET_PDF_CONVERSION_BUSY", "PACKET_FILE_SOURCE_SIZE_INVALID"].includes(code))
        return reply.code(code === "PACKET_SOURCE_ACCESS_REQUIRED" ? 403 : 409).send({ ok: false, code });
      throw error;
    }
  });

  // Publication freezes a source-revision manifest. It does NOT grant recipients direct Library access.
  app.post("/api/packets/:packetId/releases", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const { textDerivatives, pdfDerivatives, imageDerivatives, sourcePdfDerivatives, audioDerivatives, watermarkLabel } = z.object({ textDerivatives: z.boolean().default(false), pdfDerivatives: z.boolean().default(false), imageDerivatives: z.boolean().default(false), sourcePdfDerivatives: z.boolean().default(false), audioDerivatives: z.boolean().default(false), watermarkLabel: z.string().max(60).regex(/^[\x20-\x7e]*$/).transform((value) => value.trim()).default("") }).strict().parse(request.body || {});
    if (watermarkLabel && !pdfDerivatives && !sourcePdfDerivatives && !imageDerivatives) return reply.code(400).send({ ok: false, code: "PACKET_WATERMARK_REQUIRES_VISUAL_DERIVATIVE" });
    if (textDerivatives && pdfDerivatives) return reply.code(400).send({ ok: false, code: "PACKET_DERIVATIVE_FORMAT_CONFLICT" });
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet || !packet.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const definition = packet.packetDefinition;
    let published: { created: any; sourceCount: number; derivativeCount: number };
    try {
      // Decode / sanitize and hash source files BEFORE acquiring a database
      // transaction. It may take real CPU time to inspect untrusted media.
      const preparedSources = await listPacketPublicationSources(prisma, packet.id, context);
      const preparedSnapshot = buildPacketReleaseManifest(packet, definition, preparedSources, watermarkLabel);
      const textOrPdf = pdfDerivatives ? await (async () => {
          const notes = buildPacketTextDerivatives(preparedSnapshot.manifestJson, preparedSources);
          const files = await buildPacketFileTextDerivatives(preparedSnapshot.manifestJson, preparedSources, libraryFilesRoot, notes);
          return renderPacketTextPdfDerivatives([...notes, ...files], watermarkLabel);
        })() : textDerivatives ? await (async () => {
          const notes = buildPacketTextDerivatives(preparedSnapshot.manifestJson, preparedSources).map((item) => ({ ...item, format: "txt" as const }));
          const files = await buildPacketFileTextDerivatives(preparedSnapshot.manifestJson, preparedSources, libraryFilesRoot, notes);
          return [...notes, ...files];
        })() : [];
      const images = imageDerivatives ? await buildPacketFileImageDerivatives(preparedSnapshot.manifestJson, preparedSources, libraryFilesRoot, textOrPdf, watermarkLabel) : [];
      const sourcePdfs = sourcePdfDerivatives ? await buildPacketFilePdfDerivatives(preparedSnapshot.manifestJson, preparedSources, libraryFilesRoot, [...textOrPdf, ...images], watermarkLabel) : [];
      const audio = audioDerivatives ? await buildPacketFileAudioDerivatives(preparedSnapshot.manifestJson, preparedSources, libraryFilesRoot, [...textOrPdf, ...images, ...sourcePdfs]) : [];
      const derivatives = [...textOrPdf, ...images, ...sourcePdfs, ...audio].sort((a, b) => a.position - b.position);
      if (watermarkLabel && !derivatives.some((item) => item.format === "pdf" || item.format === "webp"))
        throw new Error("PACKET_WATERMARK_NO_VISUAL_DERIVATIVES");
      if (derivatives.reduce((total, item) => total + item.sizeBytes, 0) > 1_048_576)
        throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
      // Serializable manifest comparison prevents stale source/title/visibility
      // changes from entering a freshly published release after preflight.
      published = await prisma.$transaction(async (tx: any) => {
        const current = await tx.packetDefinition.findUnique({ where: { id: definition.id } });
        if (!current || current.versionLabel !== definition.versionLabel) throw new Error("PACKET_VERSION_CHANGED");
        const existing = await tx.packetRelease.findFirst({ where: { packetDefinitionId: definition.id, versionLabel: current.versionLabel }, select: { id: true } });
        if (existing) throw new Error("PACKET_RELEASE_EXISTS");
        const packetAtCommit = await tx.libraryItem.findUnique({ where: { id: packet.id }, include: { ...itemInclude, packetDefinition: true } });
        if (!packetAtCommit || packetAtCommit.status === "archived" || packetAtCommit.status === "trashed" ||
          !visibleFor(context, packetAtCommit, "edit")) throw new Error("PACKET_SOURCE_ACCESS_REQUIRED");
        const all = await listPacketPublicationSources(tx, packet.id, context);
        const snapshot = buildPacketReleaseManifest(packetAtCommit, current, all, watermarkLabel);
        if (snapshot.manifestSha256 !== preparedSnapshot.manifestSha256 || snapshot.sourceCount !== preparedSnapshot.sourceCount)
          throw new Error("PACKET_SOURCE_CHANGED");
        const created = await tx.packetRelease.create({ data: { packetDefinitionId: current.id, versionLabel: current.versionLabel, manifestJson: preparedSnapshot.manifestJson, manifestSha256: preparedSnapshot.manifestSha256, publishedById: context.user.id }, select: { id: true, versionLabel: true, manifestSha256: true, publishedAt: true } });
        if (derivatives.length) await tx.packetReleaseDerivative.createMany({
          data: derivatives.map((item) => ({ releaseId: created.id, ...item })),
        });
        // Keep immutable source provenance tied to the canonical Library graph.
        // Published inputs must not be permanently destroyed just because an
        // editor acknowledges ordinary backlinks in a destruction preview.
        if (all.length) await tx.libraryBacklink.createMany({
          data: all.map((item: any) => ({
            itemId: item.id,
            sourceResourceKind: "packet_release",
            sourceResourceId: created.id,
            relationKind: "published_source",
            label: `Packet v${created.versionLabel}`,
          })),
          skipDuplicates: true,
        });
        return { created, sourceCount: snapshot.sourceCount, derivativeCount: derivatives.length };
      }, { isolationLevel: "RepeatableRead" });
    } catch (error: any) {
      const code = error?.code === "P2002" ? "PACKET_RELEASE_EXISTS" : String(error?.message || "");
      if (["PACKET_RELEASE_EXISTS", "PACKET_VERSION_CHANGED", "PACKET_TOO_LARGE", "PACKET_SOURCE_ACCESS_REQUIRED", "PACKET_SOURCE_POLICY_BLOCKED", "PACKET_SOURCE_UNVERIFIED", "PACKET_SOURCE_INACTIVE", "PACKET_DERIVATIVES_TOO_LARGE", "PACKET_FILE_ROOT_UNSAFE", "PACKET_FILE_PATH_UNSAFE", "PACKET_FILE_SOURCE_CHANGED", "PACKET_FILE_TEXT_INVALID", "PACKET_IMAGE_LIMIT", "PACKET_IMAGE_INVALID", "PACKET_IMAGE_OUTPUT_INVALID", "PACKET_IMAGE_WATERMARK_TOO_SMALL", "PACKET_IMAGE_WATERMARK_INVALID", "PACKET_AUDIO_INVALID", "PACKET_AUDIO_UNSUPPORTED", "PACKET_AUDIO_LIMIT", "PACKET_FOLDER_CYCLE", "PACKET_PDF_WATERMARK_INVALID", "PACKET_SOURCE_PDF_INVALID", "PACKET_SOURCE_PDF_UNSAFE", "PACKET_SOURCE_PDF_TOO_LARGE", "PACKET_SOURCE_PDF_LIMIT", "PACKET_PDF_CONVERSION_BUSY", "PACKET_FILE_SOURCE_SIZE_INVALID"].includes(code))
        return reply.code(code === "PACKET_SOURCE_ACCESS_REQUIRED" ? 403 : 409).send({ ok: false, code });
      throw error;
    }
    const { created, sourceCount, derivativeCount } = published;
    await logActivity({ userId: context.user.id, type: "published", entityType: "packet", entityId: packet.id, title: "Packet version published", message: `${packet.title} v${definition.versionLabel}`, metadata: { releaseId: created.id, sourceCount, derivativeCount } });
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, release: { ...created, sourceCount, derivativeCount, distributionPolicy: "derived_only" } });
  });

  app.get("/api/packets/:packetId/releases", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet || !packet.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const releases = await prisma.packetRelease.findMany({ where: { packetDefinitionId: packet.packetDefinition.id }, select: { id: true, versionLabel: true, manifestSha256: true, publishedById: true, publishedAt: true, revokedAt: true, revokedById: true, revocationReason: true }, orderBy: { publishedAt: "desc" }, take: 100 });
    reply.header("Cache-Control", "no-store");
    return { ok: true, releases };
  });

  // Revocation suppresses *all* current and future recipient delivery, but
  // preserves immutable publication evidence and protected Library backlinks.
  // Only administrators may revoke a release, with a reason and exact release
  // fingerprint to avoid withdrawing the wrong version during concurrent work.
  app.post("/api/packets/:packetId/releases/:releaseId/revoke", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    if (!context.decorated?.isAdmin) return reply.code(403).send({ ok: false, code: "ADMIN_REQUIRED" });
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const { confirmation, reason, expectedManifestSha256 } = z.object({
      confirmation: z.literal("REVOKE RELEASE"), reason: z.string().trim().min(10).max(2000),
      expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }).strict().parse(request.body || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (release.revokedAt) return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_REVOKED" });
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    if (release.manifestSha256 !== expectedManifestSha256.toLowerCase())
      return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_CHANGED" });
    // Mutation and authoritative audit evidence must commit together.
    const result = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.packetRelease.updateMany({
        where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id, manifestSha256: expectedManifestSha256.toLowerCase(), revokedAt: null },
        data: { revokedAt: new Date(), revokedById: context.user.id, revocationReason: reason },
      });
      if (!changed.count) return false;
      await tx.activityEvent.create({ data: {
        userId: context.user.id, type: "revoked", entityType: "packet", entityId: packet.id,
        title: "Published Packet release revoked", message: `Packet v${release.versionLabel} withdrawn`,
        metadata: JSON.stringify({ releaseId, manifestSha256: expectedManifestSha256.toLowerCase(), reason }),
      } });
      return true;
    });
    if (!result) return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_CHANGED" });
    reply.header("Cache-Control", "no-store");
    return { ok: true, releaseId, revoked: true };
  });

  // Only Packet managers may inspect who was issued detached release bytes.
  // Audit scope stays bound to one canonical Packet + release and is cursor-bounded.
  // Revocation hides future delivery, not historical issuance evidence.
  app.get("/api/packets/:packetId/releases/:releaseId/delivery-evidence", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const { limit, cursor } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional() }).parse(request.query || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (cursor) {
      const cursorRow = await prisma.packetDeliveryReceipt.findFirst({ where: { id: cursor, releaseId }, select: { id: true } });
      if (!cursorRow) return reply.code(400).send({ ok: false, code: "PACKET_RECEIPT_CURSOR_INVALID" });
    }
    const [rows, total, bundles] = await Promise.all([
      prisma.packetDeliveryReceipt.findMany({
        where: { releaseId }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: limit + 1,
        select: { id: true, recipientId: true, kind: true, position: true, derivativeHash: true, sizeBytes: true, issuedAt: true },
      }),
      prisma.packetDeliveryReceipt.count({ where: { releaseId } }),
      prisma.packetDeliveryReceipt.count({ where: { releaseId, kind: "bundle" } }),
    ]);
    const page = rows.slice(0, limit);
    const personIds = [...new Set(page.map((entry: any) => entry.recipientId))];
    const people = personIds.length ? await prisma.user.findMany({
      where: { id: { in: personIds } }, select: { id: true, username: true, displayName: true }, take: 100,
    }) : [];
    const byId = new Map(people.map((person: any) => [person.id, person]));
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, versionLabel: release.versionLabel, revoked: Boolean(release.revokedAt),
      total, bundleCount: bundles, artifactCount: total - bundles,
      receipts: page.map((entry: any) => ({ ...entry, recipient: byId.get(entry.recipientId) || null })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : null,
      evidenceType: "authorized_issuance_not_confirmed_download",
    };
  });

  // The immutable publication catalogue is the only recipient-facing release
  // projection. It NEVER exposes source IDs, file paths, URLs, or hash lists.
  // Delivery adapters must issue separate, entitlement-checked derivatives.
  app.get("/api/packets/:packetId/deliveries", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const releases = await prisma.packetRelease.findMany({
      where: { packetDefinitionId: packet.packetDefinition.id, revokedAt: null },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 100,
    });
    const available = await prisma.packetReleaseDerivative.findMany({
      where: { releaseId: { in: releases.map((release: any) => release.id) } },
      select: { releaseId: true, position: true, format: true }, take: 200_000,
    });
    const positionsByRelease = new Map<string, Map<number, string>>();
    for (const item of available) { const values = positionsByRelease.get(item.releaseId) || new Map<number, string>(); values.set(item.position, item.format || "txt"); positionsByRelease.set(item.releaseId, values); }
    const requirements = releases.length ? await prisma.packetReleaseRequirement.findMany({
      where: { releaseId: { in: releases.map((row: any) => row.id) }, recipientId: context.user.id },
      select: { releaseId: true, dueAt: true, assignedAt: true, manifestSha256: true }, take: 100,
    }) : [];
    const requiredByRelease = new Map(requirements.map((row: any) => [row.releaseId, row]));
    const acknowledged = releases.length ? await prisma.packetReleaseAcknowledgment.findMany({
      where: { releaseId: { in: releases.map((row: any) => row.id) }, recipientId: context.user.id },
      select: { releaseId: true, manifestSha256: true, acknowledgedAt: true }, take: 100,
    }) : [];
    const acknowledgedByRelease = new Map(acknowledged.map((row: any) => [row.releaseId, row]));
    // Reuse one strict People projection for all frozen versions. An outage
    // must fail closed, not silently remove exclusion memberships.
    const recipientAudienceContext = !context.decorated?.isAdmin && releases.length
      ? await loadStudioAudienceUserContext(prisma, context.user, { strict: true }) : null;
    const permitted: any[] = [];
    for (const release of releases) {
      // A published version freezes its audience. Changing today's Packet
      // definition must not retroactively expose an old private release.
      try {
        // Integrity validation precedes audience parsing. A corrupt record
        // cannot turn a whole recipient catalogue into a 500 response.
        const catalog = packetRecipientCatalog(release, positionsByRelease.get(release.id));
        const frozenAudience = publishedPacketAudience(release);
        if (!frozenAudience) continue;
        if (!context.decorated?.isAdmin && !(recipientAudienceContext &&
          studioAudienceMatchesContext(frozenAudience, context.user.id, recipientAudienceContext))) continue;
        permitted.push({ releaseId: catalog.releaseId, versionLabel: catalog.versionLabel,
          publishedAt: catalog.publishedAt, contentsCount: catalog.contents.length,
          deliveryStatus: catalog.deliveryStatus,
          requiredAcknowledgment: requiredByRelease.get(release.id)?.manifestSha256 === release.manifestSha256
            ? { dueAt: requiredByRelease.get(release.id)?.dueAt || null, assignedAt: requiredByRelease.get(release.id)?.assignedAt,
              acknowledgedAt: acknowledgedByRelease.get(release.id)?.manifestSha256 === release.manifestSha256 ? acknowledgedByRelease.get(release.id)?.acknowledgedAt : null }
            : null });
      } catch {
        // Corrupted and unsupported releases are never projected to recipients.
      }
    }
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releases: permitted };
  });

  app.get("/api/packets/:packetId/deliveries/:releaseId/catalog", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({
      where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id },
    });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, frozenAudience, context.user))))
      return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    try {
      const available = await prisma.packetReleaseDerivative.findMany({ where: { releaseId }, select: { position: true, format: true }, take: 2000 });
      const catalog = packetRecipientCatalog(release, new Map<number, string>(available.map((item: any) => [item.position, item.format || "txt"])));
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, catalog };
    } catch {
      return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID", error: "Published Packet integrity could not be verified." });
    }
  });

  // Authors assign required acknowledgments only to live members of the
  // frozen publication audience. Visibility of a Packet is not sufficient to
  // view its source records or invite arbitrary accounts to an old release.
  app.get("/api/packets/:packetId/releases/:releaseId/requirement-candidates", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const { cursor, query, limit } = z.object({ cursor: z.string().min(1).max(240).optional(),
      query: z.string().trim().max(80).default(""), limit: z.coerce.number().int().min(1).max(100).default(75) }).parse(request.query || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience) return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" });
    // Stable database pagination BEFORE strict frozen-audience evaluation.
    // An ineligible user may consume a page slot, but is never disclosed.
    // Empty eligible pages may legitimately include a nextCursor.
    const search = (query || "").trim();
    const live: any = { archived: false,
      accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] },
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
      ...(search ? { AND: [{ OR: [{ username: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } }] }] } : {}),
    };
    if (cursor && !(await prisma.user.findFirst({ where: { ...live, id: cursor }, select: { id: true } })))
      return reply.code(400).send({ ok: false, code: "PACKET_CANDIDATE_CURSOR_INVALID" });
    const rows = await prisma.user.findMany({ where: live,
      select: { id: true, username: true, displayName: true },
      orderBy: [{ username: "asc" }, { id: "asc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: limit + 1 });
    const page = rows.slice(0, limit);
    const eligible = [];
    for (const candidate of page) {
      if (studioAudienceMatchesContext(frozenAudience, String(candidate.id),
        await loadStudioAudienceUserContext(prisma, candidate, { strict: true }))) eligible.push(candidate);
    }
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, manifestSha256: release.manifestSha256, candidates: eligible,
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : null, inspectedCount: page.length };
  });

  app.post("/api/packets/:packetId/releases/:releaseId/requirements", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i),
      recipientIds: z.array(z.string().min(1).max(240)).min(1).max(100),
      dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    }).strict().safeParse(request.body || {});
    if (!body.success) return reply.code(400).send({ ok: false, code: "PACKET_REQUIREMENTS_INVALID" });
    const ids = [...new Set(body.data.recipientIds)];
    if (ids.length !== body.data.recipientIds.length) return reply.code(400).send({ ok: false, code: "PACKET_REQUIREMENTS_DUPLICATE_RECIPIENT" });
    const dueAt = body.data.dueAt ? new Date(body.data.dueAt) : null;
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (release.manifestSha256.toLowerCase() !== body.data.expectedManifestSha256.toLowerCase())
      return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_CHANGED" });
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience) return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" });
    const recipients = await prisma.user.findMany({ where: { id: { in: ids }, archived: false,
      accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] },
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
    }, select: { id: true } });
    if (recipients.length !== ids.length) return reply.code(409).send({ ok: false, code: "PACKET_RECIPIENT_UNAVAILABLE" });
    for (const recipient of recipients) if (!studioAudienceMatchesContext(frozenAudience, String(recipient.id), await loadStudioAudienceUserContext(prisma, recipient, { strict: true })))
      return reply.code(403).send({ ok: false, code: "PACKET_RECIPIENT_OUTSIDE_RELEASE_AUDIENCE" });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        // This lock serializes assignment with revocation and recipient
        // acknowledgment. Never create requirements on a withdrawn release.
        const locked = (await tx.$queryRaw`SELECT "id", "manifestSha256", "revokedAt" FROM "PacketRelease"
          WHERE "id" = ${releaseId} AND "packetDefinitionId" = ${packet.packetDefinition.id} FOR UPDATE`) as any[];
        if (!locked[0] || locked[0].revokedAt) return { conflict: "PACKET_RELEASE_REVOKED" };
        if (locked[0].manifestSha256.toLowerCase() !== body.data.expectedManifestSha256.toLowerCase()) return { conflict: "PACKET_RELEASE_CHANGED" };
        // The earlier recipient check is advisory only. Entitlements may have
        // changed while this request waited for another release mutation.
        const currentRecipients = await tx.user.findMany({ where: { id: { in: ids }, archived: false,
          accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] },
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
        }, select: { id: true } });
        if (currentRecipients.length !== ids.length) return { conflict: "PACKET_RECIPIENT_UNAVAILABLE" };
        for (const recipient of currentRecipients) if (!studioAudienceMatchesContext(frozenAudience, String(recipient.id),
          await loadStudioAudienceUserContext(tx, recipient, { strict: true })))
          return { conflict: "PACKET_RECIPIENT_OUTSIDE_RELEASE_AUDIENCE" };
        const inserted = await tx.packetReleaseRequirement.createMany({ data: ids.map((recipientId) => ({
          releaseId, recipientId, assignedById: context.user.id, manifestSha256: release.manifestSha256.toLowerCase(), dueAt,
        })), skipDuplicates: true });
        await tx.activityEvent.create({ data: { userId: context.user.id, type: "assigned", entityType: "packet", entityId: packet.id,
          title: "Required published Packet acknowledgment", message: `Required acknowledgments assigned for v${release.versionLabel}`,
          metadata: JSON.stringify({ releaseId, versionLabel: release.versionLabel, manifestSha256: release.manifestSha256, recipientIds: ids, newlyAssigned: inserted.count }),
        } });
        return { created: inserted.count };
      }, { isolationLevel: "Serializable" });
      if (result.conflict) return reply.code(409).send({ ok: false, code: result.conflict });
      reply.header("Cache-Control", "no-store");
      return { ok: true, releaseId, created: result.created, alreadyAssigned: ids.length - result.created };
    } catch (error: any) {
      if (["P2034", "P2002"].includes(String(error?.code || ""))) return reply.code(409).send({ ok: false, code: "PACKET_REQUIREMENT_CONCURRENT" });
      throw error;
    }
  });

  // Intentional, one-recipient reminder: no automated sends or arbitrary user
  // targeting. Lock the release THEN the requirement before reading acceptance
  // and cooldown evidence. Notification and immutable delivery record commit
  // atomically; a racing reviewer cannot send twice during the cooldown.
  app.post("/api/packets/:packetId/releases/:releaseId/requirements/:requirementId/remind", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId, requirementId } = z.object({ packetId: z.string().min(1),
      releaseId: z.string().min(1), requirementId: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict().safeParse(request.body || {});
    if (!body.success) return reply.code(400).send({ ok: false, code: "PACKET_REMINDER_INVALID" });
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id,
      type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const lockedRelease = (await tx.$queryRaw`SELECT "id", "manifestSha256", "revokedAt" FROM "PacketRelease"
          WHERE "id" = ${releaseId} AND "packetDefinitionId" = ${packet.packetDefinition.id} FOR UPDATE`) as any[];
        const release = lockedRelease[0];
        if (!release || release.revokedAt) return { conflict: "PACKET_RELEASE_REVOKED" };
        if (String(release.manifestSha256).toLowerCase() !== body.data.expectedManifestSha256.toLowerCase())
          return { conflict: "PACKET_RELEASE_CHANGED" };
        const requirementRows = (await tx.$queryRaw`SELECT "id", "recipientId", "manifestSha256", "dueAt" FROM "PacketReleaseRequirement"
          WHERE "id" = ${requirementId} AND "releaseId" = ${releaseId} FOR UPDATE`) as any[];
        const requirement = requirementRows[0];
        if (!requirement || String(requirement.manifestSha256).toLowerCase() !== body.data.expectedManifestSha256.toLowerCase())
          return { conflict: "PACKET_REQUIREMENT_NOT_FOUND" };
        const fullRelease = await tx.packetRelease.findUnique({ where: { id: releaseId } });
        const audience = fullRelease ? publishedPacketAudience(fullRelease) : null;
        if (!audience) return { conflict: "PACKET_RELEASE_INVALID" };
        const recipient = await tx.user.findFirst({ where: { id: requirement.recipientId, archived: false,
          accountState: { notIn: ["PRIVACY_ERASED", "DISABLED", "SUSPENDED"] },
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] }, select: { id: true } });
        if (!recipient) return { conflict: "PACKET_RECIPIENT_UNAVAILABLE" };
        if (!studioAudienceMatchesContext(audience, String(recipient.id),
          await loadStudioAudienceUserContext(tx, recipient, { strict: true }))) return { conflict: "PACKET_RECIPIENT_OUTSIDE_RELEASE_AUDIENCE" };
        const acknowledged = await tx.packetReleaseAcknowledgment.findUnique({ where: {
          releaseId_recipientId: { releaseId, recipientId: requirement.recipientId } } });
        if (acknowledged?.manifestSha256?.toLowerCase() === body.data.expectedManifestSha256.toLowerCase())
          return { conflict: "PACKET_REQUIREMENT_ALREADY_ACKNOWLEDGED" };
        const now = new Date();
        const cooldown = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const recent = await tx.packetReleaseReminderDelivery.findFirst({ where: { requirementId,
          sentAt: { gt: cooldown } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
        if (recent) return { conflict: "PACKET_REMINDER_COOLDOWN", retryAfter: recent.sentAt };
        const delivery = await tx.packetReleaseReminderDelivery.create({ data: { requirementId, releaseId,
          recipientId: requirement.recipientId, sentById: context.user.id, manifestSha256: body.data.expectedManifestSha256.toLowerCase(), sentAt: now } });
        const inbox = await tx.notificationInboxItem.create({ data: { userId: requirement.recipientId,
          category: "action", priority: requirement.dueAt && new Date(requirement.dueAt).getTime() < now.getTime() ? "high" : "normal",
          title: "Packet acknowledgment required", message: "A published Packet release is awaiting your acknowledgment. Open Packets to review the assigned version.",
          entityType: "packet", entityId: packet.id, resourceKind: "packet", resourceId: packet.id,
          groupKey: `packet-release-requirement:${requirementId}`, tool: "packets", signal: "packet_acknowledgment_due", requiresAction: true,
          metadata: JSON.stringify({ releaseId, requirementId, versionLabel: fullRelease.versionLabel }) } });
        await tx.activityEvent.create({ data: { userId: context.user.id, type: "reminded", entityType: "packet", entityId: packet.id,
          title: "Packet acknowledgment reminder sent", message: `Reminder for published v${fullRelease.versionLabel}`,
          metadata: JSON.stringify({ releaseId, requirementId, recipientId: requirement.recipientId, deliveryId: delivery.id }) } });
        return { sentAt: delivery.sentAt, inbox };
      }, { isolationLevel: "Serializable" });
      if (result.conflict) return reply.code(409).send({ ok: false, code: result.conflict, retryAfter: result.retryAfter || null });
      // Only publish committed evidence. Stream publication is best effort:
      // inbox persistence is authoritative and clients can always reload it.
      try { notificationService?.publishRecord(result.inbox); } catch {}
      reply.header("Cache-Control", "no-store");
      return { ok: true, sentAt: result.sentAt, evidenceType: "in_app_reminder_created_not_read_proof" };
    } catch (error: any) {
      if (["P2034", "P2002"].includes(String(error?.code || "")))
        return reply.code(409).send({ ok: false, code: "PACKET_REMINDER_CONCURRENT" });
      throw error;
    }
  });

  // Complete-release totals are computed in PostgreSQL, never inferred from
  // whichever 50 recipients happen to be loaded in the author UI. Read-only.
  app.get("/api/packets/:packetId/releases/:releaseId/requirements/summary", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id,
      type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    const summary = await summarizePacketReleaseRequirements(prisma, releaseId, release.manifestSha256);
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, versionLabel: release.versionLabel, revoked: Boolean(release.revokedAt), summary };
  });

  // A manager receives only bounded, release-scoped assignment evidence.
  // Revoked releases keep their historical obligations and outcome records.
  app.get("/api/packets/:packetId/releases/:releaseId/requirements", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const { limit, cursor, status, asOf } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().min(1).optional(), status: z.enum(["all", "awaiting", "overdue", "due_soon", "acknowledged", "no_deadline", "integrity_issue"]).default("all"),
      asOf: z.string().datetime({ offset: true }).optional() }).parse(request.query || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (cursor && !(await prisma.packetReleaseRequirement.findFirst({ where: { id: cursor, releaseId }, select: { id: true } })))
      return reply.code(400).send({ ok: false, code: "PACKET_REQUIREMENT_CURSOR_INVALID" });
    if (status && status !== "all") {
      const clock = asOf ? new Date(asOf) : new Date();
      if (!Number.isFinite(clock.getTime()) || Math.abs(Date.now() - clock.getTime()) > 24 * 60 * 60 * 1000)
        return reply.code(400).send({ ok: false, code: "PACKET_REQUIREMENT_CLOCK_INVALID" });
      const cursorRow = cursor ? await prisma.packetReleaseRequirement.findFirst({ where: { id: cursor, releaseId },
        select: { id: true, assignedAt: true } }) : null;
      if (cursor && !cursorRow) return reply.code(400).send({ ok: false, code: "PACKET_REQUIREMENT_CURSOR_INVALID" });
      const { page, nextCursor } = await pagePacketReleaseRequirements(prisma, {
        releaseId, manifestSha256: release.manifestSha256, status, asOf: clock,
        cursor: cursorRow ? { id: cursorRow.id, assignedAt: cursorRow.assignedAt } : null, limit,
      });
      const people = page.length ? await prisma.user.findMany({ where: { id: { in: page.map((row: any) => row.recipientId) } },
        select: { id: true, username: true, displayName: true }, take: 100 }) : [];
      const names = new Map(people.map((row: any) => [row.id, row]));
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, releaseId, versionLabel: release.versionLabel, revoked: Boolean(release.revokedAt),
        status, asOf: clock.toISOString(), requirements: page.map((row: any) => ({ id: row.id,
          recipientId: row.recipientId, recipient: names.get(row.recipientId) || null,
          assignedAt: row.assignedAt, dueAt: row.dueAt,
          // A database-integrity mismatch is not an acknowledgment.
          integrityIssue: row.manifestSha256 !== release.manifestSha256,
          acknowledgedAt: row.manifestSha256 === release.manifestSha256 ? row.acknowledgedAt : null,
          lastRemindedAt: row.lastRemindedAt })), nextCursor };
    }
    const [rows, total] = await Promise.all([
      prisma.packetReleaseRequirement.findMany({ where: { releaseId }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: limit + 1,
        select: { id: true, recipientId: true, dueAt: true, assignedAt: true, manifestSha256: true } }),
      prisma.packetReleaseRequirement.count({ where: { releaseId } }),
    ]);
    const page = rows.slice(0, limit);
    const recipientIds = page.map((row: any) => row.recipientId);
    const [acknowledgments, people] = await Promise.all([
      prisma.packetReleaseAcknowledgment.findMany({ where: { releaseId, recipientId: { in: recipientIds } },
        select: { recipientId: true, acknowledgedAt: true, manifestSha256: true }, take: 100 }),
      prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, username: true, displayName: true }, take: 100 }),
    ]);
    const reminders = page.length ? await prisma.packetReleaseReminderDelivery.groupBy({ by: ["requirementId"],
      where: { releaseId, requirementId: { in: page.map((row: any) => row.id) } }, _max: { sentAt: true } }) : [];
    const reminded = new Map<string, Date>();
    for (const row of reminders) if (row._max?.sentAt) reminded.set(row.requirementId, row._max.sentAt);
    const completed = new Map(acknowledgments.filter((row: any) => row.manifestSha256 === release.manifestSha256).map((row: any) => [row.recipientId, row.acknowledgedAt]));
    const names = new Map(people.map((row: any) => [row.id, row]));
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, versionLabel: release.versionLabel, revoked: Boolean(release.revokedAt), total,
      requirements: page.map((row: any) => ({ id: row.id, recipientId: row.recipientId,
        recipient: names.get(row.recipientId) || null, assignedAt: row.assignedAt, dueAt: row.dueAt,
        integrityIssue: row.manifestSha256 !== release.manifestSha256,
        acknowledgedAt: row.manifestSha256 === release.manifestSha256 ? completed.get(row.recipientId) || null : null,
        lastRemindedAt: reminded.get(row.id) || null })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : null };
  });

  // This is a recipient's explicit assertion about one frozen publication.
  // Merely loading a catalogue or issuing a download is never acceptance.
  app.post("/api/packets/:packetId/deliveries/:releaseId/acknowledge", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const body = z.object({ expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/i),
      expectedVersionLabel: z.string().min(1).max(120), confirmed: z.literal(true) }).strict().safeParse(request.body || {});
    if (!body.success) return reply.code(400).send({ ok: false, code: "PACKET_ACKNOWLEDGMENT_CONFIRMATION_REQUIRED" });
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, frozenAudience, context.user))))
      return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (body.data.expectedManifestSha256.toLowerCase() !== release.manifestSha256.toLowerCase()
      || body.data.expectedVersionLabel !== release.versionLabel)
      return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_CHANGED", error: "Reload the published version before acknowledging." });
    try {
      // Share the release row's PostgreSQL lock with the revocation update.
      // No revocation can commit between our final check and evidence commit.
      const outcome = await prisma.$transaction(async (tx: any) => {
        const locked = (await tx.$queryRaw`SELECT "id", "packetDefinitionId", "manifestJson", "manifestSha256", "versionLabel", "revokedAt"
          FROM "PacketRelease" WHERE "id" = ${releaseId} AND "packetDefinitionId" = ${packet.packetDefinition.id} FOR UPDATE`) as any[];
        const current = locked[0];
        if (!current || current.revokedAt) return { conflict: "PACKET_RELEASE_REVOKED" };
        if (current.versionLabel !== body.data.expectedVersionLabel || current.manifestSha256.toLowerCase() !== body.data.expectedManifestSha256.toLowerCase())
          return { conflict: "PACKET_RELEASE_CHANGED" };
        try { packetRecipientCatalog(current); }
        catch { return { conflict: "PACKET_RELEASE_INVALID" }; }
        const existing = await tx.packetReleaseAcknowledgment.findUnique({ where: { releaseId_recipientId: { releaseId, recipientId: context.user.id } } });
        if (existing) return { acknowledgment: existing, alreadyAcknowledged: true };
        const acknowledgment = await tx.packetReleaseAcknowledgment.create({ data: {
          releaseId, recipientId: context.user.id, versionLabel: current.versionLabel,
          manifestSha256: current.manifestSha256.toLowerCase(),
        } });
        return { acknowledgment, alreadyAcknowledged: false };
      }, { isolationLevel: "Serializable" });
      if (outcome.conflict) return reply.code(409).send({ ok: false, code: outcome.conflict });
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, releaseId, versionLabel: outcome.acknowledgment.versionLabel,
        acknowledgedAt: outcome.acknowledgment.acknowledgedAt, alreadyAcknowledged: outcome.alreadyAcknowledged,
        evidenceType: "recipient_asserted_review_not_download_proof" };
    } catch (error: any) {
      // A concurrent uniqueness/serialization error must not become a false success.
      if (["P2002", "P2034"].includes(String(error?.code || "")))
        return reply.code(409).send({ ok: false, code: "PACKET_ACKNOWLEDGMENT_CONCURRENT", error: "Reload this release before retrying." });
      throw error;
    }
  });

  // Recipient-owned acknowledgment evidence is separate from release issuance.
  app.get("/api/packets/:packetId/deliveries/:releaseId/acknowledgment", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    const audience = publishedPacketAudience(release);
    if (!audience || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, audience, context.user))))
      return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    const existing = await prisma.packetReleaseAcknowledgment.findUnique({ where: { releaseId_recipientId: { releaseId, recipientId: context.user.id } } });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, versionLabel: release.versionLabel,
      acknowledgment: existing ? { acknowledgedAt: existing.acknowledgedAt, manifestSha256: existing.manifestSha256 } : null,
      evidenceType: "recipient_asserted_review_not_download_proof" };
  });

  // Scoped author report: never expose acceptance records to other recipients.
  app.get("/api/packets/:packetId/releases/:releaseId/acknowledgments", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "edit");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    const { limit, cursor } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().min(1).optional() }).parse(request.query || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({ where: { id: packetId, parentId: root.id, source: "packet", status: { not: "archived" } }, include: { ...itemInclude, packetDefinition: true } });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "edit")) return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    if (cursor && !(await prisma.packetReleaseAcknowledgment.findFirst({ where: { id: cursor, releaseId }, select: { id: true } })))
      return reply.code(400).send({ ok: false, code: "PACKET_ACKNOWLEDGMENT_CURSOR_INVALID" });
    const [rows, total] = await Promise.all([
      prisma.packetReleaseAcknowledgment.findMany({ where: { releaseId }, orderBy: [{ acknowledgedAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: limit + 1,
        select: { id: true, recipientId: true, versionLabel: true, manifestSha256: true, acknowledgedAt: true } }),
      prisma.packetReleaseAcknowledgment.count({ where: { releaseId } }),
    ]);
    const page = rows.slice(0, limit);
    const recipients = page.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(page.map((row: any) => row.recipientId))] } },
      select: { id: true, username: true, displayName: true }, take: 100 }) : [];
    const byId = new Map(recipients.map((person: any) => [person.id, person]));
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, releaseId, versionLabel: release.versionLabel, revoked: Boolean(release.revokedAt), total,
      acknowledgments: page.map((row: any) => ({ ...row, recipient: byId.get(row.recipientId) || null })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : null,
      evidenceType: "recipient_asserted_review_not_download_proof" };
  });

  // Delivers detached published note bytes only. Never resolves a source Library
  // path and never trusts a mutable Packet audience or definition version.
  app.get("/api/packets/:packetId/deliveries/:releaseId/artifacts/:position", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId, releaseId, position } = z.object({
      packetId: z.string().min(1), releaseId: z.string().min(1), position: z.coerce.number().int().min(1).max(2000),
    }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    // Fail closed on manifest tampering before evaluating its frozen audience.
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, frozenAudience, context.user))))
      return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    const artifact = await prisma.packetReleaseDerivative.findUnique({ where: { releaseId_position: { releaseId, position } } });
    if (!artifact) return reply.code(404).send({ ok: false, code: "PACKET_DERIVATIVE_NOT_FOUND" });
    let bytes: Buffer;
    try { bytes = verifyPacketDerivative(artifact); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_DERIVATIVE_INVALID" }); }
    // Commit delivery issuance evidence BEFORE sending bytes. A failed evidence
    // write fails closed; this is not proof the browser successfully saved them.
    const issuance = await commitPacketDeliveryIssuance(prisma, {
      packetDefinitionId: packet.packetDefinition.id, releaseId,
      expectedManifestSha256: release.manifestSha256, recipientId: context.user.id,
      kind: "artifact", position: position, derivativeHash: artifact.sha256, sizeBytes: bytes.byteLength,
      verifyRelease: (locked) => packetRecipientCatalog(locked),
      authorizeRecipient: async (tx, lockedAudience, recipient) =>
        Boolean(context.decorated?.isAdmin) || studioAudienceMatchesContext(lockedAudience, recipient.id,
          await loadStudioAudienceUserContext(tx, recipient, { strict: true })),
    });
    if (issuance.conflict) return reply.code(issuance.conflict === "PACKET_RELEASE_REVOKED" || issuance.conflict === "PACKET_RECIPIENT_UNAVAILABLE" || issuance.conflict === "PACKET_RECIPIENT_FORBIDDEN" ? 404 : 409)
      .send({ ok: false, code: issuance.conflict });
    try { await logActivity({ userId: context.user.id, type: "downloaded", entityType: "packet", entityId: packet.id, title: "Published Packet derivative issued", message: `Packet v${release.versionLabel}`, metadata: { releaseId, position, derivativeSha256: artifact.sha256 } }); }
    catch (error) { request.log.warn({ error, releaseId }, "Packet delivery issuance recorded but Activity projection failed"); }
    return reply.type(artifact.format === "pdf" ? "application/pdf" : artifact.format === "webp" ? "image/webp" : artifact.format === "wav" ? "audio/wav" : "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="packet-derivative-${position}.${artifact.format === "pdf" ? "pdf" : artifact.format === "webp" ? "webp" : artifact.format === "wav" ? "wav" : "txt"}"`)
      .header("Content-Length", String(bytes.byteLength)).send(bytes);
  });

  // Entire release as a detached, verified, bounded ZIP of published notes.
  // Missing derivative adapters stay missing; source Library blobs are NEVER
  // fetched as a fallback. Each request rechecks the frozen audience.
  app.get("/api/packets/:packetId/deliveries/:releaseId/bundle", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId, releaseId } = z.object({ packetId: z.string().min(1), releaseId: z.string().min(1) }).parse(request.params);
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet?.packetDefinition || !visibleFor(context, packet, "view"))
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND" });
    const release = await prisma.packetRelease.findFirst({ where: { id: releaseId, packetDefinitionId: packet.packetDefinition.id } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    try { packetRecipientCatalog(release); }
    catch { return reply.code(409).send({ ok: false, code: "PACKET_RELEASE_INVALID" }); }
    const frozenAudience = publishedPacketAudience(release);
    if (!frozenAudience || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, frozenAudience, context.user))))
      return reply.code(404).send({ ok: false, code: "PACKET_RELEASE_NOT_FOUND" });
    const artifacts = await prisma.packetReleaseDerivative.findMany({ where: { releaseId }, orderBy: { position: "asc" }, take: 2001 });
    let bundle: ReturnType<typeof buildPacketDerivativeBundle>;
    try { bundle = buildPacketDerivativeBundle(release, artifacts); }
    catch (error: any) {
      const code = String(error?.message || "");
      if (code === "PACKET_DERIVATIVE_NOT_FOUND") return reply.code(404).send({ ok: false, code });
      return reply.code(409).send({ ok: false, code: "PACKET_BUNDLE_INVALID" });
    }
    const issuance = await commitPacketDeliveryIssuance(prisma, {
      packetDefinitionId: packet.packetDefinition.id, releaseId,
      expectedManifestSha256: release.manifestSha256, recipientId: context.user.id,
      kind: "bundle", position: null, derivativeHash: bundle.sha256, sizeBytes: bundle.bytes.byteLength,
      verifyRelease: (locked) => packetRecipientCatalog(locked),
      authorizeRecipient: async (tx, lockedAudience, recipient) =>
        Boolean(context.decorated?.isAdmin) || studioAudienceMatchesContext(lockedAudience, recipient.id,
          await loadStudioAudienceUserContext(tx, recipient, { strict: true })),
    });
    if (issuance.conflict) return reply.code(issuance.conflict === "PACKET_RELEASE_REVOKED" || issuance.conflict === "PACKET_RECIPIENT_UNAVAILABLE" || issuance.conflict === "PACKET_RECIPIENT_FORBIDDEN" ? 404 : 409)
      .send({ ok: false, code: issuance.conflict });
    try { await logActivity({ userId: context.user.id, type: "downloaded", entityType: "packet", entityId: packet.id,
      title: "Published Packet derivative bundle issued", message: `Packet v${release.versionLabel}`,
      metadata: { releaseId, derivativeCount: bundle.count, bundleSha256: bundle.sha256 } }); }
    catch (error) { request.log.warn({ error, releaseId }, "Packet bundle issuance recorded but Activity projection failed"); }
    return reply.type("application/zip")
      .header("Content-Disposition", 'attachment; filename="packet-deliveries.zip"')
      .header("Content-Length", String(bundle.bytes.byteLength)).send(bundle.bytes);
  });

  app.post("/api/packets/:packetId/complete", async (request: any, reply: any) => {
    const context = await requirePacketsAccess(request, reply, "view");
    if (!context) return;
    const { packetId } = z.object({ packetId: z.string().min(1) }).parse(request.params);
    const body = packetCompletionInputSchema.parse(request.body || {});
    const root = await ensurePacketsRoot();
    const packet = await prisma.libraryItem.findFirst({
      where: { id: packetId, parentId: root.id, type: "folder", source: "packet", status: { not: "archived" } },
      include: { ...itemInclude, packetDefinition: true },
    });
    if (!packet || !packet.packetDefinition || !visibleFor(context, packet) || (!context.decorated?.isAdmin && !(await studioAudienceMatchesUser(prisma, packet.packetDefinition.audienceJson, context.user)))) {
      return reply.code(404).send({ ok: false, code: "PACKET_NOT_FOUND", error: "Packet not found." });
    }
    const mode = String(packet.packetDefinition.completionMode || "none");
    const expectedAction = mode === "read" ? "read" : mode === "acknowledge" ? "acknowledge" : mode === "form" ? "form" : null;
    if (!expectedAction) return reply.code(409).send({ ok: false, code: "PACKET_COMPLETION_NOT_REQUIRED", error: "This packet does not track completion." });
    if (body.action !== expectedAction) return reply.code(400).send({ ok: false, code: "PACKET_COMPLETION_MODE_MISMATCH", error: `This packet must be completed using ${expectedAction}.` });

    let formSubmissionId: string | null = null;
    if (mode === "form") {
      if (!packet.packetDefinition.completionFormId || !body.formSubmissionId) return reply.code(400).send({ ok: false, code: "PACKET_FORM_SUBMISSION_REQUIRED", error: "Complete the packet form before marking this packet complete." });
      const submission = await prisma.studioFormSubmission.findFirst({
        where: { id: body.formSubmissionId, userId: context.user.id, formId: packet.packetDefinition.completionFormId, status: { in: ["submitted", "approved"] } },
        select: { id: true },
      });
      if (!submission) return reply.code(409).send({ ok: false, code: "PACKET_FORM_SUBMISSION_INVALID", error: "A completed submission for the configured form is required." });
      formSubmissionId = submission.id;
    }

    const priorCompletions = await prisma.packetCompletion.findMany({ where: { packetDefinitionId: packet.packetDefinition.id, userId: context.user.id }, orderBy: { completedAt: "desc" } });
    const currentState = packetCompletionState(packet.packetDefinition, priorCompletions);
    if (currentState.state === "complete" && currentState.completion) {
      return { ok: true, alreadyComplete: true, completion: { id: currentState.completion.id, mode: currentState.completion.mode, formSubmissionId: currentState.completion.formSubmissionId, completedAt: currentState.completion.completedAt, validUntil: currentState.validUntil } };
    }
    const completedAt = new Date();
    const validUntil = packet.packetDefinition.recertifyDays ? new Date(completedAt.getTime() + Number(packet.packetDefinition.recertifyDays) * 24 * 60 * 60 * 1000) : null;
    const completion = await prisma.packetCompletion.create({
      data: { packetDefinitionId: packet.packetDefinition.id, userId: context.user.id, mode, formSubmissionId, packetVersionLabel: packet.packetDefinition.versionLabel, validUntil, evidenceJson: JSON.stringify({ packetVersionLabel: packet.packetDefinition.versionLabel, validUntil: validUntil?.toISOString() || null }) },
    });
    if (packet.packetDefinition.recordCompletion) {
      await ensureStudioKnowledgePersonnelRecord(prisma, { sourceKind: "packet_completion", sourceId: completion.id, subjectUserId: context.user.id, actorUserId: context.user.id, title: `${packet.title} completion`, recordType: "packet_completion", effectiveAt: completion.completedAt, fields: { packetId: packet.id, packetDefinitionId: packet.packetDefinition.id, packetTitle: packet.title, versionLabel: packet.packetDefinition.versionLabel, completionMode: mode, validUntil: validUntil?.toISOString() || null } });
    }
    await reconcileStudioKnowledgeAssignments({ prisma, logActivity, resourceKind: "packet", resourceId: packet.id, userIds: [context.user.id] });
    await logActivity({ userId: context.user.id, type: "completed", entityType: "packet", entityId: packet.id, title: "Packet completed", message: packet.title, metadata: { completionMode: mode, packetDefinitionId: packet.packetDefinition.id, completionId: completion.id, validUntil: validUntil?.toISOString() || null } });
    return { ok: true, completion: { id: completion.id, mode: completion.mode, formSubmissionId: completion.formSubmissionId, completedAt: completion.completedAt, validUntil: completion.validUntil } };
  });
}
