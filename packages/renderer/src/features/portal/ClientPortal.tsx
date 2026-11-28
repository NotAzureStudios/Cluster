import { useCallback, useEffect, useState } from "react";
import { api, API_URL } from "../../core/api";
import { renderMarkdown } from "../../core/markdown";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { ChatPage } from "../chat/ChatPage";
import { HomeBanners } from "../chat/HomeBanners";
import { nativeShell, switchServer } from "../mobile/native-shell";
import type { PortalContext } from "./portal-context";

type Ticket = { title: string; stage: string; done: boolean; archived: boolean } | null;
type Row = { code: string; kind: string; title: string; status: string; lastActivityAt: string; studioReplied: boolean; ticket: Ticket };
type Detail = { code: string; kind: string; title: string; body: string; status: string; createdAt: string; ticket: Ticket; messages: Array<{ id: string; from: "studio" | "you"; body: string; createdAt: string }> };
type View = "home" | "requests" | "announcements";
const KIND: Record<string, string> = { request: "Request", bug: "Bug", help: "Help", feedback: "Feedback" };
const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting on you", resolved: "Resolved", closed: "Closed" };
const VIEWS: Array<[View, string, ClusterIconName]> = [["home", "Home", "home"], ["requests", "Requests", "ticket"], ["announcements", "Announcements", "bell"]];

/** The client portal: send the studio requests and tickets, follow their
 *  status (and the tickets they became), talk it through, and read
 *  announcements meant for clients. */
export function ClientPortal({ context, onSignOut }: { context: PortalContext; onSignOut: () => void }) {
  const user = context.user!;
  const [view, setView] = useState<View>(() => { const hash = window.location.hash.slice(1) as View; return VIEWS.some(([id]) => id === hash) ? hash : "home"; });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [menu, setMenu] = useState(false);
  const load = useCallback(() => api<{ requests: Row[] }>("/api/portal/client/requests").then((value) => setRows(value.requests)).catch(() => setRows([])), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.history.replaceState(null, "", `#${view}`); }, [view]);
  const open = (code: string) => { setView("requests"); setComposing(false); setOpenCode(code); };
  const active = (rows || []).filter((row) => !["resolved", "closed"].includes(row.status));

  return <div className="portal" data-audience="client">
    <header className="portal__bar">
      <div className="portal__brand"><strong>{context.studioName}</strong><span className="portal__badge">Client portal</span></div>
      <nav className="portal__nav" aria-label="Portal">{VIEWS.map(([id, label, icon]) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setOpenCode(null); setComposing(false); void load(); }}><ClusterIcon name={icon} /><span>{label}</span></button>)}</nav>
      <div className="portal__account">
        <button type="button" className="portal__me" aria-expanded={menu} onClick={() => setMenu(!menu)}>{user.avatarUrl ? <img src={`${API_URL}${user.avatarUrl}`} alt="" /> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}</button>
        {menu ? <div className="portal__menu" role="menu"><p><strong>{user.name}</strong><small>@{user.username} · Client</small></p>
          {nativeShell ? <button type="button" role="menuitem" onClick={switchServer}>Switch server</button> : null}
          <button type="button" role="menuitem" onClick={onSignOut}>Sign out</button></div> : null}
      </div>
    </header>
    <main className="portal__main">
      {view === "home" ? <div className="portal__home">
        <header className="portal__hello"><h1>Hi, {user.name.split(" ")[0]}</h1><p>Send the studio a request, or pick up a conversation.</p></header>
        <HomeBanners />
        <div className="portal__grid">
          <section className="portal__panel">
            <header><h2>Open requests</h2><button type="button" onClick={() => { setView("requests"); setComposing(true); setOpenCode(null); }}>New request</button></header>
            {rows === null ? <p className="portal__empty">Loading…</p> : active.length ? <RequestList rows={active.slice(0, 8)} onOpen={open} /> : <p className="portal__empty">No open requests.</p>}
          </section>
          <section className="portal__panel"><header><h2>Need something?</h2></header>
            <p className="portal__muted">Requests go straight to the studio. You'll see replies and status here, and if it becomes a ticket, where it is.</p>
            <ClusterButton variant="primary" onClick={() => { setView("requests"); setComposing(true); setOpenCode(null); }}><ClusterIcon name="plus" />New request</ClusterButton>
          </section>
        </div>
      </div> : null}
      {view === "requests" ? composing ? <NewClientRequest onCancel={() => setComposing(false)} onCreated={(code) => { void load(); open(code); }} />
        : openCode ? <ClientThread code={openCode} onBack={() => { setOpenCode(null); void load(); }} />
        : <section className="portal__page">
          <header className="portal__page-head"><h1>Requests</h1><ClusterButton size="compact" variant="primary" onClick={() => setComposing(true)}><ClusterIcon name="plus" />New request</ClusterButton></header>
          <section className="portal__panel">{rows === null ? <p className="portal__empty">Loading…</p> : rows.length ? <RequestList rows={rows} onOpen={open} /> : <p className="portal__empty">You haven't sent any requests yet.</p>}</section>
        </section> : null}
      {view === "announcements" ? <div className="portal__chat"><ChatPage /></div> : null}
    </main>
  </div>;
}

function RequestList({ rows, onOpen }: { rows: Row[]; onOpen: (code: string) => void }) {
  return <ul className="pp__list cp__list">{rows.map((row) => <li key={row.code}><button type="button" onClick={() => onOpen(row.code)}>
    <code>{row.code}</code>
    <span><strong>{row.title}</strong><small>{KIND[row.kind] || row.kind} · {row.ticket ? `Ticket: ${row.ticket.done ? "Done" : row.ticket.stage}` : STATUS[row.status] || row.status} · {formatRelativeTime(row.lastActivityAt)}</small></span>
    {row.studioReplied && !["resolved", "closed"].includes(row.status) ? <i className="cp__dot" aria-label="Studio replied" /> : <ClusterIcon name="chevron-right" />}
  </button></li>)}</ul>;
}

function NewClientRequest({ onCancel, onCreated }: { onCancel: () => void; onCreated: (code: string) => void }) {
  const [draft, setDraft] = useState({ kind: "request", title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError("");
    try { const result = await api<{ code: string }>("/api/portal/client/requests", { method: "POST", body: JSON.stringify(draft) }); onCreated(result.code); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't send."); }
    finally { setBusy(false); }
  }
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onCancel}><ClusterIcon name="chevron-left" /></button><h1>New request</h1></header>
    <form className="portal__panel pp__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <div className="portal__seg" role="radiogroup">{Object.entries(KIND).map(([value, label]) => <button key={value} type="button" role="radio" aria-selected={draft.kind === value} onClick={() => setDraft({ ...draft, kind: value })}>{label}</button>)}</div>
      <label><span>Title</span><input value={draft.title} maxLength={160} minLength={3} required onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label><span>Details</span><textarea value={draft.body} rows={7} maxLength={8000} required onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      {error ? <p className="portal__error" role="alert">{error}</p> : null}
      <ClusterButton type="submit" variant="primary" busy={busy} disabled={draft.title.trim().length < 3 || !draft.body.trim()}>Send</ClusterButton>
    </form>
  </section>;
}

function ClientThread({ code, onBack }: { code: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Detail>(`/api/portal/client/requests/${code}`).then(setDetail).catch(() => setError("That request isn't available.")), [code]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000); return () => window.clearInterval(timer); }, [load]);
  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try { await api(`/api/portal/client/requests/${code}/messages`, { method: "POST", body: JSON.stringify({ body: reply.trim() }) }); setReply(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't send."); }
    finally { setBusy(false); }
  }
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onBack}><ClusterIcon name="chevron-left" /></button><h1>{detail?.title || code}</h1>
      {detail ? <span className="pp__status" data-status={detail.status}>{STATUS[detail.status] || detail.status}</span> : null}</header>
    {error && !detail ? <p className="portal__empty">{error}</p> : null}
    {detail ? <>
      {detail.ticket ? <p className="cp__ticket"><ClusterIcon name="ticket" /> Ticket <strong>{detail.ticket.title}</strong> · {detail.ticket.done ? "Done" : detail.ticket.stage}</p> : null}
      <div className="portal__panel pp__thread">
        <article className="pp__msg" data-from="you"><div className="pp__md">{renderMarkdown(detail.body)}</div><time>{formatRelativeTime(detail.createdAt)}</time></article>
        {detail.messages.map((message) => <article key={message.id} className="pp__msg" data-from={message.from}><strong>{message.from === "studio" ? "Studio" : "You"}</strong><div className="pp__md">{renderMarkdown(message.body)}</div><time>{formatRelativeTime(message.createdAt)}</time></article>)}
      </div>
      {detail.status !== "closed" ? <form className="portal__panel pp__reply" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea value={reply} rows={3} maxLength={8000} placeholder="Write a reply…" onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
        <ClusterButton type="submit" variant="primary" busy={busy} disabled={!reply.trim()}>Send</ClusterButton>
        {error ? <p className="portal__error" role="alert">{error}</p> : null}
      </form> : <p className="portal__muted">This conversation is closed.</p>}
    </> : null}
  </section>;
}
