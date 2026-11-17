import crypto from "node:crypto";

export const ACCOUNT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_INVITATION_TOKEN_BYTES = 32;
export const ACCOUNT_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A 256-bit random token, with a purpose-separated digest. Only the digest
 * is persisted. The raw token is never allowed in logs or analytics. */
export function createAccountInvitationToken() {
  const token = crypto.randomBytes(ACCOUNT_INVITATION_TOKEN_BYTES).toString("base64url");
  return { token, digest: accountInvitationDigest(token) };
}

export function accountInvitationDigest(token: string) {
  return crypto.createHash("sha256").update("cluster-account-invitation-v1\0").update(token, "utf8").digest("hex");
}

/** Only canonical HTTPS origins (or local loopback for development) can be
 * used for a clickable invitation link. Never trust a request Host header. */
export function approvedAccountInvitationOrigin(value: string) {
  let origin: URL;
  try { origin = new URL(value); } catch { return null; }
  const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) ||
      origin.username || origin.password || origin.search || origin.hash ||
      (origin.pathname !== "/" && origin.pathname !== "")) return null;
  return origin.origin;
}

export function accountInvitationEligible(user: {
  accountState?: string | null;
  archived?: boolean;
  passwordChangedAt?: Date | string | null;
  accessExpiresAt?: Date | string | null;
}, now = new Date()) {
  if (user.archived || user.accountState !== "PASSWORD_CHANGE_REQUIRED" || user.passwordChangedAt)
    return false;
  if (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() <= now.getTime())
    return false;
  return true;
}
