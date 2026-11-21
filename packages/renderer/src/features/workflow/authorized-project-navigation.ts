import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/** The project snapshot names its project as `projectId`; older reads used `id`. */
export type AuthorizedProjectRead = { id?: string; projectId?: string } | null;

/** Direct Project links need a fresh authenticated project read before URL mutation. */
export async function resolveAuthorizedProjectNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (projectId: string) => Promise<AuthorizedProjectRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent() || target.screen !== "project") return null;
  const id = target.projectId;
  if (typeof id !== "string" || !id.trim() || id.length > 200) return null;
  try {
    const project = await input.read(id);
    if (!input.isCurrent() || !project || (project.projectId ?? project.id) !== id) return null;
    return target;
  } catch {
    return null;
  }
}
