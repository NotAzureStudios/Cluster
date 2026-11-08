import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { RequestErrorState } from "../../components/RequestState";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import { LoginScreen, type ClusterAuthUser } from "./AuthScreens";
import { AccountInvitationActivation } from "./AccountInvitationActivation";

type PublicApplication = {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  versions?: StudioFormDocument["version"][];
};

type StudioCover = { ok: true; studioName: string; applications: PublicApplication[] };

// URL fragments never reach the Server or referrer headers. Capture once and
// remove the secret from the visible URL before rendering the invitation form.
let pendingActivationToken: string | null = null;
function captureActivationFragment(): string | null {
  if (typeof window === "undefined") return null;
  const fragment = window.location.hash;
  if (fragment.startsWith("#activate=")) {
    const token = fragment.slice("#activate=".length);
    pendingActivationToken = token.length <= 256 ? token : "";
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", cleanUrl);
  }
  return pendingActivationToken;
}

export function PublicClusterCover({ onLogin, recoveryMessage }: { onLogin: (user: ClusterAuthUser) => void; recoveryMessage?: string | null }) {
  const [cover, setCover] = useState<StudioCover | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mode, setMode] = useState<"cover" | "signin" | "apply">("cover");
  const [activationToken, setActivationToken] = useState<string | null>(() => captureActivationFragment());
  const [applicationKey, setApplicationKey] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState("");

  async function load() {
    setLoadError(null);
    try {
      const result = await api<StudioCover>("/api/public/v1/studio-cover");
      setCover(result);
      setApplicationKey((current) => result.applications.some((item) => item.key === current) ? current : result.applications[0]?.key || "");
    } catch (error) { setLoadError(error); }
  }

  useEffect(() => { void load(); }, []);
  if (activationToken !== null) return <AccountInvitationActivation token={activationToken}
    onReturnToSignIn={() => {
      pendingActivationToken = null;
      setActivationToken(null);
      setMode("signin");
    }} />;
  if (mode === "signin") return <LoginScreen recoveryMessage={recoveryMessage} onLogin={onLogin} onBack={() => setMode("cover")} studioName={cover?.studioName} />;
  if (loadError && !cover) return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card"><RequestErrorState error={loadError} title="Studio cover could not be loaded" onRetry={() => void load()} /><ClusterButton type="button" variant="secondary" onClick={() => setMode("signin")}>Sign in</ClusterButton></section></main>;
  if (!cover) return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card"><span>Loading studio…</span></section></main>;

  const selected = cover.applications.find((item) => item.key === applicationKey) || null;
  const version = selected?.versions?.[0] || null;
  const document: StudioFormDocument | null = selected && version ? { form: { id: selected.id, key: selected.key, title: selected.title, description: selected.description }, version } : null;

  if (mode === "apply" && document) return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card">
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /></div>
    <p className="eyebrow">{cover.studioName}</p><h1>Apply</h1>
    {cover.applications.length > 1 && <div className="button-row">{cover.applications.map((application) => <ClusterButton type="button" variant={application.key === applicationKey ? "primary" : "secondary"} key={application.key} onClick={() => { setApplicationKey(application.key); setPrivacyAccepted(false); }}>{application.title}</ClusterButton>)}</div>}
    <StudioFormRunner drafts={false} document={document} submitLabel="Submit application" submit={async (payload) => {
      if (!privacyAccepted) throw new Error("Confirm the privacy notice before submitting your application.");
      return api(`/api/public/v1/applications/${document.form.key}/submissions`, { method: "POST", body: JSON.stringify({ ...payload, privacyAccepted: true, website }) });
    }} />
    <label className="field"><span><ClusterInput type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> I consent to the studio using this application information to review my application.</span><small>Application answers do not grant Cluster access, roles, permissions, or membership.</small></label>
    <label aria-hidden="true" className="sr-only-v204">Website<ClusterInput tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    <div className="button-row"><ClusterButton type="button" variant="quiet" onClick={() => setMode("cover")}>Back</ClusterButton><ClusterLinkButton href="/legal/privacy" variant="quiet">Privacy</ClusterLinkButton></div>
  </section></main>;

  return <main className="login-shell managed-auth-shell managed-auth-v473"><section className="login-card panel managed-auth-card">
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /></div>
    <p className="eyebrow">Cluster Studio</p><h1>{cover.studioName}</h1><p className="muted">Private studio workspace. Sign in if you already have access{cover.applications.length ? ", or apply if the studio is accepting applications" : ""}.</p>
    <div className="login-actions"><ClusterButton type="button" variant="primary" onClick={() => setMode("signin")}>Sign in</ClusterButton>{cover.applications.length > 0 && <ClusterButton type="button" variant="secondary" onClick={() => setMode("apply")}>Apply</ClusterButton>}</div>
    <div className="managed-auth-help-v473"><ClusterLinkButton href="/legal/privacy" variant="quiet" size="compact">Privacy</ClusterLinkButton><ClusterLinkButton href="/legal/terms" variant="quiet" size="compact">Terms</ClusterLinkButton></div>
  </section></main>;
}
