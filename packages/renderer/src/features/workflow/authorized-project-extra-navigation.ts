import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

type ExtraScope = "project-asset" | "project-control" | "review-asset" | "source-repository";
type ExtraRead = {
  id?: unknown;
  projectId?: unknown;
  asset?: { id?: unknown; projectId?: unknown } | null;
  records?: Array<{ id?: unknown; projectId?: unknown }>;
  binding?: { repositoryId?: unknown } | null;
} | null;

function supportedScope(target: ClusterWorkNavigationTarget): ExtraScope | null {
  if (target.screen !== "project" || !target.inspectId) return null;
  switch (target.inspectScope) {
    case "project-asset":
    case "project-control":
    case "review-asset":
    case "source-repository": return target.inspectScope;
    default: return null;
  }
}
export function requiresAuthorizedProjectExtraNavigation(target: ClusterWorkNavigationTarget): boolean {
  return supportedScope(target) !== null;
}

/** Fail-closed exact child reads; a valid parent Project is not proof that
 * an asset, control record, review or repository is still visible.
 * Reuse existing per-record and filtered-workspace API authorities.
 */
export async function resolveAuthorizedProjectExtraNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (path: string) => Promise<ExtraRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  const scope = supportedScope(target);
  const projectId = target.projectId;
  const id = target.inspectId;
  if (!input.isCurrent() || !scope || typeof id !== "string" || !id.trim() || id.length > 200 ||
      typeof projectId !== "string" || !projectId.trim() || projectId.length > 200) return null;
  try {
    const project = encodeURIComponent(projectId);
    const record = encodeURIComponent(id);
    const path = scope === "project-asset" ? `/api/project-files/${record}`
      : scope === "review-asset" ? `/api/review-assets/${record}/session`
      : scope === "project-control" ? `/api/projects/${project}/control-center`
      : `/api/projects/${project}/source-control`;
    const result = await input.read(path);
    if (!input.isCurrent() || !result || typeof result !== "object") return null;
    if (scope === "project-asset") {
      if (result.id !== id || typeof result.projectId !== "string" || !result.projectId.trim() || result.projectId.length > 200) return null;
      // Project files can be relocated; use the server's current authorized owner.
      return { ...target, projectId: result.projectId };
    }
    if (scope === "review-asset") {
      if (result.asset?.id !== id || result.asset.projectId !== projectId) return null;
    } else if (scope === "project-control") {
      if (result.projectId !== projectId || !Array.isArray(result.records) ||
          !result.records.some((row) => row?.id === id)) return null;
    } else {
      if (result.projectId !== projectId || result.binding?.repositoryId !== id) return null;
    }
    return target;
  } catch {
    return null;
  }
}
