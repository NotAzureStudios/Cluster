import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { renderMarkdown } from "../../core/markdown";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import type { StudioAudience } from "@cluster/shared";
import { AudienceField, describeAudience, useAudienceCatalog, type AudienceCatalog } from "./AudienceField";
import "./chat.css";

type Announcement = {
  id: string; title: string; body: string; priority: "low" | "normal" | "high" | "urgent";
  requiresAcknowledgement: boolean; publishedAt: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  deliveryId: string | null; read: boolean; acknowledgedAt: string | null;
  reach: { delivered: number; read: number; acknowledged: number } | null;
  homeBanner: boolean; bannerActive: boolean; audience: StudioAudience | null;
};
type Feed = { manager: boolean; announcements: Announcement[] };

const PRIORITY_LABEL: Record<string, string> = { high: "Important", urgent: "Urgent" };

/** Chat. Channels on the left, the conversation on the right. Announcements
 *  is the first channel; direct and group messages build on the same frame. */
export function ChatPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");
  const catalog = useAudienceCatalog();
  const scroller = useRef<HTMLDivElement | null>(null);

  async function load() {
    try { setFeed(await api<Feed>("/api/announcements")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Announcements are unavailable."); }
  }
  useEffect(() => { void load(); }, []);

  // Oldest first, like a conversation; reading the channel marks it read.
  const messages = useMemo(() => [...(feed?.announcements || [])].reverse(), [feed]);
  const unread = messages.filter((item) => item.deliveryId && !item.read);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    const ids = unread.map((item) => item.deliveryId!);
    if (ids.length) void api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids, read: true }) }).catch(() => undefined);
  }, [messages.length]);

  async function acknowledge(item: Announcement) {
    if (!item.deliveryId) return;
    await api("/api/notifications/acknowledge", { method: "POST", body: JSON.stringify({ ids: [item.deliveryId], acknowledged: true }) });
    await load();
  }

  async function endBanner(item: Announcement) {
    await api(`/api/announcements/${item.id}/end-banner`, { method: "POST", body: "{}" });
    await load();
  }

  return <main className="chat" aria-label="Chat">
    <nav className="chat__rail" aria-label="Channels">
      <h1>Chat</h1>
      <h2>Channels</h2>
      <ClusterButton unstyled type="button" className="chat__channel is-active" aria-current="page">
        <ClusterIcon name="bell" /><span>Announcements</span>{unread.length ? <b>{unread.length}</b> : null}
      </ClusterButton>
      <h2>Messages</h2>
      <p className="chat__soon"><ClusterIcon name="comment" /><span>Direct messages</span><em>Coming soon</em></p>
    </nav>
    <section className="chat__room">
      <header className="chat__head">
        <div><h2>Announcements</h2><span>Studio updates</span></div>
      </header>
      <div className="chat__stream" ref={scroller}>
        {error ? <p className="chat__empty" role="alert">{error}</p> : !feed ? <p className="chat__empty">Loading…</p>
          : !messages.length ? <p className="chat__empty">No announcements yet.</p>
          : messages.map((item) => <article key={item.id} className="chat__msg" data-priority={item.priority}>
            <PresenceAvatar userId={item.author?.id} imageUrl={item.author?.avatarUrl} label={item.author?.name || "Cluster"} fallback={(item.author?.name || "C").slice(0, 1).toUpperCase()} />
            <div className="chat__msg-body">
              <header><strong>{item.author?.name || "Cluster"}</strong><time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{formatRelativeTime(item.publishedAt)}</time>{PRIORITY_LABEL[item.priority] ? <span className="chat__tag" data-priority={item.priority}>{PRIORITY_LABEL[item.priority]}</span> : null}{item.bannerActive ? <span className="chat__tag" data-banner>On Home</span> : null}{item.audience ? <span className="chat__to-note">to {describeAudience(item.audience, catalog)}</span> : null}</header>
              <h3>{item.title}</h3>
              <div className="chat__md">{renderMarkdown(item.body)}</div>
              {(item.requiresAcknowledgement && item.deliveryId) || item.reach || (feed?.manager && item.bannerActive) ? <footer>
                {item.requiresAcknowledgement && item.deliveryId ? item.acknowledgedAt
                  ? <span className="chat__ack"><ClusterIcon name="check" /> Acknowledged</span>
                  : <ClusterButton size="compact" variant="primary" onClick={() => void acknowledge(item)}>Acknowledge</ClusterButton> : null}
                {feed?.manager && item.bannerActive ? <ClusterButton size="compact" variant="quiet" onClick={() => void endBanner(item)}>End banner</ClusterButton> : null}
                {item.reach ? <span className="chat__reach">Seen by {item.reach.read}/{item.reach.delivered}{item.requiresAcknowledgement ? ` · ${item.reach.acknowledged} acknowledged` : ""}</span> : null}
              </footer> : null}
            </div>
          </article>)}
      </div>
      {feed?.manager ? <AnnouncementComposer onPosted={load} catalog={catalog} /> : null}
    </section>
  </main>;
}

function AnnouncementComposer({ onPosted, catalog }: { onPosted: () => Promise<void>; catalog: AudienceCatalog | null }) {
  const [audience, setAudience] = useState<StudioAudience>({ mode: "all", targets: [] });
  const [banner, setBanner] = useState(false);
  const [bannerUntil, setBannerUntil] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [ack, setAck] = useState(false);
  const [discord, setDiscord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = title.trim() && body.trim() && !busy;

  async function post() {
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const created = await api<{ id: string }>("/api/studio-systems/announcements", { method: "POST", body: JSON.stringify({
        createIntentId: crypto.randomUUID(), title: title.trim(), body: body.trim(), priority,
        requiresAcknowledgement: ack, discordDeliveryRequested: discord, audience,
        homeBanner: banner, bannerEndsAt: banner && bannerUntil ? new Date(bannerUntil).toISOString() : null,
      }) });
      await api(`/api/studio-systems/announcements/${created.id}/publish`, { method: "POST", body: "{}" });
      setTitle(""); setBody(""); setPriority("normal"); setAck(false); setDiscord(false); setAudience({ mode: "all", targets: [] }); setBanner(false); setBannerUntil("");
      await onPosted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The announcement wasn't posted."); }
    finally { setBusy(false); }
  }

  return <form className="chat__composer" onSubmit={(event) => { event.preventDefault(); void post(); }}>
    <AudienceField value={audience} onChange={setAudience} catalog={catalog} />
    <input className="chat__composer-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" maxLength={200} aria-label="Announcement title" />
    <textarea className="chat__composer-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write an announcement…" rows={3} aria-label="Announcement message"
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void post(); } }} />
    <div className="chat__composer-bar">
      <div className="chat__seg" role="radiogroup" aria-label="Priority">
        {(["normal", "high", "urgent"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={priority === value} data-priority={value} onClick={() => setPriority(value)}>{value === "normal" ? "Normal" : PRIORITY_LABEL[value]}</button>)}
      </div>
      <label className="chat__opt"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> Require acknowledgement</label>
      <label className="chat__opt" title="Show this as a banner on Home"><input type="checkbox" checked={banner} onChange={(event) => setBanner(event.target.checked)} /> Home banner</label>
      {banner ? <label className="chat__opt">until <input className="chat__until" type="datetime-local" value={bannerUntil} onChange={(event) => setBannerUntil(event.target.value)} aria-label="Banner ends" /></label> : null}
      <label className="chat__opt"><input type="checkbox" checked={discord} onChange={(event) => setDiscord(event.target.checked)} /> Discord</label>
      {error ? <span className="chat__error" role="alert">{error}</span> : null}
      <ClusterButton type="submit" variant="primary" size="compact" busy={busy} disabled={!ready} title="Post · Ctrl/Cmd+Enter"><ClusterIcon name="forward" /> Post</ClusterButton>
    </div>
  </form>;
}
