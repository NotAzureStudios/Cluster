/** G26: A review decision belongs to one immutable review asset/version and one server actor. */
export type ReviewDecisionInput = {
  decision: "approved" | "changes";
  expectedVersionNumber: number;
  expectedUpdatedAt: string;
  reason?: string | null;
};

export function reviewDecisionEligibility(
  asset: { versionNumber: number; updatedAt: Date | string; reviewerId?: string | null; supersededById?: string | null; status?: string | null; approvalState?: string | null },
  input: ReviewDecisionInput,
  actorId: string,
  canManage: boolean,
): { ok: true } | { ok: false; code: string; message: string; status: number } {
  if (input.decision === "changes" && !String(input.reason || "").trim())
    return { ok: false, code: "REVIEW_REASON_REQUIRED", message: "Explain the requested changes before recording this decision.", status: 400 };
  if (!canManage && (!asset.reviewerId || asset.reviewerId !== actorId))
    return { ok: false, code: "REVIEW_DECISION_NOT_ASSIGNED", message: "Only the assigned reviewer or an authorized review manager can decide this version.", status: 403 };
  if (asset.status === "archived" || asset.supersededById || asset.approvalState === "superseded")
    return { ok: false, code: "REVIEW_VERSION_SUPERSEDED", message: "This review version is no longer current. Open the latest version.", status: 409 };
  if (asset.versionNumber !== input.expectedVersionNumber || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) ||
      new Date(asset.updatedAt).getTime() !== Date.parse(input.expectedUpdatedAt))
    return { ok: false, code: "REVIEW_DECISION_STALE", message: "This review version changed. Reload it before deciding.", status: 409 };
  return { ok: true };
}

export function reviewDecisionGuard(asset: {
  id: string; versionNumber: number; updatedAt: Date | string; reviewerId?: string | null; supersededById?: string | null; approvalState?: string | null;
}) {
  return {
    id: asset.id,
    versionNumber: asset.versionNumber,
    updatedAt: new Date(asset.updatedAt),
    reviewerId: asset.reviewerId || null,
    supersededById: null,
    approvalState: { not: "superseded" },
    status: { not: "archived" },
  };
}
