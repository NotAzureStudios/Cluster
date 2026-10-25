import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { LoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import "./server-admin-experience.css";

type OpsHealth = {
  ok: boolean;
  version?: string;
  generatedAt?: string;
  operational?: { ready?: boolean; state?: string; checks?: Array<{ key: string; status: string; detail?: string }> };
  dependencies?: {
    database?: { ok?: boolean; latencyMs?: number; error?: string };
    storage?: { ok?: boolean; error?: string };
    postgres?: {
      provider?: string;
      connections?: { total?: number; active?: number; max?: number; lockWaits?: number };
      workload?: { cacheHitRatio?: number; indexScanRatio?: number; deadRowRatio?: number; temporaryBytes?: number };
      recommendations?: string[];
    };
  };
  durableJobs?: { counts?: { queued?: number; running?: number; failed?: number; deadLetter?: number }; worker?: { concurrency?: number; running?: number; failed?: number } };
  performanceBudgets?: { status?: "pass" | "warn" | "fail"; failures?: number; warnings?: number };
};

type Diagnostics = {
  ok: boolean;
  version?: string;
  generatedAt?: string;
  counts?: Record<string, number>;
  features?: { authRequired?: boolean; rateLimitEnabled?: boolean; secureCookies?: boolean; discordConfigured?: boolean; gitConfigured?: boolean; backupsEnabled?: boolean; encryptionKeyConfigured?: boolean };
  runtime?: { profile?: string; ready?: boolean; uptimeSeconds?: number; configuredOriginCount?: number };
  folders?: Array<{ key: string; path: string; exists: boolean; files?: number; bytes?: number }>;
  healthChecks?: Array<{ key: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
};

type OperatorAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: string;
  title: string;
  detail: string;
  action?: "server-config" | "maintenance" | "reports";
};

type OperatorAlertPreferences = { acknowledged: Record<string, string>; snoozedUntil: Record<string, string> };
type OperatorAlertPreferenceResponse = { ok: boolean; preferences: OperatorAlertPreferences };

type OperatorSnapshot = {
  ok: boolean;
  generatedAt?: string;
  posture?: "healthy" | "warning" | "critical";
  alerts?: OperatorAlert[];
  jobs?: {
    counts?: { queued?: number; running?: number; failed?: number; deadLetter?: number };
    pressure?: {
      oldestQueuedAt?: string | null;
      oldestQueuedAgeMs?: number | null;
      stalledLeases?: number;
      byQueue?: Array<{ queue: string; queued: number; running: number; failed: number; deadLetter: number; total?: number }>;
    };
  };
  sync?: {
    devices?: { total?: number; active15m?: number; stale7d?: number; versions?: Array<{ value: string; count: number }>; platforms?: Array<{ value: string; count: number }>; rows?: Array<{ id: string; name: string; platform: string; clientVersion: string; mutationSchemaVersion?: number; lastSeenAt: string; createdAt: string }> };
    openConflicts?: number;
    failedReceipts24h?: number;
  };
  media?: {
    workers?: { total?: number; online?: number; active?: number; rows?: Array<{ id: string; hostname: string; status: string; desiredState: string; concurrency: number; activeJobs: number; acceleration?: string; lastError?: string | null; lastSeenAt?: string }> };
    queue?: { queued?: number; running?: number; failed?: number; deadLetter?: number; total?: number };
  };
  automation?: { queued?: number; running?: number; failed?: number; deadLetter?: number; rules?: number; pausedRules?: number; draftRules?: number };
  backup?: { enabled?: boolean; retentionDays?: number; generationCount?: number; latestCreatedAt?: string | null; latestVerified?: boolean | null; latestVerificationOk?: boolean | null; latestRestoreDrillAt?: string | null; latestRestoreDrillOk?: boolean | null };
  security?: { failures24h?: number; privilegedFailures24h?: number };
  audit?: {
    integrity?: { ok?: boolean; checked?: number; writeFailures?: number; error?: string | null; verifiedAt?: string };
    recent?: Array<{ id: string; event: string; result: string; reasonCode: string; requestPath?: string | null; occurredAt: string }>;
  };
  incidents?: { current?: string | null; incidents?: Array<{ at: string; from?: string | null; to: string; reasons?: string[] }> };
};

type ServerAdminExperienceProps = {
  onOpenServerConfig?: () => void;
  onOpenMaintenance?: () => void;
  onOpenReports?: () => void;
};

function pct(value?: number) { return value == null ? "—" : `${Math.round(value * 1000) / 10}%`; }
function bytes(value?: number) {
  if (value == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? Math.round(amount) : Math.round(amount * 10) / 10} ${units[unit]}`;
}
function duration(seconds?: number) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
function ageLabel(milliseconds?: number | null) {
  if (milliseconds == null || milliseconds <= 0) return "No runnable backlog";
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m oldest`;
  const hours = Math.round(minutes / 6) / 10;
  return `${hours}h oldest`;
}
function timeLabel(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

export function ServerAdminExperiencePanel({ onOpenServerConfig, onOpenMaintenance, onOpenReports }: ServerAdminExperienceProps) {
  const [health, setHealth] = useState<OpsHealth | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [operator, setOperator] = useState<OperatorSnapshot | null>(null);
  const [alertPreferences, setAlertPreferences] = useState<OperatorAlertPreferences>({ acknowledged: {}, snoozedUntil: {} });
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionBusy, setActionBusy] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const refreshSequence = useRef(0);

  async function refresh(force = false) {
    const sequence = ++refreshSequence.current;
    if (!health && !diagnostics && !operator) setLoading(true);
    try {
      setError(null);
      const [nextHealth, nextDiagnostics, nextOperator, nextAlertPreferences] = await Promise.all([
        queryApi<OpsHealth>("/api/admin/operations/health", { force, staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["operations"] }),
        queryApi<Diagnostics>("/api/admin/diagnostics", { force, staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["operations", "diagnostics"] }),
        queryApi<OperatorSnapshot>("/api/admin/operations/control-plane", { force, staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["operations"] }),
        queryApi<OperatorAlertPreferenceResponse>("/api/admin/operations/alert-preferences", { force, staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["operations", "preferences"] }),
      ]);
      if (sequence !== refreshSequence.current) return;
      setHealth(nextHealth);
      setDiagnostics(nextDiagnostics);
      setOperator(nextOperator);
      setAlertPreferences(nextAlertPreferences.preferences || { acknowledged: {}, snoozedUntil: {} });
    } catch (nextError) {
      if (sequence === refreshSequence.current) setError(nextError);
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, []);

  useVisibleRefresh(() => refresh(true), { intervalMs: 30_000 });

  async function runOperatorAction(action: "verify-storage" | "optimize-database" | "download-diagnostics") {
    setActionBusy(action);
    setActionStatus("");
    try {
      if (action === "verify-storage") {
        await api("/api/admin/storage/verify", { method: "POST" });
        setActionStatus("Storage verification completed.");
      } else if (action === "optimize-database") {
        await api("/api/admin/database/optimize", { method: "POST" });
        setActionStatus("Database maintenance completed.");
      } else {
        const bundle = await api<Record<string, unknown>>("/api/admin/diagnostics/bundle");
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cluster-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setActionStatus("Sanitized diagnostic bundle downloaded.");
      }
      if (action !== "download-diagnostics") await refresh(true);
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : "Operational action failed.");
    } finally {
      setActionBusy("");
    }
  }

  function runAlertAction(action?: OperatorAlert["action"]) {
    if (action === "server-config") onOpenServerConfig?.();
    else if (action === "maintenance") onOpenMaintenance?.();
    else if (action === "reports") onOpenReports?.();
  }

  async function updateAlertPreference(alertId: string, action: "acknowledge" | "unacknowledge" | "snooze" | "unsnooze", snoozeMinutes?: number) {
    setActionBusy(`alert:${alertId}`);
    try {
      const response = await api<OperatorAlertPreferenceResponse>("/api/admin/operations/alert-preferences", { method: "PATCH", body: JSON.stringify({ alertId, action, snoozeMinutes }) });
      setAlertPreferences(response.preferences || { acknowledged: {}, snoozedUntil: {} });
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : "Could not update operator alert state.");
    } finally { setActionBusy(""); }
  }

  async function setMediaWorkerState(workerId: string, desiredState: "active" | "drain" | "maintenance") {
    setActionBusy(`worker:${workerId}`);
    setActionStatus("");
    try {
      await api(`/api/admin/media-processing/workers/${encodeURIComponent(workerId)}`, { method: "PATCH", body: JSON.stringify({ desiredState }) });
      setActionStatus(`Media worker set to ${desiredState}.`);
      await refresh();
    } catch (nextError) { setActionStatus(nextError instanceof Error ? nextError.message : "Could not update media worker state."); }
    finally { setActionBusy(""); }
  }

  const folders = diagnostics?.folders || [];
  const missingFolders = folders.filter((folder) => !folder.exists);
  const postgres = health?.dependencies?.postgres;
  const jobs = health?.durableJobs?.counts;
  const checks = diagnostics?.healthChecks || [];
  const failures = checks.filter((item) => item.status === "fail");
  const warnings = checks.filter((item) => item.status === "warn");
  const securityIssues = [
    diagnostics?.features?.authRequired === false ? "Authentication is disabled" : "",
    diagnostics?.features?.secureCookies === false ? "Secure cookies are disabled" : "",
    diagnostics?.features?.rateLimitEnabled === false ? "Rate limiting is disabled" : "",
    diagnostics?.features?.encryptionKeyConfigured === false ? "Custom encryption key is missing" : "",
  ].filter(Boolean);
  const recommendations = useMemo(() => {
    const items: Array<{ title: string; detail: string; action?: string; run?: () => void; tone: string }> = [];
    if (failures.length) items.push({ title: "Runtime checks are failing", detail: failures.slice(0, 2).map((item) => item.detail).join(" · "), action: "Server configuration", run: onOpenServerConfig, tone: "danger" });
    if (securityIssues.length) items.push({ title: "Security posture needs review", detail: securityIssues.slice(0, 2).join(" · "), action: "Server configuration", run: onOpenServerConfig, tone: "warning" });
    if (missingFolders.length) items.push({ title: "Storage paths are incomplete", detail: `${missingFolders.length} required folder${missingFolders.length === 1 ? " is" : "s are"} unavailable.`, action: "Maintenance", run: onOpenMaintenance, tone: "danger" });
    if ((jobs?.deadLetter || 0) > 0 || (jobs?.failed || 0) > 0) items.push({ title: "Background work needs attention", detail: `${jobs?.failed || 0} failed · ${jobs?.deadLetter || 0} dead-letter jobs.`, action: "Maintenance", run: onOpenMaintenance, tone: "warning" });
    if (!diagnostics?.features?.backupsEnabled) items.push({ title: "Backups are not enabled", detail: "Configure a backup policy before treating this server as production-ready.", action: "Server configuration", run: onOpenServerConfig, tone: "warning" });
    return items.slice(0, 3);
  }, [diagnostics, failures, jobs, missingFolders.length, onOpenMaintenance, onOpenServerConfig, securityIssues.length]);

  const alerts = operator?.alerts || [];
  const now = Date.now();
  const snoozedIds = new Set(Object.entries(alertPreferences.snoozedUntil || {}).filter(([, until]) => new Date(String(until)).getTime() > now).map(([id]) => id));
  const acknowledgedIds = new Set(Object.keys(alertPreferences.acknowledged || {}));
  const visibleAlerts = alerts.filter((item) => !snoozedIds.has(item.id) && (showAcknowledged || !acknowledgedIds.has(item.id)));
  const suppressedAlerts = alerts.length - visibleAlerts.length;
  const criticalAlerts = alerts.filter((item) => item.severity === "critical").length;
  const warningAlerts = alerts.filter((item) => item.severity === "warning").length;
  const posture = operator?.posture === "critical" || failures.length || securityIssues.length || missingFolders.length ? "fail" : operator?.posture === "warning" || warnings.length || health?.performanceBudgets?.status === "warn" ? "warn" : "pass";
  const sync = operator?.sync;
  const media = operator?.media;
  const queuePressure = operator?.jobs?.pressure;
  const audit = operator?.audit?.integrity;
  const latestIncident = operator?.incidents?.incidents?.at(-1);
  const queueRows = (queuePressure?.byQueue || []).filter((row) => row.queued || row.running || row.failed || row.deadLetter).slice(0, 5);
  const recentSecurity = operator?.audit?.recent || [];
  const automation = operator?.automation;
  const backup = operator?.backup;
  const security = operator?.security;
  const clientRows = (sync?.devices?.rows || []).filter((client) => { const query = clientQuery.trim().toLowerCase(); return !query || `${client.name} ${client.platform} ${client.clientVersion}`.toLowerCase().includes(query); });

  return (
    <section className="panel server-admin-experience-v420" data-posture={posture}>
      <header className="server-admin-head-v420 server-admin-head-v467">
        <div>
          <h2>Server operations</h2>
          <p>Runtime, queues, client fleet, media workers, storage, and audit posture.</p>
        </div>
        <div className="button-row">
          <span className={`soft-pill ${posture === "pass" ? "good" : posture === "warn" ? "warning" : "danger"}`}>{posture === "pass" ? "Healthy" : posture === "warn" ? "Needs attention" : "Action required"}</span>
          <ClusterButton type="button" className="" disabled={loading} onClick={() => void refresh()} variant="quiet" size="compact">{loading ? "Refreshing…" : "Refresh"}</ClusterButton>
        </div>
      </header>
      {loading && !health && !diagnostics && !operator ? <LoadingState label="Loading server operations" rows={3} compact /> : null}
      {error && !health && !diagnostics && !operator ? <RequestErrorState error={error} title="Server operations unavailable" onRetry={() => void refresh()} compact /> : null}
      {error && (health || diagnostics || operator) ? <RequestErrorState error={error} title="Operations refresh failed" onRetry={() => void refresh()} compact /> : null}

      <div className="server-admin-kpis-v420 server-admin-kpis-v467">
        <article><span>Runtime</span><strong>{health?.operational?.ready || diagnostics?.runtime?.ready ? "Ready" : "Review"}</strong><small>v{health?.version || diagnostics?.version || "—"} · {duration(diagnostics?.runtime?.uptimeSeconds)} uptime</small></article>
        <article><span>Database</span><strong>{health?.dependencies?.database?.ok === false ? "Unavailable" : `${postgres?.connections?.active ?? "—"} active`}</strong><small>{pct(postgres?.workload?.cacheHitRatio)} cache hit · {postgres?.connections?.lockWaits || 0} waits</small></article>
        <article><span>Work queues</span><strong>{(operator?.jobs?.counts?.deadLetter || 0) + (operator?.jobs?.counts?.failed || 0) ? `${(operator?.jobs?.counts?.deadLetter || 0) + (operator?.jobs?.counts?.failed || 0)} review` : "Healthy"}</strong><small>{operator?.jobs?.counts?.queued || 0} queued · {ageLabel(queuePressure?.oldestQueuedAgeMs)}</small></article>
        <article><span>Client fleet</span><strong>{sync?.devices?.active15m ?? "—"}/{sync?.devices?.total ?? "—"} active</strong><small>{sync?.openConflicts || 0} conflicts · {sync?.failedReceipts24h || 0} failed replays / 24h</small></article>
      </div>

      <div className="server-admin-operator-grid-v495">
        <section className="server-admin-operator-card-v495 server-admin-alerts-v495">
          <header><strong>Operator queue</strong><span>{criticalAlerts ? `${criticalAlerts} critical` : warningAlerts ? `${warningAlerts} warning` : "No active alerts"}{suppressedAlerts ? ` · ${suppressedAlerts} hidden` : ""}</span></header>
          <div className="server-admin-alert-toolbar-v495"><ClusterButton type="button" className="" aria-pressed={showAcknowledged} onClick={() => setShowAcknowledged((value) => !value)} variant="quiet" size="compact">{showAcknowledged ? "Hide acknowledged" : "Show acknowledged"}</ClusterButton><small>Acknowledgement is personal view state. Live subsystem evidence still controls severity.</small></div>
          <div className="server-admin-alert-list-v495">
            {visibleAlerts.slice(0, 10).map((item) => { const acknowledged = acknowledgedIds.has(item.id); return (
              <article key={item.id} data-severity={item.severity} data-acknowledged={acknowledged}>
                <span><b>{item.title}</b><small>{item.detail}</small></span>
                <div className="server-admin-alert-meta-v495"><em>{item.area}{acknowledged ? " · acknowledged" : ""}</em><div className="server-admin-inline-actions-v495">{item.action ? <ClusterButton type="button" className="" onClick={() => runAlertAction(item.action)} variant="quiet" size="compact">Review</ClusterButton> : null}<ClusterButton type="button" className="" disabled={actionBusy === `alert:${item.id}`} onClick={() => void updateAlertPreference(item.id, acknowledged ? "unacknowledge" : "acknowledge")} variant="quiet" size="compact">{acknowledged ? "Unack" : "Acknowledge"}</ClusterButton><ClusterButton type="button" className="" disabled={actionBusy === `alert:${item.id}`} onClick={() => void updateAlertPreference(item.id, "snooze", 60)} variant="quiet" size="compact">Snooze 1h</ClusterButton></div></div>
              </article>
            ); })}
            {!visibleAlerts.length ? <ClusterEmptyState compact kind="empty" title={alerts.length ? "No unacknowledged alerts" : "No current operator alerts"} description={alerts.length ? "All current alerts are acknowledged or snoozed for this administrator." : "The consolidated server posture is within configured thresholds."} /> : null}
          </div>
        </section>

        <section className="server-admin-operator-card-v495">
          <header><strong>Fleet & sync</strong><span>{sync?.devices?.stale7d || 0} stale registrations</span></header>
          <div className="server-admin-mini-kpis-v495">
            <span><b>Active 15m</b><strong>{sync?.devices?.active15m ?? "—"}</strong></span>
            <span><b>Registered</b><strong>{sync?.devices?.total ?? "—"}</strong></span>
            <span><b>Conflicts</b><strong>{sync?.openConflicts ?? "—"}</strong></span>
            <span><b>Replay failures</b><strong>{sync?.failedReceipts24h ?? "—"}</strong></span>
          </div>
          <div className="server-admin-chip-row-v495">
            {(sync?.devices?.versions || []).slice(0, 4).map((entry) => <span key={`version-${entry.value}`}>v{entry.value} <b>{entry.count}</b></span>)}
            {(sync?.devices?.platforms || []).slice(0, 3).map((entry) => <span key={`platform-${entry.value}`}>{entry.value} <b>{entry.count}</b></span>)}
          </div>
          <label className="server-admin-search-v495"><span>Client drill-down</span><ClusterTextInput type="search" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Search client, platform, version" /></label>
          <div className="server-admin-client-list-v495">{clientRows.slice(0, 6).map((client) => <div key={client.id}><span><b>{client.name}</b><small>{client.platform} · v{client.clientVersion} · schema {client.mutationSchemaVersion || 1}</small></span><em>{timeLabel(client.lastSeenAt)}</em></div>)}{!clientRows.length ? <ClusterEmptyState compact kind="filtered" title="No matching registered clients" description="Adjust the client filters or wait for another registered client to report in." /> : null}</div>
        </section>

        <section className="server-admin-operator-card-v495">
          <header><strong>Durable queues</strong><span>{queuePressure?.stalledLeases || 0} expired leases</span></header>
          <div className="server-admin-queue-list-v495">
            {queueRows.map((row) => <div key={row.queue}><strong>{row.queue}</strong><span>{row.queued} q · {row.running} run · {row.failed + row.deadLetter} review</span></div>)}
            {!queueRows.length ? <ClusterEmptyState compact kind="empty" title="Queues are healthy" description="There are no active or unhealthy durable queues requiring operator attention." /> : null}
          </div>
          <ClusterButton type="button" className="" onClick={onOpenMaintenance} variant="quiet" size="compact">Review background jobs</ClusterButton>
        </section>

        <section className="server-admin-operator-card-v495">
          <header><strong>Media workers</strong><span>{media?.workers?.online ?? "—"}/{media?.workers?.total ?? "—"} online</span></header>
          <div className="server-admin-mini-kpis-v495">
            <span><b>Queued</b><strong>{media?.queue?.queued ?? "—"}</strong></span>
            <span><b>Running</b><strong>{media?.queue?.running ?? "—"}</strong></span>
            <span><b>Failed</b><strong>{media?.queue?.failed ?? "—"}</strong></span>
            <span><b>Dead letter</b><strong>{media?.queue?.deadLetter ?? "—"}</strong></span>
          </div>
          <div className="server-admin-worker-list-v495">
            {(media?.workers?.rows || []).slice(0, 6).map((worker) => <div key={worker.id} data-online={worker.status !== "offline"}><span><b>{worker.hostname}</b><small>{worker.status} · {worker.acceleration || "software"} · desired {worker.desiredState}</small></span><strong>{worker.activeJobs}/{worker.concurrency}</strong><div className="server-admin-inline-actions-v495"><ClusterButton type="button" className="" disabled={worker.status === "offline" || actionBusy === `worker:${worker.id}`} onClick={() => void setMediaWorkerState(worker.id, "active")} variant="quiet" size="compact">Active</ClusterButton><ClusterButton type="button" className="" disabled={worker.status === "offline" || actionBusy === `worker:${worker.id}`} onClick={() => void setMediaWorkerState(worker.id, "drain")} variant="quiet" size="compact">Drain</ClusterButton><ClusterButton type="button" className="" disabled={worker.status === "offline" || actionBusy === `worker:${worker.id}`} onClick={() => void setMediaWorkerState(worker.id, "maintenance")} variant="quiet" size="compact">Maintenance</ClusterButton></div></div>)}
            {media?.workers?.total === 0 ? <ClusterEmptyState compact kind="offline" title="No media worker reported" description="Media processing will appear here after a worker connects and reports health." /> : null}
          </div>
        </section>

        <section className="server-admin-operator-card-v495 server-admin-recovery-v495">
          <header><strong>Automation & recovery</strong><span>{backup?.enabled ? `${backup.generationCount || 0} backup generations` : "Backups disabled"}</span></header>
          <div className="server-admin-mini-kpis-v495">
            <span><b>Automation queue</b><strong>{automation?.queued ?? "—"}</strong></span>
            <span><b>Automation review</b><strong>{(automation?.failed || 0) + (automation?.deadLetter || 0)}</strong></span>
            <span><b>Published rules</b><strong>{Math.max(0, (automation?.rules || 0) - (automation?.pausedRules || 0) - (automation?.draftRules || 0))}</strong></span>
            <span><b>Paused / draft</b><strong>{automation?.pausedRules || 0} / {automation?.draftRules || 0}</strong></span>
          </div>
          <div className="server-admin-recovery-list-v495"><div><span><b>Latest backup</b><small>{backup?.latestVerificationOk === false ? "Verification failed" : backup?.latestVerificationOk ? "Verified" : "Verification not recorded"}</small></span><strong>{timeLabel(backup?.latestCreatedAt)}</strong></div><div><span><b>Latest restore drill</b><small>{backup?.latestRestoreDrillOk === false ? "Drill reported mismatches" : backup?.latestRestoreDrillAt ? "Isolated recovery drill recorded" : "No drill recorded"}</small></span><strong>{timeLabel(backup?.latestRestoreDrillAt)}</strong></div></div>
          <div className="server-admin-actions-v420"><ClusterButton type="button" className="" onClick={onOpenMaintenance} variant="quiet" size="compact">Recovery & jobs</ClusterButton>{onOpenServerConfig ? <ClusterButton type="button" className="" onClick={onOpenServerConfig} variant="quiet" size="compact">Backup policy</ClusterButton> : null}</div>
        </section>

        <section className="server-admin-operator-card-v495 server-admin-audit-v495">
          <header><strong>Audit & incidents</strong><span className={`soft-pill ${audit?.ok === false ? "danger" : "good"}`}>{audit?.ok === false ? "Integrity failed" : "Chain verified"}</span></header>
          <div className="server-admin-audit-summary-v495">
            <span><b>Events checked</b><strong>{audit?.checked ?? "—"}</strong></span>
            <span><b>Write failures</b><strong>{audit?.writeFailures ?? "—"}</strong></span>
            <span><b>Current state</b><strong>{operator?.incidents?.current || "—"}</strong></span>
            <span><b>Security failures 24h</b><strong>{security?.failures24h ?? "—"}</strong></span>
            <span><b>Privileged failures</b><strong>{security?.privilegedFailures24h ?? "—"}</strong></span>
          </div>
          {latestIncident ? <p className="server-admin-incident-v495">Last transition: {latestIncident.from || "startup"} → {latestIncident.to} · {timeLabel(latestIncident.at)}</p> : null}
          <div className="server-admin-security-events-v495">
            {recentSecurity.slice(0, 4).map((event) => <div key={event.id}><span><b>{event.event}</b><small>{event.reasonCode} · {timeLabel(event.occurredAt)}</small></span><em data-result={event.result}>{event.result.toLowerCase()}</em></div>)}
          </div>
          <ClusterButton type="button" className="" onClick={onOpenReports} variant="quiet" size="compact">Open audit reports</ClusterButton>
        </section>

        <section className="server-admin-operator-card-v495 server-admin-actions-card-v495">
          <header><strong>Operational actions</strong><span>Existing server authorities</span></header>
          <p>Run safe maintenance probes or export a redacted diagnostic bundle. Destructive restore and configuration changes stay in their dedicated guarded workflows.</p>
          <div className="server-admin-actions-v420">
            <ClusterButton type="button" className="" disabled={Boolean(actionBusy)} onClick={() => void runOperatorAction("verify-storage")} variant="quiet" size="compact">{actionBusy === "verify-storage" ? "Verifying…" : "Verify storage"}</ClusterButton>
            <ClusterButton type="button" className="" disabled={Boolean(actionBusy)} onClick={() => void runOperatorAction("optimize-database")} variant="quiet" size="compact">{actionBusy === "optimize-database" ? "Optimizing…" : "Optimize database"}</ClusterButton>
            <ClusterButton type="button" className="" disabled={Boolean(actionBusy)} onClick={() => void runOperatorAction("download-diagnostics")} variant="quiet" size="compact">{actionBusy === "download-diagnostics" ? "Preparing…" : "Download diagnostics"}</ClusterButton>
            {onOpenServerConfig ? <ClusterButton type="button" className="" disabled={Boolean(actionBusy)} onClick={onOpenServerConfig} variant="quiet" size="compact">Server configuration</ClusterButton> : null}
          </div>
          {actionStatus ? <div className="status-box server-admin-action-status-v495" role="status">{actionStatus}</div> : null}
        </section>
      </div>

      <div className="server-admin-body-v420">
        <section className="server-admin-remediation-v420">
          <header><strong>Configuration recommendations</strong><span>{recommendations.length ? `${recommendations.length} surfaced` : "No immediate actions"}</span></header>
          {recommendations.length ? recommendations.map((item) => (
            <article key={`${item.title}-${item.detail}`} data-tone={item.tone}>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              {item.action && item.run ? <ClusterButton type="button" className="" onClick={item.run} variant="quiet" size="compact">{item.action}</ClusterButton> : null}
            </article>
          )) : <ClusterEmptyState compact kind="empty" title="No remediation needed" description="Current configuration checks do not require an immediate operator action." />}
        </section>
        <section className="server-admin-postgres-v420">
          <header><strong>PostgreSQL pressure</strong><span>{health?.performanceBudgets ? `${health.performanceBudgets.failures || 0} fail · ${health.performanceBudgets.warnings || 0} warn` : "No budget sample"}</span></header>
          <div>
            <span><b>Connections</b><strong>{postgres?.connections?.total ?? "—"} total</strong></span>
            <span><b>Lock waits</b><strong>{postgres?.connections?.lockWaits ?? "—"}</strong></span>
            <span><b>Dead rows</b><strong>{pct(postgres?.workload?.deadRowRatio)}</strong></span>
            <span><b>Temp spill</b><strong>{bytes(postgres?.workload?.temporaryBytes)}</strong></span>
          </div>
          {(postgres?.recommendations || []).slice(0, 3).map((item) => <p key={item}>{item}</p>)}
        </section>
      </div>
    </section>
  );
}
