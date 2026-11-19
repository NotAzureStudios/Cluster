import type { ReactNode, RefObject } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";

/* The window frame: title bar and sidebar.
   Everything here renders under the cl-tb / cl-sb class names, styled by
   features/shell/shell-frame.css alone. The previous names sat under five
   stylesheets that each called themselves canonical (shell.css, sidebar.css,
   shell-v2.css, shell-spatial-rc27.css, application-sidebar-rc27.css) — about
   900 rules, many !important or keyed on the #cluster-sidebar id — and new
   names were the clean way out of that cascade. Popover contents keep their
   own classes: they are portalled to <body> and never sat under the frame. */

export function ClusterTaskbar({ left, tabs, utilities, children, searchOpen = false }: { left: ReactNode; tabs: ReactNode; utilities: ReactNode; children?: ReactNode; searchOpen?: boolean }) {
  return <div className="cl-tb" role="navigation" aria-label="Workspace">
    <div className="cl-tb__start">{left}</div>
    <div className="cl-tb__center" data-search-open={searchOpen ? "true" : "false"}>
      <div className="cl-tb__tabs" aria-hidden={searchOpen} inert={searchOpen}>{tabs}</div>
      <div className="cl-tb__search-slot" id="cluster-taskbar-search-slot" aria-hidden={!searchOpen} inert={!searchOpen} />
    </div>
    <div className="cl-tb__end">{utilities}</div>
    {children}
  </div>;
}

export function TaskbarAction({ icon, label, className = "", active = false, badge, onClick, title, ariaLabel }: { icon: ClusterIconName; label?: string; className?: string; active?: boolean; badge?: ReactNode; onClick: () => void; title?: string; ariaLabel?: string }) {
  return <ClusterButton unstyled type="button" className={`cl-tb-action ${label ? "" : "cl-tb-action--icon"} ${active ? "is-active" : ""} ${className}`.trim()} onClick={onClick} title={title || label} aria-label={ariaLabel || label}>
    <ClusterIcon name={icon} treatment="action" className="cl-tb-action__icon" />
    {label ? <span className="cl-tb-action__label">{label}</span> : null}
    {badge}
  </ClusterButton>;
}

export function ClusterSidebarShell({ collapsed, open, mode, children, sidebarRef }: { collapsed: boolean; open: boolean; mode: "auto" | "expanded" | "compact"; children: ReactNode; sidebarRef?: RefObject<HTMLElement | null> }) {
  return <aside ref={sidebarRef} id="cl-sidebar" className="cl-sb" data-collapsed={collapsed ? "true" : "false"} data-open={open ? "true" : "false"} data-presentation-mode={mode} aria-label="Cluster navigation" role={open ? "dialog" : undefined} aria-modal={open || undefined}>{children}</aside>;
}

export function SidebarSection({ id, label, className = "", children }: { id?: string; label?: string; className?: string; children: ReactNode }) {
  return <div id={id} className={`cl-sb__section ${className}`.trim()}>
    {label ? <span className="cl-sb__section-label">{label}</span> : null}
    {children}
  </div>;
}

export function SidebarNavItem({ icon, label, active = false, nested = false, badge, trailing, title, onClick, onPointerEnter, onFocus, ariaExpanded, ariaControls }: { icon?: ClusterIconName; label: string; active?: boolean; nested?: boolean; badge?: ReactNode; trailing?: ReactNode; title?: string; onClick: () => void; onPointerEnter?: () => void; onFocus?: () => void; ariaExpanded?: boolean; ariaControls?: string }) {
  return <ClusterButton unstyled type="button" className={`cl-sb-item ${active ? "is-active" : ""} ${nested ? "is-nested" : ""}`.trim()} onPointerEnter={onPointerEnter} onFocus={onFocus} onClick={onClick} aria-label={label} aria-current={active && ariaExpanded === undefined ? "page" : undefined} aria-expanded={ariaExpanded} aria-controls={ariaControls} title={title || label}>
    {icon ? <ClusterIcon name={icon} treatment="navigation" className="cl-sb-item__icon" /> : <span className="cl-sb-item__icon" aria-hidden="true" />}
    <span className="cl-sb-item__label">{label}</span>
    {badge != null ? <span className="cl-sb-item__badge">{badge}</span> : null}
    {trailing ? <span className="cl-sb-item__trailing">{trailing}</span> : null}
  </ClusterButton>;
}

export function SidebarProjectItem({ label, meta, active, pinned, onOpen, onTogglePin }: { label: string; meta?: string; active?: boolean; pinned?: boolean; onOpen: () => void; onTogglePin: () => void }) {
  return <div className={`cl-sb-project ${active ? "is-active" : ""} ${pinned ? "is-pinned" : ""}`.trim()}>
    <ClusterButton unstyled type="button" className="cl-sb-project__main" onClick={onOpen} title={label} aria-current={active ? "page" : undefined}>
      <span className="cl-sb-project__marker" aria-hidden="true" />
      <span className="cl-sb-project__copy"><strong>{label}</strong>{meta ? <small>{meta}</small> : null}</span>
    </ClusterButton>
    <ClusterButton unstyled type="button" className="cl-sb-project__pin" aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`} aria-pressed={pinned} title={pinned ? "Unpin" : "Pin"} onClick={onTogglePin}><ClusterIcon name={pinned ? "star-filled" : "star"} /></ClusterButton>
  </div>;
}
