import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { requestSecurityPin, openPinSettings } from "../../core/security-pin";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";

// Values are intentionally absent from list payloads. A PIN-verified reveal is
// isolated to this view, never put in account preferences, drafts or app caches.
type AssignedKey = {
  id: string;
  status: "assigned" | "redeemed" | "revoked";
  revision: number;
  assignedAt: string | null;
  expiresAt?: string | null;
  closedAt: string | null;
  pool: { title: string; kind: string; provider: string | null; status: string };
};
type KeyPage = { keys: AssignedKey[]; nextCursor: string | null };
type AssignedAsset = {
  id: string; quantity: number; status: string; effectiveStatus?: string; expiresAt?: string | null; assignedAt: string; revokedAt: string | null;
  asset: { title: string; kind: string; provider: string | null; status: string };
};
type AssetPage = { allocations: AssignedAsset[]; nextCursor: string | null };

export function MyInventoryLicensesPanel({ pinConfigured }: { pinConfigured: boolean }) {
  const [keys, setKeys] = useState<AssignedKey[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<AssignedAsset[]>([]);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const requestId = useRef(0);
  const assetRequestId = useRef(0);
  const mounted = useRef(true);

  function hide() {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = null;
    setRevealed(null);
  }

  async function load(cursor: string | null = null) {
    if (inFlight.current) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    hide();
    try {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = await api<KeyPage>(`/api/me/inventory/keys${suffix}`);
      if (id !== requestId.current || !mounted.current) return;
      setKeys((current) => cursor ? [...current.filter((row) => !page.keys.some((other) => other.id === row.id)), ...page.keys] : page.keys);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (id === requestId.current && mounted.current) setError(formatApiError(failure));
    } finally {
      if (id === requestId.current && mounted.current) setLoading(false);
    }
  }

  async function loadAssets(cursor: string | null = null) {
    const id = ++assetRequestId.current;
    setAssetsLoading(true);
    try {
      const page = await api<AssetPage>(`/api/me/inventory/allocations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!mounted.current || id !== assetRequestId.current) return;
      setAllocations((current) => cursor ? [...current.filter((row) => !page.allocations.some((other) => other.id === row.id)), ...page.allocations] : page.allocations);
      setAssetCursor(page.nextCursor);
    } catch (failure) {
      if (mounted.current && id === assetRequestId.current) setError(formatApiError(failure));
    } finally {
      if (mounted.current && id === assetRequestId.current) setAssetsLoading(false);
    }
  }

  useEffect(() => {
    const conceal = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", conceal);
    return () => document.removeEventListener("visibilitychange", conceal);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(); void loadAssets();
    return () => { mounted.current = false; requestId.current++; assetRequestId.current++; if (revealTimer.current) clearTimeout(revealTimer.current); };
  }, []);

  async function reveal(key: AssignedKey) {
    if (inFlight.current || loading || assetsLoading || key.status !== "assigned" || key.pool.status !== "active" || Boolean(key.expiresAt && new Date(key.expiresAt) <= new Date())) return;
    if (!pinConfigured) {
      setError("Create a security PIN before revealing assigned keys.");
      openPinSettings();
      return;
    }
    // Ask for the PIN through the shared secure pad, not a persistent text field.
    const pin = await requestSecurityPin({ title: "Reveal assigned license", description: `Verify your PIN to view the key for ${key.pool.title}. The key will automatically hide after 20 seconds.`, purpose: "reveal_assigned_inventory_key", confirmLabel: "Reveal key" });
    if (!pin || !mounted.current || inFlight.current) return;
    inFlight.current = true;
    setBusyId(key.id); setError(""); setNotice(""); hide();
    try {
      const result = await api<{ value: string }>(`/api/me/inventory/keys/${encodeURIComponent(key.id)}/reveal`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: key.revision, pin }),
      });
      if (!mounted.current || document.visibilityState === "hidden") return;
      setRevealed({ id: key.id, value: result.value });
      revealTimer.current = setTimeout(() => { if (mounted.current) setRevealed(null); revealTimer.current = null; }, 20_000);
      setNotice("Key revealed. Hide it after copying; your clipboard is managed by your operating system.");
    } catch (failure) {
      if (mounted.current) setError(`${formatApiError(failure)} Reload assignments if the key was reassigned or revoked.`);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusyId(null);
    }
  }

  return (
    <section className="settings-section-v092 inventory-recipient-keys" aria-label="My licenses">
      <div className="settings-panel-head-v092">
        <div>
          <p className="eyebrow">Studio resources</p>
          <h2>My equipment & licenses</h2>
          <p className="muted tight">View equipment, license seats, and game keys assigned to your account. Key values are never included in this list. Revealing one requires your Security PIN and creates a security audit entry.</p>
        </div>
        <ClusterButton disabled={loading || assetsLoading || Boolean(busyId)} onClick={() => { void load(); void loadAssets(); }}>Refresh assignments</ClusterButton>
      </div>
      {error && <div role="alert" className="settings-card-v092"><p>{error}</p><ClusterButton disabled={loading || Boolean(busyId)} onClick={() => void load()}>Retry</ClusterButton></div>}
      {notice && <p role="status" className="muted">{notice}</p>}
      {!loading && !assetsLoading && !keys.length && !allocations.length && !error && (
        <ClusterEmptyState kind="first-use" title="No studio resources assigned" description="When a studio administrator assigns you a key, equipment, or license seat, it will appear here." />
      )}
      <h3>Assigned equipment & license seats</h3>
      <div className="settings-card-grid-v092">
        {allocations.map((item) => (
          <article className="settings-card-v092" key={item.id}>
            <div className="settings-card-head-v092"><h3>{item.asset.title}</h3><span>{item.effectiveStatus || item.status}</span></div>
            <p className="muted tight">{item.asset.provider || "Studio-owned"} · {item.asset.kind} · Quantity {item.quantity}</p>
            <p className="muted tight">{new Date(item.assignedAt).toLocaleDateString()}{item.expiresAt ? ` · Lease ends ${new Date(item.expiresAt).toLocaleString()}` : ""} · {item.asset.status === "active" ? "Active catalogue item" : "Retired catalogue item"}</p>
          </article>
        ))}
      </div>
      {assetCursor && <ClusterButton disabled={assetsLoading} onClick={() => void loadAssets(assetCursor)}>Load more assets</ClusterButton>}
      {assetsLoading && <p className="muted" role="status">Loading assigned assets…</p>}
      <h3>Assigned game & software keys</h3>
      <div className="settings-card-grid-v092">
        {keys.map((key) => {
          const expired = Boolean(key.expiresAt && new Date(key.expiresAt) <= new Date());
          const available = key.status === "assigned" && key.pool.status === "active" && !expired;
          return (
            <article className="settings-card-v092" key={key.id}>
              <div className="settings-card-head-v092"><h3>{key.pool.title}</h3><span>{expired && key.status === "assigned" ? "expired" : key.status}</span></div>
              <p className="muted tight">{key.pool.provider || "Studio-issued"} · {key.pool.kind === "game_key" ? "Game key" : "Software license"}</p>
              <p className="muted tight">{key.assignedAt ? `Assigned ${new Date(key.assignedAt).toLocaleDateString()}` : "Assigned"}{key.pool.status !== "active" ? " · Pool closed" : ""}{key.expiresAt ? ` · Access ends ${new Date(key.expiresAt).toLocaleString()}` : ""}</p>
              {revealed?.id === key.id ? (
                <div role="group" aria-label="Temporarily revealed key">
                  <code style={{ overflowWrap: "anywhere", userSelect: "text" }}>{revealed.value}</code>
                  <div className="row-actions">
                    <ClusterButton size="compact" onClick={() => void copyClusterText(revealed.value).then((copied) => mounted.current && setNotice(copied ? "Copied. Your clipboard retains the key until replaced." : "Clipboard copy was blocked."))}>Copy key</ClusterButton>
                    <ClusterButton size="compact" onClick={hide}>Hide now</ClusterButton>
                  </div>
                </div>
              ) : (
                <ClusterButton size="compact" disabled={!available || Boolean(busyId) || loading} busy={busyId === key.id} onClick={() => void reveal(key)}>
                  {available ? "Reveal with PIN" : "Unavailable"}
                </ClusterButton>
              )}
            </article>
          );
        })}
      </div>
      {nextCursor && <ClusterButton disabled={loading || Boolean(busyId)} onClick={() => void load(nextCursor)}>Load more licenses</ClusterButton>}
      {loading && <p className="muted" role="status">Loading assigned licenses…</p>}
      <p className="muted tight">Revealed values disappear from this panel after 20 seconds or when you leave Account Settings. Keys that have been revoked, redeemed, or closed by administrators cannot be revealed here. Copying a key does not clear your system clipboard.</p>
    </section>
  );
}
