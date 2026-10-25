// Independent browser-side coherence check for the Go/Qt read-only report.
// A valid observation does NOT authorize retry, rollback or app-health claims.
export function validUpgradeRecoveryEvidence(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const entry = status as Record<string, unknown>;
  const receipt = entry.receipt as Record<string, unknown> | undefined;
  if (!receipt || receipt.operation !== "upgrade") return entry.upgradeRecovery === undefined;
  const recovery = entry.upgradeRecovery as Record<string, unknown> | undefined;
  if (!recovery || typeof recovery !== "object" || recovery.readOnly !== true || recovery.osAttested !== false
    || recovery.rollbackAuthorized !== false) return false;
  const registration = recovery.registration as Record<string, unknown> | undefined;
  if (!registration || registration.productCode !== receipt.productCode
    || registration.expectedVersion !== receipt.productVersion || registration.readOnly !== true
    || registration.osAttested !== false || typeof registration.probeComplete !== "boolean"
    || typeof registration.versionMatches !== "boolean") return false;
  if (!registration.probeComplete) return recovery.state === "upgrade_registration_unavailable"
    && registration.versionMatches === false;
  if (registration.probeScope !== "current_user_and_machine") return false;
  const observed = registration.state;
  const reported = registration.reportedVersion ?? "";
  if (observed === "registered_version_match") return recovery.state === "upgrade_target_registered_not_health_attested"
    && registration.versionMatches === true && reported === receipt.productVersion;
  if (observed === "registered_version_mismatch" && registration.versionMatches === false) {
    if (reported === receipt.priorProductVersion) return recovery.state === "upgrade_predecessor_remains_registered";
    return typeof reported === "string" && /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(reported)
      && reported !== receipt.productVersion && recovery.state === "upgrade_unexpected_version_registered";
  }
  if (observed === "not_registered_for_user") return registration.versionMatches === false
    && reported === "" && recovery.state === "upgrade_product_not_registered";
  return recovery.state === "upgrade_registration_ambiguous";
}
