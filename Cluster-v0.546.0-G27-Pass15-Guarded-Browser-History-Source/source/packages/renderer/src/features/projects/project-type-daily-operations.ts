import type { ClusterProjectTypeDefinition } from "@cluster/shared";
import type { TypeWorkspaceRecord } from "./project-type-workspace-state";
import { typeWorkspaceRecordClosed } from "./project-type-workspace-state";

export type ProjectTypeDailySignal = {
  id: string;
  label: string;
  detail: string;
  entityKinds: string[];
  statuses: string[];
  count: number;
};

export type ProjectTypeDailyAttentionRecord = {
  id: string;
  entityKind: string;
  title: string;
  status: string;
  score: number;
  reasons: string[];
};

type SignalDefinition = Omit<ProjectTypeDailySignal, "count">;

const SIGNALS: Record<string, SignalDefinition[]> = {
  game: [
    { id: "playtest", label: "Playtest readiness", detail: "Playtests still recruiting, scheduling, running, or waiting on analysis.", entityKinds: ["playtest"], statuses: ["planned", "recruiting", "scheduled", "running", "analysis"] },
    { id: "platform", label: "Platform / certification", detail: "Platform targets that still need support, certification, or blocker resolution.", entityKinds: ["platform"], statuses: ["planned", "certification", "blocked"] },
    { id: "release", label: "Release readiness", detail: "Release milestones still moving through lock, QA, or candidate validation.", entityKinds: ["release"], statuses: ["planned", "content_lock", "qa", "release_candidate"] },
  ],
  software: [
    { id: "incidents", label: "Production incidents", detail: "Incidents still being investigated, mitigated, or monitored.", entityKinds: ["incident"], statuses: ["open", "investigating", "mitigating", "monitoring"] },
    { id: "deployments", label: "Deployment watch", detail: "Deployments that are ready, deploying, verifying, or rolled back.", entityKinds: ["deployment"], statuses: ["ready", "deploying", "verifying", "rolled_back"] },
    { id: "environments", label: "Environment health", detail: "Runtime environments that are degraded or under maintenance.", entityKinds: ["environment"], statuses: ["degraded", "maintenance"] },
    { id: "changes", label: "Change control", detail: "Change requests waiting on review, approval, or scheduled execution.", entityKinds: ["change_request"], statuses: ["draft", "review", "approved", "scheduled"] },
  ],
  creative: [
    { id: "reviews", label: "Review rounds", detail: "Creative reviews still open or waiting on requested changes.", entityKinds: ["iteration", "review_round"], statuses: ["internal_review", "stakeholder_review", "open", "changes"] },
    { id: "approvals", label: "Approval queue", detail: "Formal decisions still pending or carrying requested changes.", entityKinds: ["approval"], statuses: ["pending", "changes_requested"] },
    { id: "deliverables", label: "Delivery readiness", detail: "Creative deliverables still in production, review, or approval.", entityKinds: ["deliverable"], statuses: ["planned", "production", "review", "approved"] },
  ],
  marketing: [
    { id: "launch", label: "Launch window", detail: "Campaigns and activations approaching or currently in live delivery.", entityKinds: ["campaign", "activation"], statuses: ["scheduled", "ready", "live", "monitoring"] },
    { id: "channels", label: "Channel health", detail: "Channels that are planned, scheduled, live, or paused.", entityKinds: ["channel"], statuses: ["planned", "scheduled", "live", "paused"] },
    { id: "measurement", label: "Performance follow-through", detail: "Post-launch reporting still collecting or under analysis.", entityKinds: ["performance_report"], statuses: ["planned", "collecting", "analysis"] },
  ],
  event: [
    { id: "live-issues", label: "Live issues", detail: "Event issues that still need triage, mitigation, or resolution.", entityKinds: ["event_issue"], statuses: ["open", "triage", "mitigating"] },
    { id: "resources", label: "Resource readiness", detail: "Rooms, equipment, and production resources not yet confirmed ready.", entityKinds: ["resource"], statuses: ["requested", "held", "unavailable"] },
    { id: "bookings", label: "Booking readiness", detail: "Crew, venue, talent, or vendor bookings still tentative or requested.", entityKinds: ["booking"], statuses: ["requested", "tentative"] },
    { id: "show", label: "Run of show", detail: "Sessions and run items still moving toward live execution.", entityKinds: ["session", "run_item"], statuses: ["draft", "confirmed", "planned", "ready", "live"] },
  ],
  operations: [
    { id: "service", label: "Service queue", detail: "Service requests still queued, active, or waiting on another team.", entityKinds: ["service_request"], statuses: ["intake", "queued", "active", "waiting"] },
    { id: "runs", label: "Recurring runs", detail: "Recurring operations that are queued, active, or missed.", entityKinds: ["recurring_run"], statuses: ["planned", "queued", "active", "missed"] },
    { id: "incidents", label: "Operational incidents", detail: "Incidents still being investigated, mitigated, or monitored.", entityKinds: ["incident"], statuses: ["open", "investigating", "mitigating", "monitoring"] },
    { id: "process", label: "Process governance", detail: "Procedures and improvements still under review or active change.", entityKinds: ["procedure", "improvement"], statuses: ["draft", "review", "proposed", "approved", "active", "superseded"] },
  ],
};

const BLOCKING_STATUS = new Set(["blocked", "failed", "rejected", "rolled_back", "unavailable", "missed", "changes_requested", "degraded"]);

export function deriveProjectTypeDailyOperations(type: ClusterProjectTypeDefinition, records: TypeWorkspaceRecord[], now = Date.now()) {
  const definitions = SIGNALS[type.category || ""] || [];
  const signalCounts = new Map(definitions.map((signal) => [signal.id, 0]));
  const signalByEntity = new Map<string, SignalDefinition[]>();
  for (const signal of definitions) {
    for (const entityKind of signal.entityKinds) {
      const existing = signalByEntity.get(entityKind) || [];
      existing.push(signal);
      signalByEntity.set(entityKind, existing);
    }
  }

  const attention: ProjectTypeDailyAttentionRecord[] = [];
  for (const record of records) {
    const status = String(record.status || "").toLowerCase();
    const closed = typeWorkspaceRecordClosed(status);
    const matches = signalByEntity.get(record.entityKind) || [];
    if (!closed) {
      for (const signal of matches) if (signal.statuses.includes(status)) signalCounts.set(signal.id, (signalCounts.get(signal.id) || 0) + 1);
    }
    if (closed) continue;

    let score = 0;
    const reasons: string[] = [];
    if (BLOCKING_STATUS.has(status)) { score += 8; reasons.push(status.replaceAll("_", " ")); }
    const dueAt = record.dueDate ? new Date(record.dueDate).getTime() : Number.NaN;
    if (Number.isFinite(dueAt) && dueAt < now) { score += 6; reasons.push("overdue"); }
    else if (Number.isFinite(dueAt) && dueAt - now <= 3 * 86400000) { score += 3; reasons.push("due soon"); }
    if (!record.ownerId) { score += 3; reasons.push("unowned"); }
    const priority = String(record.priority || "").toLowerCase();
    if (priority === "urgent") { score += 5; reasons.push("urgent"); }
    else if (priority === "high") { score += 3; reasons.push("high priority"); }
    if (matches.some((signal) => signal.statuses.includes(status))) score += 2;
    if (score > 0) attention.push({ id: record.id, entityKind: record.entityKind, title: record.title, status: record.status, score, reasons });
  }

  attention.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  return {
    title: type.category === "game" ? "Game-day operations" : type.category === "software" ? "Release operations" : type.category === "creative" ? "Studio operations" : type.category === "marketing" ? "Campaign operations" : type.category === "event" ? "Show operations" : type.category === "operations" ? "Service operations" : "Daily operations",
    signals: definitions.map((signal) => ({ ...signal, count: signalCounts.get(signal.id) || 0 })),
    attention: attention.slice(0, 8),
    attentionCount: attention.length,
  };
}
