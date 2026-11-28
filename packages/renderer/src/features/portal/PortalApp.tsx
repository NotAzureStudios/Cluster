import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLUSTER_ACCOUNT_TYPE_INFO, CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO, type ClusterContractorPortalFeature } from "@cluster/shared";
import { api, API_URL, uploadApi } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { renderMarkdown } from "../../core/markdown";
import { downloadAuthenticatedClusterFile } from "../../core/browser-download-transfers";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { LoginScreen, type AuthConfig } from "../auth/AuthScreens";
import { MyFormsPanel } from "../settings/MyFormsPanel";
import { ChatPage } from "../chat/ChatPage";
import { HomeBanners } from "../chat/HomeBanners";
import { nativeShell, switchServer } from "../mobile/native-shell";
import { loadPortalContext, type PortalContext } from "./portal-context";
import { PlayerPortal } from "./PlayerPortal";
import "./portal.css";

type Project = { id: string; name: string; color: string | null; status: string; targetDate: string | null; libraryFolderId: string | null; access: string };
type WorkItem = { id: string; title: string; description: string; kind: string; priority: string; dueDate: string | null; projectId: string; projectName: string; boardName: string; listTitle: string; done: boolean; checklist: { done: number; total: number } };
type Home = { projects: Project[]; work: WorkItem[]; time: { active: { id: string; title: string; startedAt: string } | null; weekMinutes: number } };
type View = "home" | ClusterContractorPortalFeature;

const VIEW_ICON: Record<View, ClusterIconName> = { home: "home", work: "check", forms: "list", files: "folder", time: "clock", calendar: "calendar", announcements: "bell" };
const hours = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
const dayLabel = (value: string) => new Date(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/** The external portal. Contractors and guests get a slim Cluster with the
 *  features the studio turned on; clients and players get their portals as
 *  they're built. Studio accounts are pointed back to Cluster. */
export default function PortalApp({ initialContext }: { initialContext: PortalContext }) {
  const [context, setContext] = useState(initialContext);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const reload = useCallback(() => loadPortalContext().then((next) => { setContext(next); setSigningIn(false); }).catch(() => undefined), []);
  useEffect(() => { document.title = `${context.studioName} · Portal`; }, [context.studioName]);
  useEffect(() => { if (!context.user) void api<AuthConfig>("/api/auth/config").then(setAuthConfig).catch(() => undefined); }, [context.user]);
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); await reload(); };

  // A portal address serves its own portals; the main address serves the
  // ones without an address of their own, under /portal.
  const onPortalHost = context.hostAudiences.length > 0;
  const serves = (audience: "contractor" | "client" | "player") => context.portals[audience].enabled && (onPortalHost ? context.hostAudiences.includes(audience) : !context.portals[audience].ownHost);
  const base = onPortalHost ? "" : "/portal";
  const accountsHere = serves("contractor") || serves("client");
  const login = <div className="portal portal--signin" data-audience={context.hostAudiences.find((audience) => audience !== "player") || "contractor"}><LoginScreen config={authConfig} studioName={`${context.studioName} portal`} onLogin={() => void reload()} onRetryConfig={() => void api<AuthConfig>("/api/auth/config").then(setAuthConfig)} /></div>;

  const audience = context.user?.portal || null;
  if (!context.user || !audience) {
    if (signingIn && !context.user) return login;
    if (serves("player")) return <PlayerPortal context={context} base={base} onSignIn={!context.user && accountsHere ? () => setSigningIn(true) : undefined} />;
    if (!context.user) return accountsHere || !onPortalHost ? login : <PortalNotice context={context} title={context.studioName} body="This portal isn't open yet." />;
    return <PortalNotice context={context} title="This is the external portal" body="Studio members use Cluster." action={context.mainUrl ? <a className="portal__link-button" href={context.mainUrl}>Open Cluster</a> : null} onSignOut={signOut} />;
  }
  if (!context.portals[audience].enabled) return <PortalNotice context={context} title="Your portal is turned off" body="Contact the studio if you need access." onSignOut={signOut} />;
  if (audience !== "contractor") return <PortalNotice context={context} title={`${context.studioName} ${audience} portal`} body="Your portal is coming soon. The studio will reach out in the meantime." onSignOut={signOut} />;
  return <ContractorPortal context={context} onSignOut={signOut} />;
}

function PortalNotice({ context, title, body, action, onSignOut }: { context: PortalContext; title: string; body: string; action?: React.ReactNode; onSignOut?: () => void }) {
  return <div className="portal portal--notice" data-audience={context.user?.portal || context.hostAudiences[0] || "contractor"}><main>
    <span className="portal__studio">{context.studioName}</span>
    <h1>{title}</h1><p>{body}</p>
    <div className="portal__notice-actions">{action}{onSignOut ? <ClusterButton variant="secondary" onClick={onSignOut}>Sign out</ClusterButton> : null}</div>
  </main></div>;
}

function ContractorPortal({ context, onSignOut }: { context: PortalContext; onSignOut: () => void }) {
  const user = context.user!;
  const features = context.contractorFeatures;
  const views: View[] = ["home", ...features];
  const [view, setView] = useState<View>(() => { const hash = window.location.hash.slice(1) as View; return views.includes(hash) ? hash : "home"; });
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const load = useCallback(() => api<Home>("/api/portal/home").then((value) => { setHome(value); setError(""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "The portal couldn't load.")), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.history.replaceState(null, "", `#${view}`); }, [view]);
  const info = CLUSTER_ACCOUNT_TYPE_INFO[user.accountType];
  const expires = user.accessExpiresAt ? new Date(user.accessExpiresAt) : null;

  return <div className="portal" data-audience="contractor">
    <header className="portal__bar">
      <div className="portal__brand"><strong>{context.studioName}</strong><span className="portal__badge">{info.label} portal</span></div>
      <nav className="portal__nav" aria-label="Portal">
        {views.map((id) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
          <ClusterIcon name={VIEW_ICON[id]} /><span>{id === "home" ? "Home" : CLUSTER_CONTRACTOR_PORTAL_FEATURE_INFO[id].label}</span>
        </button>)}
      </nav>
      <div className="portal__account">
        <button type="button" className="portal__me" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          {user.avatarUrl ? <img src={`${API_URL}${user.avatarUrl}`} alt="" /> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}
        </button>
        {menu ? <div className="portal__menu" role="menu">
          <p><strong>{user.name}</strong><small>@{user.username} · {info.label}</small></p>
          {nativeShell ? <button type="button" role="menuitem" onClick={switchServer}>Switch server</button> : null}
          <button type="button" role="menuitem" onClick={onSignOut}>Sign out</button>
        </div> : null}
      </div>
    </header>
    <main className="portal__main">
      {error ? <p className="portal__error" role="alert">{error}</p> : null}
      {view === "home" ? <PortalHome context={context} home={home} expires={expires} onOpen={setView} onChanged={load} readOnly={user.readOnly} /> : null}
      {view === "work" ? <WorkView home={home} onChanged={load} readOnly={user.readOnly} /> : null}
      {view === "calendar" ? <CalendarView home={home} /> : null}
      {view === "forms" ? <section className="portal__panel"><MyFormsPanel /></section> : null}
      {view === "files" ? <FilesView projects={home?.projects || []} /> : null}
      {view === "time" ? <TimeView home={home} onChanged={load} readOnly={user.readOnly} /> : null}
      {view === "announcements" ? <div className="portal__chat"><ChatPage /></div> : null}
    </main>
  </div>;
}

function PortalHome({ context, home, expires, onOpen, onChanged, readOnly }: { context: PortalContext; home: Home | null; expires: Date | null; onOpen: (view: View) => void; onChanged: () => void; readOnly: boolean }) {
  const features = context.contractorFeatures;
  const open = (home?.work || []).filter((item) => !item.done);
  return <div className="portal__home">
    <header className="portal__hello">
      <h1>Hi, {context.user!.name.split(" ")[0]}</h1>
      {expires ? <p>Access until {expires.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</p> : null}
    </header>
    {features.includes("announcements") ? <HomeBanners /> : null}
    <div className="portal__grid">
      {features.includes("work") ? <section className="portal__panel">
        <header><h2>Up next</h2>{open.length ? <button type="button" onClick={() => onOpen("work")}>All {open.length}</button> : null}</header>
        {home === null ? <p className="portal__empty">Loading…</p> : open.length ? <WorkList items={open.slice(0, 6)} onChanged={onChanged} readOnly={readOnly} compact /> : <p className="portal__empty">Nothing assigned to you.</p>}
      </section> : null}
      <section className="portal__panel">
        <header><h2>Projects</h2></header>
        {home === null ? <p className="portal__empty">Loading…</p> : home.projects.length ? <ul className="portal__projects">{home.projects.map((project) => <li key={project.id}>
          <i style={{ background: project.color || "var(--accent)" }} /><span><strong>{project.name}</strong><small>{project.access === "view" ? "View only" : "Contributor"}{project.targetDate ? ` · due ${new Date(project.targetDate).toLocaleDateString()}` : ""}</small></span>
          {features.includes("files") && project.libraryFolderId ? <button type="button" onClick={() => onOpen("files")}>Files</button> : null}
        </li>)}</ul> : <p className="portal__empty">You're not on any projects yet.</p>}
      </section>
      {features.includes("time") ? <section className="portal__panel">
        <header><h2>This week</h2><button type="button" onClick={() => onOpen("time")}>Time</button></header>
        <p className="portal__big">{home ? hours(home.time.weekMinutes) : "—"}</p>
        {home?.time.active ? <p className="portal__muted">Clocked in since {new Date(home.time.active.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
      </section> : null}
    </div>
  </div>;
}

function WorkList({ items, onChanged, readOnly, compact = false }: { items: WorkItem[]; onChanged: () => void; readOnly: boolean; compact?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function toggle(item: WorkItem) {
    setBusy(item.id); setError("");
    try { await api(`/api/portal/work/${item.id}`, { method: "POST", body: JSON.stringify({ done: !item.done }) }); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); }
    finally { setBusy(null); }
  }
  return <>
    {error ? <p className="portal__error" role="alert">{error}</p> : null}
    <ul className="portal__work">{items.map((item) => {
      const overdue = !item.done && item.dueDate && new Date(item.dueDate).getTime() < Date.now();
      return <li key={item.id} data-done={item.done || undefined}>
        <button type="button" className="portal__check" aria-label={item.done ? "Mark not done" : "Mark done"} disabled={readOnly || busy === item.id} onClick={() => void toggle(item)}>{item.done ? <ClusterIcon name="check" /> : null}</button>
        <button type="button" className="portal__work-main" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>
          <strong>{item.title}</strong>
          <small>{item.projectName}{compact ? "" : ` · ${item.boardName} · ${item.listTitle}`}{item.checklist.total ? ` · ${item.checklist.done}/${item.checklist.total}` : ""}</small>
        </button>
        <span className="portal__work-meta">
          {item.priority === "urgent" || item.priority === "high" ? <em data-priority={item.priority}>{item.priority === "urgent" ? "Urgent" : "High"}</em> : null}
          {item.dueDate ? <time data-overdue={overdue || undefined} dateTime={item.dueDate}>{dayLabel(item.dueDate)}</time> : null}
        </span>
        {openId === item.id ? <div className="portal__work-detail">{item.description.trim() ? renderMarkdown(item.description) : <p className="portal__muted">No description.</p>}</div> : null}
      </li>;
    })}</ul>
  </>;
}

function WorkView({ home, onChanged, readOnly }: { home: Home | null; onChanged: () => void; readOnly: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const items = (home?.work || []).filter((item) => item.done === showDone);
  const byProject = useMemo(() => {
    const groups = new Map<string, WorkItem[]>();
    for (const item of items) groups.set(item.projectName, [...(groups.get(item.projectName) || []), item]);
    return [...groups.entries()];
  }, [items]);
  return <section className="portal__page">
    <header className="portal__page-head"><h1>Work</h1>
      <div className="portal__seg" role="tablist"><button type="button" role="tab" aria-selected={!showDone} onClick={() => setShowDone(false)}>Open</button><button type="button" role="tab" aria-selected={showDone} onClick={() => setShowDone(true)}>Done</button></div>
    </header>
    {home === null ? <p className="portal__empty">Loading…</p> : byProject.length ? byProject.map(([project, list]) => <section key={project} className="portal__panel"><header><h2>{project}</h2><small>{list.length}</small></header><WorkList items={list} onChanged={onChanged} readOnly={readOnly} /></section>)
      : <p className="portal__empty">{showDone ? "Nothing finished yet." : "Nothing assigned to you."}</p>}
  </section>;
}

function CalendarView({ home }: { home: Home | null }) {
  const groups = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const buckets: Array<[string, WorkItem[]]> = [["Overdue", []], ["Today", []], ["This week", []], ["Later", []], ["No date", []]];
    for (const item of (home?.work || []).filter((entry) => !entry.done)) {
      if (!item.dueDate) { buckets[4][1].push(item); continue; }
      const days = Math.floor((new Date(item.dueDate).getTime() - start.getTime()) / 86_400_000);
      buckets[days < 0 ? 0 : days === 0 ? 1 : days < 7 ? 2 : 3][1].push(item);
    }
    return buckets.filter(([, list]) => list.length);
  }, [home]);
  return <section className="portal__page">
    <header className="portal__page-head"><h1>Calendar</h1></header>
    {home === null ? <p className="portal__empty">Loading…</p> : groups.length ? groups.map(([label, list]) => <section key={label} className="portal__panel" data-bucket={label}>
      <header><h2>{label}</h2><small>{list.length}</small></header>
      <ul className="portal__agenda">{list.map((item) => <li key={item.id}><time>{item.dueDate ? dayLabel(item.dueDate) : "—"}</time><span><strong>{item.title}</strong><small>{item.projectName}</small></span></li>)}</ul>
    </section>) : <p className="portal__empty">Nothing due.</p>}
  </section>;
}

type FileRow = { id: string; title: string; type: string; hasFile: boolean; name: string | null; sizeBytes: number | null; extension: string | null; externalUrl: string | null; updatedAt: string };
type Folder = { folder: { id: string; title: string; parentId: string | null; isRoot: boolean }; canUpload: boolean; items: FileRow[] };
const size = (bytes: number | null) => bytes == null ? "" : bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

function FilesView({ projects }: { projects: Project[] }) {
  const withFiles = projects.filter((project) => project.libraryFolderId);
  const [projectId, setProjectId] = useState<string>("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [data, setData] = useState<Folder | null>(null);
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!projectId && withFiles[0]) setProjectId(withFiles[0].id); }, [withFiles.length]);
  const load = useCallback(() => {
    if (!projectId) return;
    setData(null);
    void api<Folder>(`/api/portal/files?${new URLSearchParams({ projectId, ...(folderId ? { folderId } : {}) })}`).then(setData).catch((reason) => setStatus(reason instanceof Error ? reason.message : "Files couldn't load."));
  }, [projectId, folderId]);
  useEffect(load, [load]);
  async function upload(files: File[]) {
    if (!data) return;
    let done = 0;
    try {
      for (const file of files) {
        setStatus(`Uploading ${file.name} (${done + 1}/${files.length})…`);
        await uploadApi("/api/library/transfers/finalize", { file, label: `Transfer ${file.name}`, body: { parentId: data.folder.id, projectId, originalName: file.name, relativePath: file.name, mimeType: file.type || "application/octet-stream", conflictPolicy: "rename", classification: "internal", tags: [], metadata: {} }, invalidate: [], persistBeforeTransfer: false });
        done += 1;
      }
      setStatus(`${done} file${done === 1 ? "" : "s"} uploaded.`);
      window.setTimeout(load, 1500);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Upload failed."); }
  }
  if (!withFiles.length) return <section className="portal__page"><header className="portal__page-head"><h1>Files</h1></header><p className="portal__empty">Your projects don't have files yet.</p></section>;
  return <section className="portal__page">
    <header className="portal__page-head"><h1>Files</h1>
      {withFiles.length > 1 ? <div className="portal__seg">{withFiles.map((project) => <button key={project.id} type="button" aria-selected={projectId === project.id} onClick={() => { setProjectId(project.id); setFolderId(null); }}>{project.name}</button>)}</div> : null}
      {data?.canUpload ? <><ClusterButton size="compact" variant="primary" onClick={() => input.current?.click()}><ClusterIcon name="upload" />Upload</ClusterButton>
        <input ref={input} type="file" multiple hidden onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void upload(files); }} /></> : null}
    </header>
    {status ? <p className="portal__muted" role="status">{status}</p> : null}
    <section className="portal__panel">
      <header>{data && !data.folder.isRoot ? <button type="button" onClick={() => setFolderId(data.folder.parentId)}><ClusterIcon name="chevron-left" /></button> : null}<h2>{data?.folder.title || "…"}</h2></header>
      {data === null ? <p className="portal__empty">Loading…</p> : data.items.length ? <ul className="portal__files">{data.items.map((item) => <li key={item.id}>
        <button type="button" onClick={() => {
          if (item.type === "folder") setFolderId(item.id);
          else if (item.externalUrl) window.open(item.externalUrl, "_blank", "noopener");
          else if (item.hasFile) void downloadAuthenticatedClusterFile({ url: `${API_URL}/api/library/${item.id}/file?download=1`, fileName: item.name || item.title, sizeBytes: item.sizeBytes });
        }}>
          <ClusterIcon name={item.type === "folder" ? "folder" : item.externalUrl ? "link" : "file"} />
          <span><strong>{item.title}</strong><small>{item.type === "folder" ? "Folder" : [item.extension?.toUpperCase(), size(item.sizeBytes)].filter(Boolean).join(" · ")}</small></span>
          <time>{formatRelativeTime(item.updatedAt)}</time>
        </button>
      </li>)}</ul> : <p className="portal__empty">This folder is empty.</p>}
    </section>
  </section>;
}

function TimeView({ home, onChanged, readOnly }: { home: Home | null; onChanged: () => void; readOnly: boolean }) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = home?.time.active || null;
  async function clock() {
    setBusy(true); setError("");
    try {
      if (active) await api("/api/time/stop", { method: "POST", body: "{}" });
      else await api("/api/time/start", { method: "POST", body: JSON.stringify({ title: title.trim() || "Work session", projectId: projectId || null }) });
      setTitle(""); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That didn't save."); }
    finally { setBusy(false); }
  }
  return <section className="portal__page">
    <header className="portal__page-head"><h1>Time</h1></header>
    <section className="portal__panel portal__clock">
      <p className="portal__big">{home ? hours(home.time.weekMinutes) : "—"}<small> this week</small></p>
      {active ? <p className="portal__muted">Clocked in on “{active.title}” since {new Date(active.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : !readOnly ? <div className="portal__clock-form">
        <input value={title} placeholder="What are you working on?" aria-label="Session" onChange={(event) => setTitle(event.target.value)} />
        <select value={projectId} aria-label="Project" onChange={(event) => setProjectId(event.target.value)}><option value="">No project</option>{(home?.projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      </div> : null}
      {!readOnly ? <ClusterButton variant={active ? "danger" : "primary"} busy={busy} onClick={() => void clock()}>{active ? "Clock out" : "Clock in"}</ClusterButton> : null}
      {error ? <p className="portal__error" role="alert">{error}</p> : null}
    </section>
  </section>;
}
