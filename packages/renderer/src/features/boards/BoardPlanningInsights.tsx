import { useMemo } from "react";
import type { BoardPlanningPayload } from "@cluster/shared";
import type { VisualDatum } from "../../components/visual-intelligence";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { DependencyGraph, HealthStrip, Sparkline, StatusStrip } from "../../components/ClusterVisualIntelligence";
import type { Board, Card, UserActivitySummary } from "../application/application-models";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { boardBlockedCardIds, buildBoardCapacityRows, cardDeferredUntil, cardStateAgeDays, isCardStale } from "./board-planning-intelligence";
import { isCardOverdue } from "./BoardCardTile";

function toneForCount(value: number, warnAt = 1): "good" | "warning" | "danger" | "neutral" {
  if (value <= 0) return "good";
  return value >= warnAt ? "warning" : "neutral";
}

export function BoardPlanningInsights({ board, cards, users, payload, error = "" }: { board: Board; cards: Card[]; users: UserActivitySummary[]; payload: BoardPlanningPayload | null; error?: string }) {

  const model = useMemo(() => {
    const listById = new Map(board.lists.map((list) => [list.id, list]));
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const doneCardIds = new Set(cards.filter((card) => listById.get(card.listId)?.isDone).map((card) => card.id));
    const dependencies = payload?.dependencies || [];
    const blocked = boardBlockedCardIds(dependencies, doneCardIds);
    const now = Date.now();
    const active = cards.filter((card) => !listById.get(card.listId)?.isDone && !cardDeferredUntil(card, now));
    const overdue = active.filter((card) => isCardOverdue(card.dueDate)).length;
    const stale = active.filter((card) => isCardStale(card, listById.get(card.listId), now)).length;
    const deferred = cards.filter((card) => cardDeferredUntil(card, now)).length;
    const wipRows = board.lists.map((list) => {
      const count = cards.filter((card) => card.listId === list.id && !cardDeferredUntil(card, now)).length;
      return { list, count, over: list.wipLimit != null && count > list.wipLimit };
    });
    const wipViolations = wipRows.filter((row) => row.over);
    const capacity = buildBoardCapacityRows(cards, board.lists, users, now);
    const health: VisualDatum[] = [
      { id: "blocked", label: "Blocked", value: blocked.size, tone: blocked.size ? "danger" : "good", detail: blocked.size ? "Dependency attention" : "No active blockers" },
      { id: "overdue", label: "Overdue", value: overdue, tone: overdue ? "danger" : "good", detail: overdue ? "Past due" : "On schedule" },
      { id: "stale", label: "Stale", value: stale, tone: toneForCount(stale), detail: "No update for 7+ days" },
      { id: "wip", label: "WIP", value: wipViolations.length, tone: wipViolations.length ? "warning" : "good", detail: wipViolations.length ? "Columns over limit" : "Within limits" },
      { id: "deferred", label: "Deferred", value: deferred, tone: deferred ? "neutral" : "good", detail: deferred ? "Hidden from active pressure" : "Nothing deferred" },
    ];
    const capacityItems: VisualDatum[] = capacity.slice(0, 6).map((row) => ({
      id: row.userId,
      label: row.label,
      value: `${row.cardCount}/${row.capacityUnits}`,
      tone: row.pressure > 1.25 ? "danger" : row.pressure > 0.9 ? "warning" : "good",
      detail: `${row.capacityHours ?? "unset"}h capacity · ${row.estimate} estimate units`,
    }));
    const edgeCards = new Set(dependencies.flatMap((edge) => [edge.sourceCardId, edge.targetCardId]));
    const graphNodes: VisualDatum[] = Array.from(edgeCards).slice(0, 24).flatMap((id) => {
      const card = cardById.get(id);
      if (!card) return [];
      const list = listById.get(card.listId);
      return [{ id, label: card.title, tone: blocked.has(id) ? "danger" : list?.isDone ? "good" : isCardStale(card, list, now) ? "warning" : "neutral", detail: `${list?.title || "Card"} · ${card.priority} · ${cardStateAgeDays(card, now)}d in state` }];
    });
    const graphIds = new Set(graphNodes.map((node) => node.id));
    const graphEdges = dependencies.filter((edge) => graphIds.has(edge.sourceCardId) && graphIds.has(edge.targetCardId)).slice(0, 36).map((edge) => ({ from: edge.sourceCardId, to: edge.targetCardId, label: edge.relationship.replaceAll("_", " ") }));
    return { health, capacityItems, wipViolations, blocked, graphNodes, graphEdges, cardById };
  }, [board.lists, cards, payload?.dependencies, users]);

  if (error) return <div className="error-box" role="alert">{error}</div>;
  if (!payload) return <div className="status-box" role="status">Loading Board health…</div>;

  return (
    <div className="board-planning-insights-v504">
      <section className="panel"><h3>Board health</h3><HealthStrip density="compact" label="Board health summary" items={model.health} /></section>
      <section className="panel"><div className="panel-title-row"><div><h3>Activity</h3><p className="muted tight">Card activity over the last 14 days · snapshot {new Date(payload.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p></div><strong>{payload.activity.reduce((sum, point) => sum + point.count, 0)}</strong></div><Sparkline label="Board activity over 14 days" values={payload.activity.map((point) => point.count)} /></section>
      <section className="panel"><h3>Capacity pressure</h3>{model.capacityItems.length ? <StatusStrip density="compact" label="Assignee capacity pressure" items={model.capacityItems} /> : <p className="muted tight">No active assigned cards.</p>}<p className="muted tight">Capacity pressure is a transparent heuristic: active cards versus roughly one four-hour work unit per configured capacity block. Estimate units are shown separately and are not treated as hours.</p></section>
      <section className="panel"><h3>WIP limits</h3>{model.wipViolations.length ? model.wipViolations.map(({ list, count }) => <p key={list.id} className="tight"><strong>{list.title}</strong> · {count}/{list.wipLimit} cards</p>) : <p className="muted tight">All configured column limits are currently respected.</p>}</section>
      <section className="panel board-dependency-panel-v504"><h3>Dependency map</h3>{model.graphNodes.length ? <DependencyGraph density="compact" label="Board card dependencies" nodes={model.graphNodes} edges={model.graphEdges} onSelect={(selection) => openClusterWorkNavigation(clusterResourceNavigation({ kind: "card", id: selection.datumId, projectId: board.project.id }))} /> : <ClusterEmptyState compact kind="empty" icon="work" title="No Card dependencies yet" description="Link Cards with blocks, depends on, parent, related, duplicate, or supersedes relationships." />}</section>
      <section className="panel board-projection-panel-v504"><div className="panel-title-row"><div><h3>Projected work</h3><p className="muted tight">Canonical Cards tracked by this Board without being duplicated into its columns.</p></div><strong>{payload.projections.length}</strong></div>{payload.projections.length ? <div className="linked-work-list-v491">{payload.projections.map((projection) => <div className="linked-work-row-v491" key={projection.relationshipId}><ClusterButton unstyled className="linked-work-open-v491" onClick={() => openClusterWorkNavigation(clusterResourceNavigation({ kind: "card", id: projection.cardId, projectId: board.project.id }))}><span><strong>{projection.title}</strong><small>{projection.owningBoardName} · {projection.owningListTitle} · {projection.priority}{projection.assigneeLabel ? ` · ${projection.assigneeLabel}` : ""}{projection.deferredUntil ? " · Deferred" : ""}</small></span></ClusterButton></div>)}</div> : <p className="muted tight">No Cards are projected onto this Board.</p>}</section>
    </div>
  );
}
