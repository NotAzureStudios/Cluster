import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { api, apiErrorPresentation } from "../../../core/api";
import "./setup-wizard.css";
import type { SetupStatus, User } from "../application-models";
import { ClusterTimezoneSelect } from "../../../components/ClusterTimezoneSelect";

type SetupMode = "guided" | "quick" | "import" | "skip";
type SetupForm = {
  serverDisplayName: string;
  ownerUsername: string;
  ownerPassword: string;
  ownerPasswordConfirm: string;
  ownerPin: string;
  ownerPinConfirm: string;
  studioName: string;
  studioTimezone: string;
  domainName: string;
  connectionMode: "lan" | "private_vpn" | "reverse_proxy" | "direct_https" | "managed_tunnel";
  connectionProvider: "manual" | "tailscale" | "wireguard" | "caddy" | "nginx" | "cloudflare" | "custom";
};
const MODE_LABEL: Record<SetupMode, string> = { guided: "Studio defaults", quick: "Quick", import: "Imported configuration", skip: "Owner only" };
const ALLOWED_CONFIG_SETTINGS = new Set([
  "studioName", "studioTimezone", "defaultCreateStarterBoard",
  "defaultCreateStarterWhiteboard", "defaultCreateStarterLibrary",
]);

type ImportedBundle = { format: "clusterconfig"; schemaVersion: 1; settings: Record<string, unknown> };
function inspectImportedBundle(value: unknown): ImportedBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object.");
  const input = value as Record<string, unknown>;
  if (input.format !== "clusterconfig" || input.schemaVersion !== 1 ||
      Object.keys(input).some((key) => !["format", "schemaVersion", "settings"].includes(key))) {
    throw new Error("Only .clusterconfig schema 1 bundles are supported.");
  }
  if (!input.settings || typeof input.settings !== "object" || Array.isArray(input.settings)) {
    throw new Error("Missing configuration settings.");
  }
  const settings = input.settings as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (!ALLOWED_CONFIG_SETTINGS.has(key)) throw new Error(`The setting '${key}' cannot be imported during setup.`);
    if (key.startsWith("defaultCreateStarter") && typeof value !== "boolean") throw new Error(`${key} must be true or false.`);
    if ((key === "studioName" || key === "studioTimezone") && (typeof value !== "string" || !value.trim() || value.length > 120)) {
      throw new Error(`${key} must be a non-empty string of at most 120 characters.`);
    }
  }
  if (typeof settings.studioTimezone === "string") {
    try { new Intl.DateTimeFormat("en-US", { timeZone: settings.studioTimezone }); }
    catch { throw new Error("studioTimezone is not a valid timezone."); }
  }
  return { format: "clusterconfig", schemaVersion: 1, settings };
}

export function SetupWizard({ onComplete }: { onComplete: (user: User) => void }) {
  const [step, setStep] = useState(0);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [configuration, setConfiguration] = useState<ImportedBundle | null>(null);
  const importGeneration = useRef(0);
  const [configurationName, setConfigurationName] = useState("");
  const [form, setForm] = useState<SetupForm>({
    serverDisplayName: "Cluster Server", ownerUsername: "owner", ownerPassword: "", ownerPasswordConfirm: "", ownerPin: "", ownerPinConfirm: "",
    studioName: "", studioTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    domainName: "", connectionMode: "lan", connectionProvider: "manual",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setupCompletedElsewhere, setSetupCompletedElsewhere] = useState(false);

  useEffect(() => {
    api<SetupStatus>("/api/setup/status")
      .then((next) => {
        setStatus(next);
        if (next.serverDisplayName) setForm((current) => ({ ...current, serverDisplayName: next.serverDisplayName || current.serverDisplayName }));
      }).catch(() => undefined);
  }, []);

  function patch<K extends keyof SetupForm>(key: K, value: SetupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function toggleImport() {
    ++importGeneration.current; setImporting((value) => !value); setConfiguration(null); setConfigurationName(""); setError("");
  }
  async function readConfiguration(event: ChangeEvent<HTMLInputElement>) {
    const generation = ++importGeneration.current;
    const file = event.currentTarget.files?.[0];
    setConfiguration(null);
    setConfigurationName("");
    setError("");
    if (!file) return;
    try {
      if (file.size > 16_384) throw new Error("Configuration exceeds the 16 KiB setup limit.");
      const bundle = inspectImportedBundle(JSON.parse(await file.text()));
      if (generation !== importGeneration.current) return;
      setConfiguration(bundle);
      setConfigurationName(file.name);
    } catch (reason) { if (generation === importGeneration.current) setError(reason instanceof Error ? reason.message : "Could not read configuration."); }
  }

  // The approach follows from what was filled in: an imported bundle, studio
  // defaults typed here, or a quick owner-only start.
  const mode: SetupMode = importing ? "import" : form.studioName.trim() ? "guided" : "quick";
  const validTimezone = (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: form.studioTimezone }); return true; } catch { return false; } })();
  const passwordLength = [...form.ownerPassword.normalize("NFC")].length;
  const serverReady = Boolean(form.serverDisplayName.trim());
  const accountReady = Boolean(form.ownerUsername.trim() && [...form.ownerPassword.normalize("NFC")].length >= 12 && form.ownerPassword === form.ownerPasswordConfirm && /^\d{4,8}$/.test(form.ownerPin) && form.ownerPin === form.ownerPinConfirm);
  const modeReady = mode !== "import" || Boolean(configuration);
  const studioReady = mode !== "guided" || (Boolean(form.studioName.trim()) && validTimezone);
  const steps = ["Studio", "Owner", "Access", "Review"];
  const domainProviders: Record<SetupForm["connectionMode"], SetupForm["connectionProvider"][]> = {
    lan: ["manual", "caddy", "nginx"],
    private_vpn: ["tailscale", "wireguard", "custom"],
    reverse_proxy: ["caddy", "nginx", "custom"],
    direct_https: ["caddy", "nginx"],
    managed_tunnel: ["cloudflare", "custom"],
  };
  const connectionLabel: Record<SetupForm["connectionMode"], string> = { lan: "Local network", private_vpn: "Private VPN", reverse_proxy: "Reverse proxy", direct_https: "Direct HTTPS", managed_tunnel: "Managed tunnel" };
  const validDomain = !form.domainName.trim() || /^(?=.{3,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(form.domainName.trim());

  async function finishSetup() {
    setError("");
    setSetupCompletedElsewhere(false);
    if (!modeReady || !serverReady || !studioReady) { setStep(0); setError(!modeReady ? "Choose a .clusterconfig file or turn import off." : "Check the studio and server fields."); return; }
    if (!accountReady) { setStep(1); setError("Enter matching passwords and a 4–8 digit PIN."); return; }
    if (!validDomain) { setStep(2); setError("Enter a valid domain or leave it blank."); return; }
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; user: User; setup: SetupStatus; error?: string }>("/api/setup/complete", {
        method: "POST",
        body: JSON.stringify({
          mode, serverDisplayName: form.serverDisplayName, ownerUsername: form.ownerUsername,
          ownerPassword: form.ownerPassword, ownerPin: form.ownerPin,
          ...(mode === "guided" ? { studioName: form.studioName, studioTimezone: form.studioTimezone } : {}),
          ...(mode === "import" ? { configuration } : {}),
          ...(form.domainName.trim() ? { domainSetupIntent: {
            domain: form.domainName.trim(), mode: form.connectionMode, provider: form.connectionProvider,
          } } : {}),
        }),
      });
      if (!result.ok) throw new Error(result.error || "Setup failed");
      onComplete(result.user);
    } catch (reason) {
      const detail = apiErrorPresentation(reason);
      if (detail.code === "SETUP_ALREADY_COMPLETE" || detail.status === 409) {
        setSetupCompletedElsewhere(true);
        setError("Setup was completed by another session. Reload Cluster to continue.");
      } else setError(detail.message || "Setup failed");
    } finally { setBusy(false); }
  }

  const stepReady = [modeReady && serverReady && studioReady, accountReady, validDomain, true][step];
  function next() {
    setError("");
    if (!stepReady) { setError(step === 0 ? (!modeReady ? "Choose a .clusterconfig file or turn import off." : "Check the studio and server fields.") : step === 1 ? "Enter matching passwords and a 4–8 digit PIN." : "Enter a valid domain or leave it blank."); return; }
    setStep((value) => Math.min(steps.length - 1, value + 1));
  }

  return <main className="setup-shell setup-v2">
    <form className="setup-v2-card" onSubmit={(event) => { event.preventDefault(); if (step < steps.length - 1) next(); else void finishSetup(); }}>
      <header className="setup-v2-head">
        <img src="/cluster-logo.png" alt="" aria-hidden="true" />
        <div><h1>Set up Cluster</h1><span>{status ? `Version ${status.version}` : "First run"}</span></div>
      </header>
      <nav className="setup-v2-steps" aria-label="Setup progress">
        {steps.map((label, index) => <ClusterButton unstyled type="button" key={label}
          className={step === index ? "active" : index < step ? "done" : ""}
          disabled={busy || index > step} aria-current={step === index ? "step" : undefined}
          onClick={() => { setError(""); setStep(index); }}><i aria-hidden="true" /><span>{label}</span></ClusterButton>)}
      </nav>
      {error && <div className="setup-v2-error" role="alert"><span>{error}</span>{setupCompletedElsewhere && <ClusterButton type="button" variant="secondary" size="compact" onClick={() => window.location.reload()}>Reload</ClusterButton>}</div>}

      {step === 0 && <section className="setup-v2-body" aria-label="Studio">
        {!importing ? <>
          <label className="setup-v2-field"><span>Studio name</span><ClusterTextInput autoFocus value={form.studioName} onChange={(event) => patch("studioName", event.target.value)} placeholder="Optional" /></label>
          {form.studioName.trim() ? <label className="setup-v2-field"><span>Timezone</span><ClusterTimezoneSelect value={form.studioTimezone} onChange={(value) => patch("studioTimezone", value)} /></label> : null}
        </> : <div className="setup-v2-import">
          <label className="setup-v2-field"><span>Configuration file</span><input type="file" accept=".clusterconfig,.json,application/json" onChange={(event) => void readConfiguration(event)} /></label>
          {configuration && <div className="setup-v2-preview"><strong>{configurationName}</strong>
            {Object.entries(configuration.settings).length ? <ul>{Object.entries(configuration.settings).map(([key, value]) => <li key={key}><span>{key}</span><b>{String(value)}</b></li>)}</ul> : <small>No defaults in this bundle.</small>}
          </div>}
        </div>}
        <label className="setup-v2-field"><span>Server name</span><ClusterTextInput value={form.serverDisplayName} onChange={(event) => patch("serverDisplayName", event.target.value)} required /></label>
        <ClusterButton unstyled type="button" className="setup-v2-link" onClick={toggleImport}>{importing ? "Enter details instead" : "Import a .clusterconfig"}</ClusterButton>
      </section>}

      {step === 1 && <section className="setup-v2-body" aria-label="Owner">
        <label className="setup-v2-field"><span>Username</span><ClusterTextInput autoFocus autoComplete="username" value={form.ownerUsername} onChange={(event) => patch("ownerUsername", event.target.value)} required /></label>
        <label className="setup-v2-field setup-v2-password"><span>Password</span><div><ClusterTextInput type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={1024} value={form.ownerPassword} onChange={(event) => patch("ownerPassword", event.target.value)} required /><ClusterButton unstyled type="button" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</ClusterButton></div>
          <small className={passwordLength >= 12 ? "ok" : ""}>12–1024 characters{passwordLength ? ` · ${passwordLength}` : ""}</small></label>
        <label className="setup-v2-field"><span>Confirm password</span><ClusterTextInput type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={1024} value={form.ownerPasswordConfirm} onChange={(event) => patch("ownerPasswordConfirm", event.target.value)} aria-invalid={(form.ownerPasswordConfirm && form.ownerPasswordConfirm !== form.ownerPassword) || undefined} required /></label>
        <div className="setup-v2-pair">
          <label className="setup-v2-field"><span>Security PIN</span><ClusterTextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="new-password" placeholder="4–8 digits" value={form.ownerPin} onChange={(event) => patch("ownerPin", event.target.value.replace(/\D/g, "").slice(0, 8))} required /></label>
          <label className="setup-v2-field"><span>Confirm PIN</span><ClusterTextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="new-password" value={form.ownerPinConfirm} onChange={(event) => patch("ownerPinConfirm", event.target.value.replace(/\D/g, "").slice(0, 8))} aria-invalid={(form.ownerPinConfirm && form.ownerPinConfirm !== form.ownerPin) || undefined} required /></label>
        </div>
      </section>}

      {step === 2 && <section className="setup-v2-body" aria-label="Domain & Access">
        <label className="setup-v2-field"><span>Domain</span><ClusterTextInput autoFocus value={form.domainName} onChange={event => patch("domainName", event.target.value)} placeholder="Optional · example.com" aria-invalid={!validDomain || undefined} /></label>
        <div className="setup-v2-pair">
          <label className="setup-v2-field"><span>Connection</span><select value={form.connectionMode} onChange={event => {
            const next = event.target.value as SetupForm["connectionMode"];
            setForm(current => ({ ...current, connectionMode: next, connectionProvider: domainProviders[next][0] }));
          }}>{(Object.keys(connectionLabel) as SetupForm["connectionMode"][]).map((key) => <option key={key} value={key}>{connectionLabel[key]}</option>)}</select></label>
          <label className="setup-v2-field"><span>Gateway</span><select value={form.connectionProvider} onChange={event => patch("connectionProvider", event.target.value as SetupForm["connectionProvider"])}>{domainProviders[form.connectionMode].map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
        </div>
        <p className="setup-v2-note">Records your plan only. Finish it in Admin → Server after sign-in.</p>
      </section>}

      {step === 3 && <section className="setup-v2-body" aria-label="Review">
        <dl className="setup-v2-review">
          <div><dt>Studio</dt><dd>{mode === "import" ? `${configurationName} · ${Object.keys(configuration?.settings || {}).length} settings` : form.studioName.trim() ? `${form.studioName} · ${form.studioTimezone}` : MODE_LABEL[mode]}</dd></div>
          <div><dt>Server</dt><dd>{form.serverDisplayName}</dd></div>
          <div><dt>Owner</dt><dd>@{form.ownerUsername}</dd></div>
          <div><dt>Access</dt><dd>{form.domainName.trim() || "Local"} · {connectionLabel[form.connectionMode]}</dd></div>
        </dl>
        <p className="setup-v2-note">Configure MFA and recovery codes after sign-in.</p>
      </section>}

      <footer className="setup-v2-foot">
        {step > 0 ? <ClusterButton type="button" disabled={busy} variant="quiet" onClick={() => { setError(""); setStep((value) => value - 1); }}>Back</ClusterButton> : <span />}
        {step < steps.length - 1
          ? <ClusterButton type="submit" disabled={busy || !stepReady} variant="primary">Continue</ClusterButton>
          : <ClusterButton type="submit" disabled={busy || !serverReady || !studioReady || !accountReady || !modeReady || !validDomain} busy={busy} busyLabel="Starting…" variant="primary">Start Cluster</ClusterButton>}
      </footer>
    </form>
  </main>;
}
