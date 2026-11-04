import { useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { classifyBackgroundTask, failingBackgroundTasks, summarizeBackgroundTaskError, type BackgroundTaskEvidence } from "./background-task-evidence";
import "./scheduled-task-diagnostics.css";

type TaskHealthResponse = {
  ok: boolean;
  generatedAt: string;
  operational: { checks: Array<{ key: string; status: string; detail: string }> };
  backgroundTasks: BackgroundTaskEvidence[];
};

/** Durable queued Jobs and in-process scheduled tasks have different failure
 * authorities. This is a deliberate, user-triggered read, never another poll. */
export function ScheduledTaskDiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState<TaskHealthResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function inspect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<TaskHealthResponse>("/api/admin/operations/health");
      setSnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scheduled task evidence could not be loaded.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const failing = snapshot ? failingBackgroundTasks(snapshot.backgroundTasks || []) : [];
  const healthCheck = snapshot?.operational.checks.find((check) => check.key === "background-tasks");
  return <section id="scheduled-task-diagnostics" className="scheduled-task-diagnostics-v11" aria-label="Scheduled task failure diagnostics">
    <header>
      <div>
        <strong>Scheduled task diagnostics</strong>
        <p>Health warnings can come from recurring in-process tasks, not just queued operations. Inspect their failure streaks and last recorded errors.</p>
      </div>
      <ClusterButton type="button" size="compact" variant="secondary" disabled={busy} onClick={() => void inspect()}>
        {busy ? "Inspecting…" : snapshot ? "Refresh evidence" : "Inspect failures"}
      </ClusterButton>
    </header>
    {error && <p role="alert" className="scheduled-task-diagnostics-error-v11">{error}</p>}
    {snapshot && <div className="scheduled-task-diagnostics-results-v11">
      <div className="scheduled-task-diagnostics-summary-v11">
        <span>Sampled {Number.isFinite(Date.parse(snapshot.generatedAt)) ? new Date(snapshot.generatedAt).toLocaleString() : "at an unknown time"}</span>
        <span>{snapshot.backgroundTasks.length} registered tasks · {failing.length} with current failure streaks</span>
      </div>
      {healthCheck && <p className="scheduled-task-diagnostics-health-v11" data-status={healthCheck.status}>{healthCheck.detail}</p>}
      {failing.length ? <ol>
        {failing.map((task) => <li key={task.name} data-state={classifyBackgroundTask(task)}>
          <div className="scheduled-task-diagnostics-row-v11">
            <strong>{task.name}</strong>
            <span>{task.consecutiveFailures} consecutive failure{task.consecutiveFailures === 1 ? "" : "s"}</span>
          </div>
          <p>{summarizeBackgroundTaskError(task.lastError)}</p>
          <small>{task.owner ? "Owner: " + task.owner + " · " : ""}
            {task.lastFinishedAt ? "Last attempt: " + new Date(task.lastFinishedAt).toLocaleString() : "Not attempted"}
            {task.suspended ? " · Owner suspended" : ""}
          </small>
        </li>)}
      </ol> : <p className="scheduled-task-diagnostics-clear-v11">No tasks currently have a failure streak. Previous incident notifications may still need acknowledgement or resolution.</p>}
    </div>}
  </section>;
}
