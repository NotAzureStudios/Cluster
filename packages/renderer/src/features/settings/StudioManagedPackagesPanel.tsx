import { useEffect, useMemo, useRef, useState } from "react";
import { ManagedPackageEntitlementsPanel } from "./ManagedPackageEntitlementsPanel";
import { ManagedPackageSeatRequirementPanel } from "./ManagedPackageSeatRequirementPanel";
import { ManagedPackageRecipientReadinessPanel } from "./ManagedPackageRecipientReadinessPanel";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";

type PackageRelease = { id: string; packageId: string; version: string; platform: string; artifactSize: number; artifactSha256: string; filename: string; revokedAt?: string | null; publishedAt: string; dependencies?: { packageKey: string; version: string; requirement: "content-selected" | "msi-installed" }[]; dependencyMetadataValid?: boolean };
type PackageRollout = { channel: string; releaseId: string; state: string; percentage: number; revision: number };
type PackageRow = { id: string; key: string; title: string; description: string; releases: PackageRelease[]; policies: PackageRollout[] };
type SigningKey = { fingerprint: string; label: string; disabledAt?: string | null };
type PackageAudit = { action: string; actorId: string | null; subjectId: string; createdAt: string; details?: Record<string, unknown> };
type DeviceDeployment = { id: string; releaseId: string; deviceRegistrationId: string; state: string;
  revision: number; offeredAt: string; lastReportedAt: string | null;
  reports: Array<{ sequence: number; state: string; reportedAt: string; detail: string }> };

type PackageReconciliationDevice = {
  registrationId: string; userId: string; label: string | null; lastSeenAt: string;
  target: { releaseId: string; version: string; selection: string; artifactSha256: string } | null;
  latestObserved: { releaseId: string; state: string; lastReportedAt: string | null; offeredAt: string } | null;
  status: "not_targeted" | "no_report" | "offer_pending" | "reported_in_progress" | "reported_selected"
    | "reported_failure" | "reported_rollback" | "different_release_reported";
};
type PackageReconciliationPage = { devices: PackageReconciliationDevice[]; nextCursor: string | null;
  evidenceTruncated: boolean; scope: string; osAttested: false; installerCertified: false };
const reconciliationLabels: Record<PackageReconciliationDevice["status"], string> = {
  not_targeted: "Not in active target", no_report: "No sampled report", offer_pending: "Download offered",
  reported_in_progress: "Progress reported", reported_selected: "Local content selection claimed",
  reported_failure: "Failure reported", reported_rollback: "Rollback reported",
  different_release_reported: "Different release reported",
};

type SignedEnvelope = { manifest: { packageKey: string; version: string; platform: string }; artifactBase64: string; signatureBase64: string; signingKeyFingerprint: string };

export function StudioManagedPackagesPanel() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [keys, setKeys] = useState<SigningKey[]>([]);
  const [audit, setAudit] = useState<PackageAudit[]>([]);
  const [auditError, setAuditError] = useState("");
  const [deployments, setDeployments] = useState<DeviceDeployment[]>([]);
  const [deploymentsError, setDeploymentsError] = useState("");
  const [reconciliation, setReconciliation] = useState<PackageReconciliationDevice[]>([]);
  const [reconciliationCursor, setReconciliationCursor] = useState<string | null>(null);
  const [reconciliationLoaded, setReconciliationLoaded] = useState(false);
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [reconciliationError, setReconciliationError] = useState("");
  const [reconciliationTruncated, setReconciliationTruncated] = useState(false);
  const reconciliationRequest = useRef(0);
  const reconciliationPending = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [create, setCreate] = useState({ key: "", title: "", description: "" });
  const [trust, setTrust] = useState({ label: "", publicKeyPem: "", confirmation: "" });
  const [channel, setChannel] = useState<"stable" | "beta" | "testing">("stable");
  const [releaseId, setReleaseId] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [state, setState] = useState<"paused" | "active">("paused");
  const [deviceId, setDeviceId] = useState("");
  const [devicePlatform, setDevicePlatform] = useState<"windows-x64" | "linux-x64" | "macos-arm64">("windows-x64");
  const [preview, setPreview] = useState("");
  const [pin, setPin] = useState<{ active: boolean; revision: number; releaseId: string; reason: string } | null>(null);
  const [pinReleaseId, setPinReleaseId] = useState("");
  const [pinReason, setPinReason] = useState("");
  const [revokeReleaseId, setRevokeReleaseId] = useState("");
  const [revocationReason, setRevocationReason] = useState("");
  const [revocationConfirmation, setRevocationConfirmation] = useState("");
  const [signedJson, setSignedJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const selected = useMemo(() => packages.find((item) => item.id === selectedId) || null, [packages, selectedId]);
  const policy = selected?.policies.find((item) => item.channel === channel);
  useEffect(() => { setPreview(""); setPin(null); setReleaseId(policy?.releaseId || ""); setPercentage(policy?.percentage || 0); setState(policy?.state === "active" ? "active" : "paused"); }, [selectedId, channel, policy?.revision]);

  async function reload() {
    const [catalog, keyRows] = await Promise.all([
      api<{ packages: PackageRow[] }>("/api/admin/packages"),
      api<{ keys: SigningKey[] }>("/api/admin/packages/signing-keys"),
    ]);
    setPackages(catalog.packages || []);
    setKeys(keyRows.keys || []);
    setSelectedId((current) => catalog.packages.some((p) => p.id === current) ? current : catalog.packages[0]?.id || "");
  }
  useEffect(() => { let alive = true; void Promise.all([
    api<{ packages: PackageRow[] }>("/api/admin/packages"),
    api<{ keys: SigningKey[] }>("/api/admin/packages/signing-keys"),
  ]).then(([catalog, keyRows]) => { if (!alive) return; setPackages(catalog.packages || []); setKeys(keyRows.keys || []); setSelectedId(catalog.packages?.[0]?.id || ""); })
    .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "Package data unavailable"); })
    .finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    let active = true;
    setAudit([]); setAuditError("");
    if (selectedId) void api<{ events: PackageAudit[] }>(`/api/admin/packages/${encodeURIComponent(selectedId)}/audit`)
      .then((response) => { if (active) setAudit(response.events || []); })
      .catch(() => { if (active) setAuditError("Package delivery evidence could not be loaded."); });
    return () => { active = false; };
  }, [selectedId, packages]);
  useEffect(() => {
    let active = true;
    setDeployments([]); setDeploymentsError("");
    if (selectedId) void api<{ deployments: DeviceDeployment[] }>(`/api/admin/packages/${encodeURIComponent(selectedId)}/deployments`)
      .then((response) => { if (active) setDeployments(response.deployments || []); })
      .catch(() => { if (active) setDeploymentsError("Device-reported deployment history could not be loaded."); });
    return () => { active = false; };
  }, [selectedId, packages]);
  // Deliberately user-triggered. Do not poll hundreds of registrations in
  // the background merely because an admin opened Tool Config.
  useEffect(() => {
    reconciliationRequest.current++; reconciliationPending.current = false;
    setReconciliation([]); setReconciliationCursor(null); setReconciliationLoaded(false);
    setReconciliationError(""); setReconciliationTruncated(false); setReconciliationBusy(false);
  }, [selectedId, channel, devicePlatform, policy?.revision]);
  async function loadReconciliation(cursor: string | null = null) {
    if (!selectedId || reconciliationPending.current) return;
    reconciliationPending.current = true;
    const requestId = ++reconciliationRequest.current;
    setReconciliationBusy(true); setReconciliationError("");
    const params = new URLSearchParams({ channel, platform: devicePlatform, limit: "50" });
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await api<PackageReconciliationPage>(`/api/admin/packages/${encodeURIComponent(selectedId)}/reconciliation?${params}`);
      if (requestId !== reconciliationRequest.current) return;
      setReconciliation((current) => cursor ? [...current, ...result.devices] : result.devices);
      setReconciliationCursor(result.nextCursor);
      setReconciliationLoaded(true);
      setReconciliationTruncated((current) => (cursor ? current : false) || result.evidenceTruncated);
    } catch (cause) {
      if (requestId === reconciliationRequest.current)
        setReconciliationError(cause instanceof Error ? cause.message : "Reconciliation unavailable");
    } finally {
      if (requestId === reconciliationRequest.current) { reconciliationPending.current = false; setReconciliationBusy(false); }
    }
  }
  async function mutate(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); await reload(); reconciliationRequest.current++; reconciliationPending.current = false; setReconciliationLoaded(false); setReconciliationBusy(false); setReconciliation([]); setReconciliationCursor(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Package action failed"); }
    finally { setBusy(false); }
  }
  async function publishEnvelope() {
    if (!selected || !signedJson.trim()) return;
    let envelope: SignedEnvelope;
    try { envelope = JSON.parse(signedJson); } catch { setError("Signed release JSON is invalid."); return; }
    if (!envelope.manifest || envelope.manifest.packageKey !== selected.key) { setError("Signed manifest must target this package key."); return; }
    await mutate(async () => {
      await api(`/api/admin/packages/${encodeURIComponent(selected.id)}/releases`, { method: "POST", body: JSON.stringify(envelope) });
      setSignedJson(""); setMessage("Signed release stored. No workstation installation has been performed.");
    });
  }
  return <div className="studio-systems-v34f">
    <div className="settings-panel-head-v092"><div><p className="eyebrow">Studio distribution</p><h2>Managed Packages</h2><p>Signed immutable artifacts, rollout cohorts, release pinning and rollback policy. Native installation is held until the authenticated workstation agent is certified.</p></div><ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => void mutate(async () => {})}>Refresh</ClusterButton></div>
    {error && <div role="alert" className="settings-card-v092">{error}</div>}
    {message && <div role="status" className="studio-explanation-v272">{message}</div>}
    {loading ? <p>Loading Packages…</p> : <div className="studio-systems-layout-v34f">
      <aside className="studio-systems-list-v34f">
        <div className="settings-card-v092"><strong>New Package</strong>
          <ClusterInput aria-label="Package name" value={create.title} placeholder="Package title" onChange={(e) => setCreate((v) => ({ ...v, title: e.target.value, key: v.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-") }))}/>
          <ClusterInput aria-label="Package key" value={create.key} placeholder="package-key" onChange={(e) => setCreate((v) => ({ ...v, key: e.target.value }))}/>
          <ClusterInput aria-label="Package description" value={create.description} placeholder="Description" onChange={(e) => setCreate((v) => ({ ...v, description: e.target.value }))}/>
          <ClusterButton type="button" variant="secondary" disabled={busy || create.title.trim().length < 2 || create.key.length < 3} onClick={() => void mutate(async () => { await api("/api/admin/packages", { method: "POST", body: JSON.stringify(create) }); setCreate({ title: "", key: "", description: "" }); setMessage("Package registered."); })}>Create Package</ClusterButton>
        </div>
        <div className="studio-entity-list-v272">{packages.map((item) => <ClusterButton type="button" key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}><span className="studio-entity-list-copy-v272"><strong>{item.title}</strong><small>{item.key} · {item.releases.length} releases</small></span></ClusterButton>)}{!packages.length && <p>No Packages registered yet.</p>}</div>
      </aside>
      <section className="studio-systems-editor-v34f">
        <div className="settings-card-v092"><strong>Trusted signing keys</strong><p>Generate an Ed25519 keypair offline. Only paste the PUBLIC PEM here. Trusting a key is a privileged security decision.</p>
          <ClusterInput aria-label="Signing key label" value={trust.label} placeholder="Signing key label" onChange={(e) => setTrust((v) => ({ ...v, label: e.target.value }))}/>
          <ClusterTextarea aria-label="Public key PEM" value={trust.publicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" onChange={(e) => setTrust((v) => ({ ...v, publicKeyPem: e.target.value }))}/>
          <ClusterInput aria-label="Signing key trust confirmation" value={trust.confirmation} placeholder="Type TRUST PACKAGE KEY" onChange={(e) => setTrust((v) => ({ ...v, confirmation: e.target.value }))}/>
          <ClusterButton type="button" variant="secondary" disabled={busy || trust.confirmation !== "TRUST PACKAGE KEY" || !trust.publicKeyPem.trim()} onClick={() => void mutate(async () => { await api("/api/admin/packages/signing-keys", { method: "POST", headers: { "X-Cluster-Confirmation": trust.confirmation }, body: JSON.stringify({ label: trust.label, publicKeyPem: trust.publicKeyPem }) }); setTrust({ label: "", publicKeyPem: "", confirmation: "" }); setMessage("Public key trusted. The private signing key stays offline."); })}>Trust public key</ClusterButton>
          {keys.map((key) => <p key={key.fingerprint}><strong>{key.label}</strong> · <code>{key.fingerprint.slice(0, 16)}…</code>{key.disabledAt ? " · disabled" : " · active"}</p>)}
        </div>
        {selected && <>
          <div className="settings-card-v092"><h3>{selected.title}</h3><p>{selected.description || "Package release control"} · <code>{selected.key}</code></p><p>Publish a signed envelope generated offline with <code>tools/scripts/cluster-package-sign.mjs</code>. Public key trust and artifact integrity are verified by the server.</p>
            <input type="file" accept=".json,application/json" aria-label="Select signed release envelope" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((text) => { if (text.length > 5_700_000) { setError("Release envelope is too large."); return; } setSignedJson(text); }); }} />
            <ClusterButton type="button" variant="primary" disabled={busy || !signedJson.trim()} onClick={() => void publishEnvelope()}>Verify and publish signed release</ClusterButton>
          </div>
          <div className="settings-card-v092"><h3>Release catalogue</h3>
            {selected.releases.map((release) => <div key={release.id} className="studio-explanation-v272"><strong>{release.version} · {release.platform}</strong><span>{release.filename} · {Math.ceil(release.artifactSize / 1024)} KiB · SHA-256 {release.artifactSha256.slice(0, 16)}…{release.revokedAt ? " · REVOKED" : ""}</span>
              {release.dependencyMetadataValid === false && <p role="alert">Stored dependency metadata is invalid. This release must not be targeted.</p>}
              {!!release.dependencies?.length && <p className="muted tight">Signed prerequisites: {release.dependencies.map((dep) => `${dep.packageKey} v${dep.version} (${dep.requirement})`).join(", ")}. Recipients must also be entitled to the prerequisite releases.</p>}
            </div>)}
            {!selected.releases.length && <p>No signed releases published.</p>}
          </div>
          <div className="settings-card-v092"><h3>Staged rollout and rollback</h3><p>Change the release target or pause delivery without mutating any published artifact. Device installation is not yet enabled.</p>
            <ClusterNativeSelect aria-label="Rollout channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}><option value="stable">Stable</option><option value="beta">Beta</option><option value="testing">Testing</option></ClusterNativeSelect>
            <ClusterNativeSelect aria-label="Rollout release" value={releaseId} onChange={(e) => setReleaseId(e.target.value)}><option value="">Choose release</option>{selected.releases.filter((r) => !r.revokedAt).map((r) => <option key={r.id} value={r.id}>{r.version} · {r.platform}</option>)}</ClusterNativeSelect>
            <ClusterInput type="number" aria-label="Rollout percentage" min={0} max={100} value={percentage} onChange={(e) => setPercentage(Number(e.target.value))} />
            <ClusterNativeSelect aria-label="Rollout state" value={state} onChange={(e) => setState(e.target.value as typeof state)}><option value="paused">Paused</option><option value="active">Active</option></ClusterNativeSelect>
            <ClusterButton type="button" variant="secondary" disabled={busy || !releaseId || percentage < 0 || percentage > 100} onClick={() => void mutate(async () => { await api(`/api/admin/packages/${encodeURIComponent(selected.id)}/rollouts`, { method: "PUT", body: JSON.stringify({ channel, releaseId, percentage, state, expectedRevision: policy?.revision || 0 }) }); setMessage("Rollout policy saved. A previous release can be selected to roll back the target."); })}>Save rollout / rollback target</ClusterButton>
            <p className="muted">Current policy: {policy ? `${policy.state}, ${policy.percentage}%, revision ${policy.revision}` : "not configured"}.</p>
          </div>
          <div className="settings-card-v092"><h3>Device targeting preview</h3><p>Use the internal verified Device Registration ID, not a user-provided hardware name. Deterministic cohort selection, including pinned release overrides. This is a planning preview and not evidence that software has been installed.</p>
            <ClusterInput aria-label="Device registration ID" value={deviceId} placeholder="Verified Device Registration ID" onChange={(e) => setDeviceId(e.target.value)} />
            <ClusterNativeSelect aria-label="Device platform" value={devicePlatform} onChange={(e) => setDevicePlatform(e.target.value as typeof devicePlatform)}><option value="windows-x64">Windows x64</option><option value="linux-x64">Linux x64</option><option value="macos-arm64">macOS ARM</option></ClusterNativeSelect>
            <ClusterButton type="button" variant="secondary" disabled={busy || deviceId.length < 3} onClick={() => void mutate(async () => { const result = await api<{ selected?: PackageRelease | null; pinned?: { active: boolean; revision: number; releaseId: string; reason: string } | null }>(`/api/admin/packages/${encodeURIComponent(selected.id)}/targets/${encodeURIComponent(deviceId)}?platform=${devicePlatform}&channel=${channel}`); setPreview(result.selected ? `${result.selected.version} (${result.selected.platform})` : "No eligible release"); setPin(result.pinned || null); })}>Preview target</ClusterButton>
            {preview && <p role="status">Selected: {preview}</p>}
            {pin && <p>Pin: {pin.active ? "active" : "disabled"}, revision {pin.revision}</p>}
            <ClusterNativeSelect aria-label="Pin release" value={pinReleaseId} onChange={(e) => setPinReleaseId(e.target.value)}><option value="">Choose pin target</option>{selected.releases.filter((item) => !item.revokedAt && item.platform === devicePlatform).map((item) => <option value={item.id} key={item.id}>{item.version}</option>)}</ClusterNativeSelect>
            <ClusterInput aria-label="Pin reason" placeholder="Required reason for pinning / rollback" value={pinReason} onChange={(e) => setPinReason(e.target.value)}/>
            <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={busy || deviceId.length < 3 || pinReason.trim().length < 8 || !pinReleaseId} onClick={() => void mutate(async () => { const result = await api<{ pin: { active: boolean; revision: number; releaseId: string; reason: string } }>(`/api/admin/packages/${encodeURIComponent(selected.id)}/pins`, { method: "PUT", body: JSON.stringify({ deviceId, releaseId: pinReleaseId, reason: pinReason.trim(), expectedRevision: pin?.revision || 0 }) }); setPin(result.pin); setMessage("Device pin recorded; no installation executed."); })}>Pin version / rollback target</ClusterButton>
            {pin?.active && <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => void mutate(async () => { await api(`/api/admin/packages/${encodeURIComponent(selected.id)}/pins/remove`, { method: "POST", body: JSON.stringify({ deviceId, expectedRevision: pin.revision }) }); setPin({ ...pin, active: false, revision: pin.revision + 1 }); setMessage("Pin removed."); })}>Remove pin</ClusterButton>}</div>
          </div>
          <div className="settings-card-v092"><h3>Rollout reconciliation</h3>
            <p>Compare the signed target for each verified Desktop registration against its latest sampled device report. This is diagnostic data, <strong>not proof of OS installation, execution, or workstation health.</strong> The platform selector is a target simulation, not a verified device OS. Results are paged; totals are only for the loaded registrations.</p>
            <ClusterButton type="button" variant="secondary" disabled={reconciliationBusy || !selected} onClick={() => void loadReconciliation()}>{reconciliationBusy ? "Inspecting…" : "Inspect device targets"}</ClusterButton>
            {reconciliationError && <p role="alert">{reconciliationError}</p>}
            {reconciliationLoaded && <>
              <p role="status">Showing {reconciliation.length} verified Desktop registration{reconciliation.length === 1 ? "" : "s"} for {channel} · {devicePlatform}. {reconciliation.filter((item) => item.status === "reported_selected").length} claim local content selection, without OS attestation.</p>
              {reconciliationTruncated && <p role="alert">Some device reports exceed the bounded evidence sample. Missing reports must not be interpreted as no previous activity.</p>}
              <div className="data-table-shell" style={{ overflowX: "auto" }}><table><thead><tr><th scope="col">Device registration</th><th scope="col">Current target</th><th scope="col">Latest observed claim</th><th scope="col">Status</th></tr></thead><tbody>
                {reconciliation.map((entry) => <tr key={entry.registrationId}>
                  <td><strong>{entry.label || entry.registrationId.slice(0, 16)}</strong><small style={{ display: "block" }}>ID {entry.registrationId.slice(0, 16)} · user {entry.userId.slice(0, 12)} · seen {new Date(entry.lastSeenAt).toLocaleDateString()}</small></td>
                  <td>{entry.target ? `${entry.target.version} (${entry.target.selection === "device_pin" ? "pinned" : "rollout"})` : "None"}</td>
                  <td>{entry.latestObserved ? <>{entry.latestObserved.state.replace(/_/g, " ")}<small style={{ display: "block" }}>Release {entry.latestObserved.releaseId.slice(0, 12)} · {new Date(entry.latestObserved.lastReportedAt || entry.latestObserved.offeredAt).toLocaleString()}</small></> : "No sampled report"}</td>
                  <td>{reconciliationLabels[entry.status]}</td>
                </tr>)}
              </tbody></table></div>
              {!reconciliation.length && <p>No verified Desktop registrations on this page.</p>}
              {reconciliationCursor && <ClusterButton type="button" variant="quiet" disabled={reconciliationBusy} onClick={() => void loadReconciliation(reconciliationCursor)}>Load 50 more registrations</ClusterButton>}
            </>}
          </div>
          <ManagedPackageSeatRequirementPanel key={`seat-${selected.id}`} packageId={selected.id}/>
          <ManagedPackageEntitlementsPanel key={selected.id} packageId={selected.id}/>
          <ManagedPackageRecipientReadinessPanel key={`readiness-${selected.id}`} packageId={selected.id}/>
          <div className="settings-card-v092"><h3>Distribution audit</h3>
            <p>Server-side delivery evidence only. A download does not mean software was installed or executed successfully.</p>
            {auditError && <p role="alert">{auditError}</p>}
            {audit.map((event, index) => <p key={`${event.action}-${event.subjectId}-${event.createdAt}-${index}`}><strong>{event.action.replace(/_/g, " ")}</strong> · {new Date(event.createdAt).toLocaleString()} · <code>{event.subjectId.slice(0, 24)}</code>{event.details?.registrationId ? ` · device ${String(event.details.registrationId).slice(0, 16)}` : ""}</p>)}
            {!auditError && !audit.length && <p>No recorded Package changes or deliveries.</p>}
          </div>
          <div className="settings-card-v092"><h3>Device-reported deployment history</h3>
            <p>Offers and claims from authenticated device sessions. <strong>Not OS-attested installation proof.</strong> A content-selected report means the local stager selected verified bytes, not that a program was installed or executed. No activation or installation status is accepted until a native installer and trustworthy execution evidence exist.</p>
            {deploymentsError && <p role="alert">{deploymentsError}</p>}
            {deployments.map((entry) => <div key={entry.id} className="studio-explanation-v272">
              <strong>{entry.state.replace(/_/g, " ")}</strong> · <code>{entry.deviceRegistrationId.slice(0, 16)}</code> · release <code>{entry.releaseId.slice(0, 12)}</code>
              <p className="muted">Offered {new Date(entry.offeredAt).toLocaleString()} · {entry.reports.length} recorded transitions · report revision {entry.revision}</p>
              {entry.reports.slice(-3).map((report) => <p key={report.sequence} className="muted">{report.state.replace(/_/g, " ")} · {new Date(report.reportedAt).toLocaleString()} {report.detail ? `· ${report.detail}` : ""}</p>)}
            </div>)}
            {!deploymentsError && !deployments.length && <p>No device sessions have reported Package deployment activity.</p>}
          </div>
          <div className="settings-card-v092"><h3>Withdraw a compromised release</h3><p>This permanently blocks future downloads and pauses affected rollout targets. The artifact and its audit evidence remain stored.</p>
            <ClusterNativeSelect aria-label="Revoke release" value={revokeReleaseId} onChange={(e) => setRevokeReleaseId(e.target.value)}><option value="">Choose release</option>{selected.releases.filter((r) => !r.revokedAt).map((r) => <option key={r.id} value={r.id}>{r.version} · {r.platform}</option>)}</ClusterNativeSelect>
            <ClusterInput aria-label="Revocation reason" placeholder="Revocation reason" value={revocationReason} onChange={(e) => setRevocationReason(e.target.value)}/>
            <ClusterInput aria-label="Revocation confirmation" placeholder="Type REVOKE PACKAGE RELEASE" value={revocationConfirmation} onChange={(e) => setRevocationConfirmation(e.target.value)}/>
            <ClusterButton type="button" variant="danger" disabled={busy || !revokeReleaseId || revocationReason.trim().length < 8 || revocationConfirmation !== "REVOKE PACKAGE RELEASE"} onClick={() => void mutate(async () => { await api(`/api/admin/packages/${encodeURIComponent(selected.id)}/releases/${encodeURIComponent(revokeReleaseId)}/revoke`, { method: "POST", headers: { "X-Cluster-Confirmation": revocationConfirmation }, body: JSON.stringify({ reason: revocationReason.trim() }) }); setRevokeReleaseId(""); setRevocationReason(""); setRevocationConfirmation(""); setMessage("Release revoked, affected rollouts paused."); })}>Revoke release</ClusterButton>
          </div>
        </>}
      </section>
    </div>}
  </div>;
}
