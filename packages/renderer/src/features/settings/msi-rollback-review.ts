import type { ClusterNativeMSIRollbackReview } from "../../core/desktop";

// Independent renderer validation for the native read-only rollback decision.
// This is not an authorization to execute a downgrade or remove dependents.
export function validMSIRollbackReview(value: unknown, packageKey: string): value is ClusterNativeMSIRollbackReview {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ClusterNativeMSIRollbackReview>;
  const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const version = (v: unknown) => typeof v === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v);
  const key = (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9-]{2,79}$/.test(v);
  if (item.schema !== 1 || item.packageKey !== packageKey || !key(packageKey) ||
    (item.state !== "blocked" && item.state !== "reviewable_not_authorized") ||
    item.readOnly !== true || item.osAttested !== false || item.mutationAuthorized !== false || item.rollbackAuthorized !== false ||
    !digest(item.priorReceiptSha256) || !digest(item.upgradeJournalSha256) || !digest(item.predecessorMsiSha256) || !digest(item.successorMsiSha256) ||
    !version(item.predecessorProductVersion) || !version(item.successorProductVersion) ||
    !Array.isArray(item.blockers) || !Array.isArray(item.warnings) || !Array.isArray(item.knownDependents) || !Array.isArray(item.settledDependents) || !Array.isArray(item.outstandingDependents) || !Array.isArray(item.recoveryOrder) ||
    !item.warnings.length || item.warnings.length > 12 || item.blockers.length > 64 || item.recoveryOrder.length > 64 ||
    item.knownDependents.length !== item.recoveryOrder.length - 1 ||
    item.settledDependents.length + item.outstandingDependents.length !== item.knownDependents.length ||
    item.recoveryOrder[item.recoveryOrder.length - 1] !== packageKey ||
    item.blockers.some((s) => typeof s !== "string" || !/^[a-z][a-z0-9_]{2,100}$/.test(s)) ||
    item.warnings.some((s) => typeof s !== "string" || !/^[a-z][a-z0-9_]{2,100}$/.test(s)) ||
    item.recoveryOrder.some((s) => !key(s)) ||
    new Set(item.recoveryOrder).size !== item.recoveryOrder.length ||
    item.knownDependents.some((s, i) => s !== item.recoveryOrder![i])) return false;
  if ((item.state === "reviewable_not_authorized") !== (item.blockers.length === 0)) return false;
  if (item.state === "reviewable_not_authorized" && item.outstandingDependents.length !== 0) return false;
  let settled = 0, outstanding = 0;
  for (const k of item.knownDependents) {
    if (item.settledDependents[settled] === k) settled++;
    else if (item.outstandingDependents[outstanding] === k) outstanding++;
    else return false;
  }
  if (settled !== item.settledDependents.length || outstanding !== item.outstandingDependents.length) return false;
  // The native decision may be reviewable only for an upgrade predecessor.
  const a = item.predecessorProductVersion.split(".").map(Number);
  const b = item.successorProductVersion.split(".").map(Number);
  return a[0] === b[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2]));
}
