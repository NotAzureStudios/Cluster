import type { ReactNode, RefObject } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";

export function ClusterTaskbar({ left, tabs, utilities, children, searchOpen = false }: { left: ReactNode; tabs: ReactNode; utilities: ReactNode; children?: ReactNode; searchOpen?: boolean }) {
  // The floating/full-width switch only changes placement. Tabs, menus and shortcuts are shared.
  return <div className="cluster-taskbar taskbar-unified-v3430" role="navigation" aria-label="Workspace taskbar">
    <div className="cluster-taskbar__left taskbar-left-v073">{left}</div>
    <div className="cluster-taskbar__tabs taskbar-tabs-shell-v073 cluster-taskbar-search-switch-v546" data-search-open={searchOpen ? "true" : "false"}>
      <div className="cluster-taskbar-search-switch__projects" aria-hidden={searchOpen} inert={searchOpen}>{tabs}</div>
      <div className="cluster-taskbar-search-switch__input" id="cluster-taskbar-search-slot" aria-hidden={!searchOpen} inert={!searchOpen} />
    </div>
    <div className="cluster-taskbar__utilities taskbar-right-v143">{utilities}</div>
    {children}
  </div>;
}

export function TaskbarAction({ icon, label, className = "", active = false, badge, onClick, title, ariaLabel }: { icon: ClusterIconName; label?: string; className?: string; active?: boolean; badge?: ReactNode; onClick: () => void; title?: string; ariaLabel?: string }) {
  return <ClusterButton unstyled type="button" className={`cluster-taskbar-action ${active ? "is-active" : ""} ${className}`.trim()} onClick={onClick} title={title || label} aria-label={ariaLabel || label}>
    <ClusterIcon name={icon} treatment="action" className="cluster-taskbar-action__icon" />
    {label ? <span className="cluster-taskbar-action__label">{label}</span> : null}
    {badge}
  </ClusterButton>;
}

export function ClusterSidebarShell({ collapsed, open, mode, children, sidebarRef }: { collapsed: boolean; open: boolean; mode: "auto" | "expanded" | "compact"; children: ReactNode; sidebarRef?: RefObject<HTMLElement | null> }) {
  return <aside ref={sidebarRef} id="cluster-sidebar" className={`cluster-sidebar cluster-sidebar-shell shell-sidebar-v3430 sidebar-drawer-v289 sidebar-collapsible ${collapsed ? "is-collapsed sidebar-collapsed" : ""} ${open ? "is-open open" : ""}`.trim()} data-presentation-mode={mode} aria-label="Cluster navigation" role={open ? "dialog" : undefined} aria-modal={open || undefined}>{children}</aside>;
}

export function SidebarSection({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return <div id={id} className={`cluster-sidebar-section ${className}`.trim()}>{children}</div>;
}

export function SidebarNavItem({ icon, label, active = false, nested = false, badge, trailing, title, onClick, onPointerEnter, onFocus, ariaExpanded, ariaControls }: { icon?: ClusterIconName; label: string; active?: boolean; nested?: boolean; badge?: ReactNode; trailing?: ReactNode; title?: string; onClick: () => void; onPointerEnter?: () => void; onFocus?: () => void; ariaExpanded?: boolean; ariaControls?: string }) {
  return <ClusterButton unstyled type="button" className={`cluster-sidebar-nav-item ${active ? "is-active" : ""} ${nested ? "is-nested" : ""}`.trim()} onPointerEnter={onPointerEnter} onFocus={onFocus} onClick={onClick} aria-label={label} aria-current={active && ariaExpanded === undefined ? "page" : undefined} aria-expanded={ariaExpanded} aria-controls={ariaControls} title={title || label}>
    {icon ? <span className="cluster-sidebar-nav-item__icon" data-nav-icon={icon}><ClusterIcon name={icon} treatment={active ? "duotone" : nested ? "navigation" : "duotone"} /></span> : null}
    <span className="cluster-sidebar-nav-item__label">{label}</span>
    {badge != null ? <span className="cluster-sidebar-nav-item__badge">{badge}</span> : null}
    {trailing ? <span className="cluster-sidebar-nav-item__trailing">{trailing}</span> : null}
  </ClusterButton>;
}
export function SidebarProjectItem({ label, meta, active, pinned, onOpen, onTogglePin }: { label: string; meta?: string; active?: boolean; pinned?: boolean; onOpen: () => void; onTogglePin: () => void }) {
  return <div className={`cluster-sidebar-project ${active ? "is-active" : ""} ${pinned ? "is-pinned" : ""}`.trim()}>
    <ClusterButton unstyled type="button" className="cluster-sidebar-project__main" onClick={onOpen} title={label} aria-current={active ? "page" : undefined}>
      <span className="cluster-sidebar-project__marker" aria-hidden="true" />
      <span className="cluster-sidebar-project__copy"><strong>{label}</strong>{meta ? <small>{meta}</small> : null}</span>
    </ClusterButton>
    <ClusterButton unstyled type="button" className="cluster-sidebar-project__pin" aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`} aria-pressed={pinned} title={pinned ? "Unpin project" : "Pin project"} onClick={onTogglePin}><ClusterIcon name={pinned ? "star-filled" : "star"} /></ClusterButton>
  </div>;
}

