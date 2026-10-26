import { CLUSTER_PROJECT_TOOL_IDS, CLUSTER_PROJECT_TOOL_MANIFEST, type ClusterProjectToolId, type ClusterProjectWorkspaceMode } from "@cluster/shared";

export const PROJECT_WORKSPACE_MODES = [
  "Overview",
  "Plan & Control",
  "Produce & Validate",
  "Spaces & Assets",
  "People & Access",
  "Lifecycle",
] as const satisfies readonly ClusterProjectWorkspaceMode[];

export type ProjectWorkspaceMode = ClusterProjectWorkspaceMode;

export const PROJECT_WORKSPACE_SECTIONS = CLUSTER_PROJECT_TOOL_IDS.map((id) => ({
  id,
  defaultLabel: CLUSTER_PROJECT_TOOL_MANIFEST[id].label,
  mode: CLUSTER_PROJECT_TOOL_MANIFEST[id].mode,
  order: CLUSTER_PROJECT_TOOL_MANIFEST[id].order,
})) satisfies ReadonlyArray<{
  id: ClusterProjectToolId;
  defaultLabel: string;
  mode: ProjectWorkspaceMode;
  order: number;
}>;

export type ProjectWorkspaceTabId = ClusterProjectToolId;
export type ProjectWorkspaceSectionDefinition = (typeof PROJECT_WORKSPACE_SECTIONS)[number];

const PROJECT_WORKSPACE_SECTION_MAP = new Map<ProjectWorkspaceTabId, ProjectWorkspaceSectionDefinition>(
  PROJECT_WORKSPACE_SECTIONS.map((section) => [section.id, section]),
);

export function projectWorkspaceSection(id: ProjectWorkspaceTabId) {
  return PROJECT_WORKSPACE_SECTION_MAP.get(id)!;
}
