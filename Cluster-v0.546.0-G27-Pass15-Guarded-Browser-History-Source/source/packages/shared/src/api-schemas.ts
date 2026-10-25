import { z } from "zod";
import { CLUSTER_REMOTE_SEARCH_SCOPE_IDS, type ClusterRemoteSearchScope } from "./cluster-manifest.js";

const optionalText = (maximum = 500) => z.string().trim().min(1).max(maximum).optional();
const nullableText = (maximum = 500) => z.string().trim().max(maximum).nullable().optional();
const positiveLimit = (maximum: number, fallback: number) =>
  z.coerce.number().int().min(1).max(maximum).optional().default(fallback);

export const booleanQuerySchema = z.preprocess(
  (value: unknown) => value === true || value === "true" || value === "1",
  z.boolean(),
);


export const commandSearchScopeSchema = z.enum(CLUSTER_REMOTE_SEARCH_SCOPE_IDS as unknown as [ClusterRemoteSearchScope, ...ClusterRemoteSearchScope[]]);
export const commandSearchQuerySchema = z.object({
  q: z.string().trim().max(240).default(""),
  scope: commandSearchScopeSchema.default("all"),
  limit: positiveLimit(80, 40),
});

export const userDirectoryQuerySchema = z.object({
  limit: positiveLimit(1000, 500),
  cursor: optionalText(500),
  includeArchived: booleanQuerySchema.optional().default(false),
  department: optionalText(120),
  role: optionalText(120),
});

export const presenceDisclosureSchema = z.enum(["connection", "work_state", "application", "project", "detailed"]);
export const userAvailabilitySchema = z.enum(["available", "busy", "focus", "do_not_disturb", "away"]);
export const connectionVisibilitySchema = z.enum(["visible", "invisible"]);
export const recognizedWorkApplicationSchema = z.enum(["cluster", "unreal", "uefn", "blender", "visual_studio", "vscode", "photoshop", "after_effects", "premiere", "substance", "maya", "houdini"]);
export const presenceResourceKindSchema = z.enum(["project", "repository", "branch", "board", "whiteboard", "ticket", "library", "build", "qa", "timeline"]);

export const userPresenceUpdateSchema = z.object({
  availability: userAvailabilitySchema.optional(),
  message: nullableText(160),
  declaredStatus: nullableText(120),
  presenceDisclosure: presenceDisclosureSchema.optional(),
  connectionVisibility: connectionVisibilitySchema.optional(),
});

export const presenceContextUpdateSchema = z.object({
  applicationKey: recognizedWorkApplicationSchema.nullable().optional(),
  projectId: nullableText(200),
  repositoryId: nullableText(200),
  branch: nullableText(240),
  resourceKind: presenceResourceKindSchema.nullable().optional(),
  resourceId: nullableText(240),
  sensitivity: z.enum(["normal", "restricted"]).optional().default("normal"),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const activityQuerySchema = z.object({
  limit: positiveLimit(250, 100),
  cursor: optionalText(500),
  type: optionalText(120),
  entityType: optionalText(120),
  entityId: optionalText(200),
  projectId: optionalText(200),
  userId: optionalText(200),
});

export const userActivityQuerySchema = z.object({
  limit: positiveLimit(1000, 500),
});

export const notificationToolSchema = z.enum(["project", "boards", "whiteboards", "review", "builds", "qa", "tickets", "scheduler", "calendar", "timeline", "library", "people", "automation", "system"]);
export const notificationSignalSchema = z.enum(["activity", "mention", "assignment", "comment", "review", "version", "approval", "due", "failure", "blocked", "release", "security", "announcement", "digest"]);

export const notificationQuerySchema = z.object({
  limit: positiveLimit(250, 100),
  cursor: optionalText(500),
  includeRead: booleanQuerySchema.optional().default(false),
  includeSnoozed: booleanQuerySchema.optional().default(false),
  categories: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(z.enum(["activity", "mentions", "approvals", "delivery", "qa", "schedule", "work", "system"])).max(8).optional()),
  priorities: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(z.enum(["normal", "medium", "high", "critical"])).max(4).optional()),
  tools: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(notificationToolSchema).max(14).optional()),
  signals: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(notificationSignalSchema).max(14).optional()),
  requiresAction: booleanQuerySchema.optional(),
  query: optionalText(160),
});

export const notificationGroupQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(168),
  groupBy: z.enum(["thread", "project", "category", "tool"]).default("thread"),
  includeRead: booleanQuerySchema.optional().default(true),
  limit: positiveLimit(100, 24),
});

export const notificationStateMutationSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(250),
  read: z.boolean().optional(),
});

export const notificationSnoozeMutationSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(250),
  until: z.string().datetime({ offset: true }).nullable(),
});

export const notificationAcknowledgeMutationSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(250),
  acknowledged: z.boolean().optional().default(true),
});

const securityEventFiltersSchema = z.object({
  event: optionalText(160),
  result: z.enum(["SUCCESS", "FAILURE"]).optional(),
  actorUserId: optionalText(200),
  targetUserId: optionalText(200),
  requestId: optionalText(96),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const securityEventQuerySchema = securityEventFiltersSchema.extend({
  limit: positiveLimit(250, 100),
  cursor: optionalText(500),
});

export const securityEventExportQuerySchema = securityEventFiltersSchema.extend({
  limit: positiveLimit(5000, 5000),
});

export const auditActivityQuerySchema = z.object({
  limit: positiveLimit(250, 100),
  cursor: optionalText(500),
  type: optionalText(120),
  entityType: optionalText(120),
  entityId: optionalText(200),
  projectId: optionalText(200),
  userId: optionalText(200),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const collaborationToolSchema = z.enum(["project", "board", "whiteboard", "build", "qa", "timeline", "calendar", "scheduler", "library", "release", "control"]);
export const collaborationEntityReferenceSchema = z.object({
  entityType: z.string().trim().min(1).max(60),
  entityId: z.string().trim().min(1).max(160),
  label: nullableText(180),
});

export const collaborationResourceQuerySchema = z.object({
  tool: collaborationToolSchema,
  resourceId: z.string().trim().min(1).max(200),
});

export const collaborationHeartbeatSchema = collaborationResourceQuerySchema.extend({
  projectId: nullableText(200),
  clientId: nullableText(120),
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().nullable().optional(),
  }).nullable().optional(),
  activity: nullableText(120),
  selection: collaborationEntityReferenceSchema.nullable().optional(),
  editing: collaborationEntityReferenceSchema.nullable().optional(),
});

export const collaborationStreamQuerySchema = collaborationResourceQuerySchema.extend({
  clientId: optionalText(120),
});

export const collaborationLeaveSchema = collaborationResourceQuerySchema.extend({
  clientId: nullableText(120),
});

export const collaborationActionSchema = collaborationResourceQuerySchema.extend({
  projectId: nullableText(200),
  entity: collaborationEntityReferenceSchema.nullable().optional(),
  action: z.string().trim().min(1).max(80),
  detail: nullableText(240),
  resourceChanged: z.boolean().optional().default(true),
});

export type UserDirectoryQueryInput = z.infer<typeof userDirectoryQuerySchema>;
export type UserPresenceUpdateInput = z.infer<typeof userPresenceUpdateSchema>;
export type PresenceContextUpdateInput = z.infer<typeof presenceContextUpdateSchema>;
export type ActivityQueryInput = z.infer<typeof activityQuerySchema>;
export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
export type CollaborationHeartbeatInput = z.infer<typeof collaborationHeartbeatSchema>;
export type CollaborationActionSchemaInput = z.infer<typeof collaborationActionSchema>;


export const cursorPageQuerySchema = z.object({
  limit: positiveLimit(500, 100),
  cursor: optionalText(500),
});

export const syncDeviceRegistrationSchema = z.object({
  deviceId: z.string().uuid().optional(),
  name: nullableText(120),
  platform: nullableText(80),
  clientVersion: nullableText(40),
  mutationSchemaVersion: z.coerce.number().int().min(1).max(10).optional().default(1),
});

export const syncAcknowledgementSchema = z.object({
  deviceId: z.string().uuid(),
  cursor: z.string().max(8000).nullable().optional(),
});

export const syncConflictQuerySchema = z.object({
  deviceId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "QUARANTINED", "RESOLVED"]).optional().default("OPEN"),
  limit: positiveLimit(200, 50),
  cursor: optionalText(500),
});

export const syncConflictResolutionSchema = z.object({
  action: z.enum(["keep_mine", "keep_server", "merge", "restore", "duplicate", "discard"]),
  mergedBody: z.record(z.unknown()).optional(),
  fieldChoices: z.record(z.enum(["local", "server"])).optional(),
});

export const userDirectoryPageQuerySchema = userDirectoryQuerySchema.extend({
  paged: booleanQuerySchema.optional().default(false),
  summary: booleanQuerySchema.optional().default(false),
  dataQuery: optionalText(16_000),
});

export type SyncDeviceRegistrationInput = z.infer<typeof syncDeviceRegistrationSchema>;
export type SyncConflictQueryInput = z.infer<typeof syncConflictQuerySchema>;

export type CommandSearchQueryInput = z.infer<typeof commandSearchQuerySchema>;
