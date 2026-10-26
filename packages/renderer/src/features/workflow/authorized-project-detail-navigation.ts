import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

type ProjectDetail = { scope: string; endpoint: string; envelope: "direct" | "review" | "commit" };
const PROJECT_DETAILS: readonly ProjectDetail[] = [
  { scope: "build-artifact", endpoint: "delivery/build", envelope: "direct" },
  { scope: "qa-plan", endpoint: "delivery/qa-plan", envelope: "direct" },
  { scope: "qa-session", endpoint: "delivery/qa-session", envelope: "direct" },
  { scope: "release", endpoint: "delivery/release", envelope: "direct" },
  { scope: "source-review", endpoint: "source-control/reviews", envelope: "review" },
  { scope: "source-commit", endpoint: "source-control/commits", envelope: "commit" },
];

export type ProjectDetailRead = {
  id?: unknown;
  projectId?: unknown;
  review?: { id?: unknown } | null;
  commit?: { id?: unknown } | null;
} | null;

function routeFor(target: ClusterWorkNavigationTarget): ProjectDetail | null {
  return target.screen === "project" ? PROJECT_DETAILS.find((item) => item.scope === target.inspectScope) || null : null;
}

export function requiresAuthorizedProjectDetailNavigation(target: ClusterWorkNavigationTarget): boolean {
  return routeFor(target) !== null;
}

/**
 * A Project snapshot only verifies the parent Project. Protect nested
 * Build/QA/Source inspectors with their own bounded exact authorized reader.
 * Reuse the domain's current ACL rather than inferring access from a URL.
 */
export async function resolveAuthorizedProjectDetailNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (path: string) => Promise<ProjectDetailRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent()) return null;
  const route = routeFor(target);
  const projectId = target.projectId;
  const id = target.inspectId;
  if (!route || typeof id !== "string" || !id.trim() || id.length > 200 ||
    typeof projectId !== "string" || !projectId.trim() || projectId.length > 200) return null;
  try {
    const record = await input.read(`/api/projects/${encodeURIComponent(projectId)}/${route.endpoint}/${encodeURIComponent(id)}`);
    if (!input.isCurrent() || !record || typeof record !== "object") return null;
    const current = route.envelope === "review" ? record.review : route.envelope === "commit" ? record.commit : record;
    if (!current || current.id !== id) return null;
    // Delivery records explicitly store their Project. Source readers
    // independently constrain Project and active source binding at the API.
    if (route.envelope === "direct" && record.projectId !== projectId) return null;
    return target;
  } catch {
    return null;
  }
}
