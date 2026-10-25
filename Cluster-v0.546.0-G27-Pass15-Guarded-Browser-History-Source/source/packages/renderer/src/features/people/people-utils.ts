import { getToolLevel } from "../../core/permissions";
import type { ProfileCompletionSubject, User, UserActivitySummary } from "../application/application-models";
import { personCapacityLabel, personDisplayName, personLocalTime, personPresence, personPresenceLabel, personStatusSummary } from "./person-summary";

export function displayUserName(user?: Pick<User, "displayName" | "username"> | Pick<UserActivitySummary, "displayName" | "username"> | null) {
  return personDisplayName(user || null);
}

export function userInitial(user?: Pick<User, "displayName" | "username"> | Pick<UserActivitySummary, "displayName" | "username"> | null) {
  return displayUserName(user).slice(0, 1).toUpperCase();
}


export function activeLabel(lastSeenAt?: string | null, lastActivityAt?: string | null) {
  const presence = personPresence({ status: null, lastSeenAt, lastActivityAt });
  if (presence === "available") return "Active";
  if (presence === "recent") return "Recent";
  return "Offline";
}

export function presenceState(user?: Pick<UserActivitySummary, "status" | "lastSeenAt" | "lastActivityAt" | "archived"> | Pick<User, "status" | "lastSeenAt" | "archived"> | null): "active" | "recent" | "focus" | "away" | "offline" {
  const normalized = personPresence(user || null);
  return normalized === "available" ? "active" : normalized;
}

export function presenceLabel(user?: Pick<UserActivitySummary, "status" | "lastSeenAt" | "lastActivityAt" | "archived"> | Pick<User, "status" | "lastSeenAt" | "archived"> | null) {
  return personPresenceLabel(user || null);
}

export function canViewSensitiveProfile(viewer: User, profile?: Pick<UserActivitySummary, "id" | "privateProfile"> | null) {
  if (!profile) return false;
  if (viewer.isAdmin || viewer.id === profile.id) return true;
  if (getToolLevel(viewer, "people") === "manage") return true;
  return profile.privateProfile === true;
}

export function profileCompletionItems(person?: ProfileCompletionSubject | null) {
  const skillCount = person?.skills?.length || 0;
  return [
    {
      label: "Name",
      done: Boolean(person?.displayName || person?.preferredName),
      detail: person?.preferredName || person?.displayName || "Missing display/preferred name",
    },
    {
      label: "Role",
      done: Boolean(person?.title),
      detail: person?.title || "Missing title",
    },
    {
      label: "Department",
      done: Boolean(person?.department || person?.teamName),
      detail: [person?.department, person?.teamName].filter(Boolean).join(" · ") || "Missing department/team",
    },
    {
      label: "Location",
      done: Boolean(person?.workLocation || person?.timezone),
      detail: person?.workLocation || person?.timezone || "Missing location/timezone",
    },
    {
      label: "Capacity",
      done: person?.capacityHours != null,
      detail: person?.capacityHours != null ? `${person.capacityHours}h/week` : "Missing capacity",
    },
    {
      label: "Skills",
      done: skillCount > 0,
      detail: skillCount ? `${skillCount} skill${skillCount === 1 ? "" : "s"}` : "Missing skills",
    },
  ];
}

export function profileCompletionScore(person?: ProfileCompletionSubject | null) {
  const items = profileCompletionItems(person);
  return Math.round((items.filter((item) => item.done).length / items.length) * 100);
}

export function profileMissingSummary(person?: ProfileCompletionSubject | null) {
  const missing = profileCompletionItems(person)
    .filter((item) => !item.done)
    .map((item) => item.label);
  return missing.length ? missing.join(", ") : "Complete";
}

export function profileCapacityLabel(hours?: number | null) {
  return personCapacityLabel(hours).replace("Capacity unset", "Unset");
}

export function profileWorkloadTone(cardCount: number, capacityHours?: number | null) {
  if (!cardCount) return "good";
  if (capacityHours == null) return cardCount > 5 ? "warn" : "neutral";
  const ratio = cardCount / Math.max(1, capacityHours / 4);
  if (ratio > 1.3) return "danger";
  if (ratio > 0.8) return "warn";
  return "good";
}

export function profileWorkloadLabel(cardCount: number, capacityHours?: number | null) {
  if (!cardCount) return "No assigned cards";
  const tone = profileWorkloadTone(cardCount, capacityHours);
  if (tone === "danger") return "Overloaded";
  if (tone === "warn") return "Tight load";
  return "Healthy load";
}

export function profileLocalTime(timezone?: string | null, now = new Date()) {
  return personLocalTime(timezone, now) || "Local time unavailable";
}

export function profileAvailabilityLabel(user?: Pick<User, "status" | "statusMessage" | "lastSeenAt" | "archived" | "capacityHours"> | Pick<UserActivitySummary, "status" | "statusMessage" | "lastSeenAt" | "lastActivityAt" | "archived" | "capacityHours"> | null) {
  if (!user) return "Unavailable";
  return personStatusSummary({ id: "availability", username: "availability", ...user }).availabilityLabel;
}
