import { useState } from "react";
import { api } from "../../core/api";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import { LoginScreen, type AuthConfig, type ClusterAuthUser } from "./AuthScreens";
import { AccountInvitationActivation } from "./AccountInvitationActivation";
import { AuthEntryLayout } from "./AuthEntryLayout";

type PublicApplication = {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  versions?: StudioFormDocument["version"][];
};

// URL fragments never reach the Server or referrer headers. Capture once and
// remove the secret from the visible URL before rendering the invitation form.
function captureActivationFragment(): string | null {
  if (typeof window === "undefined") return null;
  const fragment = window.location.hash;
  if (fragment.startsWith("#activate=")) {
    const token = fragment.slice("#activate=".length);
    const capturedToken = token.length <= 256 ? token : "";
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", cleanUrl);
    return capturedToken;
  }
  return null;
}

/**
 * The studio entry point: a sign-in form, with Apply beside it.
 *
 * Everything needed to draw it arrives in the boot payload — the studio name,
 * the authentication configuration, and whether any application is open — so
 * this screen issues no request of its own. The application forms are fetched
 * when somebody actually opens Apply, which is a click rather than a page
 * load, so a member signing in never waits for a query they will not use.
 */
export function PublicClusterCover({ onLogin, recoveryMessage, authConfig, applicationsOpen, studioName, onRetryAuthConfig }: {
  onLogin: (user: ClusterAuthUser) => void;
  recoveryMessage?: string | null;
  authConfig: AuthConfig | null;
  applicationsOpen: boolean;
  studioName: string;
  onRetryAuthConfig: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "apply">("signin");
  const [activationToken, setActivationToken] = useState<string | null>(() => captureActivationFragment());
  const [applications, setApplications] = useState<PublicApplication[] | null>(null);
  const [applicationKey, setApplicationKey] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState("");

  if (activationToken !== null) return <AccountInvitationActivation token={activationToken}
    onReturnToSignIn={() => {
      setActivationToken(null);
      setMode("signin");
    }} />;

  async function openApply() {
    setMode("apply");
    if (applications) return;
    setApplicationError("");
    try {
      const result = await api<{ ok: true; applications: PublicApplication[] }>("/api/public/v1/studio-cover");
      setApplications(result.applications);
      setApplicationKey(result.applications[0]?.key || "");
    } catch {
      setApplicationError("The application forms could not be loaded. Try again in a moment.");
    }
  }

  const selected = applications?.find((item) => item.key === applicationKey) || null;
  const version = selected?.versions?.[0] || null;
  const document: StudioFormDocument | null = selected && version
    ? { form: { id: selected.id, key: selected.key, title: selected.title, description: selected.description }, version }
    : null;

  if (mode === "apply") return <AuthEntryLayout cardClassName="cluster-auth-application-v11">
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /><span className="managed-auth-studio-v2">{studioName}</span></div>
    <h1>Apply</h1>
    {applicationError && <div className="error-box" role="alert">{applicationError}</div>}
    {!applications && !applicationError && <p className="cluster-auth-inline-status-v11" role="status">Loading the application form…</p>}
    {applications && applications.length > 1 && <div className="button-row">{applications.map((application) => <ClusterButton type="button" variant={application.key === applicationKey ? "primary" : "secondary"} key={application.key} onClick={() => { setApplicationKey(application.key); setPrivacyAccepted(false); }}>{application.title}</ClusterButton>)}</div>}
    {document && <>
      <StudioFormRunner drafts={false} document={document} submitLabel="Submit application" submit={async (payload) => {
        if (!privacyAccepted) throw new Error("Confirm the privacy notice before submitting your application.");
        return api(`/api/public/v1/applications/${document.form.key}/submissions`, { method: "POST", body: JSON.stringify({ ...payload, privacyAccepted: true, website }) });
      }} />
      <label className="field"><span><ClusterInput type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> I consent to the studio using this application information to review my application.</span><small>Application answers do not grant Cluster access, roles, permissions, or membership.</small></label>
      <label aria-hidden="true" className="sr-only-v204">Website<ClusterInput tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    </>}
    <div className="button-row"><ClusterButton type="button" variant="quiet" onClick={() => setMode("signin")}>Back to sign in</ClusterButton></div>
  </AuthEntryLayout>;

  return <LoginScreen recoveryMessage={recoveryMessage} onLogin={onLogin} studioName={studioName}
    config={authConfig} onRetryConfig={onRetryAuthConfig}
    onApply={applicationsOpen ? () => void openApply() : undefined} />;
}
