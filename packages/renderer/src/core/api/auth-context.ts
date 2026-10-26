/** Only completed authentication and /me responses may establish the
 * renderer's offline account identity. An MFA factor, device, session or
 * recovery-record ID is never an account ID. */
const IDENTITY_RESPONSES = new Set([
  "/api/auth/login",
  "/api/auth/mfa/challenge",
  "/api/auth/mfa/passkeys/challenge",
  "/api/auth/passkeys/login/verify",
  "/api/auth/dev-login",
  "/api/auth/session-password",
  "/api/auth/desktop-session-redeem",
]);

export function authenticatedUserIdFromResponse(path: string, payload: unknown): string | null {
  const endpoint = path.split("?")[0];
  if (endpoint !== "/api/me" && !IDENTITY_RESPONSES.has(endpoint)) return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.ok === false || record.signedOut === true || record.currentSessionRevoked === true) return null;
  const user = record.user && typeof record.user === "object" && !Array.isArray(record.user)
    ? record.user as Record<string, unknown>
    : null;
  const value = endpoint === "/api/me"
    ? (typeof user?.id === "string" ? user.id : record.id)
    : (record.ok === true ? user?.id : null);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export type AccountRequestIdentity = Readonly<{ scope: string; generation: number }>;
export function isCurrentAccountRequest(started: AccountRequestIdentity, current: AccountRequestIdentity) {
  return started.scope === current.scope && started.generation === current.generation;
}
