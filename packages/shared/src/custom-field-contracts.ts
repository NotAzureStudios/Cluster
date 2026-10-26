import { z } from "zod";

/**
 * Canonical custom-field vocabulary. Server validation and renderer models must
 * consume these constants rather than maintaining parallel enum lists.
 */
export const CLUSTER_CUSTOM_FIELD_ENTITIES = [
  "ticket",
  "card",
  "project",
  "user",
  "calendar",
  "build",
  "qa",
  "issue",
  "board",
  "whiteboard",
  "time",
  "file",
  "library",
] as const;
export type ClusterCustomFieldEntity = (typeof CLUSTER_CUSTOM_FIELD_ENTITIES)[number];

export const CLUSTER_CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "multi-select",
  "boolean",
  "url",
  "duration",
  "user",
  "department",
] as const;
export type ClusterCustomFieldType = (typeof CLUSTER_CUSTOM_FIELD_TYPES)[number];

export const CLUSTER_CUSTOM_FIELD_ACCESS = ["everyone", "members", "managers", "admins"] as const;
export type ClusterCustomFieldAccess = (typeof CLUSTER_CUSTOM_FIELD_ACCESS)[number];

export const clusterCustomFieldDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(180),
  label: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(160).optional(),
  entity: z.enum(CLUSTER_CUSTOM_FIELD_ENTITIES),
  fieldType: z.enum(CLUSTER_CUSTOM_FIELD_TYPES),
  options: z.array(z.string().trim().max(160)).max(200).optional(),
  placeholder: z.string().max(500).optional(),
  helpText: z.string().max(2000).optional(),
  showWhenFieldId: z.string().max(180).optional(),
  showWhenValue: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
  defaultValue: z.union([z.string().max(8000), z.boolean()]).optional(),
  filterable: z.boolean().optional(),
  viewAccess: z.enum(CLUSTER_CUSTOM_FIELD_ACCESS).optional(),
  editAccess: z.enum(CLUSTER_CUSTOM_FIELD_ACCESS).optional(),
  archivedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).superRefine((field: { viewAccess?: ClusterCustomFieldAccess; editAccess?: ClusterCustomFieldAccess }, ctx: any) => {
  const rank = (access: ClusterCustomFieldAccess) => access === "admins" ? 3 : access === "managers" ? 2 : access === "members" ? 1 : 0;
  const viewAccess = field.viewAccess || "everyone";
  const editAccess = field.editAccess || "members";
  if (rank(editAccess) < rank(viewAccess)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editAccess"], message: "Edit access cannot be broader than view access." });
  }
});
export type ClusterCustomFieldDefinition = z.infer<typeof clusterCustomFieldDefinitionSchema>;

export const clusterCustomFieldValueSchema = z.object({
  id: z.string().trim().min(1).max(300),
  entity: z.enum(CLUSTER_CUSTOM_FIELD_ENTITIES),
  entityId: z.string().trim().min(1).max(180),
  fieldId: z.string().trim().min(1).max(180),
  projectId: z.string().trim().max(180).nullable().optional(),
  value: z.union([z.string().max(32_000), z.boolean()]),
  updatedAt: z.string().datetime().optional(),
  updatedBy: z.string().max(180).optional(),
});
export type ClusterCustomFieldValue = z.infer<typeof clusterCustomFieldValueSchema>;
