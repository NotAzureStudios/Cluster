import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { ClusterButton } from "../../components/ClusterButton";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { runtimeStyle } from "../../core/runtime-style";
import "./server-update-controls.css";

type ServerUpdateStatus = {
  ok: boolean;
  state: string;
  available?: boolean;
  message: string;
  release?: string;
  sequence?: number;
  installSupported?: boolean;
  step?: string;
  progress?: number;
  updatedAt?: string;
};

const ACTIVE = ["staging", "queued", "installing"];

async function authorize(title: string, pinConfigured: boolean) {
  return pinConfigured
    ? requestSecurityPin({ title, description: "Confirm with your security PIN.", purpose: "apply_server_configuration", confirmLabel: "Continue" })
    : requestSecurityPinSetup({ title: "Create security PIN", description: "Server updates need a security PIN.", purpose: "setup_for_apply_server_configuration" });
}

/** Server updates: one action at a time, live progress, plain results.
 *  The Windows updater service verifies, backs up, installs and rolls back. */
export function ServerUpdateControls({ owner, pinConfigured }: { owner: boolean; pinConfigured: boolean }) {
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [available, setAvailable] = useState<ServerUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const wasInstalling = useRef(false);

  async function refresh() {
    try {
      const data = await api<ServerUpdateStatus>("/api/admin/server-updates/status");
      setRestarting(false);
      setStatus(data);
      return data;
    } catch {
      // While an install runs the Server restarts; keep waiting quietly.
      if (wasInstalling.current) setRestarting(true);
      return null;
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const active = ACTIVE.includes(status?.state || "") || restarting;
    if (status?.state === "installing" || status?.state === "queued") wasInstalling.current = true;
    if (status?.state === "installed" && wasInstalling.current) {
      // New web app ships with the new Server: load it.
      const timer = window.setTimeout(() => window.location.reload(), 2500);
      return () => window.clearTimeout(timer);
    }
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [status?.state, restarting]);

  async function check() {
    setBusy(true); setError("");
    try {
      const value = await api<ServerUpdateStatus>("/api/admin/server-updates/check");
      setAvailable(value.available ? value : null);
      if (!value.available) setError(value.message || "Cluster is up to date.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't reach the update feed."); }
    finally { setBusy(false); }
  }

  async function download() {
    const pin = await authorize("Download update", pinConfigured);
    if (!pin) return;
    setBusy(true); setError("");
    try {
      await api("/api/admin/server-updates/stage", { method: "POST", body: JSON.stringify({ securityPin: pin, confirmation: "DOWNLOAD SIGNED SERVER UPDATE" }) });
      setStatus({ ok: true, state: "staging", message: "Downloading and verifying…" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The download couldn't start."); }
    finally { setBusy(false); }
  }

  async function install() {
    if (!window.confirm(`Install Cluster ${status?.release || ""} now? Cluster will be unavailable for a few minutes while it backs up, installs and restarts.`)) return;
    const pin = await authorize("Install update", pinConfigured);
    if (!pin) return;
    setBusy(true); setError("");
    try {
      const result = await api<ServerUpdateStatus>("/api/admin/server-updates/install", { method: "POST", body: JSON.stringify({ securityPin: pin, confirmation: "INSTALL SIGNED SERVER UPDATE" }) });
      wasInstalling.current = true;
      setStatus(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The install couldn't start."); void refresh(); }
    finally { setBusy(false); }
  }

  const state = status?.state || "idle";
  const installing = state === "queued" || state === "installing" || restarting;
  const ready = (state === "verified" || state === "recovered") && status?.installSupported;
  const tone = state === "installed" ? "success" : state === "recovered" || state === "blocked" || state === "failed" ? "warning" : "neutral";
  const label = restarting ? "Restarting" : ({ installed: "Up to date", installing: "Installing", queued: "Starting", verified: "Ready to install", staging: "Downloading", recovered: "Rolled back", blocked: "Needs attention", failed: "Failed" } as Record<string, string>)[state] || "Updates";
  const percent = restarting ? 85 : status?.progress || (state === "queued" ? 2 : 0);

  return (
    <section className="panel server-update" aria-label="Server updates">
      <header className="server-update__head">
        <div>
          <h2>Server updates</h2>
          <p className="muted tight">Installs automatically overnight. Install now any time.</p>
        </div>
        <SettingsStateChip tone={tone}>{label}</SettingsStateChip>
      </header>

      {installing ? <div className="server-update__progress" aria-live="polite">
        <div className="server-update__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={runtimeStyle({ width: `${percent}%` })} /></div>
        <p><strong>{restarting ? "Restarting Cluster" : status?.step || "Starting"}</strong> · updating to {status?.release}</p>
        <p className="muted tight">This page reloads by itself when the update finishes.</p>
      </div> : status?.message && state !== "idle" ? <p className={state === "recovered" || state === "blocked" || state === "failed" ? "server-update__note is-warn" : "server-update__note"} aria-live="polite">{status.message}</p> : null}

      {!installing ? <div className="button-row">
        {ready ? <ClusterButton variant="primary" busy={busy} disabled={!owner || busy} onClick={() => void install()}>
          {state === "recovered" ? "Try again" : `Install ${status?.release || "update"}`}
        </ClusterButton> : available && state !== "staging" ? <ClusterButton variant="primary" busy={busy} disabled={!owner || busy} onClick={() => void download()}>
          Download {available.release || "update"}
        </ClusterButton> : <ClusterButton variant="secondary" busy={busy} disabled={busy || state === "staging"} onClick={() => void check()}>
          Check for updates
        </ClusterButton>}
        {(state === "verified" || state === "recovered") && !status?.installSupported ? <span className="muted">Open the Cluster Server panel on the server once to finish setting up the updater.</span> : null}
      </div> : null}
      {error ? <p className="muted tight" role="status">{error}</p> : null}
    </section>
  );
}
