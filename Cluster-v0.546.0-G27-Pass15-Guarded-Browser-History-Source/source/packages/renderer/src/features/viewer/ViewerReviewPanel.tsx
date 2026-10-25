import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReviewLocator } from "@cluster/shared";
import { clusterApiFetch } from "@cluster/api-client";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInspectorPanel } from "../../components/ClusterWorkspacePanel";
import { ClusterSelect } from "../../components/ClusterSelect";
import { queryApi } from "../../core/api";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import type { ViewerAssetSession } from "./viewer-contracts";

type ReviewPerson = { id: string; username?: string | null; displayName?: string | null; archived?: boolean };

type CommentRecord = {
  id: string;
  body: string;
  status: string;
  category: string;
  priority: string;
  assigneeId?: string | null;
  parentCommentId?: string | null;
  threadRootId?: string | null;
  mentionedUserIds: string[];
  locator: ReviewLocator;
  createdAt?: string;
  user?: { displayName?: string | null; username?: string | null } | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function commentRecords(session: ViewerAssetSession): CommentRecord[] {
  const values = Array.isArray(session.asset?.comments) ? session.asset.comments : [];
  return values.flatMap<CommentRecord>((value) => {
    const item = record(value);
    if (!item?.id || !record(item.locator)) return [];
    const user = record(item.user);
    return [{
      id: String(item.id), body: String(item.body || ""), status: String(item.status || "open"), category: String(item.category || "edit"), priority: String(item.priority || "medium"),
      assigneeId: item.assigneeId ? String(item.assigneeId) : null, parentCommentId: item.parentCommentId ? String(item.parentCommentId) : null, threadRootId: item.threadRootId ? String(item.threadRootId) : null,
      mentionedUserIds: Array.isArray(item.mentionedUserIds) ? item.mentionedUserIds.map(String).filter(Boolean) : [], locator: item.locator as ReviewLocator,
      createdAt: item.createdAt ? String(item.createdAt) : undefined,
      user: user ? { displayName: user.displayName ? String(user.displayName) : null, username: user.username ? String(user.username) : null } : null,
    }];
  });
}

function locatorLabel(locator: ReviewLocator) {
  switch (locator.type) {
    case "media_time": return locator.frameNumber != null ? `${locator.timeSeconds.toFixed(2)}s · f${locator.frameNumber}` : `${locator.timeSeconds.toFixed(2)}s`;
    case "audio_region": return locator.endTimeSeconds != null ? `${locator.timeSeconds.toFixed(2)}–${locator.endTimeSeconds.toFixed(2)}s` : `${locator.timeSeconds.toFixed(2)}s`;
    case "image_region": return locator.region ? `Region ${Math.round(locator.region.x * 100)}%, ${Math.round(locator.region.y * 100)}%` : "Image point";
    case "pdf_region": return `Page ${locator.page}`;
    case "spatial": return locator.objectId || locator.meshId || "3D point";
  }
}

async function downloadReviewReport(assetId: string, format: "text" | "json") {
  const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(assetId)}/review-report?scope=family&format=${format}`);
  if (!response.ok) throw new Error(`Review report export failed (${response.status}).`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `cluster-review-report.${format === "text" ? "txt" : "json"}`;
    link.rel = "noopener";
    link.click();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 0); }
}

export function ViewerReviewPanel({ session, onNavigate, onReload, onClose }: { session: ViewerAssetSession; onNavigate?: (locator: ReviewLocator) => void; onReload: () => void; onClose: () => void }) {
  const comments = useMemo(() => commentRecords(session), [session.asset]);
  const [replyTo, setReplyTo] = useState<CommentRecord | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unresolvedCursor, setUnresolvedCursor] = useState(-1);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [reviewScope, setReviewScope] = useState<"open" | "all" | "resolved">("open");
  const commentRefs = useRef(new Map<string, HTMLElement>());
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<ReviewPerson[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<Array<{ id: string; versionNumber: number; decision: string; actorId: string; decidedAt: string; reason?: string | null }>>([]);
  const [showDecisions, setShowDecisions] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const sourceLocator = session.resource.source.locator;
  const assetId = sourceLocator.provider === "review_asset" ? sourceLocator.assetId : null;
  useEffect(() => { setDecisionHistory([]); setShowDecisions(false); setChangeReason(""); }, [assetId]);
  async function openDecisionHistory() {
    if (!assetId) return;
    if (showDecisions) { setShowDecisions(false); return; }
    setBusyId("decisions"); setError(null);
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(assetId)}/decisions`);
      if (!response.ok) throw new Error(`Review decision history unavailable (${response.status}).`);
      const body = await response.json() as { decisions?: Array<{ id: string; versionNumber: number; decision: string; actorId: string; decidedAt: string; reason?: string | null }> };
      setDecisionHistory(Array.isArray(body.decisions) ? body.decisions : []);
      setShowDecisions(true);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Unable to load review decisions."); }
    finally { setBusyId(null); }
  }
  useEffect(() => {
    if (!assetId || !session.capabilities.comment) { setPeople([]); return; }
    let active = true;
    queryApi<ReviewPerson[]>("/api/users?summary=true&limit=1000", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "people"] }).then((value) => { if (active) setPeople(value.filter((person) => !person.archived)); }).catch(() => { if (active) setPeople([]); });
    return () => { active = false; };
  }, [assetId, session.capabilities.comment]);
  const personOptions = useMemo(() => [{ value: "", label: "Unassigned" }, ...people.map((person) => ({ value: person.id, label: person.displayName || person.username || person.id }))], [people]);
  const reviewIndex = useMemo(() => {
    const topLevel: CommentRecord[] = [];
    const unresolved: CommentRecord[] = [];
    const repliesByRoot = new Map<string, CommentRecord[]>();
    for (const comment of comments) {
      if (comment.status !== "resolved") unresolved.push(comment);
      if (!comment.parentCommentId) { topLevel.push(comment); continue; }
      const root = comment.threadRootId || comment.parentCommentId || comment.id;
      const replies = repliesByRoot.get(root);
      if (replies) replies.push(comment);
      else repliesByRoot.set(root, [comment]);
    }
    return { topLevel, unresolved, repliesByRoot };
  }, [comments]);
  const { unresolved, repliesByRoot } = reviewIndex;
  const activeUnresolvedIndex = useMemo(() => activeCommentId ? unresolved.findIndex((comment) => comment.id === activeCommentId) : -1, [activeCommentId, unresolved]);
  const displayedTopLevel = useMemo(() => reviewIndex.topLevel.filter((comment) => {
    if (reviewScope === "all") return true;
    const threadOpen = comment.status !== "resolved" || (repliesByRoot.get(comment.id) || []).some((reply) => reply.status !== "resolved");
    return reviewScope === "open" ? threadOpen : !threadOpen;
  }), [reviewIndex.topLevel, repliesByRoot, reviewScope]);

  useEffect(() => {
    if (activeCommentId && !comments.some((comment) => comment.id === activeCommentId)) {
      setActiveCommentId(null);
      setUnresolvedCursor(-1);
    }
  }, [activeCommentId, comments]);

  async function updateAssignee(comment: CommentRecord, assigneeId: string) {
    if (!session.capabilities.comment) return;
    setBusyId(comment.id); setError(null);
    try {
      const response = await clusterApiFetch(`/api/review-comments/${encodeURIComponent(comment.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assigneeId: assigneeId || null }) });
      if (!response.ok) throw new Error(`Review assignment update failed (${response.status}).`);
      onReload();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Review assignment update failed."); }
    finally { setBusyId(null); }
  }

  async function updateStatus(comment: CommentRecord) {
    setBusyId(comment.id); setError(null);
    try {
      const response = await clusterApiFetch(`/api/review-comments/${encodeURIComponent(comment.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: comment.status === "resolved" ? "open" : "resolved" }) });
      if (!response.ok) throw new Error(`Review note update failed (${response.status}).`);
      onReload();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Review note update failed."); }
    finally { setBusyId(null); }
  }

  async function submitReply() {
    if (!assetId || !replyTo || !replyBody.trim()) return;
    setBusyId(replyTo.id); setError(null);
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(assetId)}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: replyBody.trim(), locator: replyTo.locator, parentCommentId: replyTo.id, category: replyTo.category, priority: replyTo.priority, status: "open" }) });
      if (!response.ok) throw new Error(`Review reply failed (${response.status}).`);
      setReplyBody(""); setReplyTo(null); onReload();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Review reply failed."); }
    finally { setBusyId(null); }
  }

  function navigateToComment(comment: CommentRecord) {
    setActiveCommentId(comment.id);
    const index = unresolved.findIndex((item) => item.id === comment.id);
    if (index >= 0) setUnresolvedCursor(index);
    onNavigate?.(comment.locator);
    window.requestAnimationFrame(() => commentRefs.current.get(comment.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function navigateUnresolved(direction: -1 | 1) {
    if (!unresolved.length) return;
    const current = activeUnresolvedIndex >= 0 ? activeUnresolvedIndex : unresolvedCursor;
    const next = (current + direction + unresolved.length) % unresolved.length;
    setUnresolvedCursor(next);
    navigateToComment(unresolved[next]);
  }

  function handleReviewKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || !event.altKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      navigateUnresolved(event.key === "ArrowUp" ? -1 : 1);
    }
  }

  async function setApproval(approvalState: "approved" | "changes") {
    if (!assetId || !session.capabilities.approve) return;
    setBusyId("approval"); setError(null);
    try {
      const source = record(session.asset);
      const expectedUpdatedAt = String(source?.updatedAt || "");
      const expectedVersionNumber = Number(source?.versionNumber);
      if (!expectedUpdatedAt || !Number.isInteger(expectedVersionNumber)) throw new Error("Review version evidence is unavailable. Reload before deciding.");
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(assetId)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: approvalState, reason: approvalState === "changes" ? changeReason.trim() : null, expectedUpdatedAt, expectedVersionNumber }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(result.message || `Review decision failed (${response.status}). Reload this version before retrying.`);
      }
      setChangeReason(""); onReload();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Approval update failed."); }
    finally { setBusyId(null); }
  }

  return <ClusterInspectorPanel className="cluster-viewer-review-panel" label="Review history" title="Review" detail={`${unresolved.length} unresolved · ${comments.length} total`} onClose={onClose} panelProps={{ "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown", onKeyDown: handleReviewKeyDown }}>
    <div className="cluster-viewer-review-context"><span>Status <strong>{session.review?.status || "review"}</strong></span><span>Decision <strong>{session.review?.approvalState || "pending"}</strong></span><span>Version <strong>{String(record(session.asset)?.versionLabel || `v${record(session.asset)?.versionNumber || 1}`)}</strong></span>{session.review?.reviewRound != null ? <span>Round <strong>{session.review.reviewRound}</strong></span> : null}</div>
    <div className="cluster-viewer-review-actions">
      <ClusterSelect ariaLabel="Filter review notes" value={reviewScope} onChange={(value) => setReviewScope(value as "open" | "all" | "resolved")} options={[{ value: "open", label: `Open (${unresolved.length})` }, { value: "all", label: `All (${comments.length})` }, { value: "resolved", label: `Resolved (${comments.length - unresolved.length})` }]} />
      {unresolved.length ? <><span className="cluster-viewer-review-position">{activeUnresolvedIndex >= 0 ? activeUnresolvedIndex + 1 : "–"}/{unresolved.length}</span><ClusterButton size="compact" variant="quiet" title="Previous unresolved (Alt+↑)" onClick={() => navigateUnresolved(-1)}>Previous unresolved</ClusterButton><ClusterButton size="compact" variant="quiet" title="Next unresolved (Alt+↓)" onClick={() => navigateUnresolved(1)}>Next unresolved</ClusterButton></> : null}
      {assetId ? <><ClusterButton size="compact" variant="quiet" disabled={busyId === "decisions"} onClick={() => void openDecisionHistory()}>{showDecisions ? "Hide decisions" : "Decision history"}</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void downloadReviewReport(assetId, "text").catch((nextError) => setError(String(nextError)))}>Report</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => void downloadReviewReport(assetId, "json").catch((nextError) => setError(String(nextError)))}>JSON</ClusterButton></> : null}
      {assetId && session.capabilities.approve && session.review?.approvalState !== "superseded" ? <><ClusterButton size="compact" variant="quiet" disabled={busyId === "approval"} selected={session.review?.approvalState === "approved"} onClick={() => void setApproval("approved")}>Approve</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={busyId === "approval" || !changeReason.trim()} selected={session.review?.approvalState === "changes"} onClick={() => void setApproval("changes")}>Request changes</ClusterButton></> : null}
    </div>
    {assetId && session.capabilities.approve && session.review?.approvalState !== "superseded" ? <div className="cluster-viewer-review-reply-editor"><span>Review notes (required to request changes on this version)</span><ClusterTextArea aria-label="Reason for requesting media changes" value={changeReason} maxLength={2000} rows={2} onChange={(event) => setChangeReason(event.target.value)} /></div> : null}
    {error ? <div className="cluster-viewer-review-error" role="alert">{error}</div> : null}
    {showDecisions ? <section className="cluster-viewer-review-decisions" aria-label="Committed review decisions"><strong>Committed decisions · this media version</strong>{decisionHistory.length ? <ol>{decisionHistory.map((entry) => <li key={entry.id}><span>{entry.decision === "approved" ? "Approved" : "Changes requested"}</span> · version {entry.versionNumber} · {new Date(entry.decidedAt).toLocaleString()} · <code title="Decision actor ID">{entry.actorId}</code>{entry.reason ? <p>{entry.reason}</p> : null}</li>)}</ol> : <p>No committed decisions on this version.</p>}</section> : null}
    <div className="cluster-viewer-review-list">
      {!displayedTopLevel.length ? <p className="cluster-viewer-review-empty">{comments.length ? `No ${reviewScope === "open" ? "open" : reviewScope} top-level review notes.` : "No review notes on this version."}</p> : displayedTopLevel.map((comment) => {
        const replies = repliesByRoot.get(comment.id) || [];
        const threadActive = activeCommentId === comment.id || replies.some((reply) => reply.id === activeCommentId);
        return <article key={comment.id} ref={(node) => { if (node) commentRefs.current.set(comment.id, node); else commentRefs.current.delete(comment.id); }} className="cluster-viewer-review-thread" data-status={comment.status} data-active={threadActive ? "true" : undefined}>
          <ClusterButton type="button" variant="quiet" size="compact" className="cluster-viewer-review-note-location" onClick={() => navigateToComment(comment)}>{locatorLabel(comment.locator)}</ClusterButton>
          <div className="cluster-viewer-review-note-meta"><strong>{comment.user?.displayName || comment.user?.username || "Unknown user"}</strong><span>{comment.category} · {comment.priority}{comment.mentionedUserIds.length ? ` · ${comment.mentionedUserIds.length} mention${comment.mentionedUserIds.length === 1 ? "" : "s"}` : ""}</span></div>
          <p>{comment.body}</p>
          <div className="cluster-viewer-review-note-actions">{session.capabilities.resolve ? <ClusterButton size="compact" variant="quiet" disabled={busyId === comment.id} onClick={() => void updateStatus(comment)}>{comment.status === "resolved" ? "Reopen" : "Resolve"}</ClusterButton> : null}{session.capabilities.comment ? <ClusterButton size="compact" variant="quiet" onClick={() => { setReplyTo(comment); setReplyBody(""); }}>Reply</ClusterButton> : null}{session.capabilities.comment && people.length ? <ClusterSelect ariaLabel={`Assign review note by ${comment.user?.displayName || comment.user?.username || "reviewer"}`} value={comment.assigneeId || ""} onChange={(value) => void updateAssignee(comment, value)} disabled={busyId === comment.id} options={personOptions} /> : comment.assigneeId ? <span className="cluster-viewer-review-assignee">Assigned · {people.find((person) => person.id === comment.assigneeId)?.displayName || people.find((person) => person.id === comment.assigneeId)?.username || comment.assigneeId}</span> : null}</div>
          {replies.map((reply) => <div key={reply.id} ref={(node) => { if (node) commentRefs.current.set(reply.id, node); else commentRefs.current.delete(reply.id); }} className="cluster-viewer-review-reply" data-status={reply.status} data-active={activeCommentId === reply.id ? "true" : undefined}><ClusterButton type="button" variant="quiet" size="compact" className="cluster-viewer-review-note-location" onClick={() => navigateToComment(reply)}>{locatorLabel(reply.locator)}</ClusterButton><strong>{reply.user?.displayName || reply.user?.username || "Unknown user"}</strong><p>{reply.body}</p></div>)}
        </article>;
      })}
    </div>
    {replyTo ? <div className="cluster-viewer-review-reply-editor"><span>Reply to {replyTo.user?.displayName || replyTo.user?.username || "note"}. @username mentions are resolved server-side.</span><ClusterTextArea value={replyBody} maxLength={16000} rows={4} onChange={(event) => setReplyBody(event.target.value)} /><div><ClusterButton size="compact" variant="quiet" onClick={() => setReplyTo(null)}>Cancel</ClusterButton><ClusterButton size="compact" disabled={!replyBody.trim() || busyId === replyTo.id} onClick={() => void submitReply()}>Reply</ClusterButton></div></div> : null}
  </ClusterInspectorPanel>;
}
