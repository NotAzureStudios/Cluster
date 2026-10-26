import { workforceAuthorityProjection } from "../domains/workforce/workforce-user-authority.js";

export const PRIVACY_EXPORT_SCHEMA_VERSION = 11;
export const PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY = 2500;

const PROFILE_FIELDS = [
  "id", "username", "employeeNumber", "displayName", "email", "avatarUrl", "personalAccentColor",
  "title", "department", "teamName", "legalName", "preferredName", "pronouns", "phoneNumber",
  "alternatePhoneNumber", "alternateEmails", "addressLine1", "addressLine2", "city", "stateProvince",
  "postalCode", "country", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation",
  "managerName", "employmentType", "accountType", "accessExpiresAt", "workLocation", "hideLegalName",
  "hideLocation", "timezone", "status", "statusMessage", "skills", "capacityHours", "minimumHours",
  "notes", "startDate", "archived", "lastSeenAt", "accountState", "createdAt", "updatedAt",
  "discordUserId", "discordUsername", "discordDisplayName", "discordAvatar", "discordLinkedAt", "discordLastVerifiedAt",
  "passwordChangedAt", "pinUpdatedAt",
] as const;

function parseJsonValue(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function privacyProfileSnapshot(user: Record<string, any> | null | undefined) {
  const snapshot: Record<string, unknown> = {};
  if (!user) return snapshot;
  const profile: Record<string, any> = { ...user, ...workforceAuthorityProjection(user) };
  for (const field of PROFILE_FIELDS) snapshot[field] = profile[field] ?? null;
  snapshot.alternateEmails = parseJsonValue(user.alternateEmails, []);
  snapshot.skills = profile.skills || [];
  snapshot.preferences = parseJsonValue(user.preferences, {});
  snapshot.passwordConfigured = Boolean(user.passwordHash);
  snapshot.pinConfigured = Boolean(user.pinHash);
  return snapshot;
}

export function privacyConnectedAccounts(user: Record<string, any> | null | undefined, requireDiscordLink: boolean) {
  return [{
    provider: "discord",
    linked: Boolean(user?.discordUserId),
    requiredByStudio: Boolean(requireDiscordLink),
    userId: user?.discordUserId || null,
    username: user?.discordUsername || null,
    displayName: user?.discordDisplayName || null,
    avatar: user?.discordAvatar || null,
    linkedAt: user?.discordLinkedAt || null,
    lastVerifiedAt: user?.discordLastVerifiedAt || null,
    canDisconnect: Boolean(user?.discordUserId) && !requireDiscordLink,
  }];
}

export function privacyExportFilename(username: string, exportedAt = new Date()) {
  const safe = String(username || "user").replace(/[^a-z0-9._-]+/gi, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+|[.-]+$/g, "").slice(0, 64) || "user";
  return `cluster-data-${safe}-${exportedAt.toISOString().slice(0, 10)}.json`;
}

export function boundedPrivacyRecords<T>(records: T[], maximum = PRIVACY_EXPORT_MAX_RECORDS_PER_CATEGORY) {
  return { records: records.slice(0, maximum), truncated: records.length > maximum };
}
