import type { ClusterSemanticField } from "./data-view-contracts.js";

/**
 * Canonical semantic fields for the first production domain Data Query/export adapters.
 * Query-only computed/internal fields may be non-exportable. Exportable fields still
 * intentionally exclude private profile data, free-form ticket descriptions, permission
 * blobs, and other fields whose visibility cannot be inferred from generic export intent.
 */
export const PROJECT_DATA_FIELDS = [
  { id: "id", label: "Project ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "name", label: "Project", type: "resource", sortable: true, filterable: true, exportable: true, resourceKind: "project" },
  { id: "externalName", label: "External name", type: "text", sortable: true, filterable: true, exportable: true },
  { id: "codename", label: "Codename", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "status", label: "Status", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "projectType", label: "Project type", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "productionProfile", label: "Production profile", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "source", label: "Source", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, computed: true, enumValues: ["git", "manual", "external"] },
  { id: "schedule", label: "Schedule", type: "status", filterable: true, groupable: true, facet: true, computed: true, enumValues: ["due_soon", "overdue", "unscheduled", "scheduled"] },
  { id: "priority", label: "Priority", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, enumValues: ["urgent", "high", "medium", "low"] },
  { id: "startDate", label: "Start date", type: "date", sortable: true, filterable: true, exportable: true },
  { id: "targetDate", label: "Target date", type: "date", sortable: true, filterable: true, exportable: true },
  { id: "archived", label: "Archived", type: "boolean", sortable: true, filterable: true, exportable: true },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "manualOrder", label: "Custom order", type: "number", sortable: true, filterable: false },
] as const satisfies readonly ClusterSemanticField[];

export const PEOPLE_DATA_FIELDS = [
  { id: "id", label: "Person ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "displayName", label: "Person", type: "person", sortable: true, filterable: true, exportable: true, resourceKind: "user" },
  { id: "username", label: "Username", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "title", label: "Role", type: "text", sortable: true, filterable: true, groupable: true, exportable: true },
  { id: "department", label: "Department", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "teamName", label: "Team", type: "text", sortable: true, filterable: true, groupable: true, exportable: true },
  { id: "status", label: "Presence", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "capacityHours", label: "Capacity", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "number", unit: "h/week" } },
  { id: "minimumHours", label: "Minimum hours", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "number", unit: "h/week" } },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
] as const satisfies readonly ClusterSemanticField[];

export const TICKET_DATA_FIELDS = [
  { id: "id", label: "Ticket ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "title", label: "Ticket", type: "resource", sortable: true, filterable: true, exportable: true, resourceKind: "ticket" },
  { id: "projectName", label: "Project", type: "resource", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, resourceKind: "project" },
  { id: "projectId", label: "Project ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "parentId", label: "Folder ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "boardName", label: "Board", type: "text", sortable: true, filterable: true, groupable: true, exportable: true },
  { id: "listTitle", label: "Queue", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "priority", label: "Priority", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, enumValues: ["urgent", "high", "medium", "low"] },
  { id: "assignee", label: "Assignee", type: "person", sortable: true, filterable: true, groupable: true, exportable: true, resourceKind: "user" },
  { id: "assigneeId", label: "Assignee ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "queueLane", label: "Queue lane", type: "status", filterable: true, groupable: true, facet: true, computed: true, enumValues: ["open", "triage", "urgent", "waiting", "review", "resolved", "rejected"] },
  { id: "dueDate", label: "Due", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "labels", label: "Labels", type: "text", filterable: true, exportable: true },
  { id: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
] as const satisfies readonly ClusterSemanticField[];


export const LIBRARY_DATA_FIELDS = [
  { id: "id", label: "Library ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "title", label: "Name", type: "resource", sortable: true, filterable: true, exportable: true, resourceKind: "library" },
  { id: "type", label: "Type", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "projectId", label: "Project ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "ownerId", label: "Owner ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "creatorId", label: "Creator ID", type: "text", filterable: true, sensitivity: "internal" },
  { id: "mimeType", label: "MIME type", type: "text", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "mimeGroup", label: "Media kind", type: "enum", sortable: false, filterable: true, enumValues: ["image", "video", "audio", "pdf", "text", "model", "office", "ebook", "archive"] },
  { id: "visibility", label: "Visibility", type: "enum", sortable: false, filterable: true, enumValues: ["public", "internal", "private", "restricted"] },
  { id: "pinned", label: "Pinned", type: "boolean", sortable: false, filterable: true },
  { id: "extension", label: "Extension", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "status", label: "Status", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "reviewState", label: "Review state", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "lifecycleState", label: "Lifecycle", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "classification", label: "Classification", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, enumValues: ["public", "internal", "confidential", "restricted"] },
  { id: "integrityState", label: "Integrity", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "source", label: "Source", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "sizeBytes", label: "Size", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "bytes" } },
  { id: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
] as const satisfies readonly ClusterSemanticField[];


export const PACKET_COMPLIANCE_DATA_FIELDS = [
  { id: "id", label: "Assignment ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "resourceTitle", label: "Packet", type: "resource", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, resourceKind: "packet" },
  { id: "resourceId", label: "Packet ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "person", label: "Person", type: "person", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, resourceKind: "user" },
  { id: "userId", label: "Person ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "username", label: "Username", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "version", label: "Packet version", type: "text", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "state", label: "Compliance state", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, enumValues: ["active", "completed", "cancelled"] },
  { id: "overdue", label: "Overdue", type: "boolean", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, computed: true },
  { id: "cycleStartedAt", label: "Assigned", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "dueAt", label: "Due", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "satisfiedAt", label: "Completed", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "nextRequiredAt", label: "Recertification due", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "evidenceId", label: "Evidence ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
] as const satisfies readonly ClusterSemanticField[];

export const POLICY_COMPLIANCE_DATA_FIELDS = [
  { id: "id", label: "Assignment ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "resourceTitle", label: "Policy", type: "resource", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, resourceKind: "policy" },
  { id: "resourceId", label: "Policy ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "person", label: "Person", type: "person", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, resourceKind: "user" },
  { id: "userId", label: "Person ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "username", label: "Username", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "version", label: "Policy version", type: "text", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "state", label: "Compliance state", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, enumValues: ["active", "completed", "cancelled"] },
  { id: "overdue", label: "Overdue", type: "boolean", sortable: true, filterable: true, groupable: true, facet: true, exportable: true, computed: true },
  { id: "cycleStartedAt", label: "Assigned", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "dueAt", label: "Due", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "satisfiedAt", label: "Accepted", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "nextRequiredAt", label: "Next required", type: "datetime", sortable: true, filterable: true, exportable: true },
  { id: "evidenceId", label: "Evidence ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, exportable: true },
] as const satisfies readonly ClusterSemanticField[];
