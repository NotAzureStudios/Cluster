import { z } from "zod";

/**
 * Canonical studio-automation vocabulary shared by the renderer and server.
 * Project-type automation remains a separate, richer domain and should not be
 * collapsed into these studio-rule actions.
 */
export const CLUSTER_STUDIO_AUTOMATION_TRIGGERS = [
  "ticket_created",
  "ticket_urgent",
  "ticket_updated",
  "ticket_status_changed",
  "project_created",
  "build_failed",
  "build_completed",
  "qa_failed",
  "qa_passed",
  "release_published",
  "calendar_upcoming",
  "calendar_started",
  "time_overtime",
  "user_status_changed",
  "custom_field_changed",
] as const;
export type ClusterStudioAutomationTrigger = (typeof CLUSTER_STUDIO_AUTOMATION_TRIGGERS)[number];

export const CLUSTER_STUDIO_AUTOMATION_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "is_empty",
  "is_not_empty",
  "in",
] as const;
export type ClusterStudioAutomationConditionOperator = (typeof CLUSTER_STUDIO_AUTOMATION_CONDITION_OPERATORS)[number];

export const CLUSTER_STUDIO_AUTOMATION_ACTION_TYPES = [
  "add_label",
  "remove_label",
  "set_priority",
  "assign_department",
  "assign_user",
  "notify_inbox",
  "set_due_offset",
  "set_custom_field",
  "add_comment",
  "request_approval",
] as const;
export type ClusterStudioAutomationActionType = (typeof CLUSTER_STUDIO_AUTOMATION_ACTION_TYPES)[number];

export const clusterStudioAutomationConditionSchema = z.object({
  id: z.string().min(1).max(180),
  field: z.string().min(1).max(180),
  operator: z.enum(CLUSTER_STUDIO_AUTOMATION_CONDITION_OPERATORS),
  value: z.string().max(8000),
});
export type ClusterStudioAutomationCondition = z.infer<typeof clusterStudioAutomationConditionSchema>;

export const clusterStudioAutomationActionSchema = z.object({
  id: z.string().min(1).max(180),
  type: z.enum(CLUSTER_STUDIO_AUTOMATION_ACTION_TYPES),
  value: z.string().max(16_000),
});
export type ClusterStudioAutomationAction = z.infer<typeof clusterStudioAutomationActionSchema>;

export const clusterStudioAutomationRuleSchema = z.object({
  id: z.string().min(1).max(180),
  name: z.string().min(1).max(180),
  trigger: z.enum(CLUSTER_STUDIO_AUTOMATION_TRIGGERS),
  conditions: z.array(clusterStudioAutomationConditionSchema).max(40).default([]),
  actions: z.array(clusterStudioAutomationActionSchema).min(1).max(40),
  priority: z.number().int().min(1).max(100).default(50),
  projectId: z.string().max(180).default(""),
  delayMinutes: z.number().min(0).max(43_200).default(0),
  maxRetries: z.number().int().min(0).max(10).default(3),
  stopProcessing: z.boolean().default(false),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type ClusterStudioAutomationRule = z.infer<typeof clusterStudioAutomationRuleSchema>;

export const clusterStudioAutomationEventSchema = z.object({
  id: z.string().max(240).optional(),
  trigger: z.enum(CLUSTER_STUDIO_AUTOMATION_TRIGGERS),
  entityType: z.string().min(1).max(80),
  entityId: z.string().min(1).max(240),
  entityLabel: z.string().min(1).max(500),
  projectId: z.string().max(180).nullable().optional(),
  context: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
});
export type ClusterStudioAutomationEvent = z.infer<typeof clusterStudioAutomationEventSchema>;
