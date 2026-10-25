import { z } from "zod";

export const STUDIO_AUDIENCE_TARGET_KINDS = ["studio", "department", "team", "role", "project", "user"] as const;
export const studioAudienceTargetSchema = z.object({
  kind: z.enum(STUDIO_AUDIENCE_TARGET_KINDS),
  id: z.string().trim().min(1).max(160).optional(),
});
export const studioAudienceSchema = z.object({
  mode: z.enum(["all", "include", "exclude"]).default("all"),
  targets: z.array(studioAudienceTargetSchema).max(200).default([]),
}).superRefine((audience, ctx) => {
  if (audience.mode !== "all" && audience.targets.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "Targeted audiences require at least one target." });
});
export type StudioAudience = z.infer<typeof studioAudienceSchema>;

export const PACKET_KINDS = ["knowledge", "training", "onboarding", "policy", "procedure", "handoff"] as const;
export const PACKET_COMPLETION_MODES = ["none", "read", "acknowledge", "form"] as const;
export const packetDefinitionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  kind: z.enum(PACKET_KINDS).default("knowledge"),
  versionLabel: z.string().trim().min(1).max(80).default("1.0"),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
  completionMode: z.enum(PACKET_COMPLETION_MODES).default("none"),
  completionFormId: z.string().trim().min(1).max(160).nullable().optional(),
  required: z.boolean().default(false),
  dueDays: z.number().int().min(1).max(3650).nullable().optional(),
  recertifyDays: z.number().int().min(1).max(3650).nullable().optional(),
  recordCompletion: z.boolean().default(false),
});
export const packetDefinitionPatchSchema = packetDefinitionInputSchema.partial();
export type PacketDefinitionInput = z.infer<typeof packetDefinitionInputSchema>;

export const packetCompletionInputSchema = z.object({
  action: z.enum(["read", "acknowledge", "form"]),
  formSubmissionId: z.string().trim().min(1).max(160).nullable().optional(),
});
export type PacketCompletionInput = z.infer<typeof packetCompletionInputSchema>;

export const STUDIO_FORM_PURPOSES = ["general", "policy", "application", "onboarding", "access_request", "equipment", "incident", "completion", "release_signoff"] as const;
export const STUDIO_FORM_TEMPLATES = [
  { key: "application-basic", title: "Application", description: "General studio application with explicit People profile mapping candidates.", purpose: "application", fields: [
    { id: "display_name", label: "Name", description: "Name you want the studio to use.", type: "short_text", required: true, options: [], profileMappingKey: "displayName" },
    { id: "email", label: "Email", description: "Primary contact email.", type: "email", required: true, options: [], profileMappingKey: "email" },
    { id: "preferred_name", label: "Preferred name", description: "Optional preferred name.", type: "short_text", required: false, options: [], profileMappingKey: "preferredName" },
    { id: "phone", label: "Phone", description: "Optional contact number.", type: "short_text", required: false, options: [], profileMappingKey: "phoneNumber" },
    { id: "about", label: "About you", description: "Tell the studio about your background and what you want to work on.", type: "long_text", required: true, options: [], profileMappingKey: null },
  ] },
  { key: "onboarding-checkin", title: "Onboarding check-in", description: "Confirm onboarding basics and collect early questions.", purpose: "onboarding", fields: [
    { id: "ready", label: "I reviewed the onboarding material", description: "Confirm you completed the assigned onboarding material.", type: "acknowledgement", required: true, options: [], profileMappingKey: null },
    { id: "questions", label: "Questions or blockers", description: "Anything you still need from the studio.", type: "long_text", required: false, options: [], profileMappingKey: null },
  ] },
  { key: "access-request", title: "Access request", description: "Request access to a studio system, project, or resource.", purpose: "access_request", fields: [
    { id: "resource", label: "Resource", description: "System, project, repository, folder, or tool you need.", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "reason", label: "Business reason", description: "Why this access is required.", type: "long_text", required: true, options: [], profileMappingKey: null },
    { id: "duration", label: "Requested duration", description: "Optional end date or duration.", type: "short_text", required: false, options: [], profileMappingKey: null },
  ] },
  { key: "equipment-request", title: "Equipment request", description: "Request studio equipment or hardware.", purpose: "equipment", fields: [
    { id: "item", label: "Equipment", description: "What equipment do you need?", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "quantity", label: "Quantity", description: "Number of units requested.", type: "number", required: true, options: [], profileMappingKey: null },
    { id: "justification", label: "Justification", description: "How will this equipment be used?", type: "long_text", required: true, options: [], profileMappingKey: null },
  ] },
  { key: "incident-report", title: "Incident report", description: "Capture a production, security, safety, or operational incident.", purpose: "incident", fields: [
    { id: "summary", label: "Incident summary", description: "Short description of what happened.", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "date", label: "Incident date", description: "Date the incident occurred.", type: "date", required: true, options: [], profileMappingKey: null },
    { id: "impact", label: "Impact", description: "Who or what was affected?", type: "long_text", required: true, options: [], profileMappingKey: null },
    { id: "details", label: "Details and response", description: "Timeline, response, and any remaining risk.", type: "long_text", required: true, options: [], profileMappingKey: null },
  ] },
  { key: "completion-signoff", title: "Completion sign-off", description: "Record completion evidence for a workflow or deliverable.", purpose: "completion", fields: [
    { id: "deliverable", label: "Deliverable", description: "What was completed?", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "result", label: "Completion notes", description: "Outcome, evidence, or remaining follow-up.", type: "long_text", required: true, options: [], profileMappingKey: null },
    { id: "confirm", label: "I confirm this work is complete", description: "Completion acknowledgement.", type: "acknowledgement", required: true, options: [], profileMappingKey: null },
  ] },
  { key: "release-signoff", title: "Release sign-off", description: "Capture final release readiness and accountable sign-off.", purpose: "release_signoff", fields: [
    { id: "release", label: "Release / build", description: "Version, build, or release identifier.", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "environment", label: "Target environment", description: "Where this release is going.", type: "short_text", required: true, options: [], profileMappingKey: null },
    { id: "qa", label: "QA requirements are complete", description: "Confirm required QA has passed or has an approved exception.", type: "acknowledgement", required: true, options: [], profileMappingKey: null },
    { id: "signature", label: "Release sign-off", description: "Sign to approve this release.", type: "signature", required: true, options: [], profileMappingKey: null },
  ] },
] as const;
export const studioFormTemplateCreateSchema = z.object({
  templateKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).optional(),
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
});

export const STUDIO_FORM_FIELD_TYPES = ["short_text", "long_text", "number", "date", "email", "url", "select", "multi_select", "checkbox", "radio", "acknowledgement", "initials", "signature"] as const;
export const studioFormFieldSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().default(""),
  type: z.enum(STUDIO_FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  profileMappingKey: z.string().trim().max(160).nullable().optional(),
  // One condition on a preceding selection/boolean field; the order rule prevents cycles.
  visibleWhen: z.object({
    fieldId: z.string().trim().min(1).max(120),
    equals: z.union([z.string().max(200), z.boolean()]),
  }).nullable().optional(),
});
export const studioFormSchemaDefinitionSchema = z.object({
  fields: z.array(studioFormFieldSchema).max(200),
}).superRefine((definition, ctx) => {
  const seen = new Set<string>();
  definition.fields.forEach((field, index) => {
    const key = field.id.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "id"], message: "Form field identifiers must be unique." });
    seen.add(key);
    if (["select", "radio", "multi_select"].includes(field.type) && !field.options.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "options"], message: "Selection fields require options." });
    if (new Set(field.options.map((value) => value.toLowerCase())).size !== field.options.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "options"], message: "Options must be unique." });
    if (field.visibleWhen) {
      const source = definition.fields.slice(0, index).find((item) => item.id === field.visibleWhen?.fieldId);
      const value = field.visibleWhen.equals;
      if (!source) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "visibleWhen"], message: "Visibility conditions must reference an earlier field." });
      else if (["checkbox", "acknowledgement"].includes(source.type)) {
        if (typeof value !== "boolean") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "visibleWhen"], message: "Boolean visibility conditions require true or false." });
      } else if (["select", "radio", "multi_select"].includes(source.type)) {
        if (typeof value !== "string" || !source.options.includes(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "visibleWhen"], message: "Visibility conditions must match an existing source option." });
      } else ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "visibleWhen"], message: "Visibility conditions require a selection or checkbox source." });
    }
  });
});
export const studioFormCreateSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  purpose: z.enum(STUDIO_FORM_PURPOSES).default("general"),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
});
export const studioFormVersionCreateSchema = z.object({
  schema: studioFormSchemaDefinitionSchema,
  settings: z.object({
    allowDrafts: z.boolean().default(true),
    allowMultipleSubmissions: z.boolean().default(false),
    confirmationMessage: z.string().trim().max(1000).default("Submitted."),
    publicApplication: z.boolean().default(false),
    acceptingResponses: z.boolean().default(true),
    privacyNotice: z.string().trim().max(4000).default(""),
    notifyAdminsOnSubmission: z.boolean().default(true),
    // A deadline is advisory: late submissions remain possible while acceptingResponses is true.
    // ISO timestamps with offsets prevent ambiguity at daylight-saving transitions.
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    reminderDaysBefore: z.number().int().min(1).max(30).nullable().default(null),
    remindWhenOverdue: z.boolean().default(false),
  }).superRefine((settings, ctx) => {
    if (settings.reminderDaysBefore !== null && !settings.dueAt)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reminderDaysBefore"], message: "Reminders require a deadline." });
    if (settings.remindWhenOverdue && !settings.dueAt)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["remindWhenOverdue"], message: "Overdue reminders require a deadline." });
  }).default({ allowDrafts: true, allowMultipleSubmissions: false, confirmationMessage: "Submitted.", publicApplication: false, acceptingResponses: true, privacyNotice: "", notifyAdminsOnSubmission: true, dueAt: null, reminderDaysBefore: null, remindWhenOverdue: false }),
  publish: z.boolean().default(false),
});
export const studioFormSubmissionSchema = z.object({
  formVersionId: z.string().trim().min(1).max(160),
  answers: z.record(z.unknown()),
  respondentName: z.string().trim().max(200).nullable().optional(),
  respondentEmail: z.string().trim().email().max(320).nullable().optional(),
});
export const publicApplicationSubmissionSchema = studioFormSubmissionSchema.extend({
  privacyAccepted: z.literal(true),
  website: z.string().trim().max(200).optional().default(""),
});
export const STUDIO_APPLICATION_STATUSES = ["submitted", "under_review", "approved", "rejected", "converted"] as const;
export const STUDIO_APPLICATION_REVIEW_STATUSES = ["under_review", "approved", "rejected"] as const;
export const STUDIO_APPLICATION_LIST_DEFAULT_LIMIT = 50;
export const STUDIO_APPLICATION_LIST_MAX_LIMIT = 100;
export const studioApplicationListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(STUDIO_APPLICATION_STATUSES).optional(),
  formId: z.string().trim().min(1).max(160).optional(),
  cursor: z.string().trim().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(STUDIO_APPLICATION_LIST_MAX_LIMIT).optional().default(STUDIO_APPLICATION_LIST_DEFAULT_LIMIT),
});
export const studioApplicationReviewSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  status: z.enum(STUDIO_APPLICATION_REVIEW_STATUSES),
  note: z.string().trim().max(5000).default(""),
});
export const studioApplicationConversionSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  username: z.string().trim().min(2).max(80),
  selectedFieldIds: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  onboardingVersionId: z.string().trim().min(1).max(160).nullable().optional(),
});

export const STUDIO_POLICY_ACCEPTANCE_MODES = ["none", "acknowledge", "initials", "signature", "form"] as const;
export const studioPolicyCreateSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).default(""),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
  requiredForAccess: z.boolean().default(false),
  recordAcceptance: z.boolean().default(false),
});
export const studioPolicyVersionCreateSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  bodyMarkdown: z.string().min(1).max(250_000),
  acceptanceMode: z.enum(STUDIO_POLICY_ACCEPTANCE_MODES).default("acknowledge"),
  formVersionId: z.string().trim().min(1).max(160).nullable().optional(),
  effectiveAt: z.coerce.date().nullable().optional(),
  publish: z.boolean().default(false),
});
export const studioPolicyAcceptanceSchema = z.object({
  mode: z.enum(STUDIO_POLICY_ACCEPTANCE_MODES),
  initials: z.string().trim().max(20).nullable().optional(),
  signature: z.string().trim().max(300).nullable().optional(),
  formSubmissionId: z.string().trim().min(1).max(160).nullable().optional(),
});

export const STUDIO_ANNOUNCEMENT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const studioAnnouncementCreateSchema = z.object({
  createIntentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
  priority: z.enum(STUDIO_ANNOUNCEMENT_PRIORITIES).default("normal"),
  requiresAcknowledgement: z.boolean().default(false),
  discordDeliveryRequested: z.boolean().default(false),
  scheduledAt: z.coerce.date().nullable().optional(),
});
/** Editable content is independent from scheduling; the revision is the
 * compare-and-swap token shared with publication and rescheduling. */
export const studioAnnouncementDraftEditSchema = studioAnnouncementCreateSchema
  .omit({ scheduledAt: true, createIntentId: true })
  .extend({ revision: z.number().int().min(1) });
export const studioAnnouncementAudiencePreviewSchema = z.object({
  audience: studioAudienceSchema,
});

export const studioAnnouncementScheduleSchema = z.object({
  revision: z.number().int().min(1),
  scheduledAt: z.coerce.date().nullable(),
});

export const STUDIO_ONBOARDING_STEP_KINDS = ["packet", "policy", "form"] as const;
export const studioOnboardingStepInputSchema = z.object({
  kind: z.enum(STUDIO_ONBOARDING_STEP_KINDS),
  resourceId: z.string().trim().min(1).max(160),
  required: z.boolean().default(true),
});
export const studioOnboardingPlanCreateSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  audience: studioAudienceSchema.default({ mode: "all", targets: [] }),
});
export const studioOnboardingPlanVersionCreateSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  steps: z.array(studioOnboardingStepInputSchema).min(1).max(200),
  dueAfterDays: z.number().int().min(1).max(3650).nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(3650).nullable().optional(),
  escalationDaysAfter: z.number().int().min(0).max(3650).nullable().optional(),
  supersedePreviousAssignments: z.boolean().default(false),
  publish: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    const key = `${step.kind}:${step.resourceId}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", index], message: "An onboarding resource can appear only once in a version." });
    seen.add(key);
  }
});
export const STUDIO_ONBOARDING_ASSIGNMENT_ACTIONS = ["revoke", "cancel", "reactivate"] as const;
export const studioOnboardingAssignmentLifecycleSchema = z.object({
  action: z.enum(STUDIO_ONBOARDING_ASSIGNMENT_ACTIONS),
  reason: z.string().trim().max(2000).default(""),
});
export type StudioOnboardingStepInput = z.infer<typeof studioOnboardingStepInputSchema>;

export const STUDIO_OFFBOARDING_EQUIPMENT_STATUSES = ["pending", "returned", "waived"] as const;
export const studioOffboardingCreateSchema = z.object({
  userId: z.string().trim().min(1).max(160),
  handoffUserId: z.string().trim().min(1).max(160).nullable().optional(),
  scheduledFor: z.coerce.date().nullable().optional(),
  reason: z.string().trim().max(2000).default(""),
  notes: z.string().trim().max(5000).default(""),
});
export const studioOffboardingPreviewSchema = studioOffboardingCreateSchema.pick({ userId: true, handoffUserId: true });
export const studioOffboardingEquipmentSchema = z.object({
  expectedRevision: z.number().int().positive(),
  status: z.enum(["returned", "waived"]),
  note: z.string().trim().max(5000).default(""),
  libraryItemIds: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
}).superRefine((value, ctx) => {
  if (value.status === "waived" && !value.note.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "Record why the equipment-return requirement is being waived." });
  }
});
export const studioOffboardingExecuteSchema = z.object({
  expectedRevision: z.number().int().positive(),
  handoffUserId: z.string().trim().min(1).max(160).nullable().optional(),
  confirmation: z.literal("OFFBOARD"),
});
export const studioOffboardingReturnSchema = z.object({
  expectedRevision: z.number().int().positive(),
  confirmation: z.literal("RETURN"),
  reason: z.string().trim().min(10).max(2000),
  accountType: z.enum(["employee", "contractor", "client", "guest"]),
  accessExpiresAt: z.coerce.date().nullable().default(null),
});
export const studioOffboardingCancelSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

