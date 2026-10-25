export type OperatorAlertPreferences = {
  acknowledged: Record<string, string>;
  snoozedUntil: Record<string, string>;
};

export type OperatorAlertPreferenceAction = "acknowledge" | "unacknowledge" | "snooze" | "unsnooze";

export function parsePreferenceRecord(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function cleanOperatorAlertPreferences(value: unknown, now = Date.now()): OperatorAlertPreferences {
  const parsed = parsePreferenceRecord(value);
  const acknowledged = parsePreferenceRecord(parsed.acknowledged);
  const snoozedUntil = parsePreferenceRecord(parsed.snoozedUntil);
  const cleanMap = (source: Record<string, any>, keepExpired = true) => Object.fromEntries(
    Object.entries(source)
      .filter(([key, stamp]) => /^[a-z0-9:_-]{1,120}$/i.test(key)
        && Number.isFinite(new Date(String(stamp)).getTime())
        && (keepExpired || new Date(String(stamp)).getTime() > now))
      .sort((a, b) => new Date(String(b[1])).getTime() - new Date(String(a[1])).getTime())
      .slice(0, 96)
      .map(([key, stamp]) => [key, new Date(String(stamp)).toISOString()]),
  );
  return { acknowledged: cleanMap(acknowledged), snoozedUntil: cleanMap(snoozedUntil, false) };
}

export function applyOperatorAlertPreference(
  current: unknown,
  input: { alertId: string; action: OperatorAlertPreferenceAction; snoozeMinutes?: number },
  now = Date.now(),
): OperatorAlertPreferences {
  const next = cleanOperatorAlertPreferences(current, now);
  if (input.action === "acknowledge") next.acknowledged[input.alertId] = new Date(now).toISOString();
  else if (input.action === "unacknowledge") delete next.acknowledged[input.alertId];
  else if (input.action === "snooze") next.snoozedUntil[input.alertId] = new Date(now + Math.max(5, Math.min(7 * 24 * 60, input.snoozeMinutes || 60)) * 60_000).toISOString();
  else delete next.snoozedUntil[input.alertId];
  return cleanOperatorAlertPreferences(next, now);
}
