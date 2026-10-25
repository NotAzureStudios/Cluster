import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import "./third-party-disclosure.css";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";

type Provider = {
  id: string; sourceKey?: string | null; name: string; category: string; purpose: string; dataCategories: string[]; recipientRole: string;
  feature?: string | null; consentCategory?: string | null; privacyUrl?: string | null; termsUrl?: string | null; regions: string[];
  retentionNote?: string | null; transferNote?: string | null; operatorNote?: string | null; required: boolean; status: string; publicVisible: boolean; reviewed: boolean; reviewedAt?: string | null;
};
type Candidate = { sourceKey: string; name: string; category: string; purpose: string; dataCategories: string[]; feature: string; consentCategory: string | null; required: boolean; detected: boolean; detectionReason: string; recordId: string | null };
type Payload = { ok: true; providers: Provider[]; detectedCandidates: Candidate[] };
type FormState = Omit<Provider, "id" | "reviewedAt"> & { id?: string };

const emptyForm: FormState = { name: "", category: "other", purpose: "", dataCategories: [], recipientRole: "unclassified", feature: "", consentCategory: null, privacyUrl: "", termsUrl: "", regions: [], retentionNote: "", transferNote: "", operatorNote: "", required: false, status: "active", publicVisible: false, reviewed: false, sourceKey: null };
const roles = ["unclassified", "processor", "service_provider", "contractor", "third_party", "independent_controller", "other"];
const categories = ["identity", "communication", "external_content", "source_control", "hosting", "analytics", "support", "other"];
const consentCategories = ["necessary", "preferences", "analytics", "externalContent"];
function csv(value: string[]) { return value.join("\n"); }
function lines(value: string) { return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean); }
function fromProvider(provider: Provider): FormState { return { ...provider }; }
function label(value: string) { return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase()); }

export function ThirdPartyDisclosureAdminPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api<Payload>("/api/admin/legal/third-parties")); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Third-party disclosure inventory could not be loaded."); } }, []);
  useEffect(() => { void load(); }, [load]);
  const detected = useMemo(() => data?.detectedCandidates.filter((candidate) => candidate.detected) || [], [data]);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function select(provider: Provider) { setForm(fromProvider(provider)); setMessage(""); }
  function startCandidate(candidate: Candidate) { setForm({ ...emptyForm, sourceKey: candidate.sourceKey, name: candidate.name, category: candidate.category, purpose: candidate.purpose, dataCategories: candidate.dataCategories, feature: candidate.feature, consentCategory: candidate.consentCategory, required: candidate.required }); setMessage(""); }
  async function save(reviewAndPublish = false) {
    setBusy(true); setMessage("");
    try {
      const { id: _id, reviewed: _reviewed, publicVisible: _publicVisible, ...record } = form;
      const body = reviewAndPublish ? { ...record, reviewed: true, publicVisible: true } : record;
      const endpoint = form.id ? `/api/admin/legal/third-parties/${form.id}` : "/api/admin/legal/third-parties";
      const result = await api<{ ok: true; provider: Provider; reviewInvalidated?: boolean }>(endpoint, { method: form.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      setForm(fromProvider(result.provider));
      setMessage(result.reviewInvalidated ? "Saved. Material changes invalidated the previous review and removed this record from the public disclosure." : reviewAndPublish ? "Reviewed and published to the public disclosure." : "Disclosure record saved.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Disclosure record could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="settings-card-v092 third-party-admin-v377">
    <div className="settings-card-head-v092"><div><p className="eyebrow">Privacy operations</p><h3>Third-party disclosure</h3><p className="muted tight">Generate a public recipient/provider disclosure from reviewed integration records. Classification remains operator-controlled and should match actual contracts and data flows.</p></div><ClusterLinkButton className="" href="/legal/third-parties" target="_blank" rel="noreferrer" variant="quiet" size="compact">Open public</ClusterLinkButton></div>
    {message && <div className="third-party-message-v377" role="status">{message}</div>}
    <div className="third-party-admin-grid-v377">
      <div className="third-party-inventory-v377">
        <div className="third-party-section-title-v377"><strong>Detected integrations</strong><span>{detected.length}</span></div>
        {detected.map((candidate) => <article key={candidate.sourceKey} className={candidate.recordId ? "recorded" : ""}><div><strong>{candidate.name}</strong><small>{candidate.feature}</small><p>{candidate.detectionReason}</p></div>{candidate.recordId ? <ClusterButton className="" type="button" onClick={() => { const provider = data?.providers.find((item) => item.id === candidate.recordId); if (provider) select(provider); }} variant="quiet" size="compact">Review record</ClusterButton> : <ClusterButton className="" type="button" onClick={() => startCandidate(candidate)} variant="quiet" size="compact">Add record</ClusterButton>}</article>)}
        <div className="third-party-section-title-v377"><strong>Disclosure records</strong><ClusterButton className="" type="button" onClick={() => setForm(emptyForm)} variant="quiet" size="compact">New manual record</ClusterButton></div>
        {data?.providers.map((provider) => <ClusterButton unstyled type="button" className={`third-party-record-row-v377 ${form.id === provider.id ? "active" : ""}`} key={provider.id} onClick={() => select(provider)}><span><strong>{provider.name}</strong><small>{label(provider.category)} · {provider.status}</small></span><span>{provider.publicVisible && provider.reviewed ? "Public" : provider.reviewed ? "Reviewed" : "Needs review"}</span></ClusterButton>)}
      </div>
      <div className="third-party-editor-v377">
        <div className="third-party-section-title-v377"><strong>{form.id ? "Edit disclosure" : "New disclosure"}</strong><span>{form.reviewed ? "Reviewed" : "Unreviewed"}</span></div>
        <label>Name<ClusterTextInput value={form.name} onChange={(event) => patch("name", event.target.value)} /></label>
        <div className="third-party-two-v377"><label>Category<ClusterNativeSelect value={form.category} onChange={(event) => patch("category", event.target.value)}>{categories.map((item) => <option key={item} value={item}>{label(item)}</option>)}</ClusterNativeSelect></label><label>Recipient role<ClusterNativeSelect value={form.recipientRole} onChange={(event) => patch("recipientRole", event.target.value)}>{roles.map((item) => <option key={item} value={item}>{label(item)}</option>)}</ClusterNativeSelect></label></div>
        <label>Purpose<ClusterTextArea rows={3} value={form.purpose} onChange={(event) => patch("purpose", event.target.value)} /></label>
        <div className="third-party-two-v377"><label>Feature / integration<ClusterTextInput value={form.feature || ""} onChange={(event) => patch("feature", event.target.value)} /></label><label>Consent category<ClusterNativeSelect value={form.consentCategory || ""} onChange={(event) => patch("consentCategory", event.target.value || null)}><option value="">Not assigned</option>{consentCategories.map((item) => <option key={item} value={item}>{label(item)}</option>)}</ClusterNativeSelect></label></div>
        <label>Data categories<ClusterTextArea rows={4} value={csv(form.dataCategories)} onChange={(event) => patch("dataCategories", lines(event.target.value))} placeholder="One category per line" /></label>
        <div className="third-party-two-v377"><label>Privacy URL<ClusterTextInput value={form.privacyUrl || ""} onChange={(event) => patch("privacyUrl", event.target.value)} placeholder="https://…" /></label><label>Terms URL<ClusterTextInput value={form.termsUrl || ""} onChange={(event) => patch("termsUrl", event.target.value)} placeholder="https://…" /></label></div>
        <label>Processing/storage regions<ClusterTextArea rows={2} value={csv(form.regions)} onChange={(event) => patch("regions", lines(event.target.value))} placeholder="One region per line" /></label>
        <label>Retention note<ClusterTextArea rows={2} value={form.retentionNote || ""} onChange={(event) => patch("retentionNote", event.target.value)} /></label>
        <label>Transfer information<ClusterTextArea rows={2} value={form.transferNote || ""} onChange={(event) => patch("transferNote", event.target.value)} /></label>
        <label>Internal operator note<ClusterTextArea rows={2} value={form.operatorNote || ""} onChange={(event) => patch("operatorNote", event.target.value)} /><small>Never included in the public endpoint.</small></label>
        <div className="third-party-toggle-row-v377"><label><ClusterInput type="checkbox" checked={form.required} onChange={(event) => patch("required", event.target.checked)} /> Required for the configured service</label><label><ClusterInput type="checkbox" checked={form.status === "active"} onChange={(event) => patch("status", event.target.checked ? "active" : "archived")} /> Active record</label></div>
        <div className="third-party-actions-v377"><ClusterButton className="" type="button" disabled={busy || !form.name.trim() || !form.purpose.trim()} onClick={() => void save(false)} variant="secondary">{busy ? "Saving…" : "Save draft"}</ClusterButton><ClusterButton className="" type="button" disabled={busy || !form.name.trim() || !form.purpose.trim() || form.status !== "active"} onClick={() => void save(true)} variant="primary">Review & publish</ClusterButton></div>
        <p className="muted tight">Any material edit invalidates review and automatically removes the record from the public disclosure until it is reviewed again.</p>
      </div>
    </div>
  </section>;
}
