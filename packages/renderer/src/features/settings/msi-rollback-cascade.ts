import type { ClusterNativeMSIRollbackCascade } from "../../core/desktop";

const keyPattern = /^[a-z][a-z0-9-]{2,79}$/;
const shaPattern = /^[a-f0-9]{64}$/;

export function validMSIRollbackCascade(value: unknown, key: string): value is ClusterNativeMSIRollbackCascade {
  if (!value || typeof value !== "object" || !keyPattern.test(key)) return false;
  const x = value as Record<string, unknown>;
  if (x.schema !== 1 || x.packageKey !== key || !["blocked", "independent_dispositions_required"].includes(String(x.state)) ||
      x.readOnly !== true || x.osAttested !== false || x.mutationAuthorized !== false || x.automaticExecution !== false ||
      typeof x.priorReceiptSha256 !== "string" || !shaPattern.test(x.priorReceiptSha256) ||
      typeof x.upgradeJournalSha256 !== "string" || !shaPattern.test(x.upgradeJournalSha256) ||
      !Array.isArray(x.recoveryOrder) || !Array.isArray(x.steps) || !Array.isArray(x.blockers) || !Array.isArray(x.warnings) ||
      !Array.isArray(x.manualReviewPackages) || typeof x.manualRecoveryRequired !== "boolean" ||
      typeof x.nextReviewablePackageKey !== "string" ||
      x.recoveryOrder.length === 0 || x.recoveryOrder.length > 64 || x.steps.length !== x.recoveryOrder.length ||
      x.recoveryOrder.at(-1) !== key || x.warnings.length < 3 || x.warnings.length > 12 ||
      !x.warnings.every((s: unknown) => typeof s === "string" && s.length > 0)) return false;
  const recoveryOrder = x.recoveryOrder as string[];
  const seen = new Set<string>();
  const derivedBlockers: string[] = [];
  let allPriorSettled = true;
  const manualReviewPackages: string[] = [];
  let nextReviewable = "";
  for (let i = 0; i < x.steps.length; i++) {
    const packageKey = (x.recoveryOrder as string[])[i];
    const step = x.steps[i] as Record<string, unknown> | null;
    if (typeof packageKey !== "string" || !keyPattern.test(packageKey) || seen.has(packageKey) ||
        !step || typeof step !== "object" || step.index !== i || step.packageKey !== packageKey ||
        step.operation !== (i === x.steps.length - 1 ? "msi-rollback" : "uninstall") ||
        typeof step.recordedReceiptSha256 !== "string" || !shaPattern.test(step.recordedReceiptSha256) ||
        step.separateAuthorizationRequired !== true || step.mutationAuthorized !== false || typeof step.dispositionObserved !== "boolean" ||
        (step.dispositionObserved && (i === x.steps.length - 1 || (Array.isArray(step.blockers) && step.blockers.length > 0))) ||
        !Array.isArray(step.waitingFor) || step.waitingFor.length !== i ||
        !step.waitingFor.every((entry: unknown, j: number) => entry === recoveryOrder[j]) ||
        !Array.isArray(step.blockers) || !step.blockers.every((s: unknown) => typeof s === "string" && s.length > 0) ||
        typeof step.lifecycleJournalSha256 !== "string" || typeof step.lifecycleJournalState !== "string" ||
        (step.lifecycleJournalSha256 === "" ? step.lifecycleJournalState !== "not_recorded" :
          !shaPattern.test(step.lifecycleJournalSha256) || !["uninstall_prepared_not_launched", "uninstall_started_outcome_unknown",
          "uninstall_failed_or_outcome_unknown", "uninstall_exit_zero_not_os_attested",
          "uninstall_restart_required_not_os_attested"].includes(step.lifecycleJournalState)) ||
        (i === x.steps.length - 1 && (step.lifecycleJournalSha256 !== "" || step.lifecycleJournalState !== "not_recorded")) ||
        (step.dispositionObserved && step.lifecycleJournalState !== "uninstall_exit_zero_not_os_attested") ||
        (step.lifecycleJournalSha256 !== "" && !step.dispositionObserved && !step.blockers.includes("dependent_lifecycle_outcome_unconfirmed"))) return false;
    const blocked = step.blockers.length > 0;
    const expected = step.dispositionObserved ? "observed_uninstall_registration_absent" : blocked ? "blocked" :
      allPriorSettled ? "independent_operator_review_required" : "awaiting_prior_dispositions";
    if (step.state !== expected) return false;
    const action = step.dispositionObserved ? "preserve_completed_disposition" :
      blocked ? (step.lifecycleJournalSha256 !== "" ? "manual_recovery_no_replay" : "resolve_evidence_blocker") :
      allPriorSettled ? "request_independent_authorization" : "wait_for_independent_dispositions";
    if (step.recoveryAction !== action) return false;
    if (step.lifecycleJournalSha256 !== "" && !step.dispositionObserved) manualReviewPackages.push(packageKey);
    if (expected === "independent_operator_review_required") {
      if (nextReviewable !== "") return false;
      nextReviewable = packageKey;
    }
    if (blocked) derivedBlockers.push(`${packageKey}:review_blocked`);
    if (i < x.steps.length - 1 && !step.dispositionObserved) allPriorSettled = false;
    seen.add(packageKey);
  }
  return x.manualRecoveryRequired === (manualReviewPackages.length > 0) &&
    x.manualReviewPackages.length === manualReviewPackages.length &&
    x.manualReviewPackages.every((p: unknown, i: number) => p === manualReviewPackages[i]) &&
    x.nextReviewablePackageKey === nextReviewable &&
    x.blockers.length === derivedBlockers.length &&
    derivedBlockers.every((b, i) => (x.blockers as string[])[i] === b) &&
    (x.state === "blocked") === (derivedBlockers.length > 0);
}
