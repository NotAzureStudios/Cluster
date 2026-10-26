import { ClusterButton } from "../../components/ClusterButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../../core/api";
import type { User } from "../application/application-models";
import { controlDateLabel } from "./project-control-model";

type AutomationRun = { id: string; ruleId?: string; title: string; status: string; validationSummary?: string | null; payload: Record<string, any>; createdAt?: string; updatedAt: string };

function durationLabel(run: AutomationRun) {
  const start = new Date(run.payload?.startedAt || run.createdAt || run.updatedAt).getTime();
  const endValue = run.payload?.completedAt || run.payload?.failedAt;
  if (!endValue) return null;
  const ms = Math.max(0, new Date(endValue).getTime() - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function ProjectAutomationHistory({ projectId, users = [], refreshKey = 0, canRetry = false }: { projectId: string; users?: User[]; refreshKey?: number; canRetry?: boolean }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState("");
  const userNames = useMemo(() => new Map(users.map((user) => [user.id, user.displayName || user.username])), [users]);
  const load = useCallback(async () => {
    try { const result = await api<{ runs: AutomationRun[] }>(`/api/projects/${projectId}/automation-runs?limit=50`); setRuns(result.runs || []); }
    catch (error) { setStatus(formatApiError(error)); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  async function retry(run: AutomationRun) {
    setBusyId(run.id); setStatus("");
    try { await api(`/api/projects/${projectId}/automation-runs/${run.id}/retry`, { method: "POST", body: "{}" }); setStatus("Automation retry completed."); await load(); }
    catch (error) { setStatus(formatApiError(error)); }
    finally { setBusyId(""); }
  }
  return <div className="project-automation-history-v315">{status ? <div className="inline-status">{status}</div> : null}<header><strong>Execution history</strong><ClusterButton type="button" className="" onClick={() => void load()} variant="quiet" size="compact">Refresh</ClusterButton></header>{runs.length ? runs.map((run) => {
    const duration = durationLabel(run);
    const nextRetryAt = run.payload?.nextRetryAt ? new Date(run.payload.nextRetryAt) : null;
    const owner = run.payload?.ownerId ? userNames.get(String(run.payload.ownerId)) || "Assigned owner" : "No owner";
    const resultTypes = Array.from(new Set((Array.isArray(run.payload?.results) ? run.payload.results : []).map((item: any) => String(item?.type || "action")))).slice(0, 4);
    return <article key={run.id} className={run.status}><div><span>{run.status}</span><strong>{run.title}</strong><small>{controlDateLabel(run.updatedAt)} · {run.payload?.context?.trigger || "manual"} · attempt {Number(run.payload?.attempt || 1)} · {owner}{duration ? ` · ${duration}` : ""}</small>{resultTypes.length ? <small>{resultTypes.join(" · ")}</small> : null}{nextRetryAt ? <em>Automatic retry queued for {controlDateLabel(nextRetryAt.toISOString())}.</em> : run.validationSummary || run.payload?.error ? <em>{run.validationSummary || run.payload.error}</em> : null}</div>{run.status === "failed" && canRetry ? <ClusterButton type="button" className="" disabled={busyId === run.id} onClick={() => void retry(run)} variant="quiet" size="compact">{busyId === run.id ? "Retrying…" : "Retry now"}</ClusterButton> : null}</article>;
  }) : <p className="muted-copy">No runs yet. Event-triggered and recurring rules will appear here with ownership, attempts, and retry state.</p>}</div>;
}
