import { parseClusterDeepLink } from "@cluster/shared";
import type { ClusterWorkNavigationTarget } from "./work-navigation-types";
import { clusterResourceNavigation } from "./resource-navigation";

/** Untrusted OS protocol input enters through the shared identity parser. */
export function desktopDeepLinkNavigation(value: string): ClusterWorkNavigationTarget | null {
  const target = parseClusterDeepLink(value);
  if (!target || target.type !== "resource") return null;
  // Special operations (security settings and Git revision lookup) have no
  // authoritative resource-navigation adapter yet and must not guess a route.
  const navigation = clusterResourceNavigation(target.resource);
  // Never claim a Project workspace can open a record when its Project
  // context is missing (legacy links may not carry one).
  if (navigation?.screen === "project" && !navigation.projectId) return null;
  if (target.resource.kind === "card") {
    if (!navigation) return null;
    // A Card's Board is mutable. The central authenticated Card admission
    // reads its current Board, even when this URI has no historical hint.
    return { ...navigation, boardId: target.boardId || null };
  }
  return navigation;
}
