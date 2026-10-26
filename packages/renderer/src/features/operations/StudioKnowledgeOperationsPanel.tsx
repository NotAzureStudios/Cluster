import { useEffect, useMemo, useState } from "react";
import {
  PACKET_COMPLIANCE_DATA_FIELDS,
  POLICY_COMPLIANCE_DATA_FIELDS,
  createClusterDataViewLayout,
  type ClusterDataExportDelivery,
  type ClusterDataExportFormat,
  type ClusterDataQuery,
  type ClusterDataSort,
  type ClusterDataViewLayout,
  type ClusterSavedDataView,
} from "@cluster/shared";
import { api } from "../../core/api";
import { requestClusterDataExport } from "../../core/data-export-client";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { ClusterTableToolbar } from "../../components/ClusterTableToolbar";
import { ClusterDataView } from "../../components/ClusterDataView";
import { InlineLoadingState } from "../../components/LoadingState";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

type KnowledgeKindSummary = { total: number; active: number; completed: number; overdue: number };
type KnowledgeOverdueItem = {
  id: string;
  kind: "packet" | "policy";
  resourceId: string;
  title: string;
  versionLabel?: string | null;
  user?: { id: string; username: string; displayName?: string | null } | null;
  dueAt?: string | null;
  cycleStartedAt?: string | null;
};
type StudioKnowledgeOperationsSummary = {
  generatedAt: string;
  knowledge: KnowledgeKindSummary & {
    packets: KnowledgeKindSummary;
    policies: KnowledgeKindSummary;
    overdueItems: KnowledgeOverdueItem[];
  };
  onboarding: { assigned: number; active: number; completed: number; overdue: number; dueSoon: number; overdueItems: Array<{ assignmentId: string; userId: string; planTitle: string; dueAt: string }> };
  applications: { pending: number; awaitingConversion?: number };
  announcements: { drafts: number; scheduled?: number };
  calendarReminders?: { dispatchedLast24Hours: number; attendeeEnabledEvents: number };
  exportKinds: Array<"packet" | "policy">;
};
type ComplianceRow = {
  id: string;
  resourceTitle: string;
  resourceId: string;
  person: string;
  userId: string;
  username: string;
  version: string;
  state: "active" | "completed" | "cancelled";
  overdue: boolean;
  cycleStartedAt?: string | null;
  dueAt?: string | null;
  satisfiedAt?: string | null;
  nextRequiredAt?: string | null;
  evidenceId?: string | null;
  updatedAt?: string | null;
};
type ComplianceResponse = {
  ok: boolean;
  dataView: {
    resourceKind: "packet" | "policy";
    query: ClusterDataQuery;
    page: { returned: number; total: number; truncated: boolean };
  };
  rows: ComplianceRow[];
};

const COMPLIANCE_COLUMN_IDS = ["resourceTitle", "person", "version", "state", "overdue", "cycleStartedAt", "dueAt", "satisfiedAt", "nextRequiredAt", "updatedAt"];
const INITIAL_COMPLIANCE_LAYOUT = createClusterDataViewLayout(COMPLIANCE_COLUMN_IDS, ["resourceTitle", "person", "version", "state", "overdue", "dueAt", "satisfiedAt"]);

function personLabel(item: KnowledgeOverdueItem) {
  return item.user?.displayName || item.user?.username || "Unknown person";
}
function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "—";
}

export function StudioKnowledgeOperationsPanel() {
  const [summary, setSummary] = useState<StudioKnowledgeOperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [exportingKind, setExportingKind] = useState<"packet" | "policy" | null>(null);
  const [exportJobId, setExportJobId] = useState("");
  const [datasetKind, setDatasetKind] = useState<"packet" | "policy">("packet");
  const [datasetSearch, setDatasetSearch] = useState("");
  const [datasetState, setDatasetState] = useState<"all" | ComplianceRow["state"]>("all");
  const [datasetOverdue, setDatasetOverdue] = useState<"all" | "yes" | "no">("all");
  const [datasetSorts, setDatasetSorts] = useState<ClusterDataSort[]>([{ fieldId: "updatedAt", direction: "desc" }]);
  const [datasetLayout, setDatasetLayout] = useState<ClusterDataViewLayout>(INITIAL_COMPLIANCE_LAYOUT);
  const [datasetRows, setDatasetRows] = useState<ComplianceRow[]>([]);
  const [datasetTotal, setDatasetTotal] = useState(0);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetStatus, setDatasetStatus] = useState("");

  const complianceQuery = useMemo<ClusterDataQuery>(() => ({
    search: datasetSearch.trim() || undefined,
    sorts: datasetSorts,
    filters: datasetState !== "all" || datasetOverdue !== "all" ? {
      logic: "and",
      conditions: [
        ...(datasetState !== "all" ? [{ fieldId: "state", operator: "equals" as const, value: datasetState }] : []),
        ...(datasetOverdue !== "all" ? [{ fieldId: "overdue", operator: "equals" as const, value: datasetOverdue === "yes" }] : []),
      ],
    } : null,
    page: { limit: 250 },
  }), [datasetSearch, datasetSorts, datasetState, datasetOverdue]);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      setSummary(await api<StudioKnowledgeOperationsSummary>("/api/studio-systems/knowledge/operations-summary"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Studio knowledge operations could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDataset(kind: "packet" | "policy", query: ClusterDataQuery) {
    setDatasetLoading(true);
    setDatasetStatus("");
    try {
      const result = await api<ComplianceResponse>("/api/studio-systems/knowledge/compliance/query", { method: "POST", body: JSON.stringify({ kind, query }) });
      setDatasetRows(result.rows || []);
      setDatasetTotal(result.dataView?.page?.total || 0);
      if (result.dataView?.page?.truncated) setDatasetStatus(`Showing the first ${result.rows.length} of ${result.dataView.page.total} matching responsibilities.`);
    } catch (error) {
      setDatasetRows([]);
      setDatasetTotal(0);
      setDatasetStatus(error instanceof Error ? error.message : "Compliance data could not load.");
    } finally {
      setDatasetLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDataset(datasetKind, complianceQuery), 140);
    return () => window.clearTimeout(timer);
  }, [datasetKind, complianceQuery]);

  async function exportCompliance(kind: "packet" | "policy", format: ClusterDataExportFormat, fieldIds: string[], delivery: ClusterDataExportDelivery) {
    setExportingKind(kind);
    setStatus(delivery === "library" || format === "xlsx" ? `Queueing ${kind} compliance export…` : `Exporting ${kind} compliance…`);
    try {
      const result = await requestClusterDataExport({
        resourceKind: kind,
        format,
        scope: "view",
        delivery,
        fieldIds,
        query: kind === datasetKind ? complianceQuery : {},
        fileName: `studio-${kind}-compliance-${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.mode === "background") {
        setExportJobId(result.jobId);
        setStatus(`${kind === "packet" ? "Packet" : "Policy"} compliance export queued. The finished artifact will be saved to Library.`);
      } else {
        setStatus(`${result.rowCount} compliance row${result.rowCount === 1 ? "" : "s"} exported${result.truncated ? " (bounded immediate export)" : ""}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Compliance export failed.");
    } finally {
      setExportingKind(null);
    }
  }

  function applySavedView(view: ClusterSavedDataView) {
    setDatasetSearch(view.query.search || "");
    setDatasetSorts(view.query.sorts?.length ? [...view.query.sorts] : [{ fieldId: "updatedAt", direction: "desc" }]);
    const conditions = view.query.filters?.conditions || [];
    const state = conditions.find((condition) => condition.fieldId === "state" && condition.operator === "equals")?.value;
    const overdue = conditions.find((condition) => condition.fieldId === "overdue" && condition.operator === "equals")?.value;
    setDatasetState(state === "active" || state === "completed" || state === "cancelled" ? state : "all");
    setDatasetOverdue(overdue === true ? "yes" : overdue === false ? "no" : "all");
    setDatasetLayout(view.layout || INITIAL_COMPLIANCE_LAYOUT);
  }

  const columns = useMemo<ClusterDataTableColumn<ComplianceRow>[]>(() => [
    { id: "resourceTitle", header: datasetKind === "packet" ? "Packet" : "Policy", hideable: false, pinnable: true, defaultWidth: 240, sortValue: (row) => row.resourceTitle, cell: (row) => <div><strong>{row.resourceTitle}</strong><small>{row.resourceId}</small></div> },
    { id: "person", header: "Person", pinnable: true, defaultWidth: 190, sortValue: (row) => row.person, cell: (row) => <div><strong>{row.person}</strong><small>{row.username}</small></div> },
    { id: "version", header: "Version", defaultWidth: 110, sortValue: (row) => row.version, cell: (row) => row.version || "—" },
    { id: "state", header: "State", defaultWidth: 120, sortValue: (row) => row.state, cell: (row) => row.state },
    { id: "overdue", header: "Overdue", defaultWidth: 105, sortValue: (row) => row.overdue, cell: (row) => row.overdue ? "Yes" : "No" },
    { id: "cycleStartedAt", header: "Assigned", defaultWidth: 135, sortValue: (row) => row.cycleStartedAt ? new Date(row.cycleStartedAt) : null, cell: (row) => dateLabel(row.cycleStartedAt) },
    { id: "dueAt", header: "Due", defaultWidth: 135, sortValue: (row) => row.dueAt ? new Date(row.dueAt) : null, cell: (row) => dateLabel(row.dueAt) },
    { id: "satisfiedAt", header: datasetKind === "packet" ? "Completed" : "Accepted", defaultWidth: 135, sortValue: (row) => row.satisfiedAt ? new Date(row.satisfiedAt) : null, cell: (row) => dateLabel(row.satisfiedAt) },
    { id: "nextRequiredAt", header: "Next required", defaultWidth: 145, sortValue: (row) => row.nextRequiredAt ? new Date(row.nextRequiredAt) : null, cell: (row) => dateLabel(row.nextRequiredAt) },
    { id: "updatedAt", header: "Updated", defaultWidth: 145, sortValue: (row) => row.updatedAt ? new Date(row.updatedAt) : null, cell: (row) => dateLabel(row.updatedAt) },
  ], [datasetKind]);

  if (loading && !summary) return <section className="management-panel admin-resource-panel"><InlineLoadingState label="Loading studio compliance" /></section>;

  const knowledge = summary?.knowledge;
  const datasetFields = datasetKind === "packet" ? PACKET_COMPLIANCE_DATA_FIELDS : POLICY_COMPLIANCE_DATA_FIELDS;
  const savedViewCurrent = { presentation: "table" as const, density: "comfortable" as const, query: complianceQuery, layout: datasetLayout };
  return <section className="management-panel admin-resource-panel studio-knowledge-operations-v504">
    <header className="admin-report-drilldown-head-v470">
      <div>
        <h2>Studio knowledge & compliance</h2>
        <span>Required Packets and Policies use the same durable responsibility authority as My Work. Data Views and exports read that same state.</span>
      </div>
      <ClusterButton variant="secondary" onClick={() => { void load(); void loadDataset(datasetKind, complianceQuery); }} disabled={loading || datasetLoading}>{loading || datasetLoading ? "Refreshing…" : "Refresh"}</ClusterButton>
    </header>

    {status ? <div className="status-box system-status-box-v053" role="status">{status}</div> : null}

    {summary && knowledge ? <>
      <div className="studio-knowledge-metrics-v504" aria-label="Studio knowledge compliance summary">
        <article><span>Required actions</span><strong>{knowledge.active}</strong><small>{knowledge.total} tracked responsibilities</small></article>
        <article className={knowledge.overdue ? "attention" : ""}><span>Overdue</span><strong>{knowledge.overdue}</strong><small>Packets + Policies</small></article>
        <article><span>Completed</span><strong>{knowledge.completed}</strong><small>Current valid evidence</small></article>
        <article className={summary.onboarding.overdue ? "attention" : ""}><span>Onboarding outstanding</span><strong>{summary.onboarding.active}</strong><small>{summary.onboarding.completed} complete · {summary.onboarding.overdue} overdue · {summary.onboarding.dueSoon} due within 7 days</small></article>
        <article><span>Applications</span><strong>{summary.applications.pending}</strong><small>{summary.applications.awaitingConversion || 0} approved, awaiting account creation</small></article>
        <article><span>Announcements</span><strong>{summary.announcements.drafts}</strong><small>{summary.announcements.scheduled || 0} scheduled · drafts</small></article>
        <article><span>Calendar reminders</span><strong>{summary.calendarReminders?.dispatchedLast24Hours ?? 0}</strong><small>recipient dispatches, last 24h · {summary.calendarReminders?.attendeeEnabledEvents ?? 0} attendee-enabled events</small></article>
      </div>

      {summary.onboarding.overdueItems?.length > 0 && <section className="panel studio-knowledge-overdue-v504" aria-label="Overdue onboarding assignments">
        <div className="section-heading"><div><h3>Overdue onboarding</h3><p className="muted tight">{summary.onboarding.overdue} assignments still have required steps outstanding. Completed checklists are excluded.</p></div></div>
        <div className="studio-knowledge-overdue-list-v504">{summary.onboarding.overdueItems.map(item => <article key={item.assignmentId}>
          <div><strong>{item.planTitle}</strong><span>Due {dateLabel(item.dueAt)}</span></div>
          <ClusterButton variant="secondary" size="compact" onClick={() => openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: item.userId })}>Open person</ClusterButton>
        </article>)}</div>
      </section>}
      <div className="studio-knowledge-compliance-grid-v504">
        <article className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">Packets</p><h3>Training & required reading</h3><p className="muted tight">{knowledge.packets.active} active · {knowledge.packets.completed} complete · {knowledge.packets.overdue} overdue</p></div>
            {summary.exportKinds.includes("packet") ? <DataExportBuilder fields={PACKET_COMPLIANCE_DATA_FIELDS} selectionCount={0} busy={exportingKind === "packet"} onExport={({ format, fieldIds, delivery }) => exportCompliance("packet", format, fieldIds, delivery)} /> : null}
          </div>
        </article>
        <article className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">Policies</p><h3>Acknowledgements & signatures</h3><p className="muted tight">{knowledge.policies.active} active · {knowledge.policies.completed} complete · {knowledge.policies.overdue} overdue</p></div>
            {summary.exportKinds.includes("policy") ? <DataExportBuilder fields={POLICY_COMPLIANCE_DATA_FIELDS} selectionCount={0} busy={exportingKind === "policy"} onExport={({ format, fieldIds, delivery }) => exportCompliance("policy", format, fieldIds, delivery)} /> : null}
          </div>
        </article>
      </div>

      <DataExportOperationFeedback jobId={exportJobId} onDismiss={() => setExportJobId("")} />

      <section className="studio-knowledge-dataview-v504">
        <div className="section-heading">
          <div><p className="eyebrow">Data View</p><h3>Completion & compliance ledger</h3><p className="muted tight">Filter, sort, save, and export the same authorized responsibility dataset.</p></div>
          <div className="button-row compact"><ClusterButton size="compact" variant={datasetKind === "packet" ? "primary" : "quiet"} onClick={() => setDatasetKind("packet")}>Packets</ClusterButton><ClusterButton size="compact" variant={datasetKind === "policy" ? "primary" : "quiet"} onClick={() => setDatasetKind("policy")}>Policies</ClusterButton></div>
        </div>
        <ClusterTableToolbar
          query={datasetSearch}
          onQueryChange={setDatasetSearch}
          placeholder={`Search ${datasetKind} compliance…`}
          countLabel={datasetLoading ? "Loading…" : `${datasetRows.length} shown · ${datasetTotal} matching`}
          filters={<><ClusterNativeSelect value={datasetState} onChange={(event) => setDatasetState(event.target.value as typeof datasetState)} aria-label="Compliance state"><option value="all">All states</option><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></ClusterNativeSelect><ClusterNativeSelect value={datasetOverdue} onChange={(event) => setDatasetOverdue(event.target.value as typeof datasetOverdue)} aria-label="Overdue filter"><option value="all">All due states</option><option value="yes">Overdue only</option><option value="no">Not overdue</option></ClusterNativeSelect></>}
          actions={<DataExportBuilder fields={datasetFields} visibleFieldIds={datasetLayout.visibleFieldIds} selectionCount={0} busy={exportingKind === datasetKind} onExport={({ format, fieldIds, delivery }) => exportCompliance(datasetKind, format, fieldIds, delivery)} />}
        />
        <ClusterDataView scope={`studio-knowledge-compliance.${datasetKind}`} label={`${datasetKind === "packet" ? "Packet" : "Policy"} compliance`} resourceKind={datasetKind} current={savedViewCurrent} onApply={applySavedView} summary="Save compliance search, filters, sorting, and table layout together." />
        {datasetStatus ? <div className="status-box system-status-box-v053" role="status">{datasetStatus}</div> : null}
        <ClusterDataTable
          rows={datasetRows}
          columns={columns}
          rowKey={(row) => row.id}
          rowLabel={(row) => `${row.resourceTitle} · ${row.person}`}
          label={`${datasetKind === "packet" ? "Packet" : "Policy"} compliance ledger`}
          sorts={datasetSorts}
          onSortsChange={setDatasetSorts}
          configurableColumns
          controlledLayout={datasetLayout}
          onLayoutChange={setDatasetLayout}
          persistKey={`studio-${datasetKind}-compliance`}
          empty={datasetLoading ? <InlineLoadingState label="Loading compliance rows" /> : <div className="empty-state compact-empty">No matching compliance responsibilities.</div>}
        />
      </section>

      <div className="studio-knowledge-overdue-v504">
        <div className="section-heading"><div><p className="eyebrow">Attention</p><h3>Overdue knowledge work</h3><p className="muted tight">Responsibility state comes from StudioKnowledgeAssignment; evidence remains in Packet completions and Policy acceptances.</p></div><span className="soft-pill">{knowledge.overdueItems.length} shown</span></div>
        {knowledge.overdueItems.length ? <div className="studio-knowledge-overdue-list-v504">{knowledge.overdueItems.map((item) => <article key={item.id}>
          <div><strong>{item.title}</strong><span>{personLabel(item)} · {item.kind === "packet" ? "Packet" : "Policy"}{item.versionLabel ? ` · ${item.versionLabel}` : ""}</span></div>
          <small>{item.dueAt ? `Due ${new Date(item.dueAt).toLocaleDateString()}` : "No due date"}</small>
        </article>)}</div> : <div className="empty-state compact-empty">No overdue Packet or Policy responsibilities.</div>}
      </div>

      <small className="muted">Snapshot generated {new Date(summary.generatedAt).toLocaleString()}.</small>
    </> : <div className="empty-state compact-empty">Studio knowledge operations are unavailable.</div>}
  </section>;
}
