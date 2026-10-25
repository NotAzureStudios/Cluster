/** Strict, explicit application-to-People mapping. Public answers are never authority. */
const PROFILE_FIELD_LIMITS: Record<string, number> = {
  displayName: 200, email: 320, legalName: 200, preferredName: 200, pronouns: 100,
  phoneNumber: 100, alternatePhoneNumber: 100, addressLine1: 300, addressLine2: 300,
  city: 160, stateProvince: 160, postalCode: 40, country: 100,
  emergencyContactName: 200, emergencyContactPhone: 100, emergencyContactRelation: 100,
  title: 200, workLocation: 200, timezone: 120, employmentType: 100,
};

export class ApplicationMappingError extends Error {
  readonly code = "APPLICATION_MAPPING_INVALID";
}

export function buildApplicationProfile(fields: unknown, answers: unknown, selectedFieldIds: string[]) {
  const definitions = Array.isArray(fields) ? fields : [];
  const submitted: Record<string, unknown> = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, unknown> : {};
  const selected = new Set(selectedFieldIds);
  if (selected.size !== selectedFieldIds.length) throw new ApplicationMappingError("Select each profile field only once.");
  const profile: Record<string, string> = {};
  const matched = new Set<string>();
  for (const field of definitions) {
    const id = String(field?.id || "");
    if (!selected.has(id)) continue;
    matched.add(id);
    const key = String(field?.profileMappingKey || "");
    if (!Object.hasOwn(PROFILE_FIELD_LIMITS, key)) throw new ApplicationMappingError("The selected application field is not approved for People mapping.");
    if (Object.hasOwn(profile, key)) throw new ApplicationMappingError("Two selected fields target the same People property.");
    const raw = submitted[id];
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string") throw new ApplicationMappingError("A selected People field must contain plain text.");
    const value = raw.trim();
    if (!value) continue;
    if (value.length > PROFILE_FIELD_LIMITS[key]) throw new ApplicationMappingError("A selected field exceeds the People profile length limit.");
    if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ApplicationMappingError("The selected email is invalid.");
    profile[key] = value;
  }
  if (matched.size !== selected.size) throw new ApplicationMappingError("A selected mapping no longer exists in the published application version.");
  return profile;
}
