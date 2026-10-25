import type { ClusterImpactPreview, ClusterResourceAddress } from "@cluster/shared";
import { createResourceGraphService } from "./resource-graph-service.js";

export function createImpactAnalysisService(prisma: any) {
  const graph = createResourceGraphService(prisma);
  return {
    async forResource(resource: ClusterResourceAddress, options: { projectId?: string | null; depth?: number; maxEdges?: number } = {}): Promise<ClusterImpactPreview> {
      const neighborhood = await graph.neighborhood({
        subject: resource,
        projectId: options.projectId || resource.projectId || null,
        depth: options.depth ?? 2,
        maxEdges: options.maxEdges ?? 250,
        direction: "both",
      });
      const affectedResources = neighborhood.nodes
        .filter((node) => node.depth > 0)
        .map((node) => node.resource);
      const critical = neighborhood.edges.filter((edge) => edge.critical);
      const blocking = neighborhood.edges.filter((edge) => edge.blocking);
      const issues = [];
      if (critical.length) issues.push({
        code: "IMPACT_CRITICAL_RELATIONSHIPS",
        message: `${critical.length} critical relationship${critical.length === 1 ? "" : "s"} may be affected.`,
        severity: "warning" as const,
        resource,
        action: "review-impact",
      });
      if (blocking.length) issues.push({
        code: "IMPACT_BLOCKING_RELATIONSHIPS",
        message: `${blocking.length} blocking/dependency relationship${blocking.length === 1 ? "" : "s"} may be affected.`,
        severity: "warning" as const,
        resource,
        action: "review-dependencies",
      });
      if (neighborhood.truncated) issues.push({
        code: "IMPACT_GRAPH_TRUNCATED",
        message: "Impact analysis reached its safety limit; additional related resources may exist.",
        severity: "info" as const,
        resource,
        action: "refine-impact-scope",
      });
      return {
        summary: affectedResources.length
          ? `${affectedResources.length} related resource${affectedResources.length === 1 ? "" : "s"} found within ${neighborhood.requestedDepth} graph hop${neighborhood.requestedDepth === 1 ? "" : "s"}.`
          : "No related resources were found in the current project graph.",
        affectedResources,
        issues,
        metadata: {
          projectId: neighborhood.projectId,
          directCount: neighborhood.nodes.filter((node) => node.depth === 1).length,
          indirectCount: neighborhood.nodes.filter((node) => node.depth > 1).length,
          relationshipCount: neighborhood.edges.length,
          criticalRelationshipCount: critical.length,
          blockingRelationshipCount: blocking.length,
          truncated: neighborhood.truncated,
        },
      };
    },
  };
}
