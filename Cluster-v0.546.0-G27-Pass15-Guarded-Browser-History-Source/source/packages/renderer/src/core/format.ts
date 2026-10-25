export function levelLabel(level: string) {
  return level.slice(0, 1).toUpperCase() + level.slice(1);
}

export function formatDueDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return "No activity yet";
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return "No activity yet";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(value).toLocaleDateString();
}
