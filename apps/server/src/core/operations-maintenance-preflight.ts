/**
 * F4 P4: non-mutating maintenance/restart preflight.
 *
 * This is not an authorization token, a reservation, or a maintenance-mode
 * transition. The native supervisor MUST re-check and drain before acting.
 * Unknown evidence fails closed so dashboards never translate a broken probe
 * into permission to restart a busy production service.
 */
import type { BackgroundTaskSnapshot } from "./background-tasks.js";
import type { ClusterRuntimeAccessMode } from "./runtime-access-state.js";

export type MaintenanceIntent = "enter-maintenance" | "enter-read-only" | "restart" | "update";
export type MaintenanceFinding = { code: string; detail: string; category: "lifecycle" | "dependency" | "work" | "recovery" };
export type MaintenancePreflightInput = {
  intent: MaintenanceIntent;
  mode: ClusterRuntimeAccessMode;
  ready: boolean;
  draining: boolean;
  database: { ok: boolean; checkedAt?: string | null } | null;
  storage: { ok: boolean; checkedAt?: string | null } | null;
  tasks: ReadonlyArray<Pick<BackgroundTaskSnapshot, "name" | "running" | "workloadClass">> | null;
  jobs: { running: number } | null;
  work: { heavyInFlight: number; criticalInFlight: number } | null;
  window: { enabled: boolean; active: boolean; nextStartAt: string | null } | null;
  recovery: { ok: boolean; state: string; generatedAt?: string; checks?: Record<string, unknown> } | null;
  now?: number;
};

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function evaluateMaintenancePreflight(input: MaintenancePreflightInput) {
  const blockers: MaintenanceFinding[] = [];
  const warnings: MaintenanceFinding[] = [];
  const block = (code: string, detail: string, category: MaintenanceFinding["category"]) => blockers.push({ code, detail, category });
  const warn = (code: string, detail: string, category: MaintenanceFinding["category"]) => warnings.push({ code, detail, category });
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("Invalid maintenance preflight clock.");
  if (input.draining) block("ALREADY_DRAINING", "The server is already draining. Do not start a second transition.", "lifecycle");
  if (!input.ready) block("NOT_READY", "The API has not completed startup or has stopped accepting work.", "lifecycle");
  if (input.mode !== "normal") block("RUNTIME_HELD", `The current runtime is ${input.mode}. Review its recovery plan before scheduling another transition.`, "lifecycle");
  for (const [key, value] of [["DATABASE", input.database], ["STORAGE", input.storage]] as const) {
    if (!value) {
      block(`${key}_UNVERIFIED`, `${key.toLowerCase()} health evidence is unavailable.`, "dependency");
      continue;
    }
    if (!value.ok) block(`${key}_UNHEALTHY`, `${key.toLowerCase()} health checks are failing.`, "dependency");
    const checked = typeof value.checkedAt === "string" ? Date.parse(value.checkedAt) : NaN;
    if (!Number.isFinite(checked) || checked > now + 5_000 || now - checked > 60_000) {
      block(`${key}_STALE`, `${key.toLowerCase()} health must have a recent verified sample (within 60 seconds).`, "dependency");
    }
  }
  if (!input.tasks) block("TASKS_UNVERIFIED", "Scheduled task activity could not be inspected.", "work");
  else {
    if (input.tasks.length > 2_000) block("TASKS_UNBOUNDED", "Scheduled task inventory exceeds the review bound.", "work");
    const running = input.tasks.filter(task => task.running).slice(0, 10);
    if (running.length) {
      block("TASKS_RUNNING", `${running.length}${input.tasks.filter(task => task.running).length > running.length ? "+" : ""} scheduled tasks are active. Wait for a bounded drain.`, "work");
    }
    // The API can't prove all external workers/queues are quiescent. A successful
    // snapshot still only permits a supervised drain, never immediate termination.
    if (input.tasks.some(task => task.workloadClass === "background")) {
      warn("BACKGROUND_WORKERS", "Background workers need explicit checkpoint and drain before the supervisor restarts.", "work");
    }
  }
  if (!input.jobs || !validCount(input.jobs.running)) block("JOBS_UNVERIFIED", "Durable job counts are missing or invalid.", "work");
  else if (input.jobs.running > 0) block("JOBS_RUNNING", `${input.jobs.running} durable job(s) are running. They require checkpoint or bounded drain.`, "work");
  if (!input.work || !validCount(input.work.heavyInFlight) || !validCount(input.work.criticalInFlight)) {
    block("WORK_UNVERIFIED", "In-flight request counters are missing or invalid.", "work");
  } else if (input.work.heavyInFlight || input.work.criticalInFlight) {
    block("REQUESTS_IN_FLIGHT", `${input.work.heavyInFlight} heavy and ${input.work.criticalInFlight} critical request(s) remain active.`, "work");
  }
  if (input.intent === "restart" || input.intent === "update") {
    if (!input.window || typeof input.window.enabled !== "boolean" || typeof input.window.active !== "boolean") {
      block("WINDOW_UNVERIFIED", "Saved maintenance-window policy could not be verified. Do not authorize a disruptive action.", "recovery");
    } else if (input.window.enabled && !input.window.active) {
      block("OUTSIDE_MAINTENANCE_WINDOW", "The approved maintenance window is not currently active. Schedule this operation inside a configured window or disable that policy through protected Server Config.", "recovery");
    } else if (!input.window.enabled) {
      warn("NO_MAINTENANCE_WINDOW", "No maintenance window is enabled. An operator must coordinate the outage explicitly.", "recovery");
    }
  }
  if (input.intent === "update") {
    const evidence = input.recovery;
    const verifiedAt = typeof evidence?.generatedAt === "string" ? Date.parse(evidence.generatedAt) : NaN;
    if (!evidence || !Number.isFinite(verifiedAt) || verifiedAt > now + 5_000 || now - verifiedAt > 5 * 60_000) {
      block("RECOVERY_UNVERIFIED", "Update recovery-readiness evidence must be fresh and available.", "recovery");
    } else {
      const checks = evidence.checks;
      const required = ["instanceIdentityPresent", "generationPresent", "generationMatchesInstance", "completeSchema", "verificationPassed", "restoreDrillPassed", "latestGenerationVerified", "backupFresh", "drillFresh"];
      if (evidence.ok !== true || evidence.state !== "ready" || !checks || required.some(key => checks[key] !== true) || checks.secretKeyAvailable === false) {
        block("RECOVERY_NOT_READY", "A current verified, identity-matched backup and successful recent restore drill are required before update review can pass.", "recovery");
      }
    }
  }
  if (input.intent === "update") {
    warn("UPDATE_CHECKPOINT_REQUIRED", "A verified restore checkpoint, update signature, migration plan and rollback compatibility must be rechecked before updating.", "recovery");
  } else if (input.intent === "restart") {
    warn("RESTART_COORDINATION_REQUIRED", "The native Windows Service must confirm dependency readiness and perform a bounded shutdown before restarting.", "recovery");
  } else {
    warn("MODE_RESTART_REQUIRED", "Maintenance/read-only modes are boot-controlled. Apply through an authorized supervised restart, not by changing this preview.", "recovery");
  }
  return {
    ok: blockers.length === 0,
    intent: input.intent,
    checkedAt: new Date(now).toISOString(),
    blockers,
    warnings,
    observed: {
      runningTasks: input.tasks?.filter(task => task.running).length ?? null,
      runningJobs: input.jobs?.running ?? null,
      heavyInFlight: input.work?.heavyInFlight ?? null,
      criticalInFlight: input.work?.criticalInFlight ?? null,
      mode: input.mode,
      window: input.window ? { enabled: input.window.enabled, active: input.window.active, nextStartAt: input.window.nextStartAt } : null,
      recovery: input.recovery ? { state: input.recovery.state, evidenceAt: input.recovery.generatedAt ?? null } : null,
    },
    executable: false as const,
    note: "Read-only advisory snapshot, not an execution permit. Re-check under the Windows supervisor immediately before any protected maintenance action. No mode change, restart, update, or job cancellation was performed.",
  };
}
