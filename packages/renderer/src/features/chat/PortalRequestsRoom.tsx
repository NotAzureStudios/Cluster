import { useCallback, useEffect, useState } from "react";
import { api, queryApi } from "../../core/api";
import { renderMarkdown } from "../../core/markdown";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";

type Row = { id: string; code: string; audience: string; kind: string; title: string; status: string; contactName: string | null; lastActivityAt: string; awaitingStudio: boolean; preview: string };
type Detail = { id: string; code: string; audience: string; kind: string; title: string; body: string; status: string; contactName: string | null; contactEmail: string | null; projectId: string | null; cardId: string | null; stage: string | null; createdAt: string; messages: Array<{ id: string; authorKind: string; author: string | null; body: string; createdAt: string }> };
const STATUSES: Array<[string, string]> = [["open", "Open"], ["in_progress", "In progress"], ["waiting", "Waiting on them"], ["resolved", "Resolved"], ["closed", "Closed"]];
const KIND: Record<string, string> = { bug: "Bug", help: "Help", feedback: "Feedback", request: "Request", application: "Application" };

/** Chat › Requests: conversations from the external portal (player bug
 *  reports and help, applicants, client requests). */
export function PortalRequestsRoom({ onCount }: { onCount: (count: number) => void }) {
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => api<{ requests: Row[] }>(`/api/studio/portal-requests?status=${filter}`).then((value) => { setRows(value.requests); onCount(value.requests.filter((row) => row.awaitingStudio && row.status !== "closed" && row.status !== "resolved").length); }).catch(() => setRows([])), [filter]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000); return () => window.clearInterval(timer); }, [load]);
  return <div className="chat__requests">
    <aside className="chat__req-list">
      <div className="chat__seg" role="tablist">{(["active", "all"] as const).map((value) => <button key={value} type="button" role="tab" aria-checked={filter === value} onClick={() => setFilter(value)}>{value === "active" ? "Active" : "All"}</button>)}</div>
      {rows === null ? <p className="chat__empty">Loading…</p> : rows.length ? <ul>{rows.map((row) => <li key={row.id}><button type="button" aria-current={openId === row.id || undefined} onClick={() => setOpenId(row.id)}>
        <span className="chat__req-top"><em data-kind={row.kind}>{KIND[row.kind] || row.kind}</em>{row.awaitingStudio && !["resolved", "closed"].includes(row.status) ? <i className="chat__dot" aria-label="Needs a reply" /> : null}<time>{formatRelativeTime(row.lastActivityAt)}</time></span>
        <strong>{row.title}</strong><small>{row.contactName || (row.audience === "player" ? "Player" : "Client")} · {row.preview}</small>
      </button></li>)}</ul> : <p className="chat__empty">No requests.</p>}
    </aside>
    {openId ? <RequestThread key={openId} id={openId} onChanged={load} /> : <div className="chat__empty chat__req-none">Pick a request.</div>}
  </div>;
}

function RequestThread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const load = useCallback(() => api<Detail>(`/api/studio/portal-requests/${id}`).then(setDetail).catch((reason) => setError(reason instanceof Error ? reason.message : "Couldn't load.")), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void queryApi<Array<{ id: string; name: string; archived?: boolean }>>("/api/projects", { staleMs: 60_000, tags: ["projects"] }).then((value) => setProjects((Array.isArray(value) ? value : []).filter((project) => !project.archived))).catch(() => undefined); }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); } finally { setBusy(false); }
  }
  if (!detail) return <div className="chat__empty">{error || "Loading…"}</div>;
  return <section className="chat__req-thread">
    <header className="chat__req-head">
      <div><h3>{detail.title}</h3><small><code>{detail.code}</code> · {KIND[detail.kind] || detail.kind} from {detail.contactName || (detail.audience === "player" ? "a player" : "a client")}{detail.contactEmail ? ` · ${detail.contactEmail}` : ""}{detail.stage ? ` · ${detail.stage}` : ""}</small></div>
      <select aria-label="Status" value={detail.status} disabled={busy} onChange={(event) => void run(() => api(`/api/studio/portal-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status: event.target.value }) }))}>{STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </header>
    <div className="chat__req-msgs">
      {detail.body ? <article data-from="requester"><div className="chat__md">{renderMarkdown(detail.body)}</div><time>{formatRelativeTime(detail.createdAt)}</time></article> : null}
      {detail.messages.map((message) => <article key={message.id} data-from={message.authorKind}><strong>{message.authorKind === "studio" ? message.author || "Studio" : detail.contactName || "Them"}</strong><div className="chat__md">{renderMarkdown(message.body)}</div><time>{formatRelativeTime(message.createdAt)}</time></article>)}
    </div>
    <div className="chat__req-ticket">{detail.cardId ? <span><ClusterIcon name="ticket" /> Ticket created</span> : <>
      <select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Make a ticket in…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <ClusterButton size="compact" variant="secondary" disabled={!projectId || busy} onClick={() => void run(() => api(`/api/studio/portal-requests/${id}/ticket`, { method: "POST", body: JSON.stringify({ projectId }) }))}>Create ticket</ClusterButton>
    </>}</div>
    <form className="chat__composer" onSubmit={(event) => { event.preventDefault(); if (reply.trim()) void run(async () => { await api(`/api/studio/portal-requests/${id}/messages`, { method: "POST", body: JSON.stringify({ body: reply.trim() }) }); setReply(""); }); }}>
      <textarea className="chat__composer-body" rows={3} value={reply} placeholder="Reply…" onChange={(event) => setReply(event.target.value)} aria-label="Reply" />
      <div className="chat__composer-bar">{error ? <span className="chat__error" role="alert">{error}</span> : <span />}<ClusterButton type="submit" variant="primary" size="compact" busy={busy} disabled={!reply.trim()}><ClusterIcon name="forward" /> Reply</ClusterButton></div>
    </form>
  </section>;
}
