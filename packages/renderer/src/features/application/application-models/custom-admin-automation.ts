import type { ClusterCustomFieldAccess, ClusterCustomFieldDefinition, ClusterCustomFieldEntity, ClusterCustomFieldType, ClusterCustomFieldValue, ClusterStudioAutomationAction, ClusterStudioAutomationActionType, ClusterStudioAutomationCondition, ClusterStudioAutomationConditionOperator, ClusterStudioAutomationRule, ClusterStudioAutomationTrigger } from "@cluster/shared";
import type { Priority } from "./projects";
import type { Settings } from "./settings-server";

export type CustomFieldEntity = ClusterCustomFieldEntity;
export type CustomFieldType = ClusterCustomFieldType;
export type CustomFieldAccess = ClusterCustomFieldAccess;
export type StudioCustomFieldDefinition = ClusterCustomFieldDefinition;

export type AutomationTrigger = ClusterStudioAutomationTrigger;
export type AutomationConditionOperator = ClusterStudioAutomationConditionOperator;
export type AutomationActionType = ClusterStudioAutomationActionType;
export type AutomationCondition = ClusterStudioAutomationCondition;
export type AutomationAction = ClusterStudioAutomationAction;
export type StudioAutomationRule = ClusterStudioAutomationRule;

export type AutomationRunRecord = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  entityType: string;
  entityLabel: string;
  status: "matched" | "skipped" | "queued" | "executed" | "failed";
  result: string;
  attempt?: number;
  createdAt: string;
};

export type AutomationQueueRecord = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  entityLabel: string;
  action: AutomationAction;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  maxRetries: number;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  cardPayload: {
    listId: string;
    title: string;
    description: string;
    priority: Priority;
    dueDate: string | null;
    labels: string[];
    assigneeId: string | null;
  };
};

export type VersionSnapshotRecord = {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  note?: string;
  kind?: "manual" | "automatic" | "pre-restore";
  createdAt: string;
  data: unknown;
};

export type CustomFieldValueRecord = ClusterCustomFieldValue & { updatedAt: string };

export type StudioSettingsSection = "identity" | "domains" | "privacy" | "kiosk" | "studioSystems" | "people" | "roles" | "departments" | "defaults" | "createFields" | "customFields" | "automations" | "workflow" | "builds" | "versioning" | "qa" | "starters" | "projectTypes" | "whiteboards";

export type ServerConfigSection = "overview" | "network" | "domains" | "security" | "storage" | "backups" | "performance" | "maintenance" | "integrations" | "sessions" | "advanced";

export type ServerConfigFieldType = "text" | "password" | "number" | "boolean" | "textarea" | "select" | "date" | "time";

export type ServerConfigField = {
  key: keyof Settings;
  label: string;
  section: Exclude<ServerConfigSection, "overview" | "sessions" | "advanced">;
  group: string;
  type: ServerConfigFieldType;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  restart?: boolean;
  wide?: boolean;
  options?: Array<{ value: string; label: string }>;
};
