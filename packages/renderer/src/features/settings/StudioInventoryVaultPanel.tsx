import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { InventoryKeyCustodyReview } from "../inventory/InventoryKeyCustodyReview";

// Inventory is the authority for asset lifecycle and allocation tracking.
// Vault remains a separate security projection and is never mixed into these rows.
type Asset = { id: string; title: string; kind: string; provider?: string | null; reference?: string | null; capacity: number; status: string; revision: number };
type Allocation = { id: string; userId: string; quantity: number; reason: string; status: string; revision: number; expiresAt?: string | null; assignedAt: string; revokedAt?: string | null; closedReason?: string | null; closedById?: string | null };
type Person = { id: string; displayName: string; username: string; profileRevision: number };
type AssetEdit = { title: string; kind: string; provider: string; reference: string; capacity: number };
function editFields(asset: Asset): AssetEdit {
  return { title: asset.title, kind: asset.kind, provider: asset.provider || "", reference: asset.reference || "", capacity: asset.capacity };
}
function inventoryError(failure: unknown) { return failure instanceof Error ? failure.message : "Inventory request failed; reload before attempting another change."; }

export function StudioInventoryPanel({ includeKeyPools = true }: { includeKeyPools?: boolean } = {}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [allocated, setAllocated] = useState(0);
  const [attention, setAttention] = useState<{ asOf: string; digitalSeatsExpiring: number; digitalSeatsPastDue: number; physicalCustodyOpen: number; keysExpiring: number; keysPastDue: number; vaultExpiring: number; vaultPastDue: number } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const requestSequence = useRef(0);
  const [showHistory, setShowHistory] = useState(false);
  const [newAsset, setNewAsset] = useState({ title: "", kind: "physical", provider: "", reference: "", capacity: 1 });
  const [edit, setEdit] = useState<AssetEdit | null>(null);
  const [assignment, setAssignment] = useState({ userId: "", quantity: 1, reason: "", expiresAt: "" });
  const [renewingId, setRenewingId] = useState("");
  const [renewal, setRenewal] = useState({ expiresAt: "", reason: "" });
  const [revokeConfirm, setRevokeConfirm] = useState("");
  const [dispositionId, setDispositionId] = useState("");
  const [disposition, setDisposition] = useState({ disposition: "returned", reason: "" });
  const [transferId, setTransferId] = useState("");
  const [transfer, setTransfer] = useState({ toUserId: "", reason: "" });
  const [lifecycleConfirm, setLifecycleConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAssets(cursor: string | null = null, search = filter) {
    const sequence = ++requestSequence.current;
    setPageLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await api<{ assets: Asset[]; nextCursor: string | null }>(`/api/admin/inventory/assets?${params.toString()}`);
      if (sequence !== requestSequence.current) return [];
      const rows = response.assets || [];
      setAssets((current) => cursor ? [...current.filter((item) => !rows.some((row) => row.id === item.id)), ...rows] : rows);
      setNextCursor(response.nextCursor || null);
      if (!cursor) setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
      return rows;
    } finally {
      if (sequence === requestSequence.current) setPageLoading(false);
    }
  }
  async function loadAllocations(id: string, history: boolean) {
    if (!id) { setAllocations([]); setAllocated(0); return; }
    const response = await api<{ allocations: Allocation[]; allocated: number }>(`/api/admin/inventory/assets/${encodeURIComponent(id)}/allocations?history=${history}`);
    setAllocations(response.allocations || []);
    setAllocated(response.allocated || 0);
  }
  useEffect(() => {
    let active = true;
    void api<{ people: Person[] }>("/api/admin/inventory/access-requests/options")
      .then((options) => { if (active) setPeople(options.people || []); })
      .catch((failure) => { if (active) setError(inventoryError(failure)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadAssets(null, filter).catch((failure) => setError(inventoryError(failure))).finally(() => setLoading(false));
    }, 200);
    return () => { clearTimeout(timer); requestSequence.current++; };
  }, [filter]);
  const selected = assets.find((row) => row.id === selectedId);
  useEffect(() => {
    setEdit(selected ? editFields(selected) : null);
    setRevokeConfirm(""); setDispositionId(""); setTransferId(""); setLifecycleConfirm(false);
  }, [selectedId, selected?.revision]);
  useEffect(() => {
    let active = true;
    setAllocations([]); setAllocated(0);
    if (selectedId) {
      void api<{ allocations: Allocation[]; allocated: number }>(`/api/admin/inventory/assets/${encodeURIComponent(selectedId)}/allocations?history=${showHistory}`)
        .then((response) => { if (active) { setAllocations(response.allocations || []); setAllocated(response.allocated || 0); } })
        .catch((failure) => { if (active) setError(inventoryError(failure)); });
    }
    return () => { active = false; };
  }, [selectedId, showHistory]);
  async function mutate(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await task(); }
    catch (failure) { setError(`${inventoryError(failure)} Refresh the asset before retrying an uncertain request.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reload(id = selectedId) {
    await Promise.all([loadAssets(), loadAllocations(id, showHistory)]);
  }
  const free = selected?.status === "active" ? Math.max(0, selected.capacity - allocated) : 0;
  const visibleAssets = assets;
  const editDirty = Boolean(selected && edit && JSON.stringify(edit) !== JSON.stringify(editFields(selected)));
  return <div className="studio-systems-layout-v34f">
    <aside className="studio-systems-list-v34f">
      <div className="settings-card-v092"><strong>Inventory</strong><p>Track assets and seat allocations. Key values and credentials belong in Vault, not Inventory.</p></div>
      <div className="settings-card-v092"><strong>Inventory lifecycle overview</strong>
        <p>Check current seat and key deadlines, and open physical custody. An expired game key is not automatically reusable.</p>
        <ClusterButton type="button" disabled={busy} onClick={() => void mutate(async () => {
          const result = await api<{ asOf: string; digitalSeatsExpiring: number; digitalSeatsPastDue: number; physicalCustodyOpen: number; keysExpiring: number; keysPastDue: number; vaultExpiring: number; vaultPastDue: number }>("/api/admin/inventory/attention");
          setAttention(result);
        })}>Refresh inventory attention</ClusterButton>
        {attention && <p role="status">As of {new Date(attention.asOf).toLocaleString()}: {attention.digitalSeatsExpiring} seats expiring within 7 days, {attention.digitalSeatsPastDue} expired seats awaiting reconciliation, {attention.physicalCustodyOpen} open equipment allocations, {attention.keysExpiring} keys expiring within 7 days, {attention.keysPastDue} expired key assignments (not reusable), {attention.vaultExpiring ?? 0} Vault secrets expiring within 7 days, {attention.vaultPastDue ?? 0} expired Vault secrets requiring review. No secret values are included.</p>}
      </div>
      <div className="field"><label>Find assets</label><ClusterInput value={filter} placeholder="Search all Inventory by name, reference or provider" onChange={(event) => setFilter(event.target.value)}/></div>
      {visibleAssets.map((asset) => <ClusterButton key={asset.id} type="button" className={selectedId === asset.id ? "active" : ""} disabled={busy} onClick={() => setSelectedId(asset.id)}>{asset.title} · {asset.kind}{asset.status !== "active" ? " · Retired" : ""}</ClusterButton>)}
      {!loading && !visibleAssets.length && <p>No matching assets.</p>}
      {pageLoading && <p>Loading inventory records…</p>}
      {nextCursor && <ClusterButton type="button" disabled={busy || pageLoading} onClick={() => void loadAssets(nextCursor).catch((failure) => setError(inventoryError(failure)))}>Load more assets</ClusterButton>}
      <div className="settings-card-v092"><strong>Create asset</strong>
        <div className="field"><label>Name</label><ClusterInput value={newAsset.title} maxLength={160} onChange={(event) => setNewAsset((old) => ({ ...old, title: event.target.value }))}/></div>
        <div className="field"><label>Kind</label><ClusterNativeSelect value={newAsset.kind} onChange={(event) => setNewAsset((old) => ({ ...old, kind: event.target.value }))}><option value="physical">Physical</option><option value="equipment">Equipment</option><option value="digital">Digital</option><option value="license">License seats</option></ClusterNativeSelect></div>
        <div className="field"><label>Provider</label><ClusterInput maxLength={160} value={newAsset.provider} onChange={(event) => setNewAsset((old) => ({ ...old, provider: event.target.value }))}/></div>
        <div className="field"><label>Reference / serial</label><ClusterInput maxLength={160} value={newAsset.reference} onChange={(event) => setNewAsset((old) => ({ ...old, reference: event.target.value }))}/></div>
        <div className="field"><label>Capacity</label><ClusterInput type="number" min={1} max={1000000} value={newAsset.capacity} onChange={(event) => setNewAsset((old) => ({ ...old, capacity: Number(event.target.value) }))}/></div>
        <ClusterButton type="button" variant="primary" disabled={busy || !newAsset.title.trim() || !Number.isInteger(newAsset.capacity) || newAsset.capacity < 1} onClick={() => void mutate(async () => {
          const response = await api<{ asset: Asset }>("/api/admin/inventory/assets", { method: "POST", body: JSON.stringify({ ...newAsset, provider: newAsset.provider || null, reference: newAsset.reference || null }) });
          setNewAsset({ title: "", kind: "physical", provider: "", reference: "", capacity: 1 });
          await loadAssets(); setSelectedId(response.asset.id); setMessage("Asset created.");
        })}>Create asset</ClusterButton>
      </div>
    </aside>
    <section className="studio-systems-editor-v34f">
      {loading && <p>Loading Inventory…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!selected && !loading && <p>Create or select an asset to manage its lifecycle and allocations.</p>}
      {selected && <>
        <h3>{selected.title}</h3><p>{selected.kind} · {selected.status} · {allocated} of {selected.capacity} allocated · {free} available · Revision {selected.revision}</p>
        <div className="settings-card-v092"><strong>Edit asset</strong>
          {edit && <>
            <div className="field"><label>Name</label><ClusterInput maxLength={160} value={edit.title} onChange={(event) => setEdit((old) => old && ({ ...old, title: event.target.value }))}/></div>
            <div className="field"><label>Kind</label><ClusterNativeSelect value={edit.kind} disabled={allocated > 0} onChange={(event) => setEdit((old) => old && ({ ...old, kind: event.target.value }))}><option value="physical">Physical</option><option value="equipment">Equipment</option><option value="digital">Digital</option><option value="license">License seats</option></ClusterNativeSelect></div>
            <div className="field"><label>Provider</label><ClusterInput maxLength={160} value={edit.provider} onChange={(event) => setEdit((old) => old && ({ ...old, provider: event.target.value }))}/></div>
            <div className="field"><label>Reference / serial</label><ClusterInput maxLength={160} value={edit.reference} onChange={(event) => setEdit((old) => old && ({ ...old, reference: event.target.value }))}/></div>
            <div className="field"><label>Capacity</label><ClusterInput type="number" min={Math.max(1, allocated)} max={1000000} value={edit.capacity} onChange={(event) => setEdit((old) => old && ({ ...old, capacity: Number(event.target.value) }))}/></div>
            <ClusterButton type="button" variant="primary" disabled={busy || !editDirty || !edit.title.trim() || !Number.isInteger(edit.capacity) || edit.capacity < Math.max(1, allocated)} onClick={() => void mutate(async () => {
              await api(`/api/admin/inventory/assets/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ ...edit, provider: edit.provider || null, reference: edit.reference || null, expectedRevision: selected.revision }) });
              await reload(); setMessage("Asset updated.");
            })}>Save changes</ClusterButton>
            <ClusterButton type="button" disabled={busy || !editDirty} onClick={() => setEdit(editFields(selected))}>Discard edits</ClusterButton>
          </>}
        </div>
        <div className="settings-card-v092"><strong>Asset lifecycle</strong><p>Retiring an asset prevents new assignments. Existing assignments must be returned or revoked first; history is preserved.</p>
          {lifecycleConfirm ? <div><p>Confirm {selected.status === "active" ? "retirement" : "reactivation"} of {selected.title}?</p>
            <ClusterButton type="button" variant={selected.status === "active" ? "danger" : "primary"} disabled={busy} onClick={() => void mutate(async () => {
              await api(`/api/admin/inventory/assets/${encodeURIComponent(selected.id)}/lifecycle`, { method: "POST", headers: { "X-Cluster-Confirmation": "CHANGE INVENTORY LIFECYCLE" }, body: JSON.stringify({ expectedRevision: selected.revision, status: selected.status === "active" ? "retired" : "active" }) });
              setLifecycleConfirm(false); await reload(); setMessage("Asset lifecycle updated.");
            })}>Confirm</ClusterButton><ClusterButton type="button" onClick={() => setLifecycleConfirm(false)}>Cancel</ClusterButton></div>
            : <ClusterButton type="button" disabled={busy || (selected.status === "active" && allocated > 0)} onClick={() => setLifecycleConfirm(true)}>{selected.status === "active" ? "Retire asset…" : "Reactivate asset…"}</ClusterButton>}
        </div>
        <div className="settings-card-v092"><strong>Allocations</strong><p>Current: {allocated} seats · Available: {free}</p>
          <label><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)}/> Show allocation history (up to 500 entries)</label>
          {allocations.length === 0 && <p>No {showHistory ? "recorded" : "active"} allocations.</p>}
          {allocations.map((row) => <div key={row.id} className="studio-explanation-v272">
            <strong>{people.find((person) => person.id === row.userId)?.displayName || row.userId}</strong>
            <span>{row.quantity} seat(s) · {row.reason || "No reason recorded"} · {row.status === "active" && row.expiresAt && new Date(row.expiresAt) <= new Date() ? "expired (reclaim pending)" : row.status} · {new Date(row.assignedAt).toLocaleDateString()}{row.expiresAt ? ` · Expires ${new Date(row.expiresAt).toLocaleDateString()}` : ""}{row.closedReason ? ` · Closed: ${row.closedReason}` : ""}</span>
            {row.status === "active" && <>
              {(["physical", "equipment"].includes(selected.kind)) && (dispositionId === row.id ? <div><p>Record an actual return or an authorized equipment write-off. Include a condition or disposition reason; the record remains in history.</p>
                <div className="field"><label>Disposition</label><ClusterNativeSelect value={disposition.disposition} onChange={(event) => setDisposition((old) => ({ ...old, disposition: event.target.value }))}><option value="returned">Returned</option><option value="written_off">Written off (reduces stock / may retire asset)</option></ClusterNativeSelect></div>
                <div className="field"><label>Condition / reason</label><ClusterInput maxLength={1000} value={disposition.reason} onChange={(event) => setDisposition((old) => ({ ...old, reason: event.target.value }))}/></div>
                <ClusterButton type="button" variant="primary" disabled={busy || disposition.reason.trim().length < 3} onClick={() => void mutate(async () => {
                  await api(`/api/admin/inventory/allocations/${encodeURIComponent(row.id)}/disposition`, { method: "POST", headers: { "X-Cluster-Confirmation": "RECORD EQUIPMENT DISPOSITION" }, body: JSON.stringify(disposition) });
                  setDispositionId(""); setDisposition({ disposition: "returned", reason: "" }); await reload(); setMessage("Equipment disposition recorded.");
                })}>Confirm disposition</ClusterButton><ClusterButton type="button" onClick={() => setDispositionId("")}>Cancel</ClusterButton></div>
                : <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setDispositionId(row.id); setRevokeConfirm(""); setTransferId(""); }}>Return / write off…</ClusterButton>)}
              {(["digital", "license"].includes(selected.kind)) && row.expiresAt && new Date(row.expiresAt) > new Date() && (renewingId === row.id ? <div>
                <p>Extend a digital seat lease. Maximum 180 days; does not extend account access.</p>
                <div className="field"><label>New expiry (your local time)</label><ClusterInput type="datetime-local" value={renewal.expiresAt} onChange={(event) => setRenewal((old) => ({ ...old, expiresAt: event.target.value }))}/></div>
                <div className="field"><label>Reason</label><ClusterInput value={renewal.reason} maxLength={1000} onChange={(event) => setRenewal((old) => ({ ...old, reason: event.target.value }))}/></div>
                <ClusterButton type="button" variant="primary" disabled={busy || renewal.reason.trim().length < 8 || !renewal.expiresAt} onClick={() => void mutate(async () => {
                  const person = people.find((person) => person.id === row.userId);
                  if (!person) throw new Error("Recipient not in the active Inventory roster; refresh.");
                  await api("/api/admin/inventory/access-requests", { method: "POST", body: JSON.stringify({ operation: "seat_extend", targetId: row.id, userId: row.userId, expectedRevision: row.revision, expectedProfileRevision: person.profileRevision, quantity: row.quantity, expiresAt: new Date(renewal.expiresAt).toISOString(), reason: renewal.reason }) });
                  setRenewingId(""); await reload(); setMessage("Seat extension requested. Another administrator must approve.");
                })}>Request extension</ClusterButton><ClusterButton type="button" onClick={() => setRenewingId("")}>Cancel</ClusterButton>
                </div> : <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setRenewingId(row.id); setRenewal({ expiresAt: "", reason: "" }); }}>Extend seat lease…</ClusterButton>)}
              {(["digital", "license"].includes(selected.kind)) && (revokeConfirm === row.id ? <div><p>Revoke this allocation? The change is audited.</p>
                <ClusterButton type="button" variant="danger" disabled={busy} onClick={() => void mutate(async () => {
                  await api(`/api/admin/inventory/allocations/${encodeURIComponent(row.id)}/revoke`, { method: "POST", headers: { "X-Cluster-Confirmation": "REVOKE ALLOCATION" } });
                  setRevokeConfirm(""); await reload(); setMessage("Allocation revoked.");
                })}>Confirm revoke</ClusterButton><ClusterButton type="button" onClick={() => setRevokeConfirm("")}>Cancel</ClusterButton></div>
                : <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setRevokeConfirm(row.id); setTransferId(""); }}>Revoke…</ClusterButton>)}
              {transferId === row.id ? <div><p>Transfer the same quantity to another active person. The old allocation remains in history.</p>
                <div className="field"><label>New person</label><ClusterNativeSelect value={transfer.toUserId} onChange={(event) => setTransfer((old) => ({ ...old, toUserId: event.target.value }))}><option value="">Choose person</option>{people.filter((person) => person.id !== row.userId).map((person) => <option key={person.id} value={person.id}>{person.displayName || person.username}</option>)}</ClusterNativeSelect></div>
                <div className="field"><label>Reason</label><ClusterInput maxLength={1000} value={transfer.reason} onChange={(event) => setTransfer((old) => ({ ...old, reason: event.target.value }))}/></div>
                <ClusterButton type="button" variant="primary" disabled={busy || !transfer.toUserId} onClick={() => void mutate(async () => {
                  await api(`/api/admin/inventory/allocations/${encodeURIComponent(row.id)}/transfer`, { method: "POST", headers: { "X-Cluster-Confirmation": "TRANSFER ALLOCATION" }, body: JSON.stringify(transfer) });
                  setTransferId(""); setTransfer({ toUserId: "", reason: "" }); await reload(); setMessage("Allocation transferred.");
                })}>Confirm transfer</ClusterButton><ClusterButton type="button" onClick={() => setTransferId("")}>Cancel</ClusterButton></div>
                : <ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setTransferId(row.id); setRevokeConfirm(""); }}>Transfer…</ClusterButton>}
            </>}
          </div>)}
        </div>
        {selected.status === "active" && <div className="settings-card-v092"><strong>Assign asset or seats</strong>
          <div className="field"><label>Person</label><ClusterNativeSelect value={assignment.userId} onChange={(event) => setAssignment((old) => ({ ...old, userId: event.target.value }))}><option value="">Choose a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.displayName || person.username}</option>)}</ClusterNativeSelect></div>
          <div className="field"><label>Quantity</label><ClusterInput type="number" min={1} max={free} value={assignment.quantity} onChange={(event) => setAssignment((old) => ({ ...old, quantity: Number(event.target.value) }))}/></div>
          <div className="field"><label>Reason</label><ClusterInput maxLength={1000} value={assignment.reason} onChange={(event) => setAssignment((old) => ({ ...old, reason: event.target.value }))}/></div>
          {(["digital", "license"].includes(selected.kind)) && <div className="field"><label>Lease expiry (required for reviewed seats, local time; max 180 days)</label><ClusterInput type="datetime-local" value={assignment.expiresAt} onChange={(event) => setAssignment((old) => ({ ...old, expiresAt: event.target.value }))}/></div>}
          <ClusterButton variant="primary" type="button" disabled={busy || !assignment.userId || !Number.isInteger(assignment.quantity) || assignment.quantity < 1 || assignment.quantity > free || (["digital", "license"].includes(selected.kind) && (!assignment.expiresAt || assignment.reason.trim().length < 8))} onClick={() => void mutate(async () => {
            if (["digital", "license"].includes(selected.kind)) {
              const person = people.find((row) => row.id === assignment.userId);
              if (!person) throw new Error("Recipient not in the active Inventory roster; refresh.");
              await api("/api/admin/inventory/access-requests", { method: "POST", body: JSON.stringify({ operation: "seat_issue", targetId: selected.id, userId: assignment.userId, expectedRevision: selected.revision, expectedProfileRevision: person.profileRevision, quantity: assignment.quantity, expiresAt: new Date(assignment.expiresAt).toISOString(), reason: assignment.reason }) });
            } else {
              await api(`/api/admin/inventory/assets/${encodeURIComponent(selectedId)}/allocations`, { method: "POST", body: JSON.stringify({ ...assignment, expiresAt: null }) });
            }
            setAssignment({ userId: "", quantity: 1, reason: "", expiresAt: "" }); await reload(); setMessage(["digital", "license"].includes(selected.kind) ? "Seat issuance requested for independent approval." : "Physical custody allocation recorded.");
          })}>{["digital", "license"].includes(selected.kind) ? "Request seat issuance" : "Assign equipment"}</ClusterButton>
        </div>}
      </>}
    {includeKeyPools && <StudioInventoryKeyPools people={people}/>}
    </section>
  </div>;
}


// Commercial keys are managed in Inventory while their ciphertext remains in Vault.
// No ordinary listing fetches an encrypted value or a Vault record ID.
type KeyPool = { id: string; title: string; kind: string; provider?: string | null; status: string; revision: number; _count?: { keys: number } };
type PoolKey = { id: string; status: string; revision: number; userId?: string | null; assignedAt?: string | null; expiresAt?: string | null; firstRevealedAt?: string | null; closedReason?: string | null };
export function StudioInventoryKeyPools({ people }: { people: Person[] }) {
  const [pools, setPools] = useState<KeyPool[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [poolCursor, setPoolCursor] = useState<string | null>(null);
  const [poolSearch, setPoolSearch] = useState("");
  const [keys, setKeys] = useState<PoolKey[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [newPool, setNewPool] = useState({ title: "", kind: "game_key", provider: "" });
  const [importText, setImportText] = useState("");
  const [importConfirm, setImportConfirm] = useState(false);
  const [action, setAction] = useState<{ keyId: string; kind: "assign" | "redeemed" | "revoked"; userId: string; reason: string; expiresAt: string } | null>(null);
  const [shown, setShown] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = pools.find((pool) => pool.id === selectedId);
  useEffect(() => {
    if (!shown) return;
    const timeout = setTimeout(() => setShown(null), 20_000);
    return () => clearTimeout(timeout);
  }, [shown]);
  async function loadPools(next: string | null = null, search = poolSearch) {
    const query = new URLSearchParams();
    if (next) query.set("cursor", next);
    if (search.trim()) query.set("q", search.trim());
    const response = await api<{ pools: KeyPool[]; nextCursor: string | null }>(`/api/admin/inventory/key-pools?${query.toString()}`);
    setPools((current) => next ? [...current.filter((old) => !(response.pools || []).some((pool) => pool.id === old.id)), ...(response.pools || [])] : response.pools || []);
    setPoolCursor(response.nextCursor || null);
    if (!next) setSelectedId((current) => current || response.pools?.[0]?.id || "");
  }
  async function loadKeys(id: string, next: string | null = null) {
    if (!id) { setKeys([]); setCursor(null); return; }
    const query = next ? `?cursor=${encodeURIComponent(next)}` : "";
    const response = await api<{ pool: KeyPool; keys: PoolKey[]; nextCursor: string | null }>(`/api/admin/inventory/key-pools/${encodeURIComponent(id)}/keys${query}`);
    setPools((current) => current.some((pool) => pool.id === response.pool.id)
      ? current.map((pool) => pool.id === response.pool.id ? response.pool : pool)
      : [...current, response.pool]);
    setKeys((current) => next ? [...current.filter((old) => !response.keys.some((row) => row.id === old.id)), ...(response.keys || [])] : response.keys || []);
    setCursor(response.nextCursor || null);
  }
  useEffect(() => {
    const timeout = setTimeout(() => { void loadPools(null, poolSearch).catch((failure) => setError(inventoryError(failure))); }, 200);
    return () => clearTimeout(timeout);
  }, [poolSearch]);
  useEffect(() => {
    let active = true;
    setShown(null); setKeys([]); setCursor(null); setAction(null); setImportConfirm(false);
    if (selectedId) void api<{ keys: PoolKey[]; nextCursor: string | null }>(`/api/admin/inventory/key-pools/${encodeURIComponent(selectedId)}/keys`)
      .then((response) => { if (active) { setKeys(response.keys || []); setCursor(response.nextCursor || null); } })
      .catch((failure) => { if (active) setError(inventoryError(failure)); });
    return () => { active = false; };
  }, [selectedId]);
  async function perform(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try { await task(); }
    catch (failure) { setShown(null); setError(`${inventoryError(failure)} Refresh before retrying an uncertain operation.`); }
    finally { running.current = false; setBusy(false); }
  }
  async function refresh() { await loadPools(); if (selectedId) await loadKeys(selectedId); }
  const values = importText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const safeInput = values.length > 0 && values.length <= 100 && values.every((value) => value.length <= 256);
  return <div className="settings-card-v092">
    <h3>Game and license key pools</h3>
    <p>Import up to 100 keys per batch. Values are encrypted in Vault; Inventory shows only assignments, statuses, and counts. Reveals are privileged, audited, and temporary.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="field"><label>New pool name</label><ClusterInput maxLength={160} value={newPool.title} onChange={(event) => setNewPool((old) => ({ ...old, title: event.target.value }))}/></div>
    <div className="field"><label>Provider</label><ClusterInput maxLength={160} value={newPool.provider} onChange={(event) => setNewPool((old) => ({ ...old, provider: event.target.value }))}/></div>
    <div className="field"><label>Key type</label><ClusterNativeSelect value={newPool.kind} onChange={(event) => setNewPool((old) => ({ ...old, kind: event.target.value }))}><option value="game_key">Game key</option><option value="license_key">License key</option></ClusterNativeSelect></div>
    <ClusterButton type="button" variant="primary" disabled={busy || !newPool.title.trim()} onClick={() => void perform(async () => {
      const response = await api<{ pool: KeyPool }>("/api/admin/inventory/key-pools", { method: "POST", body: JSON.stringify({ ...newPool, provider: newPool.provider || null }) });
      setNewPool({ title: "", provider: "", kind: "game_key" }); await loadPools(); setPools((current) => current.some((row) => row.id === response.pool.id) ? current : [...current, response.pool]); setSelectedId(response.pool.id); setMessage("Key pool created.");
    })}>Create key pool</ClusterButton>
    <div className="field"><label>Search pools</label><ClusterInput value={poolSearch} maxLength={160} placeholder="Search name or provider" onChange={(event) => setPoolSearch(event.target.value)}/></div>
    <div className="field"><label>Manage pool</label><ClusterNativeSelect value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a pool</option>{pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.title} ({pool._count?.keys ?? 0} keys) {pool.status === "closed" ? "[closed]" : ""}</option>)}</ClusterNativeSelect></div>
    {poolCursor && <ClusterButton type="button" disabled={busy} onClick={() => void perform(async () => { await loadPools(poolCursor); })}>Load more pools</ClusterButton>}
    {selected && <>
      <p>{selected.title} · {selected.kind.replaceAll("_", " ")} · {selected.status} · revision {selected.revision}</p>
      <ClusterButton type="button" disabled={busy} onClick={() => void perform(async () => {
        await api(`/api/admin/inventory/key-pools/${encodeURIComponent(selected.id)}/lifecycle`, { method: "POST", headers: { "X-Cluster-Confirmation": "CHANGE KEY POOL STATUS" }, body: JSON.stringify({ expectedRevision: selected.revision, status: selected.status === "active" ? "closed" : "active" }) });
        await refresh(); setMessage("Pool availability changed.");
      })}>{selected.status === "active" ? "Close pool to new assignments" : "Reopen pool"}</ClusterButton>
      {selected.status === "active" && <div className="settings-card-v092"><strong>Bulk import</strong>
        <p>One key per line, max 100. A duplicate in the pool rejects the whole batch. Clear plaintext after import.</p>
        <div className="field"><label>Keys</label><textarea className="cluster-input" rows={5} autoComplete="off" spellCheck={false} value={importText} onChange={(event) => { setImportText(event.target.value); setImportConfirm(false); }}/></div>
        {importConfirm ? <><p>Confirm encrypted import of {values.length} keys into {selected.title}?</p>
          <ClusterButton type="button" variant="primary" disabled={busy || !safeInput} onClick={() => void perform(async () => {
            await api(`/api/admin/inventory/key-pools/${encodeURIComponent(selected.id)}/import`, { method: "POST", headers: { "X-Cluster-Confirmation": "IMPORT KEY POOL" }, body: JSON.stringify({ expectedRevision: selected.revision, values }) });
            setImportText(""); setImportConfirm(false); await refresh(); setMessage(`${values.length} encrypted keys imported.`);
          })}>Confirm encrypted import</ClusterButton>
          <ClusterButton type="button" onClick={() => setImportConfirm(false)}>Cancel</ClusterButton></>
        : <ClusterButton type="button" disabled={busy || !safeInput} onClick={() => setImportConfirm(true)}>Review import ({values.length})</ClusterButton>}
      </div>}
      <InventoryKeyCustodyReview poolId={selected.id} />
      <strong>Keys</strong>
      {keys.length === 0 && <p>No keys in this pool.</p>}
      {keys.map((key) => <div className="studio-explanation-v272" key={key.id}>
        <strong>Key {key.id.slice(0, 8)}… · {key.status === "assigned" && key.expiresAt && new Date(key.expiresAt) <= new Date() ? "expired (retained, not reusable)" : key.status}</strong>
        <p>{key.userId ? `Assigned to ${people.find((person) => person.id === key.userId)?.displayName || key.userId}` : "Not assigned"}{key.closedReason ? ` · ${key.closedReason}` : ""}{key.expiresAt ? ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}{key.firstRevealedAt ? " · Disclosed (never reusable)" : ""} · rev {key.revision}</p>
        {action?.keyId === key.id ? <div>
          {action.kind === "assign" ? <>
            <div className="field"><label>Recipient</label><ClusterNativeSelect value={action.userId} onChange={(event) => setAction((old) => old && ({ ...old, userId: event.target.value }))}><option value="">Choose person</option>{people.map((person) => <option value={person.id} key={person.id}>{person.displayName || person.username}</option>)}</ClusterNativeSelect></div>
            <div className="field"><label>Access expires (required, local time; max 180 days)</label><ClusterInput type="datetime-local" value={action.expiresAt} onChange={(event) => setAction((old) => old && ({ ...old, expiresAt: event.target.value }))}/></div>
            <div className="field"><label>Business reason for issuance</label><ClusterInput maxLength={1000} value={action.reason} onChange={(event) => setAction((old) => old && ({ ...old, reason: event.target.value }))}/></div><p>Issuance requires another administrator's approval. Expiration blocks reveals and does not recycle disclosed keys.</p>
          </>
          : <div className="field"><label>Reason</label><ClusterInput maxLength={1000} value={action.reason} onChange={(event) => setAction((old) => old && ({ ...old, reason: event.target.value }))}/></div>}
          <ClusterButton type="button" variant={action.kind === "revoked" ? "danger" : "primary"} disabled={busy || (action.kind === "assign" ? (!action.userId || !action.expiresAt || action.reason.trim().length < 8) : action.reason.trim().length < 3)} onClick={() => void perform(async () => {
            const endpoint = `/api/admin/inventory/key-pools/${encodeURIComponent(selected.id)}/keys/${encodeURIComponent(key.id)}`;
            if (action.kind === "assign") {
              const person = people.find((row) => row.id === action.userId);
              if (!person) throw new Error("Recipient not in the active Inventory roster; refresh.");
              await api("/api/admin/inventory/access-requests", { method: "POST", body: JSON.stringify({ operation: "key_issue", targetId: key.id, userId: action.userId, expectedRevision: key.revision, expectedProfileRevision: person.profileRevision, quantity: 1, expiresAt: new Date(action.expiresAt).toISOString(), reason: action.reason }) });
            } else {
              await api(`${endpoint}/decision`, { method: "POST", headers: { "X-Cluster-Confirmation": "CLOSE INVENTORY KEY" }, body: JSON.stringify({ expectedRevision: key.revision, decision: action.kind, reason: action.reason }) });
            }
            setAction(null); setShown(null); await loadKeys(selected.id); setMessage(action.kind === "assign" ? "Key issuance requested for independent approval." : `Key ${action.kind}.`);
          })}>{action.kind === "assign" ? "Request key issuance" : `Confirm ${action.kind}`}</ClusterButton><ClusterButton type="button" onClick={() => setAction(null)}>Cancel</ClusterButton>
        </div> : <>
          {key.status === "available" && selected.status === "active" && <ClusterButton type="button" disabled={busy} onClick={() => setAction({ keyId: key.id, kind: "assign", userId: "", reason: "", expiresAt: "" })}>Assign key…</ClusterButton>}
          {key.status === "assigned" && <>
            <ClusterButton type="button" disabled={busy || selected.status !== "active" || Boolean(key.expiresAt && new Date(key.expiresAt) <= new Date())} onClick={() => void perform(async () => {
              const response = await api<{ value: string }>(`/api/admin/inventory/key-pools/${encodeURIComponent(selected.id)}/keys/${encodeURIComponent(key.id)}/reveal`, { method: "POST", headers: { "X-Cluster-Confirmation": "REVEAL INVENTORY KEY" }, body: JSON.stringify({ expectedRevision: key.revision }) });
              setShown({ id: key.id, value: response.value }); setMessage("Key revealed for 20 seconds. Do not share it through unapproved channels.");
            })}>Reveal assigned key (audited)</ClusterButton>
            <ClusterButton type="button" disabled={busy} onClick={() => setAction({ keyId: key.id, kind: "redeemed", userId: "", reason: "", expiresAt: "" })}>Mark redeemed…</ClusterButton>
          </>}
          {["available", "assigned"].includes(key.status) && <ClusterButton type="button" variant="danger" disabled={busy} onClick={() => { setShown(null); setAction({ keyId: key.id, kind: "revoked", userId: "", reason: "", expiresAt: "" }); }}>Revoke key…</ClusterButton>}
        </>}
        {shown?.id === key.id && <div role="status"><strong>Temporary secret:</strong> <code>{shown.value}</code> <ClusterButton type="button" onClick={() => setShown(null)}>Hide now</ClusterButton></div>}
      </div>)}
      {cursor && <ClusterButton type="button" disabled={busy} onClick={() => void perform(async () => { await loadKeys(selected.id, cursor); })}>Load more keys</ClusterButton>}
    </>}
  </div>;
}
