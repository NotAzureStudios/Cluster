import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import { createHttpError } from "../../core/http-errors.js";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
import { CloseoutConcurrentWrite, closeoutShareLinkActive, closeoutShareLinkProjection, nextCloseoutStatus, updateCloseoutAtRevision } from "./project-closeout-policy.js";
import { createProjectDeliveryLifecycleService } from "./project-delivery-lifecycle-service.js";

const manualChecklistSchema = z.object({ hoursReviewed: z.boolean().optional(), externalDeliverablesConfirmed: z.boolean().optional(), backupExportCreated: z.boolean().optional() }).strict();
const patchSchema = z.object({
  checklist: manualChecklistSchema.optional(), notes: z.string().max(8000).optional().nullable(), expectedRevision: z.number().int().positive(),
  submissionNote: z.string().max(8000).optional().nullable(), verificationNote: z.string().max(8000).optional().nullable(), rejectionNote: z.string().max(8000).optional().nullable(),
});

type Dependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  enforceTargetAccess: (...args: any[]) => Promise<any>;
  authorization: { requestCanTarget: (request: FastifyRequest, targetKind: string, targetId: string, project: any, minimum: string) => Promise<boolean> };
  sendRevisionConflict: (reply: FastifyReply, entityType: string, current: unknown) => unknown;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  verifyUserPin: (user: any, pin: string, purpose: string, request?: FastifyRequest | null) => Promise<unknown>;
};

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

async function ensureProject(prisma: any, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
  return project;
}

function serializeCloseout(record: any) {
  const payload = parseObject(record.payload);
  return { id: record.id, projectId: record.projectId, status: record.status, checklist: payload.checklist || {}, notes: record.description || payload.notes || null, approverName: payload.approverName || null, requestedBy: payload.requestedBy || null, submittedBy: payload.submittedBy || null, submissionNote: payload.submissionNote || null, verifierName: payload.verifierName || null, verificationNote: payload.verificationNote || null, rejectionNote: payload.rejectionNote || null, submittedAt: payload.submittedAt || null, approvedAt: payload.approvedAt || null, verifiedAt: payload.verifiedAt || null, rejectedAt: payload.rejectedAt || null, archivedAt: payload.archivedAt || null, createdAt: record.createdAt, updatedAt: record.updatedAt, revision: record.revision };
}

async function ensureCloseoutRecord(prisma: any, project: any) {
  let record = await prisma.projectControlRecord.findFirst({ where: { projectId: project.id, kind: "closeout", category: "project-closeout", archived: false }, orderBy: { updatedAt: "desc" } });
  if (record) return record;
  // First-read initialization is serialized per Project; concurrent tabs must
  // not create competing closeout records that appear to have separate revisions.
  return prisma.$transaction(async (tx: any) => {
    await acquireTransactionAdvisoryLock(tx, `cluster-closeout:${project.id}`);
    const existing = await tx.projectControlRecord.findFirst({ where: { projectId: project.id, kind: "closeout", category: "project-closeout", archived: false }, orderBy: { updatedAt: "desc" } });
    if (existing) return existing;
    return tx.projectControlRecord.create({ data: { projectId: project.id, kind: "closeout", title: "Project closeout", description: null, status: project.archived ? "archived" : "draft", priority: "high", category: "project-closeout", progress: 0, payload: JSON.stringify({ checklist: {} }) } });
  });
}

async function evaluateCloseout(prisma: any, project: any, record: any) {
  const payload = parseObject(record.payload);
  const manual = payload.checklist || {};
  // Use bounded count/first queries for the readiness dashboard. Loading every
  // Card and Library file just to count unresolved work scales poorly.
  const projectBoard = { projectId: project.id, archived: false };
  const activeCards = { archived: false, list: { archived: false, board: projectBoard } };
  const ordinaryCards = { ...activeCards, workItemKind: { not: "ticket" } };
  const openCardWhere = { ...ordinaryCards, list: { archived: false, isDone: false, board: projectBoard } };
  const ticketCards = { ...activeCards, workItemKind: "ticket" };
  const unresolvedTickets = { ...ticketCards, OR: [{ ticketStage: { not: "resolved" } }, { ticketStage: null }] };
  const availableLibrary = { projectId: project.id, status: { not: "deleted" } };
  const [totalCards, openCards, totalTickets, openTickets, totalLibraryItems, pendingLibraryItems,
    latestBuild, roadmapOpen, shareLinks, hasTimeEntries, backups, sourceBinding] = await Promise.all([
    prisma.card.count({ where: ordinaryCards }),
    prisma.card.count({ where: openCardWhere }),
    prisma.card.count({ where: ticketCards }),
    prisma.card.count({ where: unresolvedTickets }),
    prisma.libraryItem.count({ where: availableLibrary }),
    prisma.libraryItem.count({ where: { projectId: project.id, status: { notIn: ["deleted", "approved", "active", "archived"] } } }),
    // A promoted or release-channel build is not automatically safe. The shared
    // delivery lifecycle owns QA, independent review, active holds and rebuild gates.
    prisma.deliveryBuild.findFirst({ where: { projectId: project.id, archived: false }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.projectControlRecord.count({ where: { projectId: project.id, archived: false, kind: { in: ["phase", "milestone", "deliverable"] }, status: { notIn: ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "cancelled"] } } }),
    prisma.projectShareLink.findMany({
      where: { projectId: project.id, status: "active" },
      select: { id: true, projectId: true, tokenPreview: true, accessLevel: true, allowedSections: true, expiresAt: true, maxUses: true, useCount: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.timeEntry.findFirst({ where: { projectId: project.id }, select: { id: true } }),
    prisma.clusterPersistenceRecord.findMany({ where: { projectId: project.id, kind: { in: ["maintenance", "attachment"] }, archived: false }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.projectSourceBinding.findFirst({ where: { projectId: project.id, archived: false }, select: { id: true } }),
  ]);
  // Avoid a heavy delivery projection for Projects that have never registered a
  // Build. Once a Build exists, a source-repository link must not bypass failed QA.
  // Read this via `prisma` (or the action's Serializable transaction) so a
  // changing release hold or failed QA cannot be ignored at verification time.
  // Historical evidence on an already-archived Project is immutable closeout
  // state, not a new release-certification attempt against a hidden Project.
  const archivedCompletion = project.archived && record.status === "archived";
  const deliveryLifecycle = latestBuild && !archivedCompletion ? await createProjectDeliveryLifecycleService(prisma).snapshot(project.id) : null;
  const deliveryReady = archivedCompletion || !latestBuild || Boolean(deliveryLifecycle?.releaseReady);
  const blockedDeliveryGates = (deliveryLifecycle?.readiness?.gates || []).filter((gate: any) => gate.required && !gate.passed);
  const deliveryEvidence = archivedCompletion
    ? "Archived after verified closeout; historical delivery approval retained"
    : !latestBuild
    ? "No active Builds; no Build/QA clearance required"
    : !deliveryLifecycle ? "Delivery evidence unavailable"
    : !deliveryLifecycle.readiness?.evidenceComplete ? `Delivery evidence incomplete: ${(deliveryLifecycle.readiness?.incompleteEvidence || []).join(", ")}`
    : deliveryReady ? `Latest Build ${deliveryLifecycle.latestBuild?.version || deliveryLifecycle.latestBuild?.id || latestBuild.id} passed delivery gates`
    : blockedDeliveryGates.slice(0, 3).map((gate: any) => gate.label).join(" · ") || "Delivery readiness is blocked";
  const activeShareLinks = shareLinks.filter((link: any) => closeoutShareLinkActive(link));
  const backupFound = backups.some((row: any) => /backup|export/i.test(`${row.title || ""} ${row.sourceKey || ""} ${row.payload || ""}`));
  const definitions = [
    { key: "cardsClosed", label: "Cards closed", detail: "Ordinary Board Cards are in completed columns; Ticket completion uses the separate triage gate.", done: openCards === 0, source: "auto", evidence: totalCards ? `${openCards} open / ${totalCards} total cards` : "No tracked cards found" },
    { key: "ticketsResolved", label: "Tickets resolved", detail: "QA, bug, and ticket work is resolved.", done: openTickets === 0, source: "auto", evidence: totalTickets ? `${openTickets} not resolved / ${totalTickets} Tickets (rejected Tickets require review)` : "No ticket cards found" },
    { key: "finalBuildLinked", label: "Final build linked", detail: "A source repository or Build is attached to the Project.", done: Boolean(sourceBinding || latestBuild), source: "auto", evidence: latestBuild ? "Build artifact registered" : sourceBinding ? "Repository linked" : "No source repository or Build found" },
    { key: "deliveryQaClear", label: "Build and QA clearance", detail: "The canonical delivery lifecycle must clear active Build, QA, fix and approval gates before closeout.", done: deliveryReady, source: "auto", evidence: deliveryEvidence },
    { key: "libraryApproved", label: "Library approved", detail: "Project documentation is approved or active.", done: pendingLibraryItems === 0, source: "auto", evidence: totalLibraryItems ? `${totalLibraryItems - pendingLibraryItems}/${totalLibraryItems} library items ready` : "No library items require approval" },
    { key: "timelineComplete", label: "Roadmap complete", detail: "Phases, milestones, and deliverables are completed or cancelled.", done: roadmapOpen === 0, source: "auto", evidence: roadmapOpen ? `${roadmapOpen} roadmap item${roadmapOpen === 1 ? "" : "s"} open` : "Roadmap complete" },
    { key: "hoursReviewed", label: "Hours reviewed", detail: "Time entries and corrections were reviewed.", done: Boolean(manual.hoursReviewed) || !hasTimeEntries, source: hasTimeEntries ? "manual" : "auto", evidence: hasTimeEntries ? manual.hoursReviewed ? "Time review confirmed" : "Time review requires confirmation" : "No project time entries" },
    { key: "externalDeliverablesConfirmed", label: "External delivery confirmed", detail: "External handoff and access are confirmed.", done: Boolean(manual.externalDeliverablesConfirmed) || !project.clientName || activeShareLinks.length > 0, source: project.clientName ? "mixed" : "auto", evidence: !project.clientName ? "No external client configured" : activeShareLinks.length ? `${activeShareLinks.length} active restricted share link${activeShareLinks.length === 1 ? "" : "s"}` : manual.externalDeliverablesConfirmed ? "External delivery confirmed manually" : "External delivery not confirmed" },
    { key: "backupExportCreated", label: "Backup or export created", detail: "A final backup or export package exists.", done: Boolean(manual.backupExportCreated) || backupFound, source: backupFound ? "auto" : "manual", evidence: backupFound ? "Backup/export record found" : manual.backupExportCreated ? "Backup/export confirmed manually" : "Backup/export not confirmed" },
    { key: "archiveApproved", label: "Archive approved", detail: "A project manager verified closeout.", done: ["verified", "archived"].includes(record.status), source: "lead", evidence: ["verified", "archived"].includes(record.status) ? `Verified by ${payload.verifierName || payload.approverName || "project manager"}` : "Waiting for project manager verification" },
  ];
  const required = definitions.filter((item) => item.key !== "archiveApproved");
  return { evaluations: definitions, readiness: Math.round((required.filter((item) => item.done).length / required.length) * 100), submissionReady: required.every((item) => item.done), shareLinks: activeShareLinks };
}

async function closeoutResponse(prisma: any, project: any, record: any, request: FastifyRequest, authorization: Dependencies["authorization"]) {
  const state = await evaluateCloseout(prisma, project, record);
  // Read access to a Project is not manage access to restricted partner links.
  const canManage = await authorization.requestCanTarget(request, "project", project.id, project, "manage");
  return { record: serializeCloseout(record), ...state, shareLinks: canManage ? state.shareLinks.map(closeoutShareLinkProjection) : [] };
}

export function registerProjectCloseoutRoutes({ app, prisma, getCurrentUser, decorateUserForClient, enforceTargetAccess, sendRevisionConflict, logActivity, verifyUserPin, authorization }: Dependencies) {
  app.get("/api/projects/:projectId/closeout", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "view"))) return;
    const record = await ensureCloseoutRecord(prisma, project);
    reply.header("Cache-Control", "no-store");
    return closeoutResponse(prisma, project, record, request, authorization);
  });

  app.put("/api/projects/:projectId/closeout", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = patchSchema.parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, "contribute"))) return;
    const record = await ensureCloseoutRecord(prisma, project);
    if (body.expectedRevision !== record.revision) return sendRevisionConflict(reply, "project_closeout", serializeCloseout(record));
    if (!["draft", "rejected"].includes(record.status) || project.archived) throw createHttpError("PROJECT_CLOSEOUT_LOCKED", "Reopen the closeout before editing checklist details.", 409);
    const payload = parseObject(record.payload);
    const { notes } = body;
    const nextPayload = { ...payload, checklist: { ...(payload.checklist || {}), ...(body.checklist || {}) }, notes: notes === undefined ? payload.notes : notes };
    let updated: any;
    try {
      updated = await updateCloseoutAtRevision(prisma, record.id, body.expectedRevision, record.status, { description: notes === undefined ? undefined : notes || null, payload: JSON.stringify(nextPayload) });
    } catch (error) {
      if (!(error instanceof CloseoutConcurrentWrite) && (error as any)?.code !== "P2034") throw error;
      const latest = await prisma.projectControlRecord.findUnique({ where: { id: record.id } });
      return sendRevisionConflict(reply, "project_closeout", serializeCloseout(latest || record));
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: "updated", entityType: "project_closeout", entityId: record.id, title: "Project closeout updated", message: project.name });
    reply.header("Cache-Control", "no-store");
    return closeoutResponse(prisma, project, updated, request, authorization);
  });

  app.post("/api/projects/:projectId/closeout/actions", async (request, reply) => {
    const user = await getCurrentUser(request);
    const decorated = await decorateUserForClient(user);
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z.object({ action: z.enum(["submit", "verify", "reject", "archive", "reopen"]), expectedRevision: z.number().int().positive(), note: z.string().max(8000).optional().nullable(), pin: z.string().optional().default("") }).parse(request.body || {});
    const project = await ensureProject(prisma, params.projectId);
    const permission = body.action === "submit" ? "contribute" : "manage";
    if (!(await enforceTargetAccess(request, reply, "project", project.id, project, permission))) return;
    const record = await ensureCloseoutRecord(prisma, project);
    if (record.revision !== body.expectedRevision) return sendRevisionConflict(reply, "project_closeout", serializeCloseout(record));
    const nextStatus = nextCloseoutStatus(record.status, body.action);
    if (!nextStatus || (project.archived && body.action !== "reopen")) throw createHttpError("PROJECT_CLOSEOUT_TRANSITION_INVALID", "This closeout action is not permitted from its current state.", 409);
    if (["submit", "archive", "reopen"].includes(body.action)) await verifyUserPin(user, body.pin, body.action === "submit" ? "submit_project_completion" : "archive_project", request);
    const now = new Date().toISOString();
    const name = decorated?.displayName || decorated?.preferredName || decorated?.username || "Project member";
    const payload = parseObject(record.payload);
    const nextPayload = { ...payload, checklist: { ...(payload.checklist || {}), ...(body.action === "verify" || body.action === "archive" ? { archiveApproved: true } : body.action === "reopen" || body.action === "reject" ? { archiveApproved: false } : {}) } };
    if (body.action === "submit") Object.assign(nextPayload, { submittedBy: name, requestedBy: name, submissionNote: body.note || null, submittedAt: now });
    if (body.action === "verify") Object.assign(nextPayload, { verifierName: name, approverName: name, verificationNote: body.note || null, verifiedAt: now, approvedAt: now });
    if (body.action === "reject") Object.assign(nextPayload, { rejectionNote: body.note || "Project manager requested changes.", rejectedAt: now });
    if (body.action === "archive") Object.assign(nextPayload, { archivedAt: now });
    let updated: any;
    try {
      updated = await prisma.$transaction(async (transaction: any) => {
      // Re-check the readiness gates in the same transaction as the status write.
      const fresh = await transaction.projectControlRecord.findUnique({ where: { id: record.id } });
      if (!fresh || fresh.revision !== body.expectedRevision || fresh.status !== record.status) throw new CloseoutConcurrentWrite();
      const state = await evaluateCloseout(transaction, project, fresh);
      // The submitted checklist may have become stale during review. Do not
      // verify or archive a Project if QA regressed or a release hold appeared.
      if (["submit", "verify", "archive"].includes(body.action) && !state.submissionReady) throw createHttpError("PROJECT_CLOSEOUT_NOT_READY", "Project closeout still has unresolved required checks.", 409);
      const closeout = await updateCloseoutAtRevision(transaction, record.id, body.expectedRevision, record.status, { status: nextStatus, progress: ["verified", "archived"].includes(nextStatus) ? 100 : nextStatus === "submitted" ? Math.max(90, state.readiness) : state.readiness, completedAt: ["verified", "archived"].includes(nextStatus) ? new Date() : null, payload: JSON.stringify(nextPayload) });
      if (body.action === "verify") await transaction.project.update({ where: { id: project.id }, data: { status: "completed", revision: { increment: 1 } } });
      if (body.action === "reopen") await transaction.project.update({ where: { id: project.id }, data: { ...(project.archived ? { archived: false } : {}), status: "active", revision: { increment: 1 } } });
      if (body.action === "archive") {
        await transaction.projectShareLink.updateMany({ where: { projectId: project.id, status: "active" }, data: { status: "revoked" } });
        await transaction.accessRule.updateMany({ where: { projectId: project.id, subjectKind: "external", status: "active" }, data: { status: "revoked" } });
        await transaction.project.update({ where: { id: project.id }, data: { archived: true, revision: { increment: 1 } } });
      }
      return closeout;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!(error instanceof CloseoutConcurrentWrite) && (error as any)?.code !== "P2034") throw error;
      const latest = await prisma.projectControlRecord.findUnique({ where: { id: record.id } });
      return sendRevisionConflict(reply, "project_closeout", serializeCloseout(latest || record));
    }
    await logActivity({ userId: user?.id, projectId: project.id, type: `closeout_${body.action}`, entityType: "project_closeout", entityId: record.id, title: `Project closeout ${body.action}`, message: body.note || project.name, metadata: { status: nextStatus } });
    reply.header("Cache-Control", "no-store");
    return closeoutResponse(prisma, { ...project, status: body.action === "verify" ? "completed" : body.action === "reopen" ? "active" : project.status, archived: body.action === "archive" ? true : body.action === "reopen" ? false : project.archived }, updated, request, authorization);
  });
}
