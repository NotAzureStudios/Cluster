import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../core/api";
import { promptCluster } from "../../components/cluster-dialog-service";
import { ClusterButton } from "../../components/ClusterButton";

type PrivacyRequest = {
  id: string;
  requestType: string;
  status: string;
  note?: string | null;
  resolutionNote?: string | null;
  requestedAt: string;
  approvedAt?: string | null;
  fulfilledAt?: string | null;
  fulfillmentDigest?: string | null;
  user: { id: string; username: string; displayName?: string | null; email?: string | null; accountState?: string; archived?: boolean };
};
type ErasurePlan = {
  mode: string;
  planHash: string;
  blockers: Array<{ type: string; id: string; reason: string; authorityRef?: string | null }>;
  destructive: Record<string, number>;
  preserved: string[];
};
type LegalHold = {
  id: string;
  userId: string;
  reason: string;
  authorityRef?: string | null;
  status: string;
  createdAt: string;
  releasedAt?: string | null;
  user?: { id: string; username: string; displayName?: string | null; email?: string | null };
};

export function PrivacyRequestsAdminPanel() {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, ErasurePlan | null>>({});

  const load = useCallback(async () => {
    const suffix = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const [requestResult, holdResult] = await Promise.all([
      api<{ ok: true; requests: PrivacyRequest[] }>(`/api/admin/privacy/data-requests${suffix}`),
      api<{ ok: true; holds: LegalHold[] }>("/api/admin/privacy/legal-holds?status=active"),
    ]);
    setRequests(requestResult.requests || []);
    setHolds(holdResult.holds || []);
  }, [statusFilter]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Privacy requests could not be loaded.")); }, [load]);

  async function decide(request: PrivacyRequest, nextStatus: "approved" | "rejected") {
    const label = nextStatus === "approved" ? "approval" : "rejection";
    const resolutionNote = (await promptCluster({ title: `Record ${label}`, message: `Record the ${label} note for ${request.user.displayName || request.user.username}. This becomes part of the request evidence.`, label: "Evidence note", confirmLabel: nextStatus === "approved" ? "Approve request" : "Reject request" }))?.trim() || "";
    if (!resolutionNote) return;
    setBusyId(request.id);
    try {
      await api(`/api/admin/privacy/data-requests/${encodeURIComponent(request.id)}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, resolutionNote }) });
      setMessage(`Privacy request ${nextStatus}.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Privacy request could not be updated."); }
    finally { setBusyId(null); }
  }

  async function preview(request: PrivacyRequest) {
    setBusyId(request.id);
    try {
      const result = await api<{ ok: true; plan: ErasurePlan | null }>(`/api/admin/privacy/data-requests/${encodeURIComponent(request.id)}/erasure-plan`);
      setPlans((current) => ({ ...current, [request.id]: result.plan }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Erasure plan could not be generated."); }
    finally { setBusyId(null); }
  }

  async function fulfill(request: PrivacyRequest) {
    const plan = plans[request.id];
    if (!plan) { await preview(request); setMessage("Review the generated erasure plan before fulfillment."); return; }
    if (plan.blockers.length) { setMessage("Fulfillment is blocked by an active privacy legal hold."); return; }
    const confirmation = await promptCluster({ title: "Fulfill privacy erasure?", message: "This revokes access and pseudonymizes direct account data while preserving work, audit, policy-acceptance, and erasure evidence.", label: "Required confirmation", expectedValue: "FULFILL PRIVACY ERASURE", confirmLabel: "Fulfill erasure", tone: "danger" }) || "";
    if (confirmation !== "FULFILL PRIVACY ERASURE") { setMessage("Erasure fulfillment cancelled."); return; }
    setBusyId(request.id);
    try {
      const result = await api<{ ok: true; receipt: { evidenceHash: string } }>(`/api/admin/privacy/data-requests/${encodeURIComponent(request.id)}/fulfill`, { method: "POST", headers: { "X-Cluster-Confirmation": confirmation } });
      setMessage(`Privacy erasure fulfilled. Evidence ${result.receipt.evidenceHash.slice(0, 12)}…`);
      setPlans((current) => ({ ...current, [request.id]: null }));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Privacy erasure could not be fulfilled."); }
    finally { setBusyId(null); }
  }

  async function createHold(request: PrivacyRequest) {
    const reason = (await promptCluster({ title: "Create privacy legal hold", message: `Record the legal or preservation reason for ${request.user.displayName || request.user.username}.`, label: "Legal/preservation reason", confirmLabel: "Continue" }))?.trim() || "";
    if (!reason) return;
    const authorityRef = (await promptCluster({ title: "Legal hold reference", message: "Optionally record a matter, ticket, counsel, or authority reference.", label: "Reference", confirmLabel: "Continue" }))?.trim() || "";
    const confirmation = await promptCluster({ title: "Confirm privacy legal hold", message: "Creating this hold blocks erasure fulfillment for the account until the hold is explicitly released.", label: "Required confirmation", expectedValue: "CREATE PRIVACY LEGAL HOLD", confirmLabel: "Create legal hold", tone: "danger" }) || "";
    if (confirmation !== "CREATE PRIVACY LEGAL HOLD") return;
    setBusyId(request.id);
    try {
      await api(`/api/admin/privacy/users/${encodeURIComponent(request.user.id)}/legal-holds`, { method: "POST", headers: { "X-Cluster-Confirmation": confirmation }, body: JSON.stringify({ reason, authorityRef: authorityRef || undefined }) });
      setMessage("Privacy legal hold created. Erasure fulfillment is now fail-closed for this account.");
      await load();
      await preview(request);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Legal hold could not be created."); }
    finally { setBusyId(null); }
  }

  async function releaseHold(hold: LegalHold) {
    const releaseNote = (await promptCluster({ title: "Release privacy legal hold", message: "Record why this hold can be released. The note becomes part of the evidence trail.", label: "Release note", confirmLabel: "Continue" }))?.trim() || "";
    if (!releaseNote) return;
    const confirmation = await promptCluster({ title: "Confirm legal hold release", message: "Releasing this hold may allow an approved privacy erasure to proceed.", label: "Required confirmation", expectedValue: "RELEASE PRIVACY LEGAL HOLD", confirmLabel: "Release hold", tone: "danger" }) || "";
    if (confirmation !== "RELEASE PRIVACY LEGAL HOLD") return;
    setBusyId(hold.id);
    try {
      await api(`/api/admin/privacy/legal-holds/${encodeURIComponent(hold.id)}/release`, { method: "PATCH", headers: { "X-Cluster-Confirmation": confirmation }, body: JSON.stringify({ releaseNote }) });
      setMessage("Privacy legal hold released with evidence note.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Legal hold could not be released."); }
    finally { setBusyId(null); }
  }

  return <div className="settings-section-v092 studio-settings-section-v272 privacy-requests-admin-v376 privacy-erasure-admin-v380">
    <div className="settings-panel-head-v092 studio-section-intro-v272">
      <div><p className="eyebrow">Privacy operations</p><h2>Data requests & erasure</h2><p className="muted tight">Review first, approve explicitly, preview the destructive plan, then fulfill. Legal holds block execution and Cluster pseudonymizes the account instead of breaking historical work references.</p></div>
      <ClusterNativeSelect aria-label="Privacy request status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="fulfilled">Fulfilled</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All</option>
      </ClusterNativeSelect>
    </div>
    {message && <div className="legal-compliance-message-v376" role="status">{message}</div>}
    <div className="legal-request-list-v376">
      {requests.map((request) => {
        const plan = plans[request.id];
        const activeHolds = holds.filter((hold) => hold.userId === request.user.id);
        return <article className="settings-card-v092" key={request.id}>
          <div className="legal-request-head-v376"><div><strong>{request.user.displayName || request.user.username}</strong><span>{request.user.email || request.user.username}</span></div><span className={`legal-state-pill-v376 ${request.status}`}>{request.status}</span></div>
          <div className="legal-request-meta-v376"><span>{request.requestType}</span><span>{new Date(request.requestedAt).toLocaleString()}</span>{activeHolds.length > 0 && <span>{activeHolds.length} active legal hold{activeHolds.length === 1 ? "" : "s"}</span>}</div>
          {request.note && <p>{request.note}</p>}
          {request.resolutionNote && <div className="legal-compliance-note-v376"><strong>Review record</strong><span>{request.resolutionNote}</span></div>}
          {request.fulfillmentDigest && <div className="legal-compliance-note-v376"><strong>Erasure evidence</strong><span>{request.fulfillmentDigest}</span></div>}
          {request.status === "pending" && <div className="legal-request-actions-v376"><ClusterButton type="button" className="" disabled={busyId === request.id} onClick={() => void decide(request, "rejected")} variant="secondary">Reject</ClusterButton><ClusterButton type="button" className="" disabled={busyId === request.id} onClick={() => void decide(request, "approved")} variant="primary">Approve erasure</ClusterButton></div>}
          {request.status === "approved" && <div className="legal-request-actions-v376"><ClusterButton type="button" className="" disabled={busyId === request.id} onClick={() => void createHold(request)} variant="secondary">Create legal hold</ClusterButton><ClusterButton type="button" className="" disabled={busyId === request.id} onClick={() => void preview(request)} variant="secondary">Preview erasure</ClusterButton><ClusterButton type="button" className="" disabled={busyId === request.id || Boolean(plan?.blockers.length)} onClick={() => void fulfill(request)} variant="danger">Fulfill erasure</ClusterButton></div>}
          {plan && <div className="legal-compliance-note-v376 privacy-erasure-plan-v380"><strong>Erasure plan · {plan.mode}</strong><span>Plan hash {plan.planHash}</span><span>Delete: {Object.entries(plan.destructive).map(([key, count]) => `${key} ${count}`).join(" · ")}</span><span>Preserve: {plan.preserved.join(" · ")}</span>{plan.blockers.map((blocker) => <span key={blocker.id}>BLOCKED: {blocker.reason}{blocker.authorityRef ? ` · ${blocker.authorityRef}` : ""}</span>)}</div>}
        </article>;
      })}
      {!requests.length && <div className="empty-state compact-empty">No {statusFilter || "matching"} privacy requests.</div>}
    </div>
    <div className="settings-card-v092 privacy-legal-holds-v380">
      <div className="settings-card-head-v092"><h3>Active privacy legal holds</h3><span>{holds.length}</span></div>
      <p className="muted">Holds are manual preservation controls. They never expire themselves and must be explicitly released with a recorded reason.</p>
      {holds.map((hold) => <div className="legal-compliance-note-v376" key={hold.id}><strong>{hold.user?.displayName || hold.user?.username || hold.userId}</strong><span>{hold.reason}</span>{hold.authorityRef && <span>{hold.authorityRef}</span>}<span>{new Date(hold.createdAt).toLocaleString()}</span><ClusterButton type="button" className="" disabled={busyId === hold.id} onClick={() => void releaseHold(hold)} variant="secondary">Release hold</ClusterButton></div>)}
      {!holds.length && <div className="empty-state compact-empty">No active privacy legal holds.</div>}
    </div>
  </div>;
}
