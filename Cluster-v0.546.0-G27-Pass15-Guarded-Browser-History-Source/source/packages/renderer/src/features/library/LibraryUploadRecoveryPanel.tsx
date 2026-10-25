import { useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";

type RecoveryRow = {
  id: string; ownerId: string; workspaceId: string | null;
  fileName: string; mode: string; state: string;
  createdAt: string; updatedAt: string; expiresAt: string;
  totalBytes: number; receivedBytes: number; provider: string | null;
  hasStorageLocator: boolean; hasMultipartIdentity: boolean; hasChecksum: boolean;
  dispositionAuthorized: false;
};
type ProviderInspection = {
  uploadId: string; inspectedAt: string; state: string; readOnly: true;
  dispositionAuthorized: false; recoveryAuthorized: false; unchangedDuringInspection: boolean;
  warning?: string; limitations: string;
  assessment: { state: "stale" | "conflicting" | "requires_review"; reasons: string[]; automaticallyActionable: false };
  object: { state: string; bytes?: number; matchesExpectedSize?: boolean; checksumMetadata?: string; matchesRecordedChecksumMetadata?: boolean | null };
  multipart: { state: string; observedParts?: number; observedBytes?: number; truncated?: boolean };
  jobs: { state: string; active: number; finished: number; leaseExpiredCount?: number };
};
type RecoveryResponse = {
  total: number; readOnly: true; sessions: RecoveryRow[];
  nextCursor: string | null; reconciliationPolicy: string;
};

/** Explicit, read-only administrator inspection. Never polls, repairs,
 * deletes remote objects, or exposes provider keys / multipart identifiers.
 */
export function LibraryUploadRecoveryPanel() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<RecoveryResponse | null>(null);
  const generation = useRef(0);
  const [inspection, setInspection] = useState<ProviderInspection | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  async function inspectProvider(id: string) {
    const current = ++generation.current;
    setInspectingId(id); setInspection(null); setError("");
    try {
      const result = await api<ProviderInspection>(`/api/library/transfers/recovery/${encodeURIComponent(id)}/inspect`);
      if (generation.current === current) setInspection(result);
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "Provider inspection failed.");
    } finally { if (generation.current === current) setInspectingId(null); }
  }

  async function inspect(cursor?: string) {
    if (pending) return;
    const current = ++generation.current;
    setInspection(null); setInspectingId(null);
    setPending(true); setError("");
    try {
      const result = await api<RecoveryResponse>(`/api/library/transfers/recovery?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (generation.current !== current) return;
      setSnapshot((previous) => cursor && previous ? { ...result, sessions: [...previous.sessions, ...result.sessions] } : result);
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "Upload recovery inspection failed.");
    } finally { if (generation.current === current) setPending(false); }
  }

  return <section className="library-background-bulk-status" aria-label="Read-only upload recovery inspection">
    <div className="button-row">
      <ClusterButton size="compact" variant="quiet" disabled={pending || Boolean(inspectingId)}
        onClick={() => { setOpen((value) => !value); if (!open) void inspect(); else { generation.current += 1; setPending(false); setInspectingId(null); setInspection(null); } }}>
        {open ? "Close upload recovery" : "Inspect upload recovery"}
      </ClusterButton>
      {open && <ClusterButton size="compact" variant="quiet" disabled={pending || Boolean(inspectingId)} onClick={() => void inspect()}>Refresh</ClusterButton>}
    </div>
    {open && <>
      <p className="muted tight">Read-only diagnostics. An ambiguous provider outcome requires verified remote evidence and job ownership review. No deletion, retry, unlock or forced completion is authorized here.</p>
      {error && <p role="alert" className="error-box">{error}</p>}
      {pending && <p role="status">Loading recovery evidence…</p>}
      {snapshot && <>
        <strong>{snapshot.total} upload sessions require operator reconciliation</strong>
        {snapshot.sessions.length ? <ClusterDisclosureGroup title={`Review ${snapshot.sessions.length} recovery sessions`}>
          <ul>{snapshot.sessions.map((session) => <li key={session.id}>
            <strong>{session.fileName}</strong> · {session.state} · {session.mode} · {session.provider || "local staging"}
            <span> · Last changed {new Date(session.updatedAt).toLocaleString()}</span>
            <small> · Owner {session.ownerId} · {session.receivedBytes.toLocaleString()} / {session.totalBytes.toLocaleString()} bytes · Storage identity {session.hasStorageLocator ? "present" : "missing"} · Provider session {session.hasMultipartIdentity ? "present" : "missing"}</small>
            <ClusterButton size="compact" variant="quiet" disabled={pending || Boolean(inspectingId)} onClick={() => void inspectProvider(session.id)}>
              {inspectingId === session.id ? "Inspecting provider…" : "Inspect provider state"}
            </ClusterButton>
            {inspection?.uploadId === session.id && <div role="status" className="muted tight">
              <strong>Observed {new Date(inspection.inspectedAt).toLocaleString()}</strong> · Remote object: {inspection.object.state}
              {inspection.object.bytes !== undefined ? ` (${inspection.object.bytes.toLocaleString()} bytes)` : ""}
              {inspection.object.matchesExpectedSize === false ? " · SIZE MISMATCH" : ""}
              {inspection.object.checksumMetadata === "present_unverified" ? " · Checksum metadata unverified" : ""}
              {inspection.object.matchesRecordedChecksumMetadata === false ? " · CHECKSUM METADATA MISMATCH" : ""}
              <span> · Multipart: {inspection.multipart.state}{inspection.multipart.observedParts !== undefined ? ` (${inspection.multipart.observedParts} observed parts${inspection.multipart.truncated ? ", truncated" : ""})` : ""}</span>
              <span> · Job ownership: {inspection.jobs.state} ({inspection.jobs.active || 0} active)</span>
              <p><strong>Operator assessment: {inspection.assessment.state.replaceAll("_", " ")}</strong> · {inspection.assessment.reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}</p>
              {inspection.warning && <span role="alert"> · {inspection.warning}</span>}
              <p>{inspection.limitations} No cleanup is permitted from this inspection.</p>
            </div>}
          </li>)}</ul>
        </ClusterDisclosureGroup> : <p className="muted tight">No unresolved server upload sessions.</p>}
        {snapshot.nextCursor && <ClusterButton type="button" size="compact" variant="quiet" disabled={pending || Boolean(inspectingId)}
          onClick={() => void inspect(snapshot.nextCursor!)}>Load more recovery evidence</ClusterButton>}
      </>}
    </>}
  </section>;
}
