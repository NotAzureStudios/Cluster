import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../../core/api";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import "./privacy-policy.css";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";

const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

type EvidenceUpload = { originalName: string; dataUrl: string; evidenceType: string };
type CaseStatus = {
  reference: string;
  status: string;
  submittedAt: string;
  acknowledgedAt?: string | null;
  disabledAt?: string | null;
  restoredAt?: string | null;
  closedAt?: string | null;
  counterNotice?: { status: string; submittedAt: string; forwardedAt?: string | null; restorationEligibleAt?: string | null; restorationDeadlineAt?: string | null; legalActionReceivedAt?: string | null } | null;
  forwardedCounterNotice?: { submitterName: string; submitterEmail: string; submitterAddress: string; submitterPhone?: string | null; signatureText: string; materialDescription: string; previousLocation: string; contentHash: string } | null;
  events: Array<{ eventType: string; message: string; createdAt: string }>;
};

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Evidence file could not be read."));
    reader.readAsDataURL(file);
  });
}

export default function CopyrightReportPage() {
  const [form, setForm] = useState({ reporterName: "", reporterEmail: "", reporterCompany: "", reporterAddress: "", reporterPhone: "", copyrightOwnerName: "", authorizedAgent: false, copyrightWorkDescription: "", infringingMaterialDescription: "", infringingLocation: "", resourceType: "", resourceId: "", resourceUrl: "", signatureText: "", goodFaithAttested: false, accuracyAuthorityAttested: false });
  const [evidence, setEvidence] = useState<EvidenceUpload[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<{ caseReference: string; accessToken: string } | null>(null);
  const [statusInput, setStatusInput] = useState({ reference: "", token: "" });
  const [caseStatus, setCaseStatus] = useState<CaseStatus | null>(null);

  function update(key: string, value: string | boolean) { setForm((current) => ({ ...current, [key]: value })); }

  async function addEvidence(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (evidence.length + files.length > MAX_EVIDENCE_FILES) { setMessage(`Up to ${MAX_EVIDENCE_FILES} evidence files may be attached.`); return; }
    try {
      const uploads: EvidenceUpload[] = [];
      for (const file of files) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error(`${file.name} exceeds the 2 MB evidence limit.`);
        uploads.push({ originalName: file.name, dataUrl: await fileDataUrl(file), evidenceType: "supporting" });
      }
      setEvidence((current) => [...current, ...uploads]);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evidence could not be attached."); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("Submitting copyright notice…");
    try {
      const result = await api<{ ok: true; caseReference: string; accessToken: string }>("/api/public/copyright/reports", {
        method: "POST",
        body: JSON.stringify({ ...form, reporterCompany: form.reporterCompany || null, reporterPhone: form.reporterPhone || null, resourceType: form.resourceType || null, resourceId: form.resourceId || null, resourceUrl: form.resourceUrl || null, evidence }),
      });
      setReceipt(result);
      setStatusInput({ reference: result.caseReference, token: result.accessToken });
      setMessage("Notice received. Save both values below; Cluster cannot recover the private case token for you.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Copyright notice could not be submitted."); }
    finally { setBusy(false); }
  }

  async function checkStatus(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("Checking case…");
    try {
      const result = await api<{ ok: true; case: CaseStatus }>("/api/public/copyright/cases/status", { method: "POST", body: JSON.stringify(statusInput) });
      setCaseStatus(result.case); setMessage("");
    } catch (error) { setCaseStatus(null); setMessage(error instanceof Error ? error.message : "Case status could not be loaded."); }
    finally { setBusy(false); }
  }

  return <main className="privacy-policy-shell-v362"><div className="privacy-policy-frame-v362">
    <div className="privacy-policy-top-v362"><a className="privacy-policy-brand-v362" href="/"><img src="/cluster-logo.png" alt="" /><span>Cluster</span></a><div className="privacy-policy-actions-v363"><a className="privacy-policy-back-v362" href="/legal/copyright">Copyright policy</a><a className="privacy-policy-back-v362" href="/">Back to Cluster</a></div></div>
    <article className="privacy-policy-card-v362 copyright-workflow-page-v369">
      <header className="privacy-policy-heading-v362"><span className="eyebrow">Copyright</span><h1>Report copyright infringement</h1><p className="muted">Use this form only if you own the copyrighted work or are authorized to act for its owner. Knowingly material misrepresentations may have legal consequences. This form records a notice for the server operator; it does not promise any particular legal outcome.</p></header>
      {message && <div className="privacy-policy-status-v362" role="status">{message}</div>}
      {receipt ? <section className="settings-card-v092 copyright-case-receipt-v369"><h2>Case received</h2><p><strong>Case reference</strong><code>{receipt.caseReference}</code></p><p><strong>Private access token</strong><code>{receipt.accessToken}</code></p><p className="muted">Store the token securely. Anyone with both values can view reporter-side case updates and a forwarded counter-notice.</p></section> : <form onSubmit={submit} className="copyright-form-v369">
        <section className="settings-card-v092"><h2>Reporter</h2><div className="two-col compact-fields-v092">
          <div className="field"><label>Your name</label><ClusterTextInput required value={form.reporterName} onChange={(e) => update("reporterName", e.target.value)} /></div>
          <div className="field"><label>Email</label><ClusterTextInput required type="email" value={form.reporterEmail} onChange={(e) => update("reporterEmail", e.target.value)} /></div>
          <div className="field"><label>Organization (optional)</label><ClusterTextInput value={form.reporterCompany} onChange={(e) => update("reporterCompany", e.target.value)} /></div>
          <div className="field"><label>Phone (optional)</label><ClusterTextInput value={form.reporterPhone} onChange={(e) => update("reporterPhone", e.target.value)} /></div>
          <div className="field span-2"><label>Physical mailing address</label><ClusterTextArea required value={form.reporterAddress} onChange={(e) => update("reporterAddress", e.target.value)} /></div>
          <div className="field"><label>Copyright owner</label><ClusterTextInput required value={form.copyrightOwnerName} onChange={(e) => update("copyrightOwnerName", e.target.value)} /></div>
          <label className="copyright-check-v369"><ClusterInput type="checkbox" checked={form.authorizedAgent} onChange={(e) => update("authorizedAgent", e.target.checked)} /> I am acting as an authorized agent rather than the owner.</label>
        </div></section>
        <section className="settings-card-v092"><h2>Claimed work and material</h2>
          <div className="field"><label>Copyrighted work</label><ClusterTextArea required value={form.copyrightWorkDescription} onChange={(e) => update("copyrightWorkDescription", e.target.value)} placeholder="Identify the copyrighted work, or provide a representative list where appropriate." /></div>
          <div className="field"><label>Material claimed to infringe</label><ClusterTextArea required value={form.infringingMaterialDescription} onChange={(e) => update("infringingMaterialDescription", e.target.value)} /></div>
          <div className="field"><label>Location sufficient to find the material</label><ClusterTextArea required value={form.infringingLocation} onChange={(e) => update("infringingLocation", e.target.value)} placeholder="Cluster page, item name, URL, project, or other specific location." /></div>
          <div className="two-col compact-fields-v092"><div className="field"><label>Cluster resource type (optional)</label><ClusterNativeSelect value={form.resourceType} onChange={(e) => update("resourceType", e.target.value)}><option value="">Not known</option><option value="library">Library item</option><option value="project_file">Project file</option><option value="review_asset">Review asset</option></ClusterNativeSelect></div><div className="field"><label>Cluster resource ID (optional)</label><ClusterTextInput value={form.resourceId} onChange={(e) => update("resourceId", e.target.value)} /></div></div>
          <div className="field"><label>Resource URL (optional)</label><ClusterTextInput value={form.resourceUrl} onChange={(e) => update("resourceUrl", e.target.value)} /></div>
        </section>
        <section className="settings-card-v092"><h2>Evidence</h2><ClusterFileButton label="Add evidence files" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain" onChange={addEvidence}>Add evidence</ClusterFileButton><p className="muted">Up to 5 passive image, PDF, or text files, 2 MB each.</p>{evidence.map((item, index) => <div className="copyright-evidence-chip-v369" key={`${item.originalName}-${index}`}><span>{item.originalName}</span><ClusterButton unstyled type="button" onClick={() => setEvidence((current) => current.filter((_, i) => i !== index))}>Remove</ClusterButton></div>)}</section>
        <section className="settings-card-v092"><h2>Required statements</h2>
          <label className="copyright-check-v369"><ClusterInput required type="checkbox" checked={form.goodFaithAttested} onChange={(e) => update("goodFaithAttested", e.target.checked)} /> I have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</label>
          <label className="copyright-check-v369"><ClusterInput required type="checkbox" checked={form.accuracyAuthorityAttested} onChange={(e) => update("accuracyAuthorityAttested", e.target.checked)} /> The information in this notice is accurate and, under penalty of perjury, I am the owner or authorized to act for the owner.</label>
          <div className="field"><label>Physical or electronic signature</label><ClusterTextInput required value={form.signatureText} onChange={(e) => update("signatureText", e.target.value)} /></div>
          <ClusterButton className="" type="submit" disabled={busy} variant="primary">{busy ? "Submitting…" : "Submit copyright notice"}</ClusterButton>
        </section>
      </form>}
      <section className="settings-card-v092 copyright-status-lookup-v369"><h2>Check an existing case</h2><form onSubmit={checkStatus}><div className="two-col compact-fields-v092"><div className="field"><label>Case reference</label><ClusterTextInput required value={statusInput.reference} onChange={(e) => setStatusInput((current) => ({ ...current, reference: e.target.value }))} /></div><div className="field"><label>Private access token</label><ClusterTextInput required type="password" value={statusInput.token} onChange={(e) => setStatusInput((current) => ({ ...current, token: e.target.value }))} /></div></div><ClusterButton className="" type="submit" disabled={busy} variant="secondary">Check status</ClusterButton></form>
        {caseStatus && <div className="copyright-case-status-v369"><h3>{caseStatus.reference} · {caseStatus.status.replace(/_/g, " ")}</h3>{caseStatus.counterNotice && <p>Counter-notice: <strong>{caseStatus.counterNotice.status}</strong>{caseStatus.counterNotice.restorationEligibleAt ? ` · earliest restoration ${new Date(caseStatus.counterNotice.restorationEligibleAt).toLocaleString()}` : ""}</p>}<div className="copyright-case-timeline-v369">{caseStatus.events.map((entry, index) => <div key={`${entry.createdAt}-${index}`}><strong>{entry.message}</strong><span>{new Date(entry.createdAt).toLocaleString()}</span></div>)}</div>{caseStatus.forwardedCounterNotice && <details><summary>Forwarded counter-notice</summary><p><strong>{caseStatus.forwardedCounterNotice.submitterName}</strong> · {caseStatus.forwardedCounterNotice.submitterEmail}</p><p>{caseStatus.forwardedCounterNotice.submitterAddress}</p><p>{caseStatus.forwardedCounterNotice.materialDescription}</p><p>Previous location: {caseStatus.forwardedCounterNotice.previousLocation}</p><p>Document hash: {caseStatus.forwardedCounterNotice.contentHash}</p></details>}</div>}
      </section>
    </article>
  </div></main>;
}
