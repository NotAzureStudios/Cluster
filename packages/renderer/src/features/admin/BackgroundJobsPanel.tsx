import { createClusterDataViewLayout, type ClusterDataExportDelivery, type ClusterDataExportFormat, type ClusterDataFacetResult, type ClusterDataGroup, type ClusterDataPageResult, type ClusterDataQuery, type ClusterDataSort, type ClusterDataViewLayout, type ClusterSavedDataView, type ClusterSemanticField, type ClusterOperation } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterVisualComposition, ClusterVisualMeter } from "../../components/ClusterVisualMetrics";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { InlineLoadingState } from "../../components/LoadingState";
import { RequestStatusLine } from "../../components/RequestState";
import "./background-jobs.css";
import { ScheduledTaskDiagnosticsPanel } from "./ScheduledTaskDiagnosticsPanel";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { DataViewAggregationStrip, DataViewFacetBar, DataViewGroupControl, selectedDataSummary } from "../../components/DataView";
import { ClusterTableToolbar } from "../../components/ClusterTableToolbar";
import { ClusterDataView } from "../../components/ClusterDataView";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { requestClusterDataExport } from "../../core/data-export-client";
import { downloadJsonFile } from "../../core/storage";

type BackgroundJobSummary = {
  id: string;
  queue: string;
  type: string;
  correlationId?: string | null;
  causationId?: string | null;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  progress: number;
  progressMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
  cancelRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BackgroundJobCounts = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  total: number;
};

type BackgroundJobWorkerSnapshot = {
  workerId: string;
  concurrency: number;
  running: number;
  claimed: number;
  succeeded: number;
  failed: number;
  unknownTypes: number;
  lastClaimedAt?: string | null;
  lastFinishedAt?: string | null;
  registeredTypes: string[];
};

type JobPressure = {
  oldestQueuedAt?: string | null;
  oldestQueuedAgeMs?: number | null;
  stalledLeases?: number;
  byQueue?: Array<{ queue: string; queued: number; running: number; failed: number; deadLetter: number; total?: number }>;
};

type BackgroundJobListResponse = {
  ok: boolean;
  counts: BackgroundJobCounts;
  worker: BackgroundJobWorkerSnapshot;
  pressure?: JobPressure;
  dataView?: { resourceKind: "background_job"; fields: ClusterSemanticField[]; query: ClusterDataQuery; facets?: ClusterDataFacetResult[]; aggregations?: Record<string, number | null>; page?: ClusterDataPageResult };
  jobs: BackgroundJobSummary[];
  operations?: ClusterOperation[];
};

type BackgroundJobDetail = {
  ok: boolean;
  job: BackgroundJobSummary & { payload?: unknown; result?: unknown };
  attempts: Array<{ id: string; attempt: number; workerId: string; status: string; startedAt: string; finishedAt?: string | null; durationMs?: number | null; error?: string | null }>;
  operation?: ClusterOperation | null;
};

type OperationTraceEvidence = {
  ok: boolean;
  correlationId: string;
  generatedAt: string;
  sanitized: boolean;
  bounded: boolean;
  counts: { operations: number; domainEvents: number; requests: number; securityEvents: number };
  stages: Array<{
    id: string;
    kind: "operation" | "domain-event" | "request" | "security";
    at: string;
    label: string;
    state: string;
    resource?: { kind: string; id?: string | null; projectId?: string | null } | null;
    details: Record<string, unknown>;
  }>;
};

const EMPTY_COUNTS: BackgroundJobCounts = { queued: 0, running: 0, succeeded: 0, failed: 0, deadLetter: 0, cancelled: 0, total: 0 };
const JOB_STATUSES = ["", "QUEUED", "RUNNING", "FAILED", "DEAD_LETTER", "CANCELLED", "SUCCEEDED"];

function statusLabel(status: string) { return status.toLowerCase().replace(/_/g, " ").replace(/^./, (value: string) => value.toUpperCase()); }
function timeLabel(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
function ageLabel(milliseconds?: number | null) {
  if (milliseconds == null || milliseconds <= 0) return "No runnable backlog";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes < 60 ? `${minutes}m oldest queued` : `${Math.round(minutes / 6) / 10}h oldest queued`;
}

export function OperationsCenterPanel() {
  const [payload, setPayload] = useState<BackgroundJobListResponse | null>(null);
  const [status, setStatus] = useState("Loading operations...");
  const [actionJobId, setActionJobId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showScheduledTasks, setShowScheduledTasks] = useState(false);
  const [filterQueue, setFilterQueue] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [sorts, setSorts] = useState<ClusterDataSort[]>([{ fieldId: "updatedAt", direction: "desc" }]);
  const [groups, setGroups] = useState<ClusterDataGroup[]>([]);
  const [tableLayout, setTableLayout] = useState<ClusterDataViewLayout | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportJobId, setExportJobId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [detail, setDetail] = useState<BackgroundJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [traceEvidence, setTraceEvidence] = useState<OperationTraceEvidence | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const refreshingRef = useRef(false);

  async function loadJobs(silent = false, cursor: string | null = null) {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!silent) setStatus("Loading operations...");
    try {
      const query = new URLSearchParams({ limit: "80" });
      if (cursor) query.set("cursor", cursor);
      if (filterStatus) query.set("status", filterStatus);
      if (filterQueue) query.set("queue", filterQueue);
      if (filterType) query.set("type", filterType);
      if (search.trim()) query.set("q", search.trim());
      if (sorts.length) query.set("sort", sorts.map((sort) => `${sort.fieldId}:${sort.direction}`).join(","));
      if (groups.length) query.set("group", groups.map((group) => `${group.fieldId}:${group.direction || "asc"}`).join(","));
      query.set("facets", "status,queue,type");
      query.set("aggregate", "matching:count,avgProgress:average:progress,avgAttempts:average:attempts");
      const result = await api<BackgroundJobListResponse>(`/api/admin/operations/jobs?${query.toString()}`);
      if (cursor) {
        setPayload((current) => {
          if (!current) return result;
          const existing = new Set(current.jobs.map((job) => job.id));
          return { ...result, jobs: [...current.jobs, ...result.jobs.filter((job) => !existing.has(job.id))] };
        });
        setStatus(result.jobs.length ? `${result.jobs.length} more retained job${result.jobs.length === 1 ? "" : "s"} loaded.` : "No additional jobs remain in this view.");
      } else {
        setPayload(result);
        setStatus(result.jobs.length ? `${result.jobs.length} retained job${result.jobs.length === 1 ? "" : "s"} shown.` : "No jobs match the current filters.");
        if (selectedJobId && !result.jobs.some((job) => job.id === selectedJobId)) { setSelectedJobId(""); setDetail(null); }
      }
    } catch (error) {
      setPayload(null);
      setStatus(error instanceof Error ? error.message : "Operations could not be loaded.");
    } finally {
      refreshingRef.current = false;
    }
  }

  useEffect(() => {
    void loadJobs();
  }, [filterQueue, filterStatus, filterType, search, sorts, groups]);

  useVisibleRefresh(() => loadJobs(true), { intervalMs: 20_000 });

  async function runAction(job: BackgroundJobSummary, action: "retry" | "cancel") {
    setActionJobId(job.id);
    setStatus(action === "retry" ? "Queueing retry..." : "Requesting cancellation...");
    try {
      await api(`/api/admin/operations/jobs/${encodeURIComponent(job.id)}/${action}`, { method: "POST" });
      await loadJobs(true);
      if (selectedJobId === job.id) await openDetails(job.id, true);
      setStatus(action === "retry" ? "Retry queued." : "Cancellation requested.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Operation ${action} failed.`);
    } finally {
      setActionJobId("");
    }
  }

  async function runBulkRetry() {
    setActionJobId("bulk");
    setStatus("Retrying failed background work...");
    try {
      const result = await api<{ retried?: number }>("/api/admin/operations/jobs/retry-failed", { method: "POST", body: JSON.stringify({ queue: filterQueue || undefined, limit: 25 }) });
      await loadJobs(true);
      setStatus(`${result.retried || 0} failed job${result.retried === 1 ? "" : "s"} returned to the queue.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bulk retry failed.");
    } finally {
      setActionJobId("");
    }
  }

  async function exportJobs(format: ClusterDataExportFormat, fieldIdsOverride?: string[], scopeOverride?: "view" | "selection", delivery: ClusterDataExportDelivery = "download") {
    setExporting(true);
    const background = delivery === "library" || format === "xlsx";
    setStatus(background ? "Queueing durable export..." : selectedJobIds.size ? `Exporting ${selectedJobIds.size} selected job${selectedJobIds.size === 1 ? "" : "s"}...` : "Exporting the current Operations Center view...");
    try {
      const visibleSemanticFields = new Set((payload?.dataView?.fields || []).filter((field) => field.exportable !== false).map((field) => field.id));
      const fieldIds = fieldIdsOverride?.length ? fieldIdsOverride.filter((fieldId) => visibleSemanticFields.has(fieldId)) : effectiveJobLayout.fieldOrder.filter((fieldId) => effectiveJobLayout.visibleFieldIds.includes(fieldId) && visibleSemanticFields.has(fieldId));
      const scope = scopeOverride || (selectedJobIds.size ? "selection" : "view");
      const result = await requestClusterDataExport({
        resourceKind: "background_job", format, scope, delivery, fieldIds, query: currentDataView.query,
        selectedIds: scope === "selection" ? [...selectedJobIds] : undefined,
        fileName: `operations-${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.mode === "background") {
        setExportJobId(result.jobId);
        setStatus("Export queued. Progress is shown below; the finished artifact will also appear in your Library Data Exports folder.");
      } else {
        setStatus(`${result.rowCount} row${result.rowCount === 1 ? "" : "s"} exported${result.truncated ? " (bounded immediate export)" : ""}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operations export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function openDetails(jobId: string, force = false) {
    if (!force && selectedJobId === jobId) { setSelectedJobId(""); setDetail(null); setTraceEvidence(null); return; }
    setSelectedJobId(jobId);
    setTraceEvidence(null);
    setDetailLoading(true);
    try {
      setDetail(await api<BackgroundJobDetail>(`/api/admin/operations/jobs/${encodeURIComponent(jobId)}`));
    } catch (error) {
      setDetail(null);
      setStatus(error instanceof Error ? error.message : "Operation details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadTrace(correlationId: string) {
    setTraceLoading(true);
    try {
      const evidence = await api<OperationTraceEvidence>(`/api/admin/operations/traces/${encodeURIComponent(correlationId)}`);
      setTraceEvidence(evidence);
      setStatus(`${evidence.stages.length} sanitized trace stage${evidence.stages.length === 1 ? "" : "s"} loaded.`);
    } catch (error) {
      setTraceEvidence(null);
      setStatus(error instanceof Error ? error.message : "Trace evidence could not be loaded.");
    } finally {
      setTraceLoading(false);
    }
  }

  function exportTrace() {
    if (!traceEvidence) return;
    downloadJsonFile(`cluster-operation-trace-${traceEvidence.correlationId}-${new Date().toISOString().slice(0, 10)}.json`, traceEvidence);
    setStatus("Sanitized operation trace evidence downloaded.");
  }

  const counts = payload?.counts || EMPTY_COUNTS;
  const unhealthy = counts.deadLetter + counts.failed;
  const worker = payload?.worker;
  const queues = useMemo(() => (payload?.pressure?.byQueue || []).map((row) => row.queue), [payload?.pressure?.byQueue]);
  const summaryItems = useMemo(() => [
    ["Queued", counts.queued], ["Running", counts.running], ["Succeeded", counts.succeeded], ["Failed", counts.failed], ["Dead letter", counts.deadLetter], ["Cancelled", counts.cancelled],
  ] as const, [counts]);
  const fieldLabels = useMemo(() => new Map((payload?.dataView?.fields || []).map((field) => [field.id, field.label] as const)), [payload?.dataView?.fields]);
  const jobColumns = useMemo<ClusterDataTableColumn<BackgroundJobSummary>[]>(() => [
    { id: "type", header: fieldLabels.get("type") || "Type", cell: (job) => <span><strong>{job.type}</strong><small className="muted">{job.id}</small></span>, sortValue: (job) => job.type, groupValue: (job) => job.type, hideable: false, pinnable: true, defaultWidth: 260 },
    { id: "queue", header: fieldLabels.get("queue") || "Queue", cell: (job) => job.queue, sortValue: (job) => job.queue, groupValue: (job) => job.queue, defaultWidth: 150 },
    { id: "correlationId", header: fieldLabels.get("correlationId") || "Trace", cell: (job) => <span><strong title={job.correlationId || job.id}>{job.correlationId || job.id}</strong>{job.causationId ? <small title={job.causationId}>caused by {job.causationId}</small> : null}</span>, hiddenByDefault: true, defaultWidth: 280 },
    { id: "status", header: fieldLabels.get("status") || "State", cell: (job) => <span className={`soft-pill ${job.status === "DEAD_LETTER" || job.status === "FAILED" ? "warning" : job.status === "SUCCEEDED" ? "good" : ""}`}>{statusLabel(job.status)}</span>, sortValue: (job) => job.status, groupValue: (job) => job.status, defaultWidth: 125 },
    { id: "progress", header: fieldLabels.get("progress") || "Progress", cell: (job) => <div className="jobs-progress-cell-v11">
      <span>{Math.max(0, Math.min(100, job.progress || 0))}%{job.progressMessage ? <small title={job.progressMessage}>{job.progressMessage}</small> : null}</span>
      <div className="background-job-progress-v384" role="progressbar" aria-label={`${job.type} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, job.progress || 0))}><span style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div>
    </div>, sortValue: (job) => job.progress, defaultWidth: 165 },
    { id: "attempts", header: fieldLabels.get("attempts") || "Attempts", cell: (job) => `${job.attempts}/${job.maxAttempts}`, sortValue: (job) => job.attempts, defaultWidth: 105 },
    { id: "priority", header: fieldLabels.get("priority") || "Priority", cell: (job) => job.priority, sortValue: (job) => job.priority, hiddenByDefault: true, defaultWidth: 95 },
    { id: "startedAt", header: "Started", cell: (job) => job.startedAt ? timeLabel(job.startedAt) : "—", sortValue: (job) => job.startedAt ? new Date(job.startedAt) : null, defaultWidth: 170 },
    { id: "finishedAt", header: "Finished", cell: (job) => job.finishedAt ? timeLabel(job.finishedAt) : "—", sortValue: (job) => job.finishedAt ? new Date(job.finishedAt) : null, defaultWidth: 170 },
    { id: "updatedAt", header: fieldLabels.get("updatedAt") || "Updated", cell: (job) => timeLabel(job.updatedAt), sortValue: (job) => new Date(job.updatedAt), hiddenByDefault: true, defaultWidth: 190 },
    { id: "lastError", header: fieldLabels.get("lastError") || "Last error", cell: (job) => job.lastError || job.progressMessage || "—", hiddenByDefault: true, defaultWidth: 320, maxWidth: 520 },
    { id: "actions", header: "Actions", cell: (job) => {
      const canRetry = ["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status);
      const canCancel = ["QUEUED", "RUNNING"].includes(job.status);
      return <div className="button-row">
        <ClusterButton type="button" variant="quiet" size="compact" onClick={() => void openDetails(job.id)}>Details</ClusterButton>
        {canCancel ? <ClusterButton type="button" disabled={actionJobId === job.id} onClick={() => void runAction(job, "cancel")} variant="quiet" size="compact">Cancel</ClusterButton> : null}
        {canRetry ? <ClusterButton type="button" disabled={actionJobId === job.id} onClick={() => void runAction(job, "retry")} variant="quiet" size="compact">Retry</ClusterButton> : null}
      </div>;
    }, hideable: false, pinnable: false, resizable: false, defaultWidth: 230 },
  ], [fieldLabels, actionJobId]);
  const groupMetrics = useMemo(() => [
    { id: "avg-progress", label: "Avg progress", value: (rows: readonly BackgroundJobSummary[]) => rows.length ? `${Math.round(rows.reduce((sum, row) => sum + (row.progress || 0), 0) / rows.length)}%` : "—" },
    { id: "needs-review", label: "Needs review", value: (rows: readonly BackgroundJobSummary[]) => rows.filter((row) => row.status === "FAILED" || row.status === "DEAD_LETTER").length },
  ], []);
  const tableSummaryRows = useMemo(() => {
    const visible = payload?.jobs || [];
    const visibleProgress = visible.length ? Math.round(visible.reduce((sum, row) => sum + (row.progress || 0), 0) / visible.length) : 0;
    const visibleAttempts = visible.length ? Math.round((visible.reduce((sum, row) => sum + (row.attempts || 0), 0) / visible.length) * 10) / 10 : 0;
    const selected = selectedDataSummary(visible, selectedJobIds, {
      avgProgress: (rows) => rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.progress || 0), 0) / rows.length) : null,
      avgAttempts: (rows) => rows.length ? Math.round((rows.reduce((sum, row) => sum + (row.attempts || 0), 0) / rows.length) * 10) / 10 : null,
    });
    const aggregate = payload?.dataView?.aggregations || {};
    return [
      ...(selected.count ? [{ key: "selected", label: "Selected loaded rows", scope: selected.scope, values: { queue: `${new Set(selected.rows.map((row) => row.queue)).size} queues`, status: `${selected.count} rows`, progress: `${selected.values.avgProgress || 0}%`, attempts: selected.values.avgAttempts ?? 0 } }] : []),
      { key: "visible", label: "Loaded rows", scope: "visible" as const, values: { queue: `${new Set(visible.map((row) => row.queue)).size} queues`, status: `${visible.length} rows`, progress: `${visibleProgress}%`, attempts: visibleAttempts } },
      { key: "dataset", label: "Filtered dataset", scope: "dataset" as const, values: { status: `${Math.round(aggregate.matching || 0)} matching`, progress: `${Math.round(aggregate.avgProgress || 0)}%`, attempts: Math.round((aggregate.avgAttempts || 0) * 10) / 10 } },
    ];
  }, [payload, selectedJobIds]);
  const defaultJobLayout = useMemo(() => createClusterDataViewLayout(jobColumns.map((column) => column.id), jobColumns.filter((column) => !column.hiddenByDefault).map((column) => column.id)), [jobColumns]);
  const effectiveJobLayout = tableLayout || defaultJobLayout;
  const currentDataView = useMemo(() => ({
    presentation: "table" as const,
    density: "compact" as const,
    query: {
      search,
      sorts,
      groups,
      filters: filterStatus || filterQueue || filterType ? {
        logic: "and" as const,
        conditions: [
          ...(filterStatus ? [{ fieldId: "status", operator: "equals" as const, value: filterStatus }] : []),
          ...(filterQueue ? [{ fieldId: "queue", operator: "equals" as const, value: filterQueue }] : []),
          ...(filterType ? [{ fieldId: "type", operator: "equals" as const, value: filterType }] : []),
        ],
      } : null,
    },
    layout: effectiveJobLayout,
  }), [search, sorts, groups, filterStatus, filterQueue, filterType, effectiveJobLayout]);

  function applySavedDataView(view: ClusterSavedDataView) {
    setSearch(view.query.search || "");
    setSorts(view.query.sorts || []);
    setGroups(view.query.groups || []);
    const conditions = view.query.filters?.conditions || [];
    const statusCondition = conditions.find((condition) => condition.fieldId === "status" && condition.operator === "equals");
    const queueCondition = conditions.find((condition) => condition.fieldId === "queue" && condition.operator === "equals");
    const typeCondition = conditions.find((condition) => condition.fieldId === "type" && condition.operator === "equals");
    setFilterStatus(typeof statusCondition?.value === "string" ? statusCondition.value : "");
    setFilterQueue(typeof queueCondition?.value === "string" ? queueCondition.value : "");
    setFilterType(typeof typeCondition?.value === "string" ? typeCondition.value : "");
    setTableLayout(view.layout);
  }

  return (
    <section className="panel background-jobs-v384" aria-labelledby="operations-center-title-v384">
      <header>
        <div>
          <strong id="operations-center-title-v384">Jobs</strong>
          <span>{worker ? `${worker.running}/${worker.concurrency} worker slots active · ${ageLabel(payload?.pressure?.oldestQueuedAgeMs)}` : "Worker status unavailable"}</span>
        </div>
        <div className="button-row">
          <span className={`soft-pill ${unhealthy || (payload?.pressure?.stalledLeases || 0) ? "warning" : "good"}`}>{unhealthy ? `${unhealthy} needs review` : (payload?.pressure?.stalledLeases || 0) ? `${payload?.pressure?.stalledLeases} expired lease` : "Queue clear"}</span>
          {unhealthy ? <ClusterButton type="button" className="" onClick={() => void runBulkRetry()} disabled={Boolean(actionJobId)} variant="quiet" size="compact">Retry failed</ClusterButton> : null}
          <ClusterButton type="button" className="" onClick={() => void loadJobs()} disabled={Boolean(actionJobId)} variant="quiet" size="compact">Refresh</ClusterButton>
        </div>
      </header>

      <div className="jobs-status-filters-v11" aria-label="Filter jobs by state">
        {([["", "All", counts.total], ["QUEUED", "Queued", counts.queued], ["RUNNING", "Running", counts.running], ["SUCCEEDED", "Succeeded", counts.succeeded], ["FAILED", "Failed", counts.failed], ["DEAD_LETTER", "Dead letter", counts.deadLetter], ["CANCELLED", "Cancelled", counts.cancelled]] as const).map(([value, label, count]) => (
          <ClusterButton key={label} type="button" size="compact" variant={filterStatus === value ? "secondary" : "quiet"} aria-pressed={filterStatus === value} onClick={() => setFilterStatus(value)}>{label} · {count}</ClusterButton>
        ))}
        <ClusterButton type="button" variant="quiet" size="compact" aria-expanded={showScheduledTasks} onClick={() => setShowScheduledTasks((current) => !current)}>
          {showScheduledTasks ? "Hide scheduler" : "Scheduled tasks"}
        </ClusterButton>
      </div>
      {showScheduledTasks ? <ScheduledTaskDiagnosticsPanel /> : null}

      <div className="cluster-visual-summary-grid" aria-label="Operation queue overview">
        <ClusterVisualComposition label="Retained job states" total={counts.total} parts={[
          { label: "Succeeded", value: counts.succeeded, tone: "good" },
          { label: "Queued", value: counts.queued, tone: "neutral" },
          { label: "Running", value: counts.running, tone: "accent" },
          { label: "Failed", value: counts.failed + counts.deadLetter, tone: "danger" },
          { label: "Cancelled", value: counts.cancelled, tone: "neutral" },
        ]} />
        {worker && <ClusterVisualMeter label="Worker slots used" value={worker.running} total={worker.concurrency} tone={unhealthy ? "warning" : "accent"} />}
        {unhealthy > 0 && <div className="cluster-visual-signal-list" role="status"><span className="danger">{unhealthy} jobs need review</span></div>}
      </div>
      <details className="cluster-visual-advanced"><summary>Exact queue counts</summary><div className="cluster-visual-advanced__body">
      <ClusterMetricStrip
        className="background-jobs-summary-v384"
        label="Operation totals"
        items={summaryItems.map(([label, count]) => ({ label, value: count, detail: label === "Queued" ? ageLabel(payload?.pressure?.oldestQueuedAgeMs) : label === "Running" ? `${worker?.running || 0}/${worker?.concurrency || 0} worker slots` : "retained jobs", tone: label === "Dead letter" && count ? "danger" : label === "Succeeded" && count ? "good" : "neutral" }))}
      />
      </div></details>

      <ClusterTableToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="Search operations, queues, types, IDs, or trace context"
        countLabel={`${payload?.jobs.length || 0} loaded`}
        filters={<>
          <label>Status<ClusterNativeSelect value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>{JOB_STATUSES.map((value) => <option key={value || "all"} value={value}>{value ? statusLabel(value) : "All statuses"}</option>)}</ClusterNativeSelect></label>
          <label>Queue<ClusterNativeSelect value={filterQueue} onChange={(event) => setFilterQueue(event.target.value)}><option value="">All queues</option>{queues.map((queue) => <option key={queue} value={queue}>{queue}</option>)}</ClusterNativeSelect></label>
          <DataViewGroupControl fields={payload?.dataView?.fields || []} groups={groups} onChange={setGroups} />
        </>}
        actions={<div className="button-row"><span>{payload?.pressure?.stalledLeases || 0} expired leases</span><DataExportBuilder fields={payload?.dataView?.fields || []} visibleFieldIds={effectiveJobLayout.visibleFieldIds} selectionCount={selectedJobIds.size} busy={exporting || !payload} onExport={({ format, fieldIds, scope, delivery }) => exportJobs(format, fieldIds, scope, delivery)} /></div>}
      />

      <ClusterDataView
        scope="admin.operations-center"
        label="Jobs"
        resourceKind="background_job"
        current={currentDataView}
        onApply={applySavedDataView}
        summary="Save queue filters, job states, sort order, and selected columns as a reusable view."
      />

      <DataExportOperationFeedback jobId={exportJobId} onDismiss={() => setExportJobId("")} />

      {payload?.dataView?.facets?.length ? <DataViewFacetBar
        facets={payload.dataView.facets}
        fields={payload.dataView.fields}
        selectedValues={{ status: filterStatus ? [filterStatus] : [], queue: filterQueue ? [filterQueue] : [], type: filterType ? [filterType] : [] }}
        onToggle={(fieldId, value) => {
          const next = typeof value === "string" ? value : String(value ?? "");
          if (fieldId === "status") setFilterStatus((current) => current === next ? "" : next);
          else if (fieldId === "queue") setFilterQueue((current) => current === next ? "" : next);
          else if (fieldId === "type") setFilterType((current) => current === next ? "" : next);
        }}
        formatValue={(field, value) => field?.id === "status" ? statusLabel(String(value || "")) : String(value ?? "Empty")}
        label="Operation facets"
      /> : null}

      {payload?.dataView?.aggregations && payload.dataView.query.aggregations?.length ? <DataViewAggregationStrip
        className="background-jobs-filtered-summary-v504"
        label="Current Data View summary"
        aggregations={payload.dataView.query.aggregations.map((aggregation) => ({ ...aggregation, label: aggregation.id === "matching" ? "Matching" : aggregation.id === "avgProgress" ? "Average progress" : aggregation.id === "avgAttempts" ? "Average attempts" : aggregation.label }))}
        values={payload.dataView.aggregations}
        fields={payload.dataView.fields}
        details={{ matching: "across the full filtered dataset", avgProgress: "filtered jobs", avgAttempts: "filtered jobs" }}
      /> : null}

      <ClusterDataTable
        rows={payload?.jobs || []}
        columns={jobColumns}
        rowKey={(job) => job.id}
        rowLabel={(job) => `${job.type} ${job.id}`}
        label="Server jobs"
        selectedKeys={selectedJobIds}
        onSelectionChange={setSelectedJobIds}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groups}
        groupMetrics={groupMetrics}
        summaryRows={tableSummaryRows}
        virtualization={{ rowHeight: 52, maxHeight: 720, minimumRows: 120, overscan: 12 }}
        onRowActivate={(job) => void openDetails(job.id)}
        configurableColumns
        persistKey="admin-background-jobs-v11"
        controlledLayout={tableLayout || undefined}
        onLayoutChange={setTableLayout}
        empty={payload ? <ClusterEmptyState compact kind="filtered" title="No operations match these filters" description="Change or clear the current filters to widen the retained operation history." /> : <RequestStatusLine>{status}</RequestStatusLine>}
      />

      {payload?.dataView?.page?.hasMore && payload.dataView.page.nextCursor ? <div className="button-row"><ClusterButton type="button" variant="quiet" size="compact" disabled={refreshingRef.current} onClick={() => void loadJobs(true, payload.dataView?.page?.nextCursor || null)}>Load 80 more</ClusterButton><span className="muted">Cursor paging keeps large operational history bounded.</span></div> : null}

      {selectedJobId ? <section className="background-job-detail-v495" aria-label="Operation detail">
        {detailLoading ? <InlineLoadingState label="Loading attempt history" lines={2} /> : detail?.job.id === selectedJobId ? <>
          <header><div><strong>{detail.job.type}</strong><span>{detail.job.id} · {detail.job.queue}</span></div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => { setSelectedJobId(""); setDetail(null); setTraceEvidence(null); }}>Close</ClusterButton></header>
          <div className="background-job-detail-kpis-v495"><span><b>Priority</b><strong>{detail.job.priority}</strong></span><span><b>Created</b><strong>{timeLabel(detail.job.createdAt)}</strong></span><span><b>Updated</b><strong>{timeLabel(detail.job.updatedAt)}</strong></span></div>
          {detail.operation ? <div className="background-job-detail-kpis-v495" aria-label="Operation trace context"><span><b>Correlation</b><strong title={detail.operation.trace.correlationId}>{detail.operation.trace.correlationId || detail.operation.id}</strong></span><span><b>Causation</b><strong title={detail.operation.trace.causationId || ""}>{detail.operation.trace.causationId || "—"}</strong></span><span><b>Progress</b><strong>{detail.operation.progress}%{detail.operation.progressMessage ? ` · ${detail.operation.progressMessage}` : ""}</strong></span></div> : null}
          {detail.operation ? <div className="button-row">
            <ClusterButton type="button" variant="quiet" size="compact" disabled={traceLoading} onClick={() => void loadTrace(detail.operation?.trace.correlationId || detail.operation?.id || detail.job.id)}>{traceLoading ? "Loading trace…" : traceEvidence ? "Refresh trace evidence" : "Trace evidence"}</ClusterButton>
            {traceEvidence ? <ClusterButton type="button" variant="quiet" size="compact" onClick={exportTrace}>Download sanitized evidence</ClusterButton> : null}
            {traceEvidence ? <span className={`soft-pill ${traceEvidence.bounded ? "warning" : "good"}`}>{traceEvidence.bounded ? "Bounded result" : "Complete retained trace"}</span> : null}
          </div> : null}
          {detail.job.lastError ? <div className="status-box" role="alert"><strong>Last error</strong><span>{detail.job.lastError}</span></div> : null}
          {traceEvidence ? <div className="background-job-attempts-v495" aria-label="Sanitized operation trace timeline">
            <div><span><b>Trace evidence</b><small>{traceEvidence.counts.operations} operations · {traceEvidence.counts.domainEvents} events · {traceEvidence.counts.requests} requests · {traceEvidence.counts.securityEvents} security events</small></span><span><strong>Sanitized</strong><small>{timeLabel(traceEvidence.generatedAt)}</small></span></div>
            {traceEvidence.stages.map((stage) => <div key={stage.id}><span><b>{stage.label}</b><small>{stage.kind}{stage.resource?.kind ? ` · ${stage.resource.kind}${stage.resource.id ? `:${stage.resource.id}` : ""}` : ""}</small></span><span><strong>{statusLabel(stage.state)}</strong><small>{timeLabel(stage.at)}</small></span></div>)}
            {!traceEvidence.stages.length ? <ClusterEmptyState compact kind="empty" title="No correlated retained evidence" description="The operation exists, but no request, event, or security evidence with this correlation ID is still retained." /> : null}
          </div> : null}
          <div className="background-job-attempts-v495">
            {detail.attempts.map((attempt) => <div key={attempt.id}><span><b>Attempt {attempt.attempt}</b><small>{attempt.workerId} · {timeLabel(attempt.startedAt)}</small></span><span><strong>{statusLabel(attempt.status)}</strong><small>{attempt.durationMs == null ? "—" : `${attempt.durationMs} ms`}</small></span>{attempt.error ? <p>{attempt.error}</p> : null}</div>)}
            {!detail.attempts.length ? <ClusterEmptyState compact kind="empty" title="No worker attempts yet" description="Attempts will appear here after a worker claims the job." /> : null}
          </div>
        </> : <ClusterEmptyState compact kind="restricted" title="Operation detail unavailable" description="The retained operation summary is available, but its trace or attempt detail could not be loaded." />}
      </section> : null}

      <footer className="background-jobs-footer-v384">
        <span>{status}</span>
        {worker && <span>{worker.registeredTypes.length} registered job types · last completion {timeLabel(worker.lastFinishedAt)}</span>}
      </footer>
    </section>
  );
}


