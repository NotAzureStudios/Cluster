export const COLLABORATION_STALE_MS = 20_000;
export const COLLABORATION_POLL_INTERVAL_MS = 3_000;
export const COLLABORATION_HEARTBEAT_MS = 4_000;
export const COLLABORATION_PRESENCE_SEND_MS = 120;

export function collaborationPresenceDelay(lastSentAt: number, now = Date.now()) {
  const elapsed = Math.max(0, Number(now) - Math.max(0, Number(lastSentAt) || 0));
  return Math.max(0, COLLABORATION_PRESENCE_SEND_MS - elapsed);
}

export function collaborationReconnectDelay(attempts: number) {
  const normalized = Math.max(0, Math.floor(Number(attempts) || 0));
  return Math.min(15_000, 800 * (2 ** Math.min(normalized, 5)));
}

export function collaborationFallbackDelay(attempts: number) {
  const normalized = Math.max(1, Math.floor(Number(attempts) || 1));
  return Math.min(15_000, 1_000 * normalized);
}

export function collaborationPresenceIsActive(updatedAt: number, now = Date.now()) {
  return Number.isFinite(updatedAt) && now - updatedAt < COLLABORATION_STALE_MS;
}
