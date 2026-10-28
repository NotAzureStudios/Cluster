import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterIcon } from "../../components/ClusterIcon";

type Request = { id: string; operation: string; targetId: string; userId: string; quantity: number;
  expiresAt: string; status: string; reason: string; subjectLabel?: string; targetLabel?: string; requestedById: string; reviewedById?: string;
  reviewReason?: string; resultId?: string; requestedAt: string };

/** Requests do not confer privileges; the transactionally reviewed Inventory authority does. */
export function StudioInventoryApprovalPanel() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState("approved");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [custody, setCustody] = useState<Array<{ id: string; userId: string; assetId: string; quantity: number; asset: { title: string; kind: string } }> | null>(null);
  const [custodyTruncated, setCustodyTruncated] = useState(false);
  const [personId, setPersonId] = useState("");
  const [personOptions, setPersonOptions] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [personOptionsLoading, setPersonOptionsLoading] = useState(false);
  const personOptionsRequested = useRef(false);
  async function loadPersonOptions() {
    if (personOptionsRequested.current) return;
    personOptionsRequested.current = true;
    setPersonOptionsLoading(true);
    try {
      const result = await api<{ people: Array<{ id: string; displayName: string; username: string }> }>("/api/admin/inventory/access-requests/options");
      setPersonOptions(result.people || []);
    } catch (failure) {
      personOptionsRequested.current = false;
      setError(failure instanceof Error ? failure.message : "People lookup unavailable.");
    } finally { setPersonOptionsLoading(false); }
  }
  const [access, setAccess] = useState<{
    person: { displayName?: string; username: string }; eligible: boolean;
    allocations: Array<{ id: string; effectiveStatus: string; asset: { title: string; kind: string } }>;
    keys: Array<{ id: string; effectiveStatus: string; pool: { title: string } }>;
    packageEntitlements: Array<{ id: string; packageId: string }>;
    directProjectAllowRules: Array<{ id: string; targetId: string; level: string }>;
    truncated: Record<string, boolean>; note: string;
  } | null>(null);
  async function reload() {
    const result = await api<{ requests: Request[]; truncated: boolean }>("/api/admin/inventory/access-requests");
    setRequests(result.requests || []); setTruncated(Boolean(result.truncated)); setRequestsLoaded(true);
  }
  useEffect(() => { let active = true; void api<{ requests: Request[]; truncated: boolean }>("/api/admin/inventory/access-requests")
    .then((result) => { if (active) { setRequests(result.requests || []); setTruncated(Boolean(result.truncated)); setRequestsLoaded(true); } })
    .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Could not load Inventory access reviews."); });
    return () => { active = false; }; }, []);
  const selected = requests.find((row) => row.id === selectedId);
  async function review() {
    if (inFlight.current || !selected || selected.status !== "pending" || reason.trim().length < 8) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/admin/inventory/access-requests/${encodeURIComponent(selected.id)}/review`, { method: "POST", body: JSON.stringify({ decision, reason: reason.trim() }) });
      setSelectedId(""); setReason(""); await reload(); setMessage(`Inventory request ${decision}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Inventory decision failed. Refresh before trying again."); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <div className="inventory-review-workspace-v22">
    <header className="inventory-review-heading-v22"><div><ClusterIcon name="check" treatment="duotone" /><h3>Access reviews</h3><span>{requests.filter((item) => item.status === "pending").length} pending</span></div>
    <ClusterButton size="compact" type="button" disabled={busy} onClick={() => void reload().catch((failure) => setError(failure instanceof Error ? failure.message : "Refresh failed."))}><ClusterIcon name="refresh" /> Refresh</ClusterButton></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {truncated && <p role="status">Showing only the latest 100 requests. Older records remain in the database.</p>}
    <details className="inventory-review-disclosure-v22" aria-label="Person access audit" onToggle={(event) => { if (event.currentTarget.open) void loadPersonOptions(); }}>
      <summary><ClusterIcon name="users" /> Person access <ClusterIcon name="chevron-down" /></summary><div className="inventory-review-disclosure-body-v22">
      <div className="field"><label>Person</label><ClusterNativeSelect value={personId} onChange={(event) => { setPersonId(event.target.value); setAccess(null); }} disabled={personOptionsLoading}>
        <option value="">{personOptionsLoading ? "Loading people…" : "Select person"}</option>
        {personOptions.map((person) => <option key={person.id} value={person.id}>{person.displayName || person.username}</option>)}
      </ClusterNativeSelect></div>
      <details className="inventory-review-advanced-v22"><summary>Use person ID</summary><ClusterInput value={personId} maxLength={160} onChange={(event) => { setPersonId(event.target.value); setAccess(null); }} placeholder="Person ID" /></details>
      <ClusterButton type="button" disabled={!personId.trim() || busy} onClick={() => void api<typeof access>(`/api/admin/inventory/person-access/${encodeURIComponent(personId.trim())}`)
        .then((result) => { setAccess(result); setError(""); })
        .catch((failure) => { setAccess(null); setError(failure instanceof Error ? failure.message : "Unable to inspect person access."); })}>Inspect person access</ClusterButton>
      {access && <div className="studio-explanation-v272">
        <strong>{access.person.displayName || access.person.username} · {access.eligible ? "Account eligible" : "Account not eligible"}</strong>
        <span>Digital/physical allocations: {access.allocations.length} · Assigned keys: {access.keys.length} · Package entitlements: {access.packageEntitlements.length} · Direct Project allow rules: {access.directProjectAllowRules.length}</span>
        {access.allocations.map((a) => <p key={a.id}>{a.asset.title} · {a.asset.kind} · {a.effectiveStatus}</p>)}
        {access.keys.map((k) => <p key={k.id}>{k.pool.title} · {k.effectiveStatus}</p>)}
        {access.packageEntitlements.map((p) => <p key={p.id}>Package entitlement · {p.packageId}</p>)}
        {access.directProjectAllowRules.map((r) => <p key={r.id}>Direct Project allow · {r.targetId} · {r.level}</p>)}
        {Object.values(access.truncated).some(Boolean) && <p role="status">One or more sections are incomplete due to listing limits.</p>}
        <small>{access.note}</small>
      </div>}
      </div></details>
    <details className="inventory-review-disclosure-v22" aria-label="Outstanding equipment custody">
      <summary><ClusterIcon name="archive" /> Outstanding custody <ClusterIcon name="chevron-down" /></summary><div className="inventory-review-disclosure-body-v22">
      <ClusterButton type="button" disabled={busy} onClick={() => void api<{ allocations: Array<{ id: string; userId: string; assetId: string; quantity: number; asset: { title: string; kind: string } }>; truncated: boolean }>("/api/admin/inventory/custody-outstanding")
        .then((result) => { setCustody(result.allocations); setCustodyTruncated(result.truncated); setError(""); })
        .catch((failure) => setError(failure instanceof Error ? failure.message : "Custody reconciliation unavailable."))}>Inspect outstanding custody</ClusterButton>
      {custody && <><p>{custody.length} open equipment allocation(s){custodyTruncated ? " (partial, first 100)" : ""}.</p>
        {custody.map((allocation) => <p key={allocation.id}>{allocation.asset.title} · {allocation.quantity} unit(s) · Person {allocation.userId} · Allocation {allocation.id.slice(0, 12)}</p>)}
      </>}
      </div></details>
    {requestsLoaded && !error && requests.length === 0 && <div className="inventory-review-empty-v22"><ClusterIcon name="check" treatment="duotone" /><strong>All caught up</strong><span>No access requests to review.</span></div>}
    {requests.map((item) => <article className="studio-explanation-v272" key={item.id}>
      <strong>{item.operation.replaceAll("_", " ")} · {item.status}</strong>
      <span>Recipient {item.subjectLabel || item.userId} · {item.targetLabel || item.targetId.slice(0, 12)} · {item.quantity} unit(s) · Until {new Date(item.expiresAt).toLocaleString()} · {item.reason}</span>
      {item.status === "pending" && <ClusterButton type="button" size="compact" disabled={busy} onClick={() => { setSelectedId(item.id === selectedId ? "" : item.id); setReason(""); }}>Review…</ClusterButton>}
      {item.status !== "pending" && <small>Decision: {item.reviewReason || "Recorded"}{item.resultId ? ` · Result ${item.resultId.slice(0, 12)}` : ""}</small>}
    </article>)}
    {selected?.status === "pending" && <section className="settings-card-v092" aria-label="Inventory request decision">
      <h4>Review {selected.operation.replaceAll("_", " ")}</h4>
      <p>{selected.reason}</p>
      <div className="field"><label>Decision</label><ClusterNativeSelect value={decision} onChange={(event) => setDecision(event.target.value)}><option value="approved">Approve</option><option value="rejected">Reject</option></ClusterNativeSelect></div>
      <div className="field"><label>Reason (minimum 8 characters)</label><ClusterInput maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></div>
      <ClusterButton type="button" variant="primary" disabled={busy || reason.trim().length < 8} onClick={() => void review()}>Submit reviewed decision</ClusterButton>
      <ClusterButton type="button" disabled={busy} onClick={() => setSelectedId("")}>Cancel</ClusterButton>
    </section>}
  </div>;
}
