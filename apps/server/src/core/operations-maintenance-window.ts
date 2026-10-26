/**
 * F4 P13: bounded, strictly advisory maintenance window calendar.
 *
 * Window configuration does not authorize a restart, drain, update, or worker
 * interruption. A native executor must independently verify its own authority,
 * a fresh preflight and the active window before taking any action.
 *
 * Evaluate real instants in an IANA timezone, rather than adding seven days to
 * a UTC timestamp. This preserves local wall-clock schedules across DST.
 */
export type MaintenanceWindowPolicy = {
  maintenanceWindowEnabled?: boolean;
  maintenanceWindowTimezone?: string;
  maintenanceWindowDaysCsv?: string;
  maintenanceWindowStart?: string;
  maintenanceWindowDurationMinutes?: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MAX_DURATION_MINUTES = 240;
const LOOKAHEAD_DAYS = 22;

export function validMaintenanceTimezone(value: string): boolean {
  if (!value || value.length > 64 || /[^A-Za-z0-9_+\-/]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

export function normalizeMaintenanceWindowPolicy(input: MaintenanceWindowPolicy) {
  const enabled = input.maintenanceWindowEnabled === undefined ? false : input.maintenanceWindowEnabled;
  if (typeof enabled !== "boolean") throw new Error("Maintenance window enabled must be a boolean.");
  const timezone = input.maintenanceWindowTimezone === undefined ? "America/New_York" : input.maintenanceWindowTimezone;
  if (typeof timezone !== "string" || !validMaintenanceTimezone(timezone)) throw new Error("Invalid IANA maintenance timezone.");
  const daysCsv = input.maintenanceWindowDaysCsv === undefined ? "Sun" : input.maintenanceWindowDaysCsv;
  if (typeof daysCsv !== "string" || daysCsv.length > 64) throw new Error("Invalid maintenance weekdays.");
  const tokens = daysCsv.split(",").map(s => s.trim());
  if (!tokens.length || tokens.some(s => !DAY_NAMES.includes(s as typeof DAY_NAMES[number])) || new Set(tokens).size !== tokens.length) {
    throw new Error("Maintenance weekdays must be unique comma-separated Sun, Mon, Tue, Wed, Thu, Fri, Sat values.");
  }
  const start = input.maintenanceWindowStart === undefined ? "03:00" : input.maintenanceWindowStart;
  if (typeof start !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error("Maintenance start must be HH:mm (24-hour clock).");
  const durationMinutes = input.maintenanceWindowDurationMinutes === undefined ? 60 : input.maintenanceWindowDurationMinutes;
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > MAX_DURATION_MINUTES) {
    throw new Error("Maintenance duration must be between 15 and 240 minutes.");
  }
  return { enabled, timezone, days: tokens, start, durationMinutes };
}

export function previewMaintenanceWindows(policy: MaintenanceWindowPolicy, options: { now?: number; count?: number } = {}) {
  const config = normalizeMaintenanceWindowPolicy(policy);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0 || !Number.isSafeInteger(Math.floor(now)) || !Number.isFinite(new Date(now).getTime())) throw new Error("Invalid maintenance calendar time.");
  const count = options.count ?? 3;
  if (!Number.isSafeInteger(count) || count < 1 || count > 6) throw new Error("Maintenance preview must contain one to six windows.");
  const result: Array<{ startAt: string; endAt: string; localDate: string; active: boolean }> = [];
  if (config.enabled) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const [startHour, startMinute] = config.start.split(":").map(Number);
    // Include earlier duplicate local-time occurrences even if they have already
    // expired. Otherwise a preview requested during the SECOND autumn 01:30
    // could incorrectly treat it as a fresh window after the first finished.
    const earliest = Math.floor((now - (config.durationMinutes + 24 * 60) * 60_000) / 60_000) * 60_000;
    const last = now + LOOKAHEAD_DAYS * 86_400_000;
    const seenLocalDates = new Set<string>();
    for (let instant = earliest; instant <= last && result.length < count; instant += 60_000) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
      if (!config.days.includes(parts.weekday) || Number(parts.hour) !== startHour || Number(parts.minute) !== startMinute) continue;
      const localDate = `${parts.year}-${parts.month}-${parts.day}`;
      if (seenLocalDates.has(localDate)) continue; // DST autumn repeated wall-clock time: use the first occurrence
      seenLocalDates.add(localDate);
      const end = instant + config.durationMinutes * 60_000;
      if (end <= now) continue;
      result.push({ startAt: new Date(instant).toISOString(), endAt: new Date(end).toISOString(), localDate, active: instant <= now });
    }
  }
  return {
    enabled: config.enabled,
    timezone: config.timezone,
    days: config.days,
    localStart: config.start,
    durationMinutes: config.durationMinutes,
    checkedAt: new Date(now).toISOString(),
    windows: result,
    executable: false as const,
    note: "Advisory maintenance calendar only. No reboot, update, drain, background job, or Windows Service action is scheduled or authorized. Native supervision, backup integrity, outage communication and fresh readiness checks remain required.",
  };
}
