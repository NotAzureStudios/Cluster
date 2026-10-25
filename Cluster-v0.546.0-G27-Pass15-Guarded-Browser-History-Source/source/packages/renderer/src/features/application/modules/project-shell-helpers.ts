import { resolveClusterProjectPurposeTypes, resolveClusterProjectType, sanitizeClusterProjectTypeDefinition } from "@cluster/shared";
import { unique } from "../../../core/storage";
import type { Project, ProjectTypePreset } from "../application-models";

const DEFAULT_CREATE_PROJECT_FIELDS = ["name", "project type", "status", "visibility", "source", "description", "starter assets"];
const DEFAULT_CREATE_BUILD_FIELDS = ["project", "platform", "version", "lane", "branch", "commit", "artifact link", "release notes"];
const DEFAULT_ROLE_APPROVAL_ROLES = ["owner", "admin", "producer", "qa lead"];
const DEFAULT_PROJECT_TYPE_PRESETS: ProjectTypePreset[] = resolveClusterProjectPurposeTypes().map((preset) => ({ ...preset, locked: false }));

function cleanPresetList(input: unknown, fallback: string[] = [], limit = 16) {
  const source = Array.isArray(input) ? input : fallback;
  return unique(source.map((item) => String(item || "").trim()).filter(Boolean)).slice(0, limit);
}

function sanitizeProjectTypePreset(input: Partial<ProjectTypePreset> | null | undefined, fallback?: ProjectTypePreset): ProjectTypePreset {
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

let projectTypePresetSnapshot: ProjectTypePreset[] | null = null;
function mergeProjectTypePresets(presets?: ProjectTypePreset[] | null) {
  const resolved = resolveClusterProjectPurposeTypes(presets).map((preset) => sanitizeProjectTypePreset(preset, DEFAULT_PROJECT_TYPE_PRESETS.find((item) => item.id === preset.id)));
  return resolved.length ? resolved : [sanitizeProjectTypePreset(DEFAULT_PROJECT_TYPE_PRESETS[0])];
}

export function writeProjectTypePresetsCache(presets?: ProjectTypePreset[] | null) {
  projectTypePresetSnapshot = mergeProjectTypePresets(presets);
}

function readProjectTypePresetsCache() {
  if (!projectTypePresetSnapshot) projectTypePresetSnapshot = mergeProjectTypePresets();
  return projectTypePresetSnapshot;
}

export function projectTypeBadge(project: Project) {
  const source = readProjectTypePresetsCache();
  return (resolveClusterProjectType(project.projectType, source) || source[0] || DEFAULT_PROJECT_TYPE_PRESETS[0]).label;
}

export function boardOptions(projects: Project[]) {
  return projects.flatMap((project) => project.boards.map((board) => ({ ...board, projectId: project.id, projectName: project.name })));
}
