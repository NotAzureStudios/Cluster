/** Shared Project portfolio snapshot request planner.
 * Keep the current authorized portfolio list authoritative and avoid
 * repeatedly downloading every already-fetched snapshot when another page
 * of projects is appended to the cursor.
 */
export type ProjectSnapshotCandidate = { id: string; updatedAt?: string | null };

export function projectRevisionKey(projects: readonly ProjectSnapshotCandidate[]): string {
  return JSON.stringify(projects.map((project) => [project.id, project.updatedAt || ""]));
}

export function planMissingProjectSnapshotBatches(
  projects: readonly ProjectSnapshotCandidate[],
  fetchedRevisions: ReadonlyMap<string, string>,
  batchSize = 40,
): string[][] {
  const limit = Math.max(1, Math.min(80, Math.floor(batchSize) || 40));
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    if (!project.id || seen.has(project.id)) continue;
    seen.add(project.id);
    if (fetchedRevisions.get(project.id) !== (project.updatedAt || "")) missing.push(project.id);
  }
  const batches: string[][] = [];
  for (let offset = 0; offset < missing.length; offset += limit) {
    batches.push(missing.slice(offset, offset + limit));
  }
  return batches;
}

/**
 * Project snapshot fields depend on several independent domains, not just
 * project.updatedAt. An unscoped event requires conservative invalidation.
 * Irrelevant events should not wake every loaded portfolio.
 */
export const PROJECT_SNAPSHOT_DEPENDENCY_KINDS = [
  // Derived snapshot contents: project readiness, schedule, lead, builds and QA.
  "project", "board", "timeline", "calendar", "meeting",
  "build", "qa_plan", "qa_session", "release", "approval",
  // These may change displayed identity or effective permissions.
  "user", "team", "department", "job_role", "policy",
] as const;

const GLOBAL_SNAPSHOT_INVALIDATION_KINDS: ReadonlySet<string> =
  new Set(["user", "team", "department", "job_role", "policy"]);

/** Retry failed network batches with capped backoff, not an idle polling loop. */
export function projectSnapshotRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(4, Math.floor(Number.isFinite(attempt) ? attempt : 1) - 1));
  return Math.min(60_000, 5_000 * 2 ** index);
}

export function projectSnapshotInvalidationTarget(change: {
  resource: { kind: string; id: string; projectId?: string | null };
}): string | "all" | null {
  const resource = change.resource;
  if (!(PROJECT_SNAPSHOT_DEPENDENCY_KINDS as readonly string[]).includes(resource.kind)) return null;
  if (resource.kind === "project") return resource.id || "all";
  if (GLOBAL_SNAPSHOT_INVALIDATION_KINDS.has(resource.kind)) return "all";
  return resource.projectId || "all";
}
