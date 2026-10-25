import { PeopleGovernanceError } from "../users/people-governance.js";

export const SCOPED_GRANT_MAX_DAYS = 180;
export function requireScopedGrantSubject(user: any, now = new Date()) {
  if (!user || user.archived || String(user.accountState) !== "ACTIVE")
    throw new PeopleGovernanceError("SCOPED_GRANT_SUBJECT_INACTIVE", "Only active, non-archived people can receive scoped access.", 409);
  if (user.accessExpiresAt) {
    const expiry = new Date(user.accessExpiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= now)
      throw new PeopleGovernanceError("SCOPED_GRANT_IDENTITY_EXPIRED", "Renew identity access separately before requesting a resource grant.", 409);
  }
  return user;
}
export function validateScopedGrantWindow(user: any, until: Date, now = new Date()) {
  requireScopedGrantSubject(user, now);
  if (!Number.isFinite(until.getTime()) || until <= now || until.getTime() > now.getTime() + SCOPED_GRANT_MAX_DAYS * 86_400_000)
    throw new PeopleGovernanceError("SCOPED_GRANT_WINDOW", "A grant must expire in the future, within 180 days.", 400);
  if (user.accessExpiresAt && until > new Date(user.accessExpiresAt))
    throw new PeopleGovernanceError("SCOPED_GRANT_IDENTITY_BOUND", "A resource grant cannot outlive the person's account access.", 409);
}
export function requireScopedGrantExtension(rule: any, row: any, now = new Date()) {
  if (!rule || rule.id !== row.accessRuleId || rule.targetKind !== "project" || rule.targetId !== row.targetId ||
      rule.subjectKind !== "member" || rule.subjectId !== row.subjectUserId || rule.effect !== "allow" || rule.status !== "active" ||
      rule.level !== row.level || !rule.expiresAt || new Date(rule.expiresAt) <= now ||
      new Date(rule.expiresAt).getTime() !== new Date(row.previousExpiresAt).getTime() ||
      new Date(rule.updatedAt).getTime() !== new Date(row.expectedRuleUpdatedAt).getTime())
    throw new PeopleGovernanceError("SCOPED_GRANT_STALE", "The grant changed or expired; request a fresh review.", 409);
  if (new Date(row.expiresAt) <= new Date(rule.expiresAt))
    throw new PeopleGovernanceError("SCOPED_GRANT_NOT_EXTENSION", "An extension must increase the existing expiry.", 400);
  return rule;
}

// Existing manual Access Rule allowlists are intentionally exclusive. Independently
// reviewed personal grants are additive to baseline Project access for nonrecipients.
export function isExclusiveAccessAllow(rule: any) {
  return rule.effect === "allow" && !rule.governedGrantId;
}
