import { useEffect, useRef, useState } from "react";
import type { StudioAudience } from "@cluster/shared";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { RequestErrorState } from "../../components/RequestState";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { copyClusterText } from "../../core/clipboard";
import { announcementRequestDigest, clearPendingAnnouncementIntent, readPendingAnnouncementIntent, savePendingAnnouncementIntent, type AnnouncementIntentKind, type PendingAnnouncementIntent } from "./announcement-intent-recovery";

const EVERYONE: StudioAudience = { mode: "all", targets: [] };
type Content = { title: string; body: string; audience: StudioAudience; priority: string; requiresAcknowledgement: boolean; discordDeliveryRequested: boolean };
type NewDraft = Content & { scheduledAt: string };
type Announcement = Content & { id: string; status: string; deliveryCount: number; publishedAt?: string | null; scheduledAt?: string | null; revision: number; cancelledAt?: string | null };
type Report = { announcementId: string; deliveryCount: number; materialized: number; read: number; acknowledged: number; pendingAcknowledgement: number; publishedAt?: string | null };
type AudiencePreview = { eligibleNow: number; advisory: boolean; limit: number };
function announcementIntentStore() {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}
function restoredIntents(): Record<AnnouncementIntentKind, PendingAnnouncementIntent | null> {
  const store = announcementIntentStore();
  return { create: readPendingAnnouncementIntent(store, "create"), duplicate: readPendingAnnouncementIntent(store, "duplicate") };
}
function emptyDraft(): NewDraft { return { title: "", body: "", priority: "normal", requiresAcknowledgement: false, discordDeliveryRequested: false, audience: EVERYONE, scheduledAt: "" }; }
function localTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
}
function ContentFields({ value, onChange }: { value: Content; onChange: (patch: Partial<Content>) => void }) {
  return <>
    <ClusterInput aria-label="Announcement title" value={value.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Announcement title" />
    <ClusterTextarea aria-label="Announcement message" value={value.body} onChange={(event) => onChange({ body: event.target.value })} placeholder="Message" />
    <ClusterNativeSelect aria-label="Announcement priority" value={value.priority} onChange={(event) => onChange({ priority: event.target.value })}>
      <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
    </ClusterNativeSelect>
    <StudioAudiencePicker value={value.audience} onChange={(audience) => onChange({ audience })} compact />
    <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={value.requiresAcknowledgement} onChange={(event) => onChange({ requiresAcknowledgement: event.target.checked })} /> Requires acknowledgement</label>
    <label className="studio-inline-check-v272"><ClusterInput type="checkbox" checked={value.discordDeliveryRequested} onChange={(event) => onChange({ discordDeliveryRequested: event.target.checked })} /> Request Discord mirror</label>
  </>;
}

export function StudioAnnouncementsPanel({ targetAnnouncementId = null, composeAnnouncement = false }: { targetAnnouncementId?: string | null; composeAnnouncement?: boolean }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [targetRecord, setTargetRecord] = useState<Announcement | null>(null);
  const [targetError, setTargetError] = useState("");
  const loadSequence = useRef(0);
  const createLock = useRef(false);
  // Retain the intent across an ambiguous network failure; reset on content change or success.
  const pendingCreateIntent = useRef<{ payload: string; id: string } | null>(null);
  const pendingCopyIntent = useRef<{ payload: string; id: string } | null>(null);
  const [recoverableIntents, setRecoverableIntents] = useState(restoredIntents);
  const [draft, setDraft] = useState<NewDraft>(emptyDraft);
  const [editing, setEditing] = useState<(Content & { id: string; revision: number }) | null>(null);
  const [reschedule, setReschedule] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [audiencePreview, setAudiencePreview] = useState<{ key: string; eligibleNow: number } | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  type AnnouncementPage = { announcements: Announcement[]; nextCursor: string | null };
  async function load(_force = false) {
    const sequence = ++loadSequence.current;
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: "50", ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}) });
      // This is an administrator-only corpus. The server sets no-store, so do not
      // short-circuit fresh authorization with the renderer's data cache.
      const result = await api<AnnouncementPage>(`/api/studio-systems/announcements?${params}`);
      if (sequence !== loadSequence.current) return;
      setAnnouncements(result.announcements || []);
      setNextCursor(result.nextCursor || null);
    } catch (error) { if (sequence === loadSequence.current) setLoadError(error); }
  }
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    const cursor = nextCursor;
    const sequence = loadSequence.current;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ limit: "50", cursor, ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}) });
      const result = await api<AnnouncementPage>(`/api/studio-systems/announcements?${params}`);
      if (sequence !== loadSequence.current) return;
      setAnnouncements((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...(result.announcements || []).filter((item) => !seen.has(item.id))];
      });
      setNextCursor(result.nextCursor || null);
    } catch (error) { if (sequence === loadSequence.current) setStatus(error instanceof Error ? error.message : "Unable to load older announcements."); }
    finally { setLoadingOlder(false); }
  }
  useEffect(() => {
    // A new query invalidates any in-flight older-page request immediately.
    loadSequence.current += 1;
    setNextCursor(null);
    const timer = window.setTimeout(() => { void load(true); }, searchQuery ? 200 : 0);
    return () => { window.clearTimeout(timer); loadSequence.current += 1; };
  }, [searchQuery]);
  useEffect(() => {
    if (!targetAnnouncementId) { setTargetRecord(null); setTargetError(""); return; }
    let active = true;
    setTargetError(""); setTargetRecord(null);
    // Authorization must be checked by the server, including for records
    // outside the latest-page window. Never infer access from a link alone.
    void api<{ announcement: Announcement }>(`/api/studio-systems/announcements/${encodeURIComponent(targetAnnouncementId)}`)
      .then((result) => { if (active) setTargetRecord(result.announcement); })
      .catch(() => { if (active) setTargetError("This announcement is unavailable or you no longer have access."); });
    return () => { active = false; };
  }, [targetAnnouncementId]);
  useEffect(() => {
    if (composeAnnouncement) document.querySelector<HTMLInputElement>("[data-announcement-composer] input[aria-label='Announcement title']")?.focus({ preventScroll: true });
  }, [composeAnnouncement]);
  useEffect(() => {
    if (targetRecord?.id) document.getElementById(`studio-announcement-${targetRecord.id}`)?.scrollIntoView({ block: "nearest" });
  }, [targetRecord?.id]);
  const visibleAnnouncements = targetRecord && !announcements.some((item) => item.id === targetRecord.id)
    ? [targetRecord, ...announcements] : announcements;
  function copyAuthorLink(id: string) {
    const url = new URL(window.location.href);
    url.hash = "#studioSettings/studioSystems";
    url.searchParams.set("inspect", `studio-announcement:${id}`);
    return copyClusterText(url.toString());
  }
  function navigateToAuthorRecord(id: string) {
    openClusterWorkNavigation({ screen: "studioSettings", inspectScope: "studio-announcement", inspectId: id });
  }
  function validate(value: Content) {
    if (!value.title.trim() || !value.body.trim()) { setStatus("Title and message are required."); return false; }
    if (value.audience.mode !== "all" && !value.audience.targets.length) { setStatus("Choose an announcement audience target or use Whole studio."); return false; }
    return true;
  }
  function updateNew(patch: Partial<Content>) { setDraft((current) => ({ ...current, ...patch })); setAudiencePreview(null); }
  function updateEdit(patch: Partial<Content>) { setEditing((current) => current ? { ...current, ...patch } : null); setAudiencePreview(null); }
  function beginEdit(item: Announcement) {
    setEditing({ id: item.id, revision: item.revision, title: item.title, body: item.body, priority: item.priority, audience: item.audience, requiresAcknowledgement: item.requiresAcknowledgement, discordDeliveryRequested: item.discordDeliveryRequested });
    setAudiencePreview(null);
  }
  async function previewAudience(value: Content, key: string) {
    if (value.audience.mode !== "all" && !value.audience.targets.length) { setStatus("Choose an audience before previewing."); return; }
    setBusyId("preview"); setAudiencePreview(null);
    try {
      const result = await api<AudiencePreview>("/api/studio-systems/announcements/audience-preview", { method: "POST", body: JSON.stringify({ audience: value.audience }) });
      setAudiencePreview({ key, eligibleNow: result.eligibleNow });
      setStatus("Preview is based on current eligible accounts. Membership and access are rechecked on publication.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Audience preview failed."); }
    finally { setBusyId(null); }
  }
  async function create() {
    if (!validate(draft) || busyId || createLock.current) return;
    if (draft.scheduledAt && (!Number.isFinite(new Date(draft.scheduledAt).getTime()) || new Date(draft.scheduledAt).getTime() <= Date.now() + 60_000)) { setStatus("Select a future publication date at least one minute from now."); return; }
    createLock.current = true;
    setBusyId("create");
    try {
      const payload = JSON.stringify({ ...draft, scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null });
      // Persist only the opaque operation ID and a one-way form fingerprint.
      // Do not store announcement bodies/audiences in browser recovery storage.
      const digest = await announcementRequestDigest(payload).catch(() => null);
      const stored = readPendingAnnouncementIntent(announcementIntentStore(), "create");
      if (stored && (!digest || stored.digest !== digest)) {
        setStatus("An earlier Create request may still have committed. Check its result or discard its recovery marker before creating different content.");
        return;
      }
      if (pendingCreateIntent.current?.payload !== payload) pendingCreateIntent.current = { payload, id: stored?.id || crypto.randomUUID() };
      const intentId = pendingCreateIntent.current.id;
      if (digest) {
        const record = stored || { id: intentId, digest, createdAt: Date.now() };
        savePendingAnnouncementIntent(announcementIntentStore(), "create", record);
        setRecoverableIntents((current) => ({ ...current, create: record }));
      }
      const created = await api<Announcement>("/api/studio-systems/announcements", { method: "POST", body: JSON.stringify({ ...JSON.parse(payload), createIntentId: intentId }) });
      clearPendingAnnouncementIntent(announcementIntentStore(), "create", intentId);
      setRecoverableIntents((current) => ({ ...current, create: null }));
      pendingCreateIntent.current = null;
      setDraft(emptyDraft()); setAudiencePreview(null);
      setStatus(draft.scheduledAt ? "Publication scheduled." : "Draft created."); await load(true);
      if (created?.id) navigateToAuthorRecord(created.id);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "Announcement could not be created."} Retry Create without editing the draft to recover an ambiguous result without making another announcement.`);
    }
    finally { createLock.current = false; setBusyId(null); }
  }
  async function saveEdit() {
    if (!editing || !validate(editing) || busyId) return;
    const current = editing;
    setBusyId(current.id);
    try {
      await api(`/api/studio-systems/announcements/${current.id}/draft`, { method: "PUT", body: JSON.stringify(current) });
      setEditing(null); setAudiencePreview(null); setStatus("Announcement content saved."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Announcement changed or could not be saved. Reload before retrying."); await load(true); }
    finally { setBusyId(null); }
  }
  async function duplicateAsDraft(item: Announcement) {
    if (busyId || createLock.current) return;
    createLock.current = true;
    setBusyId(item.id);
    try {
      const copy = {
        title: `${item.title.slice(0, 190)} (copy)`, body: item.body,
        audience: item.audience, priority: item.priority,
        requiresAcknowledgement: item.requiresAcknowledgement,
        discordDeliveryRequested: item.discordDeliveryRequested,
        scheduledAt: null,
      };
      const payload = JSON.stringify(copy);
      const digest = await announcementRequestDigest(payload).catch(() => null);
      const stored = readPendingAnnouncementIntent(announcementIntentStore(), "duplicate");
      if (stored && (!digest || stored.digest !== digest)) {
        setStatus("An earlier Duplicate request may still have committed. Check that result or discard its recovery marker before copying another announcement.");
        return;
      }
      if (pendingCopyIntent.current?.payload !== payload) pendingCopyIntent.current = { payload, id: stored?.id || crypto.randomUUID() };
      const intentId = pendingCopyIntent.current.id;
      if (digest) {
        const record = stored || { id: intentId, digest, createdAt: Date.now() };
        savePendingAnnouncementIntent(announcementIntentStore(), "duplicate", record);
        setRecoverableIntents((current) => ({ ...current, duplicate: record }));
      }
      const created = await api<Announcement>("/api/studio-systems/announcements", { method: "POST", body: JSON.stringify({ ...copy, createIntentId: intentId }) });
      clearPendingAnnouncementIntent(announcementIntentStore(), "duplicate", intentId);
      setRecoverableIntents((current) => ({ ...current, duplicate: null }));
      pendingCopyIntent.current = null;
      setStatus("A new unpublished draft was created. Review its audience before publishing.");
      await load(true);
      if (created?.id) navigateToAuthorRecord(created.id);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "Could not duplicate the announcement."} Retry Duplicate to recover the previous attempt; do not publish a suspected duplicate.`);
    }
    finally { createLock.current = false; setBusyId(null); }
  }
  async function reviewPending(kind: AnnouncementIntentKind) {
    if (busyId || createLock.current) return;
    const marker = readPendingAnnouncementIntent(announcementIntentStore(), kind);
    if (!marker) {
      setRecoverableIntents((current) => ({ ...current, [kind]: null }));
      setStatus("The recovery marker expired or was cleared. Search your announcements before deliberately creating another copy.");
      return;
    }
    setBusyId(`review-${kind}`);
    try {
      const result = await api<{ ok: true; announcement: Announcement }>(`/api/studio-systems/announcements/create-intents/${encodeURIComponent(marker.id)}`);
      clearPendingAnnouncementIntent(announcementIntentStore(), kind, marker.id);
      if (kind === "create") pendingCreateIntent.current = null;
      else pendingCopyIntent.current = null;
      setRecoverableIntents((current) => ({ ...current, [kind]: null }));
      setStatus("The earlier request succeeded. Opened the existing announcement without creating another copy.");
      await load(true);
      navigateToAuthorRecord(result.announcement.id);
    } catch (error) {
      // A 404 is not proof the original network request has finished. Keep
      // the marker until the operator deliberately discards it.
      setStatus(`${error instanceof Error ? error.message : "Unable to verify the earlier create request."} No new announcement was created. Retry checking or deliberately discard the marker after reviewing the announcement list.`);
    } finally { setBusyId(null); }
  }
  function discardPending(kind: AnnouncementIntentKind) {
    const marker = recoverableIntents[kind];
    if (!marker || busyId) return;
    clearPendingAnnouncementIntent(announcementIntentStore(), kind, marker.id);
    if (kind === "create") pendingCreateIntent.current = null;
    else pendingCopyIntent.current = null;
    setRecoverableIntents((current) => ({ ...current, [kind]: null }));
    setStatus("The local recovery marker was discarded. This does not cancel or delete an announcement already created on the server. Review the list before submitting again.");
  }
  async function publish(id: string) {
    if (busyId) return;
    setBusyId(id); setStatus("Publishing announcement…");
    try { const result = await api<{ deliveryCount: number }>(`/api/studio-systems/announcements/${id}/publish`, { method: "POST" }); setStatus(`Published to ${result.deliveryCount} eligible people through Inbox.`); await load(true); await refreshReport(id); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Announcement could not be published."); }
    finally { setBusyId(null); }
  }
  async function updateSchedule(item: Announcement, scheduledAt: string | null) {
    if (busyId) return;
    if (scheduledAt && (!Number.isFinite(new Date(scheduledAt).getTime()) || new Date(scheduledAt).getTime() <= Date.now() + 60_000)) { setStatus("Choose a future time at least one minute away."); return; }
    setBusyId(item.id);
    try {
      await api(`/api/studio-systems/announcements/${item.id}/schedule`, { method: "PUT", body: JSON.stringify({ revision: item.revision, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null }) });
      setEditing(null); setStatus(scheduledAt ? "Schedule saved." : "Schedule cancelled; draft is ready for review."); await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule could not be updated."); }
    finally { setBusyId(null); }
  }
  async function refreshReport(id: string) {
    try { const report = await api<Report>(`/api/studio-systems/announcements/${id}/report`); setReports((current) => ({ ...current, [id]: report })); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Announcement report could not be loaded."); }
  }
  if (loadError && !announcements.length) return <RequestErrorState error={loadError} title="Announcements could not be loaded" onRetry={() => void load(true)} />;
  return <div className="studio-systems-layout-v34f">
    <aside className="studio-systems-list-v34f"><div data-announcement-composer className="studio-create-strip-v272 studio-systems-create-v34f">
      <div><strong>New announcement</strong><span>Create a draft or schedule publication. Preview is advisory; eligibility is checked again at delivery.</span></div>
      <ContentFields value={draft} onChange={updateNew} />
      <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={!!busyId} onClick={() => void previewAudience(draft, "new")}>Preview eligible audience</ClusterButton>{audiencePreview?.key === "new" && <span role="status">{audiencePreview.eligibleNow} eligible now</span>}</div>
      <label>Schedule publication (optional, your local time)<ClusterInput type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>
      <ClusterButton type="button" variant="primary" disabled={!!busyId || !draft.title.trim() || !draft.body.trim()} onClick={() => void create()}>{draft.scheduledAt ? "Schedule announcement" : "Create draft"}</ClusterButton>
      {(["create", "duplicate"] as const).map((kind) => recoverableIntents[kind] && <div key={kind} className="studio-explanation-v272" role="status">
        <strong>{kind === "create" ? "Unconfirmed Create request" : "Unconfirmed Duplicate request"}</strong>
        <span>An earlier request may have succeeded before its response reached this tab. Review the server result before starting a different operation. Recovery details are stored only for this browser tab.</span>
        <div className="button-row">
          <ClusterButton type="button" variant="secondary" disabled={!!busyId} onClick={() => void reviewPending(kind)}>Check previous {kind === "create" ? "creation" : "duplicate"}</ClusterButton>
          <ClusterButton type="button" variant="quiet" disabled={!!busyId} onClick={() => discardPending(kind)}>Discard recovery marker</ClusterButton>
        </div>
      </div>)}
    </div></aside>
    <section className="studio-systems-editor-v34f"><header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Studio announcements</span><h3>Inbox delivery</h3><p>Draft changes are revision-guarded. Published content is immutable; audience preview never exposes recipient identities.</p></div></header>
      <label className="field"><span>Find an announcement</span><ClusterInput aria-label="Search studio announcements" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value.slice(0, 120))} placeholder="Search titles or message content" /></label>
      {targetError && <div role="alert" className="studio-explanation-v272">{targetError}</div>}
      <div className="studio-form-field-list-v34f">{visibleAnnouncements.map((item) => {
        const report = reports[item.id]; const active = editing?.id === item.id;
        return <div id={`studio-announcement-${item.id}`} className="settings-card-v092" key={item.id}>
          <strong>{item.title}{targetAnnouncementId === item.id ? " · Selected" : ""}</strong><span>{item.body}</span>
          <small>{item.priority} · {item.status}{item.scheduledAt && item.status === "scheduled" ? ` · ${new Date(item.scheduledAt).toLocaleString()}` : ""}{item.discordDeliveryRequested ? " · Discord mirror requested" : ""}{item.status === "published" ? ` · ${item.deliveryCount} targeted recipients` : ""}</small>
          {report && <span>{report.materialized} inbox items · {report.read} read · {report.acknowledged} acknowledged{item.requiresAcknowledgement ? ` · ${report.pendingAcknowledgement} pending` : ""}</span>}
          {active && editing && <div className="studio-create-strip-v272 studio-systems-create-v34f" aria-label="Edit announcement draft">
            <strong>Edit unpublished announcement</strong><ContentFields value={editing} onChange={updateEdit} />
            <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={!!busyId} onClick={() => void previewAudience(editing, item.id)}>Preview eligible audience</ClusterButton>{audiencePreview?.key === item.id && <span role="status">{audiencePreview.eligibleNow} eligible now</span>}</div>
            <div className="button-row"><ClusterButton type="button" variant="primary" disabled={!!busyId || !editing.title.trim() || !editing.body.trim()} onClick={() => void saveEdit()}>Save changes</ClusterButton><ClusterButton type="button" variant="quiet" disabled={!!busyId} onClick={() => { setEditing(null); setAudiencePreview(null); }}>Cancel editing</ClusterButton></div>
          </div>}
          {item.status === "scheduled" && <label>Reschedule (local time)<ClusterInput type="datetime-local" disabled={!!busyId} value={reschedule[item.id] ?? localTime(item.scheduledAt)} onChange={(event) => setReschedule((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}
          <div className="button-row">
            <ClusterButton type="button" variant="quiet" onClick={() => void copyAuthorLink(item.id)} title="Copy an admin-authorized link to this announcement">Copy link</ClusterButton>
            <ClusterButton type="button" variant="secondary" disabled={!!busyId || !!editing} onClick={() => void duplicateAsDraft(item)}>Duplicate as draft</ClusterButton>
            {(item.status === "draft" || item.status === "scheduled") && !active && <ClusterButton type="button" variant="secondary" disabled={!!busyId || !!editing} onClick={() => beginEdit(item)}>Edit content & audience</ClusterButton>}
            {item.status === "draft" && <ClusterButton type="button" variant="primary" disabled={!!busyId || !!editing} onClick={() => void publish(item.id)}>Publish now</ClusterButton>}
            {item.status === "scheduled" && <><ClusterButton type="button" variant="secondary" disabled={!!busyId || !!editing} onClick={() => void updateSchedule(item, reschedule[item.id] ?? localTime(item.scheduledAt))}>Save schedule</ClusterButton><ClusterButton type="button" variant="secondary" disabled={!!busyId || !!editing} onClick={() => void updateSchedule(item, null)}>Cancel schedule</ClusterButton></>}
            {item.status === "published" && <ClusterButton type="button" variant="secondary" disabled={!!busyId} onClick={() => void refreshReport(item.id)}>Refresh report</ClusterButton>}
          </div>
        </div>;
      })}</div>
      {nextCursor && <ClusterButton type="button" variant="secondary" disabled={loadingOlder || !!busyId} onClick={() => void loadOlder()}>{loadingOlder ? "Loading older…" : "Load older announcements"}</ClusterButton>}
      {!visibleAnnouncements.length && !targetError && <div className="settings-card-v092"><strong>No announcements yet</strong></div>}
      {status && <div className="studio-explanation-v272" role="status"><strong>Status</strong><span>{status}</span></div>}
    </section>
  </div>;
}
