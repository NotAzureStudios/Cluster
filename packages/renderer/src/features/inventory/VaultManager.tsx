import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type VaultRecord = {
  id: string; name: string; kind: string; fingerprint: string;
  revision: number; createdAt: string; updatedAt: string;
  expiresAt?: string | null; revokedAt?: string | null;
};
type VaultPage = { secrets: VaultRecord[]; nextCursor: string | null };
type VaultRotationReview = { id: string; secretId: string; expectedRevision: number; requestedById: string;
  reviewedById: string | null; status: string; reason: string; reviewReason: string | null;
  requestedAt: string; expiresAt: string; externalStatus: string | null; externalNote: string | null };

function secretState(item: VaultRecord) {
  return item.revokedAt ? "Revoked" : item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now() ? "Expired" : "Active";
}

/** Raw values stay in component memory only. The list projection never requests ciphertext. */
export function VaultManager() {
  const [records, setRecords] = useState<VaultRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createDraft, setCreateDraft] = useState({ name: "", kind: "integration", value: "", expiresAt: "" });
  const [metadata, setMetadata] = useState({ name: "", kind: "integration", expiresAt: "" });
  const [replacement, setReplacement] = useState("");
  const [rotationReason, setRotationReason] = useState("");
  const [externalStatus, setExternalStatus] = useState("pending_external_update");
  const [externalNote, setExternalNote] = useState("");
  const [rotationReviews, setRotationReviews] = useState<VaultRotationReview[]>([]);
  const [rotationReviewsTruncated, setRotationReviewsTruncated] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  const selected = records.find((item) => item.id === selectedId) || null;
  const visible = records.filter((item) => statusFilter === "all" || secretState(item).toLowerCase() === statusFilter);

  function conceal() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRevealed(null);
  }

  async function load(next: string | null = null, q = search) {
    const sequence = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (next) params.set("cursor", next);
      const [result, reviews] = await Promise.all([
        api<VaultPage>(`/api/admin/vault/secrets?${params}`),
        api<{ reviews: VaultRotationReview[]; truncated: boolean }>("/api/admin/vault/rotation-reviews"),
      ]);
      if (!mounted.current || sequence !== requestId.current) return;
      const rows = result.secrets || [];
      setRecords((current) => next ? [...current.filter((item) => !rows.some((row) => row.id === item.id)), ...rows] : rows);
      setCursor(result.nextCursor || null);
      setRotationReviews(reviews.reviews || []);
      setRotationReviewsTruncated(Boolean(reviews.truncated));
      if (!next) setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
      setError("");
    } catch (failure) {
      if (mounted.current && sequence === requestId.current) setError(formatApiError(failure));
    } finally {
      if (mounted.current && sequence === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const onHidden = () => { if (document.visibilityState === "hidden") { conceal(); setReplacement(""); setCreateDraft((draft) => ({ ...draft, value: "" })); } };
    document.addEventListener("visibilitychange", onHidden);
    return () => { mounted.current = false; requestId.current++; document.removeEventListener("visibilitychange", onHidden); if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    const timeout = setTimeout(() => { conceal(); void load(null, search); }, 250);
    return () => { clearTimeout(timeout); requestId.current++; };
  }, [search]);
  useEffect(() => {
    conceal(); setReplacement("");
    const item = records.find((record) => record.id === selectedId);
    setMetadata(item ? { name: item.name, kind: item.kind, expiresAt: item.expiresAt ? item.expiresAt.slice(0, 16) : "" } : { name: "", kind: "integration", expiresAt: "" });
  }, [selectedId, selected?.revision]);

  async function mutate(task: () => Promise<void>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setNotice(""); conceal();
    try { await task(); if (mounted.current) await load(null, search); }
    catch (failure) { if (mounted.current) setError(`${formatApiError(failure)} Reload Vault metadata before retrying an uncertain write.`); }
    finally { mutationLock.current = false; if (mounted.current) setBusy(false); }
  }

  async function create() {
    if (!createDraft.name.trim() || !createDraft.value || mutationLock.current) return;
    const payload = { ...createDraft, name: createDraft.name.trim(), expiresAt: createDraft.expiresAt ? new Date(createDraft.expiresAt).toISOString() : null };
    await mutate(async () => {
      await api("/api/admin/vault/secrets", { method: "POST", body: JSON.stringify(payload) });
      setCreateDraft({ name: "", kind: "integration", value: "", expiresAt: "" });
      setNotice("Secret encrypted and stored. Only metadata appears in this list.");
    });
  }

  async function updateMetadata(item: VaultRecord) {
    if (mutationLock.current || !metadata.name.trim() || secretState(item) !== "Active") return;
    const confirmed = await confirmCluster({ title: "Update secret metadata", message: `Change the label, classification or expiration of ${item.name}? The encrypted value is not returned or modified.`, confirmLabel: "Save changes" });
    if (!confirmed) return;
    await mutate(async () => {
      await api(`/api/admin/vault/secrets/${encodeURIComponent(item.id)}`, {
        method: "PATCH", headers: { "X-Cluster-Confirmation": "UPDATE VAULT SECRET METADATA" },
        body: JSON.stringify({ name: metadata.name.trim(), kind: metadata.kind, expiresAt: metadata.expiresAt ? new Date(metadata.expiresAt).toISOString() : null, expectedRevision: item.revision }),
      });
      setNotice("Vault record details updated without disclosing its value.");
    });
  }

  async function reveal(item: VaultRecord) {
    if (mutationLock.current || secretState(item) !== "Active") return;
    const confirmed = await confirmCluster({ title: "Reveal sensitive credential", message: `Reveal ${item.name}? This privileged operation is audited. The plaintext is displayed for at most 20 seconds.`, confirmLabel: "Reveal" });
    if (!confirmed || mutationLock.current || selectedId !== item.id) return;
    mutationLock.current = true; setBusy(true); setError(""); conceal();
    try {
      const result = await api<{ value: string }>(`/api/admin/vault/secrets/${encodeURIComponent(item.id)}/reveal`, { method: "POST", headers: { "X-Cluster-Confirmation": "REVEAL VAULT SECRET" } });
      if (!mounted.current || document.visibilityState === "hidden") return;
      setRevealed({ id: item.id, value: result.value });
      timer.current = setTimeout(() => { if (mounted.current) setRevealed(null); timer.current = null; }, 20_000);
    } catch (failure) { if (mounted.current) setError(formatApiError(failure)); }
    finally { mutationLock.current = false; if (mounted.current) setBusy(false); }
  }

  async function requestRotation(item: VaultRecord) {
    if (mutationLock.current || secretState(item) !== "Active" || rotationReason.trim().length < 12) return;
    const confirmed = await confirmCluster({ title: "Request independent Vault rotation review",
      message: `Ask another administrator to approve replacement of ${item.name}? Do not enter replacement plaintext until the review is approved.`,
      confirmLabel: "Request review" });
    if (!confirmed || selectedId !== item.id) return;
    await mutate(async () => {
      await api(`/api/admin/vault/secrets/${encodeURIComponent(item.id)}/rotation-requests`, {
        method: "POST", headers: { "X-Cluster-Confirmation": "REQUEST VAULT ROTATION" },
        body: JSON.stringify({ expectedRevision: item.revision, reason: rotationReason.trim() }),
      });
      setRotationReason(""); setReplacement("");
      setNotice("Rotation requested. A different administrator must review it within 24 hours.");
    });
  }

  async function decideRotation(review: VaultRotationReview, decision: "approve" | "reject") {
    if (mutationLock.current) return;
    const reason = await promptCluster({ title: `${decision === "approve" ? "Approve" : "Reject"} rotation request`,
      label: "Review reason (minimum 8 characters)",
      message: `Review the replacement of a standalone Vault credential? Your account must differ from the requester. No plaintext is disclosed.`,
      confirmLabel: decision === "approve" ? "Approve request" : "Reject request" });
    if (!reason || reason.trim().length < 8) return;
    await mutate(async () => {
      await api(`/api/admin/vault/rotation-reviews/${encodeURIComponent(review.id)}/decision`, {
        method: "POST", headers: { "X-Cluster-Confirmation": "REVIEW VAULT ROTATION" },
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      setNotice("Independent review recorded. The requester must supply fresh replacement plaintext to complete an approval.");
    });
  }

  async function commitRotation(item: VaultRecord, review: VaultRotationReview) {
    if (mutationLock.current || !replacement || externalNote.trim().length < 12 || selectedId !== item.id) return;
    const confirmed = await confirmCluster({ title: "Commit independently reviewed rotation",
      message: `Replace ${item.name} using its approved review? This changes Cluster Vault only. External provider state remains unverified.`,
      confirmLabel: "Replace encrypted credential", tone: "danger" });
    if (!confirmed || mutationLock.current) return;
    const value = replacement;
    await mutate(async () => {
      await api(`/api/admin/vault/rotation-reviews/${encodeURIComponent(review.id)}/commit`, {
        method: "POST", headers: { "X-Cluster-Confirmation": "ROTATE VAULT SECRET" },
        body: JSON.stringify({ value, expectedRevision: item.revision, externalStatus,
          externalNote: externalNote.trim() }),
      });
      setReplacement(""); setExternalNote("");
      setNotice("Reviewed Vault replacement committed. Independently verify dependent services and revoke the old provider credential.");
    });
  }

  async function revoke(item: VaultRecord) {
    if (mutationLock.current || secretState(item) !== "Active") return;
    const proof = await promptCluster({ title: "Revoke stored secret", message: `Revoking ${item.name} prevents any further reveal or rotation. This cannot be undone.`, label: "Type REVOKE", expectedValue: "REVOKE", confirmLabel: "Revoke permanently", tone: "danger" });
    if (proof !== "REVOKE") return;
    await mutate(async () => {
      await api(`/api/admin/vault/secrets/${encodeURIComponent(item.id)}/revoke`, { method: "POST", headers: { "X-Cluster-Confirmation": "REVOKE VAULT SECRET" }, body: JSON.stringify({ expectedRevision: item.revision }) });
      setNotice("Secret revoked. No plaintext value was returned.");
    });
  }

  return <section className="cluster-resource-workspace__body" aria-label="Vault secret manager">
    <div className="cluster-vault-toolbar">
      <ClusterInput aria-label="Search Vault metadata" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search secret labels and kinds" />
      <ClusterNativeSelect aria-label="Filter Vault status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="all">All states</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option>
      </ClusterNativeSelect>
      <ClusterButton disabled={busy || loading} variant="secondary" onClick={() => { conceal(); void load(); }}>Refresh</ClusterButton>
    </div>
    {error && <p role="alert" className="settings-card-v092">{error}</p>}
    {notice && <p role="status" className="settings-card-v092">{notice}</p>}
    <div className="cluster-vault-grid">
      <div className="cluster-vault-records" aria-label="Stored secret metadata">
        {visible.map((item) => <ClusterButton key={item.id} className="cluster-vault-record settings-card-v092" variant="quiet" aria-current={selectedId === item.id ? "true" : undefined} onClick={() => { conceal(); setSelectedId(item.id); }}>
          <strong>{item.name}</strong><small>{item.kind.replaceAll("_", " ")} · {secretState(item)} · Rev {item.revision}</small>
        </ClusterButton>)}
        {loading && <p role="status">Loading encrypted record metadata…</p>}
        {!loading && !visible.length && <p>No matching Vault records.</p>}
        {cursor && <ClusterButton disabled={loading || busy} onClick={() => void load(cursor)}>Load more records</ClusterButton>}
      </div>
      <div className="cluster-vault-details">
        <div className="settings-card-v092">
          <h2>{selected?.name || "Choose a Vault record"}</h2>
          {selected && <>
            <p>{selected.kind.replaceAll("_", " ")} · {secretState(selected)} · Revision {selected.revision}</p>
            <p className="muted tight">Fingerprint: <code>{selected.fingerprint.slice(0, 20)}…</code></p>
            <p className="muted tight">Created: {new Date(selected.createdAt).toLocaleString()}{selected.expiresAt ? ` · Expires: ${new Date(selected.expiresAt).toLocaleString()}` : ""}</p>
            {revealed?.id === selected.id && <div className="cluster-vault-secret" role="group" aria-label="Temporarily revealed secret">
              <strong>Plaintext · clears after 20 seconds</strong><code>{revealed.value}</code>
              <div className="cluster-vault-actions"><ClusterButton size="compact" onClick={() => void copyClusterText(revealed.value).then((ok) => { if (mounted.current) setNotice(ok ? "Copied. Your operating system may retain the clipboard value." : "Clipboard copy failed."); })}>Copy</ClusterButton><ClusterButton size="compact" onClick={conceal}>Hide now</ClusterButton></div>
            </div>}
            {secretState(selected) === "Active" && <>
              <div className="cluster-vault-actions"><ClusterButton disabled={busy} variant="secondary" onClick={() => void reveal(selected)}>Reveal secret</ClusterButton><ClusterButton disabled={busy} variant="secondary" onClick={() => void revoke(selected)}>Revoke…</ClusterButton></div>
              <div className="cluster-vault-metadata">
                <label className="field"><span>Record label</span><ClusterInput maxLength={160} value={metadata.name} onChange={(event) => setMetadata((draft) => ({ ...draft, name: event.target.value }))} /></label>
                <label className="field"><span>Classification</span><ClusterNativeSelect value={metadata.kind} onChange={(event) => setMetadata((draft) => ({ ...draft, kind: event.target.value }))}><option value="integration">Integration</option><option value="password">Password</option><option value="license_key">License key</option><option value="game_key">Game key</option><option value="other">Other</option></ClusterNativeSelect></label>
                <label className="field"><span>Expires at (optional)</span><ClusterInput type="datetime-local" value={metadata.expiresAt} onChange={(event) => setMetadata((draft) => ({ ...draft, expiresAt: event.target.value }))} /></label>
                <ClusterButton disabled={busy || !metadata.name.trim()} variant="secondary" onClick={() => void updateMetadata(selected)}>Save metadata</ClusterButton>
              </div>
              <div className="settings-card-v092">
                <strong>Independent rotation review</strong>
                <p className="muted tight">Request without a plaintext replacement. A separate administrator must approve. Approval expires after 24 hours or any credential revision change.</p>
                <label className="field"><span>Business justification (12+ characters)</span><ClusterInput maxLength={1000} value={rotationReason} onChange={(event) => setRotationReason(event.target.value)} /></label>
                <ClusterButton disabled={busy || rotationReason.trim().length < 12} variant="secondary" onClick={() => void requestRotation(selected)}>Request rotation approval</ClusterButton>
                {rotationReviews.filter((review) => review.secretId === selected.id && ["pending", "approved"].includes(review.status)).map((review) =>
                  <div key={review.id} className="settings-card-v092">
                    <p><strong>{review.status === "approved" ? "Approved" : "Awaiting independent review"}</strong> · Expires {new Date(review.expiresAt).toLocaleString()}</p>
                    <p className="muted tight">Reason: {review.reason}</p>
                    {review.status === "pending" && <div className="cluster-vault-actions">
                      <ClusterButton disabled={busy} variant="secondary" onClick={() => void decideRotation(review, "approve")}>Approve (independent admin)</ClusterButton>
                      <ClusterButton disabled={busy} variant="secondary" onClick={() => void decideRotation(review, "reject")}>Reject</ClusterButton>
                    </div>}
                    {review.status === "approved" && <>
                      <label className="field"><span>Replacement value (only now)</span><ClusterInput type="password" autoComplete="new-password" maxLength={16384} value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
                      <label className="field"><span>External provider disposition, operator-declared</span><ClusterNativeSelect value={externalStatus} onChange={(event) => setExternalStatus(event.target.value)}><option value="pending_external_update">Still pending</option><option value="updated_by_operator">Operator reports updated</option><option value="not_applicable">Not applicable</option></ClusterNativeSelect></label>
                      <label className="field"><span>Disposition note (no credentials)</span><ClusterInput maxLength={1000} value={externalNote} onChange={(event) => setExternalNote(event.target.value)} /></label>
                      <ClusterButton disabled={busy || !replacement || externalNote.trim().length < 12} onClick={() => void commitRotation(selected, review)}>Commit reviewed replacement…</ClusterButton>
                    </>}
                  </div>)}
              </div>
            </>}
          </>}
        </div>
        <div className="settings-card-v092" aria-label="Vault rotation approval queue">
          <h2>Rotation reviews</h2>
          <p className="muted tight">A different administrator must approve each pending request. Replacement values are never part of this queue.</p>
          {rotationReviews.filter((review) => review.status === "pending").map((review) => <div key={review.id} className="settings-card-v092">
            <strong>Pending rotation</strong><p className="muted tight">Requested {new Date(review.requestedAt).toLocaleString()} · Expires {new Date(review.expiresAt).toLocaleString()}</p>
            <p>{review.reason}</p>
            <ClusterButton disabled={busy} variant="secondary" onClick={() => void decideRotation(review, "approve")}>Approve</ClusterButton>
            <ClusterButton disabled={busy} variant="secondary" onClick={() => void decideRotation(review, "reject")}>Reject</ClusterButton>
          </div>)}
          {rotationReviewsTruncated && <p role="status">More than 100 reviews exist. This snapshot is incomplete; request queue pagination remains outstanding.</p>}
        </div>
        <div className="settings-card-v092">
          <h2>Store new secret</h2>
          <label className="field"><span>Label</span><ClusterInput maxLength={160} value={createDraft.name} onChange={(event) => setCreateDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
          <label className="field"><span>Kind</span><ClusterNativeSelect value={createDraft.kind} onChange={(event) => setCreateDraft((draft) => ({ ...draft, kind: event.target.value }))}><option value="integration">Integration</option><option value="password">Password</option><option value="license_key">License key</option><option value="game_key">Game key</option><option value="other">Other</option></ClusterNativeSelect></label>
          <label className="field"><span>Secret value</span><ClusterInput type="password" autoComplete="new-password" maxLength={16384} value={createDraft.value} onChange={(event) => setCreateDraft((draft) => ({ ...draft, value: event.target.value }))} /></label>
          <label className="field"><span>Expires at (optional)</span><ClusterInput type="datetime-local" value={createDraft.expiresAt} onChange={(event) => setCreateDraft((draft) => ({ ...draft, expiresAt: event.target.value }))} /></label>
          <ClusterButton variant="primary" disabled={busy || !createDraft.name.trim() || !createDraft.value} onClick={() => void create()}>Store encrypted secret</ClusterButton>
        </div>
      </div>
    </div>
    <p className="muted tight">Only administrators can use this workspace. Values are never fetched in lists, and every privileged reveal is audited before disclosure. Copied values may persist in the system clipboard.</p>
  </section>;
}
