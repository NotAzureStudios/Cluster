import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";

type Person = { id: string; label: string; detail?: string };
type Reviewer = { id: string; userId: string; user: { id: string; username: string; displayName?: string }; status: string; revision: number };

// Scoped capability management, not a replacement for Studio Settings roles.
export function StudioFormReviewersPanel({ formId }: { formId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [rows, setRows] = useState<Reviewer[]>([]);
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selectedLookup, setSelectedLookup] = useState<Reviewer | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const requests = useRef(0);
  const lock = useRef(false);
  async function refresh(next = 1, append = false) {
    const serial = ++requests.current;
    try {
      const data = await queryApi<{ reviewers: Reviewer[]; hasMore: boolean }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/reviewers?page=${next}&limit=25`, { force: true, tags: ["studio-systems", "forms"] });
      if (serial !== requests.current) return;
      setRows((previous) => append ? [...previous, ...data.reviewers.filter((row) => !previous.some((old) => old.id === row.id))] : data.reviewers);
      setPage(next); setHasMore(data.hasMore); setError("");
    } catch (cause) { if (serial === requests.current) setError(cause instanceof Error ? cause.message : "Could not load reviewers."); }
  }
  useEffect(() => {
    let live = true;
    setRows([]); setPersonId(""); setSelectedLookup(null); setSelectedRevision(null); void refresh();
    void queryApi<{ users: Person[] }>("/api/studio-audience/options", { force: true, tags: ["people", "studio-audience"] })
      .then((data) => { if (live) setPeople(data.users || []); })
      .catch(() => { if (live) setError("Could not load people."); });
    return () => { live = false; requests.current++; };
  }, [formId]);
  const selected = selectedLookup?.userId === personId ? selectedLookup : rows.find((row) => row.userId === personId);
  async function choose(id: string) {
    const serial = ++requests.current;
    setPersonId(id); setSelectedLookup(null); setSelectedRevision(null); setChecking(Boolean(id));
    if (!id) { setChecking(false); return; }
    try {
      // Reviewers can live on another page; do not submit revision zero blindly.
      const records = await queryApi<{ reviewers: Reviewer[] }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/reviewers?page=1&limit=50&userId=${encodeURIComponent(id)}`, { force: true, tags: ["studio-systems", "forms"] });
      if (serial === requests.current) { const current = records.reviewers.find((row) => row.userId === id) || null; setSelectedLookup(current); setSelectedRevision(current?.revision || 0); }
    } catch (cause) { if (serial === requests.current) setError(cause instanceof Error ? cause.message : "Could not check reviewer revision."); }
    finally { if (serial === requests.current) setChecking(false); }
  }
  async function update(method: "PUT" | "DELETE") {
    if (!personId || selectedRevision == null || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await api(`/api/studio-systems/forms/${encodeURIComponent(formId)}/reviewers/${encodeURIComponent(personId)}`, {
        method, body: JSON.stringify({ expectedRevision: selectedRevision }),
      });
      await refresh(); setPersonId(""); setSelectedLookup(null); setSelectedRevision(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reviewer grant changed. Reload before retrying."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="settings-card-v092" aria-label="Form reviewer access">
    <div className="settings-card-head-v092"><div><h3>Delegated reviewers</h3><p className="muted tight">Grant access to this Form's private responses and decisions only. It does not grant Studio Settings, application, or Project access. Revocation takes effect on the next request.</p></div><ClusterButton type="button" size="compact" onClick={() => void refresh()} disabled={busy}>Refresh</ClusterButton></div>
    <div className="field"><label htmlFor={`form-reviewer-${formId}`}>Studio member</label><ClusterNativeSelect id={`form-reviewer-${formId}`} value={personId} disabled={busy} onChange={(event) => void choose(event.target.value)}><option value="">Choose member</option>{people.map((person) => <option key={person.id} value={person.id}>{person.label}{person.detail ? ` · ${person.detail}` : ""}</option>)}</ClusterNativeSelect></div>
    <div className="button-row"><ClusterButton type="button" variant="primary" disabled={busy || checking || !personId || selectedRevision == null || selected?.status === "active"} onClick={() => void update("PUT")}>{selected?.status === "revoked" ? "Restore review access" : "Grant review access"}</ClusterButton>{selected?.status === "active" && <ClusterButton type="button" variant="quiet" disabled={busy || checking || selectedRevision == null} onClick={() => void update("DELETE")}>Revoke access</ClusterButton>}</div>
    {checking && <p role="status" className="muted tight">Checking access revision…</p>}
    {error && <div role="alert" className="error-box">{error}</div>}
    <div className="studio-entity-list-v272">{rows.map((row) => <ClusterButton key={row.id} type="button" className={personId === row.userId ? "active" : ""} onClick={() => void choose(row.userId)}><span className="studio-entity-list-copy-v272"><strong>{row.user.displayName || row.user.username}</strong><small>{row.status} · revision {row.revision}</small></span></ClusterButton>)}</div>
    {rows.length === 0 && <p className="muted tight">No delegated reviewers. Studio administrators can still review.</p>}
    {hasMore && <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => void refresh(page + 1, true)}>Load more</ClusterButton>}
  </section>;
}
