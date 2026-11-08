import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { API_URL, ApiError, api } from "../../core/api";
import { ClusterOperationalStatus } from "../../components/ClusterOperationalStatus";
import { operationalInteractionState } from "../../components/operational-status";
import "./auth.css";
import { AuthEntryLayout } from "./AuthEntryLayout";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { createWebAuthnCredential, getWebAuthnCredential, requireWebAuthnBrowserOrigin, webAuthnAvailable } from "../../core/webauthn-client";

export type ClusterAuthUser = {
  id: string;
  username: string;
  displayName?: string | null;
  accountState?: string | null;
  workspaceRole?: string | null;
  firstLoginCompletedAt?: string | null;
  discordLinked?: boolean;
  discordLinkRequired?: boolean;
  discordUserId?: string | null;
  nextAuthStep?: string | null;
  policyAcceptance?: any;
};

export type AuthConfig = {
  passwordLoginEnabled: boolean;
  discordConfigured: boolean;
  discordLinkRequired?: boolean;
  devLoginEnabled: boolean;
  discordLinkUrl: string;
  ownerSetupRequired?: boolean;
  ownerSetupReason?: "NO_ADMINISTRATOR" | "NO_ADMIN_PASSWORD" | "READY";
  passwordReadyAdministratorCount?: number;
  setupLauncherName?: string;
  passwordPolicy: {
    minimumLength: number;
    maximumLength: number;
  };
};

type AuthResult = {
  ok: boolean;
  user?: ClusterAuthUser;
  nextStep?: string;
  error?: string;
  mfaRequired?: boolean;
  challenge?: string;
  expiresAt?: string;
  recoveryAvailable?: boolean;
  factorKinds?: string[];
  passkeyAvailable?: boolean;
  passkeyPublicKey?: any;
  mfaEnrollmentRequired?: boolean;
  csrfToken?: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return error.requestId
        ? `The server could not complete this request. Reference: ${error.requestId}`
        : "The server could not complete this request.";
    }
    if (error.status === 429 || error.code === "RATE_LIMITED") {
      const base = (error.userMessage || "Too many requests.")
        .replace(/\s+(?:Please\s+)?Try again (?:shortly|later)\.?$/i, "")
        .trim();
      return error.retryAfterSeconds && error.retryAfterSeconds > 0
        ? `${base} Try again in ${error.retryAfterSeconds}s.`
        : `${base} Please wait a moment and try again.`;
    }
    return error.userMessage || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function AuthLegalLinks() {
  return <div className="managed-auth-legal-v362"><span className="managed-auth-internal-v445">Authorized access only</span><a href="/legal/privacy">Privacy</a></div>;
}

function PasswordFields({
  password,
  confirmation,
  minimumLength,
  maximumLength,
  onPassword,
  onConfirmation
}: {
  password: string;
  confirmation: string;
  minimumLength: number;
  maximumLength: number;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return <>
    <div className="field managed-auth-password-v473">
      <label>New password</label>
      <div><ClusterInput type={visible ? "text" : "password"} autoComplete="new-password" minLength={minimumLength} maxLength={maximumLength} value={password} onChange={(event) => onPassword(event.target.value)} required /><ClusterButton unstyled type="button" onClick={() => setVisible((value) => !value)}>{visible ? "Hide" : "Show"}</ClusterButton></div>
      <small>{`Use at least ${minimumLength} characters.`}</small>
    </div>
    <div className="field managed-auth-password-v473">
      <label>Confirm password</label>
      <div><ClusterInput type={visible ? "text" : "password"} autoComplete="new-password" minLength={minimumLength} maxLength={maximumLength} value={confirmation} onChange={(event) => onConfirmation(event.target.value)} required /><ClusterButton unstyled type="button" onClick={() => setVisible((value) => !value)}>{visible ? "Hide" : "Show"}</ClusterButton></div>
    </div>
  </>;
}

export function LoginScreen({ onLogin, recoveryMessage, onBack, studioName }: { onLogin: (user: ClusterAuthUser) => void; recoveryMessage?: string | null; onBack?: () => void; studioName?: string }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const authActionRef = useRef(false);
  const identifierFieldId = useId();
  const passwordFieldId = useId();
  const mfaFieldId = useId();
  const recoveryFieldId = useId();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryMode, setRecoveryMode] = useState<"none" | "request">("none");
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryCode, setMfaRecoveryCode] = useState("");
  const [mfaUseRecovery, setMfaUseRecovery] = useState(false);
  const [mfaRecoveryAvailable, setMfaRecoveryAvailable] = useState(false);
  const [mfaPasskeyPublicKey, setMfaPasskeyPublicKey] = useState<any>(null);

  async function loadConfig() {
    setConfigLoading(true);
    setConfigError("");
    try {
      setConfig(await api<AuthConfig>("/api/auth/config"));
    } catch (reason) {
      setConfig(null);
      setConfigError(errorMessage(reason, "Could not reach the studio authentication service."));
    } finally {
      setConfigLoading(false);
    }
  }
  useEffect(() => { void loadConfig(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (authActionRef.current || !config || !config.passwordLoginEnabled) return;
    authActionRef.current = true;
    setError(""); setRecoveryStatus(""); setBusy(true);
    try {
      const result = await api<AuthResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ username: identifier, password }) });
      if (result.mfaRequired && result.challenge) {
        setMfaChallenge(result.challenge);
        setPassword(""); // Do not retain the password in renderer state during MFA.
        setMfaRecoveryAvailable(Boolean(result.recoveryAvailable));
        setMfaPasskeyPublicKey(result.passkeyAvailable ? result.passkeyPublicKey : null);
        setMfaCode("");
        setMfaRecoveryCode("");
        return;
      }
      if (result.mfaEnrollmentRequired && result.user) {
        onLogin({ ...result.user, nextAuthStep: "SETUP_MFA" });
        return;
      }
      if (!result.user) throw new Error("The server did not return an authenticated user.");
      const me = await api<{ user: ClusterAuthUser | null }>("/api/me").catch(() => ({ user: result.user || null }));
      onLogin(me.user || result.user);
    } catch (reason) { setError(errorMessage(reason, "Sign in failed.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault();
    if (authActionRef.current || !mfaChallenge) return;
    authActionRef.current = true;
    setError(""); setBusy(true);
    try {
      const result = await api<AuthResult>("/api/auth/mfa/challenge", {
        method: "POST",
        body: JSON.stringify({ challenge: mfaChallenge, ...(mfaUseRecovery ? { recoveryCode: mfaRecoveryCode } : { code: mfaCode }) }),
      });
      if (!result.user) throw new Error("MFA verification did not return a user.");
      const me = await api<{ user: ClusterAuthUser | null }>("/api/me").catch(() => ({ user: result.user || null }));
      onLogin(me.user || result.user);
    } catch (reason) { setError(errorMessage(reason, "The authentication code was not accepted.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  async function submitPasskey() {
    if (!mfaChallenge || !mfaPasskeyPublicKey || authActionRef.current) return;
    authActionRef.current = true;
    setError(""); setBusy(true);
    try {
      const credential = await getWebAuthnCredential(mfaPasskeyPublicKey);
      const result = await api<AuthResult>("/api/auth/mfa/passkeys/challenge", { method: "POST", body: JSON.stringify({ challenge: mfaChallenge, credential }) });
      if (!result.user) throw new Error("Passkey verification did not return a user.");
      const me = await api<{ user: ClusterAuthUser | null }>("/api/me").catch(() => ({ user: result.user || null }));
      onLogin(me.user || result.user);
    } catch (reason) { setError(errorMessage(reason, "The passkey could not be verified.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    if (authActionRef.current || !identifier.trim()) return;
    authActionRef.current = true;
    setError(""); setRecoveryStatus(""); setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/auth/password-reset-request", { method: "POST", body: JSON.stringify({ identifier }) });
      setRecoveryStatus(result.message || "An administrator has been notified if the account can be recovered.");
    } catch (reason) { setError(errorMessage(reason, "The reset request could not be submitted.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  async function submitPasswordlessPasskey() {
    if (!webAuthnAvailable()) { setError("Passkeys are not available in this browser or runtime."); return; }
    if (authActionRef.current || !config) return;
    authActionRef.current = true;
    setError(""); setRecoveryStatus(""); setBusy(true);
    try {
      const start = await api<{ ok: boolean; challenge: string; publicKey: any }>("/api/auth/passkeys/login/start", { method: "POST" });
      const credential = await getWebAuthnCredential(start.publicKey);
      const result = await api<AuthResult>("/api/auth/passkeys/login/verify", { method: "POST", body: JSON.stringify({ challenge: start.challenge, credential }) });
      if (!result.user) throw new Error("Passkey sign in did not return an authenticated user.");
      const me = await api<{ user: ClusterAuthUser | null }>("/api/me").catch(() => ({ user: result.user || null }));
      onLogin(me.user || result.user);
    } catch (reason) { setError(errorMessage(reason, "Passkey sign in failed.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  async function devLogin() {
    if (authActionRef.current || !config?.devLoginEnabled) return;
    authActionRef.current = true;
    setBusy(true); setError("");
    try {
      const result = await api<AuthResult>("/api/auth/dev-login", { method: "POST" });
      if (!result.user) throw new Error("Development sign in did not return a user.");
      const me = await api<{ user: ClusterAuthUser | null }>("/api/me").catch(() => ({ user: result.user || null })); onLogin(me.user || result.user);
    } catch (reason) { setError(errorMessage(reason, "Development sign in failed.")); }
    finally { authActionRef.current = false; setBusy(false); }
  }

  return <AuthEntryLayout studioName={studioName} mode={recoveryMode === "request" ? "recovery" : "signin"}>
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" />{typeof window !== "undefined" && window.clusterDesktop?.showConnection && <ClusterButton unstyled type="button" className="managed-auth-server-switch" onClick={() => { void window.clusterDesktop?.showConnection?.(); }}><span>Connected server</span><strong>{window.clusterDesktop.serverUrl || API_URL}</strong><em>Switch</em></ClusterButton>}</div>
    <p className="eyebrow">{studioName || "Private studio"}</p>
    <h1>{mfaChallenge ? "Verify your sign-in" : recoveryMode === "request" ? "Recover account access" : "Welcome back"}</h1>
    <p className="muted">{mfaChallenge ? "Enter your second factor to finish signing in." : recoveryMode === "request" ? "Request a secure password reset from your administrator." : "Sign in with your Cluster account."}</p>
    {onBack && <ClusterButton className="cluster-auth-back-v11" type="button" variant="quiet" size="compact" disabled={busy} onClick={onBack}>Back to studio</ClusterButton>}
    {configLoading && <p className="cluster-auth-inline-status-v11" role="status">Connecting to authentication service…</p>}
    {configError && <div className="error-box" role="alert">{configError} <ClusterButton type="button" variant="secondary" size="compact" disabled={configLoading} onClick={() => void loadConfig()}>Retry connection</ClusterButton></div>}
    {config && !config.passwordLoginEnabled && recoveryMode === "none" && !mfaChallenge && <p className="cluster-auth-inline-status-v11" role="status">Password sign-in is disabled by studio policy. Use an available passkey or contact an administrator.</p>}
    {recoveryMessage && <ClusterOperationalStatus model={{ state: "auth_expired", interactionState: operationalInteractionState("auth_expired"), label: "Authentication expired", detail: recoveryMessage }} className="managed-auth-recovery-v433" />}
    {config?.ownerSetupRequired && <div className="managed-auth-launcher-warning" role="status"><strong>No password-ready owner account was found.</strong><span>On the Cluster server, run <code>{config.setupLauncherName || "ClusterServer.exe"}</code> to repair owner access.</span></div>}
    {mfaChallenge ? <form className="managed-auth-form managed-auth-mfa-v495" onSubmit={submitMfa}>
      <p className="cluster-auth-step-v11">Second step · Authenticator or recovery code</p>
      {!mfaUseRecovery ? <div className="field"><label htmlFor={mfaFieldId}>Six-digit code</label><ClusterTextInput id={mfaFieldId} inputMode="numeric" enterKeyHint="done" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required /></div> : <div className="field"><label htmlFor={mfaFieldId}>Recovery code</label><ClusterTextInput id={mfaFieldId} enterKeyHint="done" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={64} value={mfaRecoveryCode} onChange={(event) => setMfaRecoveryCode(event.target.value)} autoFocus required /></div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <ClusterButton className="managed-auth-submit" disabled={busy || (mfaUseRecovery ? !mfaRecoveryCode.trim() : mfaCode.length !== 6)} type="submit" variant="primary">{busy ? "Verifying…" : "Verify and sign in"}</ClusterButton>
      {mfaPasskeyPublicKey && webAuthnAvailable() && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void submitPasskey()}>Use passkey or security key</ClusterButton>}
      <div className="managed-auth-help-v473">{mfaRecoveryAvailable && <ClusterButton unstyled type="button" disabled={busy} onClick={() => { setMfaUseRecovery((value) => !value); setError(""); }}>{mfaUseRecovery ? "Use authenticator code" : "Use recovery code"}</ClusterButton>}<ClusterButton unstyled type="button" disabled={busy} onClick={() => { setMfaChallenge(""); setMfaCode(""); setMfaRecoveryCode(""); setMfaUseRecovery(false); setMfaPasskeyPublicKey(null); setPassword(""); setError(""); }}>Back to sign in</ClusterButton></div>
    </form> : recoveryMode === "none" ? <form className="managed-auth-form" onSubmit={submit}>
      <div className="field"><label htmlFor={identifierFieldId}>Username</label><ClusterTextInput id={identifierFieldId} autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></div>
      <div className="field managed-auth-password-v473"><label htmlFor={passwordFieldId}>Password</label><div><ClusterInput id={passwordFieldId} type={showPassword ? "text" : "password"} autoComplete="current-password" enterKeyHint="go" value={password} onChange={(event) => setPassword(event.target.value)} required /><ClusterButton unstyled type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</ClusterButton></div></div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <ClusterButton className="managed-auth-submit" disabled={busy || configLoading || !config || !config.passwordLoginEnabled} type="submit" variant="primary">{busy ? "Signing in…" : "Sign in"}</ClusterButton>
      {webAuthnAvailable() && <ClusterButton className="cluster-auth-passkey-v11" type="button" variant="secondary" disabled={busy || configLoading || !config} onClick={() => void submitPasswordlessPasskey()}>{busy ? "Waiting for authenticator…" : "Use a passkey"}</ClusterButton>}
      <details className="managed-auth-first-use-v11"><summary>First time signing in?</summary><p>Use the one-time temporary password provided privately by your studio administrator. Cluster will ask you to choose your permanent password before entering the workspace. If you never received that credential, contact the administrator for a replacement.</p></details>
      <div className="managed-auth-help-v473"><ClusterButton unstyled type="button" disabled={busy} onClick={() => { setRecoveryMode("request"); setPassword(""); setError(""); }}>Forgot password?</ClusterButton></div>
    </form> : <form className="managed-auth-form managed-auth-recovery-form-v473" onSubmit={requestReset}>
      <p className="cluster-auth-step-v11">A studio administrator reviews recovery requests. Cluster does not reveal whether an account exists.</p>
      <div className="field"><label htmlFor={recoveryFieldId}>Username, email or phone</label><ClusterTextInput id={recoveryFieldId} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required autoFocus /></div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {recoveryStatus && <div className="hint-box" role="status">{recoveryStatus}</div>}
      <div className="login-actions"><ClusterButton disabled={busy || !identifier.trim()} type="submit" variant="primary">{busy ? "Sending…" : "Request reset"}</ClusterButton><ClusterButton disabled={busy} type="button" onClick={() => { setRecoveryMode("none"); setRecoveryStatus(""); setError(""); }} variant="secondary">Back to sign in</ClusterButton></div>
    </form>}
    {config?.devLoginEnabled && !mfaChallenge && recoveryMode === "none" && <div className="managed-auth-development"><span>Local development instance</span><ClusterButton type="button" className="" disabled={busy} onClick={devLogin} variant="secondary">Continue locally</ClusterButton></div>}
    <AuthLegalLinks />
  </AuthEntryLayout>;
}

export function MfaEnrollmentScreen({ user, onComplete, onLogout }: { user: ClusterAuthUser; onComplete: (user: ClusterAuthUser) => void; onLogout: () => void }) {
  const [secret, setSecret] = useState("");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startEnrollment() {
    setBusy(true); setError(""); setRecoveryCodes([]);
    try {
      const result = await api<{ ok: boolean; secret: string; provisioningUri: string }>("/api/auth/mfa/enroll/start", { method: "POST" });
      setSecret(result.secret); setProvisioningUri(result.provisioningUri); setCode("");
    } catch (reason) { setError(errorMessage(reason, "MFA enrollment could not be started.")); }
    finally { setBusy(false); }
  }

  async function verifyEnrollment(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ ok: boolean; recoveryCodes: string[] }>("/api/auth/mfa/enroll/verify", { method: "POST", body: JSON.stringify({ code }) });
      setRecoveryCodes(result.recoveryCodes || []); setSecret(""); setProvisioningUri("");
    } catch (reason) { setError(errorMessage(reason, "The authenticator code was not accepted.")); }
    finally { setBusy(false); }
  }

  async function enrollPasskey() {
    setBusy(true); setError("");
    try {
      if (!webAuthnAvailable()) throw new Error("This device or browser does not support passkeys. A security key or compatible browser is required for owner setup.");
      requireWebAuthnBrowserOrigin();
      const start = await api<{ publicKey: any }>("/api/auth/mfa/passkeys/enroll/start", { method: "POST", body: JSON.stringify({}) });
      const credential = await createWebAuthnCredential(start.publicKey);
      const enrolled = await api<{ recoveryCodes: string[] }>("/api/auth/mfa/passkeys/enroll/verify", { method: "POST", body: JSON.stringify({ credential }) });
      setSecret(""); setProvisioningUri("");
      setRecoveryCodes(enrolled.recoveryCodes || []);
      if (!enrolled.recoveryCodes?.length) await continueToWorkspace();
    } catch (reason) { setError(errorMessage(reason, "Passkey enrollment failed.")); }
    finally { setBusy(false); }
  }

  async function continueToWorkspace() {
    setBusy(true); setError("");
    try {
      const result = await api<{ user: ClusterAuthUser | null }>("/api/me");
      if (!result.user) throw new Error("Cluster could not refresh the authenticated account.");
      if (!result.user) throw new Error("Password setup completed without a user payload.");
      onComplete(result.user);
    } catch (reason) { setError(errorMessage(reason, "Cluster could not finish MFA setup.")); }
    finally { setBusy(false); }
  }

  return <AuthEntryLayout mode="setup" cardClassName="managed-auth-mfa-enrollment-v495">
    <img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" />
    <p className="eyebrow">Studio security policy</p>
    <h1>Set up multi-factor authentication.</h1>
    <p className="muted"><strong>{user.username}</strong> must enroll an authenticator before this session can access the workspace.</p>
    {!secret && recoveryCodes.length === 0 && <div className="managed-auth-form"><div className="managed-auth-security-note"><strong>Your password already succeeded.</strong><span>This session is restricted to MFA setup until an authenticator is enrolled.</span></div><ClusterButton type="button" className="" disabled={busy || !webAuthnAvailable()} onClick={() => void enrollPasskey()} variant="primary">{busy ? "Starting…" : "Enroll passkey or security key"}</ClusterButton>{user.workspaceRole !== "owner" && <ClusterButton type="button" className="" disabled={busy} onClick={startEnrollment} variant="secondary">Use authenticator app (if Studio policy allows)</ClusterButton>}</div>}
    {secret && user.workspaceRole !== "owner" && <form className="managed-auth-form" onSubmit={verifyEnrollment}>
      <div className="hint-box"><strong>Add Cluster to your authenticator</strong><p>Scan/import the provisioning URI if your authenticator supports it, or enter the secret manually.</p><code>{secret}</code><details><summary>Provisioning URI</summary><code>{provisioningUri}</code></details></div>
      <div className="field"><label>Six-digit code</label><ClusterTextInput inputMode="numeric" enterKeyHint="done" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required /></div>
      <ClusterButton type="submit" className="" disabled={busy || code.length !== 6} variant="primary">{busy ? "Verifying…" : "Verify authenticator"}</ClusterButton>
      <ClusterButton type="button" className="" disabled={busy} onClick={startEnrollment} variant="secondary">Generate a new setup secret</ClusterButton>
    </form>}
    {recoveryCodes.length > 0 && <div className="managed-auth-form"><div className="hint-box security-recovery-codes-v495"><strong>Save these recovery codes now</strong><p>Each code works once. Cluster stores only hashes and cannot show these values again.</p><div>{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div></div><ClusterCopyButton text={recoveryCodes.join("\n")} copiedLabel="Recovery codes copied">Copy recovery codes</ClusterCopyButton><ClusterButton type="button" className="" disabled={busy} onClick={continueToWorkspace} variant="primary">{busy ? "Finishing…" : "I saved the codes · Continue"}</ClusterButton></div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    <ClusterButton type="button" className="" disabled={busy} onClick={onLogout} variant="secondary">Sign out</ClusterButton>
    <AuthLegalLinks />
  </AuthEntryLayout>;
}

export function PasswordMigrationScreen({ user, onComplete, onLogout }: { user: ClusterAuthUser; onComplete: (user: ClusterAuthUser) => void; onLogout: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<AuthConfig>("/api/auth/config").then(setConfig).catch(() => undefined); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) return setError("The passwords do not match.");
    setBusy(true);
    try {
      const result = await api<AuthResult>("/api/auth/session-password", { method: "POST", body: JSON.stringify({ password }) });
      if (!result.user) throw new Error("Password setup completed without a user session.");
      onComplete(result.user);
    } catch (reason) {
      setError(errorMessage(reason, "Password setup failed."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthEntryLayout mode="setup">
    <img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" />
    <p className="eyebrow">Password change required</p>
    <h1>Create your permanent password.</h1>
    <p className="muted">The account <strong>{user.username}</strong> signed in with a temporary password. Replace it before continuing. Existing sessions on other devices will be revoked.</p>
    <form className="managed-auth-form" onSubmit={submit}>
      <PasswordFields password={password} confirmation={confirmation} minimumLength={config?.passwordPolicy.minimumLength ?? 12} maximumLength={config?.passwordPolicy.maximumLength ?? 1024} onPassword={setPassword} onConfirmation={setConfirmation} />
      {error && <div className="error-box" role="alert">{error}</div>}
      <ClusterButton className="" disabled={busy} type="submit" variant="primary">{busy ? "Saving…" : "Save password"}</ClusterButton>
      <ClusterButton className="" disabled={busy} type="button" onClick={onLogout} variant="secondary">Sign out</ClusterButton>
    </form>
    <AuthLegalLinks />
  </AuthEntryLayout>;
}

export function DiscordLinkScreen({ user, onRefresh, onLogout }: { user: ClusterAuthUser; onRefresh: () => void; onLogout: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<AuthConfig>("/api/auth/config").then(setConfig).catch((reason) => setError(errorMessage(reason, "Authentication configuration could not be loaded.")));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("discord") === "linked") {
      query.delete("discord");
      const replacement = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", replacement);
      onRefresh();
    }
    if (query.get("discord_error")) {
      setError("Discord linking failed. Start the link again and verify the correct Discord account is selected.");
      query.delete("discord_error");
      const replacement = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", replacement);
    }
  }, [onRefresh]);

  const authOrigin = typeof window !== "undefined" && window.clusterDesktop?.serverUrl ? window.clusterDesktop.serverUrl : API_URL;
  const linkUrl = config ? `${authOrigin}${config.discordLinkUrl}` : "";

  return <AuthEntryLayout mode="setup">
    <img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" />
    <p className="eyebrow">Required identity link</p>
    <h1>Link Discord to continue.</h1>
    <p className="muted">Your Cluster credentials are active for <strong>{user.username}</strong>. Link the matching Discord identity before the workspace unlocks.</p>
    <div className="managed-auth-security-note">
      <strong>Discord is an identity link, not your password.</strong>
      <span>Cluster requests only the basic identity scope and does not keep the OAuth access token after verification.</span>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {!config?.discordConfigured && <div className="hint-box">Discord OAuth is not configured on this server. An administrator must configure the client ID, client secret, and callback URL.</div>}
    <div className="login-actions">
      <ClusterLinkButton variant="primary" className={config?.discordConfigured ? "" : "disabled"} aria-disabled={!config?.discordConfigured} href={config?.discordConfigured ? linkUrl : undefined}>Link Discord</ClusterLinkButton>
      <ClusterButton className="" type="button" onClick={onRefresh} variant="secondary">Check link status</ClusterButton>
      <ClusterButton className="" type="button" onClick={onLogout} variant="secondary">Sign out</ClusterButton>
    </div>
    <AuthLegalLinks />
  </AuthEntryLayout>;
}
