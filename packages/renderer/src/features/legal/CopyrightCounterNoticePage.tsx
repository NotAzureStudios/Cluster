import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../../core/api";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import "./privacy-policy.css";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";

const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

type EvidenceUpload = { originalName: string; dataUrl: string; evidenceType: string };
type CasePayload = { ok: true; case: { id: string; reference: string; status: string; infringingMaterialDescription: string; infringingLocation: string; disabledAt?: string | null; restoredAt?: string | null; counterNotice?: any } };

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Evidence file could not be read."));
    reader.readAsDataURL(file);
  });
}

export default function CopyrightCounterNoticePage() {
  const caseId = new URLSearchParams(window.location.search).get("case") || "";
  const [caseData, setCaseData] = useState<CasePayload["case"] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceUpload[]>([]);
  const [form, setForm] = useState({ submitterName: "", submitterEmail: "", submitterAddress: "", submitterPhone: "", signatureText: "", materialDescription: "", previousLocation: "", mistakeAttested: false, jurisdictionAttested: false, serviceAttested: false });

  useEffect(() => {
    if (!caseId) { setMessage("No copyright case was selected."); return; }
    api<CasePayload>(`/api/copyright/cases/${encodeURIComponent(caseId)}`)
      .then((result) => {
        setCaseData(result.case);
        setForm((current) => ({ ...current, materialDescription: result.case.infringingMaterialDescription, previousLocation: result.case.infringingLocation }));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Copyright case could not be loaded."));
  }, [caseId]);

  function update(key: string, value: string | boolean) { setForm((current) => ({ ...current, [key]: value })); }

  async function addEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (evidence.length + files.length > MAX_EVIDENCE_FILES) { setMessage(`Up to ${MAX_EVIDENCE_FILES} evidence files may be attached.`); return; }
    try {
      const uploads: EvidenceUpload[] = [];
      for (const file of files) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error(`${file.name} exceeds the 2 MB evidence limit.`);
        uploads.push({ originalName: file.name, dataUrl: await fileDataUrl(file), evidenceType: "counter_supporting" });
      }
      setEvidence((current) => [...current, ...uploads]);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence could not be attached.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("Submitting counter-notice…");
    try {
      const result = await api<{ ok: true; counterNotice: { restorationEligibleAt: string; restorationDeadlineAt: string } }>(`/api/copyright/cases/${encodeURIComponent(caseId)}/counter-notice`, {
        method: "POST",
        body: JSON.stringify({ ...form, submitterPhone: form.submitterPhone || null, evidence }),
      });
      setMessage(`Counter-notice received. Earliest normal restoration window: ${new Date(result.counterNotice.restorationEligibleAt).toLocaleString()}.`);
      setEvidence([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Counter-notice could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="privacy-policy-shell-v362"><div className="privacy-policy-frame-v362">
    <div className="privacy-policy-top-v362"><a className="privacy-policy-brand-v362" href="/"><img src="/cluster-logo.png" alt="" /><span>Cluster</span></a><div className="privacy-policy-actions-v363"><a className="privacy-policy-back-v362" href="/legal/copyright">Copyright policy</a><a className="privacy-policy-back-v362" href="/">Back to Cluster</a></div></div>
    <article className="privacy-policy-card-v362 copyright-workflow-page-v369">
      <header className="privacy-policy-heading-v362"><span className="eyebrow">Copyright</span><h1>Submit a counter-notice</h1><p className="muted">Use this only if Cluster notified you that your material was disabled and you believe removal resulted from mistake or misidentification. The statements below have legal significance.</p></header>
      {message && <div className="privacy-policy-status-v362" role="status">{message}</div>}
      {caseData && !caseData.counterNotice && caseData.disabledAt && !caseData.restoredAt && <form className="copyright-form-v369" onSubmit={submit}>
        <section className="settings-card-v092"><h2>{caseData.reference}</h2><p>{caseData.infringingMaterialDescription}</p><p className="muted">Previous location: {caseData.infringingLocation}</p></section>
        <section className="settings-card-v092">
          <div className="two-col compact-fields-v092"><div className="field"><label>Your legal name</label><ClusterTextInput required value={form.submitterName} onChange={(e) => update("submitterName", e.target.value)} /></div><div className="field"><label>Email</label><ClusterTextInput required type="email" value={form.submitterEmail} onChange={(e) => update("submitterEmail", e.target.value)} /></div><div className="field span-2"><label>Physical address</label><ClusterTextArea required value={form.submitterAddress} onChange={(e) => update("submitterAddress", e.target.value)} /></div><div className="field"><label>Phone (optional)</label><ClusterTextInput value={form.submitterPhone} onChange={(e) => update("submitterPhone", e.target.value)} /></div><div className="field"><label>Signature</label><ClusterTextInput required value={form.signatureText} onChange={(e) => update("signatureText", e.target.value)} /></div></div>
          <div className="field"><label>Material removed or disabled</label><ClusterTextArea required value={form.materialDescription} onChange={(e) => update("materialDescription", e.target.value)} /></div>
          <div className="field"><label>Location before removal</label><ClusterTextArea required value={form.previousLocation} onChange={(e) => update("previousLocation", e.target.value)} /></div>
        </section>
        <section className="settings-card-v092"><h2>Supporting evidence</h2><ClusterFileButton label="Add evidence files" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain" onChange={addEvidence}>Add evidence</ClusterFileButton><p className="muted">Optional. Up to 5 passive image, PDF, or text files, 2 MB each.</p>{evidence.map((item, index) => <div className="copyright-evidence-chip-v369" key={`${item.originalName}-${index}`}><span>{item.originalName}</span><ClusterButton unstyled type="button" onClick={() => setEvidence((current) => current.filter((_, i) => i !== index))}>Remove</ClusterButton></div>)}</section>
        <section className="settings-card-v092">
          <label className="copyright-check-v369"><ClusterInput required type="checkbox" checked={form.mistakeAttested} onChange={(e) => update("mistakeAttested", e.target.checked)} /> Under penalty of perjury, I have a good-faith belief the material was removed or disabled because of mistake or misidentification.</label>
          <label className="copyright-check-v369"><ClusterInput required type="checkbox" checked={form.jurisdictionAttested} onChange={(e) => update("jurisdictionAttested", e.target.checked)} /> I consent to the jurisdiction required by the applicable U.S. counter-notice process.</label>
          <label className="copyright-check-v369"><ClusterInput required type="checkbox" checked={form.serviceAttested} onChange={(e) => update("serviceAttested", e.target.checked)} /> I agree to accept service of process from the original claimant or their agent.</label>
          <ClusterButton className="" type="submit" disabled={busy} variant="primary">{busy ? "Submitting…" : "Submit counter-notice"}</ClusterButton>
        </section>
      </form>}
      {caseData?.counterNotice && <section className="settings-card-v092"><h2>Counter-notice already submitted</h2><p>Status: {caseData.counterNotice.status}</p></section>}
    </article>
  </div></main>;
}
