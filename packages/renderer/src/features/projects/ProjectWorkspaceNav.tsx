import { useMemo } from "react";
import { CompactSectionNav } from "../../components/CompactSectionNav";
import type { ProjectWorkspaceMode, ProjectWorkspaceTabId } from "./project-workspace-registry";
import { projectPrimaryTabIds } from "./project-primary-tabs";

export type { ProjectWorkspaceTabId } from "./project-workspace-registry";
export type ProjectWorkspaceNavItem = { id: ProjectWorkspaceTabId; label: string; detail?: string; group: ProjectWorkspaceMode };

const PRIMARY_PROJECT_SECTIONS: readonly ProjectWorkspaceTabId[] = ["overview", "plan", "tickets", "builds", "boards", "people"];

export function ProjectWorkspaceNav({ items, activeId, onChange, primaryIds: requestedPrimaryIds }: { items: ProjectWorkspaceNavItem[]; activeId: ProjectWorkspaceTabId; onChange: (id: ProjectWorkspaceTabId) => void; primaryIds?: readonly ProjectWorkspaceTabId[] }) {
  const primaryIds = useMemo(() => projectPrimaryTabIds(items, requestedPrimaryIds?.length ? requestedPrimaryIds : PRIMARY_PROJECT_SECTIONS, activeId), [items, requestedPrimaryIds, activeId]);
  return (
    <CompactSectionNav
      className="project-workspace-nav-compact-v495 project-workspace-nav-current"
      label="Project sections"
      items={items.map((item) => ({ id: item.id, label: item.label, detail: item.detail, group: item.group }))}
      activeId={activeId}
      onChange={onChange}
      primaryIds={primaryIds}
      moreLabel="More tools"
    />
  );
}
