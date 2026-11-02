/** Security boundary for exchanging a browser session into a native Desktop session.
 * A handoff must never upgrade an incomplete login or outlive source revocation.
 */
export type DesktopSessionHandoffContext = {
  userId: string;
  user: { id?: string; accountState?: string | null; archived?: boolean | null; authenticationGeneration?: number | null; accessExpiresAt?: Date | string | null };
  source: { id?: string; userId?: string; authMethod?: string | null; authenticationGeneration?: number | null; revokedAt?: Date | string | null; expiresAt?: Date | string | null; createdAt?: Date | string | null; lastSeenAt?: Date | string | null };
  requireDiscordLink: boolean;
  sessionDays?: number;
  sessionIdleHours?: number;
  now?: number;
};

function time(value: Date | string | null | undefined): number {
  return value == null ? NaN : new Date(value).getTime();
}

export function desktopSessionHandoffAllowed(input: DesktopSessionHandoffContext): boolean {
  const { user, source } = input;
  const now = input.now ?? Date.now();
  if (!user || !source || !source.id || !input.userId || source.userId !== input.userId || user.id !== input.userId) return false;
  if (user.archived || source.revokedAt) return false;
  if (user.accountState !== "ACTIVE" && !(user.accountState === "DISCORD_LINK_REQUIRED" && !input.requireDiscordLink)) return false;
  if (/pending|enrollment/i.test(String(source.authMethod || ""))) return false;
  if ((user.authenticationGeneration ?? 1) !== (source.authenticationGeneration ?? 1)) return false;
  const expiresAt = time(source.expiresAt);
  const lastSeenAt = time(source.lastSeenAt);
  const createdAt = time(source.createdAt);
  if (![expiresAt, lastSeenAt, createdAt].every(Number.isFinite) || expiresAt <= now || lastSeenAt > now || createdAt > now) return false;
  if (user.accessExpiresAt && !(time(user.accessExpiresAt) > now)) return false;
  if (input.sessionIdleHours !== undefined && (!Number.isFinite(input.sessionIdleHours) || input.sessionIdleHours <= 0 || now - lastSeenAt >= input.sessionIdleHours * 60 * 60_000)) return false;
  if (input.sessionDays !== undefined && (!Number.isFinite(input.sessionDays) || input.sessionDays <= 0 || now - createdAt >= input.sessionDays * 24 * 60 * 60_000)) return false;
  return true;
}
