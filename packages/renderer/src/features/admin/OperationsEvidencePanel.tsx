import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { RequestStatusLine } from "../../components/RequestState";
import { api } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import { downloadJsonFile } from "../../core/storage";
import { useVisibleRefresh } from "../../core/visible-refresh";

type EvidenceStream = "operational" | "audit" | "security";
type EvidenceSeverity = "info" | "warning" | "error";
type TimeWindow = "15m" | "1h" | "24h" | "7d";

type OperationsEvidenceEntry = {
  id: string;
  stream: EvidenceStream;
  severity: EvidenceSeverity;
  component: string;
  event: string;
  message: string;
  resourceKind: string | null;
  resourceId: string | null;
  operationId: string | null;
  traceId: string | null;
  causationId: string | null;
  occurredAt: string;
};

type OperationsEvidencePayload = {
  ok: boolean;
  generatedAt: string;
  stream: EvidenceStream;
  filters: Record<string, string | null>;
  entries: OperationsEvidenceEntry[];
  redaction: Record<string, boolean>;
};

type Filters = {
  q: string;
  severity: "" | EvidenceSeverity;
  component: string;
  event: string;
  resourceKind: string;
  resourceId: string;
  operation: string;
  trace: string;
  window: TimeWindow;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  severity: "",
  component: "",
  event: "",
  resourceKind: "",
  resourceId: "",
  operation: "",
  trace: "",
  window: "1h",
};

function streamLabel(stream: EvidenceStream) {
  if (stream === "audit") return "Audit Events";
  if (stream === "security") return "Security Events";
  return "Operational Logs";
}

function severityTone(severity: EvidenceSeverity) {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "good";
}

function timeLabel(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

function windowStart(window: TimeWindow) {
  const durations: Record<TimeWindow, number> = {
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "24h": 24 * 60 * 60_000,
    "7d": 7 * 24 * 60 * 60_000,
  };
  return new Date(Date.now() - durations[window]).toISOString();
}

function evidenceFilename(stream: EvidenceStream) {
  return `cluster-${stream}-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

export function OperationsEvidencePanel() {
  const [stream, setStream] = useState<EvidenceStream>("operational");
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [payload, setPayload] = useState<OperationsEvidencePayload | null>(null);
  const [liveTail, setLiveTail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Loading sanitized operational evidence...");
  const loadingRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ stream, limit: "100", from: windowStart(filters.window) });
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.component.trim()) params.set("component", filters.component.trim());
    if (filters.event.trim()) params.set("event", filters.event.trim());
    if (filters.resourceKind.trim()) params.set("resourceKind", filters.resourceKind.trim());
    if (filters.resourceId.trim()) params.set("resourceId", filters.resourceId.trim());
    if (filters.operation.trim()) params.set("operation", filters.operation.trim());
    if (filters.trace.trim()) params.set("trace", filters.trace.trim());
    return params.toString();
  }, [stream, filters]);

  async function load(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const result = await api<OperationsEvidencePayload>(`/api/admin/operations/evidence?${queryString}`);
      setPayload(result);
      setStatus(`${result.entries.length} sanitized ${streamLabel(result.stream).toLowerCase()} entr${result.entries.length === 1 ? "y" : "ies"} · refreshed ${timeLabel(result.generatedAt)}.`);
      if (liveTail && listRef.current) listRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operational evidence could not be loaded.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [queryString]);
  useVisibleRefresh(() => load(true), { enabled: liveTail, intervalMs: 7_000, minimumGapMs: 2_000 });

  function applyFilters() {
    setFilters({ ...draft });
    if (JSON.stringify(draft) === JSON.stringify(filters)) void load();
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }

  async function copyEntry(entry: OperationsEvidenceEntry) {
    const copied = await copyClusterText(JSON.stringify(entry, null, 2));
    setStatus(copied ? "Sanitized evidence entry copied." : "Evidence entry could not be copied.");
  }

  function downloadEvidence() {
    if (!payload) return;
    downloadJsonFile(evidenceFilename(payload.stream), payload);
    setStatus("Sanitized evidence downloaded.");
  }

  const excluded = useMemo(() => Object.entries(payload?.redaction || {}).filter(([, exposed]) => exposed === false).map(([key]) => key), [payload?.redaction]);

  return (
    <section className="panel operations-evidence-v9k" aria-labelledby="operations-evidence-title-v9k">
      <header>
        <div>
          <strong id="operations-evidence-title-v9k">Logs &amp; Traces</strong>
          <span>Bounded, sanitized evidence for operational investigation. Audit and security evidence remain separate streams.</span>
        </div>
        <div className="button-row">
          <ClusterButton type="button" variant={liveTail ? "primary" : "quiet"} size="compact" onClick={() => setLiveTail((value) => !value)}>{liveTail ? "Live tail on" : "Live tail off"}</ClusterButton>
          <ClusterButton type="button" variant="quiet" size="compact" disabled={loading} onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</ClusterButton>
          <ClusterButton type="button" variant="quiet" size="compact" disabled={!payload?.entries.length} onClick={downloadEvidence}>Download sanitized evidence</ClusterButton>
        </div>
      </header>

      <div className="button-row" role="tablist" aria-label="Evidence streams">
        {(["operational", "audit", "security"] as EvidenceStream[]).map((value) => (
          <ClusterButton key={value} type="button" variant={stream === value ? "primary" : "quiet"} size="compact" onClick={() => setStream(value)}>{streamLabel(value)}</ClusterButton>
        ))}
      </div>

      <div className="management-grid compact operations-evidence-filters-v9k">
        <label><span>Search</span><ClusterInput type="search" value={draft.q} onChange={(event) => setDraft((value) => ({ ...value, q: event.target.value }))} placeholder="Event, component, resource, trace..." /></label>
        <label><span>Severity</span><ClusterNativeSelect value={draft.severity} onChange={(event) => setDraft((value) => ({ ...value, severity: event.target.value as Filters["severity"] }))}><option value="">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option></ClusterNativeSelect></label>
        <label><span>Time</span><ClusterNativeSelect value={draft.window} onChange={(event) => setDraft((value) => ({ ...value, window: event.target.value as TimeWindow }))}><option value="15m">Last 15 minutes</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></ClusterNativeSelect></label>
        <label><span>Component</span><ClusterInput value={draft.component} onChange={(event) => setDraft((value) => ({ ...value, component: event.target.value }))} placeholder="api, persistence..." /></label>
        <label><span>Event</span><ClusterInput value={draft.event} onChange={(event) => setDraft((value) => ({ ...value, event: event.target.value }))} placeholder="Event/action" /></label>
        <label><span>Resource kind</span><ClusterInput value={draft.resourceKind} onChange={(event) => setDraft((value) => ({ ...value, resourceKind: event.target.value }))} placeholder="project, user..." /></label>
        <label><span>Resource ID</span><ClusterInput value={draft.resourceId} onChange={(event) => setDraft((value) => ({ ...value, resourceId: event.target.value }))} placeholder="Exact ID" /></label>
        <label><span>Operation ID</span><ClusterInput value={draft.operation} onChange={(event) => setDraft((value) => ({ ...value, operation: event.target.value }))} placeholder="Operation / job" /></label>
        <label><span>Trace ID</span><ClusterInput value={draft.trace} onChange={(event) => setDraft((value) => ({ ...value, trace: event.target.value }))} placeholder="Correlation / request" /></label>
      </div>
      <div className="button-row">
        <ClusterButton type="button" variant="primary" size="compact" onClick={applyFilters}>Apply filters</ClusterButton>
        <ClusterButton type="button" variant="quiet" size="compact" onClick={resetFilters}>Reset</ClusterButton>
      </div>

      <RequestStatusLine>{status}</RequestStatusLine>
      <div className="status-box system-status-box-v053" role="note">
        <strong>Redaction policy</strong>
        <span>Evidence is intentionally sanitized server-side. Excluded fields: {excluded.length ? excluded.map((value) => value.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ") : "raw/private fields"}. Downloads contain the same bounded representation shown here.</span>
      </div>

      <div ref={listRef} className="operations-evidence-list-v9k" aria-live={liveTail ? "polite" : "off"}>
        {payload?.entries.length ? payload.entries.map((entry) => (
          <article key={entry.id} className="management-card compact operations-evidence-entry-v9k">
            <div className="card-heading-row">
              <div>
                <strong>{entry.event}</strong>
                <span>{entry.component} · {timeLabel(entry.occurredAt)}</span>
              </div>
              <div className="button-row">
                <span className={`soft-pill ${severityTone(entry.severity)}`}>{entry.severity}</span>
                <ClusterButton type="button" variant="quiet" size="compact" onClick={() => void copyEntry(entry)}>Copy</ClusterButton>
              </div>
            </div>
            <p>{entry.message}</p>
            <div className="chip-row">
              {entry.resourceKind ? <span className="soft-pill">{entry.resourceKind}{entry.resourceId ? ` · ${entry.resourceId}` : ""}</span> : null}
              {entry.operationId ? <button type="button" className="soft-pill" title="Filter to this operation" onClick={() => { const next = { ...draft, operation: entry.operationId || "" }; setDraft(next); setFilters(next); }}>operation · {entry.operationId}</button> : null}
              {entry.traceId ? <button type="button" className="soft-pill" title="Filter to this trace" onClick={() => { const next = { ...draft, trace: entry.traceId || "" }; setDraft(next); setFilters(next); }}>trace · {entry.traceId}</button> : null}
              {entry.causationId ? <span className="soft-pill">caused by · {entry.causationId}</span> : null}
            </div>
          </article>
        )) : <ClusterEmptyState compact kind="empty" title={`No ${streamLabel(stream).toLowerCase()}`} description="No sanitized evidence matched the active filters and time window." />}
      </div>
    </section>
  );
}
