import { useEffect, useMemo, useState } from "react";
import type { ClusterWorkflowLinksPayload } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterResourcePicker } from "../../components/ClusterResourcePicker";
import { useAuthorizedProjectResources } from "../../components/useAuthorizedProjectResources";
import type { BoardSummary, Card } from "../application/application-models";

export function CardProjectionPanel({ projectId, currentBoardId, card }: { projectId: string; currentBoardId: string; card: Card; boards: BoardSummary[] }) {
  const [payload, setPayload] = useState<ClusterWorkflowLinksPayload | null>(null);
  const [targetBoardId, setTargetBoardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const { resources: authorizedBoards, setQuery, loading: targetsLoading, loadingMore, nextCursor, error: targetsError, loadMore } = useAuthorizedProjectResources({ projectId, kinds: ["board"], minimum: "view", enabled: Boolean(payload?.canEdit) });

  async function load() {
    try {
      const result = await queryApi<ClusterWorkflowLinksPayload>(`/api/projects/${encodeURIComponent(projectId)}/workflow-links?kind=card&id=${encodeURIComponent(card.id)}`, { staleMs: 0, maxAgeMs: 30_000, tags: ["workflow-links", projectId, card.id] });
      setPayload(result);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Card projections could not be loaded.");
    }
  }
  useEffect(() => { void load(); }, [projectId, card.id]);

  const projections = useMemo(() => (payload?.links || []).filter((link) => link.relationship === "tracks" && link.direction === "incoming" && link.source.kind === "board" && link.target.kind === "card"), [payload]);
  const projectedBoardIds = useMemo(() => new Set(projections.map((link) => link.source.id)), [projections]);
  const available = authorizedBoards.filter((board) => board.kind === "board" && board.id !== currentBoardId && !projectedBoardIds.has(board.id));

  async function addProjection() {
    if (!targetBoardId || busy) return;
    const targetBoard = available.find((board) => board.id === targetBoardId);
    if (!targetBoard) return;
    setBusy(true); setStatus("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links`, {
        method: "POST",
        body: JSON.stringify({
          source: { kind: "board", id: targetBoard.id, projectId, label: targetBoard.label },
          target: { kind: "card", id: card.id, projectId, label: card.title },
          relationship: "tracks",
          description: `Projected from ${card.title}`,
          critical: false,
        }),
      });
      setTargetBoardId("");
      setStatus(`Projected onto ${targetBoard.label}.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Card could not be projected onto that Board.");
    } finally { setBusy(false); }
  }

  async function removeProjection(id: string, label: string) {
    if (busy) return;
    setBusy(true); setStatus("");
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStatus(`Removed projection from ${label}.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Projection could not be removed.");
    } finally { setBusy(false); }
  }

  return (
    <section className="span-2 linked-work-panel-v491">
      <header><div><h3>Board projections</h3><p className="muted tight">Show this same Card on another Board without copying the Card or splitting its history.</p></div><strong>{projections.length}</strong></header>
      {projections.length ? <div className="linked-work-list-v491">{projections.map((link) => <div className="linked-work-row-v491" key={link.id}><div className="linked-work-open-v491"><span><strong>{link.source.label}</strong><small>Projection · canonical Card remains on its home Board</small></span></div>{payload?.canEdit ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void removeProjection(link.id, link.source.label)}>Remove</ClusterButton> : null}</div>)}</div> : <p className="muted tight">This Card is not projected onto another Board.</p>}
      {payload?.canEdit ? <div className="inline-form">
        <ClusterResourcePicker ariaLabel="Board projection target" value={targetBoardId ? `board:${targetBoardId}` : ""} onChange={(value) => setTargetBoardId(value.startsWith("board:") ? value.slice(6) : "")} projectId={projectId} allowedKinds={["board"]} resources={available} onSearchChange={setQuery} emptyMessage={targetsLoading ? "Loading authorized Boards…" : "No authorized destination Boards found"} />
        {nextCursor && <ClusterButton type="button" size="compact" variant="quiet" disabled={targetsLoading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "More Boards"}</ClusterButton>}
        <ClusterButton size="compact" variant="secondary" busy={busy} busyLabel="Projecting…" disabled={!available.some((board) => board.id === targetBoardId) || targetsLoading || Boolean(targetsError)} onClick={() => void addProjection()}>Project Card</ClusterButton>
      </div> : null}
      {payload?.canEdit && targetsError ? <div role="status" className="status-box system-status-box-v053">Authorized Board discovery unavailable: {targetsError}</div> : null}
      {status ? <div className="status-box system-status-box-v053" role="status">{status}</div> : null}
    </section>
  );
}
