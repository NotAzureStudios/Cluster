import { projectDevicePackageTargets } from "./managed-package-device.js";

export type PackageReconciliationStatus = "not_targeted" | "no_report" | "offer_pending" | "reported_in_progress"
  | "reported_selected" | "reported_failure" | "reported_rollback" | "different_release_reported";

export type PackageReconciliationInput = {
  pkg: any;
  policy: any | null;
  pins: any[];
  releases: any[];
  signingKeys: any[];
  registrations: any[];
  entitledUserIds?: string[];
  deployments: any[];
  channel: string;
  platform: string;
};

/** Device diagnostics only. A claim of `content_selected` is NOT
 * attested OS installation. All decisions must use the same signed target
 * resolver as actual device downloads, not just a rollout percentage. */
export function projectPackageReconciliation(input: PackageReconciliationInput) {
  const pinsByDevice = new Map<string, any>();
  for (const pin of input.pins) if (pin.active) pinsByDevice.set(pin.deviceId, pin);
  const lastReport = new Map<string, any>();
  // Callers pass newest-first, capped evidence. Absence means NO OBSERVED
  // REPORT IN THE SAMPLE, not that a device never downloaded anything.
  for (const entry of input.deployments) if (!lastReport.has(entry.deviceRegistrationId))
    lastReport.set(entry.deviceRegistrationId, entry);

  const counts: Record<PackageReconciliationStatus, number> = {
    not_targeted: 0, no_report: 0, offer_pending: 0, reported_in_progress: 0,
    reported_selected: 0, reported_failure: 0, reported_rollback: 0, different_release_reported: 0,
  };
  const eligibleUsers = new Set(input.entitledUserIds || []);
  const devices = input.registrations.map((registration) => {
    const target = (eligibleUsers.has(registration.userId) ? projectDevicePackageTargets({
      packages: [input.pkg], policies: input.policy ? [input.policy] : [],
      pins: pinsByDevice.has(registration.id) ? [pinsByDevice.get(registration.id)] : [],
      releases: input.releases, signingKeys: input.signingKeys,
    }, { deviceRegistrationId: registration.id, platform: input.platform, channel: input.channel })[0] : null) || null;
    const report = lastReport.get(registration.id) || null;
    let status: PackageReconciliationStatus;
    if (!target) status = "not_targeted";
    else if (!report) status = "no_report";
    else if (report.releaseId !== target.release.id) status = "different_release_reported";
    else if (report.state === "offered") status = "offer_pending";
    else if (report.state === "failed") status = "reported_failure";
    else if (report.state === "rolled_back") status = "reported_rollback";
    else if (report.state === "content_selected") status = "reported_selected";
    else status = "reported_in_progress";
    counts[status]++;
    return {
      registrationId: registration.id, userId: registration.userId,
      label: registration.label || null, lastSeenAt: registration.lastSeenAt,
      target: target ? { releaseId: target.release.id, version: target.release.version,
        selection: target.selection, artifactSha256: target.release.artifactSha256 } : null,
      latestObserved: report ? { releaseId: report.releaseId, state: report.state,
        lastReportedAt: report.lastReportedAt, offeredAt: report.offeredAt } : null,
      status, evidence: "device_report", osAttested: false, installerCertified: false,
    };
  });
  return { devices, counts, evidence: "device_report", osAttested: false, installerCertified: false };
}
