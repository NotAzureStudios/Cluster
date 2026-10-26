import type { ClusterPersonPresenceState, ClusterPersonStatusSummary, ClusterPersonSummary } from "@cluster/shared";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export function personDisplayName(person?: Partial<Pick<ClusterPersonSummary, "preferredName" | "displayName" | "username">> | null) {
  return String(person?.preferredName || person?.displayName || person?.username || "Unassigned");
}

export function personInitial(person?: Partial<Pick<ClusterPersonSummary, "preferredName" | "displayName" | "username">> | null) {
  return personDisplayName(person).slice(0, 1).toUpperCase();
}

export function personLocalTime(timezone?: string | null, now = new Date()) {
  const zone = String(timezone || "").trim();
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(now);
  } catch {
    return null;
  }
}

function lastSignalAt(person?: Partial<Pick<ClusterPersonSummary, "lastSeenAt" | "lastActivityAt">> | null) {
  const values = [person?.lastSeenAt, person?.lastActivityAt]
    .map((value) => value ? new Date(value).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
}

export function personPresence(person?: Partial<Pick<ClusterPersonSummary, "status" | "archived" | "lastSeenAt" | "lastActivityAt">> | null, now = Date.now()): ClusterPersonPresenceState {
  if (!person || person.archived) return "offline";
  const declared = String(person.status || "").trim().toLowerCase();
  if (declared === "offline") return "offline";
  if (["focus", "busy", "dnd", "do_not_disturb"].includes(declared)) return "focus";
  if (["away", "idle"].includes(declared)) return "away";
  const signalAt = lastSignalAt(person);
  if (signalAt) {
    const age = Math.max(0, now - signalAt);
    if (age <= FIFTEEN_MINUTES) return "available";
    if (age <= TWENTY_FOUR_HOURS) return "recent";
    return "offline";
  }
  return declared === "available" || declared === "online" || declared === "active" ? "available" : "offline";
}

export function personPresenceLabel(person?: Partial<Pick<ClusterPersonSummary, "status" | "archived" | "lastSeenAt" | "lastActivityAt">> | null, now = Date.now()) {
  const state = personPresence(person, now);
  const declared = String(person?.status || "").trim().toLowerCase();
  if (state === "available") return "Available now";
  if (state === "recent") return "Recently active";
  if (state === "focus") return declared === "do_not_disturb" || declared === "dnd" ? "Do not disturb" : declared === "busy" ? "Busy" : "Focus mode";
  if (state === "away") return "Away";
  return "Offline";
}

export function personCapacityLabel(hours?: number | null) {
  if (hours == null) return "Capacity unset";
  if (hours >= 36) return `${hours}h/week`;
  if (hours >= 20) return `${hours}h/week · part-time`;
  return `${hours}h/week · limited`;
}

function workingHoursState(person?: Partial<ClusterPersonSummary> | null, now = new Date()): "inside" | "outside" | "unknown" {
  const hours = person?.workingHours;
  if (!hours || typeof hours !== "object") return "unknown";
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  const configured = days.some((day) => Array.isArray(hours[day]) && (hours[day] || []).length > 0);
  if (!configured) return "unknown";
  const timeZone = String(hours.timezone || person?.timezone || "").trim();
  if (!timeZone) return "unknown";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const weekday = String(parts.find((part) => part.type === "weekday")?.value || "").toLowerCase() as typeof days[number];
    const hour = String(parts.find((part) => part.type === "hour")?.value || "00").padStart(2, "0");
    const minute = String(parts.find((part) => part.type === "minute")?.value || "00").padStart(2, "0");
    const localClock = `${hour}:${minute}`;
    const intervals = Array.isArray(hours[weekday]) ? hours[weekday] || [] : [];
    return intervals.some((interval) => interval && interval.start <= localClock && localClock < interval.end) ? "inside" : "outside";
  } catch {
    return "unknown";
  }
}

export function personStatusSummary(person?: Partial<ClusterPersonSummary> | null, now = new Date()): ClusterPersonStatusSummary {
  const presence = personPresence(person, now.getTime());
  const capacityHours = person?.capacityHours ?? null;
  const workingState = workingHoursState(person, now);
  const availability = person?.archived || presence === "offline"
    ? "unavailable"
    : presence === "focus"
      ? "focus"
      : presence === "away" || presence === "recent"
        ? "away"
        : workingState === "outside"
          ? "limited"
        : capacityHours != null && capacityHours < 20
          ? "limited"
          : "available";
  const availabilityLabel = availability === "available"
    ? "Available"
    : availability === "focus"
      ? "Focus mode"
      : availability === "away"
        ? presence === "recent" ? "Recently active" : "Away"
        : availability === "limited"
          ? workingState === "outside" ? "Outside working hours" : "Limited capacity"
          : "Unavailable";
  return {
    presence,
    presenceLabel: personPresenceLabel(person, now.getTime()),
    availability,
    availabilityLabel,
    localTimeLabel: personLocalTime(person?.timezone, now),
    capacityLabel: personCapacityLabel(capacityHours),
  };
}

export function personMetaLabel(person: ClusterPersonSummary, options: { localTime?: boolean; capacity?: boolean; role?: boolean } = {}) {
  const summary = personStatusSummary(person);
  return [
    options.role !== false ? person.title || person.department || person.teamName || null : null,
    summary.availabilityLabel,
    options.localTime !== false ? summary.localTimeLabel : null,
    options.capacity ? summary.capacityLabel : null,
  ].filter(Boolean).join(" · ");
}
