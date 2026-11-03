import type { ReactNode } from "react";
import { CompactSectionNav, type CompactSectionNavItem } from "./CompactSectionNav";
import type { ClusterIconName } from "./ClusterIcon";
import type { ToolPageMetric } from "./ToolPageHeader";
import { WorkspacePageShell } from "./WorkspacePageShell";

export function SectionedWorkspaceShell<Id extends string>({
  className = "",
  title,
  icon,
  description,
  actions,
  metrics = [],
  status,
  statusClassName = "",
  navLabel,
  navClassName = "",
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
  statusClassName?: string;
  navLabel: string;
  navClassName?: string;
  activeId: Id;
  onChange: (id: Id) => void;
  primaryIds?: readonly Id[];
  showGroupHeadings?: boolean;
  items: CompactSectionNavItem<Id>[];
  children: ReactNode;
}) {
  return (
    <WorkspacePageShell className={className} title={title} icon={icon} description={description} actions={actions} metrics={metrics}>
      {status ? (
        <div className={`status-box system-status-box-v053 cluster-page-status ${statusClassName}`.trim()} role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
      <div className="cluster-sectioned-workspace">
        <CompactSectionNav
          className={`cluster-sectioned-nav ${navClassName}`.trim()}
          label={navLabel}
          activeId={activeId}
          onChange={onChange}
          primaryIds={primaryIds}
      showGroupHeadings={showGroupHeadings}
          items={items}
        />
        <div className="cluster-sectioned-main">
          {children}
        </div>
      </div>
    </WorkspacePageShell>
  );
}
