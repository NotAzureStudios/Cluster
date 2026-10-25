import { useEffect, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type Person = { id: string; label: string; detail?: string };
type Assignment = { id: string; user: { id: string; username: string; displayName?: string | null }; status: string; required: boolean; dueAt: string | null; revision: number; updatedAt: string; lastSubmission: { id: string; status: string; submittedAt: string } | null };
function toLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

// This is an obligation overlay, not a new way to grant access to a restricted form.
export function StudioFormAssignmentsPanel({ formId }: { formId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [items, setItems] = useState<Assignment[]>([]);
  const [personId, setPersonId] = useState("");
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupRef = useRef(0);
  const [dueLocal, setDueLocal] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const requestRef = useRef(0);
  const lock = useRef(false);
  async function refresh(next = 1, append = false) {
    const serial = ++requestRef.current;
    try {
      const result = await queryApi<{ assignments: Assignment[]; hasMore: boolean }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/assignments?page=${next}&limit=25&status=all`, { force: true, tags: ["studio-systems", "forms"] });
      if (serial !== requestRef.current) return;
      setItems((before) => append ? [...before, ...result.assignments.filter((item) => !before.some((old) => old.id === item.id))] : result.assignments);
      setPage(next); setHasMore(result.hasMore); setError("");
    } catch (cause) { if (serial === requestRef.current) setError(cause instanceof Error ? cause.message : "Could not load assignments."); }
  }
  useEffect(() => {
    let live = true;
    setItems([]); setPersonId(""); setSelectedAssignment(null); setDueLocal(""); setRequired(true);
    void refresh();
    void queryApi<{ users: Person[] }>("/api/studio-audience/options", { force: true, tags: ["people", "studio-audience"] })
      .then((result) => { if (live) setPeople(result.users || []); })
      .catch(() => { if (live) setError("People options are unavailable. Refresh and try again."); });
    return () => { live = false; requestRef.current += 1; lookupRef.current += 1; };
  }, [formId]);
  const existing = items.find((item) => item.user.id === personId) || (selectedAssignment?.user.id === personId ? selectedAssignment : null);
  function selectPerson(id: string) {
    const serial = ++lookupRef.current;
    setPersonId(id); setSelectedAssignment(null);
    const found = items.find((entry) => entry.user.id === id);
    setDueLocal(toLocal(found?.dueAt)); setRequired(found?.required ?? true);
    if (!id || found) { setLookingUp(false); return; }
    // The assignment may exist on an unloaded page. Never submit revision 0
    // until the server has confirmed there is no existing record.
    setLookingUp(true);
    void queryApi<{ assignments: Assignment[] }>(`/api/studio-systems/forms/${encodeURIComponent(formId)}/assignments?page=1&limit=1&status=all&userId=${encodeURIComponent(id)}`, { force: true, tags: ["studio-systems", "forms"] })
      .then((result) => {
        if (serial !== lookupRef.current) return;
        const match = result.assignments[0] || null;
        setSelectedAssignment(match); setDueLocal(toLocal(match?.dueAt)); setRequired(match?.required ?? true);
      }).catch((cause) => { if (serial === lookupRef.current) setError(cause instanceof Error ? cause.message : "Could not verify this assignment."); })
      .finally(() => { if (serial === lookupRef.current) setLookingUp(false); });
  }
  async function perform(method: "PUT" | "DELETE") {
    if (!personId || lock.current || lookingUp) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await api(`/api/studio-systems/forms/${encodeURIComponent(formId)}/assignments/${encodeURIComponent(personId)}`, {
        method,
        body: JSON.stringify(method === "PUT" ? { expectedRevision: existing?.revision || 0, required, dueAt: dueLocal ? new Date(dueLocal).toISOString() : null } : { expectedRevision: existing!.revision }),
      });
      await refresh(1);
      setPersonId(""); setSelectedAssignment(null); setDueLocal(""); setRequired(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Assignment changed. Refresh and retry."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="settings-card-v092">
    <div className="settings-card-head-v092"><div><h3>Individual assignments</h3><p className="muted tight">Assign a published form to a person and optionally override the audience deadline. Assignment never grants access outside the published audience. Existing responses remain in the review queue after revocation.</p></div><ClusterButton type="button" size="compact" disabled={busy} onClick={() => void refresh()}>Refresh</ClusterButton></div>
    <div className="studio-form-grid-v272">
      <div className="field"><label htmlFor="form-assignment-person">Person</label><ClusterNativeSelect id="form-assignment-person" value={personId} disabled={busy} onChange={(event) => selectPerson(event.target.value)}><option value="">Choose a studio member</option>{people.map((person) => <option key={person.id} value={person.id}>{person.label}{person.detail ? ` · ${person.detail}` : ""}</option>)}</ClusterNativeSelect></div>
      <div className="field"><label htmlFor="form-assignment-due">Individual deadline</label><ClusterInput id="form-assignment-due" type="datetime-local" value={dueLocal} disabled={busy} onChange={(event) => setDueLocal(event.target.value)} /><small>Blank inherits the published form deadline.</small></div>
      <label className="studio-inline-check-v272 span-2"><ClusterInput type="checkbox" checked={required} disabled={busy} onChange={(event) => setRequired(event.target.checked)} /> Required assignment</label>
    </div>
    <div className="button-row"><ClusterButton type="button" variant="primary" disabled={busy || lookingUp || !personId} onClick={() => void perform("PUT")}>{existing ? existing.status === "revoked" ? "Restore assignment" : "Update assignment" : "Assign person"}</ClusterButton>{existing?.status === "active" && <ClusterButton type="button" disabled={busy || lookingUp} variant="quiet" onClick={() => void perform("DELETE")}>Revoke assignment</ClusterButton>}</div>
    {lookingUp && <p className="muted tight" role="status">Checking current assignment revision…</p>}
    {error && <div role="alert" className="error-box">{error}</div>}
    <div className="studio-entity-list-v272">{items.map((item) => <ClusterButton type="button" key={item.id} onClick={() => selectPerson(item.user.id)} className={personId === item.user.id ? "active" : ""}><span className="studio-entity-list-copy-v272"><strong>{item.user.displayName || item.user.username}</strong><small>{item.status} · {item.required ? "required" : "optional"} · {item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString()}` : "Uses form deadline"} · {item.lastSubmission?.status || "not submitted"}</small></span></ClusterButton>)}</div>
    {!items.length && <p className="muted tight">No individual assignments yet. Published audience forms remain available normally.</p>}
    {hasMore && <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => void refresh(page + 1, true)}>Load more assignments</ClusterButton>}
  </div>;
}
