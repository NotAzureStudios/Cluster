import { readPreferenceStorage, writePreferenceStorage } from "../../../core/preference-storage";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useClusterDialogInteraction } from "../../../components/useClusterDialogInteraction";
import { APP_SIDEBAR_SECTIONS, canOpenScreen, routeDefinition, screenLabel, sidebarRouteDefinitions, type AppScreen } from "../../../core/navigation";
import { ADAPTIVE_MEDIA } from "../../../core/adaptive-layout";
import { AppVersionFooter } from "../../../components/AppVersionFooter";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterButton } from "../../../components/ClusterButton";
import { scheduleFeaturePrefetch } from "../../shell/feature-prefetch";
import { resolveSidebarCollapsed, nextSidebarMode } from "../../shell/sidebar-presentation";
import type { User, Project, Settings } from "../application-models";
import { canUseProject } from "../../projects/project-access-policy";
import { ClusterSidebarShell, SidebarNavItem, SidebarSection } from "../../shell/ShellPrimitives";

import type { SidebarPresentationMode } from "../../shell/sidebar-presentation";
export function Sidebar({ status, screen, currentRoute, setScreen, user, settings, projects, currentProjectId, onOpenProject, onOpenChangelog, open = false, onClose }: { status?: ReactNode; screen: AppScreen; currentRoute?: string; setScreen: (screen: AppScreen, options?: { section?: string | null; subsection?: string | null }) => void; user: User; settings: Settings; projects: Project[]; currentProjectId?: string | null; onOpenProject: (projectId: string) => void; onOpenChangelog: () => void; open?: boolean; onClose?: () => void }) {
  const sidebarRef = useRef<HTMLElement | null>(null);
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
    document.documentElement.style.setProperty("--cluster-sidebar-current-width", effectiveCollapsed ? "56px" : "192px");
    try { writePreferenceStorage("cluster.sidebar.mode", sidebarMode); } catch {}
    return () => {
      delete document.documentElement.dataset.sidebarCollapsed;
      delete document.documentElement.dataset.sidebarMode;
      document.documentElement.style.removeProperty("--cluster-sidebar-current-width");
    };
  }, [effectiveCollapsed, sidebarMode]);
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
      <div className="cl-sb__header">
        {settings.organizationLogoUrl ? <img className="cl-sb__logo" src={settings.organizationLogoUrl} alt="" /> : <img className="cl-sb__logo" src="/cluster-logo.png" alt="" />}
        {/* One line: the studio's name. "Cluster" over it repeated what the
            logo already says. */}
        <strong className="cl-sb__brand" title={settings.studioName || "Cluster"}>{settings.studioName || "Cluster"}</strong>
        <ClusterButton
          unstyled
          type="button"
          className="cl-sb__toggle"
          onClick={() => setSidebarMode(nextSidebarMode(effectiveCollapsed))}
          aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={effectiveCollapsed}
          title={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ClusterIcon name={effectiveCollapsed ? "chevron-right" : "chevron-left"} />
        </ClusterButton>
        <ClusterButton unstyled type="button" className="cl-sb__close" onClick={onClose} aria-label="Close sidebar">
          <ClusterIcon name="close" />
        </ClusterButton>
      </div>

      <nav className="cl-sb__nav" aria-label="Main navigation">
        {/* Home, My Work and Projects are where people start from, so they
            lead, unlabelled. My Work used to live only in the title bar as a
            labelled button, the one destination missing from here. */}
        <SidebarSection>
          <SidebarNavItem icon="home" label={screenLabel("dashboard")} active={screen === "dashboard"} onClick={() => navigate("dashboard")} />
          {canOpenScreen(user, "mywork") && <SidebarNavItem icon="check" label={screenLabel("mywork")} active={screen === "mywork"}
            onPointerEnter={() => prefetch("mywork")} onFocus={() => prefetch("mywork")} onClick={() => navigate("mywork")} />}
          {canSeeProjects && <SidebarNavItem icon="project" label="Projects" active={screen === "projects" || screen === "project"}
            badge={visibleProjects.length || undefined} onPointerEnter={() => prefetch("projects")} onFocus={() => prefetch("projects")}
            onClick={() => navigate("projects")} />}
        </SidebarSection>

        {sidebarSections.map((section) => {
          if (section.id === "administration") {
            // One entry: every admin page lives in the Admin workspace, which
            // has its own navigation (features/admin/AdminFrame).
            const adminActive = section.routes.some((entry) => entry.screen === screen) || screen === "studioSettings" || (screen === "people" && currentRoute?.split("/")[1] === "admin");
            return <SidebarSection key={section.id}>
              <SidebarNavItem icon="settings" label="Admin" active={adminActive}
                onPointerEnter={() => prefetch("admin")} onFocus={() => prefetch("admin")}
                onClick={() => navigate("admin")} />
            </SidebarSection>;
          }
          return <SidebarSection key={section.id} label={effectiveCollapsed ? undefined : section.label}>
            {section.routes.map(({ screen: route }) => renderRouteLink(route))}
          </SidebarSection>;
        })}
      </nav>
      {status ? <div className="cl-sb__status">{status}</div> : null}
      <div className="cl-sb__footer">
        <AppVersionFooter onOpenChangelog={() => { onOpenChangelog(); onClose?.(); }} onOpenOperations={isAdmin ? () => navigate("admin") : undefined} /></div>
    </ClusterSidebarShell>
  );
}

