import type { DisclosureObligation, DisclosureSurface } from "./authorization-decision.js";

export const USER_PRIVATE_PROFILE_FIELDS = [
  "employeeNumber", "legalName", "phoneNumber", "alternatePhoneNumber", "alternateEmails",
  "addressLine1", "addressLine2", "city", "stateProvince", "postalCode", "country",
  "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "notes",
  "startDate", "toolPermissions", "projectPermissions", "invitedById", "accessExpiresAt",
] as const;

export const USER_SECURITY_STATE_FIELDS = [
  "pinConfigured", "pinUpdatedAt", "passwordConfigured", "passwordChangedAt", "firstLoginCompletedAt",
  "discordLastVerifiedAt", "adminSource",
] as const;

export function userDisclosureObligations(input: {
  includePrivate: boolean;
  includeSecurityState?: boolean;
  surface?: DisclosureSurface;
  reason?: string;
}): DisclosureObligation[] {
  const surface = input.surface || "api";
  const obligations: DisclosureObligation[] = [];
  if (!input.includePrivate) obligations.push({
    kind: "field-redaction",
    profile: "user-public-profile",
    surface,
    omitFields: [...USER_PRIVATE_PROFILE_FIELDS],
    reason: input.reason || "Private personnel fields require self, People manage, or administrator access.",
  });
  if (!input.includeSecurityState) obligations.push({
    kind: "field-redaction",
    profile: "user-security-state",
    surface,
    omitFields: [...USER_SECURITY_STATE_FIELDS],
    reason: "Authentication state is not disclosed on this surface.",
  });
  return obligations;
}

export function applyDisclosureObligations<T>(value: T, obligations: readonly DisclosureObligation[]): T {
  if (!value || typeof value !== "object") return value;
  const omit = new Set(obligations.flatMap((obligation) => obligation.omitFields || []));
  if (!omit.size) return value;
  if (Array.isArray(value)) return value.map((item) => applyDisclosureObligations(item, obligations)) as T;
  const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of omit) delete result[field];
  return result as T;
}

export function disclosureSummary(obligations: readonly DisclosureObligation[]) {
  return obligations.map((item) => ({ profile: item.profile, surface: item.surface, omittedFieldCount: item.omitFields?.length || 0, reason: item.reason || null }));
}
