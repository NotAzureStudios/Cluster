import type { BoardList, Card, UserActivitySummary } from "../application/application-models";
import type { BoardPlanningDependency } from "@cluster/shared";

const DAY_MS = 86_400_000;

export function cardDeferredUntil(card: Card, now = Date.now()) {
  if (!card.deferredUntil) return false;
  const value = new Date(card.deferredUntil).getTime();
  return Number.isFinite(value) && value > now;
}

export function cardAgeDays(value?: string | null, now = Date.now()) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / DAY_MS)) : 0;
}

export function cardStateAgeDays(card: Card, now = Date.now()) {
  return cardAgeDays(card.stateEnteredAt || card.updatedAt || card.createdAt, now);
}

export function cardStaleDays(card: Card, now = Date.now()) {
  return cardAgeDays(card.updatedAt || card.stateEnteredAt || card.createdAt, now);
}

export function isCardStale(card: Card, list?: BoardList | null, now = Date.now(), thresholdDays = 7) {
  if (list?.isDone || cardDeferredUntil(card, now)) return false;
  return cardStaleDays(card, now) >= thresholdDays;
}

export function boardBlockedCardIds(dependencies: BoardPlanningDependency[], doneCardIds: Set<string>) {
  const blocked = new Set<string>();
  dependencies.forEach((edge) => {
    if (edge.relationship === "blocks" && !doneCardIds.has(edge.sourceCardId)) blocked.add(edge.targetCardId);
    if (edge.relationship === "blocked_by" && !doneCardIds.has(edge.targetCardId)) blocked.add(edge.sourceCardId);
    if (edge.relationship === "depends_on" && !doneCardIds.has(edge.targetCardId)) blocked.add(edge.sourceCardId);
  });
  return blocked;
}

export function buildBoardCapacityRows(cards: Card[], lists: BoardList[], users: UserActivitySummary[], now = Date.now()) {
  const doneLists = new Set(lists.filter((list) => list.isDone).map((list) => list.id));
  const active = cards.filter((card) => !doneLists.has(card.listId) && !cardDeferredUntil(card, now));
  return users.map((user) => {
    const assigned = active.filter((card) => card.assigneeId === user.id || (!card.assigneeId && (card.memberIds || []).includes(user.id)));
    const estimate = assigned.reduce((sum, card) => sum + Number(card.estimatePoints || 0), 0);
    const capacityUnits = user.capacityHours != null ? Math.max(1, Math.floor(Number(user.capacityHours) / 4)) : 8;
    const pressure = assigned.length / capacityUnits;
    return {
      userId: user.id,
      label: user.displayName || user.username,
      cardCount: assigned.length,
      estimate,
      capacityHours: user.capacityHours ?? null,
      capacityUnits,
      pressure,
    };
  }).filter((row) => row.cardCount > 0).sort((a, b) => b.pressure - a.pressure || b.cardCount - a.cardCount || a.label.localeCompare(b.label));
}

/** Explain exactly which unfinished, authorized Cards block work *on this
 * Board*. Projected Cards carry their owning List's Done state separately.
 * The relation direction is canonical: blocks A->B, blocked_by A<-B,
 * depends_on A<-B. Related/parent/reference edges never create blockers. */
export type BoardActiveBlockerRow = {
  blockedCardId: string;
  prerequisites: {
    cardId: string;
    relationship: BoardPlanningDependency["relationship"];
    critical: boolean;
  }[];
};

export function boardActiveBlockerRows(
  dependencies: readonly BoardPlanningDependency[],
  doneCardIds: ReadonlySet<string>,
  localCardIds: ReadonlySet<string>,
): BoardActiveBlockerRow[] {
  const rows = new Map<string, BoardActiveBlockerRow>();
  const seenByCard = new Map<string, Map<string, BoardActiveBlockerRow["prerequisites"][number]>>();
  for (const edge of dependencies) {
    if (!edge.blocking) continue;
    let blocked: string;
    let prerequisite: string;
    if (edge.relationship === "blocks") {
      blocked = edge.targetCardId;
      prerequisite = edge.sourceCardId;
    } else if (edge.relationship === "blocked_by" || edge.relationship === "depends_on") {
      blocked = edge.sourceCardId;
      prerequisite = edge.targetCardId;
    } else continue;
    if (!localCardIds.has(blocked) || doneCardIds.has(blocked) || doneCardIds.has(prerequisite)) continue;
    let row = rows.get(blocked);
    if (!row) {
      row = { blockedCardId: blocked, prerequisites: [] };
      rows.set(blocked, row);
      seenByCard.set(blocked, new Map());
    }
    const seen = seenByCard.get(blocked)!;
    const existing = seen.get(prerequisite);
    if (existing) existing.critical = existing.critical || edge.critical;
    else {
      const item = { cardId: prerequisite, relationship: edge.relationship, critical: edge.critical };
      row.prerequisites.push(item);
      seen.set(prerequisite, item);
    }
  }
  return [...rows.values()];
}
