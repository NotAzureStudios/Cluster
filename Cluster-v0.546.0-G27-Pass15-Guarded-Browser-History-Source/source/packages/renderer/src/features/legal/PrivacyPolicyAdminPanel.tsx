import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { confirmCluster } from "../../components/cluster-dialog-service";
import "./privacy-policy.css";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";

type PrivacyPolicy = {
  id: string;
  version: string;
  title: string;
  summary?: string | null;
  bodyMarkdown: string;
  contentHash: string;
  status: "draft" | "published" | "superseded" | string;
  effectiveAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  acceptanceMode?: "none" | "acknowledge" | "accept" | string;
  acceptanceAudience?: "all_users" | "admins" | string;
};

type AdminPayload = {
  ok: true;
  current: PrivacyPolicy | null;
  versions: PrivacyPolicy[];
  starter: { version: string; title: string; summary: string; bodyMarkdown: string };
};

type DraftState = { id?: string; version: string; title: string; summary: string; bodyMarkdown: string; effectiveAt: string; acceptanceMode: "none" | "acknowledge" | "accept"; acceptanceAudience: "all_users" | "admins" };

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function PrivacyPolicyAdminPanel() {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await api<AdminPayload>("/api/admin/legal/privacy");
    setData(result);
    setDraft((current) => current || {
      version: result.starter.version,
      title: result.starter.title,
      summary: result.starter.summary,
      bodyMarkdown: result.starter.bodyMarkdown,
      effectiveAt: "",
      acceptanceMode: "none",
      acceptanceAudience: "all_users",
    });
  }

  useEffect(() => { load().catch((error) => setStatus(error instanceof Error ? error.message : "Privacy notice administration could not be loaded.")); }, []);

  function select(policy: PrivacyPolicy) {
    setDraft({ id: policy.id, version: policy.version, title: policy.title, summary: policy.summary || "", bodyMarkdown: policy.bodyMarkdown, effectiveAt: toLocalDateTime(policy.effectiveAt), acceptanceMode: (policy.acceptanceMode === "acknowledge" || policy.acceptanceMode === "accept") ? policy.acceptanceMode : "none", acceptanceAudience: policy.acceptanceAudience === "admins" ? "admins" : "all_users" });
    setStatus(policy.status === "draft" ? "Editing draft." : "Published versions are immutable. Create a new version to make changes.");
  }

  function newDraft() {
    if (!data) return;
    const currentParts = String(data.current?.version || data.starter.version || "1.0").split(".").map((part) => Number.parseInt(part, 10));
    const major = Number.isFinite(currentParts[0]) ? currentParts[0] : 1;
    const minor = Number.isFinite(currentParts[1]) ? currentParts[1] + 1 : 1;
    setDraft({ version: `${major}.${minor}`, title: data.current?.title || data.starter.title, summary: data.current?.summary || data.starter.summary, bodyMarkdown: data.current?.bodyMarkdown || data.starter.bodyMarkdown, effectiveAt: "", acceptanceMode: (data.current?.acceptanceMode === "acknowledge" || data.current?.acceptanceMode === "accept") ? data.current.acceptanceMode : "none", acceptanceAudience: data.current?.acceptanceAudience === "admins" ? "admins" : "all_users" });
    setStatus("New unpublished draft. Review every placeholder before publishing.");
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true); setStatus("Saving privacy notice draft…");
    try {
      const body = JSON.stringify({ version: draft.version, title: draft.title, summary: draft.summary || null, bodyMarkdown: draft.bodyMarkdown, effectiveAt: fromLocalDateTime(draft.effectiveAt), acceptanceMode: draft.acceptanceMode, acceptanceAudience: draft.acceptanceAudience });
      const result = draft.id
        ? await api<{ ok: true; policy: PrivacyPolicy }>(`/api/admin/legal/privacy/versions/${encodeURIComponent(draft.id)}`, { method: "PATCH", body })
        : await api<{ ok: true; policy: PrivacyPolicy }>("/api/admin/legal/privacy/versions", { method: "POST", body });
      setDraft({ ...draft, id: result.policy.id });
      setStatus(`Draft ${result.policy.version} saved.`);
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Privacy notice draft could not be saved."); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!draft?.id) return;
    if (!await confirmCluster({ title: "Publish privacy notice?", message: `Publish privacy notice ${draft.version}? Published versions are immutable and become the internal notice${draft.effectiveAt ? " on the selected effective date" : ""}.`, confirmLabel: "Publish notice" })) return;
    setBusy(true); setStatus("Publishing privacy notice…");
    try {
      const result = await api<{ ok: true; policy: PrivacyPolicy }>(`/api/admin/legal/privacy/versions/${encodeURIComponent(draft.id)}/publish`, { method: "POST", body: JSON.stringify({ effectiveAt: fromLocalDateTime(draft.effectiveAt) }) });
      setStatus(`Privacy notice ${result.policy.version} published.`);
      await load();
      select(result.policy);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Privacy notice could not be published."); }
    finally { setBusy(false); }
  }

  const selected = draft?.id ? data?.versions.find((item) => item.id === draft.id) : null;
  const editable = !selected || selected.status === "draft";

  return <div className="privacy-policy-admin-v362">
    <div className="settings-panel-head-v092">
      <p className="eyebrow">Privacy</p>
      <h2>Internal Privacy Notice</h2>
      <p className="muted tight">Maintain the privacy notice for this private, self-hosted team deployment. Keep it focused on the account, work, activity, retention, administrator-access, and integration data Cluster actually uses.</p>
    </div>
    {status && <div className="privacy-policy-status-v362" role="status">{status}</div>}
    <div className="privacy-policy-admin-grid-v362">
      <div className="settings-card-v092 privacy-policy-editor-v362">
        <div className="two-col compact-fields-v092">
          <div className="field"><label>Version</label><ClusterTextInput value={draft?.version || ""} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, version: event.target.value } : value)} placeholder="1.0" /></div>
          <div className="field"><label>Effective date</label><ClusterTextInput type="datetime-local" value={draft?.effectiveAt || ""} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, effectiveAt: event.target.value } : value)} /></div>
          <div className="field span-2"><label>Title</label><ClusterTextInput value={draft?.title || ""} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, title: event.target.value } : value)} /></div>
          <div className="field span-2"><label>Summary</label><ClusterTextInput value={draft?.summary || ""} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, summary: event.target.value } : value)} /></div>
          <div className="field"><label>Acceptance requirement</label><ClusterNativeSelect value={draft?.acceptanceMode || "none"} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, acceptanceMode: event.target.value as DraftState["acceptanceMode"] } : value)}><option value="none">No acceptance gate</option><option value="acknowledge">Require acknowledgement</option><option value="accept">Require affirmative acceptance</option></ClusterNativeSelect></div>
          <div className="field"><label>Acceptance audience</label><ClusterNativeSelect value={draft?.acceptanceAudience || "all_users"} disabled={!editable || draft?.acceptanceMode === "none"} onChange={(event) => setDraft((value) => value ? { ...value, acceptanceAudience: event.target.value as DraftState["acceptanceAudience"] } : value)}><option value="all_users">All users</option><option value="admins">Administrators only</option></ClusterNativeSelect></div>
          <div className="field span-2"><small>Acceptance is version-bound and auditable. Publishing alone never creates acceptance evidence. A new required version triggers re-acceptance for its selected audience.</small></div>
        </div>
        <div className="field"><label>Notice text (Markdown)</label><ClusterTextArea value={draft?.bodyMarkdown || ""} disabled={!editable} onChange={(event) => setDraft((value) => value ? { ...value, bodyMarkdown: event.target.value } : value)} /></div>
        <div className="privacy-policy-admin-actions-v362">
          <ClusterButton className="" type="button" onClick={newDraft} disabled={busy || !data} variant="secondary">New version</ClusterButton>
          <ClusterButton className="" type="button" onClick={() => window.open("/legal/privacy", "_blank", "noopener,noreferrer")} variant="secondary">Preview notice</ClusterButton>
          <ClusterButton className="" type="button" onClick={saveDraft} disabled={busy || !draft || !editable} variant="primary">{busy ? "Working…" : draft?.id ? "Save draft" : "Create draft"}</ClusterButton>
          {draft?.id && editable && <ClusterButton className="" type="button" onClick={publish} disabled={busy} variant="primary">Publish version</ClusterButton>}
        </div>
      </div>
      <aside className="settings-card-v092 privacy-policy-history-v362">
        <div className="settings-card-head-v092"><h3>Version history</h3><span>{data?.versions.length || 0}</span></div>
        {data?.versions.length ? data.versions.map((policy) => <ClusterButton unstyled type="button" key={policy.id} className={`privacy-policy-history-row-v362${draft?.id === policy.id ? " active" : ""}`} onClick={() => select(policy)}>
          <strong>{policy.version} · {policy.status}</strong>
          <span>{policy.publishedAt ? `Published ${new Date(policy.publishedAt).toLocaleString()}` : `Updated ${policy.updatedAt ? new Date(policy.updatedAt).toLocaleString() : "recently"}`}</span>
          <span>{policy.contentHash.slice(0, 12)}</span>
        </ClusterButton>) : <p className="muted">No policy versions yet. Start with the generated draft and replace every placeholder before publishing.</p>}
      </aside>
    </div>
  </div>;
}
