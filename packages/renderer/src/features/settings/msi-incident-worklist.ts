import type { ClusterNativeMSIIncidentWorklist } from "../../core/desktop";

// A native, non-authorizing recovery inventory. Trust neither the serialization
// nor the suggestion to retry an MSI: a journal always requires separate review.
const key = /^[a-z][a-z0-9-]{2,79}$/;
const digest = /^[a-f0-9]{64}$/;
const operations = new Set(["repair", "uninstall", "upgrade", "msi-rollback"]);
const registrationStates = new Set(["unavailable", "os_query_unavailable", "not_registered_for_user",
  "registered_version_match", "registered_version_mismatch", "registered_version_unavailable",
  "advertised_not_verified", "registration_incomplete_or_unknown"]);
const pure = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input);

export function validMSIIncidentWorklist(input: unknown): input is ClusterNativeMSIIncidentWorklist {
  if (!pure(input) || input.schema !== 1 || input.readOnly !== true || input.complete !== true ||
      input.osAttested !== false || input.mutationAuthorized !== false || input.retryAuthorized !== false ||
      typeof input.admissionLockPresent !== "boolean" || !Array.isArray(input.items) || input.items.length > 128 ||
      !Number.isSafeInteger(input.manualRecoveryCount) || !Number.isSafeInteger(input.reviewCount) ||
      !Number.isSafeInteger(input.observationCount)) return false;
  let previous = "", manual = 0, review = 0, observation = 0;
  for (const entry of input.items) {
    if (!pure(entry) || typeof entry.packageKey !== "string" || !key.test(entry.packageKey) ||
        typeof entry.caseId !== "string" || entry.caseId <= previous ||
        typeof entry.state !== "string" || !entry.state || typeof entry.registrationState !== "string" ||
        !registrationStates.has(entry.registrationState) || typeof entry.receiptSha256 !== "string" || typeof entry.priorReceiptSha256 !== "string" ||
        entry.readOnly !== true || entry.retryAuthorized !== false || entry.mutationAuthorized !== false ||
        entry.osAttested !== false || typeof entry.predecessorRecorded !== "boolean" ||
        typeof entry.predecessorMatches !== "boolean" || (entry.predecessorMatches && !entry.predecessorRecorded)) return false;
    if (entry.operation === "install") {
      if (entry.caseId !== `attempt:${entry.packageKey}` || entry.priorReceiptSha256 !== "" ||
          entry.predecessorRecorded || entry.predecessorMatches ||
          !(entry.receiptSha256 === "" || typeof entry.receiptSha256 === "string" && digest.test(entry.receiptSha256)) ||
          !["review", "manual_recovery"].includes(String(entry.severity)) ||
          entry.recoveryAction !== (entry.severity === "review" ? "review_unattested_installation" : "investigate_install_attempt_no_replay")) return false;
    } else if (operations.has(String(entry.operation))) {
      if (entry.caseId !== `lifecycle:${entry.packageKey}:${entry.operation}` ||
          typeof entry.receiptSha256 !== "string" || !digest.test(entry.receiptSha256) ||
          typeof entry.priorReceiptSha256 !== "string" || !digest.test(entry.priorReceiptSha256) ||
          entry.severity !== "manual_recovery" || entry.recoveryAction !== (entry.predecessorMatches ?
            "manual_lifecycle_review_no_replay" : "investigate_missing_or_changed_predecessor")) return false;
    } else return false;
    if (entry.severity === "manual_recovery") manual++;
    else if (entry.severity === "review") review++;
    else observation++;
    previous = entry.caseId;
  }
  const state = manual > 0 || input.admissionLockPresent ? "manual_recovery_required" : review > 0 ? "review_required" : "empty";
  return input.state === state && input.manualRecoveryCount === manual && input.reviewCount === review &&
    input.observationCount === observation;
}
