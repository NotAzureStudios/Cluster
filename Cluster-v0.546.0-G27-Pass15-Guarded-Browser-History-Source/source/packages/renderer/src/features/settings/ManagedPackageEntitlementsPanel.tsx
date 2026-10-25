import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";

type Entitlement = { id: string; userId: string; expiresAt: string; revokedAt: string | null;
  revision: number; approvedById: string; revokedReason: string | null };
type Request = { id: string; userId: string; requestedById: string; action: "grant" | "extend";
  expiresAt: string; reason: string; status: string; createdAt: string; reviewReason: string | null };
type Data = { entitlements: Entitlement[]; requests: Request[]; limit: number };

/** Package grants never imply Inventory allocations, source Library access or OS installs. */
export function ManagedPackageEntitlementsPanel({ packageId }: { packageId: string }) {
  const [data, setData] = useState<Data>({ entitlements: [], requests: [], limit: 200 });
  const [userId, setUserId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [revocationReasons, setRevocationReasons] = useState<Record<string, string>>({});
  const [revocationConfirmations, setRevocationConfirmations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    setData({ entitlements: [], requests: [], limit: 200 }); setError("");
    void api<Data>(`/api/admin/packages/${encodeURIComponent(packageId)}/entitlements`)
      .then((response) => { if (active) setData(response); })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Entitlement data unavailable"); });
    return () => { active = false; };
  }, [packageId, refreshKey]);
  async function submit(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(message); setRefreshKey((key) => key + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Package entitlement action failed"); }
    finally { setBusy(false); }
  }
  const existing = data.entitlements.find((item) => item.userId === userId.trim());
  const canExtend = Boolean(existing && !existing.revokedAt && new Date(existing.expiresAt).getTime() > Date.now());
  const pending = data.requests.filter((item) => item.status === "pending");
  return <section className="settings-card-v092" aria-label="Package recipient entitlements">
    <h3>Recipient entitlements</h3>
    <p>Signed releases and device pins never grant people access by themselves. A recipient must have a reviewed, unexpired Package entitlement. Inventory seats and game keys are administered separately.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="settings-form-grid-v092">
      <ClusterInput aria-label="Recipient user ID" placeholder="Recipient user ID" value={userId} onChange={(event) => setUserId(event.target.value)}/>
      <ClusterInput aria-label="Expiration date and time" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)}/>
      <ClusterInput aria-label="Grant justification" placeholder="Justification for reviewer (minimum 8 characters)" value={reason} onChange={(event) => setReason(event.target.value)}/>
      <ClusterButton type="button" variant="secondary" disabled={busy || !userId.trim() || !expiresAt || reason.trim().length < 8}
        onClick={() => void submit(async () => {
          await api(`/api/admin/packages/${encodeURIComponent(packageId)}/entitlement-requests`, {
            method: "POST", body: JSON.stringify({ userId: userId.trim(), action: canExtend ? "extend" : "grant",
              expiresAt: new Date(expiresAt).toISOString(), reason: reason.trim(), expectedRevision: existing?.revision || 0 }),
          }); setReason("");
        }, "Request submitted. No access is active until an independent administrator approves it.")}>{canExtend ? "Request extension" : "Request grant"}</ClusterButton>
    </div>
    <h4>Pending review ({pending.length})</h4>
    {pending.map((item) => <div key={item.id} className="studio-explanation-v272">
      <strong>{item.action === "extend" ? "Extend" : "Grant"} · {item.userId}</strong>
      <p className="muted">Expires {new Date(item.expiresAt).toLocaleString()} · Requested by {item.requestedById} · {item.reason}</p>
      <ClusterInput aria-label={`Review justification for ${item.userId}`} placeholder="Decision reason (minimum 8 characters)"
        value={decisionReasons[item.id] || ""} onChange={(event) => setDecisionReasons((state) => ({ ...state, [item.id]: event.target.value }))}/>
      <ClusterButton type="button" variant="secondary" disabled={busy || (decisionReasons[item.id] || "").trim().length < 8}
        onClick={() => void submit(() => api(`/api/admin/packages/${encodeURIComponent(packageId)}/entitlement-requests/${encodeURIComponent(item.id)}/review`, {
          method: "POST", body: JSON.stringify({ decision: "approved", reason: decisionReasons[item.id].trim() }),
        }), "Entitlement review approved.")}>Approve</ClusterButton>{" "}
      <ClusterButton type="button" variant="secondary" disabled={busy || (decisionReasons[item.id] || "").trim().length < 8}
        onClick={() => void submit(() => api(`/api/admin/packages/${encodeURIComponent(packageId)}/entitlement-requests/${encodeURIComponent(item.id)}/review`, {
          method: "POST", body: JSON.stringify({ decision: "rejected", reason: decisionReasons[item.id].trim() }),
        }), "Entitlement request rejected.")}>Reject</ClusterButton>
    </div>)}
    {!pending.length && <p>No pending recipient reviews.</p>}
    <h4>Recorded recipient grants</h4>
    {data.entitlements.map((item) => {
      const expired = new Date(item.expiresAt) <= new Date();
      return <div key={item.id} className="studio-explanation-v272">
        <strong>{item.userId}</strong> · {item.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}
        <p className="muted">Expires {new Date(item.expiresAt).toLocaleString()} · Revision {item.revision} · Approved by {item.approvedById}</p>
        {!item.revokedAt && !expired && <div>
          <ClusterInput aria-label={`Revocation reason for ${item.userId}`} placeholder="Revocation reason"
            value={revocationReasons[item.id] || ""}
            onChange={(event) => setRevocationReasons((state) => ({ ...state, [item.id]: event.target.value }))}/>
          <ClusterInput aria-label={`Revocation confirmation for ${item.userId}`} placeholder="Type REVOKE PACKAGE ACCESS"
            value={revocationConfirmations[item.id] || ""}
            onChange={(event) => setRevocationConfirmations((state) => ({ ...state, [item.id]: event.target.value }))}/>
          <ClusterButton type="button" variant="danger" disabled={busy || (revocationReasons[item.id] || "").trim().length < 8
            || revocationConfirmations[item.id] !== "REVOKE PACKAGE ACCESS"}
            onClick={() => void submit(() => api(`/api/admin/packages/${encodeURIComponent(packageId)}/entitlements/${encodeURIComponent(item.id)}/revoke`, {
              method: "POST", headers: { "X-Cluster-Confirmation": "REVOKE PACKAGE ACCESS" },
              body: JSON.stringify({ expectedRevision: item.revision, reason: revocationReasons[item.id].trim() }),
            }), "Recipient entitlement revoked.")}>Revoke access</ClusterButton>
        </div>}
      </div>;
    })}
    {!data.entitlements.length && <p>No approved entitlements. Rollouts and pins alone will not expose these Packages.</p>}
    <p className="muted">Showing up to {data.limit} records per list. Expiry and revocation are enforced when targets are requested, including download and content authorization.</p>
  </section>;
}
