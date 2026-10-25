import { PeopleGovernanceError } from "./people-governance.js";

export const ACCESS_RENEWAL_MAX_DAYS = 730;
export function requireRenewableAccount(user: any) {
  if (!user || user.archived || ["DISABLED", "PRIVACY_ERASED"].includes(String(user.accountState)))
    throw new PeopleGovernanceError("ACCESS_RENEWAL_UNAVAILABLE", "Archived, disabled or erased people need their separate governed lifecycle.", 409);
  if (!user.accessExpiresAt)
    throw new PeopleGovernanceError("ACCESS_RENEWAL_PERMANENT", "This account has no expiration. A renewal cannot grant permanent access.", 409);
  const current = new Date(user.accessExpiresAt);
  if (!Number.isFinite(current.getTime()))
    throw new PeopleGovernanceError("ACCESS_RENEWAL_INVALID_OLD_WINDOW", "The current account expiration is invalid.", 409);
  return current;
}
export function validateRenewalWindow(current: Date, proposed: Date, now = new Date()) {
  if (!Number.isFinite(proposed.getTime()) || proposed <= now || proposed <= current || proposed.getTime() > now.getTime() + ACCESS_RENEWAL_MAX_DAYS * 86_400_000)
    throw new PeopleGovernanceError("ACCESS_RENEWAL_WINDOW_INVALID", "The new expiration must extend the current window, be in the future and be within two years.", 400);
}
export function requireRenewalFresh(renewal: any, user: any) {
  if (renewal.status !== "pending") throw new PeopleGovernanceError("ACCESS_RENEWAL_ALREADY_REVIEWED", "This renewal was already reviewed.", 409);
  const current = requireRenewableAccount(user);
  if (user.id !== renewal.subjectUserId || Number(user.profileRevision) !== Number(renewal.expectedProfileRevision) || current.getTime() !== new Date(renewal.previousExpiresAt).getTime())
    throw new PeopleGovernanceError("ACCESS_RENEWAL_STALE", "The person's profile or access window changed. Request a new review.", 409);
  validateRenewalWindow(current, new Date(renewal.requestedExpiresAt));
  return current;
}
