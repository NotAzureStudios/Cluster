import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import { LoginScreen, type ClusterAuthUser } from "./AuthScreens";
import { AccountInvitationActivation } from "./AccountInvitationActivation";
import { AuthEntryLayout } from "./AuthEntryLayout";

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
 * The studio entry point.
 *
 * Almost everyone who opens Cluster is a member signing in, so sign-in is the
 * first thing rendered and it does not wait on the studio cover: the cover
 * supplies the studio name and the list of open applications, both of which
 * are decoration around a form that works without them. Loading it in the
 * background removes a round trip and a click from every sign-in, and a cover
 * that fails to load no longer blocks members from reaching the password
 * field — it only hides the Apply link.
 */
export function PublicClusterCover({ onLogin, recoveryMessage }: { onLogin: (user: ClusterAuthUser) => void; recoveryMessage?: string | null }) {
  const [cover, setCover] = useState<StudioCover | null>(null);
  const [mode, setMode] = useState<"signin" | "apply">("signin");
  const [activationToken, setActivationToken] = useState<string | null>(() => captureActivationFragment());
  const [applicationKey, setApplicationKey] = useState("");
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<StudioCover>("/api/public/v1/studio-cover");
        if (cancelled) return;
        setCover(result);
        setApplicationKey((current) => result.applications.some((item) => item.key === current) ? current : result.applications[0]?.key || "");
      } catch {
        // Non-fatal: sign-in stands on its own, so a cover that cannot be read
        // simply leaves the Apply link out rather than blocking the entry page.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (activationToken !== null) return <AccountInvitationActivation token={activationToken}
    onReturnToSignIn={() => {
      setActivationToken(null);
      setMode("signin");
    }} />;

  const selected = cover?.applications.find((item) => item.key === applicationKey) || null;
  const version = selected?.versions?.[0] || null;
  const document: StudioFormDocument | null = selected && version ? { form: { id: selected.id, key: selected.key, title: selected.title, description: selected.description }, version } : null;
  const applicationsOpen = Boolean(cover?.applications.length);

  if (mode === "apply" && cover && document) return <AuthEntryLayout studioName={cover.studioName} mode="setup" cardClassName="cluster-auth-application-v11">
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /></div>
    <p className="eyebrow">{cover.studioName}</p><h1>Apply</h1>
    {cover.applications.length > 1 && <div className="button-row">{cover.applications.map((application) => <ClusterButton type="button" variant={application.key === applicationKey ? "primary" : "secondary"} key={application.key} onClick={() => { setApplicationKey(application.key); setPrivacyAccepted(false); }}>{application.title}</ClusterButton>)}</div>}
    <StudioFormRunner drafts={false} document={document} submitLabel="Submit application" submit={async (payload) => {
      if (!privacyAccepted) throw new Error("Confirm the privacy notice before submitting your application.");
      return api(`/api/public/v1/applications/${document.form.key}/submissions`, { method: "POST", body: JSON.stringify({ ...payload, privacyAccepted: true, website }) });
    }} />
    <label className="field"><span><ClusterInput type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> I consent to the studio using this application information to review my application.</span><small>Application answers do not grant Cluster access, roles, permissions, or membership.</small></label>
    <label aria-hidden="true" className="sr-only-v204">Website<ClusterInput tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    <div className="button-row"><ClusterButton type="button" variant="quiet" onClick={() => setMode("signin")}>Back to sign in</ClusterButton><ClusterLinkButton href="/legal/privacy" variant="quiet">Privacy</ClusterLinkButton></div>
  </AuthEntryLayout>;

  return <LoginScreen recoveryMessage={recoveryMessage} onLogin={onLogin} studioName={cover?.studioName}
    onApply={applicationsOpen ? () => setMode("apply") : undefined} />;
}
