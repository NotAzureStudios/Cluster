// Desktop must never convert MSI process results or registration observations
// into confirmation of rollback or authority to retry. Separate from readiness.
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(value);
const key = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{2,79}$/.test(value);
const product = (value: unknown): value is string => typeof value === "string" && /^\{[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}\}$/.test(value);
const states = new Set(["msi-rollback_prepared_not_launched", "msi-rollback_started_outcome_unknown", "msi-rollback_failed_or_outcome_unknown", "msi-rollback_exit_zero_not_os_attested", "msi-rollback_restart_required_not_os_attested"]);
export function validMSIRollbackJournal(report: any, expectedKey: string): boolean {
  if (!report || report.schema !== 1 || !key(expectedKey) || report.packageKey !== expectedKey ||
    report.readOnly !== true || report.osAttested !== false || report.retryAuthorized !== false ||
    typeof report.hasReceipt !== "boolean" || report.manualReviewRequired !== report.hasReceipt) return false;
  if (!report.hasReceipt) return report.state === "no_recorded_msi-rollback" && report.receipt === undefined && report.receiptSha256 === undefined && report.rollbackRecovery === undefined;
  const r = report.receipt;
  const observed = report.rollbackRecovery;
  const p = observed?.registration;
  if (!r || !observed || !p || !states.has(report.state) || !sha(report.receiptSha256) ||
    r.schema !== 1 || r.operation !== "msi-rollback" || r.packageKey !== expectedKey || r.state !== report.state ||
    r.osAttested !== false || !sha(r.priorReceiptSha256) || !sha(r.priorMsiSha256) || !sha(r.upgradeJournalSha256) ||
    !sha(r.successorMsiSha256) || !sha(r.artifactSha256) || !sha(r.msiSha256) || r.msiSha256 !== r.priorMsiSha256 ||
    !version(r.productVersion) || !version(r.priorProductVersion) || r.productVersion === r.priorProductVersion ||
    !product(r.productCode) || typeof r.msiPath !== "string" || r.msiPath.startsWith("/") || r.msiPath.split("/").some((part: string) => part === ".." || part === ".") ||
    !/^[A-Za-z0-9_./-]+\.msi$/.test(r.msiPath) || observed.readOnly !== true || observed.osAttested !== false ||
    observed.rollbackConfirmed !== false || p.productCode !== r.productCode || p.expectedVersion !== r.productVersion ||
    p.readOnly !== true || p.osAttested !== false || typeof p.probeComplete !== "boolean" || typeof p.versionMatches !== "boolean") return false;
  if (!p.probeComplete) return observed.state === "rollback_registration_unavailable" && p.versionMatches === false;
  if (p.probeScope !== "current_user_and_machine") return false;
  if (p.state === "registered_version_match")
    return observed.state === "rollback_predecessor_registered_not_health_attested" && p.reportedVersion === r.productVersion && p.versionMatches === true;
  if (p.state === "registered_version_mismatch" && p.versionMatches === false && version(p.reportedVersion))
    return p.reportedVersion === r.priorProductVersion ? observed.state === "rollback_successor_remains_registered"
      : p.reportedVersion !== r.productVersion && observed.state === "rollback_unexpected_version_registered";
  if (p.state === "not_registered_for_user")
    return observed.state === "rollback_product_not_registered" && p.reportedVersion === "" && p.versionMatches === false;
  return observed.state === "rollback_registration_ambiguous";
}
