/**
 * Short-lived, in-memory Package offer receipt. Never embed this challenge in a
 * staging kit, persisted state, Qt capability payload or diagnostic event.
 * A report means "the registered Desktop client observed its native helper";
 * it is not a privileged OS installation attestation.
 */
export type PackageStageReceiptLease = {
  deploymentId: string;
  challenge: string;
  artifactSha256: string;
  packageKey: string;
  version: string;
  issuedAt: number;
};

export type NativeStageEvidence = {
  state: string;
  artifactSha256?: string;
  packageKey?: string;
  version?: string;
  evidence?: string;
};

export function readPackageStageReceiptLease(headers: Pick<Headers, "get">,
  target: { artifactSha256: string; packageKey: string; version: string }, now = Date.now()): PackageStageReceiptLease | null {
  const deploymentId = headers.get("x-cluster-package-deployment-id") || "";
  const challenge = headers.get("x-cluster-package-receipt-challenge") || "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(deploymentId) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    || !/^[a-f0-9]{64}$/.test(target.artifactSha256)) return null;
  return { deploymentId, challenge, artifactSha256: target.artifactSha256,
    packageKey: target.packageKey, version: target.version, issuedAt: now };
}

export function verifiedStageMatchesLease(lease: PackageStageReceiptLease | null,
  evidence: NativeStageEvidence, now = Date.now()): lease is PackageStageReceiptLease {
  return !!lease && now >= lease.issuedAt && now - lease.issuedAt < 9 * 60_000
    && evidence.state === "staged_not_installed" && evidence.evidence === "native_helper_self_report"
    && evidence.artifactSha256 === lease.artifactSha256
    && evidence.packageKey === lease.packageKey && evidence.version === lease.version;
}

export async function reportNativePackageStage(lease: PackageStageReceiptLease,
  post: (deploymentId: string, body: Record<string, unknown>) => Promise<{ revision: number; nextChallenge: string }>) {
  let challenge = lease.challenge;
  // Both states are observed after successful native verification/staging.
  // The server revalidates current device registration and Package entitlement
  // on EACH transition, and consumes a one-time challenge transactionally.
  for (const [revision, state] of ["artifact_verified", "staged"].entries()) {
    const result = await post(lease.deploymentId, {
      eventId: crypto.randomUUID(), expectedRevision: revision, challenge, state,
      observedSha256: lease.artifactSha256, detail: "Desktop native verifier; not OS attested",
    });
    if (result.revision !== revision + 1 || !/^[A-Za-z0-9_-]{43}$/.test(result.nextChallenge))
      throw new Error("Package receipt acknowledgement invalid.");
    challenge = result.nextChallenge;
  }
  return { evidence: "device_report" as const, osAttested: false as const, state: "staged" as const,
    selectionLease: { ...lease, challenge, expectedRevision: 2, issuedAt: Date.now() } };
}

/** A rejected native verification remains a device claim, not OS evidence. */
export async function reportFailedNativePackageStage(lease: PackageStageReceiptLease,
  post: (deploymentId: string, body: Record<string, unknown>) => Promise<{ revision: number }>) {
  const result = await post(lease.deploymentId, {
    eventId: crypto.randomUUID(), expectedRevision: 0, challenge: lease.challenge,
    state: "failed", observedSha256: lease.artifactSha256,
    detail: "Native Package staging rejected; content not installed",
  });
  if (result.revision !== 1) throw new Error("Package failure receipt acknowledgement invalid.");
  return { state: "failed" as const, evidence: "device_report" as const, osAttested: false as const };
}

/** Follow-up after a separately authorized native managed-content change.
 * A device observation, never a privileged installation attestation. */
export async function reportNativeManagedSelection(lease: PackageStageReceiptLease & { expectedRevision: number },
  post: (deploymentId: string, body: Record<string, unknown>) => Promise<{ revision: number; nextChallenge: string }>) {
  if (lease.expectedRevision !== 2 || Date.now() - lease.issuedAt >= 9 * 60_000)
    throw new Error("Managed Package selection receipt lease is unavailable or expired.");
  const response = await post(lease.deploymentId, {
    eventId: crypto.randomUUID(), expectedRevision: lease.expectedRevision, challenge: lease.challenge,
    state: "content_selected", observedSha256: lease.artifactSha256,
    detail: "Native managed content pointer selected, not OS installed or attested",
  });
  if (response.revision !== 3 || !/^[A-Za-z0-9_-]{43}$/.test(response.nextChallenge))
    throw new Error("Managed Package selection receipt acknowledgement invalid.");
  return { state: "content_selected" as const, evidence: "device_report" as const, osAttested: false as const,
    rollbackLease: { ...lease, challenge: response.nextChallenge, expectedRevision: 3, issuedAt: Date.now() } };
}


/** A rollback report closes the deployment that was selected previously.
 * Its observed digest must remain that deployment's digest, NOT the restored
 * previous release's digest. The native helper separately verifies the actual
 * restored target against a freshly signed grant. This is still device-report
 * evidence, not OS rollback attestation. */
export async function reportNativeManagedRollback(lease: PackageStageReceiptLease & { expectedRevision: number },
  post: (deploymentId: string, body: Record<string, unknown>) => Promise<{ revision: number; nextChallenge: string }>) {
  if (lease.expectedRevision !== 3 || Date.now() < lease.issuedAt || Date.now() - lease.issuedAt >= 9 * 60_000)
    throw new Error("Managed Package rollback receipt lease is unavailable or expired.");
  const response = await post(lease.deploymentId, {
    eventId: crypto.randomUUID(), expectedRevision: 3, challenge: lease.challenge,
    state: "rolled_back", observedSha256: lease.artifactSha256,
    detail: "Native previous managed-content pointer restored; OS installation and health are not attested",
  });
  if (response.revision !== 4 || !/^[A-Za-z0-9_-]{43}$/.test(response.nextChallenge))
    throw new Error("Managed Package rollback receipt acknowledgement invalid.");
  return { state: "rolled_back" as const, evidence: "device_report" as const, osAttested: false as const };
}
