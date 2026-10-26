import { readPreferenceStorage, writePreferenceStorage } from "../../../core/privacy-consent";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClusterDialogInteraction } from "../../../components/useClusterDialogInteraction";
import { APP_SIDEBAR_SECTIONS, canOpenScreen, routeDefinition, screenLabel, sidebarRouteDefinitions, type AppScreen } from "../../../core/navigation";
import { ADAPTIVE_MEDIA } from "../../../core/adaptive-layout";
import { useServerState } from "../../../core/server-state";
import { AppVersionFooter } from "../../../components/AppVersionFooter";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterButton } from "../../../components/ClusterButton";
import { CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT } from "../../help/contextual-help";
import { scheduleFeaturePrefetch } from "../../shell/feature-prefetch";
import type { User, Project, Settings } from "../application-models";
import { projectTypeBadge } from "./project-shell-helpers";
import { canUseProject } from "../../projects/project-access-policy";
import { ClusterSidebarShell, SidebarNavItem, SidebarProjectItem, SidebarSection } from "../../shell/ShellPrimitives";

type SidebarPresentationMode = "auto" | "expanded" | "compact";
export function Sidebar({ screen, setScreen, user, settings, projects, currentProjectId, onOpenProject, onOpenChangelog, open = false, onClose }: { screen: AppScreen; currentRoute?: string; setScreen: (screen: AppScreen) => void; user: User; settings: Settings; projects: Project[]; currentProjectId?: string | null; onOpenProject: (projectId: string) => void; onOpenChangelog: () => void; open?: boolean; onClose?: () => void }) {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [adminToolsOpen, setAdminToolsOpen] = useState(() => routeDefinition(screen).parent === "admin");
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
  const effectiveCollapsed = persistentNavigation && (sidebarMode === "compact" || (sidebarMode === "auto" && compactNavigation));
  const activeMobileDrawer = open && !persistentNavigation;
  useClusterDialogInteraction({ active: activeMobileDrawer, dialogRef: sidebarRef, onEscape: onClose });
  useEffect(() => { if (open && persistentNavigation) onClose?.(); }, [open, persistentNavigation, onClose]);
  useEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = effectiveCollapsed ? "true" : "false";
    document.documentElement.dataset.sidebarMode = sidebarMode;
    document.documentElement.style.setProperty("--cluster-sidebar-current-width", effectiveCollapsed ? "72px" : "264px");
    try { writePreferenceStorage("cluster.sidebar.mode", sidebarMode); } catch {}
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
  const [pinnedProjectIds, setPinnedProjectState] = useServerState<string[]>("user", "projects.pinned", [], { merge: (value) => Array.isArray(value) ? value.map(String) : [] });
  const pinnedProjects = useMemo(() => pinnedProjectIds.map((id) => visibleProjects.find((project) => project.id === id)).filter((project): project is Project => Boolean(project)), [pinnedProjectIds, visibleProjects]);
  const sidebarProjects = useMemo(() => [...pinnedProjects, ...visibleProjects.filter((project) => !pinnedProjectIds.includes(project.id))].slice(0, 10), [pinnedProjectIds, pinnedProjects, visibleProjects]);
  const projectCountLabel = visibleProjects.length ? `${visibleProjects.length}` : "0";
  function togglePin(projectId: string) {
    const next = pinnedProjectIds.includes(projectId) ? pinnedProjectIds.filter((id) => id !== projectId) : [projectId, ...pinnedProjectIds];
    setPinnedProjectState(next);
  }
  function navigate(next: AppScreen) {
    setScreen(next);
    onClose?.();
  }
  function prefetch(next: AppScreen) {
    scheduleFeaturePrefetch(next);
  }
  function openProject(projectId: string) {
    onOpenProject(projectId);
    onClose?.();
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
          onClick={() => setSidebarMode(sidebarMode === "auto" ? (effectiveCollapsed ? "expanded" : "compact") : "auto")}
          aria-label={sidebarMode === "auto" ? (effectiveCollapsed ? "Keep navigation expanded" : "Keep navigation compact") : "Return navigation to Auto mode"}
          title={sidebarMode === "auto" ? `Auto sidebar · ${effectiveCollapsed ? "keep expanded" : "keep compact"}` : `${sidebarMode === "compact" ? "Compact" : "Expanded"} sidebar · return to Auto`}
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
            <SidebarNavItem icon="project" label="Projects" active={screen === "projects" || screen === "project"} badge={projectCountLabel} ariaExpanded={effectiveCollapsed ? undefined : projectsOpen} ariaControls={effectiveCollapsed ? undefined : "cluster-sidebar-project-list"} trailing={<ClusterIcon name={projectsOpen ? "chevron-down" : "chevron-right"} />} onClick={() => effectiveCollapsed ? navigate("projects") : setProjectsOpen((value) => !value)} />
            {!effectiveCollapsed && projectsOpen && (
              <div id="cluster-sidebar-project-list" className="cluster-sidebar__project-list">
                <SidebarNavItem icon="folder" label="All projects" active={screen === "projects"} nested onPointerEnter={() => prefetch("projects")} onFocus={() => prefetch("projects")} onClick={() => navigate("projects")} />
                                {sidebarProjects.length ? (
                  sidebarProjects.map((project) => {
                    const active = screen === "project" && currentProjectId === project.id;
                    const pinned = pinnedProjectIds.includes(project.id);
                    return (
                      <SidebarProjectItem key={project.id} label={project.name} meta={projectTypeBadge(project)} active={active} pinned={pinned} onOpen={() => openProject(project.id)} onTogglePin={() => togglePin(project.id)} />
                    );
                  })
                ) : (
                  <span className="cluster-sidebar__empty">No projects</span>
                )}
                {visibleProjects.length > sidebarProjects.length && (
                  <ClusterButton unstyled type="button" className="cluster-sidebar__link cluster-sidebar__more" onPointerEnter={() => prefetch("projects")} onFocus={() => prefetch("projects")} onClick={() => navigate("projects")}>
                    <span>View all +{visibleProjects.length - sidebarProjects.length}</span>
                  </ClusterButton>
                )}
              </div>
            )}
          </SidebarSection>
        )}

        {sidebarSections.map((section) => {
          if (section.id === "administration") {
            const operations = section.routes.find((entry) => entry.screen === "admin");
            const tools = section.routes.filter((entry) => entry.screen !== "admin" && entry.screen !== "vault");
            const vault = section.routes.find((entry) => entry.screen === "vault");
            const childActive = tools.some((entry) => entry.screen === screen);
            return <SidebarSection key={section.id} className={`cluster-sidebar__section cluster-sidebar__section--administration ${childActive ? "has-active-child" : ""}`}>
              {operations ? renderRouteLink(operations.screen) : null}
              {vault ? renderRouteLink(vault.screen) : null}
              {tools.length ? <>
                <SidebarNavItem icon="settings" label="Admin tools" active={childActive} ariaExpanded={effectiveCollapsed ? undefined : adminToolsOpen} ariaControls={effectiveCollapsed ? undefined : "cluster-sidebar-admin-list"} trailing={<ClusterIcon name={adminToolsOpen ? "chevron-down" : "chevron-right"} />} onClick={() => effectiveCollapsed ? navigate("admin") : setAdminToolsOpen((value) => !value)} />
                {!effectiveCollapsed && adminToolsOpen ? <div id="cluster-sidebar-admin-list" className="cluster-sidebar__admin-list">{tools.map(({ screen: route }) => renderRouteLink(route, true))}</div> : null}
              </> : null}
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

