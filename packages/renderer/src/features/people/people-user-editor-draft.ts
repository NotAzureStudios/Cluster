/**
 * Pure and testable profile-editor patch builder.
 *
 * Saves are bounded to fields a user deliberately changed. Security roles,
 * lifecycle transitions, project grants and access expiry are excluded.
 */
export const PEOPLE_EDITOR_TEXT_FIELDS = [
  "username", "employeeNumber", "displayName", "legalName", "preferredName", "pronouns",
  "email", "phoneNumber", "timezone", "title", "department", "managerUserId",
  "workLocation", "employmentType", "startDate", "notes",
] as const;
export type PeopleEditorTextField = typeof PEOPLE_EDITOR_TEXT_FIELDS[number];
export type PeopleEditorHoursField = "capacityHours" | "minimumHours";
export type PeopleEditorDraft = Record<PeopleEditorTextField | PeopleEditorHoursField, string>;
export const PEOPLE_EDITOR_FIELDS: Array<keyof PeopleEditorDraft> = [
  ...PEOPLE_EDITOR_TEXT_FIELDS, "capacityHours", "minimumHours",
];

export function changedPeopleEditorFields(draft: PeopleEditorDraft, opened: PeopleEditorDraft) {
  return PEOPLE_EDITOR_FIELDS.filter((field) => draft[field] !== opened[field]);
}

export function preparePeopleEditorPatch(
  draft: PeopleEditorDraft,
  opened: PeopleEditorDraft,
  openedRevision: number,
  originalUsername: string,
) {
  const changed = changedPeopleEditorFields(draft, opened);
  if (!changed.length) throw new Error("No profile changes to save.");
  if (!Number.isInteger(openedRevision) || openedRevision < 1) throw new Error("Reload this profile before saving.");
  if (draft.username.trim().length < 3 || draft.username.trim().length > 32)
    throw new Error("Username must contain between 3 and 32 characters.");
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    throw new Error("Enter a valid email address.");
  if (draft.employeeNumber.trim().length > 80) throw new Error("Employee number cannot exceed 80 characters.");
  if (draft.notes.length > 4000) throw new Error("Internal notes cannot exceed 4,000 characters.");
  if (draft.timezone.trim()) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: draft.timezone.trim() }); }
    catch { throw new Error("Enter a valid IANA time zone, such as America/New_York."); }
  }
  if (draft.startDate) {
    const date = new Date(`${draft.startDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.startDate) {
      throw new Error("Enter a valid employment start date.");
    }
  }
  for (const field of ["capacityHours", "minimumHours"] as const) {
    if (draft[field] && (!/^\d+$/.test(draft[field]) || Number(draft[field]) > 168))
      throw new Error("Weekly hours must be whole numbers between 0 and 168.");
  }
  const capacity = draft.capacityHours === "" ? null : Number(draft.capacityHours);
  const minimum = draft.minimumHours === "" ? null : Number(draft.minimumHours);
  if (capacity != null && minimum != null && minimum > capacity)
    throw new Error("Minimum hours cannot exceed capacity hours.");

  const changes: Record<string, unknown> = { expectedProfileRevision: openedRevision };
  for (const field of changed) {
    if (field === "capacityHours" || field === "minimumHours") {
      changes[field] = draft[field] === "" ? null : Number(draft[field]);
    } else {
      changes[field] = draft[field].trim() || (field === "username" ? originalUsername : null);
    }
  }
  return changes;
}
