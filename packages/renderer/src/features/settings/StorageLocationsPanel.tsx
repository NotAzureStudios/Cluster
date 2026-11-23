import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { formatBytes, SpaceMeter } from "../../components/SpaceMeter";
import "./storage-locations.css";

type Drive = { totalBytes: number; freeBytes: number } | null;
type StorageLocation = { domain: string; label: string; path: string; movable: boolean; usage: { bytes: number; files: number } | null; drive: Drive };
type StorageMove = { domain: string; from: string; to: string; phase: "copying" | "switching" | "finishing" | "done" | "failed"; totalBytes: number; copiedBytes: number; error?: string };
type LocationsResponse = { dataRoot: string; configPath: string; locations: StorageLocation[]; move: StorageMove | null };

// Windows drive ("C:\") or share ("\\NAS\Share") a path lives on.
function driveOf(location: string) {
  const unc = /^\\\\[^\\]+\\[^\\]+/.exec(location);
  if (unc) return unc[0];
  return /^[A-Za-z]:/.test(location) ? `${location.slice(0, 2).toUpperCase()}\\` : "/";
}

function moveLine(move: StorageMove, label: string) {
  if (move.phase === "copying") return `Copying ${label} to ${move.to} · ${formatBytes(move.copiedBytes)} of ${formatBytes(move.totalBytes)}`;
  if (move.phase === "switching") return `Copied. Restarting to switch ${label} to ${move.to}…`;
  if (move.phase === "finishing") return `Switched. Removing the old copy from ${move.from}…`;
  if (move.phase === "done") return `${label} now lives in ${move.to}.`;
  return `Moving ${label} failed: ${move.error || "unknown error"}. Nothing was changed.`;
}

export function StorageLocationsPanel() {
  const [data, setData] = useState<LocationsResponse | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [targetDrive, setTargetDrive] = useState<Drive>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api<LocationsResponse>("/api/admin/storage/locations")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Storage locations are unavailable."); }
  }
  useEffect(() => { void load(); }, []);

  const moving = data?.move && ["copying", "switching", "finishing"].includes(data.move.phase);
  // Poll while a move runs (and briefly while sizes are still being measured).
  const measuring = data?.locations.some((location) => !location.usage);
  useEffect(() => {
    if (!moving && !measuring) return;
    const timer = window.setInterval(() => void load(), moving ? 2_000 : 5_000);
    return () => window.clearInterval(timer);
  }, [moving, measuring]);

  // Live free-space readout for the folder being typed.
  useEffect(() => {
    if (!editing || !/^([A-Za-z]:\\|\\\\)/.test(target)) { setTargetDrive(null); return; }
    const timer = window.setTimeout(() => {
      api<{ drive: Drive }>(`/api/admin/storage/space?path=${encodeURIComponent(target)}`).then((value) => setTargetDrive(value.drive)).catch(() => setTargetDrive(null));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [editing, target]);

  const drives = useMemo(() => {
    const map = new Map<string, { drive: NonNullable<Drive>; labels: string[] }>();
    for (const location of data?.locations || []) {
      if (!location.drive) continue;
      const key = driveOf(location.path);
      const entry = map.get(key) || { drive: location.drive, labels: [] };
      entry.labels.push(location.label);
      map.set(key, entry);
    }
    return [...map.entries()];
  }, [data]);

  async function startMove(location: StorageLocation) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/storage/move", { method: "POST", body: JSON.stringify({ domain: location.domain, target: target.trim() }) });
      setEditing(null);
      setTarget("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The move could not start.");
    } finally { setBusy(false); }
  }

  async function dismiss() {
    await api("/api/admin/storage/move/dismiss", { method: "POST" }).catch(() => undefined);
    await load();
  }

  if (!data) return <section className="panel server-config-group-v238 sl">{error ? <p className="sl-error">{error}</p> : <p className="sl-muted">Loading storage…</p>}</section>;
  const moveLabel = data.move ? data.locations.find((location) => location.domain === data.move!.domain)?.label || data.move.domain : "";
  const needed = editing ? data.locations.find((location) => location.domain === editing)?.usage?.bytes ?? 0 : 0;

  return <div className="sl-stack">
    <section className="panel server-config-group-v238 sl" aria-label="Drives">
      <div className="server-config-group-head-v238"><h2>Drives</h2><span>{drives.length}</span></div>
      <ul className="sl-drives">
        {drives.map(([name, { drive, labels }]) => <li key={name}>
          <div className="sl-row-head"><strong>{name}</strong><span>{formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}</span></div>
          <SpaceMeter usedBytes={drive.totalBytes - drive.freeBytes} totalBytes={drive.totalBytes} />
          <small className="sl-muted">{labels.join(" · ")}</small>
        </li>)}
      </ul>
    </section>

    <section className="panel server-config-group-v238 sl" aria-label="Storage locations">
      <div className="server-config-group-head-v238"><h2>Locations</h2><span>{data.locations.length}</span></div>
      {data.move ? <div className="sl-move" data-phase={data.move.phase}>
        <span>{moveLine(data.move, moveLabel)}</span>
        {data.move.phase === "copying" && data.move.totalBytes ? <SpaceMeter usedBytes={data.move.copiedBytes} totalBytes={data.move.totalBytes} tone="accent" /> : null}
        {["done", "failed"].includes(data.move.phase) ? <ClusterButton size="compact" variant="quiet" onClick={() => void dismiss()}>Dismiss</ClusterButton> : null}
      </div> : null}
      {error ? <p className="sl-error" role="alert">{error}</p> : null}
      <ul className="sl-locations">
        {data.locations.map((location) => <li key={location.domain}>
          <div className="sl-row-head">
            <strong>{location.label}</strong>
            <span>{location.usage ? formatBytes(location.usage.bytes) : "Measuring…"}</span>
            {location.movable ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(moving) || busy} onClick={() => { setEditing(editing === location.domain ? null : location.domain); setTarget(""); setError(""); }}>{editing === location.domain ? "Cancel" : "Move"}</ClusterButton> : null}
          </div>
          <code className="sl-path">{location.path}</code>
          {editing === location.domain ? <form className="sl-move-form" onSubmit={(event) => { event.preventDefault(); void startMove(location); }}>
            <ClusterInput value={target} autoFocus placeholder={`New folder, e.g. D:\\Cluster\\${location.label.replace(/\s+/g, "")}`} onChange={(event) => setTarget(event.target.value)} aria-label={`New ${location.label} folder`} />
            <ClusterButton size="compact" variant="primary" type="submit" disabled={busy || !target.trim()}>{busy ? "Starting…" : "Move here"}</ClusterButton>
            <small className={targetDrive && targetDrive.freeBytes < needed ? "sl-error" : "sl-muted"}>
              {targetDrive ? `${formatBytes(targetDrive.freeBytes)} free there · needs ${formatBytes(needed)}` : `Needs ${formatBytes(needed)}`}. Cluster copies everything, restarts on the new folder, then deletes the old copy.
            </small>
          </form> : null}
        </li>)}
      </ul>
      <p className="sl-muted sl-foot">Config: <code>{data.configPath}</code></p>
    </section>
  </div>;
}
