import { createPrivateKey, createPublicKey, createHash, randomBytes, sign } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

// Distinct from content signing: deployment authority cannot be conveyed by a
// package publisher. Disabled unless the administrator provisions a separate key.
export const PACKAGE_GRANT_CONTEXT = "CLUSTER_MANAGED_DEPLOYMENT_GRANT_V1\n";
export const PACKAGE_GRANT_TTL_SECONDS = 60;
export type PackageGrantOperation = "deploy" | "rollback" | "install" | "repair" | "uninstall" | "upgrade" | "msi-rollback";
export type PackageGrantPayload = {
  schema: 1; operation: PackageGrantOperation; packageKey: string; version: string;
  platform: string; artifactSha256: string; signingKeySha256: string;
  releaseId: string; registrationId: string; userId: string;
  issuedAt: number; expiresAt: number; nonce: string;
  priorReceiptSha256?: string;
  priorMsiSha256?: string;
  upgradeJournalSha256?: string;
  successorMsiSha256?: string;
};

/** A separately provisioned server secret. The path is fixed by the server
 * operator at startup, not supplied by the authenticated client. */
export function readPackageDeploymentPrivateKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_PEM) return env.CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_PEM;
  const path = env.CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_FILE;
  if (!path) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || stat.size < 50) throw new Error("PACKAGE_GRANT_PRIVATE_KEY_FILE_UNSAFE");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("PACKAGE_GRANT_PRIVATE_KEY_FILE_PERMISSIONS");
  return readFileSync(path, "utf8");
}

export function mintPackageDeploymentGrant(input: Omit<PackageGrantPayload, "schema" | "issuedAt" | "expiresAt" | "nonce">,
  pem: string | undefined, now = Date.now()) {
  if (!pem) throw new Error("PACKAGE_GRANT_SIGNER_NOT_CONFIGURED");
  const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("PACKAGE_GRANT_SIGNER_INVALID");
  const publicKey = createPublicKey(key);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  if (!/^[a-f0-9]{64}$/.test(input.artifactSha256) || !/^[a-f0-9]{64}$/.test(input.signingKeySha256))
    throw new Error("PACKAGE_GRANT_TARGET_INVALID");
  if (input.operation !== "deploy" && input.operation !== "rollback" && input.operation !== "install" && input.operation !== "repair" && input.operation !== "uninstall" && input.operation !== "upgrade" && input.operation !== "msi-rollback") throw new Error("PACKAGE_GRANT_OPERATION_INVALID");
  // A repair grant names the exact observed local install receipt supplied by
  // the operator. The native helper independently recomputes that digest.
  // Other operations may not smuggle a lifecycle receipt into their scope.
  if (input.operation === "repair" || input.operation === "uninstall" || input.operation === "upgrade" || input.operation === "msi-rollback" ? !/^[a-f0-9]{64}$/.test(input.priorReceiptSha256 || "") : input.priorReceiptSha256 !== undefined)
    throw new Error("PACKAGE_GRANT_LIFECYCLE_RECEIPT_INVALID");
  // An upgrade additionally binds the retained predecessor MSI bytes. This
  // signed scope is mandatory, never supplied as an arbitrary filesystem path.
  if (input.operation === "upgrade" || input.operation === "msi-rollback" ? !/^[a-f0-9]{64}$/.test(input.priorMsiSha256 || "") : input.priorMsiSha256 !== undefined)
    throw new Error("PACKAGE_GRANT_UPGRADE_PREDECESSOR_INVALID");
  // Rollback has its own operation tag and binds the *completed upgrade*
  // journal and the retained successor installer. Neither the content
  // rollback nor an upgrade grant can satisfy this authority.
  if (input.operation === "msi-rollback" ?
      !/^[a-f0-9]{64}$/.test(input.upgradeJournalSha256 || "") || !/^[a-f0-9]{64}$/.test(input.successorMsiSha256 || "") :
      input.upgradeJournalSha256 !== undefined || input.successorMsiSha256 !== undefined)
    throw new Error("PACKAGE_GRANT_MSI_ROLLBACK_CUSTODY_INVALID");
  const issuedAt = Math.floor(now / 1000);
  const payload: PackageGrantPayload = { schema: 1, ...input, issuedAt,
    expiresAt: issuedAt + PACKAGE_GRANT_TTL_SECONDS, nonce: randomBytes(24).toString("base64url") };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign(null, Buffer.concat([Buffer.from(PACKAGE_GRANT_CONTEXT), bytes]), key);
  return {
    schema: 1 as const,
    payloadBase64url: bytes.toString("base64url"),
    signatureBase64url: signature.toString("base64url"),
    publicKeyPem,
    // Fingerprint is informational. Workstations MUST provision it out-of-band.
    controlKeyFingerprint: createHash("sha256").update(publicKeyDer).digest("hex"),
    expiresAt: payload.expiresAt,
  };
}
