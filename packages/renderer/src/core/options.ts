export const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time (America/New_York)" },
  { value: "America/Chicago", label: "Central Time (America/Chicago)" },
  { value: "America/Denver", label: "Mountain Time (America/Denver)" },
  { value: "America/Phoenix", label: "Arizona Time (America/Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific Time (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska Time (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Pacific/Honolulu)" },
  { value: "America/Toronto", label: "Toronto (America/Toronto)" },
  { value: "America/Vancouver", label: "Vancouver (America/Vancouver)" },
  { value: "America/Mexico_City", label: "Mexico City (America/Mexico_City)" },
  { value: "America/Sao_Paulo", label: "São Paulo (America/Sao_Paulo)" },
  { value: "Europe/London", label: "London (Europe/London)" },
  { value: "Europe/Berlin", label: "Berlin (Europe/Berlin)" },
  { value: "Europe/Paris", label: "Paris (Europe/Paris)" },
  { value: "Europe/Madrid", label: "Madrid (Europe/Madrid)" },
  { value: "Europe/Rome", label: "Rome (Europe/Rome)" },
  { value: "Europe/Warsaw", label: "Warsaw (Europe/Warsaw)" },
  { value: "Europe/Helsinki", label: "Helsinki (Europe/Helsinki)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (Africa/Johannesburg)" },
  { value: "Asia/Dubai", label: "Dubai (Asia/Dubai)" },
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { value: "Asia/Singapore", label: "Singapore (Asia/Singapore)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (Asia/Hong_Kong)" },
  { value: "Asia/Tokyo", label: "Tokyo (Asia/Tokyo)" },
  { value: "Asia/Seoul", label: "Seoul (Asia/Seoul)" },
  { value: "Australia/Perth", label: "Perth (Australia/Perth)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
  { value: "Pacific/Auckland", label: "Auckland (Pacific/Auckland)" }
] as const;

export const WORKING_DAY_OPTIONS = [
  { value: "Mon, Tue, Wed, Thu, Fri", label: "Weekdays (Monday–Friday)" },
  { value: "Mon, Tue, Wed, Thu, Fri, Sat, Sun", label: "Every day" },
  { value: "Sat, Sun", label: "Weekends" },
  { value: "Mon, Wed, Fri", label: "Monday, Wednesday, Friday" },
  { value: "Tue, Thu", label: "Tuesday and Thursday" },
  { value: "Mon", label: "Monday only" },
  { value: "Tue", label: "Tuesday only" },
  { value: "Wed", label: "Wednesday only" },
  { value: "Thu", label: "Thursday only" },
  { value: "Fri", label: "Friday only" },
  { value: "Sat", label: "Saturday only" },
  { value: "Sun", label: "Sunday only" }
] as const;

export function optionsWithCurrent(
  options: ReadonlyArray<{ value: string; label: string }>,
  current?: string | null,
  currentLabel?: string
) {
  const value = String(current || "").trim();
  if (!value || options.some((option) => option.value === value)) return [...options];
  return [{ value, label: currentLabel || `${value} (current)` }, ...options];
}
