import type { ClusterAdminConfigurableToolId } from "@cluster/shared";

/**
 * Durable job types which cannot make progress while their Studio tool is disabled.
 * This is deliberately an explicit allowlist, not a prefix match: shared jobs,
 * security, retention, backups and unrelated domain work must keep running.
 *
 * A running Library transfer may finish its current operation so that pausing
 * cannot strand a moved blob or consume an upload session halfway through a
 * commit. The queue prevents *new* claims, and defers claimed-but-not-started
 * work without consuming retry attempts. In-flight cancellation remains a
 * separate, transaction-aware follow-up.
 */
export const STUDIO_TOOL_DURABLE_JOB_TYPES = {
  calendar: ["automation.calendar-scan", "studio.calendar-owner-reminders"],
  library: ["library.transfer.finalize", "library.derivative.build", "library.bulk.metadata", "library.hierarchy.move", "library.hierarchy.lifecycle", "library.storage.reconcile", "library.storage.orphan-audit"],
} as const satisfies Partial<Record<ClusterAdminConfigurableToolId, readonly string[]>>;

export type StudioToolOwnedJobType = (typeof STUDIO_TOOL_DURABLE_JOB_TYPES)[keyof typeof STUDIO_TOOL_DURABLE_JOB_TYPES][number];

/** The owning tool is used for diagnostics and policy evaluation, not authorization. */
export function studioToolForDurableJobType(type: string): ClusterAdminConfigurableToolId | null {
  for (const [owner, types] of Object.entries(STUDIO_TOOL_DURABLE_JOB_TYPES)) {
    if ((types as readonly string[]).includes(type)) return owner as ClusterAdminConfigurableToolId;
  }
  return null;
}

/** SQL claim exclusion and pre-handler race checks must consume identical policy. */
export function disabledStudioToolJobTypes(isEnabled: (tool: ClusterAdminConfigurableToolId) => boolean): string[] {
  return Object.entries(STUDIO_TOOL_DURABLE_JOB_TYPES)
    .filter(([tool]) => !isEnabled(tool as ClusterAdminConfigurableToolId))
    .flatMap(([, types]) => [...types]);
}

/** A generic automation job can still depend on Tickets even though its job
 * type is shared with Board/Project automation. This is a contextual gate,
 * never a reason to block all jobs of that type at SQL claim time. */
/** Cross-tool Project automation actions. This list is deliberately explicit;
 * generic notifications and Project control records must not inherit a Tool
 * switch because a different feature happens to create them. */
export const PROJECT_AUTOMATION_ACTION_OWNER = {
  create_ticket: "tickets",
  create_timeline: "timeline",
  create_calendar: "calendar",
  create_schedule: "scheduler",
} as const satisfies Partial<Record<string, ClusterAdminConfigurableToolId>>;

/** Includes both branches, including the branch that may be selected later.
 * Delaying a rule because either branch is disabled is conservative, but it
 * guarantees that a conditional path cannot cross a disabled-tool boundary. */
export function automationActionToolOwners(value: unknown, depth = 0): ClusterAdminConfigurableToolId[] {
  if (depth > 5 || !Array.isArray(value)) return [];
  const owners = new Set<ClusterAdminConfigurableToolId>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const type = String(entry.type || "");
    const owner = PROJECT_AUTOMATION_ACTION_OWNER[type as keyof typeof PROJECT_AUTOMATION_ACTION_OWNER];
    if (owner) owners.add(owner);
    if (type === "branch") {
      for (const child of automationActionToolOwners(entry.thenActions, depth + 1)) owners.add(child);
      for (const child of automationActionToolOwners(entry.elseActions, depth + 1)) owners.add(child);
    }
  }
  return [...owners].sort();
}

/** Some generic jobs have domain-specific input, while other generic jobs
 * carry explicitly requested actions. Stored actions must also be checked
 * by the authoritative Project executor, after fetching the latest rule. */
export function automationJobRequiredToolOwners(type: string, rawPayload: unknown): ClusterAdminConfigurableToolId[] {
  if (type !== "automation.studio-action" && type !== "automation.project-rule") return [];
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return [];
  const payload = rawPayload as Record<string, any>;
  const event = type === "automation.studio-action" ? payload.event || payload : payload.options?.context || {};
  const trigger = String(event.trigger || payload.trigger || "").toLowerCase();
  const kind = String(event.entityType || event.sourceType || payload.entityType || "").toLowerCase();
  const owners = new Set<ClusterAdminConfigurableToolId>();
  if (trigger.startsWith("ticket_") || kind === "ticket" || event.source?.workItemKind === "ticket") owners.add("tickets");
  // Suspended tools must not resurrect previously queued event-driven work.
  if (trigger.startsWith("calendar_") || kind === "calendar" || kind === "calendar_event") owners.add("calendar");
  if (trigger.startsWith("timeline_") || kind === "timeline") owners.add("timeline");
  if (trigger.startsWith("scheduler_") || kind === "schedule_block" || kind === "scheduler") owners.add("scheduler");
  if (type === "automation.project-rule") {
    for (const owner of automationActionToolOwners(payload.options?.actionsOverride)) owners.add(owner);
  }
  return [...owners].sort();
}

export function automationJobRequiresTickets(type: string, rawPayload: unknown): boolean {
  return automationJobRequiredToolOwners(type, rawPayload).includes("tickets");
}

export function automationActionsCreateTicket(value: unknown): boolean {
  return automationActionToolOwners(value).includes("tickets");
}
