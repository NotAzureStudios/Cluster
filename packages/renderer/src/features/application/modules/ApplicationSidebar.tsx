import "../styles/application-sidebar-rc27.css";
import { readPreferenceStorage, writePreferenceStorage } from "../../../core/privacy-consent";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClusterDialogInteraction } from "../../../components/useClusterDialogInteraction";
import { APP_SIDEBAR_SECTIONS, canOpenScreen, routeDefinition, screenLabel, sidebarRouteDefinitions, type AppScreen } from "../../../core/navigation";
import { ADAPTIVE_MEDIA } from "../../../core/adaptive-layout";
import { AppVersionFooter } from "../../../components/AppVersionFooter";
import { ClusterIcon, type ClusterIconName } from "../../../components/ClusterIcon";
import { ClusterButton } from "../../../components/ClusterButton";
import { CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT } from "../../help/contextual-help";
import { scheduleFeaturePrefetch } from "../../shell/feature-prefetch";
import { resolveSidebarCollapsed, nextSidebarMode } from "../../shell/sidebar-presentation";
import type { User, Project, Settings } from "../application-models";
import { canUseProject } from "../../projects/project-access-policy";
import { ClusterSidebarShell, SidebarNavItem, SidebarSection } from "../../shell/ShellPrimitives";

import type { SidebarPresentationMode } from "../../shell/sidebar-presentation";
/** Administrative destinations reuse the existing Studio Settings authority and permissions. */
const ADMIN_STUDIO_DESTINATIONS: readonly { label: string; icon: ClusterIconName; section: string; subsection?: string }[] = [
  { label: "Custom fields", icon: "list", section: "customFields" },
  { label: "Project types", icon: "project", section: "projectTypes" },
  { label: "Domains", icon: "link", section: "domains" },
  { label: "Automations", icon: "sync", section: "automations" },
  { label: "Forms", icon: "file", section: "studioSystems", subsection: "forms" },
  { label: "Policies", icon: "lock", section: "studioSystems", subsection: "policies" },
  { label: "Applications", icon: "users", section: "studioSystems", subsection: "applications" },
  { label: "Announcements", icon: "bell", section: "studioSystems", subsection: "announcements" },
];
export function Sidebar({ screen, currentRoute, setScreen, user, settings, projects, currentProjectId, onOpenProject, onOpenChangelog, open = false, onClose }: { screen: AppScreen; currentRoute?: string; setScreen: (screen: AppScreen, options?: { section?: string | null; subsection?: string | null }) => void; user: User; settings: Settings; projects: Project[]; currentProjectId?: string | null; onOpenProject: (projectId: string) => void; onOpenChangelog: () => void; open?: boolean; onClose?: () => void }) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [adminToolsOpen, setAdminToolsOpen] = useState(() => routeDefinition(screen).parent === "admin");
  const [adminStudioShortcutsOpen, setAdminStudioShortcutsOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarPresentationMode>(() => {
    try {
      const stored = readPreferenceStorage("cluster.sidebar.mode");
      return stored === "expanded" || stored === "compact" || stored === "auto" ? stored : "auto";
    } catch { return "auto"; }
  });
  const [compactNavigation, setCompactNavigation] = useState(() => typeof window !== "undefined" && window.matchMedia(ADAPTIVE_MEDIA.compactNavigation).matches);
  const [persistentNavigation, setPersistentNavigation] = useState(() => typeof window !== "undefined" && window.matchMedia(ADAPTIVE_MEDIA.persistentNavigation).matches);
  useEffect(() => {
    const compact = window.matchMedia(ADAPTIVE_MEDIA.compactNavigation);
    const persistent = window.matchMedia(ADAPTIVE_MEDIA.persistentNavigation);
    const sync = () => { setCompactNavigation(compact.matches); setPersistentNavigation(persistent.matches); };
    sync();
    compact.addEventListener("change", sync);
    persistent.addEventListener("change", sync);
    return () => { compact.removeEventListener("change", sync); persistent.removeEventListener("change", sync); };
  }, []);
  const effectiveCollapsed = resolveSidebarCollapsed(sidebarMode, persistentNavigation, compactNavigation);
  const activeMobileDrawer = open && !persistentNavigation;
  useClusterDialogInteraction({ active: activeMobileDrawer, dialogRef: sidebarRef, onEscape: onClose });
  useEffect(() => { if (open && persistentNavigation) onClose?.(); }, [open, persistentNavigation, onClose]);
  useEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = effectiveCollapsed ? "true" : "false";
    document.documentElement.dataset.sidebarMode = sidebarMode;
    document.documentElement.style.setProperty("--cluster-sidebar-current-width", effectiveCollapsed ? "72px" : "232px");
    try { writePreferenceStorage("cluster.sidebar.mode", sidebarMode); } catch {}
    return () => {
      delete document.documentElement.dataset.sidebarCollapsed;
      delete document.documentElement.dataset.sidebarMode;
      document.documentElement.style.removeProperty("--cluster-sidebar-current-width");
    };
  }, [effectiveCollapsed, sidebarMode]);
  useEffect(() => {
    if (screen === "admin" || routeDefinition(screen).parent === "admin") setAdminToolsOpen(true);
  }, [screen]);
  const canSeeProjects = canOpenScreen(user, "projects");
  const isAdmin = Boolean(user.isAdmin);
  const desktopHost = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const sidebarSections = useMemo(() => APP_SIDEBAR_SECTIONS
    .map((section) => ({
      ...section,
      routes: sidebarRouteDefinitions(section.id).filter(({ screen: route, definition }) => {
        if (!canOpenScreen(user, route)) return false;
        if (definition.sidebar?.desktopOnly && !desktopHost) return false;
        const featureFlag = definition.sidebar?.featureFlag;
        if (featureFlag && (settings as Record<string, unknown>)[featureFlag] === false) return false;
        return true;
      }),
    }))
    .filter((section) => section.routes.length > 0), [desktopHost, settings, user]);
  const visibleProjects = useMemo(() => projects.filter((project) => !project!.archived && canUseProject(user, project)), [projects, user]);
  const projectCountLabel = visibleProjects.length ? `${visibleProjects.length}` : "0";
  function navigate(next: AppScreen) {
    setScreen(next);
    onClose?.();
  }
  function prefetch(next: AppScreen) {
    scheduleFeaturePrefetch(next);
  }
  function renderRouteLink(route: AppScreen, nested = false) {
    const definition = routeDefinition(route);
    const label = screenLabel(route);
    const active = screen === route;
    return <SidebarNavItem
      key={route}
      icon={definition.sidebar?.icon}
      label={label}
      nested={nested}
      active={active}
      onPointerEnter={() => prefetch(route)}
      onFocus={() => prefetch(route)}
      onClick={() => navigate(route)}
    />;
  }
  return (
    <ClusterSidebarShell sidebarRef={sidebarRef} collapsed={effectiveCollapsed} open={activeMobileDrawer} mode={sidebarMode}>
      <div className="cluster-sidebar__header">
        {settings.organizationLogoUrl ? <img className="cluster-sidebar__logo org-logo small" src={settings.organizationLogoUrl} alt="Organization logo" /> : <img className="cluster-sidebar__logo cluster-brand-logo small" src="/cluster-logo.png" alt="Cluster" />}
        <div className="cluster-sidebar__brand">
          <strong>Cluster</strong>
          <span>{settings.studioName || "local studio"}</span>
        </div>
        <ClusterButton
          unstyled
          type="button"
          className="cluster-sidebar__mode-toggle"
          onClick={() => setSidebarMode(nextSidebarMode(effectiveCollapsed))}
          aria-label={effectiveCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-pressed={effectiveCollapsed}
          title={effectiveCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <ClusterIcon name={effectiveCollapsed ? "chevron-right" : "chevron-left"} />
        </ClusterButton>
        <ClusterButton unstyled type="button" className="cluster-sidebar__mobile-close" onClick={onClose} aria-label="Close navigation">
          <ClusterIcon name="close" />
        </ClusterButton>
      </div>

      <nav className="cluster-sidebar__nav" aria-label="Main navigation">
        <SidebarSection className="cluster-sidebar__section cluster-sidebar__section--primary">
          <SidebarNavItem icon="home" label={screenLabel("dashboard")} active={screen === "dashboard"} onClick={() => navigate("dashboard")} />
        </SidebarSection>

        {canSeeProjects && (
          <SidebarSection className="cluster-sidebar__section cluster-sidebar__projects">
            <SidebarNavItem icon="project" label="Projects" active={screen === "projects" || screen === "project"}
              badge={projectCountLabel} onPointerEnter={() => prefetch("projects")} onFocus={() => prefetch("projects")}
              onClick={() => navigate("projects")} />
          </SidebarSection>
        )}

        {sidebarSections.map((section) => {
          if (section.id === "administration") {
            const tools = section.routes;
            const selectedSection = currentRoute?.split("/")[1] || "";
            const selectedSubsection = currentRoute?.split("/")[2] || "";
            const childActive = tools.some((entry) => entry.screen === screen) || screen === "studioSettings";
            return <SidebarSection key={section.id} className={`cluster-sidebar__section cluster-sidebar__section--administration ${childActive ? "has-active-child" : ""}`}>
              <SidebarNavItem icon="settings" label="Admin tools" active={childActive} ariaExpanded={effectiveCollapsed ? undefined : adminToolsOpen} ariaControls={effectiveCollapsed ? undefined : "cluster-sidebar-admin-list"} trailing={<ClusterIcon name={adminToolsOpen ? "chevron-down" : "chevron-right"} />} onClick={() => effectiveCollapsed ? navigate("admin") : setAdminToolsOpen((value) => !value)} />
              {!effectiveCollapsed && adminToolsOpen ? <div id="cluster-sidebar-admin-list" className="cluster-sidebar__admin-list">
                <span className="cluster-sidebar__admin-group-label">Manage</span>
                {tools.filter(({ screen: route }) => route !== "studioSettings").map(({ screen: route }) => renderRouteLink(route, true))}
                <span className="cluster-sidebar__admin-group-label">Configure</span>
                {screen === "studioSettings" && selectedSection && ADMIN_STUDIO_DESTINATIONS.some((item) => item.section === selectedSection) ? <SidebarNavItem nested icon="settings" label="Studio settings" onClick={() => navigate("studioSettings")} /> : renderRouteLink("studioSettings", true)}
                <ClusterButton type="button" variant="quiet" size="compact" className="cluster-sidebar__studio-shortcuts-toggle"
                  aria-expanded={adminStudioShortcutsOpen} aria-controls="cluster-sidebar-studio-shortcuts"
                  onClick={() => setAdminStudioShortcutsOpen((value) => !value)}>
                  <ClusterIcon name={adminStudioShortcutsOpen ? "chevron-down" : "chevron-right"} />
                  Studio shortcuts
                </ClusterButton>
                {adminStudioShortcutsOpen ? <div id="cluster-sidebar-studio-shortcuts" className="cluster-sidebar__studio-shortcuts">
                  {ADMIN_STUDIO_DESTINATIONS.map((item) =>
                    <SidebarNavItem key={`${item.section}:${item.subsection || ""}`} nested icon={item.icon} label={item.label}
                      active={screen === "studioSettings" && selectedSection === item.section && (!item.subsection || selectedSubsection === item.subsection)}
                      onPointerEnter={() => prefetch("studioSettings")} onFocus={() => prefetch("studioSettings")}
                      onClick={() => { setScreen("studioSettings", { section: item.section, subsection: item.subsection }); onClose?.(); }} />
                  )}
                </div> : null}
              </div> : null}
            </SidebarSection>;
          }
          return <SidebarSection key={section.id} className={`cluster-sidebar__section cluster-sidebar__section--${section.id}`}>
            {section.routes.map(({ screen: route }) => renderRouteLink(route))}
          </SidebarSection>;
        })}
      </nav>
      <div className="cluster-sidebar__footer">
        <ClusterButton type="button" variant="quiet" size="compact" onClick={() => { window.dispatchEvent(new Event(CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT)); onClose?.(); }} aria-label="Help and common tasks">? Help</ClusterButton>
        <AppVersionFooter onOpenChangelog={() => { onOpenChangelog(); onClose?.(); }} onOpenOperations={isAdmin ? () => navigate("admin") : undefined} /></div>
    </ClusterSidebarShell>
  );
}

