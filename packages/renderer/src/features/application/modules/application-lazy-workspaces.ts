import { lazy } from "react";

export const LazyProjectTabsBar = lazy(() => import("./ApplicationProjectTabs").then((module) => ({ default: module.ProjectTabsBar })));
export const LazySetupWizard = lazy(() => import("./ApplicationSetupWizard").then((module) => ({ default: module.SetupWizard })));
export const LazyDesktopPresencePublisher = lazy(() => import("../../desktop/DesktopPresencePublisher").then((module) => ({ default: module.DesktopPresencePublisher })));

export const LazyDashboard = lazy(() => import("./ApplicationDashboard").then((module) => ({ default: module.Dashboard })));

export const LazyClusterHelpDialog = lazy(() => import("../../help/ClusterHelpDialog").then((module) => ({ default: module.ClusterHelpDialog })));
export const LazyCommandPalette = lazy(() => import("../../search/CommandPalette").then((module) => ({ default: module.CommandPalette })));
export const LazyNotificationCenterPage = lazy(() => import("../../notifications/NotificationCenterPage").then((module) => ({ default: module.NotificationCenterPage })));
export const LazyDesktopWorkspacePage = lazy(() => import("../../desktop/DesktopWorkspacePage"));
export const LazySignedOutKioskPage = lazy(() => import("../../desktop/SignedOutKioskPage").then((module) => ({ default: module.SignedOutKioskPage })));

export const LazyTimelinePage = lazy(() => import("./application-workspace-core").then((module) => ({ default: module.TimelinePage })));
export const LazyTimePage = lazy(() => import("./application-workspace-core").then((module) => ({ default: module.TimePage })));
export const LazyLibraryPage = lazy(() => import("./application-workspace-core").then((module) => ({ default: module.LibraryPage })));
export const LazyPacketsPage = lazy(() => import("./application-workspace-core").then((module) => ({ default: module.PacketsPage })));
export const LazyQuickCreateDrawer = lazy(() => import("./application-quick-create-route").then((module) => ({ default: module.QuickCreateDrawer })));

export const LazyTicketSystemPage = lazy(() => import("./application-ticket-route").then((module) => ({ default: module.TicketSystemPage })));
export const LazyBuildsFoldedIntoProjectsPage = lazy(() => import("./application-builds-route").then((module) => ({ default: module.BuildsFoldedIntoProjectsPage })));
export const LazyBoardPage = lazy(() => import("./application-board-routes").then((module) => ({ default: module.BoardPage })));
export const LazyWhiteboardPage = lazy(() => import("./application-board-routes").then((module) => ({ default: module.WhiteboardPage })));
export const LazyQAFoldedIntoProjectsPage = lazy(() => import("./application-project-delivery").then((module) => ({ default: module.QAFoldedIntoProjectsPage })));

export const LazyToolInfrastructurePage = lazy(() => import("./application-admin-workspaces").then((module) => ({ default: module.ToolInfrastructurePage })));

export const LazyProjectsRoute = lazy(() => import("./application-project-routes").then((module) => ({ default: module.ProjectsRoute })));
export const LazyProjectDetailRoute = lazy(() => import("./application-project-routes").then((module) => ({ default: module.ProjectDetailRoute })));
export const LazyAdminPage = lazy(() => import("../../admin/AdminWorkspacePage").then((module) => ({ default: module.AdminPage })));
export const LazyAccountSettingsPage = lazy(() => import("../../settings/AccountSettingsPage").then((module) => ({ default: module.AccountSettingsPage })));
export const LazyStudioSettingsPage = lazy(() => import("../../settings/StudioSettingsPage").then((module) => ({ default: module.StudioSettingsPage })));
export const LazyServerConfigPage = lazy(() => import("../../settings/ServerConfigPage").then((module) => ({ default: module.ServerConfigPage })));
export const LazyActivityPage = lazy(() => import("../../activity/ActivityPage").then((module) => ({ default: module.ActivityPage })));
export const LazyMyWorkPage = lazy(() => import("../../work/MyWorkPage").then((module) => ({ default: module.MyWorkPage })));
export const LazyProfilesPage = lazy(() => import("../../people/PeoplePages").then((module) => ({ default: module.ProfilesPage })));
