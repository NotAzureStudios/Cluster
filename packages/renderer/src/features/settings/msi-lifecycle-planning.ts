// Pure projection of verified native MSI profile receipts. Deliberately never
// constructs a grant or returns an executable lifecycle operation.
import type { ClusterNativeMSIProfileStatus, ClusterNativeMSILifecyclePlan } from "../../core/desktop";

export const lifecycleOperations = ["upgrade", "repair", "uninstall"] as const;
export const lifecycleWarnings = [
  "unknown_external_dependents_not_excluded", "installed_application_health_unverified",
  "independent_lifecycle_authority_not_implemented",
] as const;

export function expectedMSILifecyclePlans(profile: Pick<ClusterNativeMSIProfileStatus, "records" | "dependencyEdges" | "admissionLockPresent" | "lifecycleRecords">): ClusterNativeMSILifecyclePlan[] {
  const dependents = new Map<string, string[]>();
  const changed = new Set<string>();
  for (const edge of profile.dependencyEdges) {
    if (profile.records.some((rec) => rec.packageKey === edge.dependencyPackageKey)) {
      dependents.set(edge.dependencyPackageKey, [...(dependents.get(edge.dependencyPackageKey) || []), edge.dependentPackageKey]);
    }
    if (!edge.recordedReceiptMatches) {
      changed.add(edge.dependentPackageKey); changed.add(edge.dependencyPackageKey);
    }
  }
  return profile.records.flatMap((record) => lifecycleOperations.map((operation) => {
    const knownDependents = [...new Set(dependents.get(record.packageKey) || [])].sort();
    const blockers: string[] = [];
    if (profile.admissionLockPresent || record.admissionLockPresent) blockers.push("profile_installation_lock_present");
    if (record.lockPresent && !record.admissionLockPresent) blockers.push("package_operation_lock_present");
    if (!record.hasReceipt || !record.attempt || !/^[a-f0-9]{64}$/.test(record.receiptSha256 || "")) {
      blockers.push("trusted_installation_receipt_missing");
    } else {
      if (!["msi_exit_zero_not_os_attested", "msi_restart_required_not_os_attested"].includes(record.state)) blockers.push("installation_attempt_unresolved");
      if (!record.attempt.preLaunchRegistration || !record.attempt.postExitRegistration) blockers.push("registration_transition_unavailable");
    }
    if (!record.product || record.product.state !== "registered_version_match" || !record.product.versionMatches
      || !record.product.probeComplete || record.product.probeScope !== "current_user_and_machine"
      || record.registrationDrift !== "registration_unchanged_since_exit") blockers.push("exact_windows_registration_not_verified");
    if (changed.has(record.packageKey)) blockers.push("recorded_prerequisite_evidence_changed");
    if (knownDependents.length) blockers.push("known_dependent_packages_present");
    if (profile.lifecycleRecords.some((item) => item.packageKey === record.packageKey)) blockers.push("prior_lifecycle_operation_recorded");
    return { schema: 1 as const, packageKey: record.packageKey, operation,
      state: blockers.length ? "blocked" as const : "requires_operator_review" as const,
      readOnly: true as const, osAttested: false as const, mutationAuthorized: false as const,
      ...(record.hasReceipt ? { recordedReceiptSha256: record.receiptSha256 } : {}),
      knownDependents, blockers, warnings: [...lifecycleWarnings] };
  }));
}

export function validateMSILifecyclePlans(profile: ClusterNativeMSIProfileStatus): void {
  if (!Array.isArray(profile.lifecyclePlans) || profile.lifecyclePlans.length > 192) {
    throw new Error("Native MSI lifecycle review is incomplete; no operation is authorized.");
  }
  const wanted = expectedMSILifecyclePlans(profile);
  if (wanted.length !== profile.lifecyclePlans.length) {
    throw new Error("Native MSI lifecycle review disagrees with inventory receipts.");
  }
  for (let i = 0; i < wanted.length; i++) {
    const a = profile.lifecyclePlans[i], b = wanted[i];
    if (!a || a.schema !== 1 || a.packageKey !== b.packageKey || a.operation !== b.operation
      || a.state !== b.state || a.readOnly !== true || a.osAttested !== false || a.mutationAuthorized !== false
      || a.recordedReceiptSha256 !== b.recordedReceiptSha256
      || !Array.isArray(a.blockers) || a.blockers.join("|") !== b.blockers.join("|")
      || !Array.isArray(a.knownDependents) || a.knownDependents.join("|") !== b.knownDependents.join("|")
      || !Array.isArray(a.warnings) || a.warnings.join("|") !== b.warnings.join("|")) {
      throw new Error("Native MSI lifecycle evidence is inconsistent; no operation is authorized.");
    }
  }
}
