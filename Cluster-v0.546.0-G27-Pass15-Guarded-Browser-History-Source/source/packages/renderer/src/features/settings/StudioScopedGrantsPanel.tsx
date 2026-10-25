import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";

type Person = { id: string; username: string; displayName?: string | null; profileRevision: number; accessExpiresAt?: string | null };
type Project = { id: string; name: string };
type Grant = { id: string; targetId: string; subjectId: string; level: string; expiresAt: string };
type Request = { id: string; userId: string; targetId: string; operation: string; accessRuleId?: string | null; level: string; expiresAt: string; status: string; reason: string; reviewReason?: string | null; requestedById: string; reviewedById?: string | null; requestedAt: string; reviewedAt?: string | null };
type Response = { people: Person[]; projects: Project[]; grants: Grant[]; requests: Request[]; truncated: Record<string, boolean> };
const readableDate = (s: string) => new Date(s).toLocaleString();
export function StudioScopedGrantsPanel() {
  const [result, setResult] = useState<Response>({ people: [], projects: [], grants: [], requests: [], truncated: {} });
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [operation, setOperation] = useState<"grant" | "extend">("grant");
  const [level, setLevel] = useState<"view" | "contribute" | "manage">("view");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function load(force = false) {
    setLoading(true);
    try {
      const data = await queryApi<Response>("/api/studio-systems/scoped-grants", { force, staleMs: 5_000, tags: ["people", "scoped-grants", "projects"] });
      setResult(data);
      setUserId((value) => data.people.some((person) => person.id === value) ? value : data.people[0]?.id || "");
      setProjectId((value) => data.projects.some((project) => project.id === value) ? value : data.projects[0]?.id || "");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load().catch((error) => setStatus(String(error))); }, []);
  const person = useMemo(() => result.people.find((row) => row.id === userId), [result.people, userId]);
  const matching = result.grants.filter((grant) => grant.targetId === projectId && grant.subjectId === userId);
  const existing = matching.length === 1 ? matching[0] : null;
  useEffect(() => { if (operation === "extend" && existing) setLevel(existing.level as "view" | "contribute" | "manage"); }, [operation, existing?.id, existing?.level]);
  async function run(action: () => Promise<unknown>, confirmation: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setStatus("");
    try { await action(); setStatus(confirmation); await load(true); }
    catch (error) { setStatus(`${error instanceof Error ? error.message : "Request failed."} Refresh before retrying an uncertain operation.`); }
    finally { locked.current = false; setBusy(false); }
  }
  function submit() {
    if (!person || !projectId || (operation === "extend" && !existing) || (operation === "grant" && matching.length)) return;
    const date = new Date(`${expiry}T23:59:59`);
    if (!expiry || !Number.isFinite(date.getTime()) || date <= new Date() || reason.trim().length < 12) { setStatus("Choose a future expiration and give a reason of at least 12 characters."); return; }
    if (person.accessExpiresAt && date > new Date(person.accessExpiresAt)) { setStatus("Resource access cannot extend beyond the account's expiration date."); return; }
    void run(() => api("/api/studio-systems/scoped-grants", { method: "POST", body: JSON.stringify({ userId, projectId, operation, accessRuleId: operation === "extend" ? existing?.id : undefined, level, expiresAt: date.toISOString(), expectedProfileRevision: person.profileRevision, reason: reason.trim() }) }), "Scoped grant request submitted for independent review. No access was changed yet.");
  }
  function review(request: Request, decision: "approved" | "rejected") {
    const reviewReason = String(reviews[request.id] || "").trim();
    if (reviewReason.length < 8) { setStatus("Enter a review reason of at least eight characters."); return; }
    void run(() => api(`/api/studio-systems/scoped-grants/${encodeURIComponent(request.id)}/review`, { method: "POST", body: JSON.stringify({ decision, reason: reviewReason }) }), `Project grant ${decision}.`);
  }
  return <div className="settings-stack-v092">
    <div className="settings-card-v092"><h3>Scoped Project grants</h3>
      <p>Request time-limited Project access for a person. A different Studio administrator must approve. Resource expiry is enforced by the Access Rule service even if reminder workers are offline. A grant expires independently, but inherited baseline access may remain. Tool ceilings and explicit deny rules still apply. This does not provision Inventory keys, Package licenses, or Library source access.</p>
      <ClusterButton variant="secondary" type="button" disabled={busy || loading} onClick={() => void load(true).catch((error) => setStatus(String(error)))}>Refresh grants</ClusterButton>
      {Object.values(result.truncated).some(Boolean) && <p role="status">One or more lists reached their safety limit. Narrow the studio scope or use dedicated management views before proceeding.</p>}
      {status && <p role="status">{status}</p>}
    </div>
    <div className="settings-card-v092"><h3>Request grant or extension</h3>
      <div className="field"><label>Project</label><ClusterNativeSelect value={projectId} disabled={busy} onChange={(event) => setProjectId(event.target.value)}><option value="">Select managed Project</option>{result.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</ClusterNativeSelect></div>
      <div className="field"><label>Recipient</label><ClusterNativeSelect value={userId} disabled={busy} onChange={(event) => setUserId(event.target.value)}><option value="">Select active member</option>{result.people.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username}</option>)}</ClusterNativeSelect></div>
      {person?.accessExpiresAt && <p className="muted">Account access ends {readableDate(person.accessExpiresAt)}.</p>}
      <div className="field"><label>Operation</label><ClusterNativeSelect disabled={busy} value={operation} onChange={(event) => setOperation(event.target.value as "grant" | "extend")}><option value="grant">New grant</option><option value="extend">Extend existing grant</option></ClusterNativeSelect></div>
      {operation === "extend" && <p>{existing ? `Current ${existing.level} grant expires ${readableDate(existing.expiresAt)}.` : "No single active time-limited grant is available to extend."}</p>}
      <div className="field"><label>Access level</label><ClusterNativeSelect disabled={busy || operation === "extend"} value={level} onChange={(event) => setLevel(event.target.value as "view" | "contribute" | "manage")}><option value="view">View</option><option value="contribute">Contribute</option><option value="manage">Manage</option></ClusterNativeSelect></div>
      <div className="field"><label>Grant expires (end of local day, maximum 180 days)</label><ClusterInput type="date" value={expiry} disabled={busy} onChange={(event) => setExpiry(event.target.value)} /></div>
      <div className="field"><label>Business justification</label><ClusterTextarea rows={3} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></div>
      <ClusterButton type="button" disabled={busy || loading || !person || !projectId || !expiry || reason.trim().length < 12 || (operation === "extend" ? !existing : matching.length > 0)} onClick={submit}>Submit for independent review</ClusterButton>
    </div>
    <div className="settings-card-v092"><h3>Pending decisions</h3>
      {result.requests.filter((request) => request.status === "pending").map((request) => <div key={request.id} className="settings-card-v092">
        <strong>{result.people.find((person) => person.id === request.userId)?.displayName || request.userId}</strong> · {result.projects.find((project) => project.id === request.targetId)?.name || request.targetId}
        <p>{request.operation} · {request.level} until {readableDate(request.expiresAt)}</p><p>Reason: {request.reason}</p>
        <div className="field"><label>Decision reason</label><ClusterTextarea rows={2} disabled={busy} value={reviews[request.id] || ""} onChange={(event) => setReviews((old) => ({ ...old, [request.id]: event.target.value }))} /></div>
        <div className="button-row"><ClusterButton type="button" disabled={busy || (reviews[request.id] || "").trim().length < 8} onClick={() => review(request, "approved")}>Approve grant</ClusterButton><ClusterButton type="button" variant="secondary" disabled={busy || (reviews[request.id] || "").trim().length < 8} onClick={() => review(request, "rejected")}>Reject</ClusterButton></div>
      </div>)}
      {!loading && !result.requests.some((request) => request.status === "pending") && <p>No pending scoped grants.</p>}
    </div>
    <div className="settings-card-v092"><h3>Recent decisions</h3>
      {result.requests.filter((request) => request.status !== "pending").slice(0, 30).map((request) => <p key={request.id}>{request.operation} · {request.level} · {request.status} · {readableDate(request.expiresAt)} · {request.reviewReason}</p>)}
    </div>
  </div>;
}
