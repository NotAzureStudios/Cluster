import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterVisualComposition } from "../../components/ClusterVisualMetrics";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { RequestStatusLine } from "../../components/RequestState";
import { api, queryApi } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useClusterActionFlight } from "../../components/useClusterActionFlight";
import { createClusterLatestResponse } from "../../components/cluster-action-flight";
import { createClusterCreateIntentControl } from "../create/create-intent-control";
import { incidentIdFromInspect } from "./incident-link";

type OperationalState = "healthy" | "degraded" | "maintenance" | "draining" | "restarting" | "restoring" | "read-only" | "offline" | string;
type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "open" | "investigating" | "mitigating" | "monitoring" | "resolved" | "closed";

type OperationalCheck = { key: string; label?: string; status: string; message?: string | null; checkedAt?: string | null; evidence?: unknown };
type HealthPayload = { ok: boolean; generatedAt: string; operational?: { state?: OperationalState; ready?: boolean; checks?: OperationalCheck[] }; performanceBudgets?: { failures?: number; warnings?: number }; durableJobs?: { counts?: { failed?: number; deadLetter?: number; running?: number; queued?: number } }; dependencyCircuits?: Array<{ key?: string; name?: string; state?: string }> };
type IncidentTransition = { at: string; from: OperationalState | null; to: OperationalState; reasons: string[] };
type TransitionPayload = { ok: boolean; version?: string; current?: OperationalState | null; incidents: IncidentTransition[] };
type IncidentResource = { id: string; kind: string; resourceId: string; label?: string | null; createdAt: string };
type IncidentTimelineEntry = { id: string; kind: string; message: string; actorUserId?: string | null; actorName?: string | null; correlationId?: string | null; createdAt: string };
type AlertTargetType = "admins" | "user" | "team" | "department";
type AlertPolicy = { key: string; enabled: boolean; recipientType: AlertTargetType; recipientId: string | null; escalationType: AlertTargetType; escalationId: string | null; acknowledgeMinutes: number; reminderMinutes: number; revision: number };
type AlertTarget = { id: string; name: string };
type AlertPolicyPayload = { ok: true; policies: AlertPolicy[]; targets: { users: AlertTarget[]; teams: AlertTarget[]; departments: AlertTarget[] } };
type OperationsIncident = { acknowledgedAt?: string | null; acknowledgedById?: string | null; alertCycle?: number; id: string; title: string; summary: string; severity: IncidentSeverity; status: IncidentStatus; ownerUserId?: string | null; ownerName?: string | null; correlationId?: string | null; openedByName?: string | null; openedAt: string; resolvedAt?: string | null; closedAt?: string | null; updatedAt: string; resources: IncidentResource[]; timeline: IncidentTimelineEntry[] };
type NativeEmergencyReceipt = { id: string; code: string; category: string; outcome: string; occurredAt: string; processedAt: string; incidentId: string | null };
type DurableIncidentsPayload = { ok: boolean; incidents: OperationsIncident[]; counts?: Record<string, number> };

const ALERT_POLICY_LABELS: Record<string, string> = {
  "cluster:dependency:storage": "Storage dependency",
  "cluster:dependency:background-tasks": "Background tasks",
  "cluster:native:gateway": "Native web gateway",
  "cluster:native:api-process": "Native API process",
  "cluster:native:api-dependencies": "Native API dependencies",
  "cluster:native:native-host": "Native Windows host",
  "cluster:native:network-deployment": "Native network rollback",
};
function timeLabel(value?: string | null) { if (!value) return "Unknown"; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown"; }
function stateLabel(value?: string | null) { if (!value) return "Unknown"; return value.replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }
function operationalTone(state?: OperationalState | null) { if (!state || state === "healthy") return "good"; if (["degraded", "read-only", "maintenance", "draining"].includes(state)) return "warning"; return "danger"; }
function severityTone(severity: IncidentSeverity) { return severity === "critical" ? "danger" : severity === "high" ? "warning" : severity === "medium" ? "warning" : ""; }
function activeIncident(status: IncidentStatus) { return status !== "resolved" && status !== "closed"; }

export function OperationsIncidentsPanel() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [transitions, setTransitions] = useState<TransitionPayload | null>(null);
  const [incidents, setIncidents] = useState<OperationsIncident[]>([]);
  const [alertPolicies, setAlertPolicies] = useState<AlertPolicy[]>([]);
  const [alertTargets, setAlertTargets] = useState<AlertPolicyPayload["targets"]>({ users: [], teams: [], departments: [] });
  const [nativeHistory, setNativeHistory] = useState<NativeEmergencyReceipt[] | null>(null);
  const [nativeHistoryBusy, setNativeHistoryBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<OperationsIncident | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [correlationId, setCorrelationId] = useState("");
  const [note, setNote] = useState("");
  const { pending: busy, begin: beginAction, finish: finishAction } = useClusterActionFlight();
  const detailGeneration = useRef(createClusterLatestResponse());
  const selectedIdRef = useRef("");
  const createIntent = useRef(createClusterCreateIntentControl());
  const noteIntent = useRef(createClusterCreateIntentControl());
  const [status, setStatus] = useState("Loading operational evidence...");
  const loadingRef = useRef(false);

  function chooseIncident(id: string, initial: OperationsIncident | null = null) {
    selectedIdRef.current = id;
    detailGeneration.current.invalidate();
    setSelectedId(id);
    setSelected(initial);
    setNote("");
  }

  async function loadIncident(id: string) {
    const generation = detailGeneration.current.next();
    if (!id) { if (detailGeneration.current.isCurrent(generation)) setSelected(null); return; }
    try {
      const result = await api<{ ok: true; incident: OperationsIncident }>(`/api/admin/operations/incidents/${encodeURIComponent(id)}`);
      if (detailGeneration.current.isCurrent(generation) && selectedIdRef.current === id) setSelected(result.incident);
    } catch (error) {
      if (detailGeneration.current.isCurrent(generation) && selectedIdRef.current === id)
        setStatus(error instanceof Error ? error.message : "Incident details could not be loaded.");
    }
  }

  async function load(silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setStatus("Loading operational evidence...");
    try {
      const [nextHealth, nextTransitions, nextIncidents] = await Promise.all([
        queryApi<HealthPayload>("/api/admin/operations/health", { staleMs: 10_000, maxAgeMs: 60_000, persist: false, tags: ["operations"] }),
        queryApi<TransitionPayload>("/api/admin/operations/health-transitions", { staleMs: 10_000, maxAgeMs: 60_000, persist: false, tags: ["operations"] }),
        api<DurableIncidentsPayload>("/api/admin/operations/incidents?limit=100"),
      ]);
      setHealth(nextHealth);
      setTransitions(nextTransitions);
      setIncidents(nextIncidents.incidents || []);
      if (!silent) setStatus(`Operational evidence refreshed ${timeLabel(nextHealth.generatedAt)}.`);
    } catch (error) {
      if (!silent) setStatus(error instanceof Error ? error.message : "Operational evidence could not be loaded.");
    } finally { loadingRef.current = false; }
  }

  async function loadAlertPolicies() {
    const result = await api<AlertPolicyPayload>("/api/admin/operations/alert-policies");
    setAlertPolicies(result.policies);
    setAlertTargets(result.targets);
  }

  async function loadNativeHistory() {
    if (nativeHistoryBusy) return;
    setNativeHistoryBusy(true);
    try {
      const response = await api<{ ok: true; records: NativeEmergencyReceipt[] }>("/api/admin/operations/native-emergency-history");
      setNativeHistory(response.records);
      setStatus(`Native supervisor reconciliation evidence loaded (${response.records.length} recent records).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Native supervisor reconciliation evidence unavailable.");
    } finally { setNativeHistoryBusy(false); }
  }

  function editAlertPolicy(key: string, update: Partial<AlertPolicy>) {
    setAlertPolicies((existing) => existing.map((policy) => policy.key === key ? { ...policy, ...update } : policy));
  }

  function targetOptions(type: AlertTargetType) {
    return type === "user" ? alertTargets.users : type === "team" ? alertTargets.teams : type === "department" ? alertTargets.departments : [];
  }

  async function saveAlertPolicies() {
    if (!alertPolicies.length || busy) return;
    try {
      const response = await api<{ user: { pinConfigured?: boolean } | null }>("/api/me");
      const pin = response.user?.pinConfigured
        ? await requestSecurityPin({ title: "Save alert settings", description: "", purpose: "save_operational_alert_policies" })
        : await requestSecurityPinSetup({ title: "Set security PIN", purpose: "setup_for_operational_alert_policies" });
      if (!pin || !beginAction("policy:save")) return;
      const result = await api<{ ok: true; policies: AlertPolicy[] }>("/api/admin/operations/alert-policies", {
        method: "PUT", body: JSON.stringify({
          securityPin: pin,
          policies: alertPolicies.map((policy) => ({
            key: policy.key, enabled: policy.enabled,
            recipientType: policy.recipientType, recipientId: policy.recipientId,
            escalationType: policy.escalationType, escalationId: policy.escalationId,
            acknowledgeMinutes: policy.acknowledgeMinutes, reminderMinutes: policy.reminderMinutes,
            expectedRevision: policy.revision,
          })),
        }),
      });
      setAlertPolicies(result.policies);
      setStatus("System alert policies saved together. Assignment changes take effect on the next incident check.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Alert policy changes failed. No policy changes were applied.");
    } finally { finishAction("policy:save"); }
  }

  async function acknowledgeIncident() {
    const incident = selected;
    if (!incident || !beginAction("acknowledge")) return;
    try {
      await api(`/api/admin/operations/incidents/${encodeURIComponent(incident.id)}/acknowledge`, { method: "POST" });
      if (selectedIdRef.current === incident.id) await loadIncident(incident.id);
      setStatus("Incident acknowledged. Automatic reminders for this incident cycle will stop.");
      await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Incident acknowledgement could not be confirmed."); }
    finally { finishAction("acknowledge"); }
  }

  useEffect(() => {
    // Navigation can arrive before this panel mounts or while it remains open.
    // Validate the identity locally, then let the admin-only incident endpoint
    // independently authorize the actual detail fetch.
    const initial = incidentIdFromInspect(new URLSearchParams(window.location.search).get("inspect"));
    if (initial) chooseIncident(initial);
    const onInspector = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; id?: string | null }>).detail;
      if (detail?.scope !== "operations-incident") return;
      if (!detail.id) { chooseIncident(""); return; }
      const id = incidentIdFromInspect("operations-incident:" + detail.id);
      if (id) chooseIncident(id);
    };
    window.addEventListener("cluster:inspector-state-changed", onInspector);
    return () => window.removeEventListener("cluster:inspector-state-changed", onInspector);
  }, []);
  useEffect(() => { void loadAlertPolicies().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load alert policies.")); }, []);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (selectedId) void loadIncident(selectedId); }, [selectedId]);
  useEffect(() => () => detailGeneration.current.invalidate(), []);
  useVisibleRefresh(() => load(true), { intervalMs: 20_000 });

  async function createIncident() {
    if (!title.trim() || !beginAction("create")) return;
    if (!createIntent.current.begin()) { finishAction("create"); return; }
    // A retry after a timeout uses the same receipt key for the same payload.
    const body = JSON.stringify({
      title: title.trim(), summary: summary.trim(), severity,
      correlationId: correlationId.trim() || null,
      resources: [{ kind: "server", id: "cluster", label: "Cluster server" }],
    });
    const key = createIntent.current.requestKey("POST", "/api/admin/operations/incidents", body);
    try {
      const result = await api<{ ok: true; incident: OperationsIncident }>("/api/admin/operations/incidents", {
        method: "POST", headers: { "x-cluster-idempotency-key": key }, body,
      });
      createIntent.current.commit();
      setTitle(""); setSummary(""); setCorrelationId(""); setSeverity("medium");
      chooseIncident(result.incident.id, result.incident);
      setStatus(`Incident ${result.incident.id} opened and assigned to its operator.`);
      // The incident is confirmed. A refresh failure must not encourage a new submission.
      await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Incident outcome is uncertain. Check the incident list before retrying."); }
    finally {
      createIntent.current.finish();
      if (createIntent.current.committed) createIntent.current.reset();
      finishAction("create");
    }
  }

  async function updateIncident(nextStatus?: IncidentStatus) {
    const incident = selected;
    if (!incident || !beginAction("update")) return;
    const text = note.trim();
    try {
      const result = await api<{ ok: true; incident: OperationsIncident }>(`/api/admin/operations/incidents/${encodeURIComponent(incident.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...(nextStatus ? { status: nextStatus } : {}), ...(text ? { note: text } : {}) }),
      });
      if (selectedIdRef.current === incident.id) {
        detailGeneration.current.invalidate();
        setSelected(result.incident);
        setNote("");
      }
      setStatus(`Incident ${stateLabel(result.incident.status)}.`);
      await load(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Incident update outcome could not be confirmed."); }
    finally { finishAction("update"); }
  }

  async function addNote() {
    const incident = selected;
    const text = note.trim();
    if (!incident || !text || !beginAction("note")) return;
    const body = JSON.stringify({ kind: "note", message: text });
    const key = noteIntent.current.requestKey("POST", `/api/admin/operations/incidents/${incident.id}/timeline`, body);
    try {
      await api(`/api/admin/operations/incidents/${encodeURIComponent(incident.id)}/timeline`, {
        method: "POST", headers: { "x-cluster-idempotency-key": key }, body,
      });
      if (selectedIdRef.current === incident.id) {
        setNote("");
        await loadIncident(incident.id);
      }
      // New intentional note can reuse the same text with a fresh key later.
      noteIntent.current.reset();
      setStatus("Investigation note added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Investigation note outcome is uncertain. Check the timeline before retrying."); }
    finally { finishAction("note"); }
  }

  const checks = health?.operational?.checks || [];
  const unhealthyChecks = checks.filter((check) => !["pass", "healthy", "ok", "ready"].includes(String(check.status || "").toLowerCase()));
  const recentTransitions = useMemo(() => [...(transitions?.incidents || [])].reverse(), [transitions?.incidents]);
  const activeIncidents = incidents.filter((incident) => activeIncident(incident.status));
  const criticalIncidents = activeIncidents.filter((incident) => incident.severity === "critical").length;
  const jobReview = (health?.durableJobs?.counts?.failed || 0) + (health?.durableJobs?.counts?.deadLetter || 0);
  const current = transitions?.current || health?.operational?.state || "unknown";

  return (
    <section className="panel operations-incidents-v510" aria-labelledby="operations-incidents-title-v510">
      <div className="section-heading">
        <div><p className="eyebrow">Operations 2.0</p><h2 id="operations-incidents-title-v510">Incidents & health</h2></div>
        <ClusterButton type="button" variant="secondary" onClick={() => void load()} disabled={loadingRef.current}>Refresh</ClusterButton>
      </div>

      <div className="cluster-visual-summary-grid" aria-label="Incident and health overview">
        <div className={`cluster-visual-posture tone-${operationalTone(current)}`}><span>Server</span><strong>{stateLabel(current)}</strong></div>
        <ClusterVisualComposition label="Open incident severity" total={activeIncidents.length} parts={[
          { label: "Critical", value: criticalIncidents, tone: "danger" },
          { label: "High", value: activeIncidents.filter((incident) => incident.severity === "high").length, tone: "warning" },
          { label: "Other", value: Math.max(0, activeIncidents.length - criticalIncidents - activeIncidents.filter((incident) => incident.severity === "high").length), tone: "neutral" },
        ]} />
        <ClusterVisualComposition label="Operational checks" total={checks.length} parts={[
          { label: "Passing", value: Math.max(0, checks.length - unhealthyChecks.length), tone: "good" },
          { label: "Needs review", value: unhealthyChecks.length, tone: "warning" },
        ]} />
        {(jobReview > 0 || (health?.performanceBudgets?.failures || 0) > 0) && <div className="cluster-visual-signal-list" role="status">
          {jobReview > 0 && <span className="danger">{jobReview} failed jobs</span>}
          {(health?.performanceBudgets?.failures || 0) > 0 && <span className="danger">{health?.performanceBudgets?.failures} performance failures</span>}
        </div>}
      </div>
      <details className="cluster-visual-advanced"><summary>Exact incident & diagnostic counts</summary><div className="cluster-visual-advanced__body">
      <ClusterMetricStrip label="Operational incident summary" items={[
        { label: "Current state", value: stateLabel(current), tone: operationalTone(current) as "good" | "warning" | "danger" },
        { label: "Open incidents", value: activeIncidents.length, detail: `${criticalIncidents} critical`, tone: criticalIncidents ? "danger" : activeIncidents.length ? "warning" : "good" },
        { label: "Health checks", value: checks.length, detail: `${unhealthyChecks.length} need review`, tone: unhealthyChecks.length ? "warning" : "good" },
        { label: "Job failures", value: jobReview, detail: `${health?.durableJobs?.counts?.running || 0} running`, tone: jobReview ? "danger" : "good" },
        { label: "Performance", value: health?.performanceBudgets?.failures || 0, detail: `${health?.performanceBudgets?.warnings || 0} warnings`, tone: health?.performanceBudgets?.failures ? "danger" : health?.performanceBudgets?.warnings ? "warning" : "good" },
      ]} />
      </div></details>

      <section className="panel" aria-label="Automated incident alert routing">
        <header className="section-heading"><div><h3>System incident alerts</h3></div></header>
        <div className="admin-split-grid">
          {alertPolicies.map((policy) => <div className="panel" key={policy.key}>
            <h4>{ALERT_POLICY_LABELS[policy.key] || policy.key}</h4>
            <label><ClusterInput type="checkbox" checked={policy.enabled} onChange={(event) => editAlertPolicy(policy.key, { enabled: event.target.checked })} /> Automated alerts enabled</label>
            {(["recipient", "escalation"] as const).map((stage) => {
              const typeKey = stage === "recipient" ? "recipientType" : "escalationType";
              const idKey = stage === "recipient" ? "recipientId" : "escalationId";
              return <div className="form-grid" key={stage}>
                <label><span>{stage === "recipient" ? "Primary responsibility" : "Escalate to"}</span>
                  <ClusterNativeSelect value={policy[typeKey]} onChange={(event) => editAlertPolicy(policy.key, stage === "recipient" ? { recipientType: event.target.value as AlertTargetType, recipientId: null } : { escalationType: event.target.value as AlertTargetType, escalationId: null })}>
                    <option value="admins">All administrators</option><option value="user">Specific administrator</option><option value="team">Team</option><option value="department">Department</option>
                  </ClusterNativeSelect>
                </label>
                {policy[typeKey] !== "admins" ? <label><span>{stage === "recipient" ? "Assigned target" : "Escalation target"}</span>
                  <ClusterNativeSelect value={policy[idKey] || ""} onChange={(event) => editAlertPolicy(policy.key, stage === "recipient" ? { recipientId: event.target.value || null } : { escalationId: event.target.value || null })}>
                    <option value="">Choose target</option>
                    {targetOptions(policy[typeKey]).map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
                  </ClusterNativeSelect>
                </label> : null}
              </div>;
            })}
            <div className="form-grid">
              <label><span>Remind after (minutes)</span><ClusterInput type="number" min={2} max={1440} value={policy.reminderMinutes} onChange={(event) => editAlertPolicy(policy.key, { reminderMinutes: Number(event.target.value) })} /></label>
              <label><span>Escalate after (minutes)</span><ClusterInput type="number" min={2} max={1440} value={policy.acknowledgeMinutes} onChange={(event) => editAlertPolicy(policy.key, { acknowledgeMinutes: Number(event.target.value) })} /></label>
            </div>
          </div>)}
        </div>
        <ClusterButton type="button" variant="primary" disabled={Boolean(busy) || !alertPolicies.length || alertPolicies.some((policy) => (policy.recipientType !== "admins" && !policy.recipientId) || (policy.escalationType !== "admins" && !policy.escalationId))} onClick={() => void saveAlertPolicies()}>Save alert settings</ClusterButton>
      </section>

      <section className="panel" aria-label="Native emergency reconciliation history">
        <header className="section-heading"><div><h3>Native supervisor recovery evidence</h3></div>
          <ClusterButton type="button" variant="secondary" disabled={nativeHistoryBusy} onClick={() => void loadNativeHistory()}>{nativeHistoryBusy ? "Loading…" : "Inspect recent native events"}</ClusterButton>
        </header>
        {nativeHistory !== null ? <div className="control-domain-list-v136">
          {nativeHistory.map((item) => <article className="control-domain-card-v136" key={item.id}>
            <div><strong>{stateLabel(item.code)}</strong><span>{stateLabel(item.outcome)} · {stateLabel(item.category)} · occurred {timeLabel(item.occurredAt)}</span><small>Native event {item.id} · imported {timeLabel(item.processedAt)}</small></div>
            <em>{item.incidentId ? "Linked incident" : "Evidence only"}</em>
          </article>)}
          {!nativeHistory.length ? <ClusterEmptyState compact kind="empty" title="No reconciled native events" description="No native emergency records have been imported into the canonical database yet." /> : null}
        </div> : null}
      </section>

      <div className="admin-split-grid">
        <section className="panel">
          <header className="section-heading"><div><h3>Open incident</h3></div></header>
          <div className="form-grid">
            <label><span>Title</span><ClusterInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Search indexing unavailable" /></label>
            <label><span>Severity</span><ClusterNativeSelect value={severity} onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></ClusterNativeSelect></label>
            <label className="wide"><span>Summary</span><ClusterTextarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Observed impact and current evidence." /></label>
            <label className="wide"><span>Correlation / trace ID</span><ClusterInput value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="Optional operation, request, or event correlation ID" /></label>
          </div>
          <ClusterButton type="button" variant="primary" disabled={Boolean(busy) || !title.trim()} aria-busy={busy === "create"} onClick={() => void createIncident()}>{busy === "create" ? "Opening…" : "Open incident"}</ClusterButton>
        </section>

        <section className="panel">
          <header className="section-heading"><div><h3>Registered health checks</h3><p className="muted tight">Current evidence from the canonical operational health runtime.</p></div></header>
          <div className="control-domain-list-v136">
            {checks.map((check) => { const healthy = ["pass", "healthy", "ok", "ready"].includes(String(check.status || "").toLowerCase()); return <article className={`control-domain-card-v136 ${healthy ? "good" : "warning"}`} key={check.key}><div><strong>{check.label || stateLabel(check.key)}</strong><span>{check.message || `Status: ${stateLabel(check.status)}`}</span></div><em>{stateLabel(check.status)}</em></article>; })}
            {!checks.length ? <ClusterEmptyState compact kind="empty" title="No health-check evidence" description="Registered server checks will appear after the operational health runtime reports a sample." /> : null}
          </div>
        </section>
      </div>

      <div className="admin-split-grid">
        <section className="panel">
          <header className="section-heading"><div><h3>Incident queue</h3><p className="muted tight">Durable operational incidents ordered by active state and most recent work.</p></div></header>
          <div className="control-domain-list-v136">
            {incidents.map((incident) => <button type="button" className={`control-domain-card-v136 ${severityTone(incident.severity)} ${selectedId === incident.id ? "selected" : ""}`} key={incident.id} onClick={() => chooseIncident(incident.id)}>
              <div><strong>{incident.title}</strong><span>{stateLabel(incident.status)} · owner {incident.ownerName || "Unassigned"} · updated {timeLabel(incident.updatedAt)}</span><small>{incident.resources.map((resource) => resource.label || `${resource.kind}:${resource.resourceId}`).join(" · ") || "No affected resources recorded"}</small></div><em>{incident.severity}</em>
            </button>)}
            {!incidents.length ? <ClusterEmptyState compact kind="empty" title="No durable incidents" description="Operational state changes remain visible below, but only operator-owned incidents appear in this queue." /> : null}
          </div>
        </section>

        <section className="panel">
          <header className="section-heading"><div><h3>Investigation</h3><p className="muted tight">Incident timeline, correlation evidence, and controlled status transitions.</p></div></header>
          {selected ? <>
            <div className="status-box"><strong>{selected.title}</strong><span>{selected.summary || "No summary recorded."}</span><small>{selected.severity.toUpperCase()} · {stateLabel(selected.status)} · owner {selected.ownerName || "Unassigned"} · opened {timeLabel(selected.openedAt)} · {selected.acknowledgedAt ? `acknowledged ${timeLabel(selected.acknowledgedAt)}` : "awaiting acknowledgement"}{selected.correlationId ? ` · trace ${selected.correlationId}` : ""}</small></div>
            <div className="control-domain-list-v136">{selected.timeline.map((entry) => <article className="control-domain-card-v136" key={entry.id}><div><strong>{stateLabel(entry.kind)}</strong><span>{entry.message}</span><small>{entry.actorName || "System"}{entry.correlationId ? ` · trace ${entry.correlationId}` : ""}</small></div><em>{timeLabel(entry.createdAt)}</em></article>)}</div>
            <label><span>Investigation note</span><ClusterTextarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evidence, mitigation, decision, or handoff note" /></label>
            <div className="button-row">
              <ClusterButton type="button" variant="secondary" disabled={Boolean(busy) || !note.trim()} aria-busy={busy === "note"} onClick={() => void addNote()}>{busy === "note" ? "Adding…" : "Add note"}</ClusterButton>
              {activeIncident(selected.status) && !selected.acknowledgedAt ? <ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} aria-busy={busy === "acknowledge"} onClick={() => void acknowledgeIncident()}>Acknowledge response</ClusterButton> : null}
              {selected.status === "open" ? <ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} aria-busy={busy === "update"} onClick={() => void updateIncident("investigating")}>Investigate</ClusterButton> : null}
              {selected.status === "investigating" ? <ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} aria-busy={busy === "update"} onClick={() => void updateIncident("mitigating")}>Mitigating</ClusterButton> : null}
              {selected.status === "mitigating" ? <ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} aria-busy={busy === "update"} onClick={() => void updateIncident("monitoring")}>Monitor</ClusterButton> : null}
              {activeIncident(selected.status) ? <ClusterButton type="button" variant="primary" disabled={Boolean(busy)} aria-busy={busy === "update"} onClick={() => void updateIncident("resolved")}>Resolve</ClusterButton> : null}
              {selected.status === "resolved" ? <ClusterButton type="button" variant="secondary" disabled={Boolean(busy)} aria-busy={busy === "update"} onClick={() => void updateIncident("closed")}>Close</ClusterButton> : null}
            </div>
          </> : <ClusterEmptyState compact kind="empty" title="Select an incident" description="Choose an incident to inspect its owner, affected resources, trace ID, and investigation timeline." />}
        </section>
      </div>

      <section className="panel">
        <header className="section-heading"><div><h3>Health-state transition evidence</h3><p className="muted tight">The health authority retains bounded transitions separately from operator-managed incidents.</p></div><span className="soft-pill">{recentTransitions.length} retained</span></header>
        <div className="control-domain-list-v136">
          {recentTransitions.map((transition, index) => <article className={`control-domain-card-v136 ${operationalTone(transition.to)}`} key={`${transition.at}:${transition.to}:${index}`}><div><strong>{stateLabel(transition.from || "startup")} → {stateLabel(transition.to)}</strong><span>{transition.reasons.length ? transition.reasons.join(" · ") : "No additional reason was recorded."}</span></div><em>{timeLabel(transition.at)}</em></article>)}
          {!recentTransitions.length ? <ClusterEmptyState compact kind="empty" title="No operational transitions retained" description="The server has not changed operational state during the retained history window." /> : null}
        </div>
      </section>

      <RequestStatusLine>{status}</RequestStatusLine>
    </section>
  );
}
