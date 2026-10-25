import { CLUSTER_WORKFLOW_RELATIONSHIP_META, type ClusterWorkflowRelationship } from "@cluster/shared";

type Relationship = {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationship: string;
  critical?: boolean;
  description?: string | null;
};

type Node = { id: string; title?: string; kind?: string; entityId?: string; status?: string; priority?: string | null; dueDate?: string | Date | null };

type DirectedDependency = {
  id: string;
  relationshipId: string;
  prerequisite: string;
  dependent: string;
  relationship: string;
  critical: boolean;
  description?: string | null;
};

function normalize(value: unknown) { return String(value || "").trim().toLowerCase().replace(/-/g, "_"); }
function nodeKey(kind: unknown, id: unknown) { return `${normalize(kind) || "related"}:${String(id || "")}`; }
function isClosed(value: unknown) { return ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "released", "passed", "go", "archived", "cancelled"].includes(normalize(value)); }

function dependencyDirection(relationship: Relationship): DirectedDependency | null {
  const type = normalize(relationship.relationship) as ClusterWorkflowRelationship;
  if (!CLUSTER_WORKFLOW_RELATIONSHIP_META[type]?.blocking) return null;
  const source = nodeKey(relationship.sourceType, relationship.sourceId);
  const target = nodeKey(relationship.targetType, relationship.targetId);
  if (type === "blocks") return { id: `dependency:${relationship.id}`, relationshipId: relationship.id, prerequisite: source, dependent: target, relationship: type, critical: Boolean(relationship.critical), description: relationship.description || null };
  return { id: `dependency:${relationship.id}`, relationshipId: relationship.id, prerequisite: target, dependent: source, relationship: type, critical: Boolean(relationship.critical), description: relationship.description || null };
}

function cyclePaths(nodes: string[], adjacency: Map<string, DirectedDependency[]>) {
  const state = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const signatures = new Set<string>();
  const visit = (node: string) => {
    if (cycles.length >= 20) return;
    state.set(node, 1);
    stack.push(node);
    for (const edge of adjacency.get(node) || []) {
      const next = edge.dependent;
      if (state.get(next) === 1) {
        const index = stack.lastIndexOf(next);
        const path = [...stack.slice(Math.max(0, index)), next];
        const signature = [...new Set(path.slice(0, -1))].sort().join("|");
        if (signature && !signatures.has(signature)) { signatures.add(signature); cycles.push(path); }
      } else if (!state.get(next)) visit(next);
      if (cycles.length >= 20) break;
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of nodes) if (!state.get(node)) visit(node);
  return cycles;
}

function longestDependencyPath(nodes: string[], edges: DirectedDependency[]) {
  const indegree = new Map(nodes.map((node) => [node, 0]));
  const adjacency = new Map<string, DirectedDependency[]>();
  for (const edge of edges) {
    adjacency.set(edge.prerequisite, [...(adjacency.get(edge.prerequisite) || []), edge]);
    indegree.set(edge.dependent, (indegree.get(edge.dependent) || 0) + 1);
    if (!indegree.has(edge.prerequisite)) indegree.set(edge.prerequisite, 0);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([node]) => node);
  const distance = new Map<string, number>();
  const previous = new Map<string, { node: string; edge: DirectedDependency }>();
  for (const node of queue) distance.set(node, 0);
  let visited = 0;
  while (queue.length) {
    const node = queue.shift()!;
    visited += 1;
    for (const edge of adjacency.get(node) || []) {
      const weight = edge.critical ? 2 : 1;
      const candidate = (distance.get(node) || 0) + weight;
      if (candidate > (distance.get(edge.dependent) ?? -1)) {
        distance.set(edge.dependent, candidate);
        previous.set(edge.dependent, { node, edge });
      }
      const nextDegree = (indegree.get(edge.dependent) || 1) - 1;
      indegree.set(edge.dependent, nextDegree);
      if (nextDegree === 0) queue.push(edge.dependent);
    }
  }
  if (visited < indegree.size) return { nodeIds: [] as string[], edgeIds: [] as string[], weight: 0, cyclic: true };
  let end = "";
  let weight = -1;
  for (const [node, value] of distance) if (value > weight) { end = node; weight = value; }
  if (!end || weight <= 0) return { nodeIds: [] as string[], edgeIds: [] as string[], weight: 0, cyclic: false };
  const nodeIds = [end];
  const edgeIds: string[] = [];
  while (previous.has(end)) {
    const prior = previous.get(end)!;
    edgeIds.unshift(prior.edge.relationshipId);
    nodeIds.unshift(prior.node);
    end = prior.node;
  }
  return { nodeIds, edgeIds, weight, cyclic: false };
}

export function analyzeProjectDependencies(projectId: string, relationships: Relationship[], nodesInput: Map<string, Node>) {
  const directed = relationships.map(dependencyDirection).filter((edge): edge is DirectedDependency => Boolean(edge));
  const graphNodes = Array.from(new Set(directed.flatMap((edge) => [edge.prerequisite, edge.dependent])));
  const adjacency = new Map<string, DirectedDependency[]>();
  for (const edge of directed) adjacency.set(edge.prerequisite, [...(adjacency.get(edge.prerequisite) || []), edge]);
  const cycles = cyclePaths(graphNodes, adjacency);
  const criticalPath = cycles.length ? { nodeIds: [] as string[], edgeIds: [] as string[], weight: 0, cyclic: true } : longestDependencyPath(graphNodes, directed);
  const openEdges = directed.filter((edge) => {
    const prerequisite = nodesInput.get(edge.prerequisite);
    return !prerequisite || !isClosed(prerequisite.status);
  });
  const crossProject = relationships.filter((relationship) => {
    if (relationship.sourceType === "project" && relationship.sourceId !== projectId) return true;
    if (relationship.targetType === "project" && relationship.targetId !== projectId) return true;
    return (relationship.sourceType === "project" && relationship.targetType === "project" && relationship.sourceId !== relationship.targetId);
  }).map((relationship) => ({
    id: relationship.id,
    relationship: relationship.relationship,
    critical: Boolean(relationship.critical),
    sourceProjectId: relationship.sourceType === "project" ? relationship.sourceId : projectId,
    targetProjectId: relationship.targetType === "project" ? relationship.targetId : projectId,
    description: relationship.description || null,
  }));
  const describeNode = (id: string) => {
    const node = nodesInput.get(id);
    return { id, title: node?.title || id, kind: node?.kind || id.split(":", 1)[0], status: node?.status || "linked", priority: node?.priority || null, dueDate: node?.dueDate || null };
  };
  const cycleDetails = cycles.map((path) => ({ nodeIds: path, nodes: path.map(describeNode) }));
  return {
    edgeCount: directed.length,
    openEdgeCount: openEdges.length,
    criticalEdgeCount: directed.filter((edge) => edge.critical).length,
    cycles: cycleDetails,
    hasCycles: cycleDetails.length > 0,
    criticalPath: { ...criticalPath, nodes: criticalPath.nodeIds.map(describeNode) },
    openDependencies: openEdges.slice(0, 100).map((edge) => ({ ...edge, prerequisiteNode: describeNode(edge.prerequisite), dependentNode: describeNode(edge.dependent) })),
    crossProject: crossProject.slice(0, 100),
  };
}
