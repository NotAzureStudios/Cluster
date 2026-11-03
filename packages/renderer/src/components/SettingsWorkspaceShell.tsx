import type { ReactNode } from "react";
import type { ToolPageMetric } from "./ToolPageHeader";
import type { CompactSectionNavItem } from "./CompactSectionNav";
import type { ClusterIconName } from "./ClusterIcon";
import { SectionedWorkspaceShell } from "./SectionedWorkspaceShell";

export function SettingsWorkspaceShell<Id extends string>({
  className = "",
  title,
  icon,
  description,
  actions,
  metrics = [],
  status,
  navLabel,
  activeId,
  onChange,
  primaryIds,
  showGroupHeadings = false,
  items,
  children,
}: {
  className?: string;
  title: string;
  icon?: ClusterIconName | null;
  description?: string;
  actions?: ReactNode;
  metrics?: ToolPageMetric[];
  status?: ReactNode;
  navLabel: string;
  activeId: Id;
  onChange: (id: Id) => void;
  primaryIds?: readonly Id[];
  showGroupHeadings?: boolean;
  items: CompactSectionNavItem<Id>[];
  children: ReactNode;
}) {
  return (
    <SectionedWorkspaceShell
      className={className}
      title={title}
      icon={icon}
      description={description}
      actions={actions}
      metrics={metrics}
      status={status}
      statusClassName="settings-status-v469"
      navLabel={navLabel}
      navClassName="settings-section-nav-v469"
      activeId={activeId}
      onChange={onChange}
      primaryIds={primaryIds}
      showGroupHeadings={showGroupHeadings}
      items={items}
    >
      {children}
    </SectionedWorkspaceShell>
  );
}
