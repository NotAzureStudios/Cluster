/**
 * Cluster's Studio Settings are persisted in PostgreSQL; coordination messages
 * are hints to invalidate another process's local cache, NEVER settings data.
 * A lost hint is recovered by the existing periodic DB reconciliation.
 */
export function createStudioSettingsCoordination(deps: {
  readSettings: (force: boolean) => Promise<Record<string, unknown>>;
  applyToolAvailability: (settings: Record<string, unknown>, changedKeys?: readonly string[]) => void;
  publishChange: (payload: { kind: "committed" }) => Promise<boolean>;
  warn: (error: unknown, message: string) => void;
}) {
  let refreshRequested = false;
  let refreshInFlight: Promise<void> | null = null;
  let stopped = false;

  // If several notifications arrive during a database read, coalesce them into
  // one follow-up read. Serializing reads prevents older asynchronous responses
  // from applying after a newer one and reversing the local runtime state.
  function refreshFromDatabase(): Promise<void> {
    if (stopped) return Promise.resolve();
    refreshRequested = true;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      while (refreshRequested && !stopped) {
        refreshRequested = false;
        try {
          const authoritative = await deps.readSettings(true);
          if (!stopped) deps.applyToolAvailability(authoritative);
        } catch (error) {
          // Do not spin on a failed DB read: the next hint or periodic
          // reconciliation tries again. An event is not an authority source.
          deps.warn(error, "cross-process Studio Settings refresh failed; scheduled reconciliation remains active");
        }
      }
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function committedLocally(changedKeys: readonly string[], values: Record<string, unknown>) {
    if (stopped || !changedKeys.length) return;
    // The local committing process already has authoritative values. Update
    // its runtime synchronously without a redundant read.
    deps.applyToolAvailability(values, changedKeys);
    // Do not publish setting values, secrets, user IDs or sensitive metadata.
    // Propagation failure must not turn a committed DB write into an API error.
    void Promise.resolve()
      .then(() => deps.publishChange({ kind: "committed" }))
      .then((delivered) => { if (!delivered && !stopped) deps.warn(null, "Studio Settings notification dropped; other processes will reconcile from DB"); })
      .catch((error) => { if (!stopped) deps.warn(error, "Studio Settings coordination publish failed; other processes will reconcile from DB"); });
  }

  function close() {
    stopped = true;
    refreshRequested = false;
  }

  return { committedLocally, refreshFromDatabase, close };
}
