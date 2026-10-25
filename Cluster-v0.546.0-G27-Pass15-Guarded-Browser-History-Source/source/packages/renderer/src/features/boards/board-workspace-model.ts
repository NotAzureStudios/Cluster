import type { Board, Card, Priority, UserActivitySummary } from "../application/application-models";

export type BoardViewPreset = "all" | "mine" | "watching" | "overdue" | "urgent" | "unassigned" | "blocked" | "stale" | "deferred";
export type BoardIssueFilter = "all" | "linked" | "open" | "closed" | "unlinked";
export type BoardSortMode = "manual" | "due" | "priority" | "title";

export type BoardCardFilterState = {
  normalizedQuery: string;
  priorityFilter: "all" | Priority;
  labelFilter: string;
  categoryFilter: string;
  issueFilter: BoardIssueFilter;
  assigneeFilter: string;
  viewPreset: BoardViewPreset;
  currentUserId: string;
  blockedCardIds?: ReadonlySet<string>;
};

export type CardSourceIssue = {
  id: string;
  number: number | null;
  title: string;
  state: string;
  labels: string[];
  assignee: string | null;
  updatedAt: string | null;
  url: string | null;
  providerId: string | null;
};

export function cardSourceIssue(card: Card): CardSourceIssue | null {
  const link = (card.externalLinks || []).find((item) => item.providerEntityType === "source_issue");
  if (!link) return null;
  const metadata = link.metadata || {};
  const rawNumber = Number(metadata.number);
  return {
    id: link.providerEntityId,
    number: Number.isFinite(rawNumber) && rawNumber > 0 ? rawNumber : null,
    title: String(metadata.title || "Source Control issue"),
    state: String(metadata.state || "open").toLowerCase(),
    labels: Array.isArray(metadata.labels) ? metadata.labels.map(String).filter(Boolean) : [],
    assignee: metadata.assignee ? String(metadata.assignee) : null,
    updatedAt: metadata.updatedAt ? String(metadata.updatedAt) : null,
    url: link.providerUrl || null,
    providerId: metadata.providerId ? String(metadata.providerId) : null,
  };
}

export function isBoardCardOverdue(value?: string | null) {
  if (!value) return false;
  const due = new Date(value);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

export function flattenBoardCards(board: Board | null) {
  return board?.lists.flatMap((list) => list.cards) || [];
}

export function collectBoardLabels(cards: Card[]) {
  return Array.from(new Set(cards.flatMap((card) => [...card.labels, ...(cardSourceIssue(card)?.labels || [])]).map((value) => value.trim()).filter(Boolean))).sort();
}

export function collectBoardCategories(cards: Card[]) {
  return Array.from(new Set(cards.map((card) => card.category || "").map((value) => value.trim()).filter(Boolean))).sort();
}

export function buildBoardUserIndex(users: UserActivitySummary[]) {
  return new Map(users.map((user) => [user.id, user]));
}

export function buildBoardCardSearchIndex(cards: Card[], userById: Map<string, UserActivitySummary>) {
  const userNameById = new Map(Array.from(userById, ([id, user]) => [id, user.displayName || user.username || ""]));
  const index = new Map<string, string>();
  for (const card of cards) {
    const memberNames = (card.memberIds || []).map((id) => userNameById.get(id) || "");
    index.set(card.id, [
      card.title,
      card.description || "",
      card.category || "",
      ...card.labels,
      ...(cardSourceIssue(card)?.labels || []),
      cardSourceIssue(card)?.title || "",
      cardSourceIssue(card)?.assignee || "",
      card.assignee?.displayName || card.assignee?.username || "",
      ...memberNames,
    ].join(" ").toLowerCase());
  }
  return index;
}

export function boardCardMatches(card: Card, searchText: string, filters: BoardCardFilterState) {
  if (filters.normalizedQuery && !searchText.includes(filters.normalizedQuery)) return false;
  if (filters.priorityFilter !== "all" && card.priority !== filters.priorityFilter) return false;
  if (filters.labelFilter && ![...card.labels, ...(cardSourceIssue(card)?.labels || [])].includes(filters.labelFilter)) return false;
  if (filters.categoryFilter && card.category !== filters.categoryFilter) return false;
  const sourceIssue = cardSourceIssue(card);
  if (filters.issueFilter === "linked" && !sourceIssue) return false;
  if (filters.issueFilter === "unlinked" && sourceIssue) return false;
  if (filters.issueFilter === "open" && sourceIssue?.state !== "open") return false;
  if (filters.issueFilter === "closed" && sourceIssue?.state !== "closed") return false;
  if (filters.assigneeFilter && card.assigneeId !== filters.assigneeFilter && !(card.memberIds || []).includes(filters.assigneeFilter)) return false;
  if (filters.viewPreset === "mine" && card.assigneeId !== filters.currentUserId && !(card.memberIds || []).includes(filters.currentUserId)) return false;
  if (filters.viewPreset === "watching" && !(card.watcherIds || []).includes(filters.currentUserId)) return false;
  if (filters.viewPreset === "overdue" && !isBoardCardOverdue(card.dueDate)) return false;
  if (filters.viewPreset === "urgent" && card.priority !== "urgent") return false;
  if (filters.viewPreset === "unassigned" && card.assigneeId) return false;
  if (filters.viewPreset === "blocked" && !filters.blockedCardIds?.has(card.id)) return false;
  if (filters.viewPreset === "stale") {
    if (card.completedAt || card.deferredUntil && new Date(card.deferredUntil).getTime() > Date.now()) return false;
    const lastChange = new Date(card.updatedAt || card.stateEnteredAt || card.createdAt || 0).getTime();
    if (!Number.isFinite(lastChange) || Date.now() - lastChange < 7 * 86_400_000) return false;
  }
  if (filters.viewPreset === "deferred") {
    const deferred = card.deferredUntil ? new Date(card.deferredUntil).getTime() : 0;
    if (!Number.isFinite(deferred) || deferred <= Date.now()) return false;
  }
  return true;
}

export function sortBoardCards(cards: Card[], sortMode: BoardSortMode) {
  if (sortMode === "manual") return cards;
  const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return [...cards].sort((left, right) => {
    if (sortMode === "title") return left.title.localeCompare(right.title);
    if (sortMode === "priority") return priorityOrder[left.priority] - priorityOrder[right.priority] || left.title.localeCompare(right.title);
    const leftTime = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || left.title.localeCompare(right.title);
  });
}

export function summarizeBoardCards(cards: Card[], currentUserId: string) {
  let linked = 0;
  let overdue = 0;
  let unassigned = 0;
  let watching = 0;
  for (const card of cards) {
    if (cardSourceIssue(card)) linked += 1;
    if (isBoardCardOverdue(card.dueDate)) overdue += 1;
    if (!card.assigneeId) unassigned += 1;
    if ((card.watcherIds || []).includes(currentUserId)) watching += 1;
  }
  return { linked, overdue, unassigned, watching };
}
