import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";

type Subject = { id: string; username: string; displayName?: string | null; accountType: string; accountState: string; accessExpiresAt: string; profileRevision: number };
type Renewal = { id: string; userId: string; subject?: Subject | null; status: string; requestedById: string; reviewedById?: string | null; previousExpiresAt: string; requestedExpiresAt: string; expectedProfileRevision: number; reason: string; reviewReason?: string | null; requestedAt: string; reviewedAt?: string | null; personnelRecordId?: string | null };
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not set";

export function StudioAccessRenewalsPanel() {
  const [requests, setRequests] = useState<Renewal[]>([]);
  const [expiring, setExpiring] = useState<Subject[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [previousPages, setPreviousPages] = useState<Array<string | null>>([]);
  const [userId, setUserId] = useState("");
  const [expiresDate, setExpiresDate] = useState("");
  const [reason, setReason] = useState("");
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function load(force = false, search = appliedSearch, after = cursor) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (after) params.set("cursor", after);
      const url = `/api/studio-systems/access-renewals${params.size ? `?${params.toString()}` : ""}`;
      const result = await queryApi<{ requests: Renewal[]; expiring: Subject[]; nextCursor: string | null }>(url, { force, staleMs: 5_000, tags: ["people", "access-renewals"] });
      setRequests(result.requests || []); setExpiring(result.expiring || []);
      setNextCursor(result.nextCursor || null);
      setUserId((id) => (result.expiring || []).some((u) => u.id === id) ? id : (result.expiring || [])[0]?.id || "");
    } finally { setLoading(false); }
  }
  async function changePage(next: string | null, back: Array<string | null>) {
    setCursor(next); setPreviousPages(back);
    try { await load(true, appliedSearch, next); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Unable to load accounts."); }
  }
  function applySearch() {
    const search = searchInput.trim();
    setAppliedSearch(search); setCursor(null); setPreviousPages([]);
    void load(true, search, null).catch((error) => setStatus(error instanceof Error ? error.message : "Search failed."));
  }
  useEffect(() => { void load().catch((error) => setStatus(error instanceof Error ? error.message : "Access data unavailable.")); }, []);
  const current = useMemo(() => expiring.find((user) => user.id === userId), [expiring, userId]);
  async function run<T>(action: () => Promise<T>, done: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setStatus("");
    try {
      await action();
      // A write with an ambiguous response must be reconciled, not blindly replayed.
      setStatus(done); await load(true);
    } catch (error) { setStatus((error instanceof Error ? error.message : "Operation failed.") + " Refresh before retrying an uncertain write."); }
    finally { locked.current = false; setBusy(false); }
  }
  function requestRenewal() {
    if (!current || !expiresDate.trim() || reason.trim().length < 12) { setStatus("Select a person, a new expiry and a reason of at least 12 characters."); return; }
    const proposed = new Date(`${expiresDate}T23:59:59`);
    if (!Number.isFinite(proposed.getTime()) || proposed <= new Date(current.accessExpiresAt) || proposed <= new Date()) { setStatus("The new date must extend current access into the future."); return; }
    void run(() => api("/api/studio-systems/access-renewals", { method: "POST", body: JSON.stringify({ userId: current.id, expectedProfileRevision: current.profileRevision, requestedExpiresAt: proposed.toISOString(), reason: reason.trim() }) }), "Renewal submitted for another administrator to review.");
  }
  function review(row: Renewal, decision: "approved" | "rejected") {
    const reviewReason = String(reviewReasons[row.id] || "").trim();
    if (reviewReason.length < 8) { setStatus("Provide a review reason of at least eight characters."); return; }
    void run(() => api(`/api/studio-systems/access-renewals/${encodeURIComponent(row.id)}/review`, { method: "POST", body: JSON.stringify({ decision, reason: reviewReason }) }), `Access renewal ${decision}. Existing permissions and entitlements were not changed.`);
  }
  return <div className="settings-stack-v092">
    <div className="settings-card-v092"><h3>Access renewals</h3><p>Expiring access is denied immediately by authorization. Renewal requires a request and approval from a different administrator. A renewal does not recreate old credentials, roles, Project grants, or inventory entitlements.</p>
      <ClusterButton variant="secondary" type="button" disabled={busy || loading} onClick={() => void load(true).catch((error) => setStatus(String(error)))}>Refresh access and decisions</ClusterButton>
      {status && <p role="status">{status}</p>}
    </div>
    <div className="settings-card-v092"><h3>Request extension</h3><p>Showing 50 accounts per page that have expired or will expire within 30 days. Search across all matching accounts, including those beyond the first page. Archived and disabled identities use their separate lifecycle.</p>
      <div className="field"><label htmlFor="access-renewal-search">Find an account</label><ClusterInput id="access-renewal-search" value={searchInput} disabled={busy || loading} onChange={(event) => setSearchInput(event.target.value)} placeholder="Username or display name" onKeyDown={(event) => { if (event.key === "Enter") applySearch(); }} /></div>
      <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={busy || loading} onClick={applySearch}>Search accounts</ClusterButton><ClusterButton type="button" variant="secondary" disabled={busy || loading || (!searchInput && !appliedSearch)} onClick={() => { setSearchInput(""); setAppliedSearch(""); setCursor(null); setPreviousPages([]); void load(true, "", null).catch((error) => setStatus(String(error))); }}>Clear search</ClusterButton></div>
      <div className="field"><label>Person</label><ClusterNativeSelect value={userId} disabled={busy || loading} onChange={(event) => setUserId(event.target.value)}><option value="">Select account</option>{expiring.map((user) => <option key={user.id} value={user.id}>{user.displayName || user.username} · {formatDate(user.accessExpiresAt)}</option>)}</ClusterNativeSelect></div>
      <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={busy || loading || !previousPages.length} onClick={() => { const back = previousPages.slice(0, -1); void changePage(previousPages[previousPages.length - 1], back); }}>Previous accounts</ClusterButton><ClusterButton type="button" variant="secondary" disabled={busy || loading || !nextCursor} onClick={() => { if (nextCursor) void changePage(nextCursor, [...previousPages, cursor]); }}>Next accounts</ClusterButton></div>
      {current && <p className="muted">{current.accountType} · {current.accountState} · current expiry {formatDate(current.accessExpiresAt)}</p>}
      <div className="field"><label>New expiry date (end of your local day)</label><ClusterInput type="date" value={expiresDate} disabled={busy} onChange={(event) => setExpiresDate(event.target.value)} /></div>
      <div className="field"><label>Business reason</label><ClusterTextarea value={reason} disabled={busy} rows={3} onChange={(event) => setReason(event.target.value)} placeholder="Why does this access need to continue?" /></div>
      <ClusterButton type="button" disabled={!current || busy || reason.trim().length < 12 || !expiresDate} onClick={requestRenewal}>Request access renewal</ClusterButton>
    </div>
    <div className="settings-card-v092"><h3>Review queue</h3><p>Approval requires a different authorized person. Changed profile revisions or expiry windows invalidate stale requests. Offboarding closes pending reviews and resolves their actions.</p>
      {requests.filter((row) => row.status === "pending").map((row) => <div key={row.id} className="settings-card-v092">
        <strong>{row.subject?.displayName || row.userId}</strong><p>Current: {formatDate(row.previousExpiresAt)} · Proposed: {formatDate(row.requestedExpiresAt)}</p>
        <p>Request: {row.reason}</p>
        <div className="field"><label>Review reason</label><ClusterTextarea value={reviewReasons[row.id] || ""} rows={2} disabled={busy} onChange={(event) => setReviewReasons((old) => ({ ...old, [row.id]: event.target.value }))} /></div>
        <div className="button-row"><ClusterButton type="button" disabled={busy || (reviewReasons[row.id] || "").trim().length < 8} onClick={() => review(row, "approved")}>Approve extension</ClusterButton><ClusterButton variant="secondary" type="button" disabled={busy || (reviewReasons[row.id] || "").trim().length < 8} onClick={() => review(row, "rejected")}>Reject request</ClusterButton></div>
      </div>)}
      {!loading && !requests.some((row) => row.status === "pending") && <p>No outstanding access-renewal requests.</p>}
    </div>
    <div className="settings-card-v092"><h3>Recent decisions</h3>{requests.filter((row) => row.status !== "pending").slice(0, 30).map((row) => <p key={row.id}><strong>{row.subject?.displayName || row.userId}</strong> · {row.status} · {formatDate(row.reviewedAt)} · {row.reviewReason}</p>)}
    </div>
  </div>;
}
