import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";

type CustodyCase = { keyId: string; userId: string | null; revision: number;
  expiresAt: string | null; firstRevealedAt: string | null; reason: string; requiresReview: boolean };
type CustodyReview = { asOf: string; poolTitle: string; cases: CustodyCase[];
  nextCursor: string | null; scope: string; hasGlobalCounts: false; revealsAuthorized: false; containsVaultSecrets: false };
const explanation: Record<string, string> = {
  no_known_custody_blocker: "No known custody blocker (PIN and fresh reveal authorization still required)",
  pool_closed: "Key pool is closed",
  key_expired: "Key assignment expired",
  key_expires_soon: "Key assignment expires within seven days",
  vault_revoked: "Linked Vault secret revoked",
  vault_expired: "Linked Vault secret expired",
  vault_expires_soon: "Linked Vault secret expires within seven days",
  recipient_missing: "Recipient account not found",
  recipient_inactive: "Recipient no longer has active access",
  recipient_access_expires_soon: "Recipient access expires within seven days",
};

/** On-demand, administrative, secret-free review of assigned key custody. */
export function InventoryKeyCustodyReview({ poolId }: { poolId: string }) {
  const [review, setReview] = useState<CustodyReview | null>(null);
  const [rows, setRows] = useState<CustodyCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    setReview(null); setRows([]); setLoading(false); setError("");
    return () => { sequence.current++; };
  }, [poolId]);
  const load = async (cursor?: string) => {
    if (loading || !poolId) return;
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      const result = await api<{ review: CustodyReview }>(`/api/admin/inventory/key-pools/${encodeURIComponent(poolId)}/custody-review?${params}`);
      if (sequence.current !== current) return;
      setReview(result.review);
      setRows((old) => cursor ? [...old, ...result.review.cases.filter((item) => !old.some((prev) => prev.keyId === item.keyId))] : result.review.cases);
    } catch (failure) {
      if (sequence.current === current) setError(failure instanceof Error ? failure.message : "Custody review unavailable");
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  };
  return <div className="settings-card-v092">
    <strong>Assigned-key custody & Vault readiness</strong>
    <p className="muted tight">Inspect linked Vault status, key leases and recipient lifecycle without exposing secret material. This is a point-in-time review, not disclosure approval.</p>
    <ClusterButton type="button" disabled={loading} onClick={() => void load()}>{loading ? "Checking…" : "Inspect assigned keys"}</ClusterButton>
    {error && <p role="alert">{error}</p>}
    {review && <>
      <p role="status" className="muted tight">Checked {new Date(review.asOf).toLocaleString()}. {rows.filter((item) => item.requiresReview).length} of {rows.length} loaded assignments need review. Counts cover loaded pages only.</p>
      {rows.length === 0 && <p>No assigned keys in this pool on the loaded page.</p>}
      {rows.map((item) => <div key={item.keyId} className="studio-explanation-v272">
        <strong>Key {item.keyId.slice(0, 8)}… · {item.requiresReview ? "Attention" : "No known blocker"}</strong>
        <p>{explanation[item.reason] || "Unknown state, review required"} · Recipient {item.userId || "missing"}{item.expiresAt ? ` · Lease ends ${new Date(item.expiresAt).toLocaleDateString()}` : ""}</p>
      </div>)}
      {review.nextCursor && <ClusterButton type="button" disabled={loading} onClick={() => void load(review.nextCursor || undefined)}>Load next 50 assigned keys</ClusterButton>}
      <p className="muted tight">No keys, ciphertext, Vault identifiers, authorization grants or fingerprints are sent to this view. Refresh before taking a separate administrative action.</p>
    </>}
  </div>;
}
