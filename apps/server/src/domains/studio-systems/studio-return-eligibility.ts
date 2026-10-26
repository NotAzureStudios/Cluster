/** Return-to-studio is identity recovery, never restoration of previous grants. */
export class StudioReturnError extends Error {
  constructor(public code: string, message: string, public statusCode = 409) { super(message); this.name = "StudioReturnError"; }
}
export function requireReturnEligible(input: {
  caseRow: any; subject: any; latestCompletedCaseId: string | null;
  activeCaseCount: number; expectedRevision?: number;
}) {
  const { caseRow, subject, latestCompletedCaseId, activeCaseCount, expectedRevision } = input;
  if (!caseRow || caseRow.status !== "completed" || !caseRow.completedAt)
    throw new StudioReturnError("RETURN_CASE_NOT_COMPLETED", "Only a completed offboarding case can be returned.");
  if (caseRow.returnedAt)
    throw new StudioReturnError("RETURN_ALREADY_COMPLETED", "This offboarding case already has a completed return.");
  if (expectedRevision !== undefined && caseRow.revision !== expectedRevision)
    throw new StudioReturnError("RETURN_CASE_STALE", "The case changed. Refresh its return preview.");
  if (latestCompletedCaseId !== caseRow.id)
    throw new StudioReturnError("RETURN_NOT_LATEST_CASE", "A newer offboarding case exists for this person.");
  if (activeCaseCount)
    throw new StudioReturnError("RETURN_ACTIVE_OFFBOARDING", "A planned or active offboarding case must be resolved first.");
  if (!subject || subject.accountState === "PRIVACY_ERASED")
    throw new StudioReturnError("RETURN_IDENTITY_UNAVAILABLE", "This identity cannot be restored.");
  if (!subject.archived || subject.accountState !== "DISABLED")
    throw new StudioReturnError("RETURN_ACCOUNT_STATE_CHANGED", "This person's account is no longer in its completed offboarding state.");
  return true;
}
export function validateReturnAccessWindow(accountType: string, expiresAt: Date | null, now = new Date()) {
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now))
    throw new StudioReturnError("RETURN_EXPIRY_INVALID", "New access expiration must be in the future.", 400);
  if (["contractor", "guest", "client"].includes(accountType) && !expiresAt)
    throw new StudioReturnError("RETURN_EXPIRY_REQUIRED", "Temporary and external accounts require an explicit access expiration.", 400);
}
