import { useCallback, useEffect, useState } from "react";
import { api } from "../../core/api";
import { renderMarkdown } from "../../core/markdown";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import type { PortalContext } from "./portal-context";

type Kind = "bug" | "help" | "feedback";
type Saved = { code: string; key: string; title: string; kind: string };
type Ticket = { code: string; kind: string; title: string; body: string; status: string; stage: string | null; createdAt: string; messages: Array<{ id: string; from: "studio" | "you"; body: string; createdAt: string }> };
type Application = { id: string; key: string; title: string; description?: string | null; versions?: StudioFormDocument["version"][] };
type Page = { name: "home" } | { name: "new"; kind: Kind } | { name: "apply" } | { name: "ticket"; code: string; key: string } | { name: "find" };

const KINDS: Record<Kind, { label: string; icon: ClusterIconName; prompt: string; title: string }> = {
  bug: { label: "Report a bug", icon: "warning", prompt: "What happened, and what did you expect? Include steps to reproduce if you can.", title: "Short summary of the bug" },
  help: { label: "Get help", icon: "comment", prompt: "What do you need help with?", title: "What's this about?" },
  feedback: { label: "Send feedback", icon: "spark", prompt: "Tell us what you think.", title: "Topic" },
};
const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting on you", resolved: "Resolved", closed: "Closed" };
const STORE = "cluster.portal.requests";
const readSaved = (): Saved[] => { try { const value = JSON.parse(localStorage.getItem(STORE) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const remember = (entry: Saved) => { try { localStorage.setItem(STORE, JSON.stringify([entry, ...readSaved().filter((item) => item.code !== entry.code)].slice(0, 20))); } catch { /* private mode */ } };

/** The player portal: no account. Players report bugs, ask for help, send
 *  feedback, apply, and follow each conversation by its code and key. */
export function PlayerPortal({ context, base, onSignIn }: { context: PortalContext; base: string; onSignIn?: () => void }) {
  const [page, setPageState] = useState<Page>(() => pageFromLocation(base));
  const [news, setNews] = useState<Array<{ id: string; title: string; body: string; publishedAt: string }>>([]);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const setPage = useCallback((next: Page) => {
    const path = next.name === "ticket" ? `${base}/t/${next.code}#k=${next.key}` : `${base || "/"}`;
    window.history.pushState(null, "", path);
    setPageState(next);
    window.scrollTo({ top: 0 });
  }, [base]);
  useEffect(() => { const back = () => setPageState(pageFromLocation(base)); window.addEventListener("popstate", back); return () => window.removeEventListener("popstate", back); }, [base]);
  useEffect(() => {
    document.title = `${context.studioName} · Community`;
    void api<{ announcements: typeof news }>("/api/portal/public/home").then((value) => setNews(value.announcements)).catch(() => undefined);
    void api<{ applications: Application[] }>("/api/public/v1/studio-cover").then((value) => setApplications(value.applications)).catch(() => setApplications([]));
  }, []);

  return <div className="portal" data-audience="player">
    <header className="portal__bar">
      <button type="button" className="portal__brand portal__brand--link" onClick={() => setPage({ name: "home" })}><strong>{context.studioName}</strong><span className="portal__badge">Community</span></button>
      <span className="portal__spacer" />
      {context.user ? <span className="portal__muted">Signed in as {context.user.name}</span> : onSignIn ? <ClusterButton size="compact" variant="quiet" onClick={onSignIn}>Sign in</ClusterButton> : null}
    </header>
    <main className="portal__main portal__main--narrow">
      {page.name === "home" ? <PlayerHome context={context} news={news} applicationsOpen={Boolean(applications?.length)} go={setPage} /> : null}
      {page.name === "new" ? <NewRequest kind={page.kind} onBack={() => setPage({ name: "home" })} onCreated={(saved) => { remember(saved); setPage({ name: "ticket", code: saved.code, key: saved.key }); }} /> : null}
      {page.name === "apply" ? <Apply applications={applications} onBack={() => setPage({ name: "home" })} onCreated={(saved) => { remember(saved); setPage({ name: "ticket", code: saved.code, key: saved.key }); }} /> : null}
      {page.name === "ticket" ? <TicketView code={page.code} secret={page.key} onBack={() => setPage({ name: "home" })} /> : null}
      {page.name === "find" ? <FindTicket onBack={() => setPage({ name: "home" })} onFound={(code, key) => setPage({ name: "ticket", code, key })} /> : null}
    </main>
  </div>;
}

function pageFromLocation(base: string): Page {
  const path = window.location.pathname.slice(base.length);
  const match = /^\/t\/([A-Z0-9-]{4,20})$/i.exec(path);
  const key = new URLSearchParams(window.location.hash.slice(1)).get("k") || "";
  return match && key ? { name: "ticket", code: match[1].toUpperCase(), key } : { name: "home" };
}

function PlayerHome({ context, news, applicationsOpen, go }: { context: PortalContext; news: Array<{ id: string; title: string; body: string; publishedAt: string }>; applicationsOpen: boolean; go: (page: Page) => void }) {
  const saved = readSaved();
  return <div className="pp">
    <section className="pp__hero"><h1>How can we help?</h1><p>Talk to the {context.studioName} team directly.</p></section>
    <div className="pp__actions">
      {(Object.keys(KINDS) as Kind[]).map((kind) => <button key={kind} type="button" onClick={() => go({ name: "new", kind })}><ClusterIcon name={KINDS[kind].icon} /><strong>{KINDS[kind].label}</strong></button>)}
      {applicationsOpen ? <button type="button" onClick={() => go({ name: "apply" })}><ClusterIcon name="users" /><strong>Apply to join</strong></button> : null}
      <button type="button" onClick={() => go({ name: "find" })}><ClusterIcon name="search" /><strong>Check a request</strong></button>
    </div>
    {saved.length ? <section className="portal__panel"><header><h2>Your requests</h2><small>on this device</small></header>
      <ul className="pp__list">{saved.map((item) => <li key={item.code}><button type="button" onClick={() => go({ name: "ticket", code: item.code, key: item.key })}><code>{item.code}</code><span>{item.title}</span><ClusterIcon name="chevron-right" /></button></li>)}</ul>
    </section> : null}
    {news.length ? <section className="portal__panel"><header><h2>News</h2></header>
      {news.map((item) => <article key={item.id} className="pp__news"><header><strong>{item.title}</strong><time>{formatRelativeTime(item.publishedAt)}</time></header><div className="pp__md">{renderMarkdown(item.body)}</div></article>)}
    </section> : null}
  </div>;
}

function NewRequest({ kind, onBack, onCreated }: { kind: Kind; onBack: () => void; onCreated: (saved: Saved) => void }) {
  const [draft, setDraft] = useState({ title: "", body: "", contactName: "", contactEmail: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = KINDS[kind];
  async function send() {
    setBusy(true); setError("");
    try {
      const result = await api<{ code: string; key: string }>("/api/portal/public/requests", { method: "POST", body: JSON.stringify({ kind, ...draft, contactEmail: draft.contactEmail.trim() }) });
      if (result.key) onCreated({ code: result.code, key: result.key, title: draft.title.trim(), kind });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't send. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onBack}><ClusterIcon name="chevron-left" /></button><h1>{info.label}</h1></header>
    <form className="portal__panel pp__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label><span>{info.title}</span><input value={draft.title} maxLength={160} required minLength={3} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label><span>Details</span><textarea value={draft.body} maxLength={8000} rows={7} required placeholder={info.prompt} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      <div className="pp__row">
        <label><span>Name <small>optional</small></span><input value={draft.contactName} maxLength={120} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} /></label>
        <label><span>Email <small>optional</small></span><input type="email" value={draft.contactEmail} maxLength={200} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} /></label>
      </div>
      <label className="pp__trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} /></label>
      {error ? <p className="portal__error" role="alert">{error}</p> : null}
      <ClusterButton type="submit" variant="primary" busy={busy} disabled={draft.title.trim().length < 3 || !draft.body.trim()}>Send</ClusterButton>
    </form>
  </section>;
}

function Apply({ applications, onBack, onCreated }: { applications: Application[] | null; onBack: () => void; onCreated: (saved: Saved) => void }) {
  const [key, setKey] = useState("");
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => { if (!key && applications?.[0]) setKey(applications[0].key); }, [applications]);
  const selected = applications?.find((item) => item.key === key) || null;
  const version = selected?.versions?.[0] || null;
  const document: StudioFormDocument | null = selected && version ? { form: { id: selected.id, key: selected.key, title: selected.title, description: selected.description } as StudioFormDocument["form"], version } : null;
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onBack}><ClusterIcon name="chevron-left" /></button><h1>Apply</h1>
      {applications && applications.length > 1 ? <div className="portal__seg">{applications.map((item) => <button key={item.key} type="button" aria-selected={item.key === key} onClick={() => setKey(item.key)}>{item.title}</button>)}</div> : null}
    </header>
    {applications === null ? <p className="portal__empty">Loading…</p> : !document ? <p className="portal__empty">No open applications right now.</p> : <div className="portal__panel">
      <StudioFormRunner drafts={false} document={document} submitLabel="Submit application" submit={async (payload) => {
        if (!privacy) throw new Error("Confirm the privacy notice before submitting your application.");
        const result = await api<{ code?: string; key?: string; confirmationMessage?: string }>(`/api/public/v1/applications/${document.form.key}/submissions`, { method: "POST", body: JSON.stringify({ ...payload, privacyAccepted: true, website: "" }) });
        if (result.code && result.key) onCreated({ code: result.code, key: result.key, title: document.form.title, kind: "application" });
        return result;
      }} />
      <label className="pp__consent"><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} /> I consent to the studio using this information to review my application.</label>
    </div>}
  </section>;
}

function TicketView({ code, secret, onBack }: { code: string; secret: string; onBack: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Ticket>(`/api/portal/public/requests/${code}?key=${encodeURIComponent(secret)}`).then((value) => { setTicket(value); setError(""); }).catch(() => setError("We couldn't find that request. Check the link.")), [code, secret]);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000); return () => window.clearInterval(timer); }, [load]);
  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try { await api(`/api/portal/public/requests/${code}/messages`, { method: "POST", body: JSON.stringify({ key: secret, body: reply.trim() }) }); setReply(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't send."); }
    finally { setBusy(false); }
  }
  const link = `${window.location.origin}${window.location.pathname}#k=${secret}`;
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onBack}><ClusterIcon name="chevron-left" /></button><h1>{ticket?.title || code}</h1>
      {ticket ? <span className="pp__status" data-status={ticket.status}>{ticket.stage || STATUS[ticket.status] || ticket.status}</span> : null}
    </header>
    {error && !ticket ? <p className="portal__empty">{error}</p> : null}
    {ticket ? <>
      <p className="pp__keep">Request <code>{ticket.code}</code>. Keep this page's link to come back: <button type="button" onClick={() => void navigator.clipboard?.writeText(link)}>Copy link</button></p>
      <div className="portal__panel pp__thread">
        {ticket.body ? <article className="pp__msg" data-from="you"><div className="pp__md">{renderMarkdown(ticket.body)}</div><time>{formatRelativeTime(ticket.createdAt)}</time></article> : null}
        {ticket.kind === "application" && !ticket.messages.length ? <p className="portal__muted">Your application was received. The studio will reply here.</p> : null}
        {ticket.messages.map((message) => <article key={message.id} className="pp__msg" data-from={message.from}><strong>{message.from === "studio" ? "Studio" : "You"}</strong><div className="pp__md">{renderMarkdown(message.body)}</div><time>{formatRelativeTime(message.createdAt)}</time></article>)}
      </div>
      {ticket.status !== "closed" ? <form className="portal__panel pp__reply" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea value={reply} rows={3} maxLength={8000} placeholder="Write a reply…" onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
        <ClusterButton type="submit" variant="primary" busy={busy} disabled={!reply.trim()}>Send</ClusterButton>
        {error ? <p className="portal__error" role="alert">{error}</p> : null}
      </form> : <p className="portal__muted">This conversation is closed.</p>}
    </> : null}
  </section>;
}

function FindTicket({ onBack, onFound }: { onBack: () => void; onFound: (code: string, key: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  function open() {
    try {
      const url = new URL(value.trim());
      const match = /\/t\/([A-Z0-9-]{4,20})$/i.exec(url.pathname);
      const key = new URLSearchParams(url.hash.slice(1)).get("k");
      if (match && key) { onFound(match[1].toUpperCase(), key); return; }
    } catch { /* not a link */ }
    setError("Paste the full link you saved when you sent the request.");
  }
  return <section className="portal__page">
    <header className="portal__page-head"><button type="button" className="pp__back" onClick={onBack}><ClusterIcon name="chevron-left" /></button><h1>Check a request</h1></header>
    <form className="portal__panel pp__form" onSubmit={(event) => { event.preventDefault(); open(); }}>
      <label><span>Request link</span><input value={value} placeholder="https://…/t/ABCD-1234#k=…" onChange={(event) => { setValue(event.target.value); setError(""); }} /></label>
      {error ? <p className="portal__error" role="alert">{error}</p> : null}
      <ClusterButton type="submit" variant="primary" disabled={!value.trim()}>Open</ClusterButton>
    </form>
  </section>;
}
