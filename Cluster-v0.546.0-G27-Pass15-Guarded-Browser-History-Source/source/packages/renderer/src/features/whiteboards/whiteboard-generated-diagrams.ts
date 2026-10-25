import { clusterResourceKindFromEntityType, type ClusterResourceAddress } from "@cluster/shared";
import type { WhiteboardCardElement, WhiteboardConnectorElement, WhiteboardElement, WhiteboardShapeElement } from "../application/application-models";
import type { ProjectControlCenterPayload, ProjectRelationship } from "../projects/project-control-model";
import { makeWhiteboardId } from "./whiteboard-elements";

const NODE_WIDTH = 244;
const NODE_HEIGHT = 116;
const COLUMN_GAP = 110;
const ROW_GAP = 42;
const MAX_DIAGRAM_NODES = 80;
const MAX_DIAGRAM_EDGES = 140;

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nodeKey(type: string, id: string) {
  return `${type}:${id}`;
}

function resourceFor(type: string, id: string, projectId: string): ClusterResourceAddress | null {
  const kind = clusterResourceKindFromEntityType(type);
  return kind ? { kind, id, projectId } : null;
}

function labelLookup(payload: ProjectControlCenterPayload) {
  const labels = new Map<string, { title: string; detail: string; status: string; updatedAt?: string | null }>();
  for (const record of payload.records || []) {
    labels.set(nodeKey("control", record.id), { title: record.title, detail: `${humanize(record.kind)} · ${humanize(record.status)}`, status: record.status, updatedAt: record.updatedAt });
    labels.set(nodeKey(record.kind, record.id), { title: record.title, detail: `${humanize(record.kind)} · ${humanize(record.status)}`, status: record.status, updatedAt: record.updatedAt });
    if (record.linkedEntity?.type && record.linkedEntity.id) labels.set(nodeKey(record.linkedEntity.type, record.linkedEntity.id), { title: record.linkedEntity.title, detail: record.linkedEntity.subtitle || humanize(record.linkedEntity.type), status: record.linkedEntity.status, updatedAt: record.linkedEntity.updatedAt });
  }
  for (const candidate of payload.linkCandidates || []) {
    labels.set(nodeKey(candidate.type, candidate.id), { title: candidate.title, detail: candidate.subtitle || humanize(candidate.type), status: candidate.status, updatedAt: candidate.updatedAt });
  }
  return labels;
}

function diagramRanks(relationships: ProjectRelationship[]) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const link of relationships) {
    const source = nodeKey(link.sourceType, link.sourceId);
    const target = nodeKey(link.targetType, link.targetId);
    nodes.add(source); nodes.add(target);
    if (!incoming.has(source)) incoming.set(source, 0);
    incoming.set(target, (incoming.get(target) || 0) + 1);
    outgoing.set(source, [...(outgoing.get(source) || []), target]);
  }
  const rank = new Map<string, number>();
  const queue = Array.from(nodes).filter((key) => (incoming.get(key) || 0) === 0);
  for (const key of queue) rank.set(key, 0);
  let cursor = 0;
  while (cursor < queue.length) {
    const source = queue[cursor++];
    const nextRank = (rank.get(source) || 0) + 1;
    for (const target of outgoing.get(source) || []) {
      rank.set(target, Math.max(rank.get(target) || 0, nextRank));
      incoming.set(target, Math.max(0, (incoming.get(target) || 0) - 1));
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const key of nodes) if (!rank.has(key)) rank.set(key, 0);
  return rank;
}

export function buildProjectRelationshipDiagram(payload: ProjectControlCenterPayload, origin = { x: 140, y: 140 }) {
  const relationships = (payload.relationships || []).slice(0, MAX_DIAGRAM_EDGES);
  const labels = labelLookup(payload);
  const ranks = diagramRanks(relationships);
  const rawNodes = Array.from(new Set(relationships.flatMap((link) => [nodeKey(link.sourceType, link.sourceId), nodeKey(link.targetType, link.targetId)]))).slice(0, MAX_DIAGRAM_NODES);
  const nodeSet = new Set(rawNodes);
  const grouped = new Map<number, string[]>();
  for (const key of rawNodes) {
    const value = Math.min(8, ranks.get(key) || 0);
    grouped.set(value, [...(grouped.get(value) || []), key]);
  }
  const cardByKey = new Map<string, WhiteboardCardElement>();
  const elements: WhiteboardElement[] = [];
  const frameId = makeWhiteboardId();
  let maxRows = 1;
  let maxRank = 0;
  for (const [rank, keys] of Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])) {
    maxRank = Math.max(maxRank, rank);
    maxRows = Math.max(maxRows, keys.length);
    keys.sort((a, b) => a.localeCompare(b));
    keys.forEach((key, row) => {
      const split = key.indexOf(":");
      const type = key.slice(0, split);
      const id = key.slice(split + 1);
      const meta = labels.get(key);
      const resource = resourceFor(type, id, payload.projectId);
      const card: WhiteboardCardElement = {
        id: makeWhiteboardId(), type: "card",
        x: origin.x + 50 + rank * (NODE_WIDTH + COLUMN_GAP), y: origin.y + 82 + row * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH, height: NODE_HEIGHT,
        title: meta?.title || `${humanize(type)} ${id.slice(0, 8)}`,
        text: meta?.detail || `Live ${humanize(type)} reference`,
        accent: resource ? "#2563eb" : "#64748b", fill: "#f8fafc", textColor: "#0f172a",
        resource,
        resourceKindLabel: humanize(resource?.kind || type),
        resourceStatus: meta?.status || null,
        resourceDetail: meta?.detail || null,
        resourceUpdatedAt: meta?.updatedAt || null,
      };
      cardByKey.set(key, card);
      elements.push(card);
    });
  }
  for (const link of relationships) {
    const sourceKey = nodeKey(link.sourceType, link.sourceId);
    const targetKey = nodeKey(link.targetType, link.targetId);
    if (!nodeSet.has(sourceKey) || !nodeSet.has(targetKey)) continue;
    const source = cardByKey.get(sourceKey);
    const target = cardByKey.get(targetKey);
    if (!source || !target) continue;
    const connector: WhiteboardConnectorElement = {
      id: makeWhiteboardId(), type: "arrow",
      x1: source.x + source.width, y1: source.y + source.height / 2,
      x2: target.x, y2: target.y + target.height / 2,
      text: humanize(link.relationship), stroke: link.critical ? "#dc2626" : "#64748b", strokeWidth: link.critical ? 3 : 2,
      dashed: !link.critical, fromId: source.id, toId: target.id,
    };
    elements.push(connector);
  }
  const frame: WhiteboardShapeElement = {
    id: frameId, type: "frame", x: origin.x, y: origin.y,
    width: Math.max(640, (maxRank + 1) * (NODE_WIDTH + COLUMN_GAP) + 40),
    height: Math.max(360, maxRows * (NODE_HEIGHT + ROW_GAP) + 120),
    text: `Project relationship graph · ${relationships.length} link${relationships.length === 1 ? "" : "s"}`,
    stroke: "#2563eb", strokeWidth: 2, fill: "rgba(37,99,235,0.04)", textColor: "#0f172a", dashed: true, section: true,
  };
  return { elements: [frame, ...elements], nodeCount: cardByKey.size, relationshipCount: relationships.length, truncated: (payload.relationships || []).length > relationships.length || rawNodes.length >= MAX_DIAGRAM_NODES };
}

export type WhiteboardSourceControlDiagramPayload = {
  projectId: string;
  repository: { id: string; name: string; defaultBranch: string; syncState?: string | null; lastSyncedAt?: string | null } | null;
  branches: Array<{ id: string; name: string; headRevision?: string | null; isDefault: boolean; protected: boolean; aheadCount: number; behindCount: number; lastCommitAt?: string | null }>;
  reviews?: Array<{ id: string; title: string; sourceBranch: string; targetBranch: string; status: string; eligibilityState?: string; updatedAt: string }>;
};

export function buildSourceControlDiagram(payload: WhiteboardSourceControlDiagramPayload, origin = { x: 140, y: 140 }) {
  if (!payload.repository) return { elements: [] as WhiteboardElement[], nodeCount: 0, relationshipCount: 0, truncated: false };
  const repository = payload.repository;
  const branches = (payload.branches || []).slice(0, 40);
  const reviews = (payload.reviews || []).slice(0, 40);
  const branchCards = new Map<string, WhiteboardCardElement>();
  const elements: WhiteboardElement[] = [];
  const defaultBranch = branches.find((branch) => branch.isDefault)?.name || repository.defaultBranch;
  branches.forEach((branch, index) => {
    const column = branch.name === defaultBranch ? 1 : 0;
    const row = column === 1 ? 0 : branches.filter((item, candidateIndex) => candidateIndex < index && item.name !== defaultBranch).length;
    const card: WhiteboardCardElement = {
      id: makeWhiteboardId(), type: "card",
      x: origin.x + 50 + column * 410, y: origin.y + 92 + row * 148,
      width: 290, height: 118,
      title: branch.name,
      text: `${branch.isDefault ? "Default branch" : branch.protected ? "Protected branch" : "Branch"}\n${branch.headRevision ? branch.headRevision.slice(0, 12) : "No synchronized revision"}\n${branch.aheadCount} ahead · ${branch.behindCount} behind`,
      accent: branch.isDefault ? "#2563eb" : branch.protected ? "#7c3aed" : "#64748b",
      fill: "#f8fafc", textColor: "#0f172a",
      resource: { kind: "project", id: payload.projectId, projectId: payload.projectId },
      resourceKindLabel: "Source Branch", resourceStatus: branch.isDefault ? "default" : branch.protected ? "protected" : "active",
      resourceDetail: `${repository.name} · ${branch.name}`,
      resourceUpdatedAt: branch.lastCommitAt || repository.lastSyncedAt || null,
    };
    branchCards.set(branch.name, card);
    elements.push(card);
  });
  reviews.forEach((review, index) => {
    const source = branchCards.get(review.sourceBranch);
    const target = branchCards.get(review.targetBranch);
    if (!source || !target) return;
    const reviewCard: WhiteboardCardElement = {
      id: makeWhiteboardId(), type: "card",
      x: origin.x + 760, y: origin.y + 92 + index * 148,
      width: 300, height: 118,
      title: review.title,
      text: `${review.sourceBranch} → ${review.targetBranch}\n${humanize(review.status)} · ${humanize(review.eligibilityState || "unknown")}`,
      accent: review.status === "merged" ? "#16a34a" : review.status === "changes_requested" ? "#dc2626" : "#f97316",
      fill: "#f8fafc", textColor: "#0f172a",
      resource: { kind: "project", id: payload.projectId, projectId: payload.projectId },
      resourceKindLabel: "Source Review", resourceStatus: review.status,
      resourceDetail: `${review.sourceBranch} → ${review.targetBranch}`,
      resourceUpdatedAt: review.updatedAt,
    };
    elements.push(reviewCard);
    elements.push({
      id: makeWhiteboardId(), type: "arrow", x1: source.x + source.width, y1: source.y + source.height / 2, x2: reviewCard.x, y2: reviewCard.y + reviewCard.height / 2,
      text: "review", stroke: "#f97316", strokeWidth: 2, fromId: source.id, toId: reviewCard.id,
    } satisfies WhiteboardConnectorElement);
    elements.push({
      id: makeWhiteboardId(), type: "arrow", x1: reviewCard.x, y1: reviewCard.y + reviewCard.height / 2, x2: target.x + target.width, y2: target.y + target.height / 2,
      text: review.status === "merged" ? "merged" : "targets", stroke: review.status === "merged" ? "#16a34a" : "#64748b", strokeWidth: 2, dashed: review.status !== "merged", fromId: reviewCard.id, toId: target.id,
    } satisfies WhiteboardConnectorElement);
  });
  const maxRows = Math.max(branches.length, reviews.length, 2);
  const frame: WhiteboardShapeElement = {
    id: makeWhiteboardId(), type: "frame", x: origin.x, y: origin.y, width: 1130, height: Math.max(430, maxRows * 148 + 120),
    text: `Source Control · ${repository.name}`, stroke: "#2563eb", strokeWidth: 2, fill: "rgba(37,99,235,0.04)", textColor: "#0f172a", dashed: true, section: true,
  };
  return { elements: [frame, ...elements], nodeCount: branchCards.size + reviews.length, relationshipCount: reviews.length * 2, truncated: (payload.branches || []).length > branches.length || (payload.reviews || []).length > reviews.length };
}
