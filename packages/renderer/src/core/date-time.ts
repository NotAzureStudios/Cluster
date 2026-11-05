export function minutesToHuman(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function weekStart(value = new Date()) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = date.getDate() - day;
  return new Date(date.getFullYear(), date.getMonth(), diff, 0, 0, 0, 0);
}

export function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function toDateTimeLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function compactDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Date-only native fields and create handoffs are local civil dates, not
 * midnight-UTC timestamps. The latter can shift to yesterday/tomorrow in
 * time zones far from UTC. */
export function toLocalDateInput(value: Date = new Date()): string {
  if (!Number.isFinite(value.getTime())) return "";
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

