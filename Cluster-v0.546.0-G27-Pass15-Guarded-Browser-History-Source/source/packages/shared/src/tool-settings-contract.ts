/**
 * Canonical persisted Studio setting keys for the six Tool Infrastructure editors.
 * Tool-level controls that share Studio authority are explicitly named here.
 * A tool must never dynamically synthesize storage keys from user input.
 */
import type { ClusterAdminConfigurableToolId } from "./cluster-manifest.js";

export type ClusterSettingPrecondition = { exists: boolean; value?: unknown };
export const CLUSTER_TOOL_SETTING_KEYS: Readonly<Record<ClusterAdminConfigurableToolId, Readonly<Record<string, string>>>> = {
      timeline: { enabled: "timelineEnabled", defaultView: "timelineDefaultView", includeCalendar: "timelineIncludeCalendar", includeDueDates: "timelineIncludeDueDates", includeSchedule: "timelineIncludeSchedule", allowManualItems: "timelineAllowManualItems", allowComments: "timelineAllowComments", allowExports: "timelineAllowExports", defaultRangeDays: "timelineDefaultRangeDays", maxRangeDays: "timelineMaxRangeDays", maxItemsPerPage: "timelineMaxItemsPerPage", milestoneCadence: "studioDefaultMilestoneCadence", statusReportCadence: "studioStatusReportCadence" },
      tickets: { enabled: "ticketsEnabled", defaultQueue: "ticketsDefaultQueue", requireProject: "ticketsRequireProject", autoAssignCreator: "ticketsAutoAssignCreator", allowAttachments: "ticketsAllowAttachments", attachmentLimitMb: "ticketsAttachmentLimitMb", requireAssigneeOnClose: "ticketsRequireAssigneeOnClose", defaultPriority: "ticketsDefaultPriority", slaHours: "ticketsSlaHours", autoArchiveDays: "ticketsAutoArchiveDays" },
      calendar: { enabled: "calendarEnabled", defaultView: "calendarDefaultView", weekStartsMonday: "calendarWeekStartsMonday", includeDueCards: "calendarIncludeDueCards", allowRecurring: "calendarAllowRecurring", conflictWarnings: "calendarConflictWarnings", allowExternalGuests: "calendarAllowExternalGuests", defaultDurationMinutes: "calendarDefaultDurationMinutes", maximumDurationHours: "calendarMaximumDurationHours", minimumNoticeMinutes: "calendarMinimumNoticeMinutes" },
      scheduler: { enabled: "schedulerEnabled", defaultView: "schedulerDefaultView", defaultBillable: "schedulerDefaultBillable", billableProjectIds: "schedulerBillableProjectIds", billableCategories: "schedulerBillableCategories", overtimeHours: "schedulerOvertimeHours", autoCloseHours: "schedulerAutoCloseHours", allowSelfEdits: "schedulerAllowSelfEdits", allowSelfDelete: "schedulerAllowSelfDelete", allowManualEntries: "schedulerAllowManualEntries", allowScheduleSelfEdits: "schedulerAllowScheduleSelfEdits", allowScheduleSelfDelete: "schedulerAllowScheduleSelfDelete", resourcePlanningEnabled: "schedulerResourcePlanningEnabled", conflictWarnings: "schedulerConflictWarnings", calendarMirrorDefault: "schedulerCalendarMirrorDefault", requireProject: "schedulerRequireProject", editWindowDays: "schedulerEditWindowDays", lockAfterDays: "schedulerLockAfterDays", roundingMinutes: "schedulerRoundingMinutes", minimumBreakMinutes: "schedulerMinimumBreakMinutes", timezone: "studioTimezone", workingDaysCsv: "studioWorkingDaysCsv", workdayStart: "studioWorkdayStart", workdayEnd: "studioWorkdayEnd" },
      library: { enabled: "libraryEnabled", defaultLayout: "libraryDefaultLayout", showFilesInTree: "libraryShowFilesInTree", rootName: "studioLibraryRootName", createStarterFolder: "defaultCreateStarterLibrary", defaultLicense: "studioDefaultLicense", templatePolicy: "studioTemplatePolicy", tagPresetCsv: "tagPresetCsv", previewLimitMb: "libraryPreviewLimitMb", maxUploadMb: "libraryMaxUploadMb", modelPreviewMaxMb: "libraryModelPreviewMaxMb", thumbnailWidth: "libraryThumbnailWidth", thumbnailQuality: "libraryThumbnailQuality", allowExternalLinks: "libraryAllowExternalLinks", allowYoutube: "libraryAllowYoutube", allowModelPreviews: "libraryAllowModelPreviews", allowBlendPreviews: "libraryAllowBlendPreviews", desktopMountPolicy: "libraryDesktopMountPolicy", desktopMountIsolation: "libraryDesktopMountIsolation", sensitiveOfflineCachePolicy: "librarySensitiveOfflineCachePolicy", crossServerTransferPolicy: "libraryCrossServerTransferPolicy", desktopMountReadOnly: "libraryDesktopMountReadOnly" },
      packets: { enabled: "packetsEnabled", rootName: "packetsRootName", defaultView: "packetsDefaultView", showDescriptions: "packetsShowDescriptions", allowYoutube: "packetsAllowYoutube", allowPdf: "packetsAllowPdf", allowExternalLinks: "packetsAllowExternalLinks", featuredLimit: "packetsFeaturedLimit" }
    };

export function clusterToolSettingsPatch(tool: ClusterAdminConfigurableToolId, config: Record<string, unknown>): Record<string, unknown> {
  const mapping = CLUSTER_TOOL_SETTING_KEYS[tool];
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(config)) {
    if (Object.prototype.hasOwnProperty.call(mapping, field) && value !== undefined) patch[mapping[field]] = value;
  }
  return patch;
}

export function clusterToolSettingKeys(tool: ClusterAdminConfigurableToolId): string[] {
  return [...new Set(Object.values(CLUSTER_TOOL_SETTING_KEYS[tool]))];
}

/** Studio-wide policy fields exposed by a Tool editor. These do not belong
 * privately to the tool: writes affect the whole Studio and other consumers.
 * Keep this explicit until independently scoped overrides are implemented.
 */
export const CLUSTER_LINKED_STUDIO_TOOL_FIELDS: Readonly<Partial<Record<ClusterAdminConfigurableToolId, Readonly<Record<string, string>>>>> = {
  timeline: {
    milestoneCadence: "Studio milestone cadence (Projects and reporting)",
    statusReportCadence: "Studio status report cadence",
  },
  scheduler: {
    timezone: "Studio timezone (Calendar and time reporting)",
    workingDaysCsv: "Studio working days",
    workdayStart: "Studio workday start",
    workdayEnd: "Studio workday end",
  },
  library: {
    rootName: "Studio Library root naming",
    createStarterFolder: "Studio project starter Library policy",
    defaultLicense: "Studio default content license",
    templatePolicy: "Studio template policy",
  },
};

export type ClusterToolSettingAuthority = "tool" | "studio";
export function clusterToolSettingAuthority(tool: ClusterAdminConfigurableToolId, field: string): {
  persistedKey: string;
  scope: ClusterToolSettingAuthority;
  description: string;
} | null {
  if (!Object.prototype.hasOwnProperty.call(CLUSTER_TOOL_SETTING_KEYS[tool], field)) return null;
  const linked = CLUSTER_LINKED_STUDIO_TOOL_FIELDS[tool]?.[field];
  return {
    persistedKey: CLUSTER_TOOL_SETTING_KEYS[tool][field],
    scope: linked ? "studio" : "tool",
    description: linked || `${tool} tool configuration`,
  };
}

/** Return Studio-owned Tool Configuration fields affected by a changed-key patch.
 * The check is keyed by persisted setting identity, not by the UI field label.
 * Used by API enforcement and client impact previews. */
export function clusterToolStudioChangeImpact(
  tool: ClusterAdminConfigurableToolId,
  changedSettingKeys: readonly string[],
): Array<{ field: string; persistedKey: string; description: string }> {
  const changed = new Set(changedSettingKeys);
  const studioFields = CLUSTER_LINKED_STUDIO_TOOL_FIELDS[tool] || {};
  const mapping = CLUSTER_TOOL_SETTING_KEYS[tool];
  return Object.entries(studioFields)
    .filter(([field]) => changed.has(mapping[field]))
    .map(([field, description]) => ({ field, persistedKey: mapping[field], description }));
}


/** Explain the origin of each effective Tool Config field without exposing its
 * raw persisted value. Missing AppSetting rows mean the normal resolved
 * setting fallback was used; this is NOT project/user inheritance yet.
 * A stored JSON null remains an explicit stored value, never a fallback.
 */
export type ClusterToolSettingProvenance = {
  field: string;
  persistedKey: string;
  scope: ClusterToolSettingAuthority;
  description: string;
  source: "stored" | "resolved";
};

export function clusterToolSettingProvenance(
  tool: ClusterAdminConfigurableToolId,
  preconditions: Readonly<Record<string, ClusterSettingPrecondition>>,
): ClusterToolSettingProvenance[] {
  return Object.keys(CLUSTER_TOOL_SETTING_KEYS[tool]).map((field) => {
    const authority = clusterToolSettingAuthority(tool, field);
    if (!authority) throw new Error(`Unknown tool configuration field: ${tool}.${field}`);
    const baseline = preconditions[authority.persistedKey];
    if (!baseline || typeof baseline.exists !== "boolean") {
      throw new Error(`Missing authoritative setting source for ${authority.persistedKey}`);
    }
    return {
      field,
      persistedKey: authority.persistedKey,
      scope: authority.scope,
      description: authority.description,
      source: baseline.exists ? "stored" : "resolved",
    };
  });
}


/** Value and constraint metadata for Tool Configuration. This is deliberately
 * dependency-free: the renderer consumes limits without bundling server Zod.
 * A change to a field's type/range/allowed values belongs here, not in routes.
 */
export type ClusterToolFieldSpec =
  | { readonly kind: "boolean" }
  | { readonly kind: "number"; readonly integer?: boolean; readonly min?: number; readonly max?: number }
  | { readonly kind: "string"; readonly min?: number; readonly max?: number; readonly format?: "HH:mm" }
  | { readonly kind: "string-array"; readonly max?: number }
  | { readonly kind: "enum"; readonly values: readonly string[] };

export const CLUSTER_TOOL_CONFIG_FIELDS = {
  timeline: {
    enabled: { kind: "boolean" },
    defaultView: { kind: "enum", values: ["roadmap", "calendar", "list"] },
    includeCalendar: { kind: "boolean" },
    includeDueDates: { kind: "boolean" },
    includeSchedule: { kind: "boolean" },
    allowManualItems: { kind: "boolean" },
    allowComments: { kind: "boolean" },
    allowExports: { kind: "boolean" },
    defaultRangeDays: { kind: "number", integer: true, min: 1, max: 365 },
    maxRangeDays: { kind: "number", integer: true, min: 7, max: 730 },
    maxItemsPerPage: { kind: "number", integer: true, min: 50, max: 5000 },
    milestoneCadence: { kind: "enum", values: ["weekly", "biweekly", "monthly", "custom"] },
    statusReportCadence: { kind: "enum", values: ["off", "weekly", "biweekly", "monthly"] },
  },
  tickets: {
    enabled: { kind: "boolean" },
    defaultQueue: { kind: "enum", values: ["all", "open", "urgent", "review"] },
    requireProject: { kind: "boolean" },
    autoAssignCreator: { kind: "boolean" },
    allowAttachments: { kind: "boolean" },
    attachmentLimitMb: { kind: "number", integer: true, min: 1, max: 2048 },
    requireAssigneeOnClose: { kind: "boolean" },
    defaultPriority: { kind: "enum", values: ["low", "normal", "high", "urgent"] },
    slaHours: { kind: "number", integer: true, min: 1, max: 8760 },
    autoArchiveDays: { kind: "number", integer: true, min: 0, max: 3650 },
  },
  calendar: {
    enabled: { kind: "boolean" },
    defaultView: { kind: "enum", values: ["agenda", "week", "month", "day"] },
    weekStartsMonday: { kind: "boolean" },
    includeDueCards: { kind: "boolean" },
    allowRecurring: { kind: "boolean" },
    conflictWarnings: { kind: "boolean" },
    allowExternalGuests: { kind: "boolean" },
    defaultDurationMinutes: { kind: "number", integer: true, min: 5, max: 1440 },
    maximumDurationHours: { kind: "number", integer: true, min: 1, max: 720 },
    minimumNoticeMinutes: { kind: "number", integer: true, min: 0, max: 10080 },
  },
  scheduler: {
    enabled: { kind: "boolean" },
    defaultView: { kind: "enum", values: ["week", "schedule", "team"] },
    defaultBillable: { kind: "boolean" },
    billableProjectIds: { kind: "string-array", max: 5000 },
    billableCategories: { kind: "string-array", max: 100 },
    overtimeHours: { kind: "number", min: 1, max: 168 },
    autoCloseHours: { kind: "number", min: 1, max: 72 },
    allowSelfEdits: { kind: "boolean" },
    allowSelfDelete: { kind: "boolean" },
    allowManualEntries: { kind: "boolean" },
    allowScheduleSelfEdits: { kind: "boolean" },
    allowScheduleSelfDelete: { kind: "boolean" },
    resourcePlanningEnabled: { kind: "boolean" },
    conflictWarnings: { kind: "boolean" },
    calendarMirrorDefault: { kind: "boolean" },
    requireProject: { kind: "boolean" },
    editWindowDays: { kind: "number", integer: true, min: 0, max: 3650 },
    lockAfterDays: { kind: "number", integer: true, min: 0, max: 3650 },
    roundingMinutes: { kind: "number", integer: true, min: 1, max: 60 },
    minimumBreakMinutes: { kind: "number", integer: true, min: 0, max: 240 },
    timezone: { kind: "string", min: 1, max: 100 },
    workingDaysCsv: { kind: "string", min: 1, max: 200 },
    workdayStart: { kind: "string", format: "HH:mm" },
    workdayEnd: { kind: "string", format: "HH:mm" },
  },
  library: {
    enabled: { kind: "boolean" },
    defaultLayout: { kind: "enum", values: ["grid", "list"] },
    showFilesInTree: { kind: "boolean" },
    rootName: { kind: "string", min: 1, max: 100 },
    createStarterFolder: { kind: "boolean" },
    defaultLicense: { kind: "string", max: 200 },
    templatePolicy: { kind: "enum", values: ["optional", "recommended", "required"] },
    tagPresetCsv: { kind: "string", max: 5000 },
    previewLimitMb: { kind: "number", integer: true, min: 8, max: 512 },
    maxUploadMb: { kind: "number", integer: true, min: 1, max: 4096 },
    modelPreviewMaxMb: { kind: "number", integer: true, min: 8, max: 4096 },
    thumbnailWidth: { kind: "number", integer: true, min: 240, max: 1600 },
    thumbnailQuality: { kind: "number", integer: true, min: 30, max: 100 },
    allowExternalLinks: { kind: "boolean" },
    allowYoutube: { kind: "boolean" },
    allowModelPreviews: { kind: "boolean" },
    allowBlendPreviews: { kind: "boolean" },
    desktopMountPolicy: { kind: "enum", values: ["disabled", "user-choice", "required"] },
    desktopMountIsolation: { kind: "enum", values: ["shared", "dedicated", "exclusive"] },
    sensitiveOfflineCachePolicy: { kind: "enum", values: ["disabled", "protected"] },
    crossServerTransferPolicy: { kind: "enum", values: ["allowed", "approval", "trusted-only", "disabled"] },
    desktopMountReadOnly: { kind: "boolean" },
  },
  packets: {
    enabled: { kind: "boolean" },
    rootName: { kind: "string", min: 1, max: 100 },
    defaultView: { kind: "enum", values: ["grid", "list"] },
    showDescriptions: { kind: "boolean" },
    allowYoutube: { kind: "boolean" },
    allowPdf: { kind: "boolean" },
    allowExternalLinks: { kind: "boolean" },
    featuredLimit: { kind: "number", integer: true, min: 1, max: 100 },
  },
} as const satisfies Readonly<Record<ClusterAdminConfigurableToolId, Readonly<Record<string, ClusterToolFieldSpec>>>>;

/** Use the same numeric bounds in the editor and server validation. */
export function clusterToolNumericRange(tool: ClusterAdminConfigurableToolId, field: string): { min: number; max: number } {
  const spec: ClusterToolFieldSpec | undefined = (CLUSTER_TOOL_CONFIG_FIELDS[tool] as Readonly<Record<string, ClusterToolFieldSpec>>)[field];
  if (spec?.kind !== "number") throw new Error(`Not a numeric Tool Config field: ${tool}.${field}`);
  return { min: spec.min ?? Number.MIN_SAFE_INTEGER, max: spec.max ?? Number.MAX_SAFE_INTEGER };
}

/** Resolved values for the six existing Tool Config editors. These are Studio
 * setting projections, not Project/User inheritance or raw storage values. */
export function clusterResolveToolConfig(tool: ClusterAdminConfigurableToolId, settings: Record<string, any>): Record<string, any> {
    if (tool === "timeline") return {
      enabled: settings.timelineEnabled !== false,
      defaultView: settings.timelineDefaultView || "roadmap",
      includeCalendar: settings.timelineIncludeCalendar !== false,
      includeDueDates: settings.timelineIncludeDueDates !== false,
      includeSchedule: settings.timelineIncludeSchedule !== false,
      allowManualItems: settings.timelineAllowManualItems !== false,
      allowComments: settings.timelineAllowComments !== false,
      allowExports: settings.timelineAllowExports !== false,
      defaultRangeDays: settings.timelineDefaultRangeDays || 30,
      maxRangeDays: settings.timelineMaxRangeDays || 180,
      maxItemsPerPage: settings.timelineMaxItemsPerPage || 500,
      milestoneCadence: settings.studioDefaultMilestoneCadence || "biweekly",
      statusReportCadence: settings.studioStatusReportCadence || "weekly"
    };
    if (tool === "tickets") return {
      enabled: settings.ticketsEnabled !== false,
      defaultQueue: settings.ticketsDefaultQueue || "all",
      requireProject: Boolean(settings.ticketsRequireProject),
      autoAssignCreator: settings.ticketsAutoAssignCreator !== false,
      allowAttachments: settings.ticketsAllowAttachments !== false,
      attachmentLimitMb: settings.ticketsAttachmentLimitMb || 64,
      requireAssigneeOnClose: Boolean(settings.ticketsRequireAssigneeOnClose),
      defaultPriority: settings.ticketsDefaultPriority || "normal",
      slaHours: settings.ticketsSlaHours || 72,
      autoArchiveDays: settings.ticketsAutoArchiveDays ?? 90
    };
    if (tool === "calendar") return {
      enabled: settings.calendarEnabled !== false,
      defaultView: settings.calendarDefaultView || "agenda",
      weekStartsMonday: settings.calendarWeekStartsMonday !== false,
      includeDueCards: settings.calendarIncludeDueCards !== false,
      allowRecurring: settings.calendarAllowRecurring !== false,
      conflictWarnings: settings.calendarConflictWarnings !== false,
      allowExternalGuests: Boolean(settings.calendarAllowExternalGuests),
      defaultDurationMinutes: settings.calendarDefaultDurationMinutes || 60,
      maximumDurationHours: settings.calendarMaximumDurationHours || 24,
      minimumNoticeMinutes: settings.calendarMinimumNoticeMinutes || 0
    };
    if (tool === "scheduler") return {
      enabled: settings.schedulerEnabled !== false,
      defaultView: settings.schedulerDefaultView || "week",
      defaultBillable: Boolean(settings.schedulerDefaultBillable),
      billableProjectIds: settings.schedulerBillableProjectIds || [],
      billableCategories: settings.schedulerBillableCategories || [],
      overtimeHours: settings.schedulerOvertimeHours || 40,
      autoCloseHours: settings.schedulerAutoCloseHours || 16,
      allowSelfEdits: settings.schedulerAllowSelfEdits === true,
      allowSelfDelete: settings.schedulerAllowSelfDelete === true,
      allowManualEntries: settings.schedulerAllowManualEntries === true,
      allowScheduleSelfEdits: settings.schedulerAllowScheduleSelfEdits === true,
      allowScheduleSelfDelete: settings.schedulerAllowScheduleSelfDelete === true,
      resourcePlanningEnabled: settings.schedulerResourcePlanningEnabled !== false,
      conflictWarnings: settings.schedulerConflictWarnings !== false,
      calendarMirrorDefault: settings.schedulerCalendarMirrorDefault === true,
      requireProject: Boolean(settings.schedulerRequireProject),
      editWindowDays: settings.schedulerEditWindowDays ?? 14,
      lockAfterDays: settings.schedulerLockAfterDays ?? 30,
      roundingMinutes: settings.schedulerRoundingMinutes || 1,
      minimumBreakMinutes: settings.schedulerMinimumBreakMinutes || 0,
      timezone: settings.studioTimezone || "America/New_York",
      workingDaysCsv: settings.studioWorkingDaysCsv || "Mon, Tue, Wed, Thu, Fri",
      workdayStart: settings.studioWorkdayStart || "09:00",
      workdayEnd: settings.studioWorkdayEnd || "17:00"
    };
    if (tool === "packets") return {
      enabled: settings.packetsEnabled !== false,
      rootName: settings.packetsRootName || "Packets",
      defaultView: settings.packetsDefaultView || "grid",
      showDescriptions: settings.packetsShowDescriptions !== false,
      allowYoutube: settings.packetsAllowYoutube !== false,
      allowPdf: settings.packetsAllowPdf !== false,
      allowExternalLinks: settings.packetsAllowExternalLinks !== false,
      featuredLimit: settings.packetsFeaturedLimit || 12
    };
    return {
      enabled: settings.libraryEnabled !== false,
      defaultLayout: settings.libraryDefaultLayout || "grid",
      showFilesInTree: Boolean(settings.libraryShowFilesInTree),
      rootName: settings.studioLibraryRootName || "Studio Library",
      createStarterFolder: settings.defaultCreateStarterLibrary !== false,
      defaultLicense: settings.studioDefaultLicense || "Internal use",
      templatePolicy: settings.studioTemplatePolicy || "recommended",
      tagPresetCsv: settings.tagPresetCsv || "",
      previewLimitMb: settings.libraryPreviewLimitMb || 64,
      maxUploadMb: settings.libraryMaxUploadMb || settings.uploadLimitMb || 512,
      modelPreviewMaxMb: settings.libraryModelPreviewMaxMb || 512,
      thumbnailWidth: settings.libraryThumbnailWidth || 480,
      thumbnailQuality: settings.libraryThumbnailQuality ?? 84,
      allowExternalLinks: settings.libraryAllowExternalLinks !== false,
      allowYoutube: settings.libraryAllowYoutube !== false,
      allowModelPreviews: settings.libraryAllowModelPreviews !== false,
      allowBlendPreviews: settings.libraryAllowBlendPreviews !== false,
      desktopMountPolicy: settings.libraryDesktopMountPolicy || "user-choice",
      desktopMountIsolation: settings.libraryDesktopMountIsolation || "shared",
      sensitiveOfflineCachePolicy: settings.librarySensitiveOfflineCachePolicy || "disabled",
      crossServerTransferPolicy: settings.libraryCrossServerTransferPolicy || "disabled",
      desktopMountReadOnly: Boolean(settings.libraryDesktopMountReadOnly)
    };
  }
