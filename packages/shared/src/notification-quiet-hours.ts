/** Canonical quiet-hours clock shared by the server and web/Desktop clients.
 * A client machine's local timezone must never silently redefine a member's
 * notification schedule. Use the working-pattern/profile IANA timezone and
 * a deterministic UTC fallback when it is unavailable or invalid.
 */
export function notificationClockMinutes(now: Date, timeZone: string | null | undefined): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const hours = Number(parts.hour);
    const minutes = Number(parts.minute);
    if (Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60)
      return hours * 60 + minutes;
  } catch {
    // An invalid zone must not switch to the device's local time.
  }
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function clockMinutes(value: unknown, fallback: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : fallback;
}

export function notificationQuietHoursForZone(
  preferences: Record<string, unknown> | null | undefined,
  timeZone: string | null | undefined,
  now = new Date(),
): boolean {
  if (preferences?.userQuietHoursEnabled !== true) return false;
  const start = clockMinutes(preferences.userQuietHoursStart, 18 * 60);
  const end = clockMinutes(preferences.userQuietHoursEnd, 9 * 60);
  const current = notificationClockMinutes(now, timeZone);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
