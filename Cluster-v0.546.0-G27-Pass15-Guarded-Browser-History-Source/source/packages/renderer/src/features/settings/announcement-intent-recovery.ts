/**
 * Tab-scoped recovery markers for ambiguous announcement Create/Duplicate requests.
 * No titles, message bodies, audience IDs or credentials are persisted here.
 * The server is always the authority on whether an intent actually committed.
 */
export type AnnouncementIntentKind = "create" | "duplicate";
export type PendingAnnouncementIntent = { id: string; digest: string; createdAt: number };
export type AnnouncementIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const TTL_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
export function intentStorageKey(kind: AnnouncementIntentKind) { return `cluster:studio-announcement:pending-${kind}:v1`; }
export function readPendingAnnouncementIntent(storage: AnnouncementIntentStorage | null | undefined, kind: AnnouncementIntentKind, now = Date.now()): PendingAnnouncementIntent | null {
  if (!storage) return null;
  const key = intentStorageKey(kind);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) throw Error("invalid pending intent");
    const record = value as Partial<PendingAnnouncementIntent>;
    if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id) || typeof record.digest !== "string" || !HEX_SHA256.test(record.digest) || typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt) || record.createdAt > now + 60_000 || now - record.createdAt > TTL_MS) throw Error("expired or invalid pending intent");
    return { id: record.id, digest: record.digest, createdAt: record.createdAt };
  } catch {
    try { storage.removeItem(key); } catch { /* browser storage may be blocked */ }
    return null;
  }
}
export function savePendingAnnouncementIntent(storage: AnnouncementIntentStorage | null | undefined, kind: AnnouncementIntentKind, value: PendingAnnouncementIntent) {
  if (!storage) return;
  try { storage.setItem(intentStorageKey(kind), JSON.stringify(value)); } catch { /* use in-memory intent if storage is unavailable */ }
}
export function clearPendingAnnouncementIntent(storage: AnnouncementIntentStorage | null | undefined, kind: AnnouncementIntentKind, id?: string) {
  if (!storage) return;
  try {
    if (!id) { storage.removeItem(intentStorageKey(kind)); return; }
    const raw = storage.getItem(intentStorageKey(kind));
    if (raw && (JSON.parse(raw) as Partial<PendingAnnouncementIntent>)?.id === id) storage.removeItem(intentStorageKey(kind));
  } catch { /* use in-memory intent if storage is unavailable */ }
}
export async function announcementRequestDigest(payload: string): Promise<string> {
  // SHA-256 is used only for matching the form to its local retry marker.
  // Authorization and duplicate prevention are independently enforced server-side.
  const bytes = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
