import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type Reason = "account_unavailable" | "package_unavailable" | "entitlement_missing"
  | "entitlement_revoked" | "entitlement_expired" | "inventory_seat_missing"
  | "device_unverified" | "release_or_dependency_unavailable" | "ready_for_distribution";
type Inspection = { reason: Reason; asOf: string; canRequestDistribution: boolean;
  entitlement: { active: boolean; revision: number; expiresAt: string } | null;
  inventory: { required: boolean; assetTitle?: string | null; assetKind?: string | null; assetActive?: boolean };
  deviceVerified: boolean; target: { version: string; platform: string; channel: string; selection: string } | null;
  osAttested: false; installerExecutionAuthorized: false; secretMaterialIncluded: false };
const reasonLabel: Record<Reason, string> = {
  account_unavailable: "Recipient account is unavailable or expired",
  package_unavailable: "Package is unavailable or archived",
  entitlement_missing: "No independently approved Package entitlement",
  entitlement_revoked: "Package entitlement was revoked",
  entitlement_expired: "Package entitlement expired",
  inventory_seat_missing: "Required Inventory digital/license seat is missing, expired, or retired",
  device_unverified: "Recipient does not own this currently verified Desktop registration",
  release_or_dependency_unavailable: "No currently trusted, complete release target and dependency chain",
  ready_for_distribution: "Recipient is eligible to request the currently selected signed Package",
};

/** Administrative inspection only: does not mint a grant or download a ZIP. */
export function ManagedPackageRecipientReadinessPanel({ packageId }: { packageId: string }) {
  const [userId, setUserId] = useState("");
  const [deviceRegistrationId, setDeviceRegistrationId] = useState("");
  const [channel, setChannel] = useState<"stable"|"beta"|"testing">("stable");
  const [platform, setPlatform] = useState<"windows-x64"|"linux-x64"|"macos-arm64">("windows-x64");
  const [result, setResult] = useState<Inspection|null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(()=>{ sequence.current++; setResult(null); setError(""); setBusy(false); },[packageId]);
  const invalidate = () => { sequence.current++; setResult(null); setError(""); setBusy(false); };
  async function inspect() {
    if (busy || !userId.trim() || !deviceRegistrationId.trim()) return;
    const id = ++sequence.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await api<{ inspection: Inspection }>(`/api/admin/packages/${encodeURIComponent(packageId)}/recipient-readiness/inspect`, {
        method: "POST", body: JSON.stringify({userId:userId.trim(),deviceRegistrationId:deviceRegistrationId.trim(),channel,platform}),
      });
      if (id === sequence.current) setResult(response.inspection);
    } catch (cause) { if (id === sequence.current) setError(cause instanceof Error ? cause.message : "Readiness inspection failed"); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  return <section className="settings-card-v092" aria-label="Package recipient distribution readiness">
    <h3>Recipient distribution readiness</h3>
    <p>Inspect the effective access of one recipient and verified Desktop registration. Checks the Package grant, Inventory seat, signing trust, rollout/pin and dependencies. This is not an installer authorization or proof of installation.</p>
    <div className="settings-form-grid-v092">
      <ClusterInput aria-label="Readiness recipient user ID" value={userId} placeholder="Recipient user ID"
        onChange={(event)=>{setUserId(event.target.value);invalidate();}}/>
      <ClusterInput aria-label="Readiness Desktop registration ID" value={deviceRegistrationId} placeholder="Verified Desktop registration ID"
        onChange={(event)=>{setDeviceRegistrationId(event.target.value);invalidate();}}/>
      <ClusterNativeSelect aria-label="Readiness channel" value={channel} onChange={(event)=>{setChannel(event.target.value as typeof channel);invalidate();}}>
        <option value="stable">Stable</option><option value="beta">Beta</option><option value="testing">Testing</option>
      </ClusterNativeSelect>
      <ClusterNativeSelect aria-label="Readiness platform" value={platform} onChange={(event)=>{setPlatform(event.target.value as typeof platform);invalidate();}}>
        <option value="windows-x64">Windows x64</option><option value="linux-x64">Linux x64</option><option value="macos-arm64">macOS ARM</option>
      </ClusterNativeSelect>
      <ClusterButton type="button" variant="secondary" disabled={busy || !userId.trim() || !deviceRegistrationId.trim()} onClick={()=>void inspect()}>
        {busy ? "Inspecting…" : "Inspect effective eligibility"}
      </ClusterButton>
    </div>
    {error && <p role="alert">{error}</p>}
    {result && <div className="studio-explanation-v272" role="status">
      <strong>{reasonLabel[result.reason]}</strong>
      <p>Package grant: {result.entitlement ? result.entitlement.active ? "Active" : "Inactive" : "Missing"}
        {result.entitlement?.expiresAt ? ` · expires ${new Date(result.entitlement.expiresAt).toLocaleString()}` : ""}
        · Inventory seat: {result.inventory.required ? result.inventory.assetTitle || "Required" : "Not required"}
        · Device proof: {result.deviceVerified ? "Verified" : "Not verified"}</p>
      {result.target && <p>Current signed target: {result.target.version} · {result.target.platform} · {result.target.selection}</p>}
      <p className="muted">As of {new Date(result.asOf).toLocaleString()}. No bytes, deployment token, secret value or OS attestation provided. Eligibility may change immediately after this inspection.</p>
    </div>}
  </section>;
}
