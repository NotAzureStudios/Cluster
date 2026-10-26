import crypto from "node:crypto";

const CURSOR_PROTOCOL = 2;
const CURSOR_MAX_BYTES = 12 * 1024;
const SENSITIVE_KEY = /(?:password|passwd|secret|token|authorization|cookie|csrf|credential|private[_-]?key|database[_-]?url|webhook[_-]?url|setup[_-]?code|pin)/i;
const SAFE_HEADER_NAMES = new Set(["if-match", "x-cluster-base-revision"]);

export type SyncCursorEnvelope<T> = {
  version: 2;
  kind: string;
  userBinding: string;
  scopeDigest: string;
  payload: T;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

export function syncUserBinding(userId: string) {
  return sha256(`cluster-sync-user:${userId}`).slice(0, 32);
}

export function computeSyncScopeDigest(value: unknown) {
  return sha256(`cluster-sync-scope-v2:${canonical(value)}`);
}

export function encodeSyncCursor<T>(kind: string, userId: string, scopeDigest: string, payload: T, secret: string) {
  if (!secret || Buffer.byteLength(secret, "utf8") < 16) throw new Error("Sync cursor signing secret is unavailable.");
  const envelope: SyncCursorEnvelope<T> = {
    version: CURSOR_PROTOCOL,
    kind,
    userBinding: syncUserBinding(userId),
    scopeDigest,
    payload,
  };
  const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  if (Buffer.byteLength(encoded, "utf8") > CURSOR_MAX_BYTES) throw new Error("Sync cursor payload is too large.");
  return `${encoded}.${hmac(encoded, secret)}`;
}

export function decodeSyncCursor<T>(value: string, kind: string, userId: string, scopeDigest: string, secret: string): {
  payload: T | null;
  resetRequired: boolean;
  resetReason: "missing" | "invalid" | "scope_changed" | null;
} {
  if (!value) return { payload: null, resetRequired: false, resetReason: "missing" };
  if (Buffer.byteLength(value, "utf8") > CURSOR_MAX_BYTES) return { payload: null, resetRequired: true, resetReason: "invalid" };
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return { payload: null, resetRequired: true, resetReason: "invalid" };
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = hmac(encoded, secret);
  try {
    const left = Buffer.from(signature, "base64url");
    const right = Buffer.from(expected, "base64url");
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return { payload: null, resetRequired: true, resetReason: "invalid" };
    const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SyncCursorEnvelope<T>;
    if (envelope.version !== CURSOR_PROTOCOL || envelope.kind !== kind || envelope.userBinding !== syncUserBinding(userId)) {
      return { payload: null, resetRequired: true, resetReason: "invalid" };
    }
    if (envelope.scopeDigest !== scopeDigest) return { payload: null, resetRequired: true, resetReason: "scope_changed" };
    return { payload: envelope.payload, resetRequired: false, resetReason: null };
  } catch {
    return { payload: null, resetRequired: true, resetReason: "invalid" };
  }
}

export function canonicalSyncMutationPath(value: string) {
  if (!value || value.length > 2_000 || /[\r\n\\]/.test(value)) return null;
  try {
    const url = new URL(value, "https://cluster.invalid");
    if (url.origin !== "https://cluster.invalid" || !url.pathname.startsWith("/api/")) return null;
    if (url.username || url.password || url.hash) return null;
    if (/%2e|%2f|%5c/i.test(value)) return null;
    const normalized = `${url.pathname}${url.search}`;
    if (normalized !== value) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function containsSensitiveSyncValue(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveSyncValue(entry, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => SENSITIVE_KEY.test(key) || containsSensitiveSyncValue(child, depth + 1));
}

export function sanitizeSyncHeaders(headers: Record<string, string> | undefined) {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalized = key.toLowerCase();
    if (SAFE_HEADER_NAMES.has(normalized)) sanitized[normalized] = String(value).slice(0, 256);
  }
  return sanitized;
}
