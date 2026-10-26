import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type Requirement = { packageId: string; assetId: string; revision: number; reason: string;
  createdAt: string; asset: { title: string; kind: string; status: string } };
type Impact = { asset: { id: string; title: string; kind: string };
  activeGrants: number; alreadyCovered: number; accessWouldPause: number;
  fingerprint: string; existingPackageGrantsRemainUnchanged: true; secretsIncluded: false };

/** Seat custody is a separate Inventory authority. Binding only ever narrows
 * package distribution, and never reveals a license key or Vault secret. */
export function ManagedPackageSeatRequirementPanel({ packageId }: { packageId: string }) {
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [assets, setAssets] = useState<Array<{ id: string; title: string; kind: string; status: string }>>([]);
  const [assetSearchBusy, setAssetSearchBusy] = useState(false);
  const generation = useRef(0);
  const [assetId, setAssetId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true; generation.current++; setLoaded(false); setRequirement(null); setPreview(null); setError("");
    void api<{ requirement: Requirement | null }>(`/api/admin/packages/${encodeURIComponent(packageId)}/seat-requirement`)
      .then((response) => { if (active) setRequirement(response.requirement || null); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Seat requirement unavailable"); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [packageId]);
  async function findAssets() {
    if (assetSearchBusy) return;
    const check = ++generation.current; setAssetSearchBusy(true); setError("");
    try {
      const result = await api<{ assets: Array<{ id: string; title: string; kind: string; status: string }>; nextCursor: string | null }>(
        `/api/admin/inventory/assets?q=${encodeURIComponent(assetSearch.trim())}`);
      if (check === generation.current) setAssets((result.assets || []).filter((asset) => asset.status === "active"
        && ["digital", "license"].includes(asset.kind)));
    } catch (cause) { if (check === generation.current) setError(cause instanceof Error ? cause.message : "Inventory search unavailable"); }
    finally { if (check === generation.current) setAssetSearchBusy(false); }
  }
  async function inspect() {
    if (!assetId.trim() || busy) return;
    const inspectedId = assetId.trim(), check = ++generation.current; setBusy(true); setError(""); setPreview(null); setNotice("");
    try {
      const result = await api<{ impact: Impact }>(`/api/admin/packages/${encodeURIComponent(packageId)}/seat-requirement/preview`, {
        method: "POST", body: JSON.stringify({ assetId: inspectedId }),
      });
      if (check === generation.current) setPreview(result.impact);
    } catch (cause) { if (check === generation.current) setError(cause instanceof Error ? cause.message : "Cannot inspect Inventory coverage"); }
    finally { if (check === generation.current) setBusy(false); }
  }
  async function bind() {
    if (!preview || preview.asset.id !== assetId.trim() || reason.trim().length < 12
      || confirmation !== "REQUIRE INVENTORY SEAT" || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/admin/packages/${encodeURIComponent(packageId)}/seat-requirement`, {
        method: "POST", headers: { "X-Cluster-Confirmation": confirmation },
        body: JSON.stringify({ assetId: preview.asset.id, expectedFingerprint: preview.fingerprint, reason: reason.trim() }),
      });
      const current = await api<{ requirement: Requirement | null }>(`/api/admin/packages/${encodeURIComponent(packageId)}/seat-requirement`);
      setRequirement(current.requirement || null); setPreview(null); setConfirmation("");
      setNotice("Inventory seat requirement bound. Recipients without a current valid seat no longer receive this Package target.");
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Seat binding failed; inspect coverage again");
    } finally { setBusy(false); }
  }
  return <section className="settings-card-v092" aria-label="Package Inventory seat policy">
    <h3>Inventory seat requirement</h3>
    <p>Optionally require an active digital or license Inventory allocation <strong>in addition to</strong> an approved Package entitlement. Revoked, expired or retired seats immediately block new device targets, downloads and deployment grants. No license key or Vault secret is transferred.</p>
    {!loaded && <p role="status">Loading Inventory policy…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {requirement ? <div className="studio-explanation-v272">
      <strong>{requirement.asset.title}</strong> · {requirement.asset.kind} · {requirement.asset.status}
      <p className="muted">Inventory asset ID <code>{requirement.assetId}</code> · Rule revision {requirement.revision} · Bound {new Date(requirement.createdAt).toLocaleString()}</p>
      <p>Reason: {requirement.reason}</p>
      <p className="muted">Removing or replacing this restriction requires a separately reviewed policy workflow. This control cannot silently downgrade access.</p>
    </div> : loaded && <>
      <ClusterInput aria-label="Search Inventory assets" placeholder="Search active digital/license assets" value={assetSearch}
        onChange={(event) => { setAssetSearch(event.target.value); generation.current++; setAssets([]); }}/>
      <ClusterButton type="button" variant="quiet" disabled={assetSearchBusy} onClick={() => void findAssets()}>
        {assetSearchBusy ? "Searching…" : "Find eligible Inventory assets"}
      </ClusterButton>
      {assets.length > 0 && <ClusterNativeSelect aria-label="Choose eligible Inventory asset" value={assetId}
        onChange={(event) => { generation.current++; setAssetId(event.target.value); setPreview(null); setConfirmation(""); }}>
        <option value="">Choose active digital/license asset</option>
        {assets.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.kind} · {item.id.slice(0, 10)}</option>)}
      </ClusterNativeSelect>}
      <ClusterInput aria-label="Required Inventory asset ID" placeholder="Or enter the Inventory asset ID" value={assetId}
        onChange={(event) => { generation.current++; setAssetId(event.target.value); setPreview(null); setConfirmation(""); }}/>
      <p className="muted">Search uses the existing paged Inventory catalogue and only lists eligible types in the current results. Enter an exact asset ID if it is not listed.</p>
      <ClusterButton type="button" variant="secondary" disabled={busy || !assetId.trim()} onClick={() => void inspect()}>
        {busy ? "Checking…" : "Preview recipient impact"}
      </ClusterButton>
      {preview && <div className="studio-explanation-v272" role="status">
        <strong>{preview.asset.title}</strong> · {preview.asset.kind}
        <p>Unrevoked, unexpired Package grants: {preview.activeGrants} · Grants with matching seats: {preview.alreadyCovered} · <strong>{preview.accessWouldPause} grants currently lack a matching seat</strong></p>
        <p className="muted">The preview may become stale; Cluster rechecks its fingerprint in the commit transaction. Package grants remain recorded, but cannot bypass Inventory custody.</p>
        <ClusterInput aria-label="Inventory seat policy reason" placeholder="Reason for requiring Inventory seats (minimum 12 characters)"
          value={reason} onChange={(event) => setReason(event.target.value)}/>
        <ClusterInput aria-label="Inventory seat policy confirmation" placeholder="Type REQUIRE INVENTORY SEAT"
          value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/>
        <ClusterButton type="button" variant="secondary"
          disabled={busy || reason.trim().length < 12 || confirmation !== "REQUIRE INVENTORY SEAT"}
          onClick={() => void bind()}>Confirm seat restriction</ClusterButton>
      </div>}
      <p className="muted">Binding is one-way in this version. Manage individual Inventory allocations in Inventory, with its existing independent issuance approvals. Do not paste license keys or secrets here.</p>
    </>}
  </section>;
}
