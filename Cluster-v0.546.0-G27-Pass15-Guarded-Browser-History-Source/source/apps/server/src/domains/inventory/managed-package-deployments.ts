import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// These are statements from a verified Device Registration, not OS attestation.
export const PACKAGE_DEVICE_REPORT_STATES = ["artifact_verified", "staged", "content_selected", "failed", "rolled_back"] as const;
export type PackageDeviceReportState = typeof PACKAGE_DEVICE_REPORT_STATES[number];
export type PackageDeploymentState = "offered" | PackageDeviceReportState;
const transitions: Record<PackageDeploymentState, readonly PackageDeviceReportState[]> = {
  offered: ["artifact_verified", "failed"],
  artifact_verified: ["staged", "failed"],
  staged: ["content_selected", "failed"],
  content_selected: ["rolled_back", "failed"],
  failed: [],
  rolled_back: [],
};
export function packageDeviceTransitionAllowed(previous: string, next: string): boolean {
  return Object.prototype.hasOwnProperty.call(transitions, previous) && transitions[previous as PackageDeploymentState].includes(next as PackageDeviceReportState);
}
export function newPackageReceiptChallenge() {
  const challenge = randomBytes(32).toString("base64url");
  return { challenge, challengeHash: packageReceiptChallengeHash(challenge), expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
}
export function packageReceiptChallengeHash(value: string) {
  return createHash("sha256").update("cluster-package-receipt-v1\n" + value).digest("hex");
}
export function packageReceiptChallengeValid(presented: string, storedHash: string, expiresAt: Date | string, now = Date.now()): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(presented) || !/^[0-9a-f]{64}$/.test(storedHash) || new Date(expiresAt).getTime() <= now) return false;
  return timingSafeEqual(Buffer.from(packageReceiptChallengeHash(presented), "hex"), Buffer.from(storedHash, "hex"));
}
/** Consistent, nonattested display terminology for operators and clients. */
export function packageDeviceReportedState(state: string) { return { state, evidence: "device_report", osAttested: false, installerCertified: false }; }
