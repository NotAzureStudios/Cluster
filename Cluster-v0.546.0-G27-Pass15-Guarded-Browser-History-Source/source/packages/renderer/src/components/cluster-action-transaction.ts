/**
 * The server mutation and the local acknowledgement are separate phases.
 * A failed local commit must NEVER be treated as proof that the server did not
 * apply the operation: blindly retrying creates duplicate work.
 *
 * This pure executor is also used by the action feedback UI; keeping the
 * phases explicit makes rollback and uncertain-outcome behavior testable.
 */
export type ClusterActionTransactionResult<T> =
  | { ok: true; value: T }
  | {
    ok: false;
    stage: "optimistic" | "action" | "commit";
    error: unknown;
    rollbackError?: unknown;
  };

export async function executeClusterActionTransaction<T>({
  action,
  optimistic,
  rollback,
  commit,
}: {
  action: () => Promise<T> | T;
  optimistic?: () => unknown;
  rollback?: (snapshot: unknown, error: unknown) => Promise<void> | void;
  commit?: (result: T) => Promise<void> | void;
}): Promise<ClusterActionTransactionResult<T>> {
  let snapshot: unknown;
  try {
    snapshot = optimistic?.();
  } catch (error) {
    return { ok: false, stage: "optimistic", error };
  }

  let value: T;
  try {
    value = await action();
  } catch (error) {
    try {
      await rollback?.(snapshot, error);
      return { ok: false, stage: "action", error };
    } catch (rollbackError) {
      // Preserve the original operation failure, and separately expose the
      // rollback failure. The UI must never get stranded in Working… state.
      return { ok: false, stage: "action", error, rollbackError };
    }
  }

  try {
    await commit?.(value);
    return { ok: true, value };
  } catch (error) {
    // Server action already returned success. Rolling back local optimistic
    // state or encouraging blind retries would misrepresent the outcome.
    return { ok: false, stage: "commit", error };
  }
}
