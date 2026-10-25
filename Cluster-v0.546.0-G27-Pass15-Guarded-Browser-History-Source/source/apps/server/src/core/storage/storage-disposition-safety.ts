import type { StorageProvider } from "./storage-types.js";

/** Informational provider capabilities, not permissions or execution tokens. */
type SafetyStatus = "unsupported" | "unverified";
type SafetyEvidence = { state: SafetyStatus; detail: string };

export type ProviderDispositionSafety = {
  mode: "INSPECTION_ONLY";
  providerId: string;
  generationIdentity: SafetyEvidence;
  compareAndSwapMutation: SafetyEvidence;
  atomicQuarantine: SafetyEvidence;
  verifiedRestore: SafetyEvidence;
  backupRetention: SafetyEvidence;
  digestVerification: SafetyEvidence;
  safePhysicalDelete: false;
};

/**
 * Existing providers expose stat(size, mtime, optional metadata checksum),
 * unconditional put/copy/delete and optional multipart. None exposes a
 * generation-fenced mutation, verified isolation/restore or backup retention.
 * An S3 ETag or last-modified value alone is not a transferable deletion permit.
 */
export function inspectProviderDispositionSafety(provider: Pick<StorageProvider, "id" | "kind" | "capabilities">): ProviderDispositionSafety {
  const object = provider.capabilities.objectStorage;
  return {
    mode: "INSPECTION_ONLY",
    providerId: provider.id,
    generationIdentity: {
      state: "unverified",
      detail: object
        ? "S3-compatible HEAD may expose an opaque object version ID. Cluster does not hold a lease or enforce conditional mutation at that version."
        : "Filesystem stat does not pin file identity across SMB/local writers or prevent reparse/hardlink changes.",
    },
    compareAndSwapMutation: {
      state: "unsupported",
      detail: "Provider writes/copies/deletes have no enforced expected-generation or no-clobber precondition.",
    },
    atomicQuarantine: {
      state: "unsupported",
      detail: object
        ? "No provider-level reversible, generation-fenced quarantine API is implemented."
        : "No crash-journaled, symlink-safe, no-clobber quarantine rename/restore API is implemented.",
    },
    verifiedRestore: {
      state: "unsupported",
      detail: "No immutable quarantine receipt, durable byte verification and rollback adapter exist.",
    },
    backupRetention: {
      state: "unverified",
      detail: "No verified provider versioning, object lock, snapshots or backup-expiry evidence is available.",
    },
    digestVerification: {
      state: "unverified",
      detail: "Optional caller-provided SHA-256 metadata is not independently verified against provider bytes.",
    },
    safePhysicalDelete: false,
  };
}
