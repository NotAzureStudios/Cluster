import { useEffect, useMemo, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterToggle } from "../../components/ClusterToggle";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { api, queryApi } from "../../core/api";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useClusterActionFlight } from "../../components/useClusterActionFlight";
import { createClusterLatestResponse } from "../../components/cluster-action-flight";
import { createClusterCreateIntentControl } from "../create/create-intent-control";
import { incidentIdFromInspect } from "./incident-link";
import "./admin-ops.css";

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
// Newest first. Alert deliveries (initial, reminders, escalations) fold into
// the status change that triggered them instead of filling the timeline.
function compactTimeline(timeline: IncidentTimelineEntry[]) {
  const rows: Array<{ entry: IncidentTimelineEntry; alerts: number }> = [];
  for (const entry of timeline) {
    const last = rows[rows.length - 1];
    if (entry.kind === "alert" && / delivered to /.test(entry.message) && last) last.alerts += 1;
    else rows.push({ entry, alerts: 0 });
  }
  return rows.reverse();
}

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
  const [creating, setCreating] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
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
      if (!silent) setStatus("");
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

  const highIncidents = activeIncidents.filter((incident) => incident.severity === "high").length;
  const alertsInvalid = alertPolicies.some((policy) => (policy.recipientType !== "admins" && !policy.recipientId) || (policy.escalationType !== "admins" && !policy.escalationId));
  const statusAction = selected ? ({ open: ["investigating", "Investigate"], investigating: ["mitigating", "Mitigating"], mitigating: ["monitoring", "Monitor"] } as Record<string, [IncidentStatus, string]>)[selected.status] : undefined;

  const targetSelect = (policy: AlertPolicy, stage: "recipient" | "escalation") => {
    const typeKey = stage === "recipient" ? "recipientType" : "escalationType";
    const idKey = stage === "recipient" ? "recipientId" : "escalationId";
    return <>
      <ClusterNativeSelect aria-label={`${ALERT_POLICY_LABELS[policy.key] || policy.key} ${stage === "recipient" ? "owner" : "escalation"}`} value={policy[typeKey]} onChange={(event) => editAlertPolicy(policy.key, stage === "recipient" ? { recipientType: event.target.value as AlertTargetType, recipientId: null } : { escalationType: event.target.value as AlertTargetType, escalationId: null })}>
        <option value="admins">Admins</option><option value="user">Person</option><option value="team">Team</option><option value="department">Department</option>
      </ClusterNativeSelect>
      {policy[typeKey] !== "admins" ? <ClusterNativeSelect aria-label={`${stage} target`} value={policy[idKey] || ""} onChange={(event) => editAlertPolicy(policy.key, stage === "recipient" ? { recipientId: event.target.value || null } : { escalationId: event.target.value || null })}>
        <option value="">Choose…</option>
        {targetOptions(policy[typeKey]).map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
      </ClusterNativeSelect> : null}
    </>;
  };

  return (
    <section className="ao operations-incidents-v510" aria-label="Incidents">
      <div className="ao-bar">
        <div className="ao-chips">
          <span className="ao-chip" data-tone={operationalTone(current)}><span>Server</span><b>{stateLabel(current)}</b></span>
          <span className="ao-chip" data-tone={criticalIncidents ? "danger" : highIncidents ? "warning" : activeIncidents.length ? "accent" : "good"} title={`${criticalIncidents} critical · ${highIncidents} high`}><span>Open</span><b>{activeIncidents.length}</b></span>
          <span className="ao-chip" data-tone={unhealthyChecks.length ? "warning" : "good"}><span>Checks</span><b>{checks.length - unhealthyChecks.length}/{checks.length}</b></span>
          {jobReview ? <span className="ao-chip" data-tone="danger"><span>Failed jobs</span><b>{jobReview}</b></span> : null}
          {health?.performanceBudgets?.failures ? <span className="ao-chip" data-tone="danger"><span>Slow</span><b>{health.performanceBudgets.failures}</b></span> : null}
        </div>
        <span className="ao-bar__end">
          {status ? <span className="ao-msg" role="status">{status}</span> : null}
          <ClusterButton type="button" size="compact" variant={alertsOpen ? "secondary" : "quiet"} onClick={() => setAlertsOpen((open) => !open)}><ClusterIcon name="bell" />Alerts</ClusterButton>
          <ClusterButton type="button" size="compact" variant={creating ? "quiet" : "primary"} onClick={() => setCreating((open) => !open)}><ClusterIcon name={creating ? "close" : "plus"} />{creating ? "Cancel" : "Open incident"}</ClusterButton>
        </span>
      </div>

      {creating ? <div className="ao-card" aria-label="Open incident">
        <div className="ao-form">
          <label className="ao-field ao-field--grow"><span>Title</span><ClusterInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is wrong" autoFocus /></label>
          <label className="ao-field"><span>Severity</span><ClusterNativeSelect value={severity} onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></ClusterNativeSelect></label>
          <label className="ao-field"><span>Trace ID</span><ClusterInput value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="Optional" /></label>
          <label className="ao-field ao-field--wide"><span>Impact</span><ClusterTextarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What people see, what you know so far" /></label>
          <ClusterButton type="button" size="compact" variant="primary" disabled={Boolean(busy) || !title.trim()} aria-busy={busy === "create"} onClick={() => void createIncident().then(() => setCreating(false))}>{busy === "create" ? "Opening…" : "Open"}</ClusterButton>
        </div>
      </div> : null}

      {alertsOpen ? <section className="ao-card" aria-label="Automated incident alert routing">
        <h3 className="ao-card__title">Alerts <small>who is notified when a system check fails</small>
          <ClusterButton type="button" size="compact" variant="primary" disabled={Boolean(busy) || !alertPolicies.length || alertsInvalid} onClick={() => void saveAlertPolicies()}>Save</ClusterButton>
        </h3>
        <ul className="ao-rows">
          {alertPolicies.map((policy) => <li key={policy.key} className="ao-row ao-alert">
            <ClusterToggle checked={policy.enabled} aria-label={`${ALERT_POLICY_LABELS[policy.key] || policy.key} alerts`} onCheckedChange={(checked) => editAlertPolicy(policy.key, { enabled: checked })} />
            <span className="ao-row__main"><b>{ALERT_POLICY_LABELS[policy.key] || policy.key}</b></span>
            <span className="ao-inline">
              <label>Notify</label>{targetSelect(policy, "recipient")}
              <label>remind</label><ClusterInput type="number" aria-label="Remind after minutes" min={2} max={1440} value={policy.reminderMinutes} onChange={(event) => editAlertPolicy(policy.key, { reminderMinutes: Number(event.target.value) })} /><label>min · escalate to</label>
              {targetSelect(policy, "escalation")}
              <label>after</label><ClusterInput type="number" aria-label="Escalate after minutes" min={2} max={1440} value={policy.acknowledgeMinutes} onChange={(event) => editAlertPolicy(policy.key, { acknowledgeMinutes: Number(event.target.value) })} /><label>min</label>
            </span>
          </li>)}
        </ul>
      </section> : null}

      <div className="ao-grid">
        <section className="ao-card" aria-label="Incident queue">
          <h3 className="ao-card__title">Incidents <small>{incidents.length}</small></h3>
          {incidents.length ? <ul className="ao-rows">
            {incidents.map((incident) => <li key={incident.id}>
              <button type="button" className="ao-row ao-row--button" aria-pressed={selectedId === incident.id} data-tone={severityTone(incident.severity) || "accent"} onClick={() => chooseIncident(incident.id)}>
                <i className="ao-dot" aria-hidden="true" />
                <span className="ao-row__main"><b>{incident.title}</b><small>{stateLabel(incident.status)} · {incident.ownerName || "Unassigned"} · {timeLabel(incident.updatedAt)}</small></span>
                <span className="ao-pill">{incident.severity}</span>
              </button>
            </li>)}
          </ul> : <p className="ao-empty">No incidents.</p>}
        </section>

        <section className="ao-card" aria-label="Investigation">
          {selected ? <>
            <h3 className="ao-card__title">{selected.title} <span className="ao-pill" data-tone={severityTone(selected.severity) || "accent"}>{stateLabel(selected.status)}</span></h3>
            <p className="ao-sub">{selected.summary || "No summary."} · {selected.ownerName || "Unassigned"} · opened {timeLabel(selected.openedAt)}{selected.acknowledgedAt ? "" : " · not acknowledged"}{selected.correlationId ? ` · trace ${selected.correlationId}` : ""}</p>
            <ul className="ao-rows">{compactTimeline(selected.timeline).map(({ entry, alerts }) => <li key={entry.id} className="ao-row ao-row--plain">
              <span className="ao-row__main"><b>{stateLabel(entry.kind)}</b><small className="ao-wrap">{entry.message}{alerts ? ` · ${alerts} alert${alerts === 1 ? "" : "s"} sent` : ""}</small></span>
              <span className="ao-row__end"><small>{entry.actorName || "System"} · {timeLabel(entry.createdAt)}</small></span>
            </li>)}</ul>
            <div className="ao-form">
              <label className="ao-field ao-field--grow"><span>Note</span><ClusterInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evidence, mitigation, handoff" /></label>
              <ClusterButton type="button" size="compact" variant="secondary" disabled={Boolean(busy) || !note.trim()} aria-busy={busy === "note"} onClick={() => void addNote()}>{busy === "note" ? "Adding…" : "Add note"}</ClusterButton>
            </div>
            <div className="ao-bar">
              {activeIncident(selected.status) && !selected.acknowledgedAt ? <ClusterButton type="button" size="compact" variant="secondary" disabled={Boolean(busy)} onClick={() => void acknowledgeIncident()}>Acknowledge</ClusterButton> : null}
              {statusAction ? <ClusterButton type="button" size="compact" variant="secondary" disabled={Boolean(busy)} onClick={() => void updateIncident(statusAction[0])}>{statusAction[1]}</ClusterButton> : null}
              {activeIncident(selected.status) ? <ClusterButton type="button" size="compact" variant="primary" disabled={Boolean(busy)} onClick={() => void updateIncident("resolved")}>Resolve</ClusterButton> : null}
              {selected.status === "resolved" ? <ClusterButton type="button" size="compact" variant="secondary" disabled={Boolean(busy)} onClick={() => void updateIncident("closed")}>Close</ClusterButton> : null}
            </div>
          </> : <><h3 className="ao-card__title">Investigation</h3><p className="ao-empty">Select an incident.</p></>}
        </section>

        <section className="ao-card" aria-label="Health checks">
          <h3 className="ao-card__title">Checks <small>{checks.length}</small></h3>
          {checks.length ? <ul className="ao-rows">{checks.map((check) => {
            const healthy = ["pass", "healthy", "ok", "ready"].includes(String(check.status || "").toLowerCase());
            return <li key={check.key} className="ao-row" data-tone={healthy ? "good" : "warning"}>
              <i className="ao-dot" aria-hidden="true" />
              <span className="ao-row__main"><b>{check.label || stateLabel(check.key)}</b>{check.message ? <small title={check.message}>{check.message}</small> : null}</span>
              <span className="ao-row__end"><small>{stateLabel(check.status)}</small></span>
            </li>;
          })}</ul> : <p className="ao-empty">No checks reported yet.</p>}
        </section>

        <section className="ao-card" aria-label="State changes">
          <h3 className="ao-card__title">State changes <small>{recentTransitions.length}</small>
            <ClusterButton type="button" size="compact" variant="quiet" disabled={nativeHistoryBusy} onClick={() => void loadNativeHistory()}>{nativeHistoryBusy ? "Loading…" : "Native events"}</ClusterButton>
          </h3>
          {recentTransitions.length ? <ul className="ao-rows">{recentTransitions.slice(0, 12).map((transition, index) => <li key={`${transition.at}:${transition.to}:${index}`} className="ao-row" data-tone={operationalTone(transition.to)}>
            <i className="ao-dot" aria-hidden="true" />
            <span className="ao-row__main"><b>{stateLabel(transition.from || "startup")} → {stateLabel(transition.to)}</b>{transition.reasons.length ? <small title={transition.reasons.join(" · ")}>{transition.reasons.join(" · ")}</small> : null}</span>
            <span className="ao-row__end"><small>{timeLabel(transition.at)}</small></span>
          </li>)}</ul> : <p className="ao-empty">No changes.</p>}
          {nativeHistory !== null ? <ul className="ao-rows">{nativeHistory.map((item) => <li key={item.id} className="ao-row ao-row--plain">
            <span className="ao-row__main"><b>{stateLabel(item.code)}</b><small>{stateLabel(item.outcome)} · {stateLabel(item.category)} · {timeLabel(item.occurredAt)}</small></span>
            <span className="ao-row__end"><small>{item.incidentId ? "Incident" : "Evidence"}</small></span>
          </li>)}{!nativeHistory.length ? <li className="ao-empty">No native events.</li> : null}</ul> : null}
        </section>
      </div>
    </section>
  );
}
