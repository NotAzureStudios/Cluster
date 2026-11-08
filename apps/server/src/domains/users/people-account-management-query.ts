/** Workspace-authorized DB filters for the dedicated People admin account view.
 * Apply before pagination; the public People directory must never expose these
 * security/account state filters to non-administrators. */
export type AccountManagementStatus =
  | "all" | "setup" | "restricted" | "expiring" | "expired" | "archived";

export type AccountManagementQuery = {
  search: string;
  status: AccountManagementStatus;
  accountType: "all" | "employee" | "contractor" | "client" | "guest";
  role: string;
};

export const SETUP_REQUIRED_STATES = [
  "PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED",
  "MFA_ENROLLMENT_REQUIRED", "DISCORD_LINK_REQUIRED",
] as const;
export const RESTRICTED_STATES = ["SUSPENDED", "DISABLED", "LOCKED"] as const;

export function buildPeopleAccountWhere(
  workspaceId: string,
  query: AccountManagementQuery,
  now: Date = new Date(),
) {
  const search = query.search.trim();
  const role = query.role.trim();
  const thirtyDays = new Date(now.getTime() + 30 * 86_400_000);
  return {
    memberships: { some: { workspaceId, ...(role ? { role } : {}) } },
    archived: query.status === "archived",
    ...(query.accountType === "all" ? {} : { accountType: query.accountType }),
    ...(search ? { OR: [
      { username: { contains: search, mode: "insensitive" } },
      { displayName: { contains: search, mode: "insensitive" } },
      { preferredName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ] } : {}),
    ...(query.status === "setup" ? { accountState: { in: [...SETUP_REQUIRED_STATES] } } : {}),
    ...(query.status === "restricted" ? { accountState: { in: [...RESTRICTED_STATES] } } : {}),
    ...(query.status === "expiring" ? { accessExpiresAt: { gt: now, lte: thirtyDays } } : {}),
    ...(query.status === "expired" ? { accessExpiresAt: { lte: now } } : {}),
  };
}
