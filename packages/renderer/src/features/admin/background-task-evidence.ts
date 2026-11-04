export type BackgroundTaskEvidence = {
  name: string;
  owner?: string | null;
  consecutiveFailures: number;
  failures: number;
  lastError?: string | null;
  lastFinishedAt?: string | null;
  nextRunAt?: string | null;
  suspended?: boolean;
};

/** Operational health enters warning at three failures, failure at eight.
 * Read-only diagnostics must not invent a failing task when the last sample recovered.
 */
export function classifyBackgroundTask(task: BackgroundTaskEvidence): "failed" | "warning" | "recent" {
  return task.consecutiveFailures >= 8 ? "failed" : task.consecutiveFailures >= 3 ? "warning" : "recent";
}
export function failingBackgroundTasks(tasks: readonly BackgroundTaskEvidence[]): BackgroundTaskEvidence[] {
  return tasks.filter((task) => task.consecutiveFailures > 0).sort((a, b) =>
    b.consecutiveFailures - a.consecutiveFailures || a.name.localeCompare(b.name)).slice(0, 20);
}

/** Client-only second line of defense: the server already restricts operational
 * snapshots to admins. Never display raw credentials from task error strings. */
export function summarizeBackgroundTaskError(value: string | null | undefined): string {
  const text = String(value || "No error detail available").slice(0, 500);
  return text
    .replace(/(password|secret|token|api[_-]?key|authorization|credential)\s*[:=]\s*[^\s&,;]+/gi, "$1=[redacted]")
    .replace(/(https?:\/\/)[^\s@/]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:token|secret|key|password|access_token)=)[^\s&#]+/gi, "$1[redacted]")
    .slice(0, 260);
}
