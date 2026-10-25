export type OfflineMutationSafety = "safe" | "revision_guarded" | "online_only";
export type OfflineConflictStrategy = "manual" | "prefer_local" | "prefer_server";

export type OfflineMutationPolicyInput = {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  baseRevision?: number | null;
  dedupeKey?: string | null;
  entityId?: string | null;
  requestedSafety?: OfflineMutationSafety;
  requestedConflictStrategy?: OfflineConflictStrategy;
};

export type OfflineMutationPolicy = {
  safety: OfflineMutationSafety;
  conflictStrategy: OfflineConflictStrategy;
  maxAttempts: number;
  requiresRevision: boolean;
  reason: string;
};

export function classifyOfflineMutation(input: OfflineMutationPolicyInput): OfflineMutationPolicy {
  if (input.requestedSafety === "online_only") {
    return { safety: "online_only", conflictStrategy: "manual", maxAttempts: 0, requiresRevision: false, reason: "This action was explicitly marked online-only." };
  }

  const hasRevision = Number.isFinite(input.baseRevision) && Number(input.baseRevision) > 0;
  const idempotentCreate = input.method === "POST" && Boolean(input.dedupeKey);
  const updateLike = input.method === "PATCH" || input.method === "PUT" || input.method === "DELETE";

  if (updateLike && !hasRevision && input.requestedSafety !== "safe") {
    return {
      safety: "online_only",
      conflictStrategy: "manual",
      maxAttempts: 0,
      requiresRevision: true,
      reason: "Offline updates and deletes require a base revision so Cluster can detect server-side changes before replay.",
    };
  }

  if (hasRevision) {
    return {
      safety: "revision_guarded",
      conflictStrategy: input.requestedConflictStrategy || "manual",
      maxAttempts: 8,
      requiresRevision: true,
      reason: "Replay is protected by the server revision captured when the edit was made.",
    };
  }

  if (idempotentCreate || input.requestedSafety === "safe") {
    return {
      safety: "safe",
      conflictStrategy: input.requestedConflictStrategy || "manual",
      maxAttempts: 8,
      requiresRevision: false,
      reason: idempotentCreate ? "The create is deduplicated before replay." : "The caller explicitly marked this mutation safe to replay.",
    };
  }

  return {
    safety: "online_only",
    conflictStrategy: "manual",
    maxAttempts: 0,
    requiresRevision: false,
    reason: "Cluster could not prove that replaying this action later would be safe.",
  };
}

export function shouldQuarantineMutation(attempts: number, maxAttempts: number) {
  return maxAttempts > 0 && attempts >= maxAttempts;
}

// Bulk retry is for transient delivery failures, not a way around permission,
// schema validation, stale revision or replay-attempt quarantine.
export function mayRetryFailedMutation(item: { status: string; conflictKind?: string | null; quarantinedAt?: number | null }) {
  return item.status === "failed" && !item.quarantinedAt && !["permission", "validation", "deleted", "revision"].includes(String(item.conflictKind || ""));
}
