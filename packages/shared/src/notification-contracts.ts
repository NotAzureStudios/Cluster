import { PRODUCT_TERMS } from "./product-language.js";

export const CLUSTER_NOTIFICATION_CATEGORIES = ["activity", "mentions", "approvals", "delivery", "qa", "schedule", "work", "system"] as const;
export const CLUSTER_NOTIFICATION_PRIORITIES = ["normal", "medium", "high", "critical"] as const;
export const CLUSTER_NOTIFICATION_TOOLS = ["project", "boards", "whiteboards", "review", "builds", "qa", "tickets", "scheduler", "calendar", "timeline", "library", "people", "automation", "system"] as const;
export const CLUSTER_NOTIFICATION_SIGNALS = ["activity", "mention", "assignment", "comment", "review", "version", "approval", "due", "failure", "blocked", "release", "security", "announcement", "digest"] as const;

export type NotificationCategory = (typeof CLUSTER_NOTIFICATION_CATEGORIES)[number];
export type NotificationPriority = (typeof CLUSTER_NOTIFICATION_PRIORITIES)[number];
export type NotificationTool = (typeof CLUSTER_NOTIFICATION_TOOLS)[number];
export type NotificationSignal = (typeof CLUSTER_NOTIFICATION_SIGNALS)[number];
export type NotificationProjectMode = "all" | "important" | "off";
export type NotificationDeliveryMode = "toast" | "native" | "both" | "silent" | "off";
export type NotificationPriorityFloor = "all" | "medium" | "high" | "critical";
export type NotificationEscalationMode = "standard" | "action-required" | "aggressive";
export type NotificationQuietHoursBehavior = "silent" | "critical-only" | "normal";
export type NotificationToolMode = "all" | "important" | "off";

export const CLUSTER_NOTIFICATION_TOOL_DETAILS: Record<NotificationTool, { label: string; description: string }> = {
  project: { label: PRODUCT_TERMS.projects, description: "General project changes and project-level workflow." },
  boards: { label: PRODUCT_TERMS.boards, description: "Cards, assignments, comments, blockers, and board workflow." },
  whiteboards: { label: PRODUCT_TERMS.whiteboards, description: "Whiteboard mentions, collaboration, and shared review changes." },
  review: { label: "Review", description: "Review requests, versions, comments, and approval decisions." },
  builds: { label: PRODUCT_TERMS.builds, description: "Build state, artifacts, failures, and release readiness." },
  qa: { label: PRODUCT_TERMS.qa, description: "Test execution, regressions, failed checks, and verification work." },
  tickets: { label: PRODUCT_TERMS.tickets, description: "Assigned tickets, comments, status changes, and escalations." },
  scheduler: { label: PRODUCT_TERMS.scheduler, description: "Production windows, capacity, resource, and staffing changes." },
  calendar: { label: "Calendar", description: "Events, invitations, and calendar-owned reminders." },
  timeline: { label: PRODUCT_TERMS.timeline, description: "Milestones, deadlines, and timeline changes." },
  library: { label: PRODUCT_TERMS.library, description: "File, asset, lineage, and shared library changes." },
  people: { label: PRODUCT_TERMS.people, description: "Profile, team, role, and people workflow changes." },
  automation: { label: "Automation", description: "Automation runs, failures, and action-required outcomes." },
  system: { label: "System", description: "Server, account, privacy, security, and administrative events." },
};
