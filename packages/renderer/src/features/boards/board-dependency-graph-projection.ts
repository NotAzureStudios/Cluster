import type { BoardPlanningDependency } from "@cluster/shared";

/** Select *visible local* graph nodes before enforcing visual bounds.
 * Projected Cards remain actionable in Blocked Work, but the graph never
 * fabricates nodes or metadata for cross-Board entities. */
export function projectBoardDependencyGraph(
  relationships: readonly BoardPlanningDependency[],
  localIds: ReadonlySet<string>,
  blockedIds: ReadonlySet<string>,
  nodeLimit = 24,
  edgeLimit = 36,
) {
  const linked = new Set<string>();
  let crossBoardEdgeCount = 0;
  let localEdgeCount = 0;
  for (const edge of relationships) {
    const sourceLocal = localIds.has(edge.sourceCardId);
    const targetLocal = localIds.has(edge.targetCardId);
    if (sourceLocal) linked.add(edge.sourceCardId);
    if (targetLocal) linked.add(edge.targetCardId);
    if (sourceLocal && targetLocal) localEdgeCount += 1;
    else if (sourceLocal !== targetLocal) crossBoardEdgeCount += 1;
  }

  // Bring actionable blocked Cards to the front without changing the relative
  // order of items within each group or creating nonlocal graph nodes.
  const allLocalIds = [...linked];
  const prioritized = [
    ...allLocalIds.filter((id) => blockedIds.has(id)),
    ...allLocalIds.filter((id) => !blockedIds.has(id)),
  ];
  const safeNodes = Number.isSafeInteger(nodeLimit) ? Math.max(0, nodeLimit) : 0;
  const safeEdges = Number.isSafeInteger(edgeLimit) ? Math.max(0, edgeLimit) : 0;
  const visibleIds = prioritized.slice(0, safeNodes);
  const visibleSet = new Set(visibleIds);
  const visibleEdges = relationships
    .filter((edge) => visibleSet.has(edge.sourceCardId) && visibleSet.has(edge.targetCardId))
    .slice(0, safeEdges);

  return {
    visibleIds,
    visibleEdges,
    localNodeCount: prioritized.length,
    localEdgeCount,
    crossBoardEdgeCount,
    hiddenLocalNodeCount: Math.max(0, prioritized.length - visibleIds.length),
    hiddenLocalEdgeCount: Math.max(0, localEdgeCount - visibleEdges.length),
  };
}
