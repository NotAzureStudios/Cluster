export type ReconnectBackoffOptions = {
  baseMs?: number;
  maxMs?: number;
};

/**
 * Bounded exponential retry delay for long-lived transports. The first retry uses
 * baseMs, then doubles until maxMs. Environment recovery signals (online/visible)
 * should reconnect immediately and reset attempts only after the stream is healthy.
 */
export function reconnectBackoffDelay(attempt: number, options: ReconnectBackoffOptions = {}) {
  const baseMs = Math.max(250, Number(options.baseMs || 1_000));
  const maxMs = Math.max(baseMs, Number(options.maxMs || 60_000));
  const normalized = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(maxMs, baseMs * (2 ** Math.min(normalized - 1, 8)));
}
