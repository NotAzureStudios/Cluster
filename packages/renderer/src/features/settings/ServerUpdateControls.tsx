import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { ClusterButton } from "../../components/ClusterButton";
import { SettingsStateChip } from "../../components/SettingsStateChip";

type ServerUpdateStatus = {
  ok: boolean;
  state: string;
  available?: boolean;
  message: string;
  release?: string;
  sequence?: number;
  sha256?: string;
  manualReleaseUrl?: string;
  installSupported?: boolean;
  updatedAt?: string;
};

export function ServerUpdateControls({ owner, pinConfigured }: { owner: boolean; pinConfigured: boolean }) {
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [check, setCheck] = useState<ServerUpdateStatus | null>(null);
  const [busy, setBusy] = useState<"check" | "stage" | "status" | null>(null);
  const [error, setError] = useState("");

  async function refreshStatus(quiet = false) {
    if (!quiet) setBusy("status");
    try {
      const data = await api<ServerUpdateStatus>("/api/admin/server-updates/status");
      setStatus(data);
      if (!quiet) setError("");
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Native Server update status is unavailable.");
    } finally {
      if (!quiet) setBusy(null);
    }
  }

  useEffect(() => { void refreshStatus(); }, []);
  // Poll only while the user-requested native staging process is running.
  // Idle maintenance settings never poll the update feed.
  useEffect(() => {
    if (status?.state !== "staging") return;
    // Repeating timer intentionally survives unchanged native status timestamps.
    // A single timeout would poll only once if the staged update takes longer
    // than one interval to finish.
    const timer = window.setInterval(() => void refreshStatus(true), 4_000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  async function checkForUpdates() {
    setBusy("check");
    setError("");
    try {
      const value = await api<ServerUpdateStatus>("/api/admin/server-updates/check");
      setCheck(value);
      await refreshStatus(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signed Server update check failed.");
    } finally { setBusy(null); }
  }

  async function downloadVerifiedUpdate() {
    if (!owner || busy || !check?.available) return;
    if (!window.confirm("Download and verify this publisher-signed Cluster Server update? This does not install or restart the Server.")) return;
    const pin = pinConfigured
      ? await requestSecurityPin({
          title: "Download signed Cluster Server update",
          description: "Authorize an exact-purpose native Server update download. No installer will run.",
          purpose: "apply_server_configuration",
          confirmLabel: "Authorize download",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Set up a PIN before authorizing signed Server update staging.",
          purpose: "setup_for_apply_server_configuration",
        });
    if (!pin) return;
    setBusy("stage");
    setError("");
    try {
      await api("/api/admin/server-updates/stage", {
        method: "POST",
        body: JSON.stringify({ securityPin: pin, confirmation: "DOWNLOAD SIGNED SERVER UPDATE" }),
      });
      setStatus({ ok: true, state: "staging", message: "Native signed download started." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Server update download could not start.");
    } finally { setBusy(null); }
  }

  return (
    <section className="panel server-config-operations-v238" aria-label="Signed Cluster Server updates">
      <div className="server-config-group-head-v238">
        <div>
          <h2>Server updates</h2>
          <p className="muted tight">Check the publisher-signed Server main release feed from this browser. The native Windows Server Manager verifies signatures before staging an installer.</p>
        </div>
        <SettingsStateChip tone={status?.state === "verified" ? "success" : status?.state === "failed" ? "warning" : "neutral"}>
          {status?.state === "verified" ? "Signed download verified" : status?.state === "staging" ? "Downloading" : "Install requires native broker"}
        </SettingsStateChip>
      </div>
      <div className="button-row">
        <ClusterButton type="button" variant="secondary" busy={busy === "check"} disabled={busy !== null} onClick={() => void checkForUpdates()}>
          Check for updates
        </ClusterButton>
        <ClusterButton type="button" variant="secondary" busy={busy === "stage"} disabled={!owner || !check?.available || busy !== null} onClick={() => void downloadVerifiedUpdate()}>
          Download &amp; verify
        </ClusterButton>
        <ClusterButton type="button" variant="secondary" disabled={busy !== null} onClick={() => void refreshStatus()}>
          Refresh status
        </ClusterButton>
        <ClusterButton type="button" variant="primary" disabled title="A separately provisioned, privileged native update broker is required.">
          Install update
        </ClusterButton>
      </div>
      {check && <p role="status">{check.message}</p>}
      {status && <div aria-live="polite">
        <p><strong>Native status:</strong> {status.state}{status.release ? ` · Server ${status.release}` : ""}</p>
        <p className="muted tight">{status.message}</p>
        {status.sha256 && <p className="muted tight">Verified installer SHA-256: <code>{status.sha256}</code></p>}
      </div>}
      {error && <p role="alert">{error}</p>}
      <p className="muted tight">Downloading is not installation. The current LocalService Server cannot elevate itself from a browser request. Remote unattended install remains disabled until an independently provisioned privileged Windows updater can securely claim the one-time authorization, cold-back up PostgreSQL, install, and roll back if verification fails.</p>
    </section>
  );
}
