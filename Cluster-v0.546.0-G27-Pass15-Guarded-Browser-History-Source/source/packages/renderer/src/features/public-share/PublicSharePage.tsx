import { CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS, normalizeClusterExternalPortalSections, type ClusterExternalPortalSection } from "@cluster/shared";
import { useEffect, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { LoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { api } from "../../core/api";

type PublicSharePayload = {
  access: { level: string; sections: ClusterExternalPortalSection[]; expiresAt?: string | null; remainingUses?: number | null };
  project: {
    name: string;
    description?: string | null;
    status?: string | null;
    projectType?: string | null;
    updatedAt?: string | null;
    timeline: Array<{ title: string; description?: string | null; startsAt: string; endsAt?: string | null; type?: string | null }>;
    builds: Array<{ title: string; version: string; lane?: string | null; platform?: string | null; channel?: string | null; qaStatus?: string | null; approval?: string | null; updatedAt?: string | null }>;
    releases: Array<{ title: string; status?: string | null; publishedAt?: string | null; body?: string | null }>;
    library: Array<{ title: string; type?: string | null; status?: string | null; reviewState?: string | null; versionLabel?: string | null; mimeType?: string | null; updatedAt?: string | null }>;
    tickets: Array<{ title: string; priority?: string | null; state?: string | null; dueDate?: string | null; completedAt?: string | null; updatedAt?: string | null }>;
    reviews: Array<{ title: string; medium?: string | null; status?: string | null; approvalState?: string | null; versionLabel?: string | null; dueDate?: string | null; updatedAt?: string | null }>;
    threads: Array<{ body: string; status?: string | null; source: "review" | "shared"; resourceType?: string | null; createdAt: string }>;
  };
};

function label(value?: string | null) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\w/g, (char) => char.toUpperCase());
}
function accessLabel(level?: string | null) {
  if (level === "commenter") return "Comment access";
  if (level === "reviewer") return "Review access";
  return "View access";
}
function date(value?: string | null) { return value ? new Date(value).toLocaleDateString() : ""; }

export default function PublicSharePage({ token }: { token: string }) {
  const [payload, setPayload] = useState<PublicSharePayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    api<PublicSharePayload>(`/api/public/share/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setPayload(result); })
      .catch((reason) => { if (!controller.signal.aborted) { setPayload(null); setError(reason); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestVersion, token]);

  useEffect(() => {
    if (!payload?.project.name) return;
    const previous = document.title;
    document.title = `${payload.project.name} · Cluster restricted view`;
    return () => { document.title = previous; };
  }, [payload?.project.name]);

  function leaveShare() {
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.location.href = `${url.pathname}${url.search}${url.hash}`;
  }

  if (loading) return <div className="public-share-shell-v197"><div className="public-share-card-v197"><strong>Cluster</strong><LoadingState label="Opening restricted project view" rows={3} compact /></div></div>;
  if (error || !payload) return <div className="public-share-shell-v197"><div className="public-share-card-v197 error"><RequestErrorState error={error || new Error("The share link may be expired, revoked, or exhausted.")} title="Share link unavailable" onRetry={() => setRequestVersion((value) => value + 1)} actions={<ClusterButton variant="secondary" size="compact" onClick={leaveShare}>Open Cluster</ClusterButton>} /></div></div>;

  const sections = normalizeClusterExternalPortalSections(payload.access.sections);
  const has = (section: ClusterExternalPortalSection) => sections.includes(section);

  return <div className="public-share-shell-v197"><main className="public-share-workspace-v197">
    <header>
      <div><p className="eyebrow">Restricted project portal</p><h1>{payload.project.name}</h1>{has("overview") && <p className="muted">{payload.project.description || "No project description provided."}</p>}</div>
      <div className="public-share-meta-v197"><span>{accessLabel(payload.access.level)}</span>{has("overview") && <span>{payload.project.status || "active"}</span>}{payload.access.expiresAt && <span>Expires {date(payload.access.expiresAt)}</span>}</div>
    </header>
    <section className="public-share-summary-v197">
      {has("overview") && <div><span>Project type</span><strong>{label(payload.project.projectType || "general")}</strong></div>}
      <div><span>Available sections</span><strong>{sections.map((section) => CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS[section]).join(", ") || "None"}</strong></div>
      <div><span>Remaining opens</span><strong>{payload.access.remainingUses == null ? "Unlimited" : payload.access.remainingUses}</strong></div>
      {has("overview") && <div><span>Updated</span><strong>{payload.project.updatedAt ? date(payload.project.updatedAt) : "Unknown"}</strong></div>}
    </section>
    {has("timeline") && <section className="public-share-section-v197"><h2>Timeline & milestones</h2><div>{payload.project.timeline.length ? payload.project.timeline.map((item, index) => <article key={`${item.title}-${item.startsAt}-${index}`}><strong>{item.title}</strong><span>{label(item.type || "milestone")} · {date(item.startsAt)}{item.endsAt ? ` – ${date(item.endsAt)}` : ""}</span>{item.description && <small>{item.description}</small>}</article>) : <article><span>No shared timeline items.</span></article>}</div></section>}
    {has("delivery") && <section className="public-share-section-v197"><h2>Builds & releases</h2><div>{payload.project.releases.map((item, index) => <article key={`release-${item.title}-${index}`}><strong>{item.title}</strong><span>Release · {label(item.status)}{item.publishedAt ? ` · ${date(item.publishedAt)}` : ""}</span>{item.body && <small>{item.body}</small>}</article>)}{payload.project.builds.map((item, index) => <article key={`build-${item.version}-${index}`}><strong>{item.title} · {item.version}</strong><span>{[item.lane, item.platform, item.channel, item.qaStatus, item.approval].filter(Boolean).map(label).join(" · ")}</span></article>)}{!payload.project.releases.length && !payload.project.builds.length && <article><span>No shared builds or releases.</span></article>}</div></section>}
    {has("library") && <section className="public-share-section-v197"><h2>Library & deliverables</h2><div>{payload.project.library.length ? payload.project.library.map((item, index) => <article key={`${item.title}-${item.updatedAt || index}`}><strong>{item.title}</strong><span>{[item.type, item.status, item.reviewState, item.versionLabel, item.mimeType].filter(Boolean).map(label).join(" · ")}</span></article>) : <article><span>No externally visible Library items.</span></article>}</div></section>}
    {has("tickets") && <section className="public-share-section-v197"><h2>Tickets</h2><div>{payload.project.tickets.length ? payload.project.tickets.map((item, index) => <article key={`${item.title}-${item.updatedAt || index}`}><strong>{item.title}</strong><span>{[item.state, item.priority].filter(Boolean).map(label).join(" · ")}{item.dueDate ? ` · due ${date(item.dueDate)}` : ""}</span></article>) : <article><span>No shared tickets.</span></article>}</div></section>}
    {has("reviews") && <section className="public-share-section-v197"><h2>Reviews</h2><div>{payload.project.reviews.length ? payload.project.reviews.map((item, index) => <article key={`${item.title}-${item.updatedAt || index}`}><strong>{item.title}{item.versionLabel ? ` · ${item.versionLabel}` : ""}</strong><span>{[item.medium, item.status, item.approvalState].filter(Boolean).map(label).join(" · ")}{item.dueDate ? ` · due ${date(item.dueDate)}` : ""}</span></article>) : <article><span>No shared reviews.</span></article>}</div></section>}
    {has("threads") && <section className="public-share-section-v197"><h2>Comments & threads</h2><div>{payload.project.threads.length ? payload.project.threads.map((item, index) => <article key={`${item.source}-${item.createdAt}-${index}`}><strong>{item.source === "review" ? "Review thread" : `${label(item.resourceType)} thread`}</strong><span>{item.body}</span><small>{date(item.createdAt)}{item.status ? ` · ${label(item.status)}` : ""}</small></article>) : <article><span>No shared comments or threads.</span></article>}</div></section>}
    <footer><span>Restricted external view generated by Cluster.</span><ClusterButton variant="secondary" size="compact" onClick={leaveShare}>Open Cluster</ClusterButton></footer>
  </main></div>;
}
