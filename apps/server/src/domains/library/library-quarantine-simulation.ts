import { createHash, randomUUID } from "node:crypto";
import { inspectLibraryStorageOwnership } from "./library-disposition-ownership.js";
import { LibraryDispositionError, reviewLibraryDisposition } from "./library-disposition.js";

/** R67 is a simulation-only checkpoint. No storage provider, job runner, or
 * filesystem mutator consumes these records. Quarantine requires a separate,
 * future, provider-fenced implementation and its own authorization protocol. */
export const LIBRARY_QUARANTINE_PLAN_VERSION = 1;
export const LIBRARY_QUARANTINE_PLAN_TTL_MS = 15 * 60_000;

export function libraryQuarantineSimulation(input: { review: any; ownership: any; now?: Date }) {
  const now = input.now || new Date();
  const request = input.review?.request;
  const blockers = new Set<string>(input.ownership?.blockers || []);
  if (!request) blockers.add("NO_ACTIVE_DISPOSITION_REQUEST");
  if (request?.status !== "REVIEW_APPROVED") blockers.add("INDEPENDENT_REVIEW_INCOMPLETE");
  if (!input.review?.approvalValidNow) blockers.add("GOVERNANCE_EVIDENCE_NOT_CURRENT");
  if (!input.ownership?.databaseInventoryComplete) blockers.add("INCOMPLETE_DATABASE_OWNERSHIP");
  if (!input.ownership?.providerInventoryComplete) blockers.add("PROVIDER_GENERATION_UNVERIFIED");
  // Explicit non-overridable gates. An empty blocker list MUST NOT confer a
  // capability, since generations, backup expiry and active writes are unfenced.
  blockers.add("NO_ATOMIC_PROVIDER_QUARANTINE_ADAPTER");
  blockers.add("BACKUP_AND_ACTIVE_WRITER_FENCES_UNCERTIFIED");
  const evidence = {
    version: LIBRARY_QUARANTINE_PLAN_VERSION,
    requestId: request?.id || null,
    itemId: input.ownership?.itemId || null,
    decisionRevision: request?.decisionRevision ?? null,
    governanceSnapshotSha256: request?.snapshotSha256 || null,
    ownershipFingerprint: input.ownership?.fingerprint || null,
    relatedStorageFingerprint: input.ownership?.relatedAuthority?.fingerprint || null,
    pointerCount: input.ownership?.objects?.length ?? null,
    scannedReferences: input.ownership?.ownerRecordsScanned ?? null,
    blockers: [...blockers].sort(),
    providerMutationsAllowed: false,
  };
  return {
    ...evidence,
    fingerprint: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    expiresAt: new Date(now.getTime() + LIBRARY_QUARANTINE_PLAN_TTL_MS),
    mode: "SIMULATION_ONLY" as const,
    quarantineAllowed: false as const,
    physicalDisposalAllowed: false as const,
  };
}

export async function inspectLibraryQuarantineSimulation(input: {
  prisma: any; itemId: string; libraryRoot: string; now?: Date;
}) {
  const review = await reviewLibraryDisposition(input.prisma, input.itemId, input.now);
  const ownership = await inspectLibraryStorageOwnership({
    prisma: input.prisma, itemId: input.itemId, libraryRoot: input.libraryRoot,
  });
  return libraryQuarantineSimulation({ review, ownership, now: input.now });
}

/** Capture an audit-only simulation. The snapshot remains untrusted for later
 * execution, even if still within its 15-minute informational TTL. Caller
 * supplies a SERIALIZABLE transaction and authenticates the administrator. */
export async function recordLibraryQuarantineSimulation(tx: any, input: {
  itemId: string; actorId: string; planKey: string; reason: string;
  expectedDecisionRevision: number; simulation: ReturnType<typeof libraryQuarantineSimulation>;
  now?: Date;
}) {
  const now = input.now || new Date();
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 1000)
    throw new LibraryDispositionError("QUARANTINE_REASON_REQUIRED", "A simulation reason between 12 and 1,000 characters is required.");
  if (input.simulation.itemId !== input.itemId || input.simulation.mode !== "SIMULATION_ONLY" ||
      input.simulation.quarantineAllowed !== false || input.simulation.physicalDisposalAllowed !== false ||
      input.simulation.expiresAt <= now)
    throw new LibraryDispositionError("QUARANTINE_SIMULATION_INVALID", "The inspection is expired or does not match the Library item.");
  const prior = await tx.libraryQuarantinePlan.findUnique({ where: { planKey: input.planKey } });
  if (prior) {
    if (prior.actorId !== input.actorId || prior.itemId !== input.itemId || prior.reason !== reason)
      throw new LibraryDispositionError("QUARANTINE_IDEMPOTENCY_CONFLICT", "This simulation key belongs to another request.");
    return { plan: prior, replay: true };
  }
  const review = await reviewLibraryDisposition(tx, input.itemId, now);
  if (!review?.approvalValidNow || review?.request?.status !== "REVIEW_APPROVED")
    throw new LibraryDispositionError("QUARANTINE_GOVERNANCE_NOT_APPROVED", "Two valid independent approvals are required for an audit simulation.");
  if (review.request.id !== input.simulation.requestId ||
      review.request.snapshotSha256 !== input.simulation.governanceSnapshotSha256 ||
      review.request.decisionRevision !== input.expectedDecisionRevision ||
      review.request.decisionRevision !== input.simulation.decisionRevision)
    throw new LibraryDispositionError("QUARANTINE_REVIEW_STALE", "The governance decision changed during inspection.");
  const plan = await tx.libraryQuarantinePlan.create({ data: {
    id: randomUUID(), requestId: review.request.id, itemId: input.itemId,
    actorId: input.actorId, reason, planKey: input.planKey,
    planVersion: LIBRARY_QUARANTINE_PLAN_VERSION,
    snapshotSha256: input.simulation.fingerprint,
    snapshotJson: JSON.stringify(input.simulation),
    decisionRevision: input.expectedDecisionRevision,
    recordedAt: now, expiresAt: input.simulation.expiresAt,
  } });
  await tx.libraryQuarantineJournal.create({ data: {
    id: randomUUID(), planId: plan.id, actorId: input.actorId,
    eventType: "SIMULATED", occurredAt: now,
    detailsJson: JSON.stringify({ reason, snapshotSha256: plan.snapshotSha256,
      blockers: input.simulation.blockers, storageMutations: 0 }),
  } });
  return { plan, replay: false };
}

/** Withdrawal appends evidence without editing or deleting the original plan. */
export async function withdrawLibraryQuarantineSimulation(tx: any, input: {
  itemId: string; planId: string; actorId: string; reason: string; now?: Date;
}) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 1000)
    throw new LibraryDispositionError("QUARANTINE_WITHDRAW_REASON_REQUIRED", "A withdrawal reason between 12 and 1,000 characters is required.");
  const plan = await tx.libraryQuarantinePlan.findUnique({ where: { id: input.planId } });
  if (!plan || plan.itemId !== input.itemId)
    throw new LibraryDispositionError("QUARANTINE_PLAN_NOT_FOUND", "No matching simulation exists.");
  const previous = await tx.libraryQuarantineJournal.findFirst({ where: { planId: input.planId, eventType: "WITHDRAWN" } });
  if (previous) return { withdrawn: true, replay: true };
  await tx.libraryQuarantineJournal.create({ data: {
    id: randomUUID(), planId: plan.id, actorId: input.actorId,
    eventType: "WITHDRAWN", occurredAt: input.now || new Date(),
    detailsJson: JSON.stringify({ reason, storageMutations: 0 }),
  } });
  return { withdrawn: true, replay: false };
}
