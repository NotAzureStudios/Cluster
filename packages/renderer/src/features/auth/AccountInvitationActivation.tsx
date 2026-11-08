import { useState, type FormEvent } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { AuthEntryLayout } from "./AuthEntryLayout";

/** Activated by a short-lived URL fragment captured and removed by the entry
 * shell. The token is never rendered, stored in a cookie, or used as a session. */
export function AccountInvitationActivation({
  token,
  onReturnToSignIn,
}: {
  token: string;
  onReturnToSignIn: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [consumedToken, setConsumedToken] = useState<string | null>(token);

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (busy || !consumedToken || completed) return;
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);setError("");
    try {
      await api<{ ok: boolean; message: string }>("/api/auth/account-invitations/activate", {
        method: "POST",
        body: JSON.stringify({ token: consumedToken, password }),
      });
      setCompleted(true);
      setPassword("");
      setConfirmation("");
      setConsumedToken(null); // Only normal login follows; no session minted.
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "This activation link could not be used.";
      setError(message);
    } finally { setBusy(false); }
  }

  return <AuthEntryLayout mode="setup">
    <p className="eyebrow">Private invitation</p>
    <h1>{completed ? "Password created" : "Activate your account"}</h1>
    <p className="muted">{completed
      ? "Your invitation has been used. Sign in with your username and new password, then complete any required MFA or profile setup."
      : "Create a password for your Cluster account. The invitation can only be used once."}</p>
    {!completed && <form className="managed-auth-form" onSubmit={(event) => void activate(event)}>
      <label className="field"><span>New password</span>
        <ClusterInput type={visible ? "text" : "password"} autoComplete="new-password"
          minLength={12} maxLength={1024} value={password}
          onChange={(event) => setPassword(event.target.value)} required />
      </label>
      <label className="field"><span>Confirm password</span>
        <ClusterInput type={visible ? "text" : "password"} autoComplete="new-password"
          minLength={12} maxLength={1024} value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)} required />
      </label>
      <ClusterButton type="button" unstyled aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}>{visible ? "Hide passwords" : "Show passwords"}</ClusterButton>
      <p className="cluster-auth-step-v11">The studio's password policy is checked by the Server. This link does not sign you in automatically.</p>
      {error && <div className="error-box" role="alert">{error}</div>}
      <ClusterButton className="managed-auth-submit" type="submit" variant="primary"
        disabled={busy || password.length < 12 || password !== confirmation}>{busy ? "Activating…" : "Create password"}</ClusterButton>
    </form>}
    <ClusterButton type="button" variant={completed ? "primary" : "quiet"}
      disabled={busy} onClick={() => { setConsumedToken(null); setPassword(""); setConfirmation(""); onReturnToSignIn(); }}>
      {completed ? "Go to sign in" : "Back to sign in"}
    </ClusterButton>
  </AuthEntryLayout>;
}
