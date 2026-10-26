import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterButton } from "../../../components/ClusterButton";
import { isProjectContextScreen, type AppScreen } from "../../../core/navigation";

type MobilePrimaryNavigationProps = {
  screen: AppScreen;
  canSeeProjects: boolean;
  canSeeMyWork: boolean;
  canSeeNotifications: boolean;
  notificationCount: number;
  searchOpen: boolean;
  onOpenHome: () => void;
  onOpenProjects: () => void;
  onOpenMyWork: () => void;
  onOpenQuickCreate: () => void;
  onOpenSearch: () => void;
  onOpenNavigation: () => void;
};

export function MobilePrimaryNavigation({
  screen,
  canSeeProjects,
  canSeeMyWork,
  canSeeNotifications,
  notificationCount,
  searchOpen,
  onOpenHome,
  onOpenProjects,
  onOpenMyWork,
  onOpenQuickCreate,
  onOpenSearch,
  onOpenNavigation,
}: MobilePrimaryNavigationProps) {
  const secondIsProjects = canSeeProjects;
  const secondVisible = canSeeProjects || canSeeMyWork;
  const secondActive = secondIsProjects ? screen === "projects" || isProjectContextScreen(screen) : screen === "mywork";

  return (
    <nav className="mobile-primary-nav-v495" aria-label="Primary mobile navigation">
      <ClusterButton unstyled type="button" data-nav-icon="home" className={screen === "dashboard" ? "active" : ""} onClick={onOpenHome} aria-current={screen === "dashboard" ? "page" : undefined}>
        <ClusterIcon name="home" />
        <span>Home</span>
      </ClusterButton>
      {secondVisible ? (
        <ClusterButton unstyled
          type="button"
          className={secondActive ? "active" : ""}
          data-nav-icon={secondIsProjects ? "project" : "work"}
          onClick={secondIsProjects ? onOpenProjects : onOpenMyWork}
          aria-current={secondActive ? "page" : undefined}
        >
          <ClusterIcon name={secondIsProjects ? "project" : "work"} />
          <span>{secondIsProjects ? "Projects" : "My Work"}</span>
        </ClusterButton>
      ) : <span className="mobile-primary-nav-spacer-v495" aria-hidden="true" />}
      <ClusterButton unstyled type="button" className="mobile-primary-create-v495" onClick={onOpenQuickCreate} aria-label="Create" data-cluster-kiosk-write-action="true">
        <span className="mobile-primary-create-icon-v495"><ClusterIcon name="plus" /></span>
        <span>Create</span>
      </ClusterButton>
      <ClusterButton unstyled type="button" data-nav-icon="search" className={searchOpen ? "active" : ""} onClick={onOpenSearch} aria-pressed={searchOpen}>
        <ClusterIcon name="search" />
        <span>Search</span>
      </ClusterButton>
      <ClusterButton unstyled
        type="button"
        data-nav-icon="menu"
        onClick={onOpenNavigation}
        aria-haspopup="dialog"
        aria-controls="cluster-sidebar"
        aria-label={canSeeNotifications && notificationCount > 0 ? `More navigation, ${notificationCount > 99 ? "more than 99" : notificationCount} unread alerts` : "More navigation"}
      >
        <span className="mobile-primary-nav-icon-v495">
          <ClusterIcon name="menu" />
          {canSeeNotifications && notificationCount > 0 ? <em aria-hidden="true">{notificationCount > 99 ? "99+" : notificationCount}</em> : null}
        </span>
        <span>More</span>
      </ClusterButton>
    </nav>
  );
}
