import {
  studioOffboardingCancelSchema,
  studioOffboardingCreateSchema,
  studioOffboardingEquipmentSchema,
  studioOffboardingExecuteSchema,
  studioOffboardingPreviewSchema,
  studioOffboardingReturnSchema,
} from "@cluster/shared";
import { z } from "zod";
import { requireReviewedOffboardingRevision } from "./studio-offboarding-revisions.js";
import { requireReturnEligible, StudioReturnError, validateReturnAccessWindow } from "./studio-return-eligibility.js";
import { settleOffboardingCredentials } from "../inventory/offboarding-credential-settlement.js";
import { inspectOffboardingCredentialClosure } from "../inventory/offboarding-credential-reconciliation.js";
import { closePendingAccessRenewals } from "../users/studio-access-renewal-closeout.js";

function parseJson(value: unknown, fallback: any) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function publicUser(user: any) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.preferredName || user.displayName || user.username };
}

function serializeCase(row: any) {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    subject: publicUser(row.subject),
    initiatedById: row.initiatedById || null,
    initiatedBy: publicUser(row.initiatedBy),
    handoffUserId: row.handoffUserId || null,
    handoff: publicUser(row.handoff),
    status: row.status,
    scheduledFor: row.scheduledFor || null,
    reason: row.reason || "",
    notes: row.notes || "",
    equipmentStatus: row.equipmentStatus,
    equipmentEvidenceNote: row.equipmentEvidenceNote || "",
    equipmentEvidence: parseJson(row.equipmentEvidenceJson, {}),
    personnelRecordId: row.personnelRecordId || null,
    snapshot: parseJson(row.snapshotJson, {}),
    result: parseJson(row.resultJson, {}),
    startedAt: row.startedAt || null,
    completedAt: row.completedAt || null,
    cancelledAt: row.cancelledAt || null,
    returnedAt: row.returnedAt || null,
    returnedById: row.returnedById || null,
    returnReason: row.returnReason || null,
    returnPersonnelRecordId: row.returnPersonnelRecordId || null,
    cancellationReason: row.cancellationReason || null,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const EQUIPMENT_RESOURCE_TYPES = new Set(["equipment", "hardware", "device", "vehicle", "camera", "console", "computer", "workstation"]);

async function offboardingImpact(prisma: any, userId: string) {
  const now = new Date();
  const [
    projectMemberships,
    ownedLibraryItems,
    reviewLibraryItems,
    folderPermissions,
    custodialRecords,
    teamLeaderships,
    departmentLeaderships,
    sourceWorkingCopies,
    futureBlocks,
    employment,
    teamMembershipCount,
    workspaceOwnerMemberships,
    futureOwnedCalendarEvents,
    assignedCards,
    ownedReviewAssets,
    reviewingReviewAssets,
    assignedEntityComments,
    assignedReviewComments,
    inventoryAllocations, assignedKeyCount, exposedAssignedKeyCount, activePackageGrantCount, pendingInventoryRequestCount, pendingPackageRequestCount,
  ] = await Promise.all([
    prisma.projectMembership.findMany({ where: { userId, status: "active" }, include: { project: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.libraryItem.findMany({ where: { ownerId: userId, status: { not: "archived" } }, select: { id: true, title: true, type: true, projectId: true }, take: 5000 }),
    prisma.libraryItem.findMany({ where: { reviewerId: userId, status: { not: "archived" } }, select: { id: true, title: true, type: true, projectId: true }, take: 5000 }),
    prisma.folderPermission.count({ where: { userId } }),
    prisma.personnelRecord.findMany({ where: { custodianUserId: userId, destroyedAt: null }, select: { id: true, title: true, subjectUserId: true }, take: 5000 }),
    prisma.studioTeam.findMany({ where: { leadUserId: userId, archived: false }, select: { id: true, name: true }, take: 1000 }),
    prisma.department.findMany({ where: { leadUserId: userId, archived: false }, select: { id: true, name: true }, take: 1000 }),
    prisma.sourceWorkingCopy.count({ where: { ownerUserId: userId, archived: false } }),
    prisma.scheduleBlock.findMany({
      where: { userId, endsAt: { gte: now }, status: { not: "cancelled" } },
      include: { resourceReservations: { include: { resource: true } } },
      orderBy: { startsAt: "asc" }, take: 1000,
    }),
    prisma.employment.findUnique({ where: { userId }, include: { department: true, jobRole: true } }).catch(() => null),
    prisma.studioTeamMember.count({ where: { userId, archived: false } }),
    prisma.workspaceMember.findMany({ where: { userId, role: "owner" }, include: { workspace: { select: { id: true, name: true } } } }),
    prisma.calendarEvent.findMany({ where: { ownerId: userId, startsAt: { gte: now }, status: { not: "cancelled" }, visibility: { not: "private" } }, select: { id: true, title: true, startsAt: true, visibility: true, attendeeIds: true }, take: 5000 }),
    prisma.card.findMany({ where: { assigneeId: userId, archived: false, completedAt: null }, select: { id: true, title: true }, take: 5000 }),
    prisma.reviewAsset.findMany({ where: { ownerId: userId, status: { not: "archived" } }, select: { id: true, title: true }, take: 5000 }),
    prisma.reviewAsset.findMany({ where: { reviewerId: userId, status: { not: "archived" } }, select: { id: true, title: true }, take: 5000 }),
    prisma.entityComment.findMany({ where: { assigneeId: userId, resolved: false }, select: { id: true, entityType: true, entityId: true }, take: 5000 }),
    prisma.reviewComment.findMany({ where: { assigneeId: userId, status: { not: "resolved" } }, select: { id: true, reviewAssetId: true }, take: 5000 }),
    prisma.studioInventoryAllocation.findMany({ where: { userId, status: "active" }, include: { asset: { select: { id: true, title: true, kind: true } } }, take: 5000 }),
    prisma.studioInventoryKey.count({ where: { userId, status: "assigned" } }),
    prisma.studioInventoryKey.count({ where: { userId, status: "assigned", firstRevealedAt: { not: null } } }),
    prisma.managedPackageEntitlement.count({ where: { userId, revokedAt: null } }),
    prisma.studioInventoryAccessRequest.count({ where: { userId, status: "pending" } }),
    prisma.managedPackageEntitlementRequest.count({ where: { userId, status: "pending" } }),
  ]);

  const equipmentReservations = futureBlocks.flatMap((block: any) => (block.resourceReservations || []).flatMap((reservation: any) => {
    const resource = reservation.resource;
    const type = String(resource?.type || "").trim().toLowerCase();
    if (!resource || !EQUIPMENT_RESOURCE_TYPES.has(type)) return [];
    return [{ blockId: block.id, blockTitle: block.title, startsAt: block.startsAt, endsAt: block.endsAt, resourceId: resource.id, resourceName: resource.name, resourceType: resource.type, quantity: reservation.quantity }];
  }));
  // Device pins are scoped to registration IDs; count their impact before offboarding.
  const registeredDeviceIds = (await prisma.deviceRegistration.findMany({ where: { userId }, select: { id: true }, take: 5000 })).map((registration: any) => registration.id);
  const activePackagePinCount = registeredDeviceIds.length
    ? await prisma.managedPackagePin.count({ where: { deviceId: { in: registeredDeviceIds }, active: true } })
    : 0;
  const leadProjects = projectMemberships.filter((membership: any) => Boolean(membership.isLead));
  const handoffRequired = leadProjects.length > 0
    || ownedLibraryItems.length > 0
    || reviewLibraryItems.length > 0
    || custodialRecords.length > 0
    || teamLeaderships.length > 0
    || departmentLeaderships.length > 0
    || workspaceOwnerMemberships.length > 0
    || futureOwnedCalendarEvents.length > 0
    || assignedCards.length > 0
    || ownedReviewAssets.length > 0
    || reviewingReviewAssets.length > 0
    || assignedEntityComments.length > 0
    || assignedReviewComments.length > 0;

  return {
    userId,
    employment: employment ? { id: employment.id, active: Boolean(employment.active), department: employment.department ? { id: employment.department.id, name: employment.department.name } : null, jobRole: employment.jobRole ? { id: employment.jobRole.id, name: employment.jobRole.name } : null } : null,
    projectMemberships: projectMemberships.map((membership: any) => ({ id: membership.id, projectId: membership.projectId, projectName: membership.project?.name || membership.projectId, isLead: Boolean(membership.isLead), roleLabel: membership.roleLabel || membership.roleKey || null, accessLevel: membership.accessLevel })),
    leadProjects: leadProjects.map((membership: any) => ({ projectId: membership.projectId, projectName: membership.project?.name || membership.projectId })),
    ownedLibraryItems: ownedLibraryItems.slice(0, 100),
    ownedLibraryItemCount: ownedLibraryItems.length,
    reviewLibraryItemCount: reviewLibraryItems.length,
    folderPermissionCount: folderPermissions,
    custodialRecords: custodialRecords.slice(0, 100),
    custodialRecordCount: custodialRecords.length,
    teamLeaderships,
    departmentLeaderships,
    sourceWorkingCopyCount: sourceWorkingCopies,
    teamMembershipCount,
    equipmentReservations,
    equipmentReservationCount: equipmentReservations.length,
    inventoryAllocations: inventoryAllocations.map((entry: any) => ({ id: entry.id, assetId: entry.assetId, assetTitle: entry.asset?.title, kind: entry.asset?.kind, quantity: entry.quantity })),
    inventoryAllocationCount: inventoryAllocations.length,
    assignedKeyCount, exposedAssignedKeyCount, activePackageGrantCount,
    pendingInventoryRequestCount, pendingPackageRequestCount,
    activePackagePinCount,
    inventoryPhysicalAllocationCount: inventoryAllocations.filter((entry: any) => ["physical", "equipment"].includes(entry.asset?.kind)).length,
    workspaceOwnerMemberships: workspaceOwnerMemberships.map((membership: any) => ({ workspaceId: membership.workspaceId, workspaceName: membership.workspace?.name || membership.workspaceId })),
    workspaceOwnerMembershipCount: workspaceOwnerMemberships.length,
    futureCalendarEventCount: futureOwnedCalendarEvents.length,
    assignedCardCount: assignedCards.length,
    ownedReviewAssetCount: ownedReviewAssets.length,
    reviewResponsibilityCount: reviewingReviewAssets.length,
    assignedEntityCommentCount: assignedEntityComments.length,
    assignedReviewCommentCount: assignedReviewComments.length,
    handoffRequired,
  };
}

async function ensureHandoffUser(prisma: any, subjectUserId: string, handoffUserId: string | null | undefined) {
  if (!handoffUserId) return null;
  if (handoffUserId === subjectUserId) throw Object.assign(new Error("Choose a different person for responsibility handoff."), { code: "OFFBOARDING_HANDOFF_SELF", statusCode: 400 });
  const user = await prisma.user.findFirst({
    where: { id: handoffUserId, archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] },
    select: { id: true, username: true, displayName: true, preferredName: true },
  });
  if (!user) throw Object.assign(new Error("Choose an active person with current Studio access for responsibility handoff."), { code: "OFFBOARDING_HANDOFF_INVALID", statusCode: 400 });
  return user;
}

/** Atomically reserve a single offboarding revision before any related records change. */
async function claimOffboardingRevision(tx: any, current: { id: string; revision: number; status: string }, status?: string) {
  const changed = await tx.studioOffboardingCase.updateMany({
    where: { id: current.id, revision: current.revision, status: current.status },
    data: { ...(status ? { status } : {}), revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw Object.assign(new Error("This offboarding case changed. Refresh the case before proceeding."), { code: "OFFBOARDING_CASE_STALE", statusCode: 409 });
}

export function registerStudioOffboardingRoutes(deps: any) {
  const { app, prisma, authorization, getCurrentUser, logActivity, logSecurityEvent } = deps;
  const include = { subject: true, initiatedBy: true, handoff: true } as const;

  async function requireAdmin(request: any, reply: any) {
    return authorization.requireTool(request, reply, "people", "edit");
  }

  app.get("/api/studio-systems/offboarding/options", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const users = await prisma.user.findMany({ where: { archived: false, accountState: { notIn: ["DISABLED", "PRIVACY_ERASED"] } }, select: { id: true, username: true, displayName: true, preferredName: true, employeeNumber: true }, orderBy: [{ displayName: "asc" }, { username: "asc" }], take: 5000 });
    return { users: users.map((user: any) => ({ ...publicUser(user), employeeNumber: user.employeeNumber || null })) };
  });

  app.get("/api/studio-systems/offboarding", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const query = z.object({ status: z.enum(["planned", "active", "completed", "cancelled"]).optional(), userId: z.string().trim().min(1).max(160).optional() }).parse(request.query || {});
    const rows = await prisma.studioOffboardingCase.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.userId ? { subjectUserId: query.userId } : {}) }, include, orderBy: { updatedAt: "desc" }, take: 500 });
    return { cases: rows.map(serializeCase) };
  });

  app.post("/api/studio-systems/offboarding/preview", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = studioOffboardingPreviewSchema.parse(request.body || {});
    const subject = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, username: true, displayName: true, preferredName: true, archived: true, accountState: true } });
    if (!subject) return reply.code(404).send({ ok: false, code: "OFFBOARDING_USER_NOT_FOUND", error: "Person not found." });
    const handoff = await ensureHandoffUser(prisma, body.userId, body.handoffUserId || null);
    const impact = await offboardingImpact(prisma, body.userId);
    return { subject: publicUser(subject), handoff: publicUser(handoff), impact };
  });

  app.post("/api/studio-systems/offboarding", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const body = studioOffboardingCreateSchema.parse(request.body || {});
    const subject = await prisma.user.findFirst({ where: { id: body.userId, accountState: { not: "PRIVACY_ERASED" } } });
    if (!subject) return reply.code(404).send({ ok: false, code: "OFFBOARDING_USER_NOT_FOUND", error: "Person not found." });
    const handoff = await ensureHandoffUser(prisma, body.userId, body.handoffUserId || null);
    const impact = await offboardingImpact(prisma, body.userId);
    if (impact.handoffRequired && !handoff) return reply.code(409).send({ ok: false, code: "OFFBOARDING_HANDOFF_REQUIRED", error: "Choose a responsibility handoff owner before starting this offboarding case.", impact });
    const displayName = subject.preferredName || subject.displayName || subject.username;
    const created = await prisma.$transaction(async (tx: any) => {
      // Serialize case creation per subject. A pre-transaction existence check lets two admins
      // simultaneously create separate active cases and duplicate confidential records.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${subject.id} FOR UPDATE`;
      const existing = await tx.studioOffboardingCase.findFirst({
        where: { subjectUserId: body.userId, status: { in: ["planned", "active"] } },
        select: { id: true },
      });
      if (existing) throw Object.assign(new Error("This person already has an active offboarding case."), {
        code: "OFFBOARDING_CASE_ACTIVE", statusCode: 409,
      });
      const record = await tx.personnelRecord.create({ data: {
        subjectUserId: subject.id,
        custodianUserId: actor?.id || null,
        createdById: actor?.id || null,
        lastModifiedById: actor?.id || null,
        title: `Offboarding — ${displayName}`,
        recordType: "offboarding",
        status: "draft",
        classification: "confidential",
        disclosurePolicy: "internal_only",
        fieldsJson: JSON.stringify({ reason: body.reason || null, scheduledFor: body.scheduledFor || null, handoffUserId: handoff?.id || null, createdAt: new Date().toISOString() }),
      } });
      return tx.studioOffboardingCase.create({ data: {
        subjectUserId: subject.id,
        initiatedById: actor?.id || null,
        handoffUserId: handoff?.id || null,
        scheduledFor: body.scheduledFor || null,
        reason: body.reason || null,
        notes: body.notes || null,
        personnelRecordId: record.id,
        snapshotJson: JSON.stringify(impact),
      }, include });
    });
    await logActivity?.({ userId: actor?.id, type: "offboarding_started", entityType: "studio_offboarding", entityId: created.id, title: "Offboarding started", message: displayName, metadata: { subjectUserId: subject.id, handoffUserId: handoff?.id || null, personnelRecordId: created.personnelRecordId } });
    return reply.code(201).send({ ok: true, case: serializeCase(created) });
  });

  app.patch("/api/studio-systems/offboarding/:caseId/equipment", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    const body = studioOffboardingEquipmentSchema.parse(request.body || {});
    const current = await prisma.studioOffboardingCase.findUnique({ where: { id: caseId }, include });
    if (!current) return reply.code(404).send({ ok: false, code: "OFFBOARDING_CASE_NOT_FOUND", error: "Offboarding case not found." });
    requireReviewedOffboardingRevision(current, body.expectedRevision);
    if (["completed", "cancelled"].includes(current.status)) return reply.code(409).send({ ok: false, code: "OFFBOARDING_CASE_CLOSED", error: "Closed offboarding cases cannot be changed." });
    const uniqueIds = [...new Set(body.libraryItemIds)];
    const validItems = uniqueIds.length ? await prisma.libraryItem.findMany({ where: { id: { in: uniqueIds }, deletedAt: null }, select: { id: true } }) : [];
    if (validItems.length !== uniqueIds.length) return reply.code(400).send({ ok: false, code: "OFFBOARDING_EVIDENCE_INVALID", error: "One or more evidence Library items could not be found." });
    const saved = await prisma.$transaction(async (tx: any) => {
      await claimOffboardingRevision(tx, current);
      if (current.personnelRecordId) {
        for (const item of validItems) await tx.personnelRecordAttachment.upsert({ where: { recordId_libraryItemId: { recordId: current.personnelRecordId, libraryItemId: item.id } }, update: { role: "equipment_return" }, create: { recordId: current.personnelRecordId, libraryItemId: item.id, role: "equipment_return", addedById: actor?.id || null } });
        const record = await tx.personnelRecord.findUnique({ where: { id: current.personnelRecordId } });
        if (record) {
          const fields = parseJson(record.fieldsJson, {});
          await tx.personnelRecord.update({ where: { id: record.id }, data: { fieldsJson: JSON.stringify({ ...fields, equipmentReturn: { status: body.status, note: body.note || null, evidenceLibraryItemIds: uniqueIds, recordedAt: new Date().toISOString(), recordedById: actor?.id || null } }), lastModifiedById: actor?.id || null, revision: { increment: 1 } } });
        }
      }
      return tx.studioOffboardingCase.update({ where: { id: caseId }, data: { equipmentStatus: body.status, equipmentEvidenceNote: body.note || null, equipmentEvidenceJson: JSON.stringify({ libraryItemIds: uniqueIds, recordedAt: new Date().toISOString(), recordedById: actor?.id || null }) }, include });
    });
    await logActivity?.({ userId: actor?.id, type: "offboarding_equipment_evidence", entityType: "studio_offboarding", entityId: current.id, title: body.status === "returned" ? "Equipment return recorded" : "Equipment return waived", message: current.subject?.preferredName || current.subject?.displayName || current.subject?.username || null, metadata: { subjectUserId: current.subjectUserId, equipmentStatus: body.status } });
    return { ok: true, case: serializeCase(saved) };
  });

  app.post("/api/studio-systems/offboarding/:caseId/execute", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    const body = studioOffboardingExecuteSchema.parse(request.body || {});
    const current = await prisma.studioOffboardingCase.findUnique({ where: { id: caseId }, include });
    if (!current) return reply.code(404).send({ ok: false, code: "OFFBOARDING_CASE_NOT_FOUND", error: "Offboarding case not found." });
    requireReviewedOffboardingRevision(current, body.expectedRevision);
    if (current.status === "completed") return { ok: true, case: serializeCase(current), alreadyCompleted: true };
    if (current.status === "cancelled") return reply.code(409).send({ ok: false, code: "OFFBOARDING_CASE_CANCELLED", error: "Cancelled offboarding cases cannot be executed." });
    const handoff = await ensureHandoffUser(prisma, current.subjectUserId, body.handoffUserId || current.handoffUserId || null);
    const impact = await offboardingImpact(prisma, current.subjectUserId);
    if (impact.handoffRequired && !handoff) return reply.code(409).send({ ok: false, code: "OFFBOARDING_HANDOFF_REQUIRED", error: "Responsibility handoff is required before access can be revoked.", impact });
    if ((impact.equipmentReservationCount > 0 || impact.inventoryPhysicalAllocationCount > 0) && current.equipmentStatus === "pending") return reply.code(409).send({ ok: false, code: "OFFBOARDING_EQUIPMENT_PENDING", error: "Record returned equipment or explicitly waive the equipment-return requirement before executing offboarding.", equipmentReservations: impact.equipmentReservations });

    const now = new Date();
    const result = await prisma.$transaction(async (tx: any) => {
      await claimOffboardingRevision(tx, current, "active");
      // Common serialisation point with Inventory/Package issuance and review.
      const lockedSubject = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${current.subjectUserId} FOR UPDATE`;
      if (!lockedSubject.length) throw Object.assign(new Error("Offboarding recipient was removed."), { code: "OFFBOARDING_SUBJECT_MISSING", statusCode: 409 });
      await tx.studioOffboardingCase.update({ where: { id: current.id }, data: { startedAt: current.startedAt || now, handoffUserId: handoff?.id || null } });

      const ownerMemberships = await tx.workspaceMember.findMany({ where: { userId: current.subjectUserId, role: "owner" } });
      if (ownerMemberships.length && !handoff) throw Object.assign(new Error("Workspace ownership must be handed off before this account can be offboarded."), { code: "OFFBOARDING_OWNER_HANDOFF_REQUIRED", statusCode: 409 });
      let workspaceOwnershipsTransferred = 0;
      if (handoff) {
        for (const membership of ownerMemberships) {
          await tx.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: handoff.id } },
            update: { role: "owner" },
            create: { workspaceId: membership.workspaceId, userId: handoff.id, role: "owner" },
          });
          workspaceOwnershipsTransferred += 1;
        }
      }

      const futureCalendarEvents = await tx.calendarEvent.findMany({ where: { ownerId: current.subjectUserId, startsAt: { gte: now }, status: { not: "cancelled" }, visibility: { not: "private" } }, select: { id: true, attendeeIds: true } });
      let calendarEventsTransferred = 0;
      if (handoff) {
        for (const event of futureCalendarEvents) {
          let attendeeIds: string[] = [];
          try { const parsed = JSON.parse(String(event.attendeeIds || "[]")); attendeeIds = Array.isArray(parsed) ? parsed.map(String) : []; } catch { attendeeIds = []; }
          const nextAttendees = [...new Set(attendeeIds.map((id) => id === current.subjectUserId ? handoff.id : id).filter((id) => id !== current.subjectUserId))];
          if (!nextAttendees.includes(handoff.id)) nextAttendees.push(handoff.id);
          await tx.calendarEvent.update({ where: { id: event.id }, data: { ownerId: handoff.id, attendeeIds: JSON.stringify(nextAttendees), revision: { increment: 1 } } });
          calendarEventsTransferred += 1;
        }
        if (futureCalendarEvents.length) await tx.meeting.updateMany({ where: { calendarEventId: { in: futureCalendarEvents.map((event: any) => event.id) }, organizerId: current.subjectUserId }, data: { organizerId: handoff.id, revision: { increment: 1 } } });
      }

      const cardsReassigned = handoff ? await tx.card.updateMany({ where: { assigneeId: current.subjectUserId, archived: false, completedAt: null }, data: { assigneeId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };
      const reviewOwnership = handoff ? await tx.reviewAsset.updateMany({ where: { ownerId: current.subjectUserId, status: { not: "archived" } }, data: { ownerId: handoff.id } }) : { count: 0 };
      const reviewResponsibilities = handoff ? await tx.reviewAsset.updateMany({ where: { reviewerId: current.subjectUserId, status: { not: "archived" } }, data: { reviewerId: handoff.id } }) : { count: 0 };
      const commentAssignments = handoff ? await tx.entityComment.updateMany({ where: { assigneeId: current.subjectUserId, resolved: false }, data: { assigneeId: handoff.id } }) : { count: 0 };
      const reviewCommentAssignments = handoff ? await tx.reviewComment.updateMany({ where: { assigneeId: current.subjectUserId, status: { not: "resolved" } }, data: { assigneeId: handoff.id } }) : { count: 0 };

      const activeMemberships = await tx.projectMembership.findMany({ where: { userId: current.subjectUserId, status: "active" } });
      let reassignedLeadProjects = 0;
      for (const membership of activeMemberships) {
        if (membership.isLead && handoff) {
          await tx.projectMembership.upsert({
            where: { projectId_userId: { projectId: membership.projectId, userId: handoff.id } },
            update: { roleKey: membership.roleKey || "lead", roleLabel: membership.roleLabel || "Project Lead", allocationPercent: membership.allocationPercent, accessLevel: "manage", isLead: true, status: "active", endsAt: null },
            create: { projectId: membership.projectId, userId: handoff.id, roleKey: membership.roleKey || "lead", roleLabel: membership.roleLabel || "Project Lead", allocationPercent: membership.allocationPercent, accessLevel: "manage", isLead: true, status: "active" },
          });
          reassignedLeadProjects += 1;
        }
        await tx.projectMembership.update({ where: { id: membership.id }, data: { status: "inactive", isLead: false, endsAt: now } });
      }

      const libraryOwnership = handoff ? await tx.libraryItem.updateMany({ where: { ownerId: current.subjectUserId, status: { not: "archived" } }, data: { ownerId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };
      const libraryReviews = handoff ? await tx.libraryItem.updateMany({ where: { reviewerId: current.subjectUserId, status: { not: "archived" } }, data: { reviewerId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };
      const recordCustody = handoff ? await tx.personnelRecord.updateMany({ where: { custodianUserId: current.subjectUserId, destroyedAt: null }, data: { custodianUserId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };
      const teamLeadership = handoff ? await tx.studioTeam.updateMany({ where: { leadUserId: current.subjectUserId, archived: false }, data: { leadUserId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };
      const departmentLeadership = handoff ? await tx.department.updateMany({ where: { leadUserId: current.subjectUserId, archived: false }, data: { leadUserId: handoff.id, revision: { increment: 1 } } }) : { count: 0 };

      const inventoryAllocationsRevoked = await tx.studioInventoryAllocation.updateMany({
        where: { userId: current.subjectUserId, status: "active", asset: { kind: { in: ["digital", "license"] } } },
        data: { status: "revoked", revokedAt: now, closedReason: "Offboarding: digital access revoked", revision: { increment: 1 } },
      });
      const credentialSettlement = await settleOffboardingCredentials(tx, {
        subjectUserId: current.subjectUserId, caseId: current.id, actorId: actor?.id || null, now,
      });
      // Physical equipment is still in someone's custody, not magically returned
      // because their account was disabled. Preserve the open allocation for return,
      // write-off, or documented transfer after offboarding.
      const physicalCustodyOutstanding = await tx.studioInventoryAllocation.count({
        where: { userId: current.subjectUserId, status: "active", asset: { kind: { in: ["physical", "equipment"] } } },
      });
      const subjectDevices = await tx.deviceRegistration.findMany({ where: { userId: current.subjectUserId }, select: { id: true } });
      const packagePinsRevoked = subjectDevices.length ? await tx.managedPackagePin.updateMany({
        where: { deviceId: { in: subjectDevices.map((device: any) => device.id) }, active: true },
        data: { active: false, revision: { increment: 1 } },
      }) : { count: 0 };
      const revokedSessions = await tx.session.updateMany({ where: { userId: current.subjectUserId, revokedAt: null }, data: { revokedAt: now, revocationReason: "OFFBOARDING" } });
      const revokedDevices = await tx.deviceRegistration.updateMany({ where: { userId: current.subjectUserId, revokedAt: null }, data: { revokedAt: now, proofStatus: "revoked" } });
      const revokedAuthenticators = await tx.authenticator.updateMany({ where: { userId: current.subjectUserId, revokedAt: null }, data: { state: "revoked", revokedAt: now } });
      const removedRecoveryCodes = await tx.authenticatorRecoveryCode.deleteMany({ where: { userId: current.subjectUserId } });
      const removedAuthenticatorChallenges = await tx.authenticatorChallenge.deleteMany({ where: { userId: current.subjectUserId } });
      const removedDiscordChallenges = await tx.discordLinkChallenge.deleteMany({ where: { userId: current.subjectUserId } });
      const closedPasswordResetRequests = await tx.passwordResetRequest.updateMany({ where: { userId: current.subjectUserId, status: "pending" }, data: { status: "dismissed", resolvedById: actor?.id || null, resolvedAt: now, resolution: "offboarding_completed" } });
      const dismissedNotifications = await tx.notificationInboxItem.updateMany({ where: { userId: current.subjectUserId, dismissedAt: null }, data: { dismissedAt: now, readAt: now, acknowledgedAt: now } });
      await tx.securityVerificationGrant.updateMany({ where: { userId: current.subjectUserId, revokedAt: null }, data: { revokedAt: now } });
      const archivedWorkingCopies = await tx.sourceWorkingCopy.updateMany({ where: { ownerUserId: current.subjectUserId, archived: false }, data: { archived: true } });
      const removedFolderPermissions = await tx.folderPermission.deleteMany({ where: { userId: current.subjectUserId } });
      const archivedTeamMemberships = await tx.studioTeamMember.updateMany({ where: { userId: current.subjectUserId, archived: false }, data: { archived: true, primaryMembership: false } });
      const archivedDirectAccessRules = await tx.accessRule.updateMany({ where: { subjectKind: "member", subjectId: current.subjectUserId, status: { not: "archived" } }, data: { status: "archived" } });
      const removedWorkspaceMemberships = await tx.workspaceMember.deleteMany({ where: { userId: current.subjectUserId } });
      const closedRenewals = await closePendingAccessRenewals(tx, {
        userId: current.subjectUserId, actorId: actor?.id || null, now,
      });
      const cancelledOnboarding = await tx.studioOnboardingAssignment.updateMany({ where: { userId: current.subjectUserId, status: "active" }, data: { status: "cancel", revokedAt: now, revokedById: actor?.id || null, lifecycleNote: "Offboarding completed" } });
      await tx.employment.updateMany({ where: { userId: current.subjectUserId, active: true }, data: { active: false, endDate: now, revision: { increment: 1 } } });
      await tx.workforceStatus.upsert({
        where: { userId: current.subjectUserId },
        create: { userId: current.subjectUserId, availability: "available", availabilityMessage: null, connectionVisibility: "invisible", updatedByUserId: actor?.id || current.subjectUserId },
        update: { availabilityMessage: null, connectionVisibility: "invisible", updatedByUserId: actor?.id || current.subjectUserId },
      });
      await tx.user.update({ where: { id: current.subjectUserId }, data: { archived: true, accountState: "DISABLED", accessExpiresAt: now, authenticationGeneration: { increment: 1 }, verificationGeneration: { increment: 1 } } });

      const outcome = {
        completedAt: now.toISOString(),
        handoffUserId: handoff?.id || null,
        projectMembershipsEnded: activeMemberships.length,
        leadProjectsReassigned: reassignedLeadProjects,
        workspaceOwnershipsTransferred,
        calendarEventsTransferred,
        cardsReassigned: Number(cardsReassigned.count || 0),
        reviewAssetsTransferred: Number(reviewOwnership.count || 0),
        reviewResponsibilitiesTransferred: Number(reviewResponsibilities.count || 0),
        commentAssignmentsTransferred: Number(commentAssignments.count || 0),
        reviewCommentAssignmentsTransferred: Number(reviewCommentAssignments.count || 0),
        libraryItemsTransferred: Number(libraryOwnership.count || 0),
        libraryReviewResponsibilitiesTransferred: Number(libraryReviews.count || 0),
        personnelRecordsTransferred: Number(recordCustody.count || 0),
        teamsTransferred: Number(teamLeadership.count || 0),
        departmentsTransferred: Number(departmentLeadership.count || 0),
        inventoryAllocationsRevoked: Number(inventoryAllocationsRevoked.count || 0),
        ...credentialSettlement,
        physicalCustodyOutstanding,
        packagePinsRevoked: Number(packagePinsRevoked.count || 0),
        sessionsRevoked: Number(revokedSessions.count || 0),
        devicesRevoked: Number(revokedDevices.count || 0),
        authenticatorsRevoked: Number(revokedAuthenticators.count || 0),
        recoveryCodesRemoved: Number(removedRecoveryCodes.count || 0),
        authenticatorChallengesRemoved: Number(removedAuthenticatorChallenges.count || 0),
        discordChallengesRemoved: Number(removedDiscordChallenges.count || 0),
        passwordResetRequestsClosed: Number(closedPasswordResetRequests.count || 0),
        notificationsDismissed: Number(dismissedNotifications.count || 0),
        workingCopiesArchived: Number(archivedWorkingCopies.count || 0),
        folderPermissionsRemoved: Number(removedFolderPermissions.count || 0),
        teamMembershipsArchived: Number(archivedTeamMemberships.count || 0),
        directAccessRulesArchived: Number(archivedDirectAccessRules.count || 0),
        workspaceMembershipsRemoved: Number(removedWorkspaceMemberships.count || 0),
        onboardingAssignmentsCancelled: Number(cancelledOnboarding.count || 0),
        accessRenewalsCancelled: Number(closedRenewals.count || 0),
        equipmentStatus: current.equipmentStatus,
      };

      if (current.personnelRecordId) {
        const record = await tx.personnelRecord.findUnique({ where: { id: current.personnelRecordId } });
        if (record) {
          const fields = parseJson(record.fieldsJson, {});
          await tx.personnelRecord.update({ where: { id: record.id }, data: { fieldsJson: JSON.stringify({ ...fields, offboardingOutcome: outcome }), status: "finalized", finalizedAt: record.finalizedAt || now, effectiveAt: record.effectiveAt || now, lastModifiedById: actor?.id || null, revision: { increment: 1 } } });
        }
      }

      const saved = await tx.studioOffboardingCase.update({ where: { id: current.id }, data: { status: "completed", completedAt: now, handoffUserId: handoff?.id || null, resultJson: JSON.stringify(outcome), revision: { increment: 1 } }, include });
      return { saved, outcome };
    });

    await logActivity?.({ userId: actor?.id, type: "offboarding_completed", entityType: "studio_offboarding", entityId: current.id, title: "Offboarding completed", message: current.subject?.preferredName || current.subject?.displayName || current.subject?.username || null, metadata: { subjectUserId: current.subjectUserId, handoffUserId: handoff?.id || null, ...result.outcome } });
    await logSecurityEvent?.({ event: "account.offboarded", actorUserId: actor?.id || null, targetUserId: current.subjectUserId, result: "SUCCESS", reasonCode: "STUDIO_OFFBOARDING_COMPLETED", request, metadata: { offboardingCaseId: current.id, handoffUserId: handoff?.id || null } });
    return { ok: true, case: serializeCase(result.saved), result: result.outcome };
  });

  // Explicit post-closeout inspection. No secret values, key IDs, or Vault
  // identifiers enter the response. A completed case does not prove external
  // license redemption/revocation, and returning staff receive no auto grants.
  app.get("/api/studio-systems/offboarding/:caseId/credential-review", async (request: any, reply: any) => {
    if (!(await authorization.requireAdmin(request, reply))) return;
    if (!(await requireAdmin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    const row = await prisma.studioOffboardingCase.findUnique({ where: { id: caseId },
      select: { id: true, status: true, subjectUserId: true, resultJson: true, revision: true } });
    if (!row) return reply.code(404).send({ ok: false, code: "OFFBOARDING_CASE_NOT_FOUND" });
    if (row.status !== "completed") return reply.code(409).send({ ok: false, code: "OFFBOARDING_CREDENTIAL_REVIEW_NOT_READY" });
    const review = await inspectOffboardingCredentialClosure(prisma, {
      subjectUserId: row.subjectUserId, caseId, outcome: parseJson(row.resultJson, {}),
    });
    // This is an observation: another administrator can change access after it.
    return { ok: true, caseId, asOf: new Date().toISOString(), caseRevision: row.revision, review };
  });

  // Returning staff retain their original Person ID/history. Nothing is automatically re-granted.
  // Owner/admin security approval, new credentials and scoped roles are separate deliberate actions.
  async function inspectReturn(db: any, caseId: string, expectedRevision?: number) {
    const caseRow = await db.studioOffboardingCase.findUnique({ where: { id: caseId }, include });
    if (!caseRow) throw new StudioReturnError("RETURN_CASE_NOT_FOUND", "Offboarding case not found.", 404);
    const [subject, latest, pending] = await Promise.all([
      db.user.findUnique({ where: { id: caseRow.subjectUserId } }),
      db.studioOffboardingCase.findFirst({ where: { subjectUserId: caseRow.subjectUserId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], select: { id: true } }),
      db.studioOffboardingCase.count({ where: { subjectUserId: caseRow.subjectUserId, status: { in: ["planned", "active"] } } }),
    ]);
    requireReturnEligible({ caseRow, subject, latestCompletedCaseId: latest?.id || null, activeCaseCount: pending, expectedRevision });
    return { caseRow, subject };
  }

  app.get("/api/studio-systems/offboarding/:caseId/return-preview", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!(await authorization.requireAdmin(request, reply))) return;
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    try {
      const { caseRow, subject } = await inspectReturn(prisma, caseId);
      return { ok: true, expectedRevision: caseRow.revision, subject: publicUser(subject), currentAccountType: subject.accountType,
        willPreserve: ["person_identity", "historical_records", "completed_offboarding_evidence"],
        willRevoke: ["password", "discord_link", "security_pin", "sessions", "authenticators", "devices"],
        willNotRestore: ["workspace_roles", "project_memberships", "folder_access", "team_memberships", "inventory_entitlements", "package_pins", "prior_employment"] };
    } catch (error) {
      if (error instanceof StudioReturnError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.post("/api/studio-systems/offboarding/:caseId/return", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!(await authorization.requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    if (!actor?.id) return reply.code(401).send({ ok: false, code: "RETURN_AUTH_REQUIRED", error: "An authenticated administrator is required." });
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    const body = studioOffboardingReturnSchema.parse(request.body || {});
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        // Lock the identity before checking newer cases, current state and writing the return.
        const original = await tx.studioOffboardingCase.findUnique({ where: { id: caseId }, select: { subjectUserId: true } });
        if (!original) throw new StudioReturnError("RETURN_CASE_NOT_FOUND", "Offboarding case not found.", 404);
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${original.subjectUserId} FOR UPDATE`;
        const { caseRow, subject } = await inspectReturn(tx, caseId, body.expectedRevision);
        const now = new Date();
        validateReturnAccessWindow(body.accountType, body.accessExpiresAt, now);
        const reserved = await tx.studioOffboardingCase.updateMany({
          where: { id: caseId, status: "completed", revision: body.expectedRevision, returnedAt: null },
          data: { revision: { increment: 1 }, returnedAt: now, returnedById: actor?.id || null, returnReason: body.reason },
        });
        if (reserved.count !== 1) throw new StudioReturnError("RETURN_CASE_STALE", "Return already processed or case changed.");
        const updated = await tx.user.updateMany({
          where: { id: subject.id, archived: true, accountState: "DISABLED" },
          data: { archived: false, accountState: "DISABLED", accountType: body.accountType,
            accessExpiresAt: body.accessExpiresAt, passwordHash: null, passwordChangedAt: null,
            pinHash: null, pinUpdatedAt: null, failedPinCount: 0, pinLockedUntil: null,
            discordUserId: null, discordUsername: null, discordDisplayName: null, discordAvatar: null,
            discordLinkedAt: null, discordLastVerifiedAt: null,
            toolPermissions: "{}", projectPermissions: "{}", failedLoginCount: 0, lastFailedLoginAt: null,
            lockedUntil: null, authenticationGeneration: { increment: 1 }, verificationGeneration: { increment: 1 },
            profileRevision: { increment: 1 } },
        });
        if (updated.count !== 1) throw new StudioReturnError("RETURN_ACCOUNT_STATE_CHANGED", "Account changed while preparing the return.");
        await tx.session.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: now, revocationReason: "RETURN_REENROLLMENT" } });
        await tx.securityVerificationGrant.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: now } });
        await tx.deviceRegistration.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: now, proofStatus: "revoked" } });
        await tx.authenticator.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: now, state: "revoked" } });
        await tx.authenticatorRecoveryCode.deleteMany({ where: { userId: subject.id } });
        await tx.authenticatorChallenge.deleteMany({ where: { userId: subject.id } });
        await tx.discordLinkChallenge.deleteMany({ where: { userId: subject.id } });
        // Offboarding remains final. A distinct confidential return record retains the new decision.
        const record = await tx.personnelRecord.create({ data: {
          subjectUserId: subject.id, custodianUserId: actor?.id || null,
          createdById: actor?.id || null, lastModifiedById: actor?.id || null,
          sourceKind: "studio_offboarding_return", sourceId: caseRow.id,
          title: `Return to studio — ${subject.preferredName || subject.displayName || subject.username}`,
          recordType: "return_to_studio", status: "finalized", classification: "confidential",
          disclosurePolicy: "internal_only", effectiveAt: now, finalizedAt: now,
          fieldsJson: JSON.stringify({ reason: body.reason, priorOffboardingCaseId: caseRow.id,
            previousPersonnelRecordId: caseRow.personnelRecordId || null, accountType: body.accountType,
            accessExpiresAt: body.accessExpiresAt?.toISOString() || null, identityReused: true,
            accessStatus: "disabled_pending_credentials_and_permissions", priorGrantsRestored: false }),
        } });
        const saved = await tx.studioOffboardingCase.update({ where: { id: caseRow.id }, data: { returnPersonnelRecordId: record.id }, include });
        return { saved, recordId: record.id, subjectId: subject.id };
      });
      await logActivity?.({ userId: actor?.id, type: "person_returned", entityType: "user", entityId: result.subjectId,
        title: "Return to studio recorded", message: "Identity preserved; new credentials and permissions required.",
        metadata: { offboardingCaseId: result.saved.id, personnelRecordId: result.recordId, accountStatus: "DISABLED" } });
      await logSecurityEvent?.({ event: "account.returned_to_studio", actorUserId: actor?.id || null, targetUserId: result.subjectId,
        result: "SUCCESS", reasonCode: "GOVERNED_PEOPLE_RETURN", request,
        metadata: { offboardingCaseId: result.saved.id, personnelRecordId: result.recordId, requiresFreshProvisioning: true } });
      return { ok: true, case: serializeCase(result.saved), subjectUserId: result.subjectId,
        accountState: "DISABLED", needsCredentials: true, needsPermissions: true, needsEmploymentReview: true };
    } catch (error) {
      if (error instanceof StudioReturnError) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  });

  app.post("/api/studio-systems/offboarding/:caseId/cancel", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    const { caseId } = z.object({ caseId: z.string().trim().min(1).max(160) }).parse(request.params);
    const body = studioOffboardingCancelSchema.parse(request.body || {});
    const current = await prisma.studioOffboardingCase.findUnique({ where: { id: caseId }, include });
    if (!current) return reply.code(404).send({ ok: false, code: "OFFBOARDING_CASE_NOT_FOUND", error: "Offboarding case not found." });
    requireReviewedOffboardingRevision(current, body.expectedRevision);
    if (current.status === "completed") return reply.code(409).send({ ok: false, code: "OFFBOARDING_CASE_COMPLETED", error: "Completed offboarding cases cannot be cancelled." });
    if (current.status === "cancelled") return { ok: true, case: serializeCase(current), alreadyCancelled: true };
    const now = new Date();
    const saved = await prisma.$transaction(async (tx: any) => {
      await claimOffboardingRevision(tx, current);
      if (current.personnelRecordId) {
        const record = await tx.personnelRecord.findUnique({ where: { id: current.personnelRecordId } });
        if (record && record.status === "draft") await tx.personnelRecord.update({ where: { id: record.id }, data: { fieldsJson: JSON.stringify({ ...parseJson(record.fieldsJson, {}), cancelledAt: now.toISOString(), cancellationReason: body.reason }), lastModifiedById: actor?.id || null, revision: { increment: 1 } } });
      }
      return tx.studioOffboardingCase.update({ where: { id: current.id }, data: { status: "cancelled", cancelledAt: now, cancellationReason: body.reason, revision: { increment: 1 } }, include });
    });
    await logActivity?.({ userId: actor?.id, type: "offboarding_cancelled", entityType: "studio_offboarding", entityId: current.id, title: "Offboarding cancelled", message: current.subject?.preferredName || current.subject?.displayName || current.subject?.username || null, metadata: { subjectUserId: current.subjectUserId } });
    return { ok: true, case: serializeCase(saved) };
  });
}
