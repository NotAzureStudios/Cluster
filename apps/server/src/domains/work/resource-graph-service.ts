import {
  CLUSTER_WORKFLOW_RELATIONSHIP_META,
  clusterResourceDefinition,
  clusterResourceKindFromEntityType,
  type ClusterResourceAddress,
  type ClusterResourceGraphDirection,
  type ClusterResourceGraphEdge,
  type ClusterResourceGraphNeighborhood,
  type ClusterResourceGraphQuery,
  CLUSTER_RESOURCE_GRAPH_CATEGORIES,
  type ClusterResourceKind,
  type ClusterWorkflowRelationship,
} from "@cluster/shared";

type ProjectRelationshipRow = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationship: string;
  description: string | null;
  critical: boolean;
  createdAt: Date | string;
};

function resourceKey(resource: ClusterResourceAddress) {
  return `${resource.kind}:${resource.projectId || ""}:${resource.id}`;
}

function graphProjectId(query: ClusterResourceGraphQuery) {
  const projectId = String(query.projectId || query.subject.projectId || (query.subject.kind === "project" ? query.subject.id : "")).trim();
  if (!projectId) throw new Error("Resource graph queries currently require a project scope.");
  return projectId;
}

function address(kind: ClusterResourceKind, id: string, projectId: string): ClusterResourceAddress {
  return clusterResourceDefinition(kind).projectScoped ? { kind, id, projectId } : { kind, id };
}

function mapEdge(row: ProjectRelationshipRow): ClusterResourceGraphEdge | null {
  const sourceKind = clusterResourceKindFromEntityType(row.sourceType);
  const targetKind = clusterResourceKindFromEntityType(row.targetType);
  const relationship = row.relationship as ClusterWorkflowRelationship;
  const meta = CLUSTER_WORKFLOW_RELATIONSHIP_META[relationship];
  if (!sourceKind || !targetKind || !meta) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    source: address(sourceKind, row.sourceId, row.projectId),
    target: address(targetKind, row.targetId, row.projectId),
    relationship,
    category: meta.category,
    critical: Boolean(row.critical),
    blocking: Boolean(meta.blocking),
    description: row.description || null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || "") || null,
  };
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Math.round(Number(value ?? fallback));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/**
 * Canonical graph facade over the existing ProjectRelationship authority.
 * No second graph store is introduced. Traversal is deliberately bounded so
 * admin/impact tools cannot accidentally turn one click into an unbounded walk.
 */
export function createResourceGraphService(prisma: any) {
  return {
    async neighborhood(
      query: ClusterResourceGraphQuery,
      options: { allowResource?: (resource: ClusterResourceAddress) => boolean | Promise<boolean> } = {},
    ): Promise<ClusterResourceGraphNeighborhood> {
      const projectId = graphProjectId(query);
      if ((query.subject.projectId && query.subject.projectId !== projectId) ||
          (query.subject.kind === "project" && query.subject.id !== projectId)) {
        throw new Error("Resource graph subject scope conflicts with the requested project.");
      }
      const direction: ClusterResourceGraphDirection = query.direction || "both";
      if (!["both", "incoming", "outgoing"].includes(direction)) throw new Error("Invalid resource graph direction.");
      if (query.category && !(CLUSTER_RESOURCE_GRAPH_CATEGORIES as readonly string[]).includes(query.category)) throw new Error("Invalid resource graph category.");
      const requestedDepth = boundedInt(query.depth, 1, 0, 4);
      const maxEdges = boundedInt(query.maxEdges, 250, 1, 1_000);
      const relationshipTypes = Object.entries(CLUSTER_WORKFLOW_RELATIONSHIP_META)
        .filter(([, meta]) => (!query.category || meta.category === query.category) && (!query.blockingOnly || meta.blocking))
        .map(([relationship]) => relationship);
      const subject: ClusterResourceAddress = clusterResourceDefinition(query.subject.kind).projectScoped
        ? { ...query.subject, projectId }
        : { kind: query.subject.kind, id: query.subject.id };

      const nodes = new Map<string, { resource: ClusterResourceAddress; depth: number }>();
      const edges = new Map<string, ClusterResourceGraphEdge>();
      const canView = new Map<string, Promise<boolean>>();
      async function visible(resource: ClusterResourceAddress) {
        if (!options.allowResource) return true;
        const key = resourceKey(resource);
        let pending = canView.get(key);
        if (!pending) {
          pending = Promise.resolve(options.allowResource(resource)).then(Boolean);
          canView.set(key, pending);
        }
        return pending;
      }
      // A service caller must never receive an unauthorized subject as a node.
      if (!(await visible(subject))) return {
        subject, projectId, direction, requestedDepth,
        nodes: [], edges: [], truncated: false,
      };
      nodes.set(resourceKey(subject), { resource: subject, depth: 0 });
      // This is an empty graph, not an excuse to query every relationship.
      if (!relationshipTypes.length) return {
        subject, projectId, direction, requestedDepth, nodes: [...nodes.values()], edges: [], truncated: false,
      };
      let frontier = [subject];
      let truncated = false;
      // Bound database row scans for the *whole neighborhood*, not once per
      // depth. Likewise bound OR clauses in each ProjectRelationship query.
      // Large graphs can be explored by focusing on another visible node.
      const scanBudget = Math.min(3000, Math.max(250, maxEdges * 4));
      const frontierBudget = 80;
      let totalScanned = 0;

      for (let depth = 1; depth <= requestedDepth && frontier.length && edges.size < maxEdges && totalScanned < scanBudget; depth += 1) {
        if (frontier.length > frontierBudget) {
          truncated = true;
          frontier = frontier.slice(0, frontierBudget);
        }
        const outgoing = direction !== "incoming" ? frontier.map((resource) => ({ sourceType: resource.kind, sourceId: resource.id })) : [];
        const incoming = direction !== "outgoing" ? frontier.map((resource) => ({ targetType: resource.kind, targetId: resource.id })) : [];
        const clauses = [...outgoing, ...incoming];
        if (!clauses.length) break;

        const next = new Map<string, ClusterResourceAddress>();
        // Permission-denied rows must not consume the *visible edge* budget.
        // Scan with a separate hard limit to bound expensive ACL-heavy graphs.
        const scanLimit = scanBudget - totalScanned;
        const pageSize = Math.min(250, Math.max(50, maxEdges + 1));
        let scanned = 0;
        let exhausted = false;
        let cappedWithUnread = false;
        while (scanned < scanLimit && edges.size < maxEdges) {
          const take = Math.min(pageSize, scanLimit - scanned);
          const rows: ProjectRelationshipRow[] = await prisma.projectRelationship.findMany({
            where: {
              projectId, OR: clauses,
              ...(query.category || query.blockingOnly ? { relationship: { in: relationshipTypes } } : {}),
              ...(query.criticalOnly ? { critical: true } : {}),
            },
            orderBy: [{ critical: "desc" }, { createdAt: "desc" }, { id: "asc" }],
            skip: scanned,
            take,
          });
          scanned += rows.length;
          totalScanned += rows.length;
          if (rows.length < take) exhausted = true;
          // Run a small bounded batch of independent ACL checks concurrently.
          // Keep insertion and traversal order deterministic and never query
          // labels before both endpoints have passed authorization.
          const aclBatchSize = 8;
          for (let offset = 0; offset < rows.length && edges.size < maxEdges; offset += aclBatchSize) {
            const batch = rows.slice(offset, offset + aclBatchSize);
            const authorized = await Promise.all(batch.map(async (row) => {
              if (edges.has(row.id)) return null;
              const edge = mapEdge(row);
              if (!edge || (query.category && edge.category !== query.category) ||
                  (query.blockingOnly && !edge.blocking) || (query.criticalOnly && !edge.critical)) return null;
              const [sourceAllowed, targetAllowed] = await Promise.all([visible(edge.source), visible(edge.target)]);
              return sourceAllowed && targetAllowed ? edge : null;
            }));
            for (let index = 0; index < authorized.length; index += 1) {
              const edge = authorized[index];
              if (!edge || edges.has(edge.id)) continue;
              if (edges.size >= maxEdges) { cappedWithUnread = true; break; }
              edges.set(edge.id, edge);
              for (const resource of [edge.source, edge.target]) {
                const key = resourceKey(resource);
                if (!nodes.has(key)) {
                  nodes.set(key, { resource, depth });
                  next.set(key, resource);
                }
              }
              if (edges.size >= maxEdges && offset + index < rows.length - 1) cappedWithUnread = true;
            }
          }
          if (exhausted) break;
        }
        if (cappedWithUnread || (!exhausted && (scanned >= scanLimit || edges.size >= maxEdges))) truncated = true;
        frontier = [...next.values()];
      }

      if (frontier.length && requestedDepth > 0 && totalScanned >= scanBudget && edges.size < maxEdges) truncated = true;

      return {
        subject,
        projectId,
        direction,
        requestedDepth,
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        truncated,
      };
    },
  };
}
