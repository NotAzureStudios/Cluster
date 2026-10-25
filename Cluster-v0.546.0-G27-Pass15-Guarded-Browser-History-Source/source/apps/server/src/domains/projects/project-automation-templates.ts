import type { ClusterProjectTypeDefinition } from "@cluster/shared";

export type ProjectAutomationTemplate = {
  id: string;
  title: string;
  description: string;
  trigger: string;
  payload: Record<string, unknown>;
};

function rule(id: string, title: string, description: string, trigger: string, payload: Record<string, unknown>): ProjectAutomationTemplate {
  return { id, title, description, trigger, payload: { enabled: true, trigger, conditionMode: "all", conditions: [], retryPolicy: { maxAttempts: 3, backoffMinutes: 5, pauseAfterFailures: 3 }, notifyOnFailure: true, templateId: id, ...payload } };
}

const COMMON = [
  rule("overdue-owner-escalation", "Escalate overdue owned work", "Notify the owner when high-priority Project Control work becomes overdue.", "record_overdue", { conditions: [{ field: "source.priority", operator: "in", value: ["high", "urgent"] }], actions: [{ type: "notify", title: "Overdue project work", message: "High-priority work is overdue." }] }),
  rule("milestone-follow-up", "Milestone completion follow-up", "Create a decision checkpoint after a milestone completes.", "milestone_completed", { actions: [{ type: "create_decision", title: "Milestone follow-up decision", dueInDays: 2, relationship: "relates_to" }] }),
];

const CATEGORY: Record<string, ProjectAutomationTemplate[]> = {
  video: [
    rule("video-review-handoff", "Review handoff", "When review-stage work completes, notify the next production owner after a short bounded delay.", "record_completed", { conditions: [{ field: "source.payload.productionStage", operator: "in", value: ["review", "picture_lock", "finishing"] }], actions: [{ type: "delay", delayMinutes: 15, title: "Review handoff delay" }, { type: "notify", title: "Video review handoff", message: "A production review stage completed and is ready for the next owner." }] }),
  ],
  game: [
    rule("game-qa-no-go", "QA no-go triage", "Create an urgent issue and notify the rule owner when game QA returns a no-go.", "qa_no_go", { actions: [{ type: "create_risk", title: "QA no-go release risk", priority: "urgent", dueInDays: 1 }, { type: "notify", title: "Game QA no-go", priority: "high" }] }),
  ],
  software: [
    rule("software-qa-no-go", "QA no-go incident", "Branch software QA failures into an incident-style issue and owner notification.", "qa_no_go", { actions: [{ type: "branch", title: "Route QA severity", conditionTree: { operator: "any", conditions: [{ field: "source.status", operator: "in", value: ["failed", "blocked"] }, { field: "source.decision", operator: "equals", value: "no-go" }] }, thenActions: [{ type: "create_risk", title: "Release-blocking QA failure", priority: "urgent", dueInDays: 1 }, { type: "notify", title: "Release blocked by QA", priority: "high" }], elseActions: [{ type: "log_activity", title: "QA review required" }] }] }),
  ],
  creative: [rule("creative-review-handoff", "Creative review handoff", "Notify the next owner when a review-stage creative record completes.", "record_completed", { conditions: [{ field: "source.payload.productionStage", operator: "equals", value: "review" }], actions: [{ type: "notify", title: "Creative review complete" }] })],
  marketing: [rule("campaign-launch-check", "Campaign launch checkpoint", "Create a decision checkpoint when a campaign milestone completes.", "milestone_completed", { actions: [{ type: "create_decision", title: "Campaign launch checkpoint", dueInDays: 1 }] })],
  event: [rule("event-readiness-check", "Event readiness escalation", "Escalate overdue high-priority event work before live delivery.", "record_overdue", { conditions: [{ field: "source.priority", operator: "in", value: ["high", "urgent"] }], actions: [{ type: "notify", title: "Event readiness risk", priority: "high" }, { type: "create_risk", title: "Event readiness blocker", priority: "urgent", dueInDays: 1 }] })],
  operations: [rule("operations-recurring-review", "Recurring operations review", "Create a recurring decision checkpoint for active operational projects.", "recurring", { recurrence: { every: 1, unit: "week" }, actions: [{ type: "create_decision", title: "Weekly operations review" }] })],
};

export function projectAutomationTemplatesForType(definition: ClusterProjectTypeDefinition) {
  return [...COMMON, ...(CATEGORY[String(definition.category || "general")] || [])].map((item) => ({ ...item, projectType: definition.id }));
}
