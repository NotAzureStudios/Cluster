/**
 * One retry policy for visible workspace fallback and active-job polling.
 * Ordinary errors get bounded exponential backoff, and 429/503 responses
 * also honor Retry-After. Positive jitter prevents synchronized clients from
 * retrying on precisely the same millisecond.
 */
export function refreshRetryDelayMs(
  intervalMs: number,
  consecutiveFailures: number,
  error: unknown,
  entropy = Math.random(),
): number {
  const baseline = Math.max(1_000, Math.round(Number.isFinite(intervalMs) ? intervalMs : 1_000));
  if (consecutiveFailures < 1) return baseline;
  const failures = Math.max(1, Math.min(6, Math.trunc(consecutiveFailures)));
  const exponentialMs = Math.min(60_000, baseline * 2 ** failures);
  const candidate = error && typeof error === "object"
    ? error as { status?: unknown; retryAfterSeconds?: unknown }
    : null;
  const status = Number(candidate?.status);
  const seconds = Number(candidate?.retryAfterSeconds);
  const retryAfterMs = (status === 429 || status === 503) && candidate?.retryAfterSeconds != null
    && Number.isFinite(seconds) && seconds > 0
    ? Math.min(300_000, Math.ceil(seconds * 1_000))
    : 0;
  const requiredMs = Math.max(exponentialMs, retryAfterMs);
  const jitter = Number.isFinite(entropy) ? Math.max(0, Math.min(1, entropy)) : 0;
  return Math.min(300_000, Math.ceil(requiredMs * (1 + jitter * 0.1)));
}
