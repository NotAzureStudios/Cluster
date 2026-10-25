import { serializeProjectControlRecord, type ProjectControlRecordShape } from "./project-control-service.js";

export type ProjectControlLinkCandidate = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  progress: number | null;
  dueDate: Date | string | null;
  updatedAt: Date | string | null;
  openPath: string | null;
  /** Existing non-complete Lists offered to an explicitly configured Ticket automation. */
  destinationLists?: Array<{ id: string; title: string }>;
};

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function closedStatus(status: unknown) {
  return ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "released", "passed", "go", "archived"].includes(String(status || "").toLowerCase());
}

function buildCandidate(row: any): ProjectControlLinkCandidate {
  const progress = row.promotedAt || row.channel === "release" || row.approval === "approved" ? 100 : row.qaStatus === "passed" ? 80 : row.qaStatus === "testing" ? 50 : 15;
  return {
    type: "build",
    id: String(row.id),
    title: String(row.title || row.version || "Build"),
    subtitle: `${row.version || "Unversioned"} · ${row.platform || "Unknown platform"}`,
    status: String(row.approval || row.qaStatus || "draft"),
    progress,
    dueDate: row.expiresAt || null,
    updatedAt: row.updatedAt || row.createdAt || null,
    openPath: "builds",
  };
}

function qaSessionCandidate(row: any): ProjectControlLinkCandidate {
  const executed = Number(row.passed || 0) + Number(row.failed || 0) + Number(row.blocked || 0);
  const progress = closedStatus(row.status) || ["go", "conditional", "no-go"].includes(String(row.decision || "")) ? 100 : executed ? Math.min(90, 25 + executed * 5) : 10;
  return {
    type: "qa_session",
    id: String(row.id),
    title: `${row.build?.version || "Build"} · ${row.scope || "QA"}`,
    subtitle: `${row.platform || "Unknown platform"} · ${row.configuration || "default"} · ${row.suite || "general"}`,
    status: String(row.decision !== "pending" ? row.decision : row.status || "planned"),
    progress,
    dueDate: null,
    updatedAt: row.updatedAt || row.createdAt || null,
    openPath: "qa",
  };
}

export async function listProjectControlLinkCandidates(prisma: any, projectId: string): Promise<ProjectControlLinkCandidate[]> {
  const [boards, timelineItems, libraryItems, builds, qaSessions, videos, files] = await Promise.all([
    prisma.board.findMany({ where: { projectId, archived: false }, include: { lists: { where: { archived: false }, orderBy: { position: "asc" }, include: { cards: { where: { archived: false }, orderBy: { position: "asc" } } } } }, orderBy: { updatedAt: "desc" } }),
    prisma.timelineItem.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.libraryItem.findMany({ where: { projectId, status: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.deliveryBuild.findMany({ where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.deliveryQaSession.findMany({ where: { projectId, archived: false }, include: { build: { select: { version: true } } }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.reviewAsset.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 300 }),
    prisma.projectFile.findMany({ where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: 300 }),
  ]);
  const candidates: ProjectControlLinkCandidate[] = [];
  for (const board of boards) {
    const cards = board.lists.flatMap((list: any) => list.cards.map((card: any) => ({ card, list })));
    const cardComplete = ({ card, list }: any) => card.workItemKind === "ticket"
      ? card.ticketStage === "resolved" : Boolean(list.isDone);
    const done = cards.filter(cardComplete).length;
    candidates.push({ type: "board", id: board.id, title: board.name, subtitle: `${cards.length} cards`, status: cards.length && done === cards.length ? "completed" : "active", progress: cards.length ? Math.round((done / cards.length) * 100) : 0, dueDate: null, updatedAt: board.updatedAt, openPath: `boards/${board.id}`,
      destinationLists: board.lists.filter((item: any) => !item.isDone && !item.archived).map((item: any) => ({ id: item.id, title: item.title })) });
    for (const { card, list } of cards) {
      const isTicket = card.workItemKind === "ticket";
      const done = cardComplete({ card, list });
      const status = isTicket ? String(card.ticketStage || "new") : done ? "completed" : card.priority === "urgent" ? "blocked" : "open";
      candidates.push({ type: isTicket ? "ticket" : "card", id: card.id, title: card.title, subtitle: `${board.name} · ${list.title}`, status, progress: isTicket ? (card.ticketStage === "resolved" ? 100 : 0) : (done ? 100 : 0), dueDate: card.dueDate, updatedAt: card.updatedAt, openPath: `boards/${board.id}?card=${card.id}` });
    }
  }
  for (const item of timelineItems) candidates.push({ type: "timeline", id: item.id, title: item.title, subtitle: item.type || "Timeline item", status: item.endsAt && new Date(item.endsAt).getTime() < Date.now() ? "completed" : "scheduled", progress: item.endsAt && new Date(item.endsAt).getTime() < Date.now() ? 100 : 0, dueDate: item.endsAt || item.startsAt, updatedAt: item.updatedAt, openPath: "timeline" });
  for (const item of libraryItems) candidates.push({ type: "library", id: item.id, title: item.title, subtitle: `${item.type || "item"} · ${item.visibility || "internal"}`, status: item.status || "active", progress: closedStatus(item.status) ? 100 : item.status === "in-review" ? 70 : 20, dueDate: item.reviewDueAt, updatedAt: item.updatedAt, openPath: "library" });
  for (const row of builds) candidates.push(buildCandidate(row));
  for (const row of qaSessions) candidates.push(qaSessionCandidate(row));
  for (const asset of videos) candidates.push({ type: "review_asset", id: asset.id, title: asset.title, subtitle: `${asset.medium || "media"} · ${asset.pool || "source"}`, status: asset.status || "review", progress: closedStatus(asset.status) ? 100 : asset.status === "review" ? 70 : 30, dueDate: asset.dueDate, updatedAt: asset.updatedAt, openPath: "viewer" });
  for (const file of files) candidates.push({ type: "file", id: file.id, title: file.title, subtitle: file.category || file.mimeType || "file", status: "available", progress: 100, dueDate: null, updatedAt: file.updatedAt, openPath: "library" });
  return candidates.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.title.localeCompare(b.title));
}

export async function enrichProjectControlRecords(
  prisma: any, projectId: string, records: ProjectControlRecordShape[],
  canReadCandidate?: (candidate: ProjectControlLinkCandidate) => Promise<boolean>,
) {
  const allCandidates = await listProjectControlLinkCandidates(prisma, projectId);
  // Background reconciliation runs without a requester; only HTTP projections
  // pass a visibility predicate. Never construct linked metadata from hidden
  // candidates and then attempt to redact it downstream.
  const candidates: ProjectControlLinkCandidate[] = [];
  if (!canReadCandidate) candidates.push(...allCandidates);
  else {
    for (let offset = 0; offset < allCandidates.length; offset += 12) {
      const batch = allCandidates.slice(offset, offset + 12);
      const allowed = await Promise.all(batch.map(canReadCandidate));
      for (let index = 0; index < batch.length; index += 1) if (allowed[index]) candidates.push(batch[index]);
    }
  }
  const byKey = new Map(candidates.map((item) => [`${item.type}:${item.id}`, item]));
  const enriched = records.map((record) => {
    const linkedEntity = record.linkedEntityType && record.linkedEntityId ? byKey.get(`${record.linkedEntityType}:${record.linkedEntityId}`) || null : null;
    const payload = parseObject(record.payload);
    const autoSync = payload.syncFromLinked !== false;
    const serialized = serializeProjectControlRecord(record);
    if (!linkedEntity || !autoSync) return { ...serialized, linkedEntity, linkState: linkedEntity ? "linked" : record.linkedEntityId ? "missing" : "unlinked" };
    const progress = linkedEntity.progress === null ? serialized.progress : linkedEntity.progress;
    const status = linkedEntity.type === "ticket"
      ? linkedEntity.status === "resolved" ? "completed"
        : linkedEntity.status === "rejected" ? "blocked"
          : closedStatus(serialized.status) ? "open" : serialized.status
      : progress === 100 && !closedStatus(serialized.status) ? "completed" : serialized.status;
    return { ...serialized, progress, status, linkedEntity, linkState: "synced" };
  });
  return { records: enriched, candidates };
}

export async function reconcileProjectControlLinks(prisma: any, projectId: string) {
  const records = await prisma.projectControlRecord.findMany({ where: { projectId, archived: false, linkedEntityType: { not: null }, linkedEntityId: { not: null } } });
  const { records: enriched } = await enrichProjectControlRecords(prisma, projectId, records);
  let updated = 0;
  for (const next of enriched as any[]) {
    const current = records.find((record: any) => record.id === next.id);
    if (!current || next.linkState !== "synced") continue;
    const progressChanged = Number(current.progress || 0) !== Number(next.progress || 0);
    const statusChanged = String(current.status || "") !== String(next.status || "");
    if (!progressChanged && !statusChanged) continue;
    await prisma.projectControlRecord.update({ where: { id: current.id }, data: { progress: next.progress, status: next.status, completedAt: closedStatus(next.status) ? current.completedAt || new Date() : null, revision: { increment: 1 } } });
    updated += 1;
  }
  return { updated, checked: records.length };
}
