
import { CLUSTER_CREATE_MODE_IDS, resolveClusterProductionProfile, resolveClusterProjectPurposeTypes, resolveClusterProjectType, sanitizeClusterProjectTypeDefinition } from "@cluster/shared";
import { unique } from "../../../core/storage";
import { BUILD_PLATFORM_PROFILES } from "../../projects/ProjectBuildsPanel";
import type { Project, ProjectTypePreset, Settings, QuickCreateMode, AttentionItem, StudioCustomFieldDefinition } from "../../application/application-models";

export const DEFAULT_CREATE_PROJECT_FIELDS = ["name", "project type", "status", "visibility", "source", "description", "starter assets"];

export const DEFAULT_CREATE_BUILD_FIELDS = ["project", "platform", "version", "lane", "branch", "commit", "artifact link", "release notes"];

export const DEFAULT_ROLE_APPROVAL_ROLES = ["owner", "admin", "producer", "qa lead"];

export const DEFAULT_PROJECT_TYPE_PRESETS: ProjectTypePreset[] = resolveClusterProjectPurposeTypes().map((preset) => ({ ...preset, locked: false }));

export function slugProjectTypeId(value: string) {
  return (
    (value || "custom_project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "custom_project"
  );
}

export function cleanPresetList(input: unknown, fallback: string[] = [], limit = 16) {
  const source = Array.isArray(input) ? input : fallback;
  return unique(source.map((item) => String(item || "").trim()).filter(Boolean)).slice(0, limit);
}

export function sanitizeProjectTypePreset(input: Partial<ProjectTypePreset> | null | undefined, fallback?: ProjectTypePreset): ProjectTypePreset {
  const clean = sanitizeClusterProjectTypeDefinition(input, fallback || DEFAULT_PROJECT_TYPE_PRESETS[0]);
  return {
    ...clean,
    createFields: cleanPresetList(clean.createFields, fallback?.createFields || DEFAULT_CREATE_PROJECT_FIELDS, 18),
    requiredFields: cleanPresetList(clean.requiredFields, fallback?.requiredFields || ["name", "project type"], 18),
    buildFields: cleanPresetList(clean.buildFields, fallback?.buildFields || DEFAULT_CREATE_BUILD_FIELDS, 18),
    qaFields: cleanPresetList(clean.qaFields, fallback?.qaFields || ["build", "platform", "severity", "repro steps", "expected result", "actual result"], 18),
    releaseFields: cleanPresetList(clean.releaseFields, fallback?.releaseFields || ["release channel", "version", "changelog", "approval", "publish target"], 18),
    approvalRoles: cleanPresetList(clean.approvalRoles, fallback?.approvalRoles || DEFAULT_ROLE_APPROVAL_ROLES, 12),
    locked: false,
  };
}

export function mergeProjectTypePresets(presets?: ProjectTypePreset[] | null) {
  const resolved = resolveClusterProjectPurposeTypes(presets).map((preset) => sanitizeProjectTypePreset(preset, DEFAULT_PROJECT_TYPE_PRESETS.find((item) => item.id === preset.id)));
  return resolved.length ? resolved : [sanitizeProjectTypePreset(DEFAULT_PROJECT_TYPE_PRESETS[0])];
}

export let projectTypePresetSnapshot: ProjectTypePreset[] | null = null;

export function readProjectTypePresetsCache() {
  if (!projectTypePresetSnapshot) projectTypePresetSnapshot = mergeProjectTypePresets();
  return projectTypePresetSnapshot;
}

export function writeProjectTypePresetsCache(presets?: ProjectTypePreset[] | null) {
  projectTypePresetSnapshot = mergeProjectTypePresets(presets);
}

export function projectTypePresetsFromSettings(settings?: Settings | null) {
  const presets = mergeProjectTypePresets(settings?.projectTypePresets || readProjectTypePresetsCache());
  if (settings?.projectTypePresets) writeProjectTypePresetsCache(settings.projectTypePresets);
  return presets;
}

export function projectTypeMeta(type?: string | null, presets?: ProjectTypePreset[] | null) {
  const source = presets?.length ? presets : readProjectTypePresetsCache();
  return resolveClusterProjectType(type, source) || source[0] || DEFAULT_PROJECT_TYPE_PRESETS[0];
}

export function projectTypeBadge(project: Project) {
  return projectTypeMeta(project.projectType).label;
}

export function dayStart(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function dayEnd(date = new Date()) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function isToday(value?: string | null) {
  if (!value) return false;
  const stamp = new Date(value).getTime();
  return stamp >= dayStart().getTime() && stamp <= dayEnd().getTime();
}

export function isPast(value?: string | null) {
  if (!value) return false;
  const stamp = new Date(value).getTime();
  return !Number.isNaN(stamp) && stamp < Date.now();
}

export function attentionSourceLabel(source: AttentionItem["source"]) {
  switch (source) {
    case "timeline":
      return "Timeline";
    case "project":
      return "Project";
    case "build":
      return "Build";
    case "time":
      return "Scheduler";
    case "library":
      return "Library";
    case "external":
      return "External";
    case "team":
      return "People";
    case "approval":
      return "Approval";
    case "ticket":
      return "Tickets";
    case "dependency":
      return "Dependency";
    case "recurring":
      return "Recurring";
    case "watcher":
      return "Watcher";
    case "closeout":
      return "Closeout";
    case "portal":
      return "Portal";
    case "attachment":
      return "Attachment";
    case "maintenance":
      return "Maintenance";
    case "diagnostics":
      return "Diagnostics";
    default:
      return "Activity";
  }
}

export function attentionActionTarget(source: AttentionItem["source"]): AttentionItem["target"] {
  if (source === "timeline") return "timeline";
  if (source === "build") return "builds";
  if (source === "time") return "scheduler";
  if (source === "library") return "library";
  if (source === "team") return "people";
  if (source === "approval") return "inbox";
  if (source === "ticket") return "tickets";
  if (source === "activity") return "activity";
  if (source === "attachment") return "library";
  if (source === "maintenance" || source === "diagnostics") return "admin";
  if (source === "dependency" || source === "recurring" || source === "watcher") return "timeline";
  return "projects";
}

export function makeAttentionItem(
  input: Omit<AttentionItem, "createdAt" | "actionLabel" | "target"> & {
    createdAt?: string;
    actionLabel?: string;
    target?: AttentionItem["target"];
  },
): AttentionItem {
  return {
    ...input,
    createdAt: input.createdAt || new Date().toISOString(),
    actionLabel: input.actionLabel || `Open ${attentionSourceLabel(input.source)}`,
    target: input.target || attentionActionTarget(input.source),
  };
}

export function fromDateTimeLocalInput(value: string) {
  return new Date(value).toISOString();
}

export function boardOptions(projects: Project[]) {
  return projects.flatMap((project) =>
    project.boards.map((board) => ({
      ...board,
      projectId: project.id,
      projectName: project.name,
    })),
  );
}

export function quickCreateModeFromSetting(value?: Settings["userQuickCreateTarget"]): QuickCreateMode {
  return value && CLUSTER_CREATE_MODE_IDS.includes(value) ? value : "project";
}

export function normalizeBuildPlatformKey(project?: Project | null) {
  const productionProfile = resolveClusterProductionProfile(project?.productionProfile || "generic", project?.projectType);
  if (project?.productionProfile && productionProfile.buildProfileKey) return productionProfile.buildProfileKey;
  const preset = readProjectTypePresetsCache().find((item) => item.id === project?.projectType);
  return preset?.buildProfileKey || "generic";
}

export function projectBuildProfile(project: Project) {
  const key = normalizeBuildPlatformKey(project);
  return BUILD_PLATFORM_PROFILES.find((profile) => profile.key === key) || BUILD_PLATFORM_PROFILES.find((profile) => profile.key === "generic")!;
}


export function customFieldVisible(field: StudioCustomFieldDefinition, values: Record<string, string | boolean>) {
  if (!field.showWhenFieldId) return true;
  const actual = values[field.showWhenFieldId];
  if (typeof actual === "boolean") return String(actual) === (field.showWhenValue || "true");
  return (
    String(actual ?? "")
      .trim()
      .toLowerCase() ===
    String(field.showWhenValue || "")
      .trim()
      .toLowerCase()
  );
}

export function customFieldValueIsEmpty(value: string | boolean | undefined) {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

export function libraryStatusLabel(status?: string | null) {
  if (status === "needs-review" || status === "in-review") return "In review";
  if (status === "approved") return "Approved";
  if (status === "needs-update") return "Needs update";
  if (status === "deprecated") return "Deprecated";
  if (status === "archived") return "Archived";
  if (status === "draft") return "Draft";
  return "Active";
}
