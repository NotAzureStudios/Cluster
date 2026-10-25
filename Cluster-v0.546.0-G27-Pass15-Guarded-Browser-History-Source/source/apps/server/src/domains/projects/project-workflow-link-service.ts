import {
  SHARED_WORK_EVIDENCE_RESOURCE_KINDS,
  sharedWorkAttachmentFromLink,
  type ClusterWorkSource,
  type ClusterWorkSourceKind,
  type ClusterWorkSourceView,
  type ClusterWorkflowLinkView,
  type ClusterWorkflowLinksPayload,
  type ClusterWorkflowRelationship,
  type SharedWorkEvidenceCandidate,
  type SharedWorkEvidenceMetadata,
  type SharedWorkEvidencePayload,
  type SharedWorkEvidenceResourceKind,
  type SharedWorkReference,
} from "@cluster/shared";

function key(kind: string, id: string) {
  return `${kind}:${id}`;
}

const CARD_DEPENDENCY_RELATIONSHIPS = new Set<ClusterWorkflowRelationship>(["blocks", "blocked_by", "depends_on"]);
const CARD_HIERARCHY_RELATIONSHIPS = new Set<ClusterWorkflowRelationship>(["parent_of"]);

function normalizedCardDependencyEdge(sourceId: string, targetId: string, relationship: string) {
  if (relationship === "blocks") return { fromId: sourceId, toId: targetId };
  if (relationship === "blocked_by" || relationship === "depends_on") return { fromId: targetId, toId: sourceId };
  return null;
}

function normalizedCardGraphEdge(sourceId: string, targetId: string, relationship: ClusterWorkflowRelationship) {
  if (CARD_DEPENDENCY_RELATIONSHIPS.has(relationship)) {
    const edge = normalizedCardDependencyEdge(sourceId, targetId, relationship);
    return edge ? { ...edge, graph: "dependency" as const } : null;
  }
  if (CARD_HIERARCHY_RELATIONSHIPS.has(relationship)) return { fromId: sourceId, toId: targetId, graph: "hierarchy" as const };
  return null;
}

export async function cardRelationshipGraphDiagnostic(
  prisma: any,
  projectId: string,
  source: ClusterWorkSource,
  target: ClusterWorkSource,
  relationship: ClusterWorkflowRelationship,
  excludeRelationshipId?: string | null,
) {
  if (source.kind !== "card" || target.kind !== "card") return null;
  const candidate = normalizedCardGraphEdge(source.id, target.id, relationship);
  if (!candidate) return null;
  const graphRelationships = candidate.graph === "dependency" ? CARD_DEPENDENCY_RELATIONSHIPS : CARD_HIERARCHY_RELATIONSHIPS;
  const rows = await prisma.projectRelationship.findMany({
    where: {
      projectId,
      sourceType: "card",
      targetType: "card",
      relationship: { in: [...graphRelationships] },
      ...(excludeRelationshipId ? { NOT: { id: excludeRelationshipId } } : {}),
    },
    select: { id: true, sourceId: true, targetId: true, relationship: true },
  });
  const adjacency = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    const targets = adjacency.get(from) || new Set<string>();
    targets.add(to);
    adjacency.set(from, targets);
  };
  for (const row of rows) {
    const edge = normalizedCardGraphEdge(row.sourceId, row.targetId, row.relationship as ClusterWorkflowRelationship);
    if (!edge || edge.graph !== candidate.graph) continue;
    const sameNormalizedEdge = edge.fromId === candidate.fromId && edge.toId === candidate.toId;
    const sameStoredTuple = row.sourceId === source.id && row.targetId === target.id && row.relationship === relationship;
    if (candidate.graph === "dependency" && sameNormalizedEdge && !sameStoredTuple) {
      return {
        code: "CARD_DEPENDENCY_EXISTS",
        path: [candidate.fromId, candidate.toId],
      };
    }
    connect(edge.fromId, edge.toId);
  }
  connect(candidate.fromId, candidate.toId);

  const queue: Array<{ id: string; path: string[] }> = [{ id: candidate.toId, path: [candidate.toId] }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current.id === candidate.fromId) {
      return {
        code: candidate.graph === "dependency" ? "CARD_DEPENDENCY_CYCLE" : "CARD_HIERARCHY_CYCLE",
        path: [candidate.fromId, ...current.path],
      };
    }
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const next of adjacency.get(current.id) || []) queue.push({ id: next, path: [...current.path, next] });
  }
  return null;
}

function fallbackLabel(kind: string, id: string) {
  return `${kind.replaceAll("_", " ")} · ${id.slice(0, 10)}`;
}

function sourceView(source: ClusterWorkSource, label: string, context: string | null): ClusterWorkSourceView {
  return {
    kind: source.kind,
    id: source.id,
    projectId: source.projectId || null,
    label,
    context,
  };
}

export async function hydrateProjectWorkflowSources(prisma: any, project: any, sources: ClusterWorkSource[]) {
  const byKind = new Map<ClusterWorkSourceKind, Set<string>>();
  for (const source of sources) {
    const ids = byKind.get(source.kind) || new Set<string>();
    ids.add(source.id);
    byKind.set(source.kind, ids);
  }

  const views = new Map<string, ClusterWorkSourceView>();
  const add = (kind: ClusterWorkSourceKind, id: string, label: string, context: string | null, projectId: string | null = project.id) => {
    views.set(key(kind, id), sourceView({ kind, id, projectId }, label, context));
  };

  if (byKind.get("project")?.has(project.id)) add("project", project.id, project.name, "Project");

  const boardIds = [...(byKind.get("board") || [])];
  if (boardIds.length) {
    const rows = await prisma.board.findMany({ where: { id: { in: boardIds }, projectId: project.id }, select: { id: true, name: true, projectId: true } });
    rows.forEach((row: any) => add("board", row.id, row.name, "Board", row.projectId));
  }

  const cardRefs = [
    ...[...(byKind.get("card") || [])].map((id) => ({ kind: "card" as const, id })),
    ...[...(byKind.get("ticket") || [])].map((id) => ({ kind: "ticket" as const, id })),
  ];
  if (cardRefs.length) {
    const cardIds = [...new Set(cardRefs.map((entry) => entry.id))];
    const rows = await prisma.card.findMany({ where: { id: { in: cardIds }, list: { board: { projectId: project.id } } }, select: { id: true, title: true, workItemKind: true, list: { select: { title: true, board: { select: { id: true, name: true, projectId: true } } } } } });
    const rowById = new Map(rows.map((row: any) => [row.id, row]));
    for (const ref of cardRefs) {
      const row: any = rowById.get(ref.id);
      if (!row || (ref.kind === "ticket") !== (row.workItemKind === "ticket")) continue;
      add(ref.kind, row.id, row.title, `${row.list.board.name} · ${row.list.title}`, row.list.board.projectId);
    }
  }

  const whiteboardIds = [...(byKind.get("whiteboard") || [])];
  if (whiteboardIds.length) {
    const rows = await prisma.whiteboard.findMany({ where: { id: { in: whiteboardIds }, projectId: project.id }, select: { id: true, name: true, projectId: true } });
    rows.forEach((row: any) => add("whiteboard", row.id, row.name, "Whiteboard", row.projectId));
  }

  const timelineIds = [...(byKind.get("timeline") || [])];
  if (timelineIds.length) {
    const rows = await prisma.timelineItem.findMany({ where: { id: { in: timelineIds }, projectId: project.id }, select: { id: true, title: true, projectId: true } });
    rows.forEach((row: any) => add("timeline", row.id, row.title, "Timeline", row.projectId));
  }

  const calendarIds = [...(byKind.get("calendar") || [])];
  if (calendarIds.length) {
    const rows = await prisma.calendarEvent.findMany({ where: { id: { in: calendarIds }, projectId: project.id }, select: { id: true, title: true, projectId: true } });
    rows.forEach((row: any) => add("calendar", row.id, row.title, "Calendar", row.projectId));
  }

  const schedulerIds = [...(byKind.get("scheduler") || [])];
  if (schedulerIds.length) {
    const rows = await prisma.scheduleBlock.findMany({ where: { id: { in: schedulerIds }, projectId: project.id }, select: { id: true, title: true, projectId: true } });
    rows.forEach((row: any) => add("scheduler", row.id, row.title, "Scheduler", row.projectId));
  }

  const libraryIds = [...(byKind.get("library") || [])];
  if (libraryIds.length) {
    const rows = await prisma.libraryItem.findMany({ where: { id: { in: libraryIds }, OR: [{ projectId: project.id }, { projectId: null }] }, select: { id: true, title: true, projectId: true } });
    rows.forEach((row: any) => add("library", row.id, row.title, "Library", row.projectId));
  }

  const fileIds = [...(byKind.get("file") || [])];
  if (fileIds.length) {
    const rows = await prisma.projectFile.findMany({ where: { id: { in: fileIds }, projectId: project.id, archived: false }, select: { id: true, title: true, fileName: true, projectId: true, versionLabel: true, assetRole: true } });
    rows.forEach((row: any) => add("file", row.id, row.title || row.fileName, `${row.assetRole || "source"}${row.versionLabel ? ` · ${row.versionLabel}` : ""}`, row.projectId));
  }

  const reviewAssetIds = [...(byKind.get("review_asset") || [])];
  if (reviewAssetIds.length) {
    const rows = await prisma.reviewAsset.findMany({ where: { id: { in: reviewAssetIds }, projectId: project.id }, select: { id: true, title: true, projectId: true, medium: true, versionLabel: true } });
    rows.forEach((row: any) => add("review_asset", row.id, row.title, `${row.medium || "media"}${row.versionLabel ? ` · ${row.versionLabel}` : ""}`, row.projectId));
  }

  const controlIds = [...(byKind.get("control") || [])];
  if (controlIds.length) {
    const rows = await prisma.projectControlRecord.findMany({ where: { id: { in: controlIds }, projectId: project.id, archived: false }, select: { id: true, title: true, kind: true, projectId: true } });
    rows.forEach((row: any) => add("control", row.id, row.title, row.kind.replaceAll("_", " "), row.projectId));
  }

  const userIds = [...(byKind.get("user") || [])];
  if (userIds.length) {
    const rows = await prisma.user.findMany({ where: { id: { in: userIds }, archived: false }, select: { id: true, username: true, displayName: true, preferredName: true } });
    rows.forEach((row: any) => add("user", row.id, row.preferredName || row.displayName || row.username, "Person", null));
  }

  const deliveryHydrators: Array<{ sourceKind: ClusterWorkSourceKind; context: string; load: (ids: string[]) => Promise<any[]>; label: (row: any) => string }> = [
    { sourceKind: "build", context: "Build", load: (ids) => prisma.deliveryBuild.findMany({ where: { id: { in: ids }, projectId: project.id, archived: false }, select: { id: true, title: true, version: true, platform: true, projectId: true } }), label: (row) => row.title || `${row.version} · ${row.platform}` },
    { sourceKind: "qa_plan", context: "QA plan", load: (ids) => prisma.deliveryQaPlan.findMany({ where: { id: { in: ids }, projectId: project.id, archived: false }, select: { id: true, title: true, projectId: true } }), label: (row) => row.title },
    { sourceKind: "qa_session", context: "QA session", load: (ids) => prisma.deliveryQaSession.findMany({ where: { id: { in: ids }, projectId: project.id, archived: false }, select: { id: true, scope: true, platform: true, projectId: true, build: { select: { version: true } } } }), label: (row) => `${row.build?.version || "Build"} · ${row.scope || row.platform || "QA"}` },
    { sourceKind: "release", context: "Release", load: (ids) => prisma.deliveryRelease.findMany({ where: { id: { in: ids }, projectId: project.id, archived: false }, select: { id: true, title: true, projectId: true } }), label: (row) => row.title },
  ];
  for (const config of deliveryHydrators) {
    const ids = [...(byKind.get(config.sourceKind) || [])];
    if (!ids.length) continue;
    const rows = await config.load(ids);
    rows.forEach((row: any) => add(config.sourceKind, row.id, config.label(row), config.context, row.projectId));
  }
  const meetingIds = [...(byKind.get("meeting") || [])];
  if (meetingIds.length) {
    const rows = await prisma.clusterPersistenceRecord.findMany({ where: { projectId: project.id, kind: "meeting", entityId: { in: meetingIds }, archived: false }, select: { entityId: true, title: true, projectId: true } });
    rows.forEach((row: any) => add("meeting", row.entityId, row.title, "Meeting", row.projectId));
  }

  for (const source of sources) {
    const sourceKey = key(source.kind, source.id);
    if (!views.has(sourceKey)) views.set(sourceKey, sourceView(source, source.label || fallbackLabel(source.kind, source.id), source.kind.replaceAll("_", " ")));
  }
  return views;
}

export async function buildProjectWorkflowLinksPayload(prisma: any, project: any, subject: ClusterWorkSource, relationships: any[], canEdit = false): Promise<ClusterWorkflowLinksPayload> {
  const refs: ClusterWorkSource[] = [{ ...subject, projectId: project.id }];
  relationships.forEach((relationship) => {
    refs.push({ kind: relationship.sourceType, id: relationship.sourceId, projectId: project.id } as ClusterWorkSource);
    refs.push({ kind: relationship.targetType, id: relationship.targetId, projectId: project.id } as ClusterWorkSource);
  });
  const views = await hydrateProjectWorkflowSources(prisma, project, refs);
  const getView = (kind: ClusterWorkSourceKind, id: string) => views.get(key(kind, id)) as ClusterWorkSourceView;
  const subjectView = getView(subject.kind, subject.id);
  const links: ClusterWorkflowLinkView[] = relationships.map((relationship) => ({
    id: relationship.id,
    projectId: project.id,
    relationship: relationship.relationship,
    description: relationship.description || null,
    critical: Boolean(relationship.critical),
    createdAt: relationship.createdAt.toISOString(),
    direction: relationship.sourceType === subject.kind && relationship.sourceId === subject.id ? "outgoing" : "incoming",
    source: getView(relationship.sourceType as ClusterWorkSourceKind, relationship.sourceId),
    target: getView(relationship.targetType as ClusterWorkSourceKind, relationship.targetId),
  }));
  return { projectId: project.id, subject: subjectView, links, canEdit };
}

export async function searchProjectWorkflowCandidates(prisma: any, project: any, options: { q?: string; kind?: ClusterWorkSourceKind | null; excludeKind?: ClusterWorkSourceKind | null; excludeId?: string | null; limit?: number } = {}) {
  const needle = String(options.q || "").trim().toLowerCase();
  const limit = Math.max(10, Math.min(120, Number(options.limit || 80)));
  const wanted = (kind: ClusterWorkSourceKind) => !options.kind || options.kind === kind;
  const refs: ClusterWorkSource[] = [];
  const add = (kind: ClusterWorkSourceKind, id: string, label?: string | null, resourceProjectId: string | null = kind === "user" ? null : project.id) => {
    if (options.excludeKind === kind && options.excludeId === id) return;
    if (needle && !String(label || "").toLowerCase().includes(needle)) return;
    refs.push({ kind, id, projectId: resourceProjectId, label: label || null });
  };
  if (wanted("project")) add("project", project.id, project.name);

  const queries: Promise<void>[] = [];
  if (wanted("board")) queries.push(prisma.board.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 60 }).then((rows: any[]) => rows.forEach((row) => add("board", row.id, row.name))));
  if (wanted("card") || wanted("ticket")) queries.push(prisma.card.findMany({ where: { archived: false, list: { board: { projectId: project.id, archived: false } } }, select: { id: true, title: true, workItemKind: true }, orderBy: { updatedAt: "desc" }, take: 160 }).then((rows: any[]) => rows.forEach((row) => {
    const kind: ClusterWorkSourceKind = String(row.workItemKind || "card") === "ticket" ? "ticket" : "card";
    if (wanted(kind)) add(kind, row.id, row.title);
  })));
  if (wanted("whiteboard")) queries.push(prisma.whiteboard.findMany({ where: { projectId: project.id }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 60 }).then((rows: any[]) => rows.forEach((row) => add("whiteboard", row.id, row.name))));
  if (wanted("timeline")) queries.push(prisma.timelineItem.findMany({ where: { projectId: project.id }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("timeline", row.id, row.title))));
  if (wanted("calendar")) queries.push(prisma.calendarEvent.findMany({ where: { projectId: project.id }, select: { id: true, title: true }, orderBy: { startsAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("calendar", row.id, row.title))));
  if (wanted("scheduler")) queries.push(prisma.scheduleBlock.findMany({ where: { projectId: project.id }, select: { id: true, title: true }, orderBy: { startsAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("scheduler", row.id, row.title))));
  if (wanted("library")) queries.push(prisma.libraryItem.findMany({ where: { status: { not: "archived" }, OR: [{ projectId: project.id }, { projectId: null }] }, select: { id: true, title: true, projectId: true }, orderBy: { updatedAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("library", row.id, row.title, row.projectId))));
  if (wanted("file")) queries.push(prisma.projectFile.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true, fileName: true }, orderBy: { updatedAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("file", row.id, row.title || row.fileName))));
  if (wanted("review_asset")) queries.push(prisma.reviewAsset.findMany({ where: { projectId: project.id, status: { not: "archived" } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 80 }).then((rows: any[]) => rows.forEach((row) => add("review_asset", row.id, row.title))));
  if (wanted("control")) queries.push(prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("control", row.id, row.title))));
  if (wanted("user")) queries.push(prisma.workspaceMember.findMany({ where: { workspaceId: project.workspaceId, user: { archived: false } }, select: { user: { select: { id: true, username: true, displayName: true, preferredName: true } } }, take: 120 }).then((rows: any[]) => rows.forEach((row) => add("user", row.user.id, row.user.preferredName || row.user.displayName || row.user.username))));

  if (wanted("build")) queries.push(prisma.deliveryBuild.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true, version: true, platform: true }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("build", row.id, row.title || `${row.version} · ${row.platform}`))));
  if (wanted("qa_plan")) queries.push(prisma.deliveryQaPlan.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("qa_plan", row.id, row.title))));
  if (wanted("qa_session")) queries.push(prisma.deliveryQaSession.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, scope: true, platform: true, build: { select: { version: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("qa_session", row.id, `${row.build?.version || "Build"} · ${row.scope || row.platform || "QA"}`))));
  if (wanted("release")) queries.push(prisma.deliveryRelease.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("release", row.id, row.title))));
  if (wanted("meeting")) queries.push(prisma.clusterPersistenceRecord.findMany({ where: { projectId: project.id, kind: "meeting", archived: false }, select: { entityId: true, title: true }, orderBy: { updatedAt: "desc" }, take: 100 }).then((rows: any[]) => rows.forEach((row) => add("meeting", row.entityId, row.title))));

  await Promise.all(queries);
  const deduped = [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
  const views = await hydrateProjectWorkflowSources(prisma, project, deduped);
  const candidates = deduped.map((ref) => views.get(key(ref.kind, ref.id))).filter(Boolean) as ClusterWorkSourceView[];
  candidates.sort((left, right) => {
    const leftLabel = left.label.toLowerCase();
    const rightLabel = right.label.toLowerCase();
    if (needle) {
      const leftStarts = leftLabel.startsWith(needle) ? 0 : 1;
      const rightStarts = rightLabel.startsWith(needle) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;
    }
    return left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label);
  });
  return { projectId: project.id, candidates: candidates.slice(0, limit) };
}


function evidenceKey(kind: SharedWorkEvidenceResourceKind, id: string) {
  return `${kind}:${id}`;
}

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function hydrateEvidenceMetadata(prisma: any, projectId: string, resources: Array<{ kind: SharedWorkEvidenceResourceKind; id: string }>) {
  const byKind = new Map<SharedWorkEvidenceResourceKind, Set<string>>();
  for (const resource of resources) {
    const ids = byKind.get(resource.kind) || new Set<string>();
    ids.add(resource.id);
    byKind.set(resource.kind, ids);
  }
  const metadata = new Map<string, SharedWorkEvidenceMetadata>();
  const uploaderIds = new Set<string>();
  const pendingUploader = new Map<string, string>();

  const fileIds = [...(byKind.get("file") || [])];
  if (fileIds.length) {
    const rows = await prisma.projectFile.findMany({ where: { projectId, id: { in: fileIds }, archived: false }, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, status: true, versionLabel: true, uploadedById: true, createdAt: true, updatedAt: true } });
    for (const row of rows) {
      const key = evidenceKey("file", row.id);
      metadata.set(key, { title: row.title || row.fileName, context: "Project asset", mimeType: row.mimeType || null, sizeBytes: Number(row.sizeBytes || 0), status: row.status || null, reviewState: row.status || null, versionLabel: row.versionLabel || null, uploadedById: row.uploadedById || null, uploadedAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
      if (row.uploadedById) { uploaderIds.add(row.uploadedById); pendingUploader.set(key, row.uploadedById); }
    }
  }

  const libraryIds = [...(byKind.get("library") || [])];
  if (libraryIds.length) {
    const rows = await prisma.libraryItem.findMany({ where: { id: { in: libraryIds }, status: { not: "archived" }, OR: [{ projectId }, { projectId: null }] }, select: { id: true, title: true, type: true, mimeType: true, sizeBytes: true, status: true, versionLabel: true, ownerId: true, reviewerId: true, approvedAt: true, createdAt: true, updatedAt: true } });
    for (const row of rows) {
      const key = evidenceKey("library", row.id);
      const actorId = row.ownerId || row.reviewerId || null;
      metadata.set(key, { title: row.title, context: row.type ? `Library · ${row.type}` : "Library", mimeType: row.mimeType || null, sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes), status: row.status || null, reviewState: row.approvedAt ? "approved" : row.reviewerId ? "review" : row.status || null, versionLabel: row.versionLabel || null, uploadedById: actorId, uploadedAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
      if (actorId) { uploaderIds.add(actorId); pendingUploader.set(key, actorId); }
    }
  }

  const reviewIds = [...(byKind.get("review_asset") || [])];
  if (reviewIds.length) {
    const rows = await prisma.reviewAsset.findMany({ where: { projectId, id: { in: reviewIds }, status: { not: "archived" } }, select: { id: true, title: true, medium: true, mimeType: true, sizeBytes: true, status: true, approvalState: true, versionLabel: true, uploadedById: true, uploadedAt: true, updatedAt: true } });
    for (const row of rows) {
      const key = evidenceKey("review_asset", row.id);
      metadata.set(key, { title: row.title, context: row.medium ? `Review · ${row.medium}` : "Review asset", mimeType: row.mimeType || null, sizeBytes: Number(row.sizeBytes || 0), status: row.status || null, reviewState: row.approvalState || row.status || null, versionLabel: row.versionLabel || null, uploadedById: row.uploadedById || null, uploadedAt: iso(row.uploadedAt), updatedAt: iso(row.updatedAt) });
      if (row.uploadedById) { uploaderIds.add(row.uploadedById); pendingUploader.set(key, row.uploadedById); }
    }
  }

  if (uploaderIds.size) {
    const users = await prisma.user.findMany({ where: { id: { in: [...uploaderIds] }, archived: false }, select: { id: true, username: true, displayName: true, preferredName: true } });
    const nameById = new Map<string, string>(users.map((user: any) => [String(user.id), String(user.preferredName || user.displayName || user.username || "")] as [string, string]));
    for (const [key, userId] of pendingUploader) {
      const current = metadata.get(key);
      if (current) metadata.set(key, { ...current, uploadedByName: nameById.get(userId) || null });
    }
  }
  return metadata;
}

export async function buildProjectEvidencePayload(prisma: any, project: any, workflow: ClusterWorkflowLinksPayload, canUpload = false): Promise<SharedWorkEvidencePayload> {
  const owner: SharedWorkReference = { ...workflow.subject };
  const attachments = workflow.links.map((link) => sharedWorkAttachmentFromLink(owner, link)).filter(Boolean);
  const evidence = attachments.filter((item): item is NonNullable<typeof item> & { resource: SharedWorkReference & { kind: SharedWorkEvidenceResourceKind } } =>
    Boolean(item && (SHARED_WORK_EVIDENCE_RESOURCE_KINDS as readonly string[]).includes(item.resource.kind)),
  );
  const metadata = await hydrateEvidenceMetadata(prisma, project.id, evidence.map((item) => ({ kind: item.resource.kind, id: item.resource.id })));
  return {
    projectId: project.id,
    subject: owner,
    items: evidence.flatMap((item) => {
      const meta = metadata.get(evidenceKey(item.resource.kind, item.resource.id));
      return meta ? [{ ...item, metadata: meta }] : [];
    }),
    canEdit: Boolean(workflow.canEdit),
    canUpload: Boolean(canUpload),
  };
}

export async function searchProjectEvidenceCandidates(prisma: any, project: any, options: { q?: string; limit?: number } = {}) {
  const needle = String(options.q || "").trim().toLowerCase();
  const limit = Math.max(10, Math.min(80, Number(options.limit || 40)));
  const matches = (value: unknown) => !needle || String(value || "").toLowerCase().includes(needle);
  const [files, library, reviews] = await Promise.all([
    prisma.projectFile.findMany({ where: { projectId: project.id, archived: false }, select: { id: true, title: true, fileName: true }, orderBy: { updatedAt: "desc" }, take: 80 }),
    prisma.libraryItem.findMany({ where: { status: { not: "archived" }, OR: [{ projectId: project.id }, { projectId: null }] }, select: { id: true, title: true, projectId: true }, orderBy: { updatedAt: "desc" }, take: 80 }),
    prisma.reviewAsset.findMany({ where: { projectId: project.id, status: { not: "archived" } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 80 }),
  ]);
  const resources: Array<{ kind: SharedWorkEvidenceResourceKind; id: string; label: string; projectId?: string | null }> = [
    ...files.filter((row: any) => matches(`${row.title} ${row.fileName}`)).map((row: any) => ({ kind: "file" as const, id: row.id, label: row.title || row.fileName })),
    ...library.filter((row: any) => matches(row.title)).map((row: any) => ({ kind: "library" as const, id: row.id, label: row.title, projectId: row.projectId })),
    ...reviews.filter((row: any) => matches(row.title)).map((row: any) => ({ kind: "review_asset" as const, id: row.id, label: row.title })),
  ].slice(0, limit);
  const metadata = await hydrateEvidenceMetadata(prisma, project.id, resources);
  return resources.flatMap((resource): SharedWorkEvidenceCandidate[] => {
    const meta = metadata.get(evidenceKey(resource.kind, resource.id));
    if (!meta) return [];
    return [{ resource: { kind: resource.kind, id: resource.id, projectId: resource.kind === "library" ? resource.projectId ?? null : project.id, label: resource.label }, metadata: meta }];
  });
}
