/**
 * An administrator can restore account eligibility, not waive required first
 * sign-in password changes. Password-change requirements survive suspension.
 */
export function resolveAdminActivationState<T extends string>(
  target: { passwordChangedAt?: Date | string | null; discordUserId?: string | null },
  requireDiscordLink: boolean,
  nextAccountState: (discordUserId: string | null, requireDiscordLink: boolean) => T,
): T | "PASSWORD_CHANGE_REQUIRED" {
  if (!target.passwordChangedAt) return "PASSWORD_CHANGE_REQUIRED";
  return nextAccountState(target.discordUserId ?? null, requireDiscordLink);
}
