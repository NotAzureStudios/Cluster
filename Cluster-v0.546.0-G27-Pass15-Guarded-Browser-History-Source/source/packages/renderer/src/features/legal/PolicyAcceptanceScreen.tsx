import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../core/api";
import "./policy-acceptance.css";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";

import { ClusterInput } from "../../components/ClusterNativeControls";

type Requirement = {
  policyId: string;
  kind: string;
  version: string;
  title: string;
  summary?: string | null;
  contentHash: string;
  acceptanceMode: "acknowledge" | "accept";
  acceptanceAudience: "all_users" | "admins";
  requirementHash: string;
  publicPath: string;
  effectiveAt?: string | null;
  accepted: boolean;
};
type AcceptanceStatus = { schemaVersion: number; required: boolean; complete: boolean; requirements: Requirement[]; pending: Requirement[] };

function friendlyError(error: unknown) {
  if (error instanceof ApiError) return error.userMessage;
  return error instanceof Error ? error.message : "Cluster could not record the policy acceptance.";
}

export function PolicyAcceptanceScreen({ initial, username, onComplete, onLogout }: { initial?: AcceptanceStatus | null; username: string; onComplete: () => void | Promise<void>; onLogout: () => void | Promise<void> }) {
  const [status, setStatus] = useState<AcceptanceStatus | null>(initial || null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await api<{ ok: true; acceptance: AcceptanceStatus }>("/api/legal/acceptance/status");
    setStatus(result.acceptance);
    if (result.acceptance.complete) await onComplete();
  }
  useEffect(() => { if (!initial) void load().catch((error) => setMessage(friendlyError(error))); }, []);
  const pending = status?.pending || [];
  const allChecked = useMemo(() => pending.length > 0 && pending.every((item) => checked[item.policyId]), [pending, checked]);

  async function submit() {
    if (!allChecked) return;
    setBusy(true); setMessage("");
    try {
      const result = await api<{ ok: true; acceptance: AcceptanceStatus }>("/api/legal/acceptance", {
        method: "POST",
        body: JSON.stringify({ acceptances: pending.map((item) => ({ policyId: item.policyId, contentHash: item.contentHash, attestation: true })) }),
      });
      setStatus(result.acceptance);
      await onComplete();
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  return <main className="policy-acceptance-shell-v378">
    <section className="policy-acceptance-card-v378" aria-labelledby="policy-acceptance-title">
      <header><img src="/cluster-logo.png" alt="Cluster" /><div><p className="eyebrow">Policy review required</p><h1 id="policy-acceptance-title">Review current policies</h1><p>Signed in as <strong>{username}</strong>. Your workspace stays locked until every policy below is handled.</p></div></header>
      <div className="policy-acceptance-explainer-v378"><strong>Acceptance is recorded against this exact version.</strong><span>Cluster stores the policy content hash and audit evidence. Publishing a document does not count as your acceptance, and future required versions must be reviewed separately.</span></div>
      {message && <div className="policy-acceptance-message-v378" role="alert">{message}</div>}
      <div className="policy-acceptance-list-v378">
        {pending.map((item) => <article key={item.policyId}>
          <div className="policy-acceptance-policy-head-v378"><div><span>{item.kind === "operator_agreement" ? "Operator agreement" : item.kind === "terms" ? "Terms" : "Privacy"}</span><h2>{item.title}</h2><small>Version {item.version} · {item.effectiveAt ? `Effective ${new Date(item.effectiveAt).toLocaleString()}` : "Effective now"}</small></div><ClusterLinkButton className="" href={item.publicPath} target="_blank" rel="noreferrer" variant="secondary">Review document</ClusterLinkButton></div>
          {item.summary && <p>{item.summary}</p>}
          <code>{item.contentHash}</code>
          <label className="policy-acceptance-check-v378"><ClusterInput type="checkbox" checked={Boolean(checked[item.policyId])} onChange={(event) => setChecked((current) => ({ ...current, [item.policyId]: event.target.checked }))} /><span>{item.acceptanceMode === "acknowledge" ? `I acknowledge that I reviewed ${item.title} version ${item.version}.` : `I accept ${item.title} version ${item.version}.`}</span></label>
        </article>)}
        {!pending.length && <div className="empty-state">No policy acceptance is currently required.</div>}
      </div>
      <footer><ClusterButton className="" type="button" onClick={() => void onLogout()} disabled={busy} variant="secondary">Sign out</ClusterButton><ClusterButton className="" type="button" onClick={() => void submit()} disabled={busy || !allChecked} variant="primary">{busy ? "Recording…" : "Record and continue"}</ClusterButton></footer>
    </section>
  </main>;
}

export default PolicyAcceptanceScreen;
