import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { RequestErrorState } from "../../components/RequestState";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";

type StudioPolicyEntry = {
  policy: { id: string; title: string; summary?: string | null; requiredForAccess: boolean };
  version: { id: string; versionLabel: string; bodyMarkdown: string; acceptanceMode: "none" | "acknowledge" | "initials" | "signature" | "form"; formVersionId?: string | null };
  formDocument?: StudioFormDocument | null;
  existingFormSubmissionId?: string | null;
  accepted: boolean;
};
type StudioPolicyFeed = { policies: StudioPolicyEntry[]; blocking: string[] };

export function StudioPolicyGate({ children, onLogout }: { children: ReactNode; onLogout: () => void | Promise<void> }) {
  const [feed, setFeed] = useState<StudioPolicyFeed | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [initials, setInitials] = useState("");
  const [signature, setSignature] = useState("");

  async function load() {
    setLoadError(null);
    try { setFeed(await api<StudioPolicyFeed>("/api/studio-policies/required")); }
    catch (cause) { setLoadError(cause); }
  }
  useEffect(() => { void load(); }, []);
  const blocking = useMemo(() => feed?.policies.find((entry) => feed.blocking.includes(entry.version.id)) || null, [feed]);

  async function accept(mode: StudioPolicyEntry["version"]["acceptanceMode"], extra: Record<string, unknown> = {}) {
    if (!blocking) return;
    setPending(true); setError("");
    try {
      await api(`/api/studio-policies/${blocking.version.id}/accept`, { method: "POST", body: JSON.stringify({ mode, ...extra }) });
      setInitials(""); setSignature(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The policy could not be accepted."); }
    finally { setPending(false); }
  }

  if (loadError && !feed) return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card"><RequestErrorState error={loadError} title="Studio policies could not be verified" onRetry={() => void load()} /><ClusterButton type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</ClusterButton></section></main>;
  if (!feed) return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card"><span>Checking studio policies…</span></section></main>;
  if (!blocking) return <>{children}</>;

  const mode = blocking.version.acceptanceMode;
  return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card">
    <p className="eyebrow">Studio policy · {blocking.version.versionLabel}</p><h1>{blocking.policy.title}</h1>{blocking.policy.summary && <p className="muted">{blocking.policy.summary}</p>}
    <pre className="settings-card-v092">{blocking.version.bodyMarkdown}</pre>
    {mode === "form" && blocking.formDocument && !blocking.existingFormSubmissionId && <StudioFormRunner document={blocking.formDocument} submitLabel="Complete policy form" submit={(payload) => api(`/api/forms/${blocking.formDocument!.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={(result) => { const id = String(result.id || result.submissionId || ""); if (id) void accept("form", { formSubmissionId: id }); }} />}
    {mode === "form" && blocking.existingFormSubmissionId && <ClusterButton type="button" variant="primary" disabled={pending} onClick={() => void accept("form", { formSubmissionId: blocking.existingFormSubmissionId })}>{pending ? "Saving…" : "Accept with completed form"}</ClusterButton>}
    {mode === "acknowledge" && <ClusterButton type="button" variant="primary" disabled={pending} onClick={() => void accept("acknowledge")}>{pending ? "Saving…" : "Acknowledge and continue"}</ClusterButton>}
    {mode === "initials" && <div className="field"><label>Initials</label><ClusterInput value={initials} maxLength={20} onChange={(event) => setInitials(event.target.value)} /><ClusterButton type="button" variant="primary" disabled={pending || !initials.trim()} onClick={() => void accept("initials", { initials })}>{pending ? "Saving…" : "Accept policy"}</ClusterButton></div>}
    {mode === "signature" && <div className="field"><label>Signature</label><ClusterInput value={signature} maxLength={300} onChange={(event) => setSignature(event.target.value)} /><ClusterButton type="button" variant="primary" disabled={pending || !signature.trim()} onClick={() => void accept("signature", { signature })}>{pending ? "Saving…" : "Sign and continue"}</ClusterButton></div>}
    {mode === "form" && !blocking.formDocument && !blocking.existingFormSubmissionId && <div className="error-box" role="alert">The required form is unavailable. Contact a studio administrator.</div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="managed-auth-help-v473"><ClusterButton unstyled type="button" onClick={() => void onLogout()}>Sign out</ClusterButton></div>
  </section></main>;
}
