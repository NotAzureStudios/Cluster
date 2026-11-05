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
