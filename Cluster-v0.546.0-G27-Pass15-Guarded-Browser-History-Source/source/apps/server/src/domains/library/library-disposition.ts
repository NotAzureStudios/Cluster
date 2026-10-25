import { createHash, randomUUID } from "node:crypto";
import { libraryRetentionDecision } from "./library-governance.js";
import { resolveLibraryEffectiveRetention } from "./library-effective-retention.js";

/** Storage is deliberately NOT released by the disposition ledger. The ledger
 * is a prerequisite for quarantine, not an unlink permit. A metadata delete
 * would cascade revision/provenance rows and make later physical review unsafe. */
export const LIBRARY_DISPOSITION_RESTORE_DAYS = 30;
export const LIBRARY_DISPOSITION_SNAPSHOT_VERSION = 1;
export const LIBRARY_DISPOSITION_REQUIRED_APPROVERS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export class LibraryDispositionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "LibraryDispositionError"; }
}

export function libraryDispositionReviewAfter(now = new Date(), retentionUntil: Date | string | null = null) {
  const retentionMs = retentionUntil ? new Date(retentionUntil).getTime() : 0;
  if (retentionUntil && !Number.isFinite(retentionMs)) throw new LibraryDispositionError("RETENTION_DATE_INVALID", "Retention deadline is invalid.");
  return new Date(Math.max(now.getTime() + LIBRARY_DISPOSITION_RESTORE_DAYS * DAY_MS, retentionMs));
}

/** Bounded evidence of all authority held by the item, including revisions,
 * derivatives, and immutable published references. Fail CLOSED on unknown data. */
export async function inspectLibraryDisposition(tx: any, itemId: string, now = new Date()) {
  const item = await tx.libraryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new LibraryDispositionError("LIBRARY_NOT_FOUND", "Library record no longer exists.");
  const effectiveRetention = await resolveLibraryEffectiveRetention(tx, item);
  const decision = libraryRetentionDecision({ ...item, legalHold: effectiveRetention.legalHold,
    retentionUntil: effectiveRetention.retentionUntil }, now);
  const [children, backlinks, versions, derivatives, hierarchy, assetLocks, protectedRecords, releaseReferences] = await Promise.all([
    tx.libraryItem.count({ where: { parentId: itemId } }),
    tx.libraryBacklink.count({ where: { itemId } }),
    tx.libraryVersion.count({ where: { itemId } }),
    tx.libraryDerivative.count({ where: { itemId } }),
    tx.libraryHierarchyLifecycleEntry.count({ where: { itemId, restoredAt: null } }),
    tx.libraryAssetLock.findUnique({ where: { itemId } }),
    tx.personnelRecordAttachment.count({ where: { libraryItemId: itemId } }),
    // Immutable snapshots are an independent authority; backlinks alone
    // can be stale or missing after a failed indexing/rebuild operation.
    tx.packetRelease.count({ where: { manifestJson: { contains: `"sourceId":"${itemId}"` } } }),
  ]);
  const blockers: string[] = [];
  if (!decision.eligible) blockers.push(decision.code);
  if (children) blockers.push("CHILDREN_PRESENT");
  if (backlinks) blockers.push("BACKLINKS_PRESENT");
  if (releaseReferences) blockers.push("PUBLISHED_RELEASE_REFERENCE");
  if (hierarchy) blockers.push("HIERARCHY_PROVENANCE_ACTIVE");
  if (protectedRecords) blockers.push("PERSONNEL_RECORD_REFERENCE");
  if (assetLocks && (assetLocks.state === "active") && (!assetLocks.expiresAt || new Date(assetLocks.expiresAt) > now)) blockers.push("ACTIVE_EDIT_LOCK");
  // The older routes allowed 'acknowledge backlinks'; governance never
  // interprets acknowledgment as permission to corrupt referential integrity.
  const evidence = {
    itemId, revision: item.revision, status: item.status, lifecycleState: item.lifecycleState,
    retentionPolicyKey: item.retentionPolicyKey || null, retentionUntil: item.retentionUntil || null,
    legalHold: Boolean(item.legalHold), effectiveLegalHold: effectiveRetention.legalHold,
    effectiveRetentionUntil: effectiveRetention.retentionUntil,
    retentionLineage: effectiveRetention.lineage,
    retentionGoverningIds: effectiveRetention.governingIds,
    children, backlinks, versions, derivatives,
    publishedReleases: releaseReferences, hierarchy, protectedRecords,
    hasActiveLock: blockers.includes("ACTIVE_EDIT_LOCK"),
    fileReferenceCount: Number(Boolean(item.fileName)) + versions + derivatives,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  return { item, blockers, evidence, fingerprint, reviewAfter: libraryDispositionReviewAfter(now, effectiveRetention.retentionUntil) };
}

type DispositionRequest = { id: string; itemId: string; status: string; requestedById: string;
  decisionRevision?: number; snapshotVersion?: number; snapshotSha256: string; reviewAfter: Date; requestKey: string };
const ACTIVE_DISPOSITION_STATUSES = ["PENDING_REVIEW", "REVIEW_APPROVED"] as const;

async function activeLibraryDispositionRequest(tx: any, itemId: string): Promise<DispositionRequest | null> {
  // Keep the queries explicit so the old R63 fixture still exercises its original
  // pending-only contract. The database partial index enforces uniqueness across both states.
  return await tx.libraryDispositionRequest.findFirst({ where: { itemId, status: "PENDING_REVIEW" } })
    || await tx.libraryDispositionRequest.findFirst({ where: { itemId, status: "REVIEW_APPROVED" } });
}

async function dispositionDecisions(tx: any, requestId: string) {
  if (!tx.libraryDispositionDecision) return [];
  return await tx.libraryDispositionDecision.findMany({ where: { requestId }, orderBy: { requestDecisionRevision: "asc" } });
}

/** Each actor has at most one active approval. Revoking removes only that
 * person's vote; rejected reviews close the entire request. This projection
 * is replayed from an immutable, strictly ordered decision journal. */
export function projectLibraryDispositionApprovals(decisions: Array<{ action: string; actorId: string }>) {
  let approvers = new Set<string>();
  for (const decision of decisions) {
    if (decision.action === "APPROVE") approvers.add(decision.actorId);
    else if (decision.action === "REVOKE") approvers = new Set([...approvers].filter((id) => id !== decision.actorId));
    else if (decision.action === "REJECT") approvers.clear();
  }
  return [...approvers];
}

/** Create one auditable pending request; keep all file/revision authority intact.
 * Caller owns transaction isolation, authentication, and access policy. */
export async function requestLibraryDisposition(tx: any, input: {
  itemId: string; actorId: string; expectedRevision: number; confirmTitle: string;
  reason: string; requestKey: string; now?: Date;
}) {
  const now = input.now || new Date();
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 1000) throw new LibraryDispositionError("DISPOSITION_REASON_REQUIRED", "Give a reason between 12 and 1,000 characters.");
  const itemId = input.itemId;
  const previous = await activeLibraryDispositionRequest(tx, itemId);
  if (previous) {
    if (previous.requestKey === input.requestKey && previous.requestedById === input.actorId && previous.status === "PENDING_REVIEW") return { request: previous, replay: true };
    throw new LibraryDispositionError("DISPOSITION_ALREADY_RECORDED", "This item already has a disposition record. Resolve or cancel it before requesting again.");
  }
  const inspected = await inspectLibraryDisposition(tx, itemId, now);
  if (inspected.item.revision !== input.expectedRevision || inspected.item.title !== input.confirmTitle)
    throw new LibraryDispositionError("LIBRARY_REVISION_CONFLICT", "Item changed; review the updated disposition evidence.");
  if (inspected.blockers.length) throw new LibraryDispositionError("DISPOSITION_BLOCKED", `Disposition is blocked: ${inspected.blockers.join(", ")}`);
  const request = await tx.libraryDispositionRequest.create({ data: {
    id: randomUUID(), itemId, requestKey: input.requestKey, requestedById: input.actorId,
    reason, status: "PENDING_REVIEW", requestedAt: now, reviewAfter: inspected.reviewAfter,
    originalRevision: inspected.item.revision, snapshotVersion: LIBRARY_DISPOSITION_SNAPSHOT_VERSION,
    decisionRevision: 0, snapshotSha256: inspected.fingerprint,
    snapshotJson: JSON.stringify(inspected.evidence),
  } });
  await tx.libraryDispositionEvidence.create({ data: {
    requestId: request.id, actorId: input.actorId, eventType: "REQUESTED",
    occurredAt: now, detailsJson: JSON.stringify({ snapshotSha256: inspected.fingerprint, reviewAfter: inspected.reviewAfter.toISOString(), blockers: [] }),
  } });
  await tx.activityEvent.create({ data: {
    userId: input.actorId, projectId: inspected.item.projectId, type: "disposition_requested", entityType: "library",
    entityId: itemId, title: "Library disposition review requested", message: inspected.item.title,
    metadata: JSON.stringify({ requestId: request.id, restoreWindowDays: LIBRARY_DISPOSITION_RESTORE_DAYS, storageDisposition: "preserved_no_unlink" }),
  } });
  return { request, replay: false };
}

export async function cancelLibraryDisposition(tx: any, input: {
  itemId: string; actorId: string; reason: string; now?: Date;
}) {
  const request = await activeLibraryDispositionRequest(tx, input.itemId);
  if (!request || !ACTIVE_DISPOSITION_STATUSES.includes(request.status as any)) return { cancelled: false, request };
  if (input.reason.trim().length < 5 || input.reason.length > 1000) throw new LibraryDispositionError("DISPOSITION_CANCEL_REASON_REQUIRED", "A cancellation reason is required.");
  const now = input.now || new Date();
  const claimed = await tx.libraryDispositionRequest.updateMany({
    where: { id: request.id, status: request.status, decisionRevision: request.decisionRevision ?? 0 },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: input.actorId, decisionRevision: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new LibraryDispositionError("DISPOSITION_STATE_CONFLICT", "Disposition state changed. Refresh and retry.");
  await tx.libraryDispositionEvidence.create({ data: {
    requestId: request.id, actorId: input.actorId, eventType: "CANCELLED", occurredAt: now,
    detailsJson: JSON.stringify({ reason: input.reason.trim() }),
  } });
  return { cancelled: true, request };
}

/** Review is deliberately observation-only. Even after the window and an
 * unchanged snapshot it MUST NOT approve filesystem disposal automatically. */
export async function reviewLibraryDisposition(tx: any, itemId: string, now = new Date()) {
  const request = await activeLibraryDispositionRequest(tx, itemId);
  if (!request) return null;
  const inspected = await inspectLibraryDisposition(tx, itemId, now);
  const blockers = [...inspected.blockers];
  if (now < request.reviewAfter) blockers.push("RESTORE_WINDOW_ACTIVE");
  if (inspected.fingerprint !== request.snapshotSha256) blockers.push("DISPOSITION_SNAPSHOT_STALE");
  if ((request.snapshotVersion ?? LIBRARY_DISPOSITION_SNAPSHOT_VERSION) !== LIBRARY_DISPOSITION_SNAPSHOT_VERSION) blockers.push("DISPOSITION_SNAPSHOT_VERSION_UNSUPPORTED");
  const decisions = await dispositionDecisions(tx, request.id);
  const approverIds = projectLibraryDispositionApprovals(decisions);
  const decisionProjectionValid = (request.status === "REVIEW_APPROVED") === (approverIds.length >= LIBRARY_DISPOSITION_REQUIRED_APPROVERS);
  if (!decisionProjectionValid) blockers.push("DISPOSITION_DECISION_PROJECTION_MISMATCH");
  // No generated physical-deletion authority is ever returned here.
  return { request, readyForHumanReview: request.status === "PENDING_REVIEW" && blockers.length === 0,
    approvalValidNow: request.status === "REVIEW_APPROVED" && blockers.length === 0,
    approverIds, approvalCount: approverIds.length, requiredApprovers: LIBRARY_DISPOSITION_REQUIRED_APPROVERS,
    decisions: decisions.map((decision: any) => ({ id: decision.id, actorId: decision.actorId, action: decision.action,
      reason: decision.reason, occurredAt: decision.occurredAt, snapshotVersion: decision.snapshotVersion })),
    blockers, currentEvidence: inspected.evidence,
    physicalDisposalAllowed: false, storageDisposition: "preserved_no_unlink" };
}

/** Human governance decisions, never storage execution. The enclosing
 * SERIALIZABLE transaction and decisionRevision CAS fence duplicate/concurrent
 * reviewers. Only callers with freshly verified administrator authority may
 * invoke this function; the HTTP route rechecks that role on every request. */
export async function decideLibraryDisposition(tx: any, input: {
  itemId: string; actorId: string; action: "APPROVE" | "REVOKE" | "REJECT";
  reason: string; expectedDecisionRevision: number; now?: Date;
}) {
  const now = input.now || new Date();
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 1000)
    throw new LibraryDispositionError("DISPOSITION_DECISION_REASON_REQUIRED", "Decision reason must contain 12–1,000 characters.");
  if (!Number.isSafeInteger(input.expectedDecisionRevision) || input.expectedDecisionRevision < 0)
    throw new LibraryDispositionError("DISPOSITION_DECISION_VERSION_INVALID", "A valid review revision is required.");
  const request = await activeLibraryDispositionRequest(tx, input.itemId);
  if (!request) throw new LibraryDispositionError("DISPOSITION_NOT_PENDING", "No active review exists.");
  if (request.requestedById === input.actorId)
    throw new LibraryDispositionError("DISPOSITION_SELF_APPROVAL", "The requester cannot review their own disposition.");
  if ((request.decisionRevision ?? 0) !== input.expectedDecisionRevision)
    throw new LibraryDispositionError("DISPOSITION_DECISION_CONFLICT", "A different reviewer changed the decision. Refresh before retrying.");
  const decisions = await dispositionDecisions(tx, request.id);
  const approverIds = projectLibraryDispositionApprovals(decisions);
  if (input.action === "APPROVE") {
    if (request.status !== "PENDING_REVIEW") throw new LibraryDispositionError("DISPOSITION_ALREADY_REVIEWED", "The request already has final governance approval.");
    if (approverIds.includes(input.actorId)) throw new LibraryDispositionError("DISPOSITION_DUPLICATE_APPROVER", "This administrator already approved the request.");
    if (approverIds.length >= LIBRARY_DISPOSITION_REQUIRED_APPROVERS) throw new LibraryDispositionError("DISPOSITION_DECISION_PROJECTION_MISMATCH", "Unexpected review quorum.");
  } else if (input.action === "REVOKE") {
    if (!approverIds.includes(input.actorId)) throw new LibraryDispositionError("DISPOSITION_NOT_AN_APPROVER", "Only the administrator who approved may withdraw their own vote.");
  }
  // An approval after a retention/hold or revision change must use a newly
  // requested evidence snapshot. For REVOKE and REJECT, allow safe shutdown
  // even after evidence becomes stale or a legal hold is applied.
  const inspected = await inspectLibraryDisposition(tx, input.itemId, now);
  if (input.action === "APPROVE") {
    if (now < new Date(request.reviewAfter)) throw new LibraryDispositionError("DISPOSITION_RESTORE_WINDOW_ACTIVE", "The restoration window has not elapsed.");
    if ((request.snapshotVersion ?? LIBRARY_DISPOSITION_SNAPSHOT_VERSION) !== LIBRARY_DISPOSITION_SNAPSHOT_VERSION)
      throw new LibraryDispositionError("DISPOSITION_SNAPSHOT_VERSION_UNSUPPORTED", "Review the disposition with a supported evidence version.");
    if (inspected.blockers.length || inspected.fingerprint !== request.snapshotSha256)
      throw new LibraryDispositionError("DISPOSITION_EVIDENCE_STALE", "Retention, dependencies, or the item changed; a new disposition review is required.");
  }
  const nextApprovers = input.action === "APPROVE"
    ? [...approverIds, input.actorId]
    : input.action === "REVOKE" ? approverIds.filter((id) => id !== input.actorId) : [];
  const nextStatus = input.action === "REJECT" ? "REVIEW_REJECTED"
    : nextApprovers.length >= LIBRARY_DISPOSITION_REQUIRED_APPROVERS ? "REVIEW_APPROVED" : "PENDING_REVIEW";
  const nextRevision = input.expectedDecisionRevision + 1;
  const changed = await tx.libraryDispositionRequest.updateMany({
    where: { id: request.id, status: request.status, decisionRevision: input.expectedDecisionRevision },
    data: { status: nextStatus, decisionRevision: { increment: 1 } },
  });
  if (changed.count !== 1) throw new LibraryDispositionError("DISPOSITION_DECISION_CONFLICT", "Review changed concurrently. Refresh and retry.");
  await tx.libraryDispositionDecision.create({ data: {
    id: randomUUID(), requestId: request.id, actorId: input.actorId, action: input.action,
    reason, snapshotVersion: LIBRARY_DISPOSITION_SNAPSHOT_VERSION,
    snapshotSha256: inspected.fingerprint, requestDecisionRevision: nextRevision, occurredAt: now,
  } });
  await tx.libraryDispositionEvidence.create({ data: {
    requestId: request.id, actorId: input.actorId, eventType: `REVIEW_${input.action}`,
    occurredAt: now, detailsJson: JSON.stringify({
      decisionRevision: nextRevision, snapshotVersion: LIBRARY_DISPOSITION_SNAPSHOT_VERSION,
      originalSnapshotSha256: request.snapshotSha256, reviewedSnapshotSha256: inspected.fingerprint,
      approvalCount: nextApprovers.length, status: nextStatus, reason, physicalDisposalAllowed: false,
    }),
  } });
  await tx.activityEvent.create({ data: {
    userId: input.actorId, projectId: inspected.item.projectId, type: "disposition_reviewed", entityType: "library",
    entityId: input.itemId, title: "Library disposition governance decision",
    message: input.action, metadata: JSON.stringify({ requestId: request.id, action: input.action,
      decisionRevision: nextRevision, status: nextStatus, physicalDisposalAllowed: false }),
  } });
  return { requestId: request.id, status: nextStatus, decisionRevision: nextRevision,
    approvalCount: nextApprovers.length, requiredApprovers: LIBRARY_DISPOSITION_REQUIRED_APPROVERS,
    approvalValidNow: nextStatus === "REVIEW_APPROVED" && inspected.blockers.length === 0
      && inspected.fingerprint === request.snapshotSha256, physicalDisposalAllowed: false };
}
