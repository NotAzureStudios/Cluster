import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { api, apiErrorPresentation } from "../../../core/api";
import type { SetupStatus, User } from "../application-models";

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
const MODES: Array<{ id: SetupMode; label: string; detail: string }> = [
  { id: "guided", label: "Guided setup", detail: "Set the server, owner, studio identity, and timezone." },
  { id: "quick", label: "Quick setup", detail: "Get a secured owner account running with sensible defaults." },
  { id: "import", label: "Import configuration", detail: "Apply a reviewed, non-secret .clusterconfig starter bundle." },
  { id: "skip", label: "Skip optional settings", detail: "Create the required owner now; finish configuration from the admin checklist." },
];
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
  const [mode, setMode] = useState<SetupMode>("quick");
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

  const serverReady = Boolean(form.serverDisplayName.trim());
  const accountReady = Boolean(form.ownerUsername.trim() && [...form.ownerPassword.normalize("NFC")].length >= 12 && form.ownerPassword === form.ownerPasswordConfirm && /^\d{4,8}$/.test(form.ownerPin) && form.ownerPin === form.ownerPinConfirm);
  const modeReady = mode !== "import" || Boolean(configuration);
  const studioReady = mode !== "guided" || Boolean(form.studioName.trim());
  const steps = ["Approach", "Server", "Owner", "Domain & Access", "Review"];
  const domainProviders: Record<SetupForm["connectionMode"], SetupForm["connectionProvider"][]> = {
    lan: ["manual", "caddy", "nginx"],
    private_vpn: ["tailscale", "wireguard", "custom"],
    reverse_proxy: ["caddy", "nginx", "custom"],
    direct_https: ["caddy", "nginx"],
    managed_tunnel: ["cloudflare", "custom"],
  };
  const validDomain = !form.domainName.trim() || /^(?=.{3,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(form.domainName.trim());

  async function finishSetup() {
    setError("");
    setSetupCompletedElsewhere(false);
    if (!modeReady) { setStep(0); setError("Choose and review a .clusterconfig file first."); return; }
    if (!serverReady || !studioReady) { setStep(1); setError("Complete the server and studio fields."); return; }
    if (!accountReady) { setStep(2); setError("Enter matching passwords and a 4–8 digit PIN."); return; }
    if (!validDomain) { setStep(3); setError("Enter a valid domain or leave it blank for local-only setup."); return; }
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

  function next() {
    setError("");
    if (step === 0 && !modeReady) { setError("Select a supported .clusterconfig file before continuing."); return; }
    if (step === 1 && (!serverReady || !studioReady)) { setError("Complete the required server and studio fields."); return; }
    if (step === 2 && !accountReady) { setError("Enter matching passwords and a 4–8 digit PIN."); return; }
    if (step === 3 && !validDomain) { setError("Enter a valid domain or leave it blank for local-only setup."); return; }
    setStep((value) => Math.min(steps.length - 1, value + 1));
  }

  return <main className="setup-shell setup-phase1-v473">
    <section className="setup-card panel setup-card-v473">
      <header className="setup-header-v473"><div>
        <span>Cluster setup</span><h1>Start Cluster</h1>
        
      </div><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /></header>
      <nav className="setup-progress-v473" aria-label="Setup progress">
        {steps.map((label, index) => <ClusterButton unstyled type="button" key={label}
          className={step === index ? "active" : index < step ? "done" : ""}
          disabled={busy || index > step} aria-current={step === index ? "step" : undefined}
          onClick={() => setStep(index)}><b>{index + 1}</b><span>{label}</span></ClusterButton>)}
      </nav>
      <div className="setup-body-v473">
        {error && <div className="error-box setup-error-v473" role="alert"><span>{error}</span>{setupCompletedElsewhere && <ClusterButton type="button" variant="secondary" size="compact" onClick={() => window.location.reload()}>Reload Cluster</ClusterButton>}</div>}
        {step === 0 && <section className="setup-section-v473">
          <div className="setup-section-copy-v473"><span>Approach</span><h2>How should we set up?</h2><p>You can finish optional configuration in Studio Settings after signing in.</p></div>
          <div className="setup-fields-v473">
            <div className="setup-mode-picker-v506" role="group" aria-label="Setup mode">
              {MODES.map((item) => <ClusterButton unstyled type="button" key={item.id}
                className={mode === item.id ? "selected" : ""} aria-pressed={mode === item.id}
                onClick={() => { ++importGeneration.current; setMode(item.id); setConfiguration(null); setConfigurationName(""); setError(""); }}>
                  <strong>{item.label}</strong><small>{item.detail}</small>
                </ClusterButton>)}
            </div>
            {mode === "import" && <div className="setup-config-import-v506">
              <label className="field"><span>Configuration file</span><input type="file" accept=".clusterconfig,.json,application/json" onChange={(event) => void readConfiguration(event)} /></label>
              {configuration && <div className="setup-config-preview-v506"><strong>Import preview: {configurationName}</strong>
                {Object.entries(configuration.settings).length ? <ul>{Object.entries(configuration.settings).map(([key, value]) => <li key={key}>{key}: {String(value)}</li>)}</ul> : <p>No configuration defaults in this bundle.</p>}
                <small>Only the listed defaults will be imported. Credentials, server paths, permissions, and security settings are rejected.</small>
              </div>}
            </div>}
          </div>
        </section>}
        {step === 1 && <section className="setup-section-v473"><div className="setup-section-copy-v473"><span>Server</span><h2>Identify this server</h2>
          <p>Required server identity{mode === "guided" ? " and studio defaults" : ""}.</p>
          {status && <small>{status.setupComplete ? "Existing server setup detected" : "Local bootstrap required"} · Cluster {status.version}</small>}
          </div><div className="setup-fields-v473">
            <label className="field"><span>Server name</span><ClusterTextInput value={form.serverDisplayName} onChange={(event) => patch("serverDisplayName", event.target.value)} required /></label>
            {mode === "guided" && <>
              <label className="field"><span>Studio name</span><ClusterTextInput value={form.studioName} onChange={(event) => patch("studioName", event.target.value)} placeholder="Your studio" required /></label>
              <label className="field"><span>Studio timezone (IANA)</span><ClusterTextInput value={form.studioTimezone} onChange={(event) => patch("studioTimezone", event.target.value)} placeholder="America/New_York" required /></label>
            </>}
            <p className="setup-inline-note-v473">Networking, storage, backups, and other settings stay under authenticated administration. Cluster's administrator checklist tracks recommended Owner security and optional workspace setup without blocking your first local login.</p>
          </div></section>}
        {step === 2 && <section className="setup-section-v473 setup-optional-v473"><div className="setup-section-copy-v473"><span>Owner</span><h2>Create the owner account</h2>
          
          {status && <small>{status.userCount} user(s) · {status.workspaceCount} workspace(s)</small>}
          </div><div className="setup-fields-v473">
            <label className="field"><span>Username</span><ClusterTextInput autoComplete="username" value={form.ownerUsername} onChange={(event) => patch("ownerUsername", event.target.value)} required /></label>
            <label className="field setup-password-v473"><span>Password</span><div><ClusterTextInput type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={1024} value={form.ownerPassword} onChange={(event) => patch("ownerPassword", event.target.value)} required /><ClusterButton unstyled type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</ClusterButton></div></label>
            <label className="field setup-password-v473"><span>Confirm password</span><ClusterTextInput type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={1024} value={form.ownerPasswordConfirm} onChange={(event) => patch("ownerPasswordConfirm", event.target.value)} required /></label>
            <label className="field"><span>Security PIN · 4–8 digits</span><ClusterTextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="new-password" value={form.ownerPin} onChange={(event) => patch("ownerPin", event.target.value.replace(/\D/g, "").slice(0, 8))} required /></label>
            <label className="field"><span>Confirm PIN</span><ClusterTextInput type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="new-password" value={form.ownerPinConfirm} onChange={(event) => patch("ownerPinConfirm", event.target.value.replace(/\D/g, "").slice(0, 8))} required /></label>
          </div><p className="setup-inline-note-v473">All accounts, including the initial Owner, require 12–1024 character passwords. Your PIN is separate. Enroll MFA and save recovery codes after sign-in.</p>
        </section>}
        {step === 3 && <section className="setup-section-v473"><div className="setup-section-copy-v473">
          <span>Domain &amp; access</span><h2>How will members connect?</h2>
          <p>Choose the initial domain and connection method. DNS proof, server binding, and gateway activation are finalized by the signed-in Owner.</p></div>
          <div className="setup-fields-v473">
            <label className="field"><span>Studio domain (optional)</span><ClusterTextInput value={form.domainName} onChange={event => patch("domainName", event.target.value)} placeholder="example.com" /></label>
            <label className="field"><span>Connection mode</span><select value={form.connectionMode} onChange={event => {
              const next = event.target.value as SetupForm["connectionMode"];
              setForm(current => ({ ...current, connectionMode: next, connectionProvider: domainProviders[next][0] }));
            }}><option value="lan">Local network</option><option value="private_vpn">Private VPN</option><option value="reverse_proxy">Reverse proxy</option><option value="direct_https">Direct HTTPS</option><option value="managed_tunnel">Managed tunnel</option></select></label>
            <label className="field"><span>Gateway provider</span><select value={form.connectionProvider} onChange={event => patch("connectionProvider", event.target.value as SetupForm["connectionProvider"])}>{domainProviders[form.connectionMode].map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label>
            <div className="setup-access-guidance-rc46" role="note"><strong>Recommended: private studio VPN</strong><span>Finish owner setup locally, then open Admin → Server Configuration → Network → Connection assistant. It guides Tailscale or Cloudflare Tunnel setup, HTTPS, and a test from another device.</span><span>The choice here records your plan. It does not open a port or install a tunnel.</span></div>
          </div>
        </section>}
        {step === 4 && <section className="setup-section-v473 setup-review-v473"><div className="setup-section-copy-v473"><span>Review</span><h2>Ready to start</h2><p>Confirm the server and owner.</p></div>
          <div className="setup-review-grid-v473">
            <div><span>Setup approach</span><strong>{MODES.find((item) => item.id === mode)?.label}</strong></div>
            <div><span>Server</span><strong>{form.serverDisplayName}</strong></div>
            <div><span>Owner</span><strong>@{form.ownerUsername}</strong></div>
            {mode === "guided" && <div><span>Studio</span><strong>{form.studioName}</strong></div>}
            {mode === "import" && <div><span>Configuration</span><strong>{Object.keys(configuration?.settings || {}).length} reviewed setting(s)</strong></div>}
            <div><span>Domain</span><strong>{form.domainName.trim() || "Local setup; add a domain later"}</strong></div>
            <div><span>Access method</span><strong>{form.connectionMode} · {form.connectionProvider}</strong></div>
            <div><span>Security</span><strong>Password and PIN ready · MFA later</strong></div>
          </div>
        </section>}
        {step === 4 && <details className="setup-inline-note-v473"><summary>What happens after setup?</summary><p>You enter Cluster using the Owner password. The administrator checklist then guides MFA enrollment and recovery codes, backup policy, timezone, another administrator, and your first Project. Custom domains, remote gateways, and integrations can be configured later. Importing a .clusterconfig file never imports credentials or server secrets.</p></details>}
      </div>
      <footer className="setup-footer-v473"><span>{step + 1} / {steps.length}</span><div>
        {step > 0 && <ClusterButton type="button" disabled={busy} variant="secondary" onClick={() => { setError(""); setStep((value) => value - 1); }}>Back</ClusterButton>}
        {step < steps.length - 1
          ? <ClusterButton type="button" disabled={busy || (step === 0 && !modeReady) || (step === 1 && (!serverReady || !studioReady)) || (step === 2 && !accountReady)} variant="primary" onClick={next}>Continue</ClusterButton>
          : <ClusterButton type="button" disabled={busy || !serverReady || !studioReady || !accountReady || !modeReady || !validDomain} busy={busy} busyLabel="Bootstrapping…" variant="primary" onClick={() => void finishSetup()}>Start Cluster</ClusterButton>}
      </div></footer>
    </section>
  </main>;
}
